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

## Render modes

`mode` picks between two fully GPU-driven renderings (both sample the live
field texture in their shaders - zero CPU readback):

- **surface** — a single tessellated shape (`shape`: plane / sphere / box /
  torus). The fragment shader colors the surface from the field and the vertex
  shader displaces vertices along their normals by the field's luminance.
- **instances** — a grid of small meshes, one per field cell. Each instance
  derives its cell from its instance index, samples the field there, and uses
  the value for its height, its size, its color, and threshold culling.

## Node parameters

Shared:
- `mode` — surface / instances
- `scale` — overall size in the viewport
- `displacementScale` — surface displacement / instance height
- `textureAmount` — blend between a neutral lit look (0) and field colors (1)

Surface:
- `shape` — plane / sphere / box / torus
- `resolution` — tessellation (segments)

Instances (separate parameters):
- `instanceShape` — cube / sphere / quad (quad = camera-facing round points)
- `instanceCount` — grid per axis (count x count cells)
- `instanceSize` — base size in world units
- `sizeByField` — how much the field value scales each instance
- `instanceThreshold` — hide cells below this field value

Legacy projects load fine: old `points` saves (either `shape: points` or the
original `mappingMode: points`) become quad instances with their point size,
grid and threshold carried over; `surface`/`volume` map to the plane surface.

## Viewport window

- **Shape** dropdown — applies to every 3D Field Visualizer node
- **FOV** slider — perspective field of view
- **Spin** + speed slider — turntable auto-rotation in radians/second
  (pauses while you orbit; moving the slider turns the spin on)
- **Reset Camera**, **Perspective/Orthographic**
- Left-drag orbit · Shift+drag / middle-drag pan · wheel / right-drag zoom
- A real floating window: draggable header, resizable corner, maximize/restore
  (▢) and close buttons. Toggle with **Ctrl/Cmd+3** or
  **View → Panels → Toggle 3D Viewport**.

## Render resolution

The 3D view renders at the **final render resolution** (the same
preview/export setting the compute pipeline uses), independent of the
viewport window's size — the window shows an aspect-fit (letterboxed)
preview of the exact frame the graph consumes. Changing the resolution
setting retargets the render automatically.

## Real-time parameters

Node parameters (`shape`, `scale`, `displacementScale`, `textureAmount`, …)
are re-read from the node every frame, so dragging them updates the 3D view
immediately — no graph rebuild involved. Numeric parameters accept
`=expressions` (including `time` / `audioEnvelope` and `node_<id>`
references), evaluated per frame with uncached, live node values —
`=sin(time)*0.3+1.5` on `scale` breathes the shape, and a referenced float
tracks its source smoothly even while you drag another parameter.

The scene background is pure black, so the node's output composites cleanly
into the 2D chain.

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
  ├► FieldMapperIntegration.updateFrame        (per-frame param re-sync -> real-time edits)
  ├► SceneRenderer3D.render ──► offscreen sceneTexture ──► aspect-fit blit to canvas
  │     ├► ShapeRenderer        (surface mode: texture sampled in-shader)
  │     └► InstanceRenderer     (instanced mode: per-instance field sampling via instance_index)
  ├► FieldMapperIntegration.publishOutputs     (sceneTexture -> nodeOutputs/computeTextures)
  └► ShaderPreviewManager.updateNodeThumbnailFromTexture(sceneTexture)  (~4 Hz)
```

- The node compiles like a compute node downstream: fragment chains sample
  `compute_node_<id>`, which resolves to the published scene texture — so the
  3D view can feed OutputFinal or any effect chain. The published entry is
  flagged external so `ComputeExecutor.initialize()` preserves it across the
  clear a graph rebuild triggers — otherwise the binding vanishes for a frame
  and blacks out downstream consumers (worst with reference params, which
  rebuild often).
- A fragment source feeding the node is force-re-rendered every frame, and
  stays live even when it's animated only *transitively* — e.g. a Circle whose
  radius is `=node_<x>` where `<x>` is a ConstFloat holding `=sin(time)` or an
  audio value. Three things make that work: (1) `NodeValueComputer` treats a
  node whose param is a time/audio expression as time-dependent (skips its
  value cache) and `_getParameter` evaluates `=expression` values, so the
  ConstFloat computes live; (2) the fragment renderer freshens referenced node
  values before compiling uniforms; (3) it folds the evaluated value of each
  `=expression` param into its re-render hash, so the bridged texture
  re-renders exactly when the referenced value moves. This applies to any
  compute consumer (ComputeMix, the 3D node, …), not just the 3D node.
- The global editor stylesheet's `canvas { position: fixed; left: 0 }` rule
  must be overridden inline on the viewport canvas, or it escapes the window
  and stretches across the full display.

Key implementation notes:

- Shape geometry (`ShapeGeometry`) is built once per (shape, resolution) and
  cached; both pipelines sample the field with `textureSampleLevel` in the
  vertex stage.
- The instanced pipeline needs **no per-instance buffers**: the vertex shader
  derives the cell from `@builtin(instance_index)`, so instance data always
  reflects the current frame's field. Quad instances are billboarded in view
  space with a circular fragment mask (WGSL has no point-size builtin).
- Renderers are instantiated **per field-mapper node** (they own their GPU
  buffers; `queue.writeBuffer` ordering makes shared instances draw only the
  last-written geometry).
- Node thumbnails go through `ShaderPreviewManager`'s serialized queue — the
  readback buffer is pooled, so external callers must enqueue, never readback
  directly.
