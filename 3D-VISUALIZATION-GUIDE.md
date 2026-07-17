# 3D Visualization Guide (ComputeFieldMapper)

The **3D Field Visualizer** node (`ComputeFieldMapper`, category *Utility*) turns a
compute shader's output field into live 3D geometry rendered in the floating
3D viewport.

## Quick start

1. Create a compute node (e.g. **ComputeNoise**, **ComputeFeedback**).
2. Create a **3D Field Visualizer** node.
3. Connect: compute node → **Field Input**.
4. The 3D viewport opens automatically the moment the node becomes active
   (toggle it any time with **Ctrl/Cmd+3**).

Do **not** wire the visualizer into OutputFinal — it produces 3D geometry for
the viewport, not 2D shader output. It works fine in a graph that has no
OutputFinal at all.

The visualization updates continuously while the viewport is open: each frame
the node reads the compute texture back, regenerates geometry, and re-renders.
Readbacks are self-throttling — a new one only starts when the previous one
finished — and `updateFrequency` adds an extra per-node throttle (0 = every
opportunity).

## Mapping modes

- **points** — one camera-facing round point per field cell whose value exceeds
  `threshold`. Points are colored by `colorMode` and can be displaced along
  `displacementAxis` by `displacementScale * value`.
- **surface** / **volume** with a 2D field — a heightmap mesh: the field value
  drives vertex height across the Y range of the field bounds, with per-vertex
  normals, lighting, and gradient colors.
- **surface** / **volume** with a 3D texture — marching-cubes isosurface at
  `isoThreshold` (requires a `dimension: '3d'` texture source).

## Parameters

- `width` / `height` / `depth` — the sampling grid. The compute texture is
  nearest-sampled onto this grid (the texture's own resolution can differ).
- `boundsMin*` / `boundsMax*` — world-space box the field maps into.
- `threshold`, `isoThreshold`, `pointSize`, `sampleRate`
- `colorMode` (`solid` / `gradient` / `field`), `colorA*`, `colorB*`,
  `solidColor*`, `colorScaleMin/Max`
- `displacementScale`, `displacementAxis*`
- `updateFrequency` — regenerate every N frames (0 = every frame)

## Viewport controls

- **Ctrl/Cmd+3** — toggle the 3D viewport panel
- Left-drag — orbit · Shift+drag / middle-drag — pan · wheel / right-drag — zoom
- Panel buttons: Reset Camera, Perspective/Orthographic, Frame All
- The panel is draggable by its header and resizable from the corner.

## Console helpers

```javascript
window.addTestCube();          // sanity-check the 3D raster path with a lit cube
window.viewportPanel.toggle(); // show/hide the viewport
window.fieldMapperIntegration; // inspect live field mappers
```

## Architecture

```
graph edit ──► updateShaderFromGraph ──► FieldMapperIntegration.processFieldMappers
                                          (create/update/remove mappers, auto-show viewport)
render loop (viewport visible) ──► FieldMapperIntegration.updateFrame
                                     └► PointCloudGenerator.readFieldSlice   (GPU→CPU readback)
                                     └► FieldVisualizer (points / heightmap / marching cubes)
                              ──► SceneRenderer3D.render
                                     └► MeshRenderer (indexed geometry, lit vertex colors)
                                     └► PointCloudRenderer (instanced billboard quads)
```

Key implementation notes:

- Compute textures are **rgba8unorm**; readback honors the 256-byte
  `bytesPerRow` alignment and decodes the red channel (bgra and float formats
  are also supported).
- `MeshRenderer` / `PointCloudRenderer` are instantiated **per field-mapper
  node** (they own their GPU buffers; `queue.writeBuffer` ordering makes shared
  instances draw only the last-written geometry).
- WGSL has no point-size builtin, so points are drawn as 4-vertex
  triangle-strip quads expanded in view space, instanced per point.
