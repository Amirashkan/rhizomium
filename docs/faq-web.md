# FAQ - Web Version

Frequently asked questions for Rhizomium web users at [https://studio.tenderworld.org](https://studio.tenderworld.org)

---

## General Questions

### What is Rhizomium?

Rhizomium is a node-based visual shader editor that runs entirely in your browser. It uses WebGPU and WGSL to create real-time generative visuals through a visual programming interface - no code required!

### Do I need to know programming?

No! Rhizomium is designed to be accessible through its visual node interface. You create visuals by connecting nodes together, like building with blocks. Programming knowledge can help you understand concepts, but it's not required.

### Is Rhizomium free?

Yes, Rhizomium is open-source and free to use. Check the repository license for commercial use terms.

### Can I use Rhizomium offline?

The web version requires an internet connection to load initially. Once loaded, the editor works without internet, but you can't save/load projects without connection to the site. For offline use, run Rhizomium locally (requires technical setup).

---

## Browser & Technical Requirements

### What browsers are supported?

Rhizomium requires WebGPU support:

- **Chrome 113+** (Recommended)
- **Edge 113+** (Recommended)
- **Opera 99+**
- **Firefox** - Experimental WebGPU, limited support
- **Safari** - Partial WebGPU, may not work

**Bottom line:** Use Chrome or Edge for best experience.

### How do I check if my browser supports WebGPU?

Visit [webgpu.io](https://webgpu.io/) to test your browser's WebGPU support. If it shows a colorful cube, you're good to go!

### What GPU do I need?

Any modern GPU from the last 5-7 years should work:

**Discrete Graphics:**
- NVIDIA: GTX 900 series or newer
- AMD: RX 400 series or newer
- Intel: Arc series

**Integrated Graphics:**
- Intel Iris Xe (11th gen+)
- AMD Vega (Ryzen APU)
- Apple M1/M2

### Can I run Rhizomium on integrated graphics?

Yes! Modern integrated graphics (Intel Iris Xe, AMD Vega, Apple M1) support WebGPU and can run Rhizomium. Performance may be lower with complex graphs, so use lower resolution settings (1280×720 or 960×540).

### Does Rhizomium work on mobile/tablets?

WebGPU support on mobile browsers is very limited currently. Desktop browsers provide the best experience. Mobile support may improve as WebGPU adoption grows.

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
3. **Shader error** - Check console (F12) for error messages
4. **WebGPU not initialized** - Try refreshing the page

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

Projects save to your browser's **Local Storage** - stored only on your computer, in that specific browser.

**Important:** Projects are browser-specific:
- Chrome projects ≠ Edge projects
- Regular mode ≠ Incognito mode
- Different computers have separate storage

### How do I save my work?

Choose **File → Save**, or press **Ctrl+S**. Enter a project name when prompted.

Your project saves instantly to browser storage!

### How do I load a saved project?

Choose **File → Open Project…**. Browse your saved projects and click one to load it.

**Warning:** Loading replaces your current graph. Save first if you have unsaved changes!

### Can I export my projects?

Yes! Choose **File → Export**. Your project downloads as a `.json` file that you can:
- Backup to cloud storage
- Share with others
- Move to another computer
- Version control with Git

**Always export important projects!**

### How do I import a project file?

Choose **File → Open Project…**, then select a `.json` file from your computer. The project loads immediately.

### My saved projects disappeared! What happened?

**Common causes:**
- Browser cache was cleared (deletes all projects!)
- Used incognito/private mode (doesn't save permanently)
- Switched browsers (projects don't transfer)
- Browser was uninstalled

**Prevention:**
- Export important projects as JSON backups
- Don't clear browser data for studio.tenderworld.org
- Keep backups in cloud storage (Dropbox, Google Drive)

### How much storage space do I have?

Browser storage limits:
- Chrome/Edge: 5-10MB per site
- Firefox: ~10MB per site
- Safari: ~5MB per site

**Project sizes:**
- Simple: 5-20 KB
- Medium: 20-50 KB
- Complex: 50-200 KB

You can store **50-200+ projects** easily!

### Can I share projects with others?

Yes! Export your project as JSON, then share the file via:
- Email attachment
- GitHub Gist
- Cloud storage link (Dropbox, Google Drive)
- Direct file transfer

Recipients import the JSON file to use it.

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

**Microphone:** Works in all browsers with permission
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
   - Refresh page and allow microphone again
   - Check browser microphone permissions
   - Test microphone in other apps
   - Try different browser

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

### My visuals are laggy. How do I fix it?

**Quick fixes:**

1. **Lower resolution** - Change to 1280×720 or 960×540
2. **Reduce noise nodes** - Limit to 2-3 per graph
3. **Disable node previews** - Click eye buttons on nodes
4. **Close other tabs** - Free up GPU resources
5. **Update browser** - Use latest Chrome/Edge

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

### Does Chrome perform better than other browsers?

Yes! Chrome and Edge (which uses Chrome's engine) have the best WebGPU performance. Firefox and Safari have experimental/partial support and are generally slower.

For best performance: **Use Chrome 113+ or Edge 113+**

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
- Chrome 43+ or Edge 79+ (Web MIDI API support)
- MIDI controller connected via USB
- Browser permission granted for MIDI access

### What about VR/AR support?

VR/AR is not currently supported. Rhizomium focuses on 2D generative visuals. WebXR integration could be possible in the future.

---

## Troubleshooting

### I see only a menu, no canvas

**Possible causes:**

1. **WebGPU not supported**
   - Update browser to Chrome 113+ or Edge 113+
   - Enable WebGPU in `chrome://flags`
   - Check [webgpu.io](https://webgpu.io/)

2. **JavaScript errors**
   - Press F12 to open console
   - Look for red error messages
   - Try refreshing page

3. **GPU drivers outdated**
   - Update graphics drivers
   - Restart browser after update

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
2. **Browser intercepts** - Some shortcuts used by browser
3. **Wrong modifier** - Use Ctrl (Windows) or Cmd (Mac)
4. **Focus on body** - Click canvas to restore focus

### Project won't load

**Troubleshooting:**

1. **Refresh page** - May fix temporary issues
2. **Check console** - F12 for error messages
3. **JSON corrupted** - Try backup if you have one
4. **Version mismatch** - Very old projects may not load

---

## Best Practices

### Workflow Tips

1. **Save frequently** - Ctrl+S every few minutes
2. **Export important work** - Download JSON backups
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

Create an issue on [GitHub](https://github.com/Amirashkan/glsl-node-editor/issues) with:
1. Description of the bug
2. Steps to reproduce
3. Browser and OS version
4. Console errors (F12 → Console)
5. Screenshots if applicable

### Can I contribute to Rhizomium?

Yes! Rhizomium is open-source. Check the GitHub repository for contribution guidelines.

### Is there a community?

Check the GitHub repository for links to community channels, Discord servers, or forums where users share work and help each other.

---

## Technical Details

### What is WebGPU?

WebGPU is the modern successor to WebGL - a web API for GPU acceleration. It's:
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

**100% private!** Everything runs in your browser:
- Projects stored locally only
- No data sent to servers
- No tracking or analytics
- Microphone audio processed locally, not uploaded

Only you can access your work!

---

## Limitations & Known Issues

### Web Version Limitations

**Not available in web version:**
- External Viewer (requires local Python server)
- Server-side file management
- Multi-window output (browser security)

**Available only locally:**
- Dual-screen mode (External Viewer)
- Some advanced features

For full features, run Rhizomium locally (requires technical setup).

### Browser Compatibility

WebGPU is still rolling out:
- Chrome/Edge: Full support
- Firefox: Experimental
- Safari: Partial
- Mobile: Limited

Use Chrome/Edge for best experience.

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
