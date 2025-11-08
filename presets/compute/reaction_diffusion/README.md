# Reaction-Diffusion Preset

A Gray-Scott reaction-diffusion simulation that creates stunning organic patterns like coral, spots, stripes, and waves. Demonstrates the emergence of complex structures from simple mathematical rules.

## Overview

This preset implements the Gray-Scott model, a two-chemical reaction-diffusion system. Two virtual chemicals (A and B) diffuse and react according to:
- Reaction: A + 2B → 3B
- Feed: Chemical A is constantly added
- Kill: Chemical B is constantly removed

The interplay of diffusion rates, feed rates, and kill rates creates a rich variety of patterns.

## Science Background

### The Gray-Scott Model

The system is governed by partial differential equations:

```
∂A/∂t = Da∇²A - AB² + f(1-A)
∂B/∂t = Db∇²B + AB² - (k+f)B
```

Where:
- `Da`, `Db` = Diffusion coefficients for chemicals A and B
- `f` = Feed rate (how fast A is replenished)
- `k` = Kill rate (how fast B is removed)
- `∇²` = Laplacian operator (measures diffusion)

### Pattern Formation

Different parameter combinations produce distinct patterns:

| Pattern | Feed (f) | Kill (k) | Character |
|---------|----------|----------|-----------|
| Coral | 0.0545 | 0.062 | Branching structures, nature-inspired |
| Spots | 0.055 | 0.062 | Leopard-like spots, stable |
| Stripes | 0.035 | 0.065 | Zebra-like stripes, elongated |
| Waves | 0.014 | 0.054 | Rippling wave fronts, dynamic |
| Worms | 0.078 | 0.061 | Wriggling worm-like patterns |
| Mitosis | 0.0367 | 0.0649 | Dividing cell-like structures |
| Spirals | 0.028 | 0.062 | Spiral galaxies, swirls |

## Presets Included

### 1. Coral Pattern
Classic coral-reef-like branching structures. Highly organic appearance.

### 2. Leopard Spots
Stable spots similar to animal fur patterns. Great for textures.

### 3. Zebra Stripes
Linear stripe patterns that can curve and bend naturally.

### 4. Wave Propagation
Dynamic wave fronts that propagate across the field.

### 5. Worms Pattern
Writhing, worm-like structures that continuously evolve.

### 6. RD + Blur + Feedback Chain
**Advanced example showing node chaining:**

```
┌────────────────────┐
│ ReactionDiffusion  │ (Pattern Generator)
└─────────┬──────────┘
          │ Texture
          ▼
┌────────────────────┐
│   ComputeBlur      │ (Smooth the pattern)
└─────────┬──────────┘
          │ Texture
          ▼
┌────────────────────┐
│ ComputeFeedback    │ (Add trails and persistence)
└─────────┬──────────┘
          │ Texture
          ▼
        Output
```

This creates smooth, trailing patterns with beautiful motion.

## Parameters Reference

### ComputeReactionDiffusion Node

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `pattern` | select | Coral | 7 presets | Quick preset selector |
| `feedRate` | float | 0.0545 | 0.0 - 0.1 | Feed rate (f) |
| `killRate` | float | 0.062 | 0.0 - 0.1 | Kill rate (k) |
| `diffusionA` | float | 1.0 | 0.5 - 2.0 | Diffusion rate for A |
| `diffusionB` | float | 0.5 | 0.1 - 1.0 | Diffusion rate for B |
| `timestep` | float | 1.0 | 0.01 - 5.0 | Simulation speed |
| `resolution` | select | 512 | 256/512/1024 | Grid resolution |

### Outputs
- `Texture` - Full RGBA visualization
- `RGB` - Color representation of concentration

## Usage Guide

### Basic Usage

1. Load preset using PresetManager
2. Select a pattern from the dropdown
3. Wait 5-10 seconds for pattern to emerge and stabilize
4. Adjust feed/kill rates to explore variations

### Custom Parameter Exploration

The parameter space is vast! Here are tips for exploration:

**Stable Patterns (spots/stripes):**
- Keep f and k close together (difference < 0.015)
- Range: f = 0.03-0.06, k = 0.05-0.07

**Dynamic Patterns (waves/turbulence):**
- Lower feed rate (f < 0.02)
- Moderate kill rate (k = 0.05-0.06)

**Fast Evolution:**
- Increase `timestep` to 2.0-3.0
- Warning: Too high may cause instability

**Fine Detail:**
- Use 1024×1024 resolution
- Lower timestep (0.5) for stability

### Chaining Examples

```javascript
// Example 1: RD → Blur for smoothing
ComputeReactionDiffusion → ComputeBlur(radius=3)

// Example 2: RD → Feedback for trails
ComputeReactionDiffusion → ComputeFeedback(decay=0.98)

// Example 3: RD → Convolution for edge detection
ComputeReactionDiffusion → ComputeConvolution(kernel='Edge Detect')

// Example 4: Multi-layer composite
RD(Coral) → Layer 1
RD(Waves) → Layer 2 → Blend
```

## Shader Implementation Details

### Algorithm Steps

1. **Initialization**: Random seed points for chemical B
2. **Diffusion Calculation**: 3×3 Laplacian kernel
   - Cross neighbors: weight 0.2
   - Diagonal neighbors: weight 0.05
   - Center: weight -1.0
3. **Reaction**: Calculate AB² term
4. **Update**: Integrate using Euler method
5. **Visualization**: Map concentrations to colors

### State Management

The shader maintains state between frames using texture ping-pong:
- Frame N reads from state texture
- Computes new concentrations
- Writes to output texture
- Output becomes state for frame N+1

### Color Mapping

Default: Blue (chemical A) → Yellow (chemical B)

```wgsl
blue = vec3(0.1, 0.2, 0.8)
yellow = vec3(0.9, 0.8, 0.1)
color = mix(blue, yellow, b_concentration)
```

Can be customized for different aesthetics.

## Performance Considerations

### Resolution Impact
| Resolution | Memory | Performance |
|------------|--------|-------------|
| 256×256 | 256 KB | ~1000 FPS |
| 512×512 | 1 MB | ~250 FPS |
| 1024×1024 | 4 MB | ~60 FPS |

(Approximate on RTX 3060)

### Optimization Tips

1. **Use 512×512** for real-time VJ performance
2. **Lower timestep** if seeing artifacts (try 0.5)
3. **Disable blur** in chains if framerate drops
4. **Pause simulation** when pattern is stable (cache texture)

## Troubleshooting

### Pattern Doesn't Appear
- Wait longer (10-20 seconds)
- Check feed/kill rates are in valid range
- Increase timestep temporarily to speed up

### Pattern Explodes/Unstable
- Reduce timestep to 0.5 or lower
- Check parameters are within recommended ranges
- Reset simulation by changing resolution

### Pattern Too Simple/Boring
- Increase octaves (if using noise input)
- Try different feed/kill combinations
- Add blur for smoothing
- Chain with feedback for motion

## Mathematical Deep Dive

### Laplacian Discretization

The Laplacian operator ∇² is approximated using finite differences:

```
∇²f ≈ (f[i+1,j] + f[i-1,j] + f[i,j+1] + f[i,j-1] - 4f[i,j]) / h²
```

We use a weighted 9-point stencil for better accuracy:

```
[ 0.05  0.20  0.05 ]
[ 0.20 -1.00  0.20 ] × (1/h²)
[ 0.05  0.20  0.05 ]
```

### Stability Condition

For numerical stability, the timestep must satisfy:

```
Δt < h² / (4 × max(Da, Db))
```

With h = 1/resolution and default diffusion rates, timestep should stay below ~2.0.

## Creative Applications

1. **Organic Textures**: Export stable patterns for 3D materials
2. **VJ Visuals**: Animate with music-reactive parameters
3. **Generative Art**: Record evolution, create time-lapses
4. **Game Effects**: Alien biomes, magic spells, corruption spread
5. **Scientific Visualization**: Pattern formation studies

## References

- Pearson, J.E. (1993). "Complex Patterns in a Simple System"
- Gray & Scott (1983). "Autocatalytic reactions in the CSTR"
- Karl Sims - Reaction-Diffusion Tutorial
- [Online Demonstrations](http://www.karlsims.com/rd.html)

## See Also
- [NoiseField](../noise_field/) - Simpler procedural patterns
- [BlurField](../blur_field/) - Smooth RD outputs
- [ComputeFeedback](../../docs/nodes/ComputeFeedback.md) - Temporal effects
