#!/usr/bin/env python3
"""
Video In Bridge — outside visuals → editor

The reverse of ndi_bridge_server.py. Other software (TouchDesigner, Resolume,
OBS, a camera rig, a Python script) produces frames; this bridge collects them
and hands them to the editor over a loopback WebSocket, where a Live Input node
samples them like any other texture.

Frames can arrive two ways, and the editor does not care which:

1. **NDI.** Any NDI source on the network — TouchDesigner's NDI Out TOP, OBS,
   Resolume, a vision mixer. Needs the NDI runtime and `pip install cyndilib`,
   exactly like NDI output. Without them the bridge still runs and says why
   NDI is unavailable.

2. **Push.** Anything that can open a WebSocket or make an HTTP request sends
   frames straight to the bridge under a stream name it chooses. No extra
   dependencies, so it works on any machine — including from a TouchDesigner
   WebSocket DAT or Web Client DAT, see docs/external-input.md.

       ws://127.0.0.1:8769/publish/<name>   binary JPEG/PNG per message, or a
                                             JSON header then raw RGBA bytes
       ws://127.0.0.1:8769/                 the same, naming the stream with a
                                             first {"type": "hello", "name": ...}
       POST http://127.0.0.1:8769/publish/<name>   body: one JPEG/PNG frame

Protocol (bridge ↔ editor, ws://127.0.0.1:8769/ws):
- On connect the bridge sends {"type": "welcome", ...} with whether NDI works
  here and which sources it can see.
- The editor sends {"type": "subscribe", "source": "<name>"} and
  {"type": "unsubscribe", "source": "<name>"}. A name matches a pushed stream
  exactly, or an NDI source by its full name or by the part in brackets —
  "TouchDesigner" finds "STUDIO-PC (TouchDesigner)".
- Each frame is two messages, in order: a JSON header
  {"type": "frame", "source": "<name as subscribed>", "width": W,
  "height": H, "format": "rgba" | "jpeg" | "png"} followed by the bytes as one
  binary message — the same header/payload shape the NDI and frame-stream
  bridges use.
- {"type": "sources", "sources": [...]} is sent whenever the list changes.

Only the newest frame of each source is ever delivered. A client that falls
behind skips frames instead of queueing them: late video is worse than missing
video on a live input.

Running it:
    python3 video_in_bridge_server.py
"""

import argparse
import asyncio
import json
import logging
import threading
import time
from typing import Dict, List, Optional, Set

import aiohttp
from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('VideoInBridgeServer')

# Origins the editor is served from. Kept in step with ALLOWED_ORIGINS in
# rhizo_server.py, frame_stream_server.py, osc_bridge_server.py and
# ndi_bridge_server.py.
ALLOWED_ORIGINS = frozenset({
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",  # vite dev server
    "http://localhost:5173",
})

DEFAULT_WS_HOST = '127.0.0.1'
DEFAULT_WS_PORT = 8769  # one past the NDI output bridge on 8768
DEFAULT_MAX_FPS = 60

SERVER_VERSION = '1.0.0'

BYTES_PER_PIXEL = 4

# Same ceiling as the NDI output bridge: a frame header names the allocation,
# so it needs a limit even on a loopback socket.
MAX_FRAME_PIXELS = 8192 * 8192

# An encoded frame has no header to bound it, so bound the message instead.
MAX_ENCODED_BYTES = 64 * 1024 * 1024

# Stream names travel in URLs and JSON and are shown to the artist. Keep them
# short and printable.
MAX_STREAM_NAME = 128

# How often to re-scan the network for NDI sources.
NDI_DISCOVERY_SECONDS = 2.0

# A pushed stream that has gone quiet this long is dropped from the list, so a
# closed TouchDesigner project does not linger as a source forever.
STREAM_EXPIRY_SECONDS = 10.0

JPEG_MAGIC = b'\xff\xd8\xff'
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def sniff_image_format(data: bytes) -> Optional[str]:
    """Name the encoding of a pushed image, or None if it is not one we pass on."""
    if data.startswith(JPEG_MAGIC):
        return 'jpeg'
    if data.startswith(PNG_MAGIC):
        return 'png'
    return None


def clean_stream_name(name) -> Optional[str]:
    """A usable stream name, or None. Whitespace-trimmed, length-capped, no control chars."""
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not name or len(name) > MAX_STREAM_NAME:
        return None
    if any(ord(ch) < 32 for ch in name):
        return None
    return name


def ndi_short_name(full_name: str) -> str:
    """
    The part of an NDI name an artist recognises.

    NDI names are "MACHINE (Source)". People think of the source as
    "TouchDesigner", not "STUDIO-PC (TouchDesigner)", so that is what a
    subscription may use.
    """
    if full_name.endswith(')') and '(' in full_name:
        return full_name[full_name.rindex('(') + 1:-1].strip()
    return full_name


def validate_raw_header(header) -> Optional[str]:
    """Check a raw-RGBA frame header, returning the reason it is unusable, or None."""
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
        return f'unsupported raw pixel format {fmt!r} — send RGBA, or a JPEG/PNG'
    return None


class Frame:
    """One frame of one source: what the editor needs to put it on the GPU."""

    __slots__ = ('width', 'height', 'format', 'data', 'seq')

    def __init__(self, width: int, height: int, fmt: str, data: bytes, seq: int):
        self.width = width
        self.height = height
        self.format = fmt
        self.data = data
        self.seq = seq


class SourceRegistry:
    """
    The newest frame of every source, and who wants which.

    Lives on the event loop thread. NDI receive threads hand frames in through
    `loop.call_soon_threadsafe(registry.put, ...)`, so nothing here is locked.
    """

    def __init__(self):
        self._frames: Dict[str, Frame] = {}
        self._last_seen: Dict[str, float] = {}
        self._seq = 0
        self._listeners: Set[asyncio.Event] = set()
        self.frames_in = 0

    def put(self, key: str, width: int, height: int, fmt: str, data: bytes):
        self._seq += 1
        self.frames_in += 1
        self._frames[key] = Frame(width, height, fmt, data, self._seq)
        self._last_seen[key] = time.time()
        for event in self._listeners:
            event.set()

    def get(self, key: str) -> Optional[Frame]:
        return self._frames.get(key)

    def drop(self, key: str):
        self._frames.pop(key, None)
        self._last_seen.pop(key, None)

    def keys(self) -> List[str]:
        return list(self._frames)

    def expire(self, prefix: str, max_age: float) -> bool:
        """Forget sources under `prefix` that have gone quiet. Returns whether any went."""
        now = time.time()
        stale = [k for k, t in self._last_seen.items()
                 if k.startswith(prefix) and now - t > max_age]
        for key in stale:
            self.drop(key)
        return bool(stale)

    def poke(self):
        """Wake every listener without a new frame, e.g. so a fresh subscriber gets the current one."""
        for event in self._listeners:
            event.set()

    def listen(self) -> asyncio.Event:
        event = asyncio.Event()
        self._listeners.add(event)
        return event

    def unlisten(self, event: asyncio.Event):
        self._listeners.discard(event)


def _import_error_hint(exc: BaseException) -> str:
    """Same wording as the NDI output bridge, so both say the same thing."""
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


class _NDIReceiveThread(threading.Thread):
    """
    Pulls frames from one NDI source and posts the newest to the event loop.

    A FrameSync capture always returns the most recent frame without blocking,
    which is the behaviour a live input wants; the timestamp tells a new frame
    from a repeat of the last one, so an idle source costs no bandwidth.
    """

    def __init__(self, full_name: str, on_frame, max_fps: int):
        super().__init__(daemon=True, name=f'ndi-recv:{full_name}')
        self.full_name = full_name
        self.on_frame = on_frame
        self.interval = 1.0 / max(1, max_fps)
        self._stop = threading.Event()
        self.error: Optional[str] = None

    def stop(self):
        self._stop.set()

    def run(self):
        try:
            from cyndilib.finder import Finder
            from cyndilib.receiver import Receiver
            from cyndilib.video_frame import VideoFrameSync
            from cyndilib.wrapper.ndi_recv import RecvColorFormat, RecvBandwidth
            from cyndilib.wrapper.ndi_structs import FourCC
        except BaseException as exc:  # noqa: BLE001 - a native load can raise anything
            self.error = _import_error_hint(exc)
            return

        receiver = None
        finder = None
        try:
            receiver = Receiver(
                color_format=RecvColorFormat.RGBX_RGBA,
                bandwidth=RecvBandwidth.highest,
                recv_name='Rhizomium Live Input',
            )
            video_frame = VideoFrameSync()
            receiver.frame_sync.set_video_frame(video_frame)

            finder = Finder()
            finder.open()
            source = None
            while source is None and not self._stop.is_set():
                finder.wait_for_sources(1.0)
                finder.update_sources()
                if self.full_name in finder.get_source_names():
                    source = finder.get_source(self.full_name)
            if source is None:
                return
            receiver.set_source(source)
            logger.info(f'Receiving NDI source "{self.full_name}"')

            last_stamp = None
            while not self._stop.is_set():
                started = time.time()
                if receiver.is_connected():
                    receiver.frame_sync.capture_video()
                    width, height = video_frame.xres, video_frame.yres
                    stamp = video_frame.get_timestamp_posix()
                    if width > 0 and height > 0 and stamp != last_stamp:
                        last_stamp = stamp
                        data = self._pixels(video_frame, width, height,
                                            video_frame.get_fourcc() == FourCC.RGBX)
                        if data is not None:
                            self.on_frame(width, height, data)
                remaining = self.interval - (time.time() - started)
                self._stop.wait(max(0.0, remaining))
        except BaseException as exc:  # noqa: BLE001
            self.error = f'NDI receive failed: {exc}'
            logger.error(f'NDI receive for "{self.full_name}" stopped: {exc}')
        finally:
            for closeable in (receiver, finder):
                if closeable is None:
                    continue
                try:
                    (closeable.disconnect if closeable is receiver else closeable.close)()
                except BaseException:  # noqa: BLE001
                    pass

    @staticmethod
    def _pixels(video_frame, width: int, height: int, opaque: bool) -> Optional[bytes]:
        """Tightly packed RGBA bytes for one captured frame."""
        try:
            import numpy as np
            flat = np.frombuffer(memoryview(video_frame), dtype=np.uint8)
            stride = video_frame.get_line_stride() or width * BYTES_PER_PIXEL
            if flat.size < stride * height:
                return None
            rows = flat[:stride * height].reshape(height, stride)[:, :width * BYTES_PER_PIXEL]
            pixels = np.ascontiguousarray(rows).reshape(height, width, BYTES_PER_PIXEL)
            if opaque:
                # RGBX: the fourth byte is padding, not alpha. Treat it as opaque
                # rather than trusting whatever the sender left there.
                pixels = pixels.copy()
                pixels[:, :, 3] = 255
            return pixels.tobytes()
        except BaseException as exc:  # noqa: BLE001
            logger.debug(f'Could not read an NDI frame: {exc}')
            return None


class NDIInput:
    """
    Discovery and per-source receivers.

    As on the output side, everything that touches cyndilib lives in one class
    and an unavailable binding is an ordinary state, not an exception.
    """

    def __init__(self, on_frame, max_fps: int = DEFAULT_MAX_FPS):
        self.on_frame = on_frame  # (full_name, width, height, data), called from threads
        self.max_fps = max_fps
        self.available = False
        self.error: Optional[str] = None
        self.sources: List[str] = []
        self._finder = None
        self._receivers: Dict[str, _NDIReceiveThread] = {}
        self._probe()

    def _probe(self):
        try:
            import cyndilib  # noqa: F401
            self.available = True
            self.error = None
        except BaseException as exc:  # noqa: BLE001
            self.available = False
            self.error = _import_error_hint(exc)
            logger.warning(self.error)

    def discover(self) -> bool:
        """Refresh the source list. Blocking; run it off the event loop. Returns whether it changed."""
        if not self.available:
            return False
        try:
            if self._finder is None:
                from cyndilib.finder import Finder
                self._finder = Finder()
                self._finder.open()
            self._finder.update_sources()
            names = sorted(self._finder.get_source_names())
        except BaseException as exc:  # noqa: BLE001
            self.available = False
            self.error = _import_error_hint(exc)
            logger.error(f'NDI discovery failed: {exc}')
            return False
        changed = names != self.sources
        self.sources = names
        return changed

    def resolve(self, wanted: str) -> Optional[str]:
        """The full NDI name a subscription means, or None."""
        lowered = wanted.lower()
        for name in self.sources:
            if name == wanted:
                return name
        for name in self.sources:
            if ndi_short_name(name).lower() == lowered:
                return name
        for name in self.sources:
            if lowered in name.lower():
                return name
        return None

    def start(self, full_name: str):
        if not self.available or full_name in self._receivers:
            return
        thread = _NDIReceiveThread(
            full_name,
            lambda w, h, data: self.on_frame(full_name, w, h, data),
            self.max_fps,
        )
        self._receivers[full_name] = thread
        thread.start()

    def stop(self, full_name: str):
        thread = self._receivers.pop(full_name, None)
        if thread:
            thread.stop()

    def receiving(self) -> List[str]:
        return list(self._receivers)

    def close(self):
        for name in list(self._receivers):
            self.stop(name)
        finder, self._finder = self._finder, None
        if finder is not None:
            try:
                finder.close()
            except BaseException:  # noqa: BLE001
                pass

    def status(self) -> Dict:
        return {
            'ndi_available': self.available,
            'ndi_error': self.error,
        }


class VideoInBridgeServer:
    """Collects frames from NDI and from pushing clients, and serves them to editors."""

    def __init__(self, ws_host: str = DEFAULT_WS_HOST, ws_port: int = DEFAULT_WS_PORT,
                 max_fps: int = DEFAULT_MAX_FPS, enable_ndi: bool = True):
        self.ws_host = ws_host
        self.ws_port = ws_port
        self.max_fps = max_fps

        self.app = web.Application(client_max_size=MAX_ENCODED_BYTES)
        self.runner: Optional[web.AppRunner] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None

        self.registry = SourceRegistry()
        self.ndi: Optional[NDIInput] = (
            NDIInput(self._on_ndi_frame_threadsafe, max_fps) if enable_ndi else None
        )

        # editor socket -> set of names it subscribed to
        self.editors: Dict[web.WebSocketResponse, Set[str]] = {}
        # pushing sockets, for /stats
        self.publishers: Dict[web.WebSocketResponse, str] = {}

        self.rejected_count = 0
        self.started_at = 0.0
        self._discovery_task: Optional[asyncio.Task] = None

        self._setup_routes()

    def _setup_routes(self):
        self.app.router.add_get('/', self.handle_index)
        self.app.router.add_get('/ws', self.handle_editor)
        self.app.router.add_get('/publish', self.handle_publish_ws)
        self.app.router.add_get('/publish/{name}', self.handle_publish_ws)
        self.app.router.add_post('/publish/{name}', self.handle_publish_post)
        self.app.router.add_get('/health', self.handle_health)
        self.app.router.add_get('/stats', self.handle_stats)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        self.loop = asyncio.get_running_loop()
        self.started_at = time.time()
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, self.ws_host, self.ws_port)
        await site.start()
        self._discovery_task = asyncio.create_task(self._discovery_loop())

        logger.info(f'Video In bridge for the editor at ws://{self.ws_host}:{self.ws_port}/ws')
        logger.info(f'Push frames to ws://{self.ws_host}:{self.ws_port}/publish/<name>')
        if self.ndi and self.ndi.available:
            logger.info('NDI input available — NDI sources on the network can be subscribed to')
        elif self.ndi:
            logger.warning('Running without NDI input — ' + (self.ndi.error or ''))

    async def stop(self):
        if self._discovery_task:
            self._discovery_task.cancel()
            self._discovery_task = None
        for ws in list(self.editors) + list(self.publishers):
            await ws.close()
        self.editors.clear()
        self.publishers.clear()
        if self.ndi:
            self.ndi.close()
        if self.runner:
            await self.runner.cleanup()
            self.runner = None
        logger.info('Video In bridge stopped')

    async def _discovery_loop(self):
        while True:
            changed = self.registry.expire('stream:', STREAM_EXPIRY_SECONDS)
            if self.ndi and self.ndi.available and self.editors:
                ndi_changed = await asyncio.get_running_loop().run_in_executor(
                    None, self.ndi.discover)
                changed = changed or ndi_changed
                self._sync_ndi_receivers()
            if changed:
                await self._broadcast_sources()
            await asyncio.sleep(NDI_DISCOVERY_SECONDS)

    # ------------------------------------------------------------------
    # Sources
    # ------------------------------------------------------------------

    def _on_ndi_frame_threadsafe(self, full_name: str, width: int, height: int, data: bytes):
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self.registry.put, f'ndi:{full_name}', width, height, 'rgba', data)

    def list_sources(self) -> List[Dict]:
        sources = []
        for key in sorted(self.registry.keys()):
            if key.startswith('stream:'):
                sources.append({'name': key[len('stream:'):], 'kind': 'stream'})
        if self.ndi:
            for name in self.ndi.sources:
                sources.append({'name': name, 'short_name': ndi_short_name(name), 'kind': 'ndi'})
        return sources

    def resolve(self, wanted: str) -> Optional[str]:
        """The registry key a subscription name means right now. Pushed streams win."""
        if f'stream:{wanted}' in self.registry.keys():
            return f'stream:{wanted}'
        lowered = wanted.lower()
        for key in self.registry.keys():
            if key.startswith('stream:') and key[len('stream:'):].lower() == lowered:
                return key
        if self.ndi:
            full = self.ndi.resolve(wanted)
            if full:
                return f'ndi:{full}'
        return None

    def _sync_ndi_receivers(self):
        """Run exactly the NDI receivers some editor is subscribed to."""
        if not self.ndi or not self.ndi.available:
            return
        wanted = set()
        for names in self.editors.values():
            for name in names:
                key = self.resolve(name)
                if key and key.startswith('ndi:'):
                    wanted.add(key[len('ndi:'):])
        for name in self.ndi.receiving():
            if name not in wanted:
                self.ndi.stop(name)
                self.registry.drop(f'ndi:{name}')
        for name in wanted:
            self.ndi.start(name)

    # ------------------------------------------------------------------
    # Editor side
    # ------------------------------------------------------------------

    async def _send_json(self, ws: web.WebSocketResponse, payload: Dict) -> bool:
        if ws.closed:
            return False
        try:
            await ws.send_json(payload)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.debug(f'Could not write to a client: {exc}')
            return False

    async def _broadcast_sources(self):
        payload = {'type': 'sources', 'sources': self.list_sources(), **self._ndi_status()}
        for ws in list(self.editors):
            await self._send_json(ws, payload)

    def _ndi_status(self) -> Dict:
        if self.ndi:
            return self.ndi.status()
        return {'ndi_available': False, 'ndi_error': 'NDI input is disabled on this bridge'}

    def _check_origin(self, request: web.Request, what: str):
        """
        Same rule as the other bridges: a browser Origin must be one the editor
        is served from; clients without one (TouchDesigner, scripts) pass.
        """
        origin = request.headers.get('Origin')
        if origin is not None and origin not in ALLOWED_ORIGINS:
            logger.warning(f'Rejected {what} from origin {origin}')
            raise web.HTTPForbidden(text='origin not allowed')

    async def _pump_frames(self, ws: web.WebSocketResponse, subscriptions: Set[str]):
        """Deliver the newest frame of each subscribed source, skipping any this client missed."""
        sent: Dict[str, int] = {}
        wake = self.registry.listen()
        try:
            while not ws.closed:
                await wake.wait()
                wake.clear()
                for name in list(subscriptions):
                    key = self.resolve(name)
                    frame = self.registry.get(key) if key else None
                    if frame is None or sent.get(name) == frame.seq:
                        continue
                    sent[name] = frame.seq
                    header = {
                        'type': 'frame',
                        'source': name,
                        'width': frame.width,
                        'height': frame.height,
                        'format': frame.format,
                    }
                    if not await self._send_json(ws, header):
                        return
                    try:
                        # Awaiting the send is the backpressure: while this
                        # frame drains, newer ones overwrite each other in the
                        # registry and only the latest is sent next.
                        await ws.send_bytes(frame.data)
                    except Exception:  # noqa: BLE001
                        return
        finally:
            self.registry.unlisten(wake)

    async def handle_editor(self, request: web.Request):
        self._check_origin(request, 'editor connection')

        ws = web.WebSocketResponse(heartbeat=30.0)
        await ws.prepare(request)

        subscriptions: Set[str] = set()
        self.editors[ws] = subscriptions
        logger.info(f'Editor connected: {id(ws)} (total: {len(self.editors)})')

        if self.ndi and self.ndi.available:
            await asyncio.get_running_loop().run_in_executor(None, self.ndi.discover)

        await self._send_json(ws, {
            'type': 'welcome',
            'server_version': SERVER_VERSION,
            'sources': self.list_sources(),
            **self._ndi_status(),
        })

        pump = asyncio.create_task(self._pump_frames(ws, subscriptions))
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    await self._handle_editor_text(ws, subscriptions, msg.data)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f'WebSocket error from {id(ws)}: {ws.exception()}')
        except asyncio.CancelledError:
            raise
        finally:
            pump.cancel()
            self.editors.pop(ws, None)
            self._sync_ndi_receivers()
            logger.info(f'Editor disconnected: {id(ws)} (remaining: {len(self.editors)})')
        return ws

    async def _handle_editor_text(self, ws, subscriptions: Set[str], raw: str):
        """A fixed vocabulary, as on the other bridges: this socket is reachable from a webview."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return
        kind = data.get('type')

        if kind in ('subscribe', 'unsubscribe'):
            name = clean_stream_name(data.get('source'))
            if not name:
                return
            if kind == 'subscribe':
                subscriptions.add(name)
            else:
                subscriptions.discard(name)
            self._sync_ndi_receivers()
            # Hand over the frame already waiting, if any, rather than leaving a
            # still source black until it next changes.
            if kind == 'subscribe':
                self.registry.poke()
            return

        if kind == 'list_sources':
            await self._send_json(ws, {'type': 'sources', 'sources': self.list_sources(),
                                       **self._ndi_status()})
            return

        if kind == 'ping':
            await self._send_json(ws, {'type': 'pong', 'timestamp': time.time()})

    # ------------------------------------------------------------------
    # Publisher side
    # ------------------------------------------------------------------

    def _accept_encoded(self, name: str, data: bytes) -> Optional[str]:
        """Take one JPEG/PNG frame. Returns the reason it was refused, or None."""
        fmt = sniff_image_format(data)
        if fmt is None:
            return 'binary frames must be JPEG or PNG, or follow a raw RGBA frame header'
        if len(data) > MAX_ENCODED_BYTES:
            return 'frame is larger than this bridge accepts'
        # Dimensions are the editor's to discover when it decodes; 0 says so.
        is_new = f'stream:{name}' not in self.registry.keys()
        self.registry.put(f'stream:{name}', 0, 0, fmt, data)
        if is_new:
            asyncio.ensure_future(self._broadcast_sources())
        return None

    def _accept_raw(self, name: str, header: Dict, data: bytes) -> Optional[str]:
        width, height = header['width'], header['height']
        expected = width * height * BYTES_PER_PIXEL
        if len(data) != expected:
            return (f'frame said {width}×{height} ({expected} bytes) '
                    f'but carried {len(data)}')
        is_new = f'stream:{name}' not in self.registry.keys()
        self.registry.put(f'stream:{name}', width, height, 'rgba', data)
        if is_new:
            asyncio.ensure_future(self._broadcast_sources())
        return None

    async def handle_publish_ws(self, request: web.Request):
        """
        A client pushing frames. The stream name comes from the path, or — for clients that can
        only be given a host and port, like TouchDesigner's WebSocket DAT — from a first
        {"type": "hello", "name": "..."} message.
        """
        self._check_origin(request, 'publisher')
        raw_name = request.match_info.get('name')
        name = clean_stream_name(raw_name) if raw_name is not None else None
        if raw_name is not None and not name:
            raise web.HTTPBadRequest(text='invalid stream name')

        ws = web.WebSocketResponse(heartbeat=30.0, max_msg_size=MAX_FRAME_PIXELS * BYTES_PER_PIXEL)
        await ws.prepare(request)
        self.publishers[ws] = name or ''
        if name:
            logger.info(f'Publisher connected: stream "{name}"')

        pending_header: Optional[Dict] = None
        try:
            async for msg in ws:
                problem = None
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        header = json.loads(msg.data)
                    except json.JSONDecodeError:
                        header = None
                    if isinstance(header, dict) and header.get('type') == 'hello':
                        named = clean_stream_name(header.get('name'))
                        if named:
                            name = named
                            self.publishers[ws] = name
                            logger.info(f'Publisher connected: stream "{name}"')
                        else:
                            problem = 'hello needs a name'
                    elif not name:
                        problem = 'send {"type": "hello", "name": "..."} first'
                    elif isinstance(header, dict) and header.get('type') == 'frame':
                        problem = validate_raw_header(header)
                        pending_header = None if problem else header
                elif msg.type == aiohttp.WSMsgType.BINARY:
                    if not name:
                        problem = 'send {"type": "hello", "name": "..."} first'
                    elif pending_header is not None:
                        problem = self._accept_raw(name, pending_header, msg.data)
                        pending_header = None
                    else:
                        problem = self._accept_encoded(name, msg.data)
                if problem:
                    self.rejected_count += 1
                    await self._send_json(ws, {'type': 'error', 'message': problem})
        finally:
            self.publishers.pop(ws, None)
            if name:
                logger.info(f'Publisher disconnected: stream "{name}"')
        return ws

    async def handle_publish_post(self, request: web.Request):
        self._check_origin(request, 'publisher')
        name = clean_stream_name(request.match_info.get('name'))
        if not name:
            raise web.HTTPBadRequest(text='invalid stream name')
        data = await request.read()
        problem = self._accept_encoded(name, data)
        if problem:
            self.rejected_count += 1
            return web.json_response({'ok': False, 'error': problem}, status=400)
        return web.json_response({'ok': True})

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    async def handle_index(self, request: web.Request):
        # A WebSocket opened on the bare host and port is a publisher that could not be given a
        # path; it names itself with a hello message.
        if request.headers.get('Upgrade', '').lower() == 'websocket':
            return await self.handle_publish_ws(request)
        rows = ''.join(
            f'<li><code>{s["name"]}</code> ({s["kind"]})</li>' for s in self.list_sources()
        ) or '<li>none yet</li>'
        ndi = self._ndi_status()
        ndi_line = 'available' if ndi['ndi_available'] else f'unavailable — {ndi["ndi_error"]}'
        html = f"""
        <html>
        <head><title>Video In Bridge</title></head>
        <body>
            <h1>Video In Bridge</h1>
            <p>Status: <strong>Running</strong></p>
            <p>NDI input: {ndi_line}</p>
            <p>Editor socket: <code>ws://{self.ws_host}:{self.ws_port}/ws</code></p>
            <p>Push frames to: <code>ws://{self.ws_host}:{self.ws_port}/publish/&lt;name&gt;</code></p>
            <p>Connected editors: <strong>{len(self.editors)}</strong></p>
            <h2>Sources</h2>
            <ul>{rows}</ul>
            <hr>
            <p><a href="/stats">View Stats (JSON)</a></p>
        </body>
        </html>
        """
        return web.Response(text=html, content_type='text/html')

    async def handle_health(self, request: web.Request):
        return web.json_response({
            'status': 'ok',
            'service': 'video_in_bridge_server',
            'version': SERVER_VERSION,
            'editors': len(self.editors),
            **self._ndi_status(),
        })

    async def handle_stats(self, request: web.Request):
        return web.json_response({
            'editors': len(self.editors),
            'publishers': len(self.publishers),
            'frames_in': self.registry.frames_in,
            'rejected_count': self.rejected_count,
            'sources': self.list_sources(),
            'ndi_receiving': self.ndi.receiving() if self.ndi else [],
            'uptime': time.time() - self.started_at if self.started_at else 0,
            **self._ndi_status(),
        })


async def _run(args):
    server = VideoInBridgeServer(
        ws_host=args.ws_host,
        ws_port=args.ws_port,
        max_fps=args.max_fps,
        enable_ndi=not args.no_ndi,
    )
    await server.start()
    try:
        await asyncio.Event().wait()
    finally:
        await server.stop()


def main():
    parser = argparse.ArgumentParser(description='Outside visuals (NDI / pushed frames) → editor')
    parser.add_argument('--ws-host', default=DEFAULT_WS_HOST,
                        help='interface to listen on (default: loopback). Use 0.0.0.0 to '
                             'accept pushed frames from another machine')
    parser.add_argument('--ws-port', type=int, default=DEFAULT_WS_PORT,
                        help=f'port (default: {DEFAULT_WS_PORT})')
    parser.add_argument('--max-fps', type=int, default=DEFAULT_MAX_FPS,
                        help=f'highest rate to pull NDI frames at (default: {DEFAULT_MAX_FPS})')
    parser.add_argument('--no-ndi', action='store_true',
                        help='skip NDI discovery and accept pushed frames only')
    args = parser.parse_args()

    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        print('\nVideo In bridge stopped')


if __name__ == '__main__':
    main()
