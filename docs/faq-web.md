# FAQ

Frequently asked questions about Rhizomium, the desktop app for Windows.

---

## General Questions

### What is Rhizomium?

Rhizomium is a node-based visual shader editor, installed as a desktop app on Windows. It uses WebGPU and WGSL to create real-time generative visuals through a visual programming interface - no code required!

### Do I need to know programming?

No! Rhizomium is designed to be accessible through its visual node interface. You create visuals by connecting nodes together, like building with blocks. Programming knowledge can help you understand concepts, but it's not required.

### Is Rhizomium free?

Yes, Rhizomium is open-source and free to use. Check the repository license for commercial use terms.

### Is there a web version?

No. Rhizomium is a desktop app for Windows 10 or later (64-bit). Download the
installer from the [latest release](https://github.com/Amirashkan/rhizomium/releases/latest).

### Can I use Rhizomium offline?

Yes. The editor runs, renders and saves projects without an internet
connection. Only account features (signing in, publishing, the AI tools) need
to be online.

---

## System Requirements

### What do I need to run Rhizomium?

- **Windows 10 or later (64-bit)**
- **A graphics card with WebGPU support** (see below)

macOS and Linux are not supported yet.

### What GPU do I need?

Any modern GPU from the last 5-7 years should work:

**Discrete Graphics:**
- NVIDIA: GTX 900 series or newer
- AMD: RX 400 series or newer
- Intel: Arc series

**Integrated Graphics:**
- Intel Iris Xe (11th gen+)
- AMD Vega (Ryzen APU)

### Can I run Rhizomium on integrated graphics?

Yes! Modern integrated graphics (Intel Iris Xe, AMD Vega) support WebGPU and can run Rhizomium. Performance may be lower with complex graphs, so use lower resolution settings (1280×720 or 960×540).

### Does Rhizomium work on mobile/tablets?

No. Rhizomium is a Windows desktop app; there is no mobile or tablet version.

---

## Using the Editor

### How do I add a node?

Right-click on the canvas, then navigate through the category menu to select the node you want. The node appears at your cursor position.

### How do I connect nodes?

Click and drag from an **output pin** (right side of a node) to an **input pin** (left side of another node). The wire color shows the data type.

### How do I delete a node?

Select the node by clicking it, then press **Delete** or **Backspace**. Or right-click the node and choose "Delete" from the menu.

### How do I disconnect nodes?

Click an **input pin** (left side) to remove its connection. Or select the connection wire and press Delete.

### Can I copy and paste nodes?

Yes! Select nodes and use:
- **Ctrl+C** to copy
- **Ctrl+V** to paste
- **Ctrl+D** to duplicate

Connections between copied nodes are preserved!

### How do I edit node parameters?

**Double-click** the node to open the parameter panel. Adjust values using sliders, color pickers, or text inputs. Click outside the panel or press **Esc** to close it.

### The preview window is black. What's wrong?

**Most common causes:**

1. **No Output node** - You need an Output node connected to your graph
2. **Broken connections** - Check that all wires are properly connected
3. **Shader error** - Check the status bar for the error message
4. **WebGPU not initialized** - Restart Rhizomium, and update your graphics driver

**Fix:** Make sure you have: `[Your Nodes] → Output`

### How do I zoom and pan?

**Zoom:**
- Mouse wheel up/down
- Ctrl + drag up/down
- Pinch gesture (trackpad)

**Pan:**
- Middle-mouse drag
- Right-click drag on empty canvas
- Two-finger drag (trackpad)

### Can I undo/redo actions?

Yes! Rhizomium has a full undo/redo system:
- **Ctrl+Z** to undo
- **Ctrl+Y** (or Ctrl+Shift+Z) to redo

Undo works for node creation, deletion, movement, connections, and parameter changes.

---

## Saving & Loading

### Where are my projects saved?

Projects are ordinary `.rz` files, saved wherever you choose on your computer.
Rhizomium also autosaves your current work and keeps backups as you go
(**File → Backups**), but those are a safety net, not a substitute for saving.

### How do I save my work?

Choose **File → Save**, or press **Ctrl+S**. The first time, pick a folder and
a name; after that, Ctrl+S writes straight back to the same file.
**File → Save As…** (Ctrl+Shift+S) saves a copy under a new name.

### How do I load a saved project?

Choose **File → Open Project…** (Ctrl+O) and pick a `.rz` file. You can also
drop a project file onto the window.

**Warning:** Loading replaces your current graph. Save first if you have unsaved changes!

### Can I move projects to another computer?

Yes - a project is just a file. Copy the `.rz` file however you like (USB
stick, cloud storage, Git) and open it on the other machine.

### How do I open an older `.json` project?

Choose **File → Open Project…** and select it; `.json` exports open the same
way as `.rz` files.

### My saved projects disappeared! What happened?

Saved projects are files, so look where you saved them - **File → Open
Project…** usually opens in the last folder you used. If you never saved,
open **File → Backups** (Ctrl+B): Rhizomium keeps automatic backups and offers
to restore the autosave when it starts.

**Prevention:**
- Save with Ctrl+S, don't rely on autosave alone
- Keep copies of important projects in cloud storage (Dropbox, Google Drive)

### Can I share projects with others?

Yes! Send the `.rz` file via:
- Email attachment
- GitHub Gist
- Cloud storage link (Dropbox, Google Drive)
- Direct file transfer

Recipients open it with **File → Open Project…**.

---

## Audio Reactivity

### How do I make visuals react to audio?

1. Open **Tools → Audio Settings**
2. Click **Enable Audio Input**
3. Allow microphone access when prompted
4. Type an audio expression into any numeric parameter field, e.g. `=audioEnvelope * 0.5`
5. Use `audioEnvelopeBass`, `audioEnvelopeMids`, or `audioEnvelopeHighs` for individual frequency bands

See [Audio Reactivity Guide](audio-web.md) for detailed instructions.

### What audio sources can I use?

**Microphone:** Allow access when asked
- Speak, sing, or play music near mic
- Good for live performances

**System Audio (Desktop Audio):**
- Windows: Enable "Stereo Mix" in sound settings
- Mac: Requires software like BlackHole or Loopback
- Linux: PulseAudio loopback

**Music/Videos:** Play through speakers near microphone (simple but works!)

### Audio settings aren't working

**Troubleshooting:**

1. **No input detected**
   - Restart Rhizomium and allow the microphone again
   - Check Windows **Settings → Privacy & security → Microphone**
   - Test microphone in other apps

2. **Visuals not reacting**
   - Make sure Audio Settings is enabled
   - Check that sound is playing/mic receiving
   - Increase Gain in Audio Settings
   - Try different frequency bands (Bass, Mid, High)

3. **Too sensitive**
   - Reduce Gain
   - Increase Smoothing
   - Multiply audio value by <1.0

4. **Too subtle**
   - Increase Gain
   - Multiply audio value by 2-10×
   - Use Bass output (usually strongest)

### Is audio processing slow?

No! Audio analysis is very efficient:
- ~1-2% CPU usage
- No GPU impact
- <10ms latency

Safe to use even with complex visuals!

---

## Performance

### The fps readout is lower than my monitor's refresh rate

First check the second number in the preview overlay — it reads
`48 fps · 5 ms GPU`. If the `ms GPU` figure is low, your graph is not the
problem: the GPU is finishing frames quickly and something is stopping them
reaching the screen.

The most common cause is **not Rhizomium at all**. On Windows, running two
displays at different refresh rates can make Chrome cap every one of its windows
to a single lower rate — a blank web page shows the same number, and native
applications on the same display are unaffected. Rhizomium cannot raise that
ceiling from inside a web page.

**[Frame Rate & Display Refresh](frame-rate.md)** explains how to confirm this in
about ten seconds and what display settings resolve it.

If `ms GPU` is high instead (above ~16 ms), it *is* your graph — see the next
question.

### My visuals are laggy. How do I fix it?

**Quick fixes:**

1. **Lower resolution** - Change to 1280×720 or 960×540
2. **Reduce noise nodes** - Limit to 2-3 per graph
3. **Disable node previews** - Click eye buttons on nodes
4. **Close other GPU-heavy apps** - Free up GPU resources
5. **Update your graphics driver**

See [Performance Tips](performance.md) for detailed optimization guide.

### Which nodes are most expensive?

**Very Expensive:**
- Voronoi - Cellular calculations
- FBM - Multiple octaves
- Turbulence - Similar to FBM

**Moderately Expensive:**
- Perlin Noise
- Simplex Noise
- Kaleidoscope

**Cheap (use freely):**
- Basic math (Add, Multiply, etc.)
- UV, Time, Mouse, Audio inputs
- Gradients, simple shapes

**Rule of thumb:** Limit to 2-3 noise nodes per graph.

### What resolution should I use?

**Recommended for most users:** 1920×1080 (FHD)

**Choose based on your setup:**
- **960×540** - Complex graphs, older GPUs, integrated graphics
- **1280×720** - Balanced performance, most hardware
- **1920×1080** - Standard, modern GPUs
- **2560×1440** - High-end GPUs, desktop gaming systems
- **3840×2160** - Enthusiast GPUs only (RTX 4080+, RX 7900+)

**Remember:** Higher resolution = more pixels = slower performance!

---

## Features & Capabilities

### How many nodes are available?

Rhizomium includes **130+ nodes** across 12 categories:
- Input (13) - Constants, UV, Time, Mouse, Trigger/Hold/Count, etc.
- Output (1) - Final output
- Math (43) - Arithmetic, trigonometry, interpolation, vector math
- Vector (7) - Split, Combine, Swizzle
- Generators (19) - Gradients, patterns, noise, shapes (fragment + compute)
- Transform (10) - UV manipulation, distortion
- Modifiers (11) - Color operations, image processing (fragment + compute)
- Effects (4) - Feedback, warp, kaleidoscope, glitch (compute)
- Dynamics (5) - Particles, fluids, reaction-diffusion, cellular automata (compute)
- Utility (12) - Data manipulation, logic, custom code, compositing
- Blend (7) - SDF operations
- Texture (2) - 2D and cubemap sampling

See [Node Reference](node-reference.md) for complete catalog.

### Can I create custom nodes?

For custom per-pixel logic, use the **Custom GLSL** node (Utility category) — it gives you four input pins and a code editor, so you can write shader expressions directly without modifying the source.

Fully custom node types still require modifying the source code. A plugin system for user-created nodes may be added in the future.

### Can I export my visuals as video?

Rhizomium doesn't have built-in video export. Use screen recording software:

**Windows:**
- Xbox Game Bar (Win+G)
- OBS Studio (free, powerful)

**Mac:**
- QuickTime Screen Recording
- OBS Studio

**Cross-platform:**
- OBS Studio (recommended)
- ShareX (Windows)

### Can I use custom textures?

Yes! Use the **Texture 2D** node:
1. Add Texture 2D node
2. Double-click to open parameters
3. Click Browse to select image file
4. Supported formats: JPG, PNG, WebP

### Does Rhizomium support MIDI input?

Yes! Rhizomium supports MIDI controllers via the Web MIDI API. Connect your MIDI controller and map knobs/sliders to any parameter. See the [MIDI Controller Integration Guide](midi.md) for setup instructions.

**Requirements:**
- MIDI controller connected via USB
- MIDI access allowed when Rhizomium asks

### What about VR/AR support?

VR/AR is not currently supported. Rhizomium focuses on 2D generative visuals. WebXR integration could be possible in the future.

---

## Troubleshooting

### I see only a menu, no canvas

**Possible causes:**

1. **WebGPU not supported**
   - Update Windows (Windows Update)
   - Check that your GPU is on the list above

2. **GPU drivers outdated**
   - Update graphics drivers
   - Restart Rhizomium after the update

### Canvas is zoomed in/out too much

- **Zoom:** Use mouse wheel
- **Reset:** Press **F** to frame all nodes
- **Manual:** Ctrl+drag up/down to zoom

### Nodes won't connect

**Check these:**

1. **Direction matters** - Drag from Output (right) to Input (left)
2. **Type mismatch** - Some types can't auto-convert
3. **Already connected** - Some outputs only allow one connection
4. **Creating cycle** - Nodes can't connect back to themselves

### Colors look wrong

**Common issues:**

1. **Values out of range** - Use Clamp node to limit 0-1
2. **Wrong color space** - Check RGB vs HSV
3. **ColorRamp not configured** - Adjust gradient stops

### Keyboard shortcuts don't work

**Check if:**

1. **In input field** - Click canvas or press Esc first
2. **Focus on body** - Click canvas to restore focus

### Project won't load

**Troubleshooting:**

1. **Restart Rhizomium** - May fix temporary issues
2. **File corrupted** - Try a backup (**File → Backups**) if you have one
3. **Version mismatch** - Very old projects may not load

---

## Best Practices

### Workflow Tips

1. **Save frequently** - Ctrl+S every few minutes
2. **Back up important work** - Keep copies of your `.rz` files
3. **Use descriptive names** - `audio_reactive_circles_v2` not `project1`
4. **Version your work** - Keep multiple saves (v1, v2, final)
5. **Test performance early** - Don't wait until graph is huge

### Organization

1. **Enable grid snap** - Keep nodes aligned
2. **Group related nodes** - Organize by function
3. **Leave space** - Don't overcrowd canvas
4. **Use node previews** - See intermediate results

### Performance

1. **Start at lower resolution** - Build at 1280×720, test at target
2. **Profile incrementally** - Notice which nodes slow down
3. **Optimize before performing** - Test under load
4. **Have backup scenes** - Simpler versions for emergencies

---

## Getting Help

### Where can I learn more?

**Documentation:**
- [Quick Start Guide](quickstart-web.md) - Get started in 5 minutes
- [Interface Overview](interface.md) - Learn the UI
- [Keyboard Shortcuts](shortcuts.md) - Speed up workflow
- [Parameter Expressions](parameter-expressions.md) - Animate with math
- [Compute Nodes](compute-nodes.md) - GPU-accelerated effects
- [MIDI Controllers](midi.md) - Hardware control
- [Timeline Animation](timeline.md) - Keyframe system
- [3D Visualization](field-visualization.md) - 3D field rendering
- [Audio Guide](audio-web.md) - Audio reactivity
- [Performance Tips](performance.md) - Optimize graphs
- [Performance Profiler](profiler.md) - Monitor performance
- [Node Reference](node-reference.md) - Complete node catalog

### I found a bug. How do I report it?

Create an issue on [GitHub](https://github.com/Amirashkan/rhizomium/issues) with:
1. Description of the bug
2. Steps to reproduce
3. Rhizomium version (**Help → About**) and Windows version
4. Screenshots if applicable

### Can I contribute to Rhizomium?

Yes! Rhizomium is open-source. Check the GitHub repository for contribution guidelines.

### Is there a community?

Check the GitHub repository for links to community channels, Discord servers, or forums where users share work and help each other.

---

## Technical Details

### What is WebGPU?

WebGPU is the modern successor to WebGL - a GPU API from the web platform, which Rhizomium uses through the Windows WebView. It's:
- Faster and more efficient
- Better GPU utilization
- Modern API design
- Future of web graphics

### What is WGSL?

WGSL (WebGPU Shading Language) is the shader language for WebGPU. It's cleaner and more modern than GLSL. Rhizomium automatically generates WGSL from your node graphs.

### Can I see the generated shader code?

Yes! Open **View → Show Console** to view the WGSL code generated from your nodes. You can:
- Copy code to clipboard
- Export as .wgsl file
- Learn WGSL from your graphs
- Use code in external projects

### Is my data private?

Everything runs on your computer:
- Projects are files on your disk
- Microphone audio is processed locally, not uploaded

Nothing leaves your machine unless you use an account feature such as
publishing or the AI tools.

---

## Limitations & Known Issues

### Platforms

Rhizomium ships for Windows only. There is no web, macOS, Linux or mobile
version yet.

### Performance Limits

Complex graphs with many noise nodes can be slow, especially:
- 4K resolution on mid-range GPUs
- Integrated graphics with heavy effects
- Older hardware (5+ years)

**Solution:** Lower resolution or simplify graphs.

---

## Future Features

Potential future additions (not promises!):
- Custom node plugin system
- MIDI input support
- Video export
- Collaborative editing
- Cloud project storage
- Mobile optimization

Follow the GitHub repository for updates!

---

_Have more questions? Check the other documentation or ask on GitHub!_
