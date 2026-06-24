# Time node / `=node_<id>` reference behavior — findings & fixes

Notes from investigating: *"the Time node shows a fixed number, and referencing a
Time node into a parameter animates choppily."* Captured here so the next person
(or future me) doesn't have to re-derive the architecture.

## Symptoms reported

1. A bare **Time** node's preview showed a fixed number; it updated once when
   connected to something, then froze again.
2. Referencing a Time node into a node parameter (e.g. a Transform's
   `translateX = "=node_28"`) animated in steps (~10fps) even though the FPS
   counters read ~60fps — "60fps shown everywhere but it looks 10fps."
3. The `=time` **expression** (literal keyword) animates smoothly at 60fps; only
   the **node reference** form (`=node_<id>`) was choppy.

## Key architecture facts (reference)

- **The GPU output renders every frame unconditionally** (`main.js`, "GPU
  rendering - Always render every frame"). It feeds `simTime` → the shader's
  `g.time`. So any shader that uses `g.time` animates at the render-loop rate
  (60fps) regardless of the editor's preview machinery.
- **Time detection is keyed on the literal substring `"time"`** in *many* places,
  each independently: `ParameterExpressionSystem.evaluateExpression`
  (populates `timeAnimatedNodes`), `Editor.hasTimeBasedExpressions`,
  `ParameterUniformManager.isDynamicExpression`,
  `TransformNodes.isTimeExpression`, `UnifiedExpressionSystem.isDynamic`.
  A `=node_<id>` reference contains no `"time"`, so none of them recognize it.
- **Parameter → shader paths**: `=`-prefixed param values are compiled to WGSL
  via `unifiedExpressionSystem.generateShader(...)` (used by Transform, Field,
  Noise, Utility, Gradient, Compute compilers). Plain numeric params become
  `u_params.*` uniforms instead.
- **Node previews / thumbnails** are a *separate* CPU/GPU path from the main
  output: `PreviewIntegration.updateTimeNodes()` (scalar nodes, ~10fps via the
  `PREVIEW_UPDATE_INTERVAL = 100ms` cadence) and
  `PreviewIntegration.updateAnimatedFragmentPreviews()` (visual nodes, ~30fps).
  Both decide *what* to refresh from `expressionSystem.timeAnimatedNodes`.
- Inspect the live compiled shader with `window.gpuRenderer._currentWgslCode`.

## Root causes found

1. **Bare Time / RandomTime nodes were never treated as animated.** They have no
   `"=time"` expression, so they weren't in `timeAnimatedNodes`. As a result
   `NodeValueComputer` cached their value (input/param hashes never change) and
   the preview loop never refreshed them → frozen value.
2. **`=node_<id>` references weren't compiled to the GPU clock.** The shader
   generator emitted the identifier `node_<id>` verbatim. For a Time node that
   isn't wired into the output, that variable isn't declared, so the WGSL failed
   to compile / the value didn't track the clock.
3. **Thumbnails of nodes that reference a Time node don't know they're animated.**
   Because the reference isn't in `timeAnimatedNodes`, the thumbnail-refresh
   paths fall back to the slow generic preview cadence (~10fps) — even though the
   real GPU output is correct.

## What was fixed (kept on the branch)

- **`fa5772a` — Time/RandomTime nodes don't freeze.**
  - `NodeValueComputer`: never cache clock-driven kinds (`Time`, `RandomTime`,
    animated fields) so `computeNodeValue` recomputes with the current time.
  - `Editor.hasActiveAnimations()`: count intrinsic Time/RandomTime nodes so the
    render loop keeps redrawing them (and no longer short-circuits to `false`
    when `timeAnimatedNodes` exists but is empty).
  - `PreviewIntegration.updateTimeNodes()`: include intrinsic Time/RandomTime
    nodes (and their downstream) in the per-frame refresh set.
  - Tests: `tests/timeNodeLiveRefresh.test.js`.

- **`a98a1e6` — `=node_<id>` references to a Time/RandomTime node compile to the
  GPU clock.** `UnifiedExpressionSystem.generateShader` now resolves such a
  reference to `g.time` (and the RandomTime `fract(sin(...))` formula, mirroring
  `InputNodes.js`). This makes the **main GPU output animate at a true 60fps** for
  a referenced parameter — confirmed live: `translateX: "=node_28"` compiles to
  `g.time`, and `window.perfReport()` showed a genuine ~60fps
  (`gpuDispatchCpu` 57.6/s, avg 57.6 fps). Tests:
  `tests/timeNodeReferenceShader.test.js`.

## What was reverted (and why)

- **`af086ba` — refresh thumbnails of reference-driven nodes** (reverted in
  `ac9bd0c`). It scanned params for `=node_<id>` references to clock nodes and
  fed those nodes + their downstream into the thumbnail-refresh paths so their
  *thumbnails* would update at ~30fps instead of ~10fps.

  It was reverted because it re-renders more node thumbnails via GPU readback
  every frame, which competes with the (shared) floating preview / main render.
  After it shipped, the reported symptom was that **the floating preview also went
  laggy** — i.e. it traded a confirmed-fast 60fps output for fresher thumbnails,
  which is the wrong trade. The conservative, confirmed-good state keeps the GPU
  output fast.

## Known remaining limitation

With a Time node referenced into a parameter:

- ✅ The **main GPU output / floating preview** animates at a true 60fps
  (`a98a1e6` — the param compiles to `g.time`).
- ⚠️ The **node-editor thumbnails** of the referencing node (and its downstream)
  refresh at the generic preview cadence (~10fps), so they look choppy relative
  to the live output. This is cosmetic (thumbnails only).

### If you want to revisit the thumbnail cadence later

The honest fix is *not* "refresh more thumbnails harder" (that was `af086ba`, and
it costs main-render performance). Better options, roughly in order of
preference:

1. Make the per-thumbnail GPU readback cheaper / fully async so refreshing extra
   thumbnails doesn't stall the shared GPU, *then* re-introduce the
   reference-aware refresh.
2. Treat `=node_<id>` references to clock nodes as time-animated at the *source*
   (register them in `timeAnimatedNodes` once, when the expression is committed,
   resolving the reference against the graph) so every consumer — detection,
   uniforms, thumbnails — handles them uniformly, instead of each path scanning
   per frame.
3. Accept the cosmetic staleness (current state). The output is correct; only the
   small node thumbnails lag.

`git show af086ba` is the reverted reference-aware refresh if you want it back.
