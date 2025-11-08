# Noise Field Preset

A procedural noise generator using multi-octave Perlin noise with Fractal Brownian Motion (FBM). Creates organic, animated patterns perfect for backgrounds, distortion maps, or displacement fields.

## Overview

This preset demonstrates a single **ComputeNoise** node that generates smooth, animated noise patterns. The noise evolves continuously over time and can be configured to produce either colorful rainbow patterns or grayscale values.

## Node Configuration

### ComputeNoise Node
- **Inputs**: None (procedural generator)
- **Outputs**:
  - `Texture` - Full RGBA texture
  - `RGB` - Combined color channels
  - `R`, `G`, `B`, `A` - Individual channels

### Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `scale` | 8.0 | 0.1 - 50.0 | Frequency of noise pattern (higher = more detail) |
| `octaves` | 5 | 1 - 8 | Number of noise layers (more = richer detail, slower) |
| `speed` | 0.1 | 0.0 - 2.0 | Animation speed |
| `colorize` | true | boolean | Enable rainbow coloring (false = grayscale) |
| `resolution` | 512 | 256/512/1024 | Output texture resolution |

## Usage Examples

### Basic Setup
1. Load the preset JSON using PresetManager
2. The ComputeNoise node will be created automatically
3. Connect the `Texture` output to any fragment shader node
4. Press play to see animated noise

### As a Displacement Source
1. Set `colorize` to `false` for grayscale output
2. Connect `R` output to displacement/distortion nodes
3. Adjust `scale` to control displacement frequency

### Chaining with Other Nodes
```
ComputeNoise → ComputeBlur → Fragment Shader
ComputeNoise → ComputeFeedback → Output
```

## Shader Details

The WGSL shader (`noise.wgsl`) implements:
- **Hash function**: Pseudo-random number generation
- **2D Perlin noise**: Smooth interpolated noise
- **FBM (Fractal Brownian Motion)**: Layering multiple octaves
- **Swirl effect**: Adds organic motion to the pattern
- **HSV to RGB**: Colorization with rainbow spectrum

### Performance Notes
- Workgroup size: 8x8 threads
- Each octave doubles computation time
- 512x512 resolution recommended for real-time
- Use 256x256 for better performance on lower-end GPUs

## Customization Tips

1. **Slow organic motion**: Set `speed` to 0.05, `octaves` to 6-7
2. **Fast turbulence**: Set `speed` to 0.5+, `scale` to 15+
3. **Large smooth clouds**: Set `scale` to 2-4, `octaves` to 3
4. **Fine grain detail**: Set `scale` to 20+, `octaves` to 8

## Technical Implementation

The preset follows Rhizomium's compute node architecture:
- Uniforms struct with WebGPU-aligned padding
- Compute shader with @workgroup_size(8, 8)
- Writes to `texture_storage_2d<rgba8unorm, write>`
- Time-based animation through `uniforms.time`

## See Also
- [ComputeBlur](../blur_field/) - Blur the noise output
- [ReactionDiffusion](../reaction_diffusion/) - Complex pattern generation
- [ComputeFeedback](../../docs/nodes/ComputeFeedback.md) - Create feedback loops
