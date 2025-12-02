# Node System

Understanding the node-based architecture of Rhizomium.

---

## Overview

Rhizomium uses a **node-based visual programming system** where you build shader programs by connecting nodes together. Each node performs a specific operation, and the connections between nodes define how data flows through your visual composition.

---

## Node Anatomy

Every node has the same basic structure:

```
┌─────────────────┐
│   Node Title    │  ← Header with node name
├─────────────────┤
│ ○ Input 1    ○  │  ← Input pins (left) and output pins (right)
│ ○ Input 2       │
│                 │
│  [Parameters]   │  ← Adjustable parameters
│  [   slider]    │
└─────────────────┘
```

### Components

- **Header** - The node's name/type. Click to select, drag to move.
- **Input Pins** (left side) - Receive data from other nodes
- **Output Pins** (right side) - Send data to other nodes
- **Parameters** - Adjustable values that control the node's behavior
- **Body** - Contains the parameter controls

---

## Data Flow

Data flows from **left to right** through your node graph:

```
[Input Nodes] → [Processing Nodes] → [Output Node]
     UV       →    Circle/Noise    →    ColorRamp → Output
     Time     →    Math Operations →
```

### Connection Rules

1. **Output → Input**: Always connect from output (right) to input (left)
2. **Type Compatibility**: Pins must have compatible data types
3. **No Cycles**: Nodes cannot connect back to themselves
4. **Multiple Outputs**: One output can feed multiple inputs
5. **Single Inputs**: Each input accepts only one connection

---

## Data Types

Rhizomium uses WGSL data types:

| Type | Description | Example Values |
|------|-------------|----------------|
| **f32** | Single floating-point number | `0.5`, `3.14`, `-1.0` |
| **vec2** | Two numbers (2D vector) | `(0.5, 0.5)`, UV coordinates |
| **vec3** | Three numbers (3D vector/RGB) | `(1.0, 0.5, 0.0)` red-orange |
| **vec4** | Four numbers (RGBA) | `(1.0, 0.0, 0.0, 1.0)` red |

### Type Conversion

Rhizomium automatically converts between compatible types:

- **f32 → vec2/vec3/vec4**: Fills all components with the same value
- **vec2 → vec3/vec4**: Adds default values for missing components
- **vec3 → vec4**: Adds alpha = 1.0
- **vec4 → vec3**: Drops alpha channel

---

## Node Categories

Rhizomium organizes nodes into 8 categories:

### 1. Input Nodes
Provide data sources and constants.

**Examples**: UV, Time, Mouse, Audio, Float constants

**Use**: Starting points for your graph

### 2. Output Nodes
Final rendering output.

**Examples**: Output (the only one!)

**Use**: End point of your graph

### 3. Field Nodes
Generate patterns and procedural content.

**Examples**: Circle, Noise, Voronoi, Gradients

**Use**: Creating visual patterns and shapes

### 4. Math Nodes
Perform mathematical operations.

**Examples**: Add, Multiply, Sin, Cos, Clamp

**Use**: Transforming and combining values

### 5. Utility Nodes
Data manipulation and color operations.

**Examples**: ColorRamp, Remap, Mix, Select

**Use**: Converting and adjusting data

### 6. Blend Nodes
Combine signed distance fields (SDFs).

**Examples**: Union, Intersection, Smooth Blend

**Use**: Combining multiple shapes

### 7. Transform Nodes
Manipulate UV coordinates and space.

**Examples**: Rotate, Scale, Tile, Kaleidoscope

**Use**: Warping and distorting space

### 8. Compute Nodes
GPU-accelerated pre-processing effects.

**Examples**: ComputeNoise, ComputeBlur, ComputeParticles, ReactionDiffusion

**Use**: Particle systems, simulations, complex effects

**Note:** See [Compute Nodes Guide](compute-nodes.md) for detailed information.

---

## Common Workflows

### Basic Pattern Creation

```
UV → Field Node → ColorRamp → Output
```

Create a simple pattern with color.

### Animated Pattern

```
UV → Field Node → \
                   Add → ColorRamp → Output
Time → Sine →     /
```

Add time-based animation to a pattern.

### Layered Composition

```
UV → Field 1 → ColorRamp 1 → \
                              Mix → Output
UV → Field 2 → ColorRamp 2 → /
```

Blend multiple patterns together.

### Space Transformation

```
UV → Transform → Field → ColorRamp → Output
```

Warp space before applying a pattern.

---

## Parameter Types

Nodes can have various parameter types:

### Numeric Parameters
- **float**: Decimal number with slider
- **int**: Integer number
- **boolean**: On/off checkbox

### Selection Parameters
- **select**: Dropdown menu with options
- **mode**: Choose between different algorithms

### Complex Parameters
- **colorstops**: Gradient editor with color stops
- **expr**: Expression input (for Expression node)

---

## Node Tips

### Organizing Your Graph

1. **Left to Right Flow**: Keep inputs on the left, outputs on the right
2. **Group Related Nodes**: Keep connected nodes close together
3. **Use Space**: Don't crowd nodes - spread them out for clarity
4. **Name Important Nodes**: Double-click headers to rename

### Performance Optimization

1. **Minimize Complexity**: Fewer nodes = better performance
2. **Expensive Nodes**: Noise, Voronoi, and FBM are GPU-intensive
3. **Reuse Calculations**: Connect one output to multiple inputs instead of duplicating nodes
4. **Simplify Math**: Combine operations when possible

### Debugging

1. **Isolate Sections**: Disconnect parts of your graph to test
2. **Visualize Intermediate Steps**: Connect intermediate results to Output
3. **Check Value Ranges**: Use Clamp to ensure values stay in bounds
4. **Use Simple Shapes First**: Start with Circle or Gradient before complex patterns

---

## Node Reference

For a complete catalog of all nodes with detailed specifications, see the **[Node Reference](node-reference.md)**.

---

## Next Steps

- **[Node Reference](node-reference.md)** - Complete node catalog
- **[Your First Graph](guide.md)** - Step-by-step tutorial
- **[Shader Compilation](shader-compilation.md)** - How nodes become shaders

---

_Ready to explore? Open the [Node Reference](node-reference.md) to see all available nodes._
