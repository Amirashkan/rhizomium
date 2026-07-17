# 3D Visualization Guide (ComputeFieldMapper)

The **3D Field Visualizer** node (`ComputeFieldMapper`, category *Utility*) maps a
compute shader's output onto a live 3D shape in the floating viewport.

## Quick start

1. Create a compute node (e.g. **ComputeNoise**, **ComputeFeedback**).
2. Create a **3D Field Visualizer** node.
3. Connect: compute node → **Field Input**.
4. The 3D viewport opens automatically (toggle any time with **Ctrl/Cmd+3**).

You immediately get a **displaced, textured plane** driven by the live compute
field. Do **not** wire the visualizer into OutputFinal — it renders into the 3D
viewport, not the 2D shader chain, and works fine with no OutputFinal at all.

## Shapes

Pick a shape on the node (`shape` parameter) or with the **Shape** dropdown in
the viewport panel:

- **plane / sphere / box / torus** — GPU-direct: the fragment shader colors the
  surface from the compute texture and the vertex shader displaces vertices
  along their normals by the field's luminance. Zero CPU readback, so these
  update at full compute speed every frame.
- **points** — CPU-sampled point cloud: one camera-facing round point per grid
  cell above `threshold`, gradient- or solid-colored, displaced upward by the
  field value. (Uses async GPU→CPU readback; self-throttling.)

## Node parameters

- `shape` — plane / sphere / box / torus / points
- `resolution` — shape tessellation (segments)
- `scale` — shape size in the viewport
- `displacementScale` — how far the field pushes the surface
- `textureAmount` — blend between a neutral lit surface (0) and field colors (1)
- Points only: `threshold`, `pointSize`, `gridSize`, `colorMode`,
  `colorA*`/`colorB*`, `updateFrequency`

Legacy projects that used `mappingMode` load fine: `points` stays points,
`surface`/`volume` map to the plane shape.

## Viewport panel

- **Shape** dropdown — applies to every 3D Field Visualizer node
- **FOV** slider — perspective field of view
- **Spin** — slow turntable auto-rotation (pauses while you orbit)
- **Reset Camera**, **Perspective/Orthographic**
- Left-drag orbit · Shift+drag / middle-drag pan · wheel / right-drag zoom
- Draggable header, resizable corner. **Ctrl/Cmd+3** toggles the panel.

## Live thumbnail

While the viewport is open, the node's thumbnail on the editor canvas mirrors
the rendered 3D view (refreshed ~4×/sec through the shared preview pipeline).

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
render loop (viewport visible)
  ├► FieldMapperIntegration.updateFrame        (points mode only: GPU→CPU readback)
  ├► SceneRenderer3D.render ──► offscreen sceneTexture ──► blit to canvas
  │     ├► ShapeRenderer        (plane/sphere/box/torus: texture sampled in-shader)
  │     ├► PointCloudRenderer   (instanced billboard quads)
  │     └► MeshRenderer         (indexed CPU geometry, e.g. marching cubes)
  └► ShaderPreviewManager.updateNodeThumbnailFromTexture(sceneTexture)  (~4 Hz)
```

Key implementation notes:

- Compute textures are **rgba8unorm**; the points-mode readback honors the
  256-byte `bytesPerRow` alignment and decodes the red channel.
- Shape geometry (`ShapeGeometry`) is built once per (shape, resolution) and
  cached; the shape pipeline samples the field with `textureSampleLevel` in the
  vertex stage for displacement.
- Renderers are instantiated **per field-mapper node** (they own their GPU
  buffers; `queue.writeBuffer` ordering makes shared instances draw only the
  last-written geometry).
- WGSL has no point-size builtin, so points are 4-vertex triangle-strip quads
  expanded in view space, instanced per point.
- Node thumbnails go through `ShaderPreviewManager`'s serialized queue — the
  readback buffer is pooled, so external callers must enqueue, never readback
  directly.
