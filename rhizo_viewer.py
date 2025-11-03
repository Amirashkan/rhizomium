#!/usr/bin/env python3
"""
Rhizomium External Viewer
Receives frames from GPUCanvas via shared memory IPC and displays them fullscreen.
"""

import moderngl_window as mglw
import moderngl
import numpy as np
import time
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

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # IPC channel setup
        self.channel = None
        self.channel_ready = False
        self.last_connection_attempt = 0
        self.connection_retry_delay = 2.0  # Seconds between retries

        # Try to connect to shared memory channel
        self._try_connect_channel()

        # Create fullscreen quad
        self._create_fullscreen_quad()

        # Create texture for received frames
        self.texture = self.ctx.texture(self.window_size, 3)
        self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)

        # Waiting message state
        self.waiting_message = "Waiting for stream..."
        self.start_time = time.time()

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
        """Main render loop."""
        self.ctx.clear(0.0, 0.0, 0.0)

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
    print("=" * 60)
    print("Rhizomium External Viewer")
    print("=" * 60)
    print("Controls:")
    print("  ESC or Q - Exit viewer")
    print("=" * 60)

    try:
        # Configure window for monitor #2 (if available)
        # Note: Monitor selection depends on the window backend
        # For fullscreen on secondary monitor, we can try different approaches

        # Try to detect monitors
        import moderngl_window.context.base as base_ctx

        # Run the viewer
        # To target monitor #2, you may need to adjust position or use backend-specific options
        # For now, we'll run windowed and can be manually moved to second monitor
        # Set fullscreen=True for fullscreen mode

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
