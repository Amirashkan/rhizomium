# Compute Nodes

Learn how to use GPU-accelerated compute shaders to create powerful visual effects and simulations.

---

## What Are Compute Nodes?

Compute nodes are **GPU-accelerated pre-processing nodes** that run before your fragment shader. They execute in parallel workgroups on your GPU, making them perfect for:

- **Particle systems** - Thousands of particles simulated in real-time
- **Reaction-diffusion** - Organic patterns and textures
- **Fluid simulation** - Smoke, ink, and water effects
- **Cellular automata** - Game of Life and emergent patterns
- **Noise generation** - Complex procedural noise textures
- **Blur effects** - Fast Gaussian blur and depth of field

---

## Quick Start

### Step 1: Add a Compute Node

1. Right-click on the canvas
2. Navigate to **Compute** → Choose a compute node (e.g., **ComputeNoise**)
3. Click to place it on the canvas

### Step 2: Connect to Fragment Shader

Compute nodes output textures that can be sampled in your fragment shader:

```
ComputeNoise → Texture Sample → Output
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

### ComputeNoise

Generates animated procedural noise using Fractal Brownian Motion.

**Use cases:**
- Animated backgrounds
- Cloud patterns
- Organic textures

**Key Parameters:**
- `scale` - Noise frequency (default: 8.0)
- `octaves` - Detail layers (default: 4)
- `speed` - Animation speed (default: 0.1)
- `colorize` - Enable color output (default: false)

**Example:**
```
ComputeNoise (scale: 5.0, octaves: 6) → Texture Sample → Output
```

### ComputeBlur

Applies fast Gaussian blur to input textures.

**Use cases:**
- Depth of field effects
- Glow effects
- Soft shadows

**Key Parameters:**
- `radius` - Blur radius (default: 5.0)
- `iterations` - Quality (default: 1)

**Example:**
```
[Your Pattern] → ComputeBlur (radius: 10.0) → Output
```

### ComputeParticles

GPU-accelerated particle system with physics simulation.

**Use cases:**
- Particle effects
- Visual effects (VFX)
- Animated particles

**Key Parameters:**
- `count` - Number of particles (default: 1000)
- `speed` - Particle velocity (default: 1.0)
- `gravity` - Gravity strength (default: 0.1)

### ComputeFeedback

Creates feedback loops for trails and kaleidoscope effects.

**Use cases:**
- Trails and motion blur
- Kaleidoscope effects
- Recursive patterns

**Key Parameters:**
- `feedback` - Feedback amount (default: 0.95)
- `decay` - Trail decay rate (default: 0.02)

**Note:** This node uses ping-pong buffers for temporal effects.

### ComputeReactionDiffusion

Simulates Gray-Scott reaction-diffusion patterns.

**Use cases:**
- Organic patterns
- Turing patterns
- Biological textures

**Key Parameters:**
- `feed` - Feed rate (default: 0.055)
- `kill` - Kill rate (default: 0.062)
- `diffusionA` - Diffusion rate A (default: 1.0)
- `diffusionB` - Diffusion rate B (default: 0.5)

**Note:** This node supports feedback for continuous evolution.

### ComputeFluidSim

Navier-Stokes fluid simulation.

**Use cases:**
- Smoke effects
- Ink in water
- Fluid dynamics

**Key Parameters:**
- `viscosity` - Fluid viscosity (default: 0.01)
- `velocity` - Flow velocity (default: 1.0)
- `pressure` - Pressure (default: 0.1)

**Note:** Requires feedback for continuous simulation.

### ComputeCellular

Cellular automata simulation (like Game of Life).

**Use cases:**
- Emergent patterns
- Game of Life
- Cellular patterns

**Key Parameters:**
- `rule` - CA rule (default: "B3/S23" for Game of Life)
- `neighborhood` - Cell neighborhood type (default: "moore")

---

## How Compute Nodes Work

### Execution Order

Compute nodes execute **before** your fragment shader:

```
Frame Start
    ↓
1. ComputeNoise executes → Creates texture
2. ComputeBlur executes → Processes texture
    ↓
3. Fragment shader executes → Samples compute textures
    ↓
Frame End
```

The system automatically handles execution order based on dependencies.

### Texture Outputs

Compute nodes output textures in `rgba8unorm` format:
- **Resolution**: Configurable (128x128 to 2048x2048)
- **Format**: RGBA (Red, Green, Blue, Alpha)
- **Usage**: Can be sampled in fragment shaders

### Feedback Loops

Some compute nodes (Feedback, ReactionDiffusion, FluidSim, Cellular) support **feedback**:
- Uses ping-pong buffers
- Previous frame output becomes next frame input
- Enables temporal effects and simulations

---

## Performance Tips

### Resolution Settings

Lower resolutions = better performance:
- **Preview**: 256x256 or 512x512
- **Final**: 1024x1024 or 2048x2048

### Node Count

Limit compute nodes per graph:
- **Recommended**: 2-5 compute nodes
- **Maximum**: 10 compute nodes (performance may degrade)

### Expensive Operations

Most expensive compute nodes:
1. **ComputeFluidSim** - Complex physics simulation
2. **ComputeReactionDiffusion** - Multiple passes
3. **ComputeParticles** - Many particles
4. **ComputeBlur** - Large radius blur

### Optimization Strategies

1. **Reduce resolution** for preview
2. **Lower octaves** in noise nodes
3. **Use fewer iterations** in blur
4. **Limit particle count** in particle systems
5. **Disable feedback** when not needed

---

## Common Patterns

### Pattern 1: Animated Noise Background

```
ComputeNoise (scale: 4.0, speed: 0.2)
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
ComputeBlur (radius: 8.0)
    ↓
Output
```

### Pattern 3: Particle System

```
ComputeParticles (count: 2000)
    ↓
Texture Sample
    ↓
Output
```

### Pattern 4: Reaction-Diffusion Pattern

```
ComputeReactionDiffusion (feed: 0.055, kill: 0.062)
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
- Check resolution isn't too low (try 256x256 minimum)
- Look for errors in browser console (F12)

### Low Performance

**Problem:** Frame rate drops when using compute nodes

**Solutions:**
- Reduce resolution (try 256x256)
- Lower octaves/iterations
- Reduce particle count
- Close other GPU-intensive applications
- Check GPU usage in Task Manager

### Feedback Not Working

**Problem:** Feedback effects don't accumulate

**Solutions:**
- Ensure feedback parameter > 0
- Check that node supports feedback (Feedback, ReactionDiffusion, FluidSim, Cellular)
- Verify node is executing every frame
- Check browser console for errors

### Texture Not Updating

**Problem:** Compute texture doesn't change over time

**Solutions:**
- Ensure time-based parameters are connected
- Check that node is marked as "dirty" when parameters change
- Verify compute shader is re-dispatched each frame
- Check for caching issues

---

## Advanced Usage

### Multiple Compute Nodes

You can chain multiple compute nodes:

```
ComputeNoise → ComputeBlur → Texture Sample → Output
```

The system automatically handles execution order.

### Combining with Fragment Nodes

Compute nodes work seamlessly with fragment nodes:

```
UV → Circle
    ↓
ComputeBlur → Texture Sample
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

- [Parameter Expressions](parameter-expressions.md) - Animate compute node parameters
- [Performance Tips](performance.md) - Optimize your graphs
- [3D Field Visualization](field-visualization.md) - Visualize compute outputs in 3D
- [Compute Node API](../COMPUTE_NODE_API.md) - Developer reference

