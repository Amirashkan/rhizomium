#!/usr/bin/env python3
"""
Rhizomium External Viewer
Receives frames via shared memory IPC or WebSocket and displays them.

Supports both:
- Local IPC mode (shared memory) for low-latency local viewing
- WebSocket mode for remote viewing over network

Usage:
    python rhizo_viewer.py              # Use IPC mode (default)
    python rhizo_viewer.py --ws         # Use WebSocket mode
    python rhizo_viewer.py --ws --url ws://192.168.1.100:8766/ws
"""

import moderngl_window as mglw
import moderngl
import numpy as np
import time
import asyncio
import websockets
import json
import threading
import queue
from typing import Optional
from ipc_shared import SharedFrameChannel


class RhizomiumViewer(mglw.WindowConfig):
    """External viewer window for Rhizomium frame streaming."""

    gl_version = (3, 3)
    title = "Rhizomium External Viewer"
    window_size = (1920, 1080)
    aspect_ratio = None
    resizable = True
    fullscreen = False  # Set via run() arguments
    vsync = True

    # Class variables for mode configuration
    use_websocket = False
    websocket_url = "ws://localhost:8766/ws"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # Mode selection
        self.mode = "websocket" if self.use_websocket else "ipc"
        print(f"[rhizo_viewer] Initializing in {self.mode.upper()} mode")

        # IPC channel setup
        self.channel = None
        self.channel_ready = False
        self.last_connection_attempt = 0
        self.connection_retry_delay = 2.0  # Seconds between retries

        # WebSocket setup
        self.ws_thread = None
        self.frame_queue = queue.Queue(maxsize=2)  # Small queue to keep latency low
        self.ws_connected = False
        self.ws_metadata = None

        # Initialize connection based on mode
        if self.use_websocket:
            self._start_websocket_client()
        else:
            self._try_connect_channel()

        # Create fullscreen quad
        self._create_fullscreen_quad()

        # Create texture for received frames
        self.texture = self.ctx.texture(self.window_size, 3)
        self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)

        # Waiting message state
        self.waiting_message = f"Waiting for {self.mode.upper()} stream..."
        self.start_time = time.time()

        # Statistics
        self.frames_received = 0
        self.last_fps_update = time.time()
        self.current_fps = 0.0

    def _try_connect_channel(self):
        """Attempt to connect to the shared memory channel."""
        try:
            self.channel = SharedFrameChannel(create=False)
            self.channel_ready = True
            print("[rhizo_viewer] Connected to shared memory channel")
        except FileNotFoundError:
            self.channel = None
            self.channel_ready = False
            print("[rhizo_viewer] Shared memory channel not found, will retry...")
        except Exception as e:
            self.channel = None
            self.channel_ready = False
            print(f"[rhizo_viewer] Error connecting to channel: {e}")

    def _start_websocket_client(self):
        """Start the WebSocket client in a separate thread"""
        print(f"[rhizo_viewer] Connecting to WebSocket: {self.websocket_url}")
        self.ws_thread = threading.Thread(
            target=self._websocket_client_thread,
            daemon=True
        )
        self.ws_thread.start()

    def _websocket_client_thread(self):
        """WebSocket client thread - runs async event loop"""
        asyncio.run(self._websocket_client_async())

    async def _websocket_client_async(self):
        """Async WebSocket client with auto-reconnect"""
        retry_delay = 1.0
        max_retry_delay = 30.0

        while True:
            try:
                print(f"[rhizo_viewer] Connecting to {self.websocket_url}...")
                async with websockets.connect(
                    self.websocket_url,
                    max_size=None,  # No size limit for large frames
                    ping_interval=20,
                    ping_timeout=10
                ) as websocket:
                    self.ws_connected = True
                    retry_delay = 1.0  # Reset retry delay on successful connection
                    print("[rhizo_viewer] WebSocket connected!")

                    # Receive frames
                    while True:
                        try:
                            # Receive metadata (JSON)
                            metadata_msg = await websocket.recv()

                            if isinstance(metadata_msg, str):
                                metadata = json.loads(metadata_msg)
                                msg_type = metadata.get('type')

                                if msg_type == 'welcome':
                                    print(f"[rhizo_viewer] Server version: {metadata.get('server_version')}")
                                    continue

                                elif msg_type == 'frame_meta':
                                    # Next message will be the frame data
                                    frame_data = await websocket.recv()

                                    if isinstance(frame_data, bytes):
                                        # Add to frame queue (drop old frames if full)
                                        try:
                                            self.frame_queue.put_nowait({
                                                'metadata': metadata,
                                                'data': frame_data
                                            })
                                        except queue.Full:
                                            # Queue full, drop oldest frame
                                            try:
                                                self.frame_queue.get_nowait()
                                                self.frame_queue.put_nowait({
                                                    'metadata': metadata,
                                                    'data': frame_data
                                                })
                                            except:
                                                pass

                                        # Update FPS counter
                                        self.frames_received += 1
                                        now = time.time()
                                        if now - self.last_fps_update >= 1.0:
                                            self.current_fps = self.frames_received / (now - self.last_fps_update)
                                            self.frames_received = 0
                                            self.last_fps_update = now
                                            print(f"[rhizo_viewer] Receiving at {self.current_fps:.1f} FPS")

                                elif msg_type == 'pong':
                                    pass  # Heartbeat response

                        except websockets.exceptions.ConnectionClosed:
                            print("[rhizo_viewer] WebSocket connection closed")
                            break
                        except Exception as e:
                            print(f"[rhizo_viewer] Error receiving frame: {e}")
                            break

            except Exception as e:
                print(f"[rhizo_viewer] WebSocket connection error: {e}")

            finally:
                self.ws_connected = False

            # Exponential backoff for reconnection
            print(f"[rhizo_viewer] Reconnecting in {retry_delay:.1f}s...")
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 1.5, max_retry_delay)

    def _create_fullscreen_quad(self):
        """Create a fullscreen quad for rendering the texture."""
        # Vertex shader
        vertex_shader = """
        #version 330
        in vec2 in_position;
        out vec2 v_texcoord;

        void main() {
            v_texcoord = in_position * 0.5 + 0.5;
            v_texcoord.y = 1.0 - v_texcoord.y;  // Flip Y
            gl_Position = vec4(in_position, 0.0, 1.0);
        }
        """

        # Fragment shader
        fragment_shader = """
        #version 330
        uniform sampler2D tex;
        in vec2 v_texcoord;
        out vec4 fragColor;

        void main() {
            fragColor = vec4(texture(tex, v_texcoord).rgb, 1.0);
        }
        """

        # Create shader program
        self.program = self.ctx.program(
            vertex_shader=vertex_shader,
            fragment_shader=fragment_shader
        )

        # Fullscreen quad vertices
        vertices = np.array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
             1.0,  1.0,
        ], dtype='f4')

        self.vbo = self.ctx.buffer(vertices)
        self.vao = self.ctx.simple_vertex_array(
            self.program,
            self.vbo,
            'in_position'
        )

    def render(self, time_val: float, frame_time: float):
        """Main render loop - handles both IPC and WebSocket modes"""
        self.ctx.clear(0.0, 0.0, 0.0)

        if self.use_websocket:
            self._render_websocket_mode()
        else:
            self._render_ipc_mode()

    def _render_ipc_mode(self):
        """Render frames from IPC shared memory"""
        # Try to reconnect if not connected
        if not self.channel_ready:
            current_time = time.time()
            if current_time - self.last_connection_attempt > self.connection_retry_delay:
                self.last_connection_attempt = current_time
                self._try_connect_channel()

        # Render frame from IPC or show waiting message
        if self.channel_ready and self.channel:
            try:
                # Receive frame data from shared memory
                data = self.channel.recv_frame()

                # Update texture with received data
                # Note: GPUCanvas sends RGB data (3 components)
                if data is not None and len(data) > 0:
                    self.texture.write(data.tobytes())

                    # Render fullscreen quad with texture
                    self.program['tex'].value = 0
                    self.texture.use(location=0)
                    self.vao.render(moderngl.TRIANGLE_STRIP)
                else:
                    self._render_waiting_message()

            except Exception as e:
                print(f"[rhizo_viewer] Error receiving/rendering frame: {e}")
                self._render_waiting_message()
        else:
            self._render_waiting_message()

    def _render_websocket_mode(self):
        """Render frames from WebSocket stream"""
        try:
            # Try to get latest frame from queue (non-blocking)
            frame_data = None
            while not self.frame_queue.empty():
                try:
                    frame_data = self.frame_queue.get_nowait()
                except queue.Empty:
                    break

            if frame_data:
                metadata = frame_data['metadata']
                data = frame_data['data']

                # Check if texture size needs updating
                width = metadata['width']
                height = metadata['height']
                format_type = metadata['format']
                components = 3 if format_type == 'rgb' else 4

                if (width, height) != self.texture.size or self.texture.components != components:
                    print(f"[rhizo_viewer] Updating texture size: {width}x{height} ({format_type})")
                    self.texture = self.ctx.texture((width, height), components)
                    self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)

                # Update texture with frame data
                self.texture.write(data)

                # Render fullscreen quad with texture
                self.program['tex'].value = 0
                self.texture.use(location=0)
                self.vao.render(moderngl.TRIANGLE_STRIP)
            else:
                # No frame available yet
                self._render_waiting_message()

        except Exception as e:
            print(f"[rhizo_viewer] Error rendering WebSocket frame: {e}")
            self._render_waiting_message()

    def _render_waiting_message(self):
        """Render a waiting message when no stream is available."""
        # Clear to dark background
        self.ctx.clear(0.1, 0.1, 0.15)

        # Note: For text rendering, we'd need additional dependencies
        # For now, we just show a dark screen
        # In production, you could use moderngl-text or PIL for text rendering

        # Optional: Pulse effect to show the viewer is active
        pulse = 0.5 + 0.5 * np.sin(time.time() * 2.0)
        self.ctx.clear(0.05 * pulse, 0.05 * pulse, 0.1 * pulse)

    def key_event(self, key, action, modifiers):
        """Handle keyboard events."""
        # ESC or Q to quit
        if action == self.wnd.keys.ACTION_PRESS:
            if key == self.wnd.keys.ESCAPE or key == self.wnd.keys.Q:
                print("[rhizo_viewer] Exit requested")
                self.wnd.close()

    def resize(self, width: int, height: int):
        """Handle window resize."""
        # Update texture size if needed
        if (width, height) != self.texture.size:
            self.texture = self.ctx.texture((width, height), 3)
            self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)

    def close(self):
        """Clean up resources on exit."""
        print("[rhizo_viewer] Closing viewer...")

        # Close IPC channel
        if self.channel:
            try:
                self.channel.close()
                print("[rhizo_viewer] IPC channel closed")
            except Exception as e:
                print(f"[rhizo_viewer] Error closing channel: {e}")

        # Release OpenGL resources
        if hasattr(self, 'vao'):
            self.vao.release()
        if hasattr(self, 'vbo'):
            self.vbo.release()
        if hasattr(self, 'program'):
            self.program.release()
        if hasattr(self, 'texture'):
            self.texture.release()

        print("[rhizo_viewer] Cleanup complete")


def main():
    """Entry point for the Rhizomium viewer."""
    import argparse

    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description='Rhizomium External Viewer - Display frames via IPC or WebSocket'
    )
    parser.add_argument(
        '--ws', '--websocket',
        action='store_true',
        dest='use_websocket',
        help='Use WebSocket mode instead of IPC'
    )
    parser.add_argument(
        '--url',
        type=str,
        default='ws://localhost:8766/ws',
        help='WebSocket URL (default: ws://localhost:8766/ws)'
    )
    parser.add_argument(
        '--fullscreen',
        action='store_true',
        help='Start in fullscreen mode'
    )

    args = parser.parse_args()

    # Configure viewer mode
    RhizomiumViewer.use_websocket = args.use_websocket
    RhizomiumViewer.websocket_url = args.url
    RhizomiumViewer.fullscreen = args.fullscreen

    print("=" * 60)
    print("Rhizomium External Viewer")
    print("=" * 60)
    if args.use_websocket:
        print(f"Mode: WebSocket")
        print(f"URL: {args.url}")
    else:
        print(f"Mode: IPC (Shared Memory)")
    print("Controls:")
    print("  ESC or Q - Exit viewer")
    print("=" * 60)

    try:
        # Run the viewer
        # To target monitor #2, you may need to adjust position or use backend-specific options
        # For now, we'll run windowed and can be manually moved to second monitor

        mglw.run_window_config(
            RhizomiumViewer,
            args=['--window', 'pygame2']  # pygame2 has good multi-monitor support
        )

    except KeyboardInterrupt:
        print("\n[rhizo_viewer] Interrupted by user")
    except Exception as e:
        print(f"[rhizo_viewer] Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print("[rhizo_viewer] Viewer exited")


if __name__ == "__main__":
    main()
