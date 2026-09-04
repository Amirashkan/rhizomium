# Second Monitor — Fragment-Fed Compute (IMPLEMENTED)

Status: **done.** Fragment-fed compute (a compute node whose input is a GLSL/fragment
node) now renders natively on the second monitor — the last pixel fallback is gone for
the 2D node graph. See the user-facing summary in `SECOND_MONITOR.md` ("Fragment-fed
compute"). This file is kept as the design record.

## What shipped (and how it differs from the original plan below)

The plan's "broadcast the subgraph + reconstruct it + inject evaluated uniforms"
approach was followed, with one simplification found during implementation:

- **Time/audio are NOT baked.** `FragmentTextureRenderer` compiles expression params
  (`=time`, `=audioEnvelope`) to **runtime reads of the globals (`g`) buffer**, not to
  constants. So matching the editor needs only: (a) the editor's `time` (already in the
  per-frame `UNIFORMS` snapshot, passed as `timeSec`), and (b) the editor's **audio
  envelopes**, which the receiver now mirrors onto its window globals in `renderNative`
  before driving compute. No expression re-evaluation receiver-side.
- **Injection is for static params only.** `externalUniformMode` +
  `externalUniforms` on `FragmentTextureRenderer` injects the editor's evaluated
  `u_params` bytes so a static param drag streams via `FRAGMENT_UNIFORMS` **without a
  pipeline rebuild**. The bytes line up because both sides run the same `buildWGSL` over
  the same reconstructed subgraph (identical struct field order).
- **`FRAGMENT_GRAPH` re-broadcasts only on structure / expression-param change** (the
  signature excludes static numeric values — those stream as uniforms). Pure compute
  graphs never carry the message.

Files changed: `secondMonitorFrameChannel.js` (`FRAGMENT_GRAPH` / `FRAGMENT_UNIFORMS`),
`TauriSecondMonitorViewer.js` (collect + broadcast subgraph & per-frame uniforms),
`secondMonitorReceiver.js` (reconstruct subgraph, inject uniforms, mirror audio,
bootstrap the expression system), `FragmentTextureRenderer.js` (external-uniform
injection), `gpuRenderer.js` (classifier → `native-compute`; fragment uniform
snapshot). Tests in `gpuRendererStateTap`, `secondMonitorReceiver`,
`TauriSecondMonitorViewer`.

---

## Original plan (for reference)

Everything else for native second-monitor output was already done (native fragment,
native stateless compute, native stateful/feedback compute, steady-clock pacing,
self-profiler). This was the **last remaining pixel fallback**.

## Context — what's left and why

The Tauri second monitor re-renders the graph natively in its own window instead of
copying pixels (see `src/ui/secondMonitorReceiver.js`,
`src/ui/TauriSecondMonitorViewer.js`, `src/ui/secondMonitorFrameChannel.js`). The
classifier `GPURenderer.classifyMirrorTier()` (`src/gpu/gpuRenderer.js`) now returns
`native-compute` for all compute graphs **except** one case, which still falls back to
the pixel `FRAME` path:

> **A compute node whose input is a GLSL/fragment node** (fragment → compute).
> `_computeSubgraphSelfContained()` returns `false` for these → `"fallback"`.

The other classifier fallback (a `storage-buffer` bound in the *fragment* shader) is
effectively unreachable for the 2D node graph — real `var<storage>` buffers only exist
in the separate 3D `SceneRenderer3D` path (`src/scene/shaders/fieldPointCloud.wgsl`),
which isn't mirrored. Leave it as a defensive catch-all.

## How fragment-fed compute works today (editor side)

`ComputeExecutor` already auto-bridges fragment → compute, on BOTH the editor and the
receiver (same code), via:

- `_renderFragmentInputs()` / `_renderFragmentNodeWithDependencies()`
  (`src/gpu/ComputeExecutor.js`): for any compute-node input that is **not** a compute
  manager, it calls `this.fragmentRenderer.renderNodeToTexture(fragmentNodeId, w, h,
  time, audioContext, commandEncoder)` and feeds the resulting texture into the compute
  node.
- `FragmentTextureRenderer.renderNodeToTexture()`
  (`src/gpu/FragmentTextureRenderer.js`, ~950 lines): compiles a fragment node **plus
  its dependency chain** to WGSL using `NodeDefs` + `window.graph`, **evaluates its
  parameters** (numbers, expressions, `time`, `audioEnvelope`), renders to a cached
  texture.

**Why it falls back:** the receiver's `window.graph` is *synthetic and compute-only*
(built in `secondMonitorReceiver.js → applyComputeGraph`, with `params: {}`). The
feeding fragment nodes — and the codegen inputs they need — simply aren't there, so
`renderNodeToTexture` can't compile them. The compute machinery is present on the
receiver; only the **fragment input subgraph + its evaluated uniforms** are missing.

## Recommended approach

Broadcast the fragment-input subgraph and its per-frame evaluated uniforms; reconstruct
it on the receiver so the receiver's existing `FragmentTextureRenderer` can render it.

1. **Editor: collect the fragment-input subgraph.**
   In `TauriSecondMonitorViewer` (near `_broadcastComputeGraph`), walk
   `window.computeNodeRegistry`; for each compute input that is not a compute node and
   not an image/value (the same test as `_computeSubgraphSelfContained`), collect that
   fragment node **and its transitive dependencies** (other fragment/value nodes the
   codegen needs). Serialize each as `{ id, kind, params, inputs }` from `window.graph`.

2. **Protocol** (`secondMonitorFrameChannel.js`): add
   - `FRAGMENT_GRAPH` — `{ nodes:[{id,kind,params,inputs}] }`, sent on change.
   - per-frame evaluated uniforms for those nodes — either a new `FRAGMENT_UNIFORMS`
     message, or fold into the existing per-frame snapshot.

3. **Receiver** (`secondMonitorReceiver.js`): on `FRAGMENT_GRAPH`, add the fragment
   nodes to the synthetic `window.graph` (alongside the compute nodes) with their
   params, so `_renderFragmentInputs → renderNodeToTexture` finds and compiles them.
   Apply per-frame fragment uniforms before each render.

4. **Classifier** (`gpuRenderer.js`): once supported, allow fragment-fed graphs to
   classify `native-compute` when the fragment subgraph is broadcastable; keep
   `fallback` only for the genuinely unreproducible (storage buffers).

## The hard part / key decision

`FragmentTextureRenderer` **bakes uniforms from node params via NodeDefs codegen** and
**evaluates expressions/time/audio editor-side**. On the receiver those values differ
(no audio, independent clock). Mirror the compute approach: **bake the values on the
editor and inject them** — but `FragmentTextureRenderer` has no external-uniform path
yet (unlike `ComputeShaderManager.externalUniformMode` /
`writeRawComputeUniforms`). **Adding that injection hook is the main new capability**
and the bulk of the work.

- Recommended: add an `externalUniformMode` + `writeRawUniforms`-style hook to
  `FragmentTextureRenderer` so the receiver injects the editor's already-evaluated
  per-node uniform bytes (consistent with the compute path; deterministic).
- Alternative: broadcast raw param strings + the editor's time/audio and re-evaluate on
  the receiver (needs the expression evaluator + audio snapshot receiver-side).

## Files to touch

- `src/gpu/FragmentTextureRenderer.js` — external-uniform injection (new capability).
- `src/ui/secondMonitorFrameChannel.js` — `FRAGMENT_GRAPH` (+ fragment uniforms).
- `src/ui/TauriSecondMonitorViewer.js` — collect + broadcast the subgraph & uniforms.
- `src/ui/secondMonitorReceiver.js` — reconstruct fragment nodes in `window.graph`;
  apply fragment uniforms.
- `src/gpu/gpuRenderer.js` — `classifyMirrorTier` / `_computeSubgraphSelfContained`.
- Possibly `src/gpu/ComputeExecutor.js` — confirm `_renderFragmentInputs` works against
  the synthetic graph with injected fragment uniforms.

## Incremental milestones

- **M1 (spike):** one fragment input node with **static** params → reconstruct on
  receiver → verify it renders. Validates the FragmentTextureRenderer-on-receiver path.
- **M2:** dependency chains (fragment node fed by value/other fragment nodes).
- **M3:** expression / `time` / `audioEnvelope` params via external-uniform injection.
- **M4:** flip the classifier + drop the fallback for supported cases; add tests
  (classifier → `native-compute`; receiver reconstructs the fragment subgraph).

## Risks

- Serializing arbitrary fragment-node params (colors, vectors, expressions) must
  round-trip through the message channel.
- Deep/branching dependency chains must be collected completely or compilation fails.
- Extra fragment passes on the receiver add GPU cost (acceptable — same as the editor).
- Resolution of the fragment input texture must match the compute node (extend the
  width/height broadcast already used for compute).

## Verification (desktop app)

Build a graph where a **GLSL/fragment node feeds a compute node** (e.g. a fragment
pattern → `ComputeBlur` → output). Open the second monitor and confirm it renders
**natively** (no pixel fallback) and matches the editor. Use the in-window profiler
(press **P**) to confirm framerate and that the tier is `native-compute`.
