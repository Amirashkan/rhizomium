# Rhizomium

**Visual Synthesis, Rhizome-Style**  
**Compose. Evolve. Perform.**  
**Modular Nodes for Living Visuals**

Rhizomium is a **modular GPU-based visual synthesis environment** built on WebGPU and WGSL.  
It allows artists, designers, and coders to **compose dynamic shaders through visual nodes**,  
combining mathematical, procedural, and organic structures in real time.

---

## Quick Start

### Install
Rhizomium is a desktop app for **Windows 10 or later (64-bit)**; there is no
web version. Download the installer from the
[latest release](https://github.com/Amirashkan/rhizomium/releases/latest).
It needs a GPU with WebGPU support *(no WebGL fallback)*.

### Build from source
Requires Node.js 18 or later; the dev server runs in Chrome or Edge 113+.
```bash
git clone https://github.com/Amirashkan/rhizomium.git
cd rhizomium
npm install
npm run dev
```

---

## Key Features

### Visual Node Editor
- **130+ nodes** across 12 categories
- **Real-time preview** with live updates
- **Intuitive interface** - no coding required
- **Visual programming** - connect nodes to create shaders

### Animation & Control
- **[Parameter Expressions](parameter-expressions.md)** - Animate with math formulas
- **[Timeline & Keyframes](timeline.md)** - Professional animation system
- **[MIDI Controllers](midi.md)** - Hardware control integration
- **[Audio Reactivity](audio-web.md)** - Real-time audio analysis

### Advanced Effects
- **[Compute Nodes](compute-nodes.md)** - GPU-accelerated particle systems, simulations
- **[3D Visualization](field-visualization.md)** - Convert fields to 3D geometry
- **[Texture Support](textures.md)** - Load and manipulate images
- **Performance Profiler** - Monitor and optimize performance

### Performance
- **WebGPU powered** - Modern GPU acceleration
- **Runs at your display's refresh rate** - 60, 120, 144Hz — see **[Frame Rate & Display Refresh](frame-rate.md)**
- **[Performance Tools](profiler.md)** - Built-in profiler and monitoring
- **Optimization guides** - Tips for best performance

---

## Documentation

### Getting Started
- **[Quick Start](quickstart-web.md)** - Get started in 5 minutes
- **[Your First Graph](guide.md)** - Step-by-step tutorial
- **[Interface Overview](interface.md)** - Learn the UI

### Core Features
- **[Node System](nodes.md)** - Understanding nodes
- **[Node Reference](node-reference.md)** - Complete node catalog
- **[Parameter Expressions](parameter-expressions.md)** - Math-based animation
- **[Compute Nodes](compute-nodes.md)** - GPU-accelerated effects

### Animation & Control
- **[Timeline & Keyframes](timeline.md)** - Keyframe animation
- **[MIDI Controllers](midi.md)** - Hardware integration
- **[Audio Reactivity](audio-web.md)** - Audio-reactive visuals

### Advanced Topics
- **[3D Field Visualization](field-visualization.md)** - 3D geometry generation
- **[Working with Textures](textures.md)** - Image loading and manipulation
- **[Performance Tips](performance.md)** - Optimization strategies
- **[Performance Profiler](profiler.md)** - Monitoring tools

### Reference
- **[Keyboard Shortcuts](shortcuts.md)** - All shortcuts
- **[Frame Rate & Display Refresh](frame-rate.md)** - What the fps readout means, and why a second monitor can cap it
- **[FAQ](faq-web.md)** - Common questions
- **[Troubleshooting](troubleshooting.md)** - Solutions to problems

---

## Quick Links

**New Users:**
1. Start with [Quick Start Guide](quickstart-web.md)
2. Follow [Your First Graph Tutorial](guide.md)
3. Explore [Node Reference](node-reference.md)

**Experienced Users:**
- [Compute Nodes](compute-nodes.md) - Advanced GPU effects
- [Parameter Expressions](parameter-expressions.md) - Dynamic parameters
- [Timeline Animation](timeline.md) - Keyframe system
- [MIDI Integration](midi.md) - Hardware control

**Performance:**
- [Performance Tips](performance.md) - Optimization guide
- [Performance Profiler](profiler.md) - Monitoring tools
- [Frame Rate & Display Refresh](frame-rate.md) - **Seeing fewer fps than your monitor's refresh rate? Start here.**
