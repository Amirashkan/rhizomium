# Working with Textures

Load, use, and manipulate image textures in your node graphs. Create rich, detailed visuals by combining procedural generation with real images.

---

## Quick Start

### Step 1: Add a Texture Node

1. Right-click canvas → **Input** → **Texture 2D**
2. Click to place the texture node

### Step 2: Load an Image

1. Click on the Texture 2D node
2. Click **Choose File** or **Browse** button
3. Select an image file (PNG, JPG, WebP supported)
4. Image loads and appears in preview!

### Step 3: Connect to Shader

1. Connect **UV** node to Texture 2D input
2. Connect Texture 2D output to your shader
3. Image appears in your visual!

**Basic pattern:**
```
UV → Texture 2D → Output
```

---

## Texture Node Types

### Texture 2D

Standard 2D image texture for flat images.

**Use cases:**
- Photos and artwork
- Patterns and textures
- Backgrounds
- Image-based effects

**Outputs:**
- **RGBA** - Full color with alpha channel
- **RGB** - Color channels only
- **R, G, B, A** - Individual channels

### Texture Cube

Cubemap texture for environment mapping.

**Use cases:**
- Skyboxes
- Environment reflections
- 360° images

**Inputs:**
- **Dir** - 3D direction vector for sampling

**Note:** Requires cubemap image format (6 faces or equirectangular)

---

## Texture Parameters

### Wrap Modes

Control how texture repeats at edges:

#### Repeat
Texture tiles infinitely (default)

**Use for:** Patterns, seamless textures

#### Clamp
Edges extend to boundary

**Use for:** Photos, non-repeating images

#### Mirror
Texture mirrors at edges

**Use for:** Symmetrical patterns

**Settings:**
- **Wrap U** - Horizontal wrapping (repeat/clamp/mirror)
- **Wrap V** - Vertical wrapping (repeat/clamp/mirror)

### Filter Modes

Control texture quality when scaled:

#### Linear
Smooth interpolation (default)

**Use for:** Most cases, smooth scaling

#### Nearest
Pixel-perfect, no interpolation

**Use for:** Pixel art, retro games, sharp edges

**Settings:**
- **Filter** - linear or nearest

---

## Common Patterns

### Pattern 1: Simple Texture Display

```
UV → Texture 2D → Output
```

Displays texture as-is.

### Pattern 2: Tiled Texture

```
UV → Tile (Scale: 4) → Texture 2D → Output
```

Repeats texture 4x4 times.

### Pattern 3: Distorted Texture

```
UV → Displacement → Texture 2D → Output
```

Applies distortion to texture sampling.

### Pattern 4: Texture with Color Overlay

```
UV → Texture 2D → Color Mix → Output
UV → Gradient → [Blend Color]
```

Blends texture with procedural color.

### Pattern 5: Masked Texture

```
UV → Texture 2D → [Base]
UV → Circle → [Mask]
    ↓
Blend → Output
```

Uses shape as mask for texture.

---

## Texture Manipulation

### Scaling

**Make texture larger/smaller:**

```
UV → Scale (Scale: 2.0) → Texture 2D → Output
```

- Scale > 1.0 = Zoom in (texture appears larger)
- Scale < 1.0 = Zoom out (texture appears smaller)

### Rotation

**Rotate texture:**

```
UV → Rotate (Angle: 45°) → Texture 2D → Output
```

### Offset

**Pan texture:**

```
UV → Translate (X: 0.2, Y: 0.1) → Texture 2D → Output
```

### Tiling

**Repeat texture:**

```
UV → Tile (X: 3, Y: 2) → Texture 2D → Output
```

Creates 3x2 grid of texture.

---

## Combining Textures

### Blend Modes

**Mix two textures:**

```
UV → Texture A → [Base]
UV → Texture B → [Blend]
    ↓
Blend (Mode: Multiply) → Output
```

**Blend modes:**
- **Mix** - Linear blend
- **Multiply** - Darken
- **Screen** - Lighten
- **Overlay** - Contrast
- **Add** - Brighten
- **Subtract** - Darken

### Masking

**Use one texture to mask another:**

```
UV → Texture A → [Base]
UV → Texture B → [Mask]
    ↓
Blend → Output
```

### Channel Extraction

**Use individual channels:**

```
UV → Texture 2D → R Channel → Output
```

Extract red channel as grayscale.

---

## Texture Effects

### Color Adjustments

**Adjust texture colors:**

```
UV → Texture 2D → Brightness → Contrast → Saturation → Output
```

### Inversion

**Invert texture colors:**

```
UV → Texture 2D → Invert Color → Output
```

### Grayscale

**Convert to grayscale:**

```
UV → Texture 2D → To Grayscale → Output
```

### Posterization

**Reduce color levels:**

```
UV → Texture 2D → Posterize (Steps: 4) → Output
```

---

## Performance Tips

### Image Size

**Optimize texture resolution:**
- **Preview**: 512x512 or 1024x1024
- **Final**: 2048x2048 or 4096x4096
- **Avoid**: Very large images (>4096px) unless needed

### Compression

**Use compressed formats:**
- **WebP** - Best compression, good quality
- **PNG** - Lossless, larger files
- **JPG** - Lossy, smaller files

### Multiple Textures

**Limit texture count:**
- **Recommended**: 2-5 textures per graph
- **Maximum**: 10 textures (performance may degrade)
- **Optimize**: Reuse textures when possible

### Filter Mode

**Choose appropriate filter:**
- **Linear** - Smooth but slightly slower
- **Nearest** - Faster, pixel-perfect

---

## Supported Formats

### Image Formats

- ✅ **PNG** - Lossless, supports transparency
- ✅ **JPG/JPEG** - Lossy, smaller files
- ✅ **WebP** - Modern, best compression
- ✅ **GIF** - Animated (static frames only)

### File Size Limits

- **Browser**: Usually 5-10MB per image
- **Recommended**: Under 2MB for best performance
- **Maximum**: Depends on browser/device

---

## Troubleshooting

### Texture Not Loading

**Problem:** Image doesn't appear

**Solutions:**
- Check file format is supported
- Verify file isn't corrupted
- Check file size isn't too large
- Try different image format
- Check browser console for errors (F12)

### Texture Looks Blurry

**Problem:** Image appears low quality

**Solutions:**
- Use higher resolution source image
- Check filter mode (use Linear)
- Verify texture isn't being scaled down
- Check preview resolution settings

### Texture Too Large/Small

**Problem:** Image size is wrong

**Solutions:**
- Use Scale node to adjust size
- Check UV coordinates
- Verify texture resolution
- Adjust tiling settings

### Performance Issues

**Problem:** Slow with textures

**Solutions:**
- Reduce texture resolution
- Use fewer textures
- Compress images (WebP)
- Use Nearest filter mode
- Close other applications

### Transparency Not Working

**Problem:** PNG transparency shows as black

**Solutions:**
- Verify PNG has alpha channel
- Check blend mode settings
- Ensure Output node supports alpha
- Try different image format

---

## Advanced Usage

### Animated Textures

**Animate texture parameters:**

```
UV → Translate (X: "=time * 0.1") → Texture 2D → Output
```

Texture scrolls horizontally!

### Audio-Reactive Textures

**Control texture with audio:**

```
UV → Scale ("=audioEnvelope * 2 + 1") → Texture 2D → Output
```

Texture scales with audio!

### Procedural + Texture Mix

**Combine procedural and image:**

```
UV → Noise → [Base]
UV → Texture 2D → [Blend]
    ↓
Blend → Output
```

### Texture as Displacement Map

**Use texture for displacement:**

```
UV → Texture 2D (G Channel) → Displacement → [Other Pattern]
```

---

## Tips & Tricks

### Seamless Textures

**Create tiling textures:**
- Use seamless/tileable images
- Enable Repeat wrap mode
- Test tiling before using

### Texture Atlases

**Use texture atlases:**
- Pack multiple images into one texture
- Use UV coordinates to select region
- More efficient than multiple textures

### Mipmaps

**Automatic quality levels:**
- Browser generates mipmaps automatically
- Better quality at distance
- No manual setup needed

### Color Space

**sRGB vs Linear:**
- Most textures are sRGB
- System handles conversion automatically
- No manual adjustment needed

---

## See Also

- [Node Reference](node-reference.md) - Complete node documentation
- [Transform Nodes](node-reference.md#transform-nodes) - UV manipulation
- [Blend Nodes](node-reference.md#blend-nodes) - Combining textures
- [Performance Tips](performance.md) - Optimize texture usage

