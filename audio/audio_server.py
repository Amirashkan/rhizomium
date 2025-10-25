#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audio Envelope Server
Exposes real-time audio envelope values via WebSocket for GLSL shader integration.
"""
from __future__ import annotations
import asyncio
import json
import signal
import sys
from typing import Optional
from aiohttp import web
import aiohttp_cors
from audio.audio_engine import AudioEngine
from audio.audio_envelope_processor import FollowerParams, ADSRParams, OutputShaping

class AudioServer:
    """
    WebSocket server that streams audio envelope values in real-time.
    """
    def __init__(self,
                 host: str = "localhost",
                 port: int = 8765,
                 mode: str = "mic",
                 update_rate: int = 60):
        self.host = host
        self.port = port
        self.update_rate = update_rate
        self.app = web.Application()
        self.clients = set()
        self.running = False

        # Initialize audio engine
        self.audio_engine = AudioEngine(
            mode=mode,
            follower=FollowerParams(
                attack_ms=50.0,
                release_ms=200.0,
                threshold=0.1
            ),
            adsr=ADSRParams(
                attack_ms=120.0,
                decay_ms=180.0,
                sustain=0.7,
                release_ms=600.0
            ),
            shaping=OutputShaping(
                curve="exp",
                normalize=True
            )
        )

        # Setup routes
        self._setup_routes()

    def _setup_routes(self):
        """Setup HTTP and WebSocket routes"""
        self.app.router.add_get('/ws', self.websocket_handler)
        self.app.router.add_get('/envelope', self.http_envelope_handler)
        self.app.router.add_get('/status', self.status_handler)
        self.app.router.add_post('/config', self.config_handler)

        # Setup CORS
        cors = aiohttp_cors.setup(self.app, defaults={
            "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
                allow_methods="*"
            )
        })

        for route in list(self.app.router.routes()):
            if not isinstance(route.resource, web.StaticResource):
                cors.add(route)

    async def websocket_handler(self, request):
        """WebSocket handler for real-time envelope streaming"""
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        self.clients.add(ws)
        print(f"Client connected. Total clients: {len(self.clients)}")

        try:
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    # Handle client messages (e.g., config updates)
                    try:
                        data = json.loads(msg.data)
                        if data.get('type') == 'ping':
                            await ws.send_json({'type': 'pong'})
                    except json.JSONDecodeError:
                        pass
                elif msg.type == web.WSMsgType.ERROR:
                    print(f'WebSocket error: {ws.exception()}')
        finally:
            self.clients.discard(ws)
            print(f"Client disconnected. Total clients: {len(self.clients)}")

        return ws

    async def http_envelope_handler(self, request):
        """HTTP endpoint to get current envelope value"""
        envelope = self.audio_engine.get_envelope()
        return web.json_response({
            'envelope': envelope,
            'timestamp': asyncio.get_event_loop().time()
        })

    async def status_handler(self, request):
        """Status endpoint"""
        return web.json_response({
            'status': 'running' if self.running else 'stopped',
            'clients': len(self.clients),
            'mode': self.audio_engine.mode,
            'samplerate': self.audio_engine.samplerate
        })

    async def config_handler(self, request):
        """Update audio engine configuration"""
        try:
            data = await request.json()

            # Update follower params
            if 'follower' in data:
                f = data['follower']
                if 'attack_ms' in f:
                    self.audio_engine.processor.f.attack_ms = float(f['attack_ms'])
                if 'release_ms' in f:
                    self.audio_engine.processor.f.release_ms = float(f['release_ms'])
                if 'threshold' in f:
                    self.audio_engine.processor.f.threshold = float(f['threshold'])

            # Update ADSR params
            if 'adsr' in data:
                a = data['adsr']
                if 'attack_ms' in a:
                    self.audio_engine.processor.a.attack_ms = float(a['attack_ms'])
                if 'decay_ms' in a:
                    self.audio_engine.processor.a.decay_ms = float(a['decay_ms'])
                if 'sustain' in a:
                    self.audio_engine.processor.a.sustain = float(a['sustain'])
                if 'release_ms' in a:
                    self.audio_engine.processor.a.release_ms = float(a['release_ms'])

            # Update shaping params
            if 'shaping' in data:
                s = data['shaping']
                if 'curve' in s:
                    self.audio_engine.processor.s.curve = s['curve']
                if 'normalize' in s:
                    self.audio_engine.processor.s.normalize = bool(s['normalize'])

            return web.json_response({'status': 'ok', 'message': 'Configuration updated'})
        except Exception as e:
            return web.json_response({'status': 'error', 'message': str(e)}, status=400)

    async def broadcast_envelope(self):
        """Broadcast envelope values to all connected WebSocket clients"""
        interval = 1.0 / self.update_rate

        while self.running:
            if self.clients:
                envelope = self.audio_engine.get_envelope()
                message = json.dumps({
                    'type': 'envelope',
                    'value': envelope,
                    'timestamp': asyncio.get_event_loop().time()
                })

                # Send to all connected clients
                disconnected = set()
                for client in self.clients:
                    try:
                        await client.send_str(message)
                    except Exception:
                        disconnected.add(client)

                # Remove disconnected clients
                self.clients -= disconnected

            await asyncio.sleep(interval)

    async def start_audio(self):
        """Start the audio engine"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.audio_engine.start)
        print(f"Audio engine started (mode: {self.audio_engine.mode}, rate: {self.audio_engine.samplerate}Hz)")

    async def stop_audio(self):
        """Stop the audio engine"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.audio_engine.stop)
        print("Audio engine stopped")

    async def start_server(self):
        """Start the web server and audio engine"""
        self.running = True

        # Start audio engine
        await self.start_audio()

        # Start broadcast task
        broadcast_task = asyncio.create_task(self.broadcast_envelope())

        # Start web server
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()

        print(f"Audio envelope server running on http://{self.host}:{self.port}")
        print(f"WebSocket endpoint: ws://{self.host}:{self.port}/ws")
        print(f"HTTP endpoint: http://{self.host}:{self.port}/envelope")
        print(f"Update rate: {self.update_rate} Hz")
        print("Press Ctrl+C to stop")

        try:
            # Keep running until interrupted
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            pass
        finally:
            self.running = False
            await broadcast_task
            await self.stop_audio()
            await runner.cleanup()

def main():
    """Main entry point"""
    import argparse
    import platform

    parser = argparse.ArgumentParser(description='Audio Envelope WebSocket Server')
    parser.add_argument('--host', default='localhost', help='Server host (default: localhost)')
    parser.add_argument('--port', type=int, default=8765, help='Server port (default: 8765)')
    parser.add_argument('--mode', choices=['mic', 'loopback'], default='mic',
                        help='Audio input mode: mic or loopback (default: mic)')
    parser.add_argument('--rate', type=int, default=60,
                        help='Update rate in Hz (default: 60)')

    args = parser.parse_args()

    server = AudioServer(
        host=args.host,
        port=args.port,
        mode=args.mode,
        update_rate=args.rate
    )

    # Setup signal handlers (cross-platform)
    async def run_with_shutdown():
        """Run server with proper shutdown handling"""
        try:
            await server.start_server()
        except KeyboardInterrupt:
            print("\nShutdown complete")

    # Use asyncio.run() for Python 3.7+ compatibility
    try:
        if platform.system() == 'Windows':
            # Windows-specific event loop policy for better compatibility
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

        asyncio.run(run_with_shutdown())
    except KeyboardInterrupt:
        print("\nShutdown complete")

if __name__ == '__main__':
    main()
