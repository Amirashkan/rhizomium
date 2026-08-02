#!/usr/bin/env python3
"""
OSC → WebSocket Bridge

OSC is a UDP protocol and browsers cannot open UDP sockets, so the editor can
never hear an OSC sender directly. This bridge owns the UDP socket and forwards
each datagram, byte for byte, to the editor over a WebSocket.

Forwarding raw packets rather than a JSON rendering of them keeps the decoding
in one place (src/osc/OSCDecoder.js) and means any OSC source — TouchOSC, Max,
SuperCollider, Resolume, a Python script — works without agreeing on a private
envelope first.

Protocol:
- On connect the bridge sends one JSON message: {"type": "welcome", ...},
  which tells the editor which UDP port to advertise to the artist.
- Every OSC datagram after that is forwarded as a binary WebSocket frame.
"""

import argparse
import asyncio
import json
import logging
import time
from typing import Dict, Optional, Set

import aiohttp
from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('OSCBridgeServer')

# Origins the editor is served from. Kept in step with ALLOWED_ORIGINS in
# rhizo_server.py and frame_stream_server.py.
ALLOWED_ORIGINS = frozenset({
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",  # vite dev server
    "http://localhost:5173",
})

DEFAULT_WS_HOST = '127.0.0.1'
DEFAULT_WS_PORT = 8767
DEFAULT_UDP_HOST = '0.0.0.0'
DEFAULT_UDP_PORT = 9000

# Per-client send queue depth. An OSC sender can burst far faster than a
# WebSocket drains, and control data is only worth delivering while it is
# current, so a backed-up client drops its oldest packets instead of stalling
# the UDP receiver or growing without bound.
CLIENT_QUEUE_SIZE = 256

SERVER_VERSION = '1.0.0'


def parse_osc_address(packet: bytes) -> Optional[str]:
    """
    Best-effort read of the leading OSC address, for logs and /stats only.

    The editor does the real decoding; this just needs enough to say what is
    arriving, so anything malformed returns None rather than raising.
    """
    if not packet:
        return None
    try:
        end = packet.index(b'\x00')
    except ValueError:
        return None

    try:
        address = packet[:end].decode('utf-8')
    except UnicodeDecodeError:
        return None

    if address == '#bundle':
        return '#bundle'
    return address if address.startswith('/') else None


class _OSCDatagramProtocol(asyncio.DatagramProtocol):
    """Hands each received datagram to the bridge."""

    def __init__(self, on_packet):
        self.on_packet = on_packet

    def datagram_received(self, data: bytes, addr):
        self.on_packet(data, addr)

    def error_received(self, exc):
        logger.warning(f'UDP error: {exc}')


class OSCBridgeServer:
    """
    Receives OSC on a UDP port and fans each packet out to WebSocket clients.

    The UDP side defaults to all interfaces because controlling the editor from
    a phone or tablet running TouchOSC is the point of the feature. The
    WebSocket side defaults to loopback: only the editor on this machine should
    be able to read the stream.
    """

    def __init__(
        self,
        ws_host: str = DEFAULT_WS_HOST,
        ws_port: int = DEFAULT_WS_PORT,
        udp_host: str = DEFAULT_UDP_HOST,
        udp_port: int = DEFAULT_UDP_PORT,
    ):
        self.ws_host = ws_host
        self.ws_port = ws_port
        self.udp_host = udp_host
        self.udp_port = udp_port

        self.app = web.Application()
        self.runner: Optional[web.AppRunner] = None
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None

        # Why the UDP socket is not open, if it is not. Reported to the editor
        # so the panel can name the real problem instead of guessing.
        self.udp_error: Optional[str] = None

        # Each client gets its own bounded queue and a task draining it.
        self.clients: Dict[web.WebSocketResponse, asyncio.Queue] = {}
        self._writer_tasks: Set[asyncio.Task] = set()

        # Stats
        self.packet_count = 0
        self.dropped_count = 0
        self.last_packet_time = 0.0
        self.last_address: Optional[str] = None
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
        """
        Start the WebSocket server, then open the UDP socket.

        A UDP bind failure is kept non-fatal on purpose. The usual cause is
        another OSC application already holding the port, and if that took the
        WebSocket down with it the editor would report "could not reach the
        bridge" — pointing at the wrong end of the problem entirely. Instead the
        bridge stays up and hands the editor the real reason, which it can show
        the artist.
        """
        self.loop = asyncio.get_running_loop()
        self.started_at = time.time()

        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, self.ws_host, self.ws_port)
        await site.start()

        logger.info(f'OSC bridge WebSocket at ws://{self.ws_host}:{self.ws_port}/ws')

        await self.bind_udp()

    async def bind_udp(self):
        """
        Open the UDP socket, recording rather than raising a bind failure.

        @returns True when listening, False when the port could not be bound.
        """
        if self.transport:
            return True

        try:
            self.transport, _ = await self.loop.create_datagram_endpoint(
                lambda: _OSCDatagramProtocol(self._handle_packet),
                local_addr=(self.udp_host, self.udp_port),
                reuse_port=False,
            )
        except OSError as exc:
            self.udp_error = (
                f'Could not listen on UDP {self.udp_host}:{self.udp_port} — {exc.strerror or exc}. '
                f'Another application is probably using that port.'
            )
            logger.error(self.udp_error)
            return False

        self.udp_error = None
        logger.info(f'OSC bridge listening for OSC on UDP {self.udp_host}:{self.udp_port}')
        return True

    async def stop(self):
        """Close the UDP socket and disconnect every client."""
        if self.transport:
            self.transport.close()
            self.transport = None

        for task in list(self._writer_tasks):
            task.cancel()
        self._writer_tasks.clear()

        for ws in list(self.clients):
            await ws.close()
        self.clients.clear()

        if self.runner:
            await self.runner.cleanup()
            self.runner = None

        logger.info('OSC bridge stopped')

    # ------------------------------------------------------------------
    # UDP → clients
    # ------------------------------------------------------------------

    def _handle_packet(self, data: bytes, addr):
        """
        Called on the event loop for every datagram.

        Stays synchronous and non-blocking: it only enqueues, so a slow or stuck
        WebSocket client can never apply backpressure to the UDP socket.
        """
        self.packet_count += 1
        self.last_packet_time = time.time()

        address = parse_osc_address(data)
        if address:
            self.last_address = address

        for queue in self.clients.values():
            if queue.full():
                # Drop the oldest packet: for control data the newest reading is
                # the only one that matters.
                try:
                    queue.get_nowait()
                    self.dropped_count += 1
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(data)
            except asyncio.QueueFull:
                self.dropped_count += 1

    async def _client_writer(self, ws: web.WebSocketResponse, queue: asyncio.Queue):
        """Drain one client's queue onto its socket."""
        try:
            while True:
                packet = await queue.get()
                if ws.closed:
                    return
                await ws.send_bytes(packet)
        except asyncio.CancelledError:
            raise
        except (ConnectionResetError, aiohttp.ClientError) as exc:
            logger.debug(f'Client write failed, dropping connection: {exc}')
        except Exception as exc:
            logger.warning(f'Unexpected client write error: {exc}')

    # ------------------------------------------------------------------
    # HTTP / WebSocket handlers
    # ------------------------------------------------------------------

    async def handle_websocket(self, request: web.Request):
        """
        Accept an editor connection.

        WebSockets are not subject to the same-origin policy, so any page in the
        user's browser could otherwise open this socket and watch their control
        surface. Requests carrying a browser Origin must therefore name one of
        the origins the editor is served from; non-browser clients (no Origin
        header) are left alone so scripts and native viewers still work.
        """
        origin = request.headers.get('Origin')
        if origin is not None and origin not in ALLOWED_ORIGINS:
            logger.warning(f'Rejected OSC bridge connection from origin {origin}')
            raise web.HTTPForbidden(text='origin not allowed')

        ws = web.WebSocketResponse(heartbeat=30.0)
        await ws.prepare(request)

        queue: asyncio.Queue = asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE)
        self.clients[ws] = queue

        writer = asyncio.create_task(self._client_writer(ws, queue))
        self._writer_tasks.add(writer)

        client_id = id(ws)
        logger.info(f'Editor connected: {client_id} (total: {len(self.clients)})')

        await ws.send_json({
            'type': 'welcome',
            'server_version': SERVER_VERSION,
            'udp_host': self.udp_host,
            'udp_port': self.udp_port,
            'udp_listening': self.transport is not None,
            'udp_error': self.udp_error,
        })

        try:
            # Nothing is expected from the editor; the loop just keeps the
            # connection open until it closes.
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f'WebSocket error from {client_id}: {ws.exception()}')
        except asyncio.CancelledError:
            raise
        finally:
            self.clients.pop(ws, None)
            writer.cancel()
            self._writer_tasks.discard(writer)
            logger.info(f'Editor disconnected: {client_id} (remaining: {len(self.clients)})')

        return ws

    async def handle_index(self, request: web.Request):
        html = f"""
        <html>
        <head><title>OSC Bridge</title></head>
        <body>
            <h1>OSC Bridge</h1>
            <p>Status: <strong>Running</strong></p>
            <p>OSC input: <code>udp://{self.udp_host}:{self.udp_port}</code></p>
            <p>WebSocket: <code>ws://{self.ws_host}:{self.ws_port}/ws</code></p>
            <p>Connected editors: <strong>{len(self.clients)}</strong></p>
            <p>Packets received: <strong>{self.packet_count}</strong></p>
            <hr>
            <p><a href="/stats">View Stats (JSON)</a></p>
        </body>
        </html>
        """
        return web.Response(text=html, content_type='text/html')

    async def handle_health(self, request: web.Request):
        return web.json_response({
            'status': 'ok',
            'service': 'osc_bridge_server',
            'version': SERVER_VERSION,
            'clients': len(self.clients),
        })

    async def handle_stats(self, request: web.Request):
        return web.json_response({
            'clients': len(self.clients),
            'packet_count': self.packet_count,
            'dropped_count': self.dropped_count,
            'last_address': self.last_address,
            'seconds_since_last_packet': (
                time.time() - self.last_packet_time if self.last_packet_time else None
            ),
            'uptime': time.time() - self.started_at if self.started_at else 0,
            'udp_host': self.udp_host,
            'udp_port': self.udp_port,
            'udp_listening': self.transport is not None,
            'udp_error': self.udp_error,
        })


_server: Optional[OSCBridgeServer] = None


def get_server(**kwargs) -> OSCBridgeServer:
    """Get (or create) the process-wide bridge instance."""
    global _server
    if _server is None:
        _server = OSCBridgeServer(**kwargs)
    return _server


async def _run(args):
    server = get_server(
        ws_host=args.ws_host,
        ws_port=args.ws_port,
        udp_host=args.udp_host,
        udp_port=args.udp_port,
    )
    await server.start()
    try:
        await asyncio.Event().wait()
    finally:
        await server.stop()


def main():
    parser = argparse.ArgumentParser(description='OSC → WebSocket bridge')
    parser.add_argument('--udp-host', default=DEFAULT_UDP_HOST,
                        help='interface to receive OSC on (default: all)')
    parser.add_argument('--udp-port', type=int, default=DEFAULT_UDP_PORT,
                        help=f'UDP port to receive OSC on (default: {DEFAULT_UDP_PORT})')
    parser.add_argument('--ws-host', default=DEFAULT_WS_HOST,
                        help='interface for the WebSocket server (default: loopback)')
    parser.add_argument('--ws-port', type=int, default=DEFAULT_WS_PORT,
                        help=f'WebSocket port (default: {DEFAULT_WS_PORT})')
    args = parser.parse_args()

    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        print('\nOSC bridge stopped')


if __name__ == '__main__':
    main()
