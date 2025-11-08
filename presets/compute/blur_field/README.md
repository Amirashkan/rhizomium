# Blur Field Preset

A high-quality Gaussian blur effect that demonstrates compute node chaining. Shows how to connect multiple compute nodes together to build complex processing pipelines.

## Overview

This preset contains **two variations**:

1. **Noise + Blur Chain**: Simple example connecting a noise generator to a blur filter
2. **Dual-Pass Blur**: Optimized technique using separate horizontal and vertical blur passes

Both demonstrate the core concept of chaining compute nodes in Rhizomium.

## Preset 1: Noise + Blur Chain

### Node Graph
```
┌──────────────┐
│ ComputeNoise │ (Noise Source)
└──────┬───────┘
       │ Texture
       ▼
┌──────────────┐
│ ComputeBlur  │ (Blur Effect)
└──────┬───────┘
       │ Texture
       ▼
    Output
```

### Nodes Configuration

#### ComputeNoise (noise_source)
- `scale`: 12.0 - Medium frequency pattern
- `octaves`: 4 - Good detail without excessive computation
- `speed`: 0.08 - Slow, smooth animation
- `colorize`: true - Colorful output
- `resolution`: 512x512

#### ComputeBlur (blur_effect)
- `radius`: 8.0 - Strong blur effect
- `quality`: High - 25 sample Gaussian
- `direction`: Both - Uniform blur

## Preset 2: Dual-Pass Blur (Optimized)

### Node Graph
```
┌──────────────┐
│ ComputeNoise │ (Noise Source)
└──────┬───────┘
       │ Texture
       ▼
┌──────────────┐
│ ComputeBlur  │ (Horizontal Pass)
└──────┬───────┘
       │ Texture
       ▼
┌──────────────┐
│ ComputeBlur  │ (Vertical Pass)
└──────┬───────┘
       │ Texture
       ▼
    Output
```

### Why Dual-Pass?

Separating blur into horizontal and vertical passes is **much more efficient** for large radii:
- **Single-pass**: N × N samples (e.g., 25 × 25 = 625 samples for High quality)
- **Dual-pass**: 2 × N samples (e.g., 25 + 25 = 50 samples)

This is ~12x faster for the same visual quality!

## Parameters Reference

### ComputeBlur Node

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `radius` | float | 5.0 | Blur radius in pixels (0.0 - 20.0) |
| `quality` | select | Medium | Sample count: Low (9), Medium (17), High (25) |
| `direction` | select | Both | Both, Horizontal, or Vertical |

### Input/Output

- **Input**: `Input` - Source texture to blur
- **Outputs**:
  - `Texture` - Full RGBA blurred result
  - `RGB` - Color channels only
  - `R`, `G`, `B`, `A` - Individual channels

## Usage Examples

### Load and Apply Preset

```javascript
// Load preset
const presetData = await fetch('presets/compute/blur_field/preset.json');
const preset = await presetData.json();

// Apply using PresetManager
presetManager.importPresets(preset);
presetManager.applyPreset('preset_blur_field_001');
```

### Building Custom Chains

You can chain blur with other compute nodes:

```
ComputeNoise → ComputeBlur → ComputeFeedback → Output
```

```
ComputeReactionDiffusion → ComputeBlur → Output
```

```
Texture → ComputeBlur → ComputeConvolution → Output
```

## Shader Details

The WGSL shader (`blur.wgsl`) implements:

### Gaussian Blur Algorithm
```
G(x) = (1 / √(2πσ²)) * e^(-x² / 2σ²)
```

Where σ (sigma) = radius / 2.0

### Sample Counts by Quality
- **Low**: 9 samples (radius ±4 pixels)
- **Medium**: 17 samples (radius ±8 pixels)
- **High**: 25 samples (radius ±12 pixels)

### Texture Sampling
- Uses `textureSample()` with bilinear filtering
- Weights normalized to preserve brightness
- Clamps to texture boundaries automatically

## Performance Tips

1. **For large radii (>10)**: Use dual-pass technique
2. **Real-time**: Use Medium quality at 512x512
3. **Offline/export**: Use High quality at 1024x1024
4. **Subtle effects**: Use Low quality with small radius

### Benchmark Guide (RTX 3060)
| Resolution | Quality | Radius | FPS |
|------------|---------|--------|-----|
| 512×512 | Medium | 5 | ~240 |
| 512×512 | High | 10 | ~120 |
| 1024×1024 | High | 15 | ~45 |

## Customization Ideas

1. **Glow Effect**: Blur with low decay, add to original
2. **Depth of Field**: Use blur + mask texture
3. **Bloom**: Extract bright pixels → blur → composite
4. **Motion Blur**: Blur with directional offset
5. **Soft Shadows**: Blur shadow map texture

## Technical Notes

### WebGPU Bindings
```wgsl
@group(0) @binding(0) var<uniform> uniforms;      // Parameters
@group(0) @binding(1) var inputTexture;           // Source
@group(0) @binding(2) var texSampler;             // Sampler
@group(0) @binding(3) var outputTexture;          // Result
```

### Workgroup Size
- 8×8 threads per workgroup
- Optimized for most modern GPUs
- Total threads = (width/8) × (height/8) workgroups

## See Also
- [NoiseField](../noise_field/) - Generate source textures
- [ReactionDiffusion](../reaction_diffusion/) - Complex patterns to blur
- [ComputeFeedback](../../docs/nodes/ComputeFeedback.md) - Create trails with blur
