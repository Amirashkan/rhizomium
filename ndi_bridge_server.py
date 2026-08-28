#!/usr/bin/env python3
"""
Editor → NDI Bridge

NDI is a native protocol: it announces itself over mDNS and moves frames over
raw TCP/UDP, none of which a browser tab can do. So the editor cannot be an NDI
source by itself no matter how the page is served. This bridge is the other
half — it takes frames from the editor over a WebSocket and republishes them on
the network as an NDI source that any receiver (a vision mixer, Resolume,
OBS, a monitor on another machine) can subscribe to.

It is the video counterpart to osc_bridge_server.py, and deliberately the same
shape: a loopback WebSocket, an origin check, a welcome message carrying the
state the editor should show, /health and /stats.

Protocol (editor → bridge):
- On connect the bridge sends {"type": "welcome", ...}, which says whether NDI
  is actually available on this machine and, when it is not, why.
- Each frame is two messages, in order: a JSON header
  {"type": "frame", "width": W, "height": H, "format": "rgba"} followed by the
  raw pixel bytes as one binary message. This is the same shape
  frame_stream_server.py already uses, so the two ends of the project describe
  a frame the same way.
- The editor may send {"type": "set_source_name", "name": "..."} to rename the
  published source.

Running it:
    python3 ndi_bridge_server.py --source-name "Rhizomium"

NDI itself needs two things this repo does not vendor: the NDI runtime from
Vizrt (a native library, redistributed under their licence) and the `cyndilib`
Python binding — `pip install cyndilib`. Neither is a hard dependency: with
them missing the bridge still starts, still accepts the editor's connection and
reports the real reason NDI is unavailable, so the editor can tell the artist
what to install instead of showing them a dead toggle.
"""

import argparse
import asyncio
import json
import logging
import time
from fractions import Fraction
from typing import Dict, Optional

import aiohttp
from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('NDIBridgeServer')

# Origins the editor is served from. Kept in step with ALLOWED_ORIGINS in
# rhizo_server.py, frame_stream_server.py and osc_bridge_server.py.
ALLOWED_ORIGINS = frozenset({
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",  # vite dev server
    "http://localhost:5173",
})

DEFAULT_WS_HOST = '127.0.0.1'
DEFAULT_WS_PORT = 8768
DEFAULT_SOURCE_NAME = 'Rhizomium'
DEFAULT_FRAME_RATE = 30

SERVER_VERSION = '1.0.0'

# Bytes per pixel for the one format the editor sends. The browser's only cheap
# readback path (drawImage → getImageData) produces RGBA and nothing else, so
# there is no second format to support here.
BYTES_PER_PIXEL = 4

# Largest frame accepted, as a pixel count. This socket is loopback-only and
# origin-checked, but it still ends in an allocation sized by a number the
# client sent, so it needs a ceiling. 8192×8192 is past any real output and
# still only 256 MB if something asks for the whole of it.
MAX_FRAME_PIXELS = 8192 * 8192


def _import_error_hint(exc: BaseException) -> str:
    """
    Turn an import or init failure into something an artist can act on.

    The two failures look alike from Python and need opposite fixes: no
    `cyndilib` is a pip install, while a `cyndilib` that imports but cannot find
    `libndi` means the runtime from Vizrt is missing. Saying which is the
    difference between a one-line fix and an afternoon.
    """
    text = str(exc)
    if isinstance(exc, ModuleNotFoundError):
        return (
            'The cyndilib Python binding is not installed. '
            'Install it with: pip install cyndilib'
        )
    if 'ndi' in text.lower() and ('library' in text.lower() or 'so' in text.lower()):
        return (
            'cyndilib is installed but the NDI runtime could not be loaded '
            f'({text}). Install the NDI runtime from https://ndi.video/ .'
        )
    return f'NDI is unavailable: {text}'


class NDIOutput:
    """
    The NDI source itself: one sender, reconfigured whenever the frame size or
    rate changes.

    Everything that touches cyndilib lives here, in one class, reachable only
    through methods that report failure rather than raise. The binding is
    optional and its absence is the normal case on a machine that has not been
    set up for NDI yet, so an unavailable sender has to be an ordinary state of
    this object — not an exception that takes the bridge down with it.
    """

    def __init__(self, source_name: str = DEFAULT_SOURCE_NAME,
                 frame_rate: int = DEFAULT_FRAME_RATE):
        self.source_name = source_name
        self.frame_rate = frame_rate

        self.available = False
        self.error: Optional[str] = None

        self._sender = None
        self._video_frame = None
        self._width = 0
        self._height = 0

        self.frames_sent = 0
        self.frames_dropped = 0

        self._probe()

    def _probe(self):
        """Decide once whether NDI can work here, and remember why not."""
        try:
            import cyndilib  # noqa: F401
            self.available = True
            self.error = None
        except BaseException as exc:  # noqa: BLE001 - a native load can raise anything
            self.available = False
            self.error = _import_error_hint(exc)
            logger.warning(self.error)

    def _ensure_sender(self, width: int, height: int) -> bool:
        """
        Create or re-create the sender for this frame size.

        NDI fixes the resolution on the sending frame, so a resized canvas means
        a new one. Receivers handle a source changing format; they do not handle
        being fed pixels that do not match the header.
        """
        if not self.available:
            return False
        if self._sender is not None and self._width == width and self._height == height:
            return True

        self._close_sender()

        try:
            from cyndilib.sender import Sender
            from cyndilib.video_frame import VideoSendFrame
            from cyndilib.wrapper.ndi_structs import FourCC

            video_frame = VideoSendFrame()
            video_frame.set_resolution(width, height)
            video_frame.set_frame_rate(Fraction(self.frame_rate, 1))
            video_frame.set_fourcc(FourCC.RGBA)

            sender = Sender(self.source_name)
            sender.set_video_frame(video_frame)
            sender.open()

            self._sender = sender
            self._video_frame = video_frame
            self._width = width
            self._height = height
            logger.info(
                f'NDI source "{self.source_name}" now sending {width}×{height} '
                f'@ {self.frame_rate}fps'
            )
            return True
        except BaseException as exc:  # noqa: BLE001 - native failures are not all Exceptions
            self.available = False
            self.error = _import_error_hint(exc)
            logger.error(f'Could not start the NDI sender: {exc}')
            self._close_sender()
            return False

    def _close_sender(self):
        sender, self._sender = self._sender, None
        self._video_frame = None
        self._width = 0
        self._height = 0
        if sender is None:
            return
        try:
            sender.close()
        except BaseException as exc:  # noqa: BLE001
            logger.debug(f'Ignoring error while closing the NDI sender: {exc}')

    def send(self, frame: bytes, width: int, height: int) -> bool:
        """
        Publish one frame. Returns False when it could not be sent.

        A failure here is counted and reported, never raised: frames arrive
        continuously, and one bad frame must not end the connection that is
        delivering the rest.
        """
        if not self._ensure_sender(width, height):
            self.frames_dropped += 1
            return False
        try:
            # cyndilib writes through the buffer it is given and rejects a
            # read-only one ("Object is not writable"), which is exactly what
            # arrives from the WebSocket. bytearray() makes the one writable
            # copy it needs; without it every frame is refused.
            self._sender.write_video(bytearray(frame))
            self.frames_sent += 1
            return True
        except BaseException as exc:  # noqa: BLE001
            self.frames_dropped += 1
            logger.warning(f'Dropped a frame: {exc}')
            return False

    def set_source_name(self, name: str):
        """
        Rename the published source.

        The name is what receivers list, so it is worth changing at runtime —
        two machines both announcing "Rhizomium" is a confusing show. Renaming
        means re-announcing, so the sender is torn down and rebuilt on the next
        frame.
        """
        name = (name or '').strip()
        if not name or name == self.source_name:
            return
        self.source_name = name
        self._close_sender()
        logger.info(f'NDI source renamed to "{name}"')

    def set_frame_rate(self, frame_rate: int):
        if frame_rate == self.frame_rate or not (1 <= frame_rate <= 240):
            return
        self.frame_rate = frame_rate
        self._close_sender()

    def close(self):
        self._close_sender()

    def status(self) -> Dict:
        return {
            'ndi_available': self.available,
            'ndi_error': self.error,
            'ndi_sending': self._sender is not None,
            'source_name': self.source_name,
            'frame_rate': self.frame_rate,
            'width': self._width,
            'height': self._height,
        }


class NDIBridgeServer:
    """
    Accepts frames from the editor over a loopback WebSocket and republishes
    them as an NDI source.

    Unlike the OSC bridge there is nothing to fan out: NDI is the audience, and
    several editors publishing to one source name would interleave frames into
    nonsense. Clients are still all accepted and all counted — the newest one
    simply drives the output, which is what happens anyway when a reload leaves
    a stale socket closing behind it.
    """

    def __init__(
        self,
        ws_host: str = DEFAULT_WS_HOST,
        ws_port: int = DEFAULT_WS_PORT,
        source_name: str = DEFAULT_SOURCE_NAME,
        frame_rate: int = DEFAULT_FRAME_RATE,
    ):
        self.ws_host = ws_host
        self.ws_port = ws_port

        self.app = web.Application()
        self.runner: Optional[web.AppRunner] = None
        self.output = NDIOutput(source_name=source_name, frame_rate=frame_rate)

        self.clients: Dict[web.WebSocketResponse, Optional[Dict]] = {}

        self.frame_count = 0
        self.rejected_count = 0
        self.last_frame_time = 0.0
        self.fps = 0.0
        self.started_at = 0.0

        self._setup_routes()

    def _setup_routes(self):
        self.app.router.add_get('/', self.handle_index)
        self.app.router.add_get('/ws', self.handle_websocket)
        self.app.router.add_get('/health', self.handle_health)
        self.app.router.add_get('/stats', self.handle_stats)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        self.started_at = time.time()
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, self.ws_host, self.ws_port)
        await site.start()

        logger.info(f'NDI bridge WebSocket at ws://{self.ws_host}:{self.ws_port}/ws')
        if self.output.available:
            logger.info(f'Publishing as NDI source "{self.output.source_name}"')
        else:
            # Not fatal, and said plainly: the editor is told the same thing, and
            # the artist can fix it without restarting anything.
            logger.warning('Running without NDI output — ' + (self.output.error or ''))

    async def stop(self):
        for ws in list(self.clients):
            await ws.close()
        self.clients.clear()
        self.output.close()
        if self.runner:
            await self.runner.cleanup()
            self.runner = None
        logger.info('NDI bridge stopped')

    # ------------------------------------------------------------------
    # Frames
    # ------------------------------------------------------------------

    def _validate_header(self, header) -> Optional[str]:
        """Check a frame header, returning the reason it is unusable, or None."""
        if not isinstance(header, dict):
            return 'frame header is not an object'

        width = header.get('width')
        height = header.get('height')
        if not isinstance(width, int) or not isinstance(height, int):
            return 'frame header is missing an integer width and height'
        if width <= 0 or height <= 0:
            return f'frame size {width}×{height} is not positive'
        if width * height > MAX_FRAME_PIXELS:
            return f'frame size {width}×{height} is larger than this bridge accepts'

        fmt = header.get('format', 'rgba')
        if fmt != 'rgba':
            return f'unsupported pixel format {fmt!r} — this bridge sends RGBA'
        return None

    def _record_frame_rate(self):
        now = time.time()
        if self.last_frame_time > 0:
            delta = now - self.last_frame_time
            if delta > 0:
                # Same smoothing as frame_stream_server, so the two report alike.
                self.fps = 0.9 * self.fps + 0.1 * (1.0 / delta)
        self.last_frame_time = now

    async def _handle_frame_payload(self, ws: web.WebSocketResponse, payload: bytes):
        """Pair an already-received header with its pixel bytes and publish them."""
        header = self.clients.get(ws)
        if not header:
            # Binary with no header before it. Ignore rather than guess a size.
            self.rejected_count += 1
            return
        self.clients[ws] = None

        width = header['width']
        height = header['height']
        expected = width * height * BYTES_PER_PIXEL
        if len(payload) != expected:
            self.rejected_count += 1
            logger.warning(
                f'Frame said {width}×{height} ({expected} bytes) but carried '
                f'{len(payload)} — dropped'
            )
            return

        self._record_frame_rate()
        self.frame_count += 1
        self.output.send(payload, width, height)

    async def _handle_text(self, ws: web.WebSocketResponse, raw: str):
        """
        Handle a JSON message from the editor.

        Two kinds arrive: a header announcing the frame in the next binary
        message, and the small set of settings the editor is allowed to change.
        Anything else is ignored — this socket is reachable from a webview, so
        it accepts a fixed vocabulary rather than anything that parses.
        """
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return

        kind = data.get('type')

        if kind == 'frame':
            problem = self._validate_header(data)
            if problem:
                self.rejected_count += 1
                self.clients[ws] = None
                await self._send_json(ws, {'type': 'error', 'message': problem})
                return
            self.clients[ws] = data
            return

        if kind == 'set_source_name':
            self.output.set_source_name(str(data.get('name', '')))
            await self._broadcast_status()
            return

        if kind == 'set_frame_rate':
            try:
                self.output.set_frame_rate(int(data.get('fps')))
            except (TypeError, ValueError):
                return
            await self._broadcast_status()
            return

        if kind == 'ping':
            await self._send_json(ws, {'type': 'pong', 'timestamp': time.time()})

    async def _send_json(self, ws: web.WebSocketResponse, payload: Dict):
        if ws.closed:
            return
        try:
            await ws.send_json(payload)
        except Exception as exc:  # noqa: BLE001
            logger.debug(f'Could not write to a client: {exc}')

    async def _broadcast_status(self):
        payload = {'type': 'status', **self.output.status()}
        for ws in list(self.clients):
            await self._send_json(ws, payload)

    # ------------------------------------------------------------------
    # HTTP / WebSocket handlers
    # ------------------------------------------------------------------

    async def handle_websocket(self, request: web.Request):
        """
        Accept an editor connection.

        WebSockets are not subject to the same-origin policy, so the same origin
        check the OSC bridge makes applies here for the same reason — and more
        sharply, because this socket publishes whatever it is sent to every
        machine on the network. Requests carrying a browser Origin must name one
        the editor is served from; non-browser clients (no Origin header) are
        left alone so scripts and native tools still work.
        """
        origin = request.headers.get('Origin')
        if origin is not None and origin not in ALLOWED_ORIGINS:
            logger.warning(f'Rejected NDI bridge connection from origin {origin}')
            raise web.HTTPForbidden(text='origin not allowed')

        ws = web.WebSocketResponse(heartbeat=30.0, max_msg_size=0)
        await ws.prepare(request)

        self.clients[ws] = None
        client_id = id(ws)
        logger.info(f'Editor connected: {client_id} (total: {len(self.clients)})')

        await self._send_json(ws, {
            'type': 'welcome',
            'server_version': SERVER_VERSION,
            **self.output.status(),
        })

        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.BINARY:
                    await self._handle_frame_payload(ws, msg.data)
                elif msg.type == aiohttp.WSMsgType.TEXT:
                    await self._handle_text(ws, msg.data)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f'WebSocket error from {client_id}: {ws.exception()}')
        except asyncio.CancelledError:
            raise
        finally:
            self.clients.pop(ws, None)
            # The source stops when the last editor goes, so a closed tab does
            # not leave a frozen frame published on the network all night.
            if not self.clients:
                self.output.close()
            logger.info(
                f'Editor disconnected: {client_id} (remaining: {len(self.clients)})'
            )

        return ws

    async def handle_index(self, request: web.Request):
        status = self.output.status()
        state = (
            f'Publishing as <code>{status["source_name"]}</code>'
            if status['ndi_available']
            else f'<strong>NDI unavailable</strong> — {status["ndi_error"]}'
        )
        html = f"""
        <html>
        <head><title>NDI Bridge</title></head>
        <body>
            <h1>NDI Bridge</h1>
            <p>Status: <strong>Running</strong></p>
            <p>{state}</p>
            <p>WebSocket: <code>ws://{self.ws_host}:{self.ws_port}/ws</code></p>
            <p>Connected editors: <strong>{len(self.clients)}</strong></p>
            <p>Frames received: <strong>{self.frame_count}</strong></p>
            <p>FPS: <strong>{self.fps:.1f}</strong></p>
            <hr>
            <p><a href="/stats">View Stats (JSON)</a></p>
        </body>
        </html>
        """
        return web.Response(text=html, content_type='text/html')

    async def handle_health(self, request: web.Request):
        return web.json_response({
            'status': 'ok',
            'service': 'ndi_bridge_server',
            'version': SERVER_VERSION,
            'clients': len(self.clients),
            'ndi_available': self.output.available,
        })

    async def handle_stats(self, request: web.Request):
        return web.json_response({
            'clients': len(self.clients),
            'frame_count': self.frame_count,
            'rejected_count': self.rejected_count,
            'frames_sent': self.output.frames_sent,
            'frames_dropped': self.output.frames_dropped,
            'fps': round(self.fps, 2),
            'seconds_since_last_frame': (
                time.time() - self.last_frame_time if self.last_frame_time else None
            ),
            'uptime': time.time() - self.started_at if self.started_at else 0,
            **self.output.status(),
        })


_server: Optional[NDIBridgeServer] = None


def get_server(**kwargs) -> NDIBridgeServer:
    """Get (or create) the process-wide bridge instance."""
    global _server
    if _server is None:
        _server = NDIBridgeServer(**kwargs)
    return _server


async def _run(args):
    server = get_server(
        ws_host=args.ws_host,
        ws_port=args.ws_port,
        source_name=args.source_name,
        frame_rate=args.frame_rate,
    )
    await server.start()
    try:
        await asyncio.Event().wait()
    finally:
        await server.stop()


def main():
    parser = argparse.ArgumentParser(description='Editor → NDI bridge')
    parser.add_argument('--ws-host', default=DEFAULT_WS_HOST,
                        help='interface for the WebSocket server (default: loopback)')
    parser.add_argument('--ws-port', type=int, default=DEFAULT_WS_PORT,
                        help=f'WebSocket port (default: {DEFAULT_WS_PORT})')
    parser.add_argument('--source-name', default=DEFAULT_SOURCE_NAME,
                        help='name receivers see on the network '
                             f'(default: {DEFAULT_SOURCE_NAME})')
    parser.add_argument('--frame-rate', type=int, default=DEFAULT_FRAME_RATE,
                        help=f'frame rate to advertise (default: {DEFAULT_FRAME_RATE})')
    args = parser.parse_args()

    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        print('\nNDI bridge stopped')


if __name__ == '__main__':
    main()
