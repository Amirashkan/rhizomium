#!/usr/bin/env python3
"""
WebSocket Frame Streaming Server for Dual-Screen System

Provides real-time video frame streaming over WebSocket to support:
- Remote viewers over network
- Multiple simultaneous viewers
- Browser-based and native Python viewers
- Cloud deployment compatibility

Protocol:
- JSON metadata message followed by binary frame data
- Supports RGB and RGBA formats
- Frame metadata includes: width, height, format, timestamp, fps
"""

import asyncio
import aiohttp
from aiohttp import web
import json
import logging
import time
from typing import Set, Dict, Optional
import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('FrameStreamServer')

# Origins the editor is served from. Kept in step with ALLOWED_ORIGINS in
# rhizo_server.py.
ALLOWED_ORIGINS = frozenset({
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",  # vite dev server
    "http://localhost:5173",
})


class FrameStreamServer:
    """
    WebSocket server for streaming video frames to multiple clients.

    Features:
    - Multiple concurrent viewer connections
    - Efficient binary frame transmission
    - Frame metadata (resolution, format, timing)
    - Connection state management
    - Performance monitoring
    """

    def __init__(self, host: str = '127.0.0.1', port: int = 8766):
        self.host = host
        self.port = port
        self.app = web.Application()
        self.viewers: Set[web.WebSocketResponse] = set()
        self.runner: Optional[web.AppRunner] = None

        # Frame statistics
        self.frame_count = 0
        self.last_frame_time = 0
        self.fps = 0.0
        self.last_fps_update = time.time()

        # Current frame buffer
        self.current_frame: Optional[bytes] = None
        self.current_metadata: Optional[Dict] = None

        # Setup routes
        self._setup_routes()

    def _setup_routes(self):
        """Configure HTTP and WebSocket routes"""
        self.app.router.add_get('/', self.handle_index)
        self.app.router.add_get('/ws', self.handle_websocket)
        self.app.router.add_get('/health', self.handle_health)
        self.app.router.add_get('/stats', self.handle_stats)
        self.app.router.add_post('/frame', self.handle_frame_upload)

        # Enable CORS
        self.app.middlewares.append(self._cors_middleware)

    @web.middleware
    async def _cors_middleware(self, request, handler):
        """Add CORS headers to all responses.

        This stream carries whatever the artist is rendering, and /frame lets a
        caller push frames to every connected viewer. '*' would put both on
        offer to any page in any browser on the machine, so the header is
        echoed back only for the origins the editor is served from.
        """
        if request.method == 'OPTIONS':
            response = web.Response()
        else:
            response = await handler(request)

        origin = request.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    async def handle_index(self, request):
        """Serve basic info page"""
        html = f"""
        <html>
        <head><title>Frame Stream Server</title></head>
        <body>
            <h1>Frame Stream Server</h1>
            <p>Status: <strong>Running</strong></p>
            <p>WebSocket URL: <code>ws://{self.host}:{self.port}/ws</code></p>
            <p>Connected Viewers: <strong>{len(self.viewers)}</strong></p>
            <p>FPS: <strong>{self.fps:.1f}</strong></p>
            <p>Frames Sent: <strong>{self.frame_count}</strong></p>
            <hr>
            <p><a href="/stats">View Stats (JSON)</a></p>
        </body>
        </html>
        """
        return web.Response(text=html, content_type='text/html')

    async def handle_health(self, request):
        """Health check endpoint"""
        return web.json_response({
            'status': 'ok',
            'service': 'frame_stream_server',
            'version': '1.0.0',
            'viewers': len(self.viewers)
        })

    async def handle_stats(self, request):
        """Server statistics endpoint"""
        return web.json_response({
            'viewers': len(self.viewers),
            'fps': round(self.fps, 2),
            'frame_count': self.frame_count,
            'uptime': time.time() - self.last_fps_update if self.last_fps_update else 0,
            'has_current_frame': self.current_frame is not None
        })

    async def handle_websocket(self, request):
        """Handle WebSocket viewer connections"""
        ws = web.WebSocketResponse(
            heartbeat=30.0,  # Send ping every 30 seconds
            max_msg_size=0   # No size limit for large frames
        )
        await ws.prepare(request)

        # Add to viewer set
        self.viewers.add(ws)
        viewer_id = id(ws)
        logger.info(f'Viewer connected: {viewer_id} (total: {len(self.viewers)})')

        # Send welcome message
        await ws.send_json({
            'type': 'welcome',
            'viewer_id': viewer_id,
            'server_version': '1.0.0',
            'capabilities': ['rgb', 'rgba', 'metadata']
        })

        # Send current frame if available
        if self.current_frame and self.current_metadata:
            try:
                await ws.send_json(self.current_metadata)
                await ws.send_bytes(self.current_frame)
            except Exception as e:
                logger.error(f'Error sending initial frame to {viewer_id}: {e}')

        try:
            # Listen for client messages
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        await self._handle_viewer_message(ws, data)
                    except json.JSONDecodeError:
                        logger.warning(f'Invalid JSON from viewer {viewer_id}')

                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f'WebSocket error from viewer {viewer_id}: {ws.exception()}')

        except asyncio.CancelledError:
            logger.info(f'Connection cancelled for viewer {viewer_id}')
        finally:
            # Remove viewer
            self.viewers.discard(ws)
            logger.info(f'Viewer disconnected: {viewer_id} (remaining: {len(self.viewers)})')

        return ws

    async def _handle_viewer_message(self, ws: web.WebSocketResponse, data: Dict):
        """Process messages from viewers"""
        msg_type = data.get('type')

        if msg_type == 'ping':
            await ws.send_json({'type': 'pong', 'timestamp': time.time()})

        elif msg_type == 'request_frame':
            # Send current frame if available
            if self.current_frame and self.current_metadata:
                await ws.send_json(self.current_metadata)
                await ws.send_bytes(self.current_frame)
            else:
                await ws.send_json({
                    'type': 'error',
                    'message': 'No frame available'
                })

        elif msg_type == 'get_stats':
            await ws.send_json({
                'type': 'stats',
                'viewers': len(self.viewers),
                'fps': self.fps,
                'frame_count': self.frame_count
            })

        else:
            logger.warning(f'Unknown message type: {msg_type}')

    async def handle_frame_upload(self, request):
        """
        HTTP endpoint for uploading frames (alternative to direct API call)

        Expected format:
        POST /frame
        Content-Type: application/json
        {
            "width": 1920,
            "height": 1080,
            "format": "rgb",
            "data": "base64_encoded_frame_data"
        }
        """
        try:
            data = await request.json()

            # Extract metadata
            width = data.get('width')
            height = data.get('height')
            format_type = data.get('format', 'rgb')

            # Decode frame data
            import base64
            frame_data = base64.b64decode(data.get('data', ''))

            # Broadcast frame
            await self.broadcast_frame(frame_data, width, height, format_type)

            return web.json_response({'success': True})

        except Exception as e:
            logger.error(f'Error handling frame upload: {e}')
            return web.json_response({'success': False, 'error': str(e)}, status=400)

    async def broadcast_frame(self, frame_data: bytes, width: int, height: int,
                             format_type: str = 'rgb', quality: int = 100):
        """
        Broadcast a frame to all connected viewers

        Args:
            frame_data: Raw pixel data (RGB or RGBA)
            width: Frame width in pixels
            height: Frame height in pixels
            format_type: 'rgb' or 'rgba'
            quality: Compression quality (0-100), currently unused
        """
        if not self.viewers:
            return  # No viewers connected

        # Update FPS calculation
        now = time.time()
        if self.last_frame_time > 0:
            delta = now - self.last_frame_time
            if delta > 0:
                instant_fps = 1.0 / delta
                # Smooth FPS with exponential moving average
                self.fps = 0.9 * self.fps + 0.1 * instant_fps
        self.last_frame_time = now

        # Prepare metadata
        metadata = {
            'type': 'frame_meta',
            'width': width,
            'height': height,
            'format': format_type,
            'timestamp': int(now * 1000),  # milliseconds
            'frame_number': self.frame_count,
            'fps': round(self.fps, 2),
            'size': len(frame_data)
        }

        # Store current frame
        self.current_frame = frame_data
        self.current_metadata = metadata
        self.frame_count += 1

        # Broadcast to all viewers
        disconnected = set()
        for viewer in self.viewers:
            try:
                # Send metadata as JSON
                await viewer.send_json(metadata)
                # Send frame data as binary
                await viewer.send_bytes(frame_data)
            except Exception as e:
                logger.error(f'Error sending frame to viewer {id(viewer)}: {e}')
                disconnected.add(viewer)

        # Remove disconnected viewers
        self.viewers -= disconnected

        # Log periodically
        if self.frame_count % 60 == 0:
            logger.info(f'Streamed {self.frame_count} frames at {self.fps:.1f} FPS to {len(self.viewers)} viewers')

    async def start(self):
        """Start the WebSocket server"""
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()

        site = web.TCPSite(self.runner, self.host, self.port)
        await site.start()

        logger.info(f'Frame Stream Server started on ws://{self.host}:{self.port}/ws')
        logger.info(f'HTTP endpoints available at http://{self.host}:{self.port}/')

    async def stop(self):
        """Stop the WebSocket server"""
        if self.runner:
            await self.runner.cleanup()
            logger.info('Frame Stream Server stopped')

    def broadcast_frame_sync(self, frame_data: bytes, width: int, height: int,
                            format_type: str = 'rgb'):
        """
        Synchronous wrapper for broadcasting frames

        This can be called from non-async code (e.g., Flask routes)
        """
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Schedule coroutine in the existing loop
            asyncio.create_task(
                self.broadcast_frame(frame_data, width, height, format_type)
            )
        else:
            # Run in new event loop
            asyncio.run(
                self.broadcast_frame(frame_data, width, height, format_type)
            )


# Global server instance
_server_instance: Optional[FrameStreamServer] = None


async def get_server(host: str = '127.0.0.1', port: int = 8766) -> FrameStreamServer:
    """Get or create the global server instance"""
    global _server_instance
    if _server_instance is None:
        _server_instance = FrameStreamServer(host, port)
        await _server_instance.start()
    return _server_instance


async def broadcast_frame_async(frame_data: bytes, width: int, height: int,
                               format_type: str = 'rgb'):
    """Async helper to broadcast a frame using the global server"""
    server = await get_server()
    await server.broadcast_frame(frame_data, width, height, format_type)


def broadcast_frame(frame_data: bytes, width: int, height: int, format_type: str = 'rgb'):
    """Synchronous helper to broadcast a frame"""
    global _server_instance
    if _server_instance:
        _server_instance.broadcast_frame_sync(frame_data, width, height, format_type)
    else:
        logger.warning('Cannot broadcast frame: server not initialized')


# Standalone server mode
async def main():
    """Run the server standalone"""
    server = FrameStreamServer(host='127.0.0.1', port=8766)
    await server.start()

    logger.info('Press Ctrl+C to stop...')

    try:
        # Keep running
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        logger.info('Shutting down...')
    finally:
        await server.stop()


if __name__ == '__main__':
    asyncio.run(main())
