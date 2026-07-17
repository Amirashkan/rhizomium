# Frequently Asked Questions

Quick answers to common questions about Rhizomium.

---

## General Questions

### What is Rhizomium?

Rhizomium is a node-based visual shader editor built on WebGPU and WGSL. It allows you to create real-time generative visuals by connecting nodes together, without writing code.

### Do I need to know programming to use Rhizomium?

No! While programming knowledge can help you understand the concepts, Rhizomium is designed to be accessible through its visual node interface. You can create complex visuals by simply connecting nodes.

### Is Rhizomium free?

Yes, Rhizomium is open-source and free to use. Check the repository license for details.

### Can I use Rhizomium for commercial projects?

Check the license file in the repository for commercial use terms.

---

## Technical Requirements

### What browsers are supported?

Rhizomium requires a WebGPU-capable browser:

- ✅ **Chrome 113+** (Recommended)
- ✅ **Edge 113+** (Recommended)
- ✅ **Opera 99+**
- ⚠️ **Firefox** - WebGPU support is experimental
- ⚠️ **Safari** - Limited WebGPU support

### How do I check if my browser supports WebGPU?

Visit [webgpu.io](https://webgpu.io/) to test your browser's WebGPU support.

### What GPU do I need?

Any modern GPU from the last 5-7 years should work:

- **NVIDIA**: GTX 900 series or newer
- **AMD**: RX 400 series or newer
- **Intel**: Iris Xe or newer
- **Apple**: M1 or newer

### Can I run Rhizomium on integrated graphics?

Yes! Modern integrated graphics (Intel Iris Xe, AMD Vega, Apple M1) support WebGPU and can run Rhizomium, though performance may be lower with complex graphs.

### Does Rhizomium work on mobile/tablets?

WebGPU support on mobile browsers is limited. Desktop browsers provide the best experience currently.

---

## Installation & Setup

### Do I need to install anything?

For basic use, no installation is needed - just visit the web version at [https://studio.tenderworld.org/](https://studio.tenderworld.org/).

For local development and advanced features (External Viewer), you'll need:
- Python 3.8+
- The repository files
- Python dependencies from `requirements.txt`

### How do I run Rhizomium locally?

1. Clone or download the repository
2. Install Python dependencies: `pip install -r requirements.txt`
3. Run the server: `python rhizo_server.py`
4. Open: `http://127.0.0.1:5000/studio`

See the [Setup Guide](setup.md) for detailed instructions.

### The server won't start. What's wrong?

**Port already in use:**
- Another process is using port 5000
- Solution: Kill the process or change the port in `rhizo_server.py`

**Python not found:**
- Python is not installed or not in your PATH
- Solution: Install Python 3.8+ and ensure it's in your system PATH

**Module not found:**
- Dependencies not installed
- Solution: Run `pip install -r requirements.txt`

---

## Using the Editor

### How do I add a node?

Right-click on the canvas → Select the node category → Choose the node type.

### How do I connect nodes?

Click and drag from an output pin (right side of a node) to an input pin (left side of another node).

### How do I delete a node?

Select the node by clicking on it, then press **Delete** or **Backspace**.

### How do I disconnect nodes?

Click the connection line and press **Delete**, or right-click the line and select "Delete".

### Can I copy and paste nodes?

Yes! Select nodes and use **Ctrl+C** (copy), **Ctrl+V** (paste). Or duplicate with **Ctrl+D**.

### How do I save my work?

Click the **Save** button in the toolbar, or press **Ctrl+S**. Your project will be saved locally or to the server.

### Where are my saved projects?

- **Local installation**: Saved to the `saves/` folder
- **Web version**: Saved to your browser's local storage
- Use the **Load** button to browse saved projects

### My saved projects disappeared!

If using the web version, clearing browser data will delete saved projects. Always export important projects (download the .json file) as backup.

---

## Troubleshooting

### I see only a menu, no canvas

**Possible causes:**
1. WebGPU not supported - Update your browser or enable WebGPU in `chrome://flags`
2. JavaScript errors - Check browser console (F12) for red errors
3. Server path issues - Ensure you're accessing the correct URL

See [Troubleshooting Guide](troubleshooting.md) for detailed solutions.

### The preview window is black

**Possible solutions:**
1. Make sure you have an **Output** node connected to your graph
2. Check that your graph has valid connections (no broken pins)
3. Look for shader compilation errors in the console
4. Try refreshing the page

### Performance is slow/laggy

**Optimization tips:**
1. Reduce the number of complex nodes (noise, Voronoi)
2. Lower the preview resolution
3. Close other GPU-intensive browser tabs
4. Update your GPU drivers
5. Simplify your node graph

### My colors look wrong

**Common issues:**
1. Values out of range - Use a **Clamp** node to limit values to 0-1
2. Incorrect color space - Check if you need RGB/HSV conversion
3. ColorRamp stops not configured - Adjust the gradient stops

### Nodes won't connect

**Possible reasons:**
1. Incompatible data types - Some types can't auto-convert
2. Output already connected - Some outputs only allow one connection
3. Creating a cycle - Nodes can't connect back to themselves

### Canvas is zoomed in/out too much

- **Zoom**: Mouse wheel or pinch gesture
- **Reset zoom**: Double-click on empty canvas area
- **Pan**: Middle-mouse drag or scroll to pan

---

## Features

### What is the External Viewer?

The External Viewer is a secondary window that displays your visual output, useful for multi-display setups (VJing, performances). It requires local installation.

See [External Viewer Guide](external-viewer.md).

### Can I use audio input?

Yes! Rhizomium supports audio reactivity. Type an audio expression like `=audioEnvelope * 0.5` into any numeric parameter field (per-band variables like `audioEnvelopeBass` are also available).

See [Audio Reactivity](audio-web.md) and the [Audio Setup Guide](audio.md).

### Can I export my visuals?

Currently:
- **Save projects**: Export as .json files
- **Screenshots**: Use browser screenshot tools
- **Video recording**: Use screen recording software (OBS, etc.)

### Can I import custom textures?

Yes! Use the **Texture 2D** node to load image files into your graph.

### Does Rhizomium support MIDI input?

Yes! Rhizomium supports MIDI controllers via the browser's Web MIDI API (Chrome/Edge). You can map hardware knobs and faders to node parameters.

See [MIDI Controller Integration](midi.md).

---

## Deployment

### Can I deploy Rhizomium to the web?

Yes! Rhizomium works on static hosting platforms like:
- Vercel (recommended)
- Netlify
- GitHub Pages
- Any static file host

See [Deployment Guide](deployment.md) and [Vercel Deployment](vercel.md).

### Do all features work when deployed?

**Yes:**
- Node editor
- Shader rendering
- Save/load (to browser local storage)
- Audio reactivity (with browser mic permission)

**No (local-only):**
- External Viewer (requires Python backend)
- Server-side file management

### How do I deploy to Vercel?

1. Fork the repository
2. Connect to Vercel
3. Deploy (automatic)

See [Vercel Deployment Guide](vercel.md) for details.

---

## Node System

### How many nodes are available?

Rhizomium includes 130+ nodes across 12 categories:
- **Input** (13) - Constants, UV, Time, Mouse, Trigger/Hold/Count, etc.
- **Output** (1) - Final output
- **Math** (43) - Arithmetic, trigonometry, interpolation, vector math
- **Vector** (7) - Split, Combine, Swizzle
- **Generators** (19) - Gradients, patterns, noise, shapes
- **Transform** (10) - UV manipulation, distortion
- **Modifiers** (11) - Color operations, image processing
- **Effects** (4) - Feedback, warp, kaleidoscope, glitch
- **Simulation** (5) - Particles, fluids, reaction-diffusion
- **Utility** (12) - Data manipulation, logic, custom code
- **Blend** (7) - SDF operations
- **Texture** (2) - 2D and cubemap sampling

### Where can I find a complete node list?

See the [Node Reference](node-reference.md) for a complete catalog with descriptions.

### Can I create custom nodes?

For custom per-pixel logic, use the **Custom GLSL** node (Utility category) — it gives you four input pins and a code editor for writing shader expressions directly. Fully custom node types still require modifying the source code; a plugin system for custom nodes may be added in the future.

### What's the difference between Generator nodes and Math nodes?

- **Generator nodes** generate spatial patterns and procedural content (circles, noise, gradients)
- **Math nodes** perform numerical operations on values (add, multiply, sine, etc.)

Both are essential for creating visuals!

---

## Performance

### What affects performance?

Main factors:
1. **Node count** - More nodes = more computation
2. **Node complexity** - Noise and Voronoi are expensive
3. **Resolution** - Higher resolution = more pixels to compute
4. **GPU** - Older/slower GPUs limit performance
5. **Browser** - Chrome/Edge typically perform best

### How can I optimize my graphs?

1. Minimize noise/Voronoi nodes
2. Reduce preview resolution
3. Use simpler math operations where possible
4. Disable the preview when not needed
5. Close other GPU-intensive applications

### What's a reasonable node count?

Most systems can handle 50-100 nodes comfortably. Complex graphs with many noise nodes may need optimization even with fewer nodes.

---

## Getting Help

### Where can I get more help?

- **[Troubleshooting Guide](troubleshooting.md)** - Detailed problem-solving
- **[Setup Guide](setup.md)** - Installation help
- **[Guide](guide.md)** - Tutorial for beginners
- **GitHub Issues** - Report bugs or request features

### I found a bug. How do I report it?

Please create an issue on the [GitHub repository](https://github.com/Amirashkan/glsl-node-editor/issues) with:
1. Description of the bug
2. Steps to reproduce
3. Browser and OS version
4. Console errors (F12 → Console)
5. Screenshots if applicable

### Can I contribute to Rhizomium?

Yes! Contributions are welcome. Check the GitHub repository for contribution guidelines.

---

## Philosophy & Design

### Why "Rhizomium"?

The name comes from the philosophical concept of a **rhizome** - a non-hierarchical network where any point can connect to any other. This reflects the node-based architecture where connections can form organically.

### Why WebGPU instead of WebGL?

WebGPU is the modern successor to WebGL, offering:
- Better performance
- More efficient GPU usage
- Modern API design
- WGSL (WebGPU Shading Language) - cleaner than GLSL

### Is the old WebGL version still available?

Previous versions may have used WebGL. The current version is built for WebGPU for better performance and future-proofing.

---

_Still have questions? Check the [Troubleshooting Guide](troubleshooting.md) or open an issue on GitHub._
