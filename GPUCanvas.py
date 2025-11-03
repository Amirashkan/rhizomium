import moderngl
import numpy as np
from ipc_shared import SharedFrameChannel


class GPUCanvas:
    """GPU canvas with render loop and IPC integration for Rhizomium."""

    def __init__(self, width=800, height=600):
        """Initialize GPU canvas.

        Args:
            width: Canvas width in pixels
            height: Canvas height in pixels
        """
        # Create standalone ModernGL context
        self.ctx = moderngl.create_standalone_context()
        self.width = width
        self.height = height

        # Create framebuffer
        self.texture = self.ctx.texture((width, height), 3)
        self.fbo = self.ctx.framebuffer(color_attachments=[self.texture])

        # IPC channel initialization
        self.ipc_channel = None
        self.ipc_ready = False

        # Create a simple shader program for testing
        self._init_shader()

    def _init_shader(self):
        """Initialize a simple test shader."""
        vertex_shader = """
        #version 330
        in vec2 in_vert;
        out vec2 v_uv;
        void main() {
            v_uv = in_vert * 0.5 + 0.5;
            gl_Position = vec4(in_vert, 0.0, 1.0);
        }
        """

        fragment_shader = """
        #version 330
        in vec2 v_uv;
        out vec3 fragColor;
        uniform float time;
        void main() {
            fragColor = vec3(v_uv, sin(time));
        }
        """

        self.program = self.ctx.program(
            vertex_shader=vertex_shader,
            fragment_shader=fragment_shader
        )

        # Create a simple quad
        vertices = np.array([
            -1.0, -1.0,
            1.0, -1.0,
            -1.0, 1.0,
            1.0, 1.0,
        ], dtype='f4')

        self.vbo = self.ctx.buffer(vertices)
        self.vao = self.ctx.simple_vertex_array(self.program, self.vbo, 'in_vert')

    def render(self, time=0.0):
        """Render frame and send to IPC channel.

        Args:
            time: Current time in seconds for animation
        """
        # Set up IPC channel on first render
        if not self.ipc_ready:
            pixels = self.fbo.read(components=3, alignment=1)
            self.ipc_channel = SharedFrameChannel(create=True, size=len(pixels))
            self.ipc_ready = True

        # Render to framebuffer
        self.fbo.use()
        self.ctx.clear(0.0, 0.0, 0.0)
        self.program['time'].value = time
        self.vao.render(moderngl.TRIANGLE_STRIP)

        # Read pixels and send via IPC
        pixels = self.fbo.read(components=3, alignment=1)
        self.ipc_channel.send_frame(pixels)

    def close(self):
        """Clean up resources."""
        if self.ipc_channel:
            self.ipc_channel.close()
        self.ctx.release()


if __name__ == "__main__":
    import time as time_module

    # Test the canvas
    canvas = GPUCanvas(800, 600)
    print("GPUCanvas initialized, rendering frames...")

    try:
        start_time = time_module.time()
        frame_count = 0

        while frame_count < 1000:
            current_time = time_module.time() - start_time
            canvas.render(current_time)
            frame_count += 1

            if frame_count % 100 == 0:
                print(f"Rendered {frame_count} frames")

            time_module.sleep(1/60)  # Target 60 FPS

    finally:
        canvas.close()
        print("GPUCanvas closed")
