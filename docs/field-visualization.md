# 3D Field Visualization

Visualize compute shader outputs as 3D objects! Convert 2D and 3D fields into point clouds, meshes, and volumetric visualizations.

---

## What is Field Visualization?

Field visualization converts **compute shader outputs** (textures) into **3D geometry** that you can view and interact with in a 3D viewport. Perfect for:

- **Volumetric data** - 3D noise, clouds, smoke
- **Scientific visualization** - Data analysis, simulations
- **Artistic effects** - Abstract 3D forms, organic shapes
- **Interactive exploration** - Navigate through 3D space

---

## Quick Start

### Step 1: Create a Compute Shader

1. Add a compute node (e.g., **ComputeNoise**)
2. Configure it to generate field data
3. Set resolution (e.g., 64x64x64 for 3D)

### Step 2: Add Field Mapper

1. Right-click canvas → **Compute** → **ComputeFieldMapper**
2. Place it near your compute node
3. **Connect**: ComputeNoise → ComputeFieldMapper

**Important:** Do NOT connect ComputeFieldMapper to OutputFinal. It outputs 3D geometry, not 2D shader data!

### Step 3: Configure Visualization

1. Click on ComputeFieldMapper node
2. Set **Mapping Mode**:
   - **Points** - Point cloud visualization
   - **Surface** - Mesh generation (marching cubes)
   - **Volume** - Volumetric rendering (future)

### Step 4: View in 3D

1. Press **Ctrl+3** to open 3D viewport
2. Your field appears as 3D geometry!
3. Use mouse to orbit, pan, and zoom

---

## Visualization Modes

### Point Cloud Mode

**Visualizes field values as individual points:**

- Each field cell above threshold becomes a point
- Points colored based on field value
- Great for: Particle effects, sparse data, preview

**Settings:**
- **Threshold** - Minimum value to show point (0.0-1.0)
- **Point Size** - Size of each point
- **Sample Rate** - Sample every N cells (1 = all cells)

**Example:**
```
ComputeNoise → ComputeFieldMapper (Mode: Points, Threshold: 0.3)
```

### Surface Mode (Marching Cubes)

**Converts field to triangle mesh:**

- Extracts isosurface using marching cubes algorithm
- Creates smooth, continuous surfaces
- Great for: Solid objects, organic shapes, detailed visualization

**Settings:**
- **Iso-threshold** - Surface extraction value (0.0-1.0)
- **Sample Rate** - Resolution of mesh (lower = higher quality)
- **Smooth Normals** - Enable smooth shading

**Example:**
```
ComputeNoise → ComputeFieldMapper (Mode: Surface, Iso-threshold: 0.5)
```

### Volume Mode

**Volumetric rendering (coming soon):**

- Renders field as semi-transparent volume
- Shows internal structure
- Great for: Clouds, smoke, dense data

---

## Field Configuration

### Dimensions

Set the size of your field:

- **Width** - X dimension (default: 64)
- **Height** - Y dimension (default: 64)
- **Depth** - Z dimension (default: 64, for 3D)

**Performance tip:** Lower dimensions = faster generation, less detail

### World Space Bounds

Define how field maps to 3D world coordinates:

- **Min X/Y/Z** - Minimum world coordinates (default: -1, -1, -1)
- **Max X/Y/Z** - Maximum world coordinates (default: 1, 1, 1)

**Example:**
- Field cell (0,0,0) → World position (-1, -1, -1)
- Field cell (64,64,64) → World position (1, 1, 1)
- Field cell (32,32,32) → World position (0, 0, 0)

---

## Color Mapping

### Color Modes

Choose how points/vertices are colored:

#### Solid
Single color for all geometry

**Settings:**
- **Color** - RGB color value

#### Gradient
Interpolate between two colors

**Settings:**
- **Color A** - Start color
- **Color B** - End color
- **Color Scale** - Scaling factor

#### Field
Map field values to colors

**Settings:**
- **Color Scale** - Value range mapping
- Uses field value directly for coloring

### Color Examples

**Gradient from blue to red:**
- Color A: (0, 0, 1) - Blue
- Color B: (1, 0, 0) - Red
- Creates smooth color transition

**Field-based coloring:**
- Color Mode: Field
- Field values map directly to colors
- High values = bright, low values = dark

---

## Displacement

**Displace geometry along an axis:**

Creates height map effects and adds depth to flat fields.

**Settings:**
- **Displacement Scale** - How much to displace (0.0-1.0)
- **Displacement Axis** - X, Y, or Z axis

**Example:**
- Displacement Scale: 0.5
- Displacement Axis: Y
- Points move up/down based on field value

---

## Update Frequency

Control how often visualization regenerates:

- **Every Frame** - Regenerate every frame (smooth but expensive)
- **On Change** - Regenerate only when parameters change (default)
- **Manual** - Regenerate only when triggered

**Performance tip:** Use "On Change" for static fields, "Every Frame" for animated fields

---

## 3D Viewport Controls

### Camera Controls

**Orbit:**
- **Left Mouse Drag** - Rotate around target
- **Mouse Wheel** - Zoom in/out
- **Right Mouse Drag** - Pan camera

**Touch:**
- **1 Finger Drag** - Orbit
- **2 Finger Pinch** - Zoom
- **2 Finger Drag** - Pan

### Viewport Settings

- **Perspective/Orthographic** - Switch projection mode
- **Reset Camera** - Return to default view
- **Frame All** - Fit all geometry in view

---

## Common Workflows

### Workflow 1: Simple Point Cloud

1. Add ComputeNoise node
2. Add ComputeFieldMapper
3. Set Mode: Points
4. Set Threshold: 0.3
5. Open 3D viewport (Ctrl+3)
6. Adjust threshold to see more/fewer points

### Workflow 2: Smooth Surface

1. Add ComputeNoise node
2. Add ComputeFieldMapper
3. Set Mode: Surface
4. Set Iso-threshold: 0.5
5. Enable Smooth Normals
6. Open 3D viewport
7. Adjust iso-threshold to change surface shape

### Workflow 3: Animated Field

1. Add ComputeNoise with time-based animation
2. Add ComputeFieldMapper
3. Set Update Frequency: Every Frame
4. Open 3D viewport
5. Watch geometry animate in real-time!

### Workflow 4: Colored Visualization

1. Create compute field
2. Add ComputeFieldMapper
3. Set Color Mode: Gradient
4. Set Color A: Blue, Color B: Red
5. Adjust Color Scale for intensity
6. View colored geometry in 3D

---

## Performance Optimization

### Field Resolution

**Lower = Faster:**
- **Preview**: 32x32x32 or 64x64x64
- **Final**: 128x128x128 or 256x256x256
- **High Quality**: 512x512x512 (may be slow)

### Sample Rate

**Higher = Faster:**
- Sample Rate 1 = All cells (slowest, best quality)
- Sample Rate 2 = Every 2nd cell (2x faster)
- Sample Rate 4 = Every 4th cell (4x faster)

### Update Frequency

**On Change = Faster:**
- Use "On Change" for static fields
- Use "Every Frame" only when needed
- Use "Manual" for one-time generation

### Threshold Filtering

**Higher threshold = Fewer points:**
- Threshold 0.0 = All points (slow)
- Threshold 0.5 = Half points (faster)
- Threshold 0.8 = Few points (fastest)

---

## Troubleshooting

### Black/Empty Viewport

**Problem:** 3D viewport shows nothing

**Solutions:**
- Check ComputeFieldMapper is connected to compute node
- Verify compute node is executing (check profiler)
- Check threshold/iso-threshold values
- Try different mapping mode
- Check browser console for errors (F12)

### Geometry Not Updating

**Problem:** Changes don't appear in 3D view

**Solutions:**
- Set Update Frequency to "Every Frame"
- Manually trigger regeneration
- Check compute node parameters changed
- Verify field mapper is receiving data

### Low Performance

**Problem:** 3D viewport is slow

**Solutions:**
- Reduce field dimensions (64x64x64 → 32x32x32)
- Increase sample rate (1 → 2 or 4)
- Increase threshold to show fewer points
- Use "On Change" update frequency
- Close other applications

### Wrong Colors

**Problem:** Colors don't match expectations

**Solutions:**
- Check color mode setting
- Verify color values (0-1 range)
- Check color scale setting
- Try different color mode

### Geometry Distorted

**Problem:** 3D shape looks wrong

**Solutions:**
- Check world space bounds match compute field
- Verify field dimensions are correct
- Check iso-threshold value
- Try different mapping mode

---

## Advanced Usage

### Combining Multiple Fields

**Visualize multiple compute outputs:**

1. Create multiple compute nodes
2. Add multiple ComputeFieldMapper nodes
3. Each mapper visualizes one field
4. All appear in same 3D viewport!

### Custom Shaders

**Use custom compute shaders:**

1. Create custom compute node
2. Output field data to texture
3. Connect to ComputeFieldMapper
4. Visualize custom data!

### Export Geometry

**Export 3D models (coming soon):**

- Export as OBJ file
- Export as GLTF
- Use in other 3D software

---

## Tips & Tricks

### Exploration

- **Orbit around** to see geometry from all angles
- **Zoom in** to see fine details
- **Adjust threshold** to explore different value ranges
- **Change color mode** to highlight different features

### Animation

- **Animate compute parameters** for moving geometry
- **Use time-based expressions** for continuous animation
- **Record with timeline** for synchronized effects

### Composition

- **Combine multiple fields** for complex scenes
- **Use different modes** (points + surface) together
- **Layer visualizations** for depth

---

## See Also

- [Compute Nodes](compute-nodes.md) - Create fields to visualize
- [Camera Controls](camera-controls.md) - Advanced 3D navigation
- [Parameter Expressions](parameter-expressions.md) - Animate field parameters
- [Performance Tips](performance.md) - Optimize visualization performance

