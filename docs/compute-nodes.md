# Compute Nodes

Learn how to use GPU-accelerated compute shaders to create powerful visual effects and simulations.

---

## What Are Compute Nodes?

Compute nodes are **GPU-accelerated pre-processing nodes** that run before your fragment shader. They execute in parallel workgroups on your GPU, making them perfect for:

- **Particle systems** - Thousands of particles simulated in real-time
- **Reaction-diffusion** - Organic patterns and textures
- **Fluid simulation** - Smoke, ink, and water effects
- **Cellular automata** - Game of Life and emergent patterns
- **Noise, gradients, and patterns** - Procedural textures
- **Image processing** - Blur, edge detection, color grading, glitch effects
- **Feedback loops** - Trails and recursive visuals

---

## Quick Start

### Step 1: Add a Compute Node

1. Right-click on the canvas
2. Compute nodes live in the same categories as fragment nodes — look in **Generators** (Compute Noise, Voronoi, Gradient, Pattern), **Modifiers** (Compute Blur, Edge Detect, ...), **Effects** (Compute Feedback, Warp, Kaleidoscope, Glitch), **Simulation** (Particles, Fluid, ...), and **Utility** (Mix, Transform, Channels, HSV)
3. Click to place the node on the canvas

### Step 2: Connect to Fragment Shader

Compute nodes output textures that can be sampled in your fragment shader:

```
Compute Noise → Texture Sample → Output
```

**Important:** Compute nodes don't connect directly to the Output node. You need to sample their output texture in a fragment shader.

### Step 3: Configure Parameters

Click on the compute node to open its parameters panel. Adjust settings like:
- **Resolution** - Output texture size (affects quality and performance)
- **Scale** - Pattern frequency
- **Speed** - Animation rate
- **Octaves** - Detail level (for noise nodes)

---

## Available Compute Nodes

For full pin and parameter listings, see the [Node Reference](node-reference.md). The current set:

**Generators**
- **Compute Noise** - Animated FBM noise (scale, octaves, speed, seed, colorize, resolution)
- **Voronoi** - Voronoi diagrams and Worley noise (Cells/Distance/Borders/Worley modes, animated points)
- **Gradient** - Linear, radial, angular, and diamond gradients with a visual color-stop editor
- **Pattern** - Checkerboard, stripes, dots, grid, hexagon, and brick patterns

**Modifiers (image processing)**
- **Compute Blur** - Gaussian blur (radius, quality, direction)
- **Compute Convolution** - Sharpen, edge detect, emboss kernels
- **Threshold** - Binary, range, and adaptive thresholding
- **Color Adjust** - Brightness, contrast, saturation, hue, gamma, exposure
- **Edge Detect** - Sobel, Scharr, Prewitt, Roberts operators
- **Morphology** - Dilate, erode, open, close
- **Histogram** - Equalize, normalize, stretch, visualize
- **Luminance** - Luminance extraction with several formulas

**Effects**
- **Compute Feedback** - Feedback loop with per-frame transform (trails, tunnels); has a **Reset** input pin
- **Warp** - Displace, twist, bulge, pinch, and wave distortion, optionally driven by a warp-field texture
- **Kaleidoscope** - Mirror symmetry with optional animation
- **Glitch** - RGB shift, block, scanline, pixelate, and corrupt effects

**Simulation**
- **Compute Particles** - GPU particle system with force/velocity field inputs
- **Reaction Diffusion** - Gray-Scott simulation with pattern presets (Coral, Spots, Stripes, ...)
- **Fluid Simulation** - Navier-Stokes fluid dynamics
- **Cellular Automata** - Conway Life, Seeds, Brian's Brain, Day & Night
- **Feedback Field** - Persistent field with Flow/Reaction-Diffusion/Accumulate/Swirl modes; has a **Reset** input pin

**Utility**
- **Mix** - Blend two textures with standard blend modes
- **Transform** - Translate/rotate/scale a texture
- **Channels** - Swap, extract, combine, remap color channels
- **HSV** - RGB↔HSV conversion and HSV adjustments
- **3D Field Visualizer** - Map field data to 3D points, surfaces, or volumes (see [3D Field Visualization](field-visualization.md))

### Spotlight: Compute Noise

Generates animated procedural noise using Fractal Brownian Motion.

**Key Parameters:**
- `scale` - Noise frequency (default: 8.0)
- `octaves` - Detail layers (default: 5)
- `speed` - Animation speed (default: 0.1)
- `colorize` - Enable color output (default: true)
- `resolution` - Output texture size: 256/512/1024 (default: 512)

**Example:**
```
Compute Noise (scale: 5.0, octaves: 6) → Texture Sample → Output
```

### Spotlight: Compute Feedback

Creates feedback loops for trails and recursive patterns.

**Inputs:**
- `Input` - The texture to feed back
- `Reset` - Control pin: a rising edge (e.g. from a **Trigger** node) clears the accumulated trail

**Key Parameters:**
- `decay` - Trail persistence (default: 0.95)
- `scale` - Zoom per frame (default: 1.01)
- `rotation` - Rotation per frame in degrees (default: 0.0)
- `offsetX` / `offsetY` - Drift per frame (default: 0.0)
- `Reset Feedback` (button) - Manually clear the trail

**Note:** This node uses ping-pong buffers for temporal effects. The Reset pin performs the same clear as the button, but signal-driven — wire a Trigger to reset on a beat or event. The same applies to **Feedback Field**.

### Spotlight: Reaction Diffusion

Simulates Gray-Scott reaction-diffusion patterns.

**Key Parameters:**
- `pattern` - Preset: Coral, Spots, Stripes, Waves, Mitosis, Worms, Spirals (default: Coral)
- `feedRate` - Feed rate (default: 0.0545)
- `killRate` - Kill rate (default: 0.062)
- `diffusionA` / `diffusionB` - Diffusion rates (defaults: 1.0 / 0.5)
- `timestep` - Simulation speed (default: 1.0)
- `resolution` - Simulation resolution: 256/512/1024 (default: 512)

---

## How Compute Nodes Work

### Execution Order

Compute nodes execute **before** your fragment shader:

```
Frame Start
    ↓
1. Compute Noise executes → Creates texture
2. Compute Blur executes → Processes texture
    ↓
3. Fragment shader executes → Samples compute textures
    ↓
Frame End
```

The system automatically handles execution order based on dependencies.

### Texture Outputs

Compute nodes output textures in `rgba8unorm` format:
- **Resolution**: Configurable on generator/simulation nodes (256, 512, or 1024)
- **Format**: RGBA (Red, Green, Blue, Alpha)
- **Usage**: Can be sampled in fragment shaders

### Feedback Loops

Some compute nodes (Compute Feedback, Feedback Field, Reaction Diffusion, Fluid Simulation, Cellular Automata) keep **state between frames**:
- Uses ping-pong buffers
- Previous frame output becomes next frame input
- Enables temporal effects and simulations

The two feedback nodes expose a **Reset input pin** in addition to their panel button, so any scalar signal (a Trigger on an audio envelope, a MIDI control, a mouse click) can clear the accumulated state on a rising edge.

### Control Pins

The Reset pins on Compute Feedback and Feedback Field are **control pins**: they carry a CPU-side scalar signal rather than a texture. They are evaluated once per frame on the CPU (like Hold and Count), not per pixel on the GPU.

---

## Performance Tips

### Resolution Settings

Lower resolutions = better performance:
- **Preview**: 256 or 512
- **Final**: 1024

### Node Count

Limit compute nodes per graph:
- **Recommended**: 2-5 compute nodes
- **Maximum**: 10 compute nodes (performance may degrade)

### Expensive Operations

Most expensive compute nodes:
1. **Fluid Simulation** - Complex physics simulation
2. **Reaction Diffusion** - Multiple passes
3. **Compute Particles** - Many particles
4. **Compute Blur** - Large radius blur

### Optimization Strategies

1. **Reduce resolution** for preview
2. **Lower octaves** in noise nodes
3. **Use lower quality** in blur
4. **Limit particle count** in particle systems

---

## Common Patterns

### Pattern 1: Animated Noise Background

```
Compute Noise (scale: 4.0, speed: 0.2)
    ↓
Texture Sample
    ↓
ColorRamp
    ↓
Output
```

### Pattern 2: Blurred Pattern

```
[Your Pattern]
    ↓
Compute Blur (radius: 8.0)
    ↓
Output
```

### Pattern 3: Beat-Reset Feedback Trail

```
[Your Pattern] → Compute Feedback → Texture Sample → Output
                        ↑ Reset
Audio Envelope → Trigger
```

The trail accumulates continuously and clears every time the audio envelope crosses the trigger threshold.

### Pattern 4: Reaction-Diffusion Pattern

```
Reaction Diffusion (pattern: Coral)
    ↓
Texture Sample
    ↓
ColorRamp
    ↓
Output
```

---

## Troubleshooting

### Black Output

**Problem:** Compute node shows black preview

**Solutions:**
- Check that compute node is connected to a fragment shader
- Verify parameters are set correctly
- Check resolution isn't too low (try 256 minimum)
- Look for errors in browser console (F12)

### Low Performance

**Problem:** Frame rate drops when using compute nodes

**Solutions:**
- Reduce resolution (try 256)
- Lower octaves/iterations
- Reduce particle count
- Close other GPU-intensive applications
- Check GPU usage in Task Manager

### Feedback Not Working

**Problem:** Feedback effects don't accumulate

**Solutions:**
- Check decay isn't 0 (a decay of 0 clears the trail every frame)
- Make sure nothing is pulsing the Reset pin every frame
- Verify node is executing every frame
- Check browser console for errors

### Texture Not Updating

**Problem:** Compute texture doesn't change over time

**Solutions:**
- Ensure time-based parameters (speed, animate) are set
- Check that node is marked as "dirty" when parameters change
- Verify compute shader is re-dispatched each frame
- Check for caching issues

---

## Advanced Usage

### Multiple Compute Nodes

You can chain multiple compute nodes:

```
Compute Noise → Compute Blur → Texture Sample → Output
```

The system automatically handles execution order.

### Combining with Fragment Nodes

Compute nodes work seamlessly with fragment nodes:

```
UV → Circle
    ↓
Compute Blur → Texture Sample
    ↓
Blend → Output
```

### Parameter Expressions

Compute nodes support parameter expressions:

- `scale: "=sin(time) * 5 + 5"` - Animated scale
- `speed: "=time * 0.1"` - Time-based speed
- `radius: "=audioEnvelope * 10"` - Audio-reactive blur

See [Parameter Expressions](parameter-expressions.md) for more details.

---

## See Also

- [Node Reference](node-reference.md) - Full pin/parameter listings for every compute node
- [Parameter Expressions](parameter-expressions.md) - Animate compute node parameters
- [Performance Tips](performance.md) - Optimize your graphs
- [3D Field Visualization](field-visualization.md) - Visualize compute outputs in 3D
- [Compute Node API](../COMPUTE_NODE_API.md) - Developer reference
