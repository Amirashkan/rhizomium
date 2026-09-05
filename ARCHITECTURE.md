# Architecture

This is the orientation document for people who want to change the engine. It
follows one signal all the way through — from a node someone drags onto the
canvas to pixels on screen — and names the file that owns each step. The deep
dives live in [`docs/internal/`](docs/internal/); they are linked where they
are relevant and are not required reading.

There is no TypeScript build. Everything is plain ES modules, loaded by Vite.

## The one-paragraph version

A **graph** of nodes is edited in the browser. On every change the graph is
compiled to a single **WGSL shader** by a tree of small per-category compilers.
That shader is handed to a **WebGPU renderer** which owns the device, the
pipelines and the uniform buffers, and which draws a full-screen quad every
frame. Parameters can be driven live — by expressions, audio, MIDI or a
timeline — and those write into uniform buffers *without* recompiling, which is
why the editor stays at frame rate while you drag a slider.

```
 UI event ──▶ Graph ──▶ buildWGSL() ──▶ WGSL source ──▶ GPURenderer ──▶ canvas
                │                                            ▲
                └──── parameter change ──▶ uniform write ────┘
                      (no recompile)
```

The distinction between those two paths — *recompile* vs *write a uniform* — is
the single most important thing to understand before changing anything.

## 1. The graph

| Concern | File |
| --- | --- |
| Node instances, ids, serialisation | `src/data/Graph.js`, `src/nodes/Node.js` |
| What kinds of node exist | `src/data/NodeDefs.js` → `src/data/nodes/*.js` |
| Type rules between pins | `src/data/TypeSystem.js` |
| Edges | `src/core/Connection.js`, `src/core/ConnectionManager.js` |
| The god object that wires it together | `src/core/Editor.js` |

`Editor` (`src/core/Editor.js`) is large and central: it owns the canvas, the
managers, and the change notifications. Most subsystems reach each other
through `src/core/ServiceLocator.js` rather than by importing each other.

A node *definition* is data, not code. `src/data/nodes/MathNodes.js` is
representative:

```js
Add: {
  label: "Add",
  cat: "Math",
  inputs: 2,
  pinsIn: ["A", "B"],
  pinsOut: [{ label: "out", type: "dynamic" }],
  params: [
    { name: "a", type: "float", default: 0.0, label: "A", inputSlot: 0 },
    { name: "b", type: "float", default: 0.0, label: "B", inputSlot: 1 },
  ],
}
```

That object is enough for the UI to draw the node, lay out its pins and render
its parameter widgets. It says nothing about WGSL.

## 2. Codegen

`buildWGSL(graph, options)` in `src/codegen/glslBuilder.js` is the entry point,
and it is the file to read first if you care about shader generation. It:

1. Walks and topologically orders the graph — `processors/GraphProcessor.js`.
2. Asks `processors/NodeCompiler.js` to emit each node.
3. Collects texture bindings — `generators/TextureBindings.js`.
4. Assembles the final source — `templates/ShaderTemplate.js`.

`NodeCompiler` holds a list of **category compilers** in
`src/codegen/compilers/`. Each is a class with the same two methods:

```js
handles(kind)                          // "do I emit this node type?"
compile(node, getInput, getParam)      // "emit the WGSL line(s) for it"
```

`getInput(slot)` returns the WGSL expression already emitted for whatever is
plugged into that slot, so a compiler never walks the graph itself — it just
composes strings from its inputs. Type coercion between pins is
`processors/TypeConverter.js`.

> **The pairing that matters.** `src/data/nodes/MathNodes.js` (what the node
> *is*) and `src/codegen/compilers/MathNodes.js` (what it *emits*) are parallel
> files with the same category name. Adding a node almost always means editing
> exactly one of each. See [Adding a node](#adding-a-node).

Two details in `glslBuilder.js` regularly surprise people:

- `window.nodeCompiler` is a deliberate singleton. The uniform manager hanging
  off it is the same one `GPURenderer` sizes its `u_params` buffer from, every
  frame.
- `options.skipCacheClear` exists for *subgraph* builds (fragment→compute
  bridging, live streaming). Those must not disturb the main graph's uniform
  state, so the builder saves and restores it around the compile. Getting this
  wrong produces `Write range does not fit in ubuf:u_params` and preview
  flicker rather than a clean error.

## 3. GPU

`src/gpu/gpuRenderer.js` (`GPURenderer`) owns the WebGPU device, the swap
chain, the render pipeline and the uniform buffers. `render(config)` is the
per-frame entry point.

Around it:

| File | Role |
| --- | --- |
| `ShaderModuleCache.js` | Avoids recompiling identical WGSL |
| `ParameterUniformManager.js` | The `u_params` buffer; the no-recompile path |
| `TextureManager.js` (in `src/core/`) | Texture lifetimes |
| `ComputeExecutor.js`, `ComputeShaderManager.js` | Compute passes |
| `ComputeNodeBase.js` | Base class for compute-backed nodes |
| `FeedbackManager.js` | Ping-pong buffers for feedback effects |
| `RenderCache.js`, `ResourceTracker.js` | Reuse and leak-tracking |
| `deviceLimits.js` | Adapter capability probing |

Compute nodes are a substantially separate path from fragment nodes, and the
interaction between the two is the fiddliest part of the codebase. If you are
touching it, read `docs/internal/SHADER_INTEROP_ANALYSIS.md` and
`docs/internal/FRAGMENT_COMPUTE_INTEROP_ISSUES.md` first.

## 4. Redraw and invalidation

The editor does *not* redraw on a plain `requestAnimationFrame` loop. Work is
scheduled:

- `src/core/InvalidationManager.js` — what became stale, and why.
- `src/core/RedrawScheduler.js` — coalesces redraw requests.
- `src/core/UnifiedRAFManager.js` — one shared RAF, not one per subsystem.
- `src/core/RenderLoop.js` — the animation loop when something is animating.

`Editor.markDirty(reason, region, options)` is the funnel. The `reason` string
is not decoration — it is used for throttling decisions and shows up in the
profiler. Pass a real one.

Policy and rationale: `docs/REDRAW_THROTTLING_POLICY.md`,
`docs/REDRAW_TRIGGER_DETECTION.md`.

## 5. Parameters, expressions and drivers

A parameter can hold a literal, or an expression, or be driven by an external
source. Expressions are evaluated by an **AST interpreter** in
`src/utils/UnifiedExpressionSystem.js` — deliberately not `eval()`. The editor
opens `.rz` patches written on other people's machines and treats them as
untrusted, and `editor/index.html` sets a Content-Security-Policy without
`unsafe-eval` so that a future `eval()` shortcut fails loudly instead of
silently reopening the hole. Do not add one.

Drivers: `src/audio/`, `src/midi/`, `src/osc/`, `src/core/TimelineManager.js`,
`src/parameters/`.

## 6. The rest of the surface

- `src/ui/` — the largest directory (~37k lines): panels, canvas rendering,
  interaction. `src/ui/components/` for reusable widgets.
- `src/scene/` — the 3D viewport.
- `src/preview/`, `src/core/PreviewSystem.js` — per-node preview thumbnails.
- `src/viewer/` — the standalone web patch viewer (its own Vite entry, kept
  lean so a shared link boots fast).
- `src/screens/`, `src/mapping/`, `src/output/` — multi-screen and projection
  mapping.
- `src/vj/` — performance-oriented panel.
- `src/collab/` — multi-user editing.
- `src/ai/` — AI features. See [Open-core boundary](#open-core-boundary).

A pointer position crosses three spaces on its way in — client, graph and
output frame — and the two stacked canvases share neither an origin nor a
size. `docs/internal/CANVAS_COORDINATE_SPACES.md` has the conversions and who
performs them; read it before touching anything that turns an event into a
coordinate.

`main.js` at the repo root (~161 kB) is the boot file: it imports and wires
every subsystem at startup. It is why the editor bundle is one large chunk and
not code-split — there is no route to defer and no third-party dependency of
size to peel off. `vite.config.js` explains at length why forcing
`manualChunks` made things worse.

Build entries (`vite.config.js`): `index.html` (landing), `editor/index.html`
(the editor), `editor/second-monitor.html`, `viewer/index.html`. The desktop
build swaps the landing page for `splash.html`.

## Open-core boundary

The editor is AGPL and complete on its own: it runs, renders and saves patches
with no account and no network.

Two things are services rather than parts of this repository:

- **The gallery** (`art.tenderworld.org`) — accounts, sharing, plans, billing.
  A separate closed codebase. It is the authority on who has which tier.
- **Model usage** behind `api/ai/run.js`.

The security model is worth understanding before you touch `src/ai/`, because
it is the reason all of this can be public:

- `src/ai/tiers.js` is a **mirror** of the gallery's tier catalogue. Use it to
  decide *what to draw*. Never to decide what to *do*. Its own header says so.
- `api/_lib/grant.js` is the actual boundary. The gallery signs a grant with
  `TIER_GRANT_SECRET` (HMAC-SHA256, deliberately not a JWT); the backend
  verifies it locally. `api/ai/run.js` takes the feature from the *grant*, never
  from the request body.
- Therefore setting your tier in devtools buys a lit-up button and a 401.

**Working on AI features without a gallery:** set `AI_DEBUG_MODE` and use the
unsigned `debug:<feature>` token — `src/ai/debugMode.js` and the "debug grant"
section of `api/_lib/grant.js`. It is off unless an operator sets it, and
refused on production deployments. This is the supported local path; you do not
need an account to develop here.

Full detail: `docs/internal/AI_TIER_INTEGRATION.md`.

## Adding a node

The common case, end to end:

1. **Define it.** Add an entry to the right file in `src/data/nodes/` — pick by
   category (`MathNodes.js`, `NoiseNodes.js`, `BlendNodes.js`, …). Copy the
   shape of a neighbouring node.
2. **Emit it.** In the matching `src/codegen/compilers/` file, add the kind to
   the `handles()` list and a branch in `compile()` that returns the WGSL.
3. **Check the types.** If your node's output type depends on its inputs
   (`type: "dynamic"`), make sure `processors/TypeConverter.js` does the right
   thing for your combinations.
4. **Test it.** Add a case under `tests/`. Compile-level tests that assert on
   generated WGSL are cheap and catch most regressions.
5. **Try it.** `npm run dev`, drop the node in, connect it, look at the preview.

A node that needs a compute pass rather than a fragment expression is a bigger
job — start from `src/gpu/ComputeNodeBase.js` and `docs/compute-nodes.md`.

## Tests

`npm test` (Vitest, ~222 files under `tests/`). WebGPU is not available in the
test environment, so GPU-facing tests use mocks; anything that genuinely needs
an adapter has to be checked by hand in a browser.

`npm run lint`, `npm run test:coverage`, and `npm run test:performance` (mocked
benchmarks) are the other checks CI runs.

## Where to start reading

- Shader generation → `src/codegen/glslBuilder.js`
- Rendering → `src/gpu/gpuRenderer.js`
- Graph and editor state → `src/core/Editor.js`
- Node catalogue → `src/data/NodeDefs.js`
- Boot and wiring → `main.js`
