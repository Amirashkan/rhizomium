# 3D Visualization Guide (ComputeFieldMapper)

The **3D Field Visualizer** node (`ComputeFieldMapper`, category *Utility*) maps a
compute shader's output onto a live 3D shape in the floating viewport.

## Quick start

1. Create any texture-producing node or subgraph — compute (**ComputeNoise**,
   **ComputeFeedback**, …), fragment (**FBMNoise**, **VoronoiNoise**, …), or a
   mix of both.
2. Create a **3D Field Visualizer** node.
3. Connect: your graph → **Field Input**. Fragment (or mixed) sources are
   auto-wrapped: rendered to a texture each frame, no extra nodes needed.
4. The 3D viewport window opens automatically (toggle with **Ctrl/Cmd+3**).

You immediately get a **displaced, textured plane** driven by the live field.

The node also **outputs the rendered 3D view** as an ordinary color texture:
wire it into OutputFinal (or any downstream node) to bring the 3D render back
into the 2D chain. Its thumbnail and downstream previews stay live even while
the viewport window is closed.

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

## Viewport window

- **Shape** dropdown — applies to every 3D Field Visualizer node
- **FOV** slider — perspective field of view
- **Spin** — slow turntable auto-rotation (pauses while you orbit)
- **Reset Camera**, **Perspective/Orthographic**
- Left-drag orbit · Shift+drag / middle-drag pan · wheel / right-drag zoom
- A real floating window: draggable header, resizable corner, maximize/restore
  (▢) and close buttons. **Ctrl/Cmd+3** toggles it.

## Render resolution

The 3D view renders at the **final render resolution** (the same
preview/export setting the compute pipeline uses), independent of the
viewport window's size — the window shows an aspect-fit (letterboxed)
preview of the exact frame the graph consumes. Changing the resolution
setting retargets the render automatically.

## Real-time parameters

Node parameters (`shape`, `scale`, `displacementScale`, `textureAmount`, …)
are re-read from the node every frame, so dragging them updates the 3D view
immediately — no graph rebuild involved.

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
render loop (whenever a visualizer node exists)
  ├► ComputeExecutor._renderFragmentInputs     (auto-wraps fragment/mixed sources)
  ├► FieldMapperIntegration.updateFrame        (points mode only: GPU→CPU readback)
  ├► SceneRenderer3D.render ──► offscreen sceneTexture ──► blit to canvas
  │     ├► ShapeRenderer        (plane/sphere/box/torus: texture sampled in-shader)
  │     ├► PointCloudRenderer   (instanced billboard quads)
  │     └► MeshRenderer         (indexed CPU geometry, e.g. marching cubes)
  ├► FieldMapperIntegration.publishOutputs     (sceneTexture -> nodeOutputs/computeTextures)
  └► ShaderPreviewManager.updateNodeThumbnailFromTexture(sceneTexture)  (~4 Hz)
```

- The node compiles like a compute node downstream: fragment chains sample
  `compute_node_<id>`, which resolves to the published scene texture — so the
  3D view can feed OutputFinal or any effect chain.
- The global editor stylesheet's `canvas { position: fixed; left: 0 }` rule
  must be overridden inline on the viewport canvas, or it escapes the window
  and stretches across the full display.

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
