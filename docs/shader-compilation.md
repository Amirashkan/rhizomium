# Shader Compilation

Understanding how Rhizomium transforms your node graph into GPU shaders.

---

## Overview

When you connect nodes in Rhizomium, the system automatically generates **WGSL shader code** that runs on your GPU. This process is called **shader compilation**.

Understanding this process helps you:
- Build more efficient graphs
- Debug shader errors
- Optimize performance
- Appreciate the magic happening behind the scenes

---

## The Compilation Pipeline

### Step 1: Graph Analysis

When you modify your node graph, Rhizomium:

1. **Traverses the graph** from Output node backwards
2. **Identifies all connected nodes** in the render path
3. **Determines evaluation order** (topological sort)
4. **Validates connections** and data types

### Step 2: Code Generation

For each node, the compiler:

1. **Generates WGSL function** based on node type
2. **Handles parameter substitution** with your values
3. **Manages variable naming** to avoid conflicts
4. **Inserts type conversions** where needed

### Step 3: Shader Assembly

The compiler combines all pieces:

1. **Uniforms**: Time, mouse, resolution, parameters
2. **Functions**: Each node becomes a function
3. **Main shader**: Calls functions in correct order
4. **Output**: Final color value

### Step 4: GPU Compilation

The WGSL code is sent to:

1. **Browser's WebGPU implementation**
2. **GPU driver** compiles to native GPU code
3. **GPU hardware** executes for every pixel

---

## Example Transformation

### Your Node Graph

```
UV → Circle → ColorRamp → Output
```

### Generated WGSL Shader

```wgsl
// Uniforms
struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  mouse: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Node functions
fn node_UV(coord: vec2<f32>) -> vec2<f32> {
  return coord;
}

fn node_Circle(uv: vec2<f32>, radius: f32) -> f32 {
  let center = vec2<f32>(0.5, 0.5);
  let dist = length(uv - center);
  return smoothstep(radius, radius + 0.01, dist);
}

fn node_ColorRamp(t: f32) -> vec4<f32> {
  // Interpolate between color stops
  if (t < 0.5) {
    return mix(
      vec4<f32>(0.0, 0.0, 0.0, 1.0),  // Black at 0
      vec4<f32>(1.0, 0.0, 1.0, 1.0),  // Magenta at 0.5
      t * 2.0
    );
  } else {
    return mix(
      vec4<f32>(1.0, 0.0, 1.0, 1.0),  // Magenta at 0.5
      vec4<f32>(1.0, 1.0, 1.0, 1.0),  // White at 1
      (t - 0.5) * 2.0
    );
  }
}

// Main shader
@fragment
fn main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  // Normalize coordinates
  let uv = pos.xy / uniforms.resolution;

  // Execute node graph
  let var_1 = node_UV(uv);
  let var_2 = node_Circle(var_1, 0.3);
  let var_3 = node_ColorRamp(var_2);

  return var_3;
}
```

---

## Shader Components

### 1. Uniforms

Global parameters passed to the shader:

```wgsl
struct Uniforms {
  time: f32,           // Current time in seconds
  resolution: vec2<f32>, // Canvas size in pixels
  mouse: vec2<f32>,    // Mouse position (normalized)
  deltaTime: f32,      // Time since last frame
}
```

### 2. Node Functions

Each node type has a corresponding WGSL function:

```wgsl
// Math node: Add
fn node_Add(a: f32, b: f32) -> f32 {
  return a + b;
}

// Field node: Noise
fn node_Noise(uv: vec2<f32>, scale: f32) -> f32 {
  return noise(uv * scale);  // Calls noise function
}

// Transform node: Rotate
fn node_Rotate(uv: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  let centered = uv - vec2<f32>(0.5);
  return vec2<f32>(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  ) + vec2<f32>(0.5);
}
```

### 3. Helper Functions

Reusable utility functions:

```wgsl
// Perlin noise implementation
fn noise(p: vec2<f32>) -> f32 {
  // Complex noise calculation...
}

// SDF smooth union
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Color space conversion
fn hsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
  // HSV to RGB conversion...
}
```

---

## Optimization Strategies

### 1. Dead Code Elimination

The compiler only includes nodes connected to Output:

```
UV → Circle → ColorRamp → Output  ✅ Included
UV → Noise                        ❌ Not included (disconnected)
```

### 2. Constant Folding

Static calculations are pre-computed:

```wgsl
// Your graph: 2.0 + 3.0
// Compiled: 5.0 (calculated at compile time)
```

### 3. Function Inlining

Simple operations are inlined for performance:

```wgsl
// Before inlining
let result = node_Add(a, b);

// After inlining
let result = a + b;
```

### 4. Type Conversion

Automatic conversions are optimized:

```wgsl
// f32 to vec3
let v = vec3<f32>(value);  // Expands to vec3(value, value, value)
```

---

## Debugging Shaders

### Viewing Generated Code

**Browser Console Method:**
1. Open Developer Tools (F12)
2. Look for shader compilation logs
3. Check for warnings or errors

**Manual Inspection:**
Some versions of Rhizomium allow exporting shader code for inspection.

### Common Compilation Errors

#### Type Mismatch

```
Error: Cannot connect vec2 to f32
```

**Solution**: Use appropriate conversion nodes (e.g., Length, Dot)

#### Undefined Variable

```
Error: Variable 'node_17' not found
```

**Solution**: Check for disconnected nodes or cycles in graph

#### Syntax Error

```
Error: Unexpected token in WGSL
```

**Solution**: Usually a bug - report if you encounter this

---

## Performance Considerations

### GPU-Friendly Patterns

**✅ Good:**
- Simple math operations (add, multiply)
- Texture sampling
- Built-in functions (sin, cos, length)

**⚠️ Moderate:**
- Conditional logic (if/else)
- Loops with low iteration counts

**❌ Expensive:**
- Complex noise functions
- High-iteration loops
- Recursive patterns
- Multiple Voronoi cells

### Shader Complexity

GPU shaders are executed **per pixel**:

- 1920×1080 = 2,073,600 pixels
- At 60 FPS = 124,416,000 calculations/second
- Complex nodes multiply this cost!

**Optimization Tips:**
1. Minimize expensive nodes (Noise, Voronoi)
2. Reuse calculations where possible
3. Simplify math operations
4. Use lower resolution for complex effects

---

## Shader Stages

### Vertex Shader (Hidden)

Rhizomium automatically handles the vertex shader:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
  // Generates fullscreen quad
  // Passes UV coordinates to fragment shader
}
```

### Fragment Shader (Your Nodes)

Your node graph becomes the fragment shader:

```wgsl
@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Your node graph executes here
  // Returns final pixel color
}
```

---

## Advanced Topics

### Texture Binding

Textures require special GPU resources:

```wgsl
@group(1) @binding(0) var texture: texture_2d<f32>;
@group(1) @binding(1) var textureSampler: sampler;

fn node_Texture2D(uv: vec2<f32>) -> vec4<f32> {
  return textureSample(texture, textureSampler, uv);
}
```

### Buffer Management

Node parameters are packed into uniform buffers:

```wgsl
struct NodeParams {
  circle_radius: f32,
  noise_scale: f32,
  colorRampStops: array<ColorStop, 10>,
}
```

### Shader Variants

Some nodes generate different code based on mode:

```wgsl
// ColorRamp in "Linear" mode
return mix(colorA, colorB, t);

// ColorRamp in "Step" mode
return select(colorB, colorA, t < 0.5);

// ColorRamp in "Smooth" mode
let smoothT = smoothstep(0.0, 1.0, t);
return mix(colorA, colorB, smoothT);
```

---

## WGSL vs GLSL

Rhizomium uses **WGSL** (WebGPU Shading Language) instead of GLSL:

| Feature | GLSL | WGSL |
|---------|------|------|
| Syntax | C-like | Rust-like |
| Types | `vec2`, `float` | `vec2<f32>`, `f32` |
| Uniforms | `uniform float` | `var<uniform>` |
| Attributes | `in`, `out` | `@location` |
| Built-ins | `gl_Position` | `@builtin(position)` |

**Why WGSL?**
- Modern, safer design
- Better error messages
- Future-proof (WebGPU standard)
- Better performance potential

---

## Real-Time Compilation

Rhizomium recompiles shaders in real-time as you edit:

1. **Node added/removed** → Recompile
2. **Connection changed** → Recompile
3. **Parameter changed** → Update uniform (no recompile!)

**Hot Reloading:**
- Changes take effect immediately
- No need to restart or refresh
- Smooth editing experience

---

## Next Steps

- **[Node System](nodes.md)** - Understand nodes better
- **[Node Reference](node-reference.md)** - See what code each node generates
- **[Performance Tips](faq.md#performance)** - Optimize your shaders

---

_The GPU is your canvas, nodes are your brush strokes, and shaders are the painting technique._
