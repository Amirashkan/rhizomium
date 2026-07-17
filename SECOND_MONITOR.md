# Second Monitor (native output viewer)

A full-screen output window for a second display. Instead of copying pixels every
frame, the viewer **re-renders the shader natively** in its own window from a tiny
per-frame state broadcast, so the editor keeps full framerate.

This is a desktop (Tauri) feature. The plain browser build has no second viewer (a
browser popup could only mirror pixels, which we removed).

## Pieces

| File | Role |
|---|---|
| `src/ui/TauriSecondMonitorViewer.js` | **Editor side.** Opens the native window, taps the renderer, broadcasts state. |
| `src/ui/secondMonitorReceiver.js` | **Viewer side.** Runs its own WebGPU renderer + ComputeExecutor; re-renders from the broadcast. Loaded by `editor/second-monitor.html`. |
| `src/ui/secondMonitorFrameChannel.js` | The `BroadcastChannel` protocol (message + tier enums). |
| `src/gpu/gpuRenderer.js` | `setStateTap`/`setFrameTap`, `classifyMirrorTier`, `writeRawUniforms`. |

Transport is a same-origin `BroadcastChannel` (`rhizomium:second-monitor`).

## Render tiers (`GPURenderer.classifyMirrorTier`)

The editor picks a tier per shader and advertises it via the `CAPS` message:

- **`native`** — fragment + uniform buffers only. Broadcast: WGSL (on change) +
  per-frame uniform bytes. The viewer re-renders the fragment.
- **`native-compute`** — also compute (stateless **and** stateful/feedback) and/or
  image textures, **including fragment-fed compute** (a compute node whose input is a
  GLSL/fragment node). The viewer runs its own `ComputeExecutor`, rebuilt from the
  broadcast `COMPUTE_GRAPH`, fed per-frame `COMPUTE_UNIFORMS`. For fragment-fed
  compute it also rebuilds the fragment subgraph from `FRAGMENT_GRAPH` and re-renders
  it with its own `FragmentTextureRenderer`, fed per-frame `FRAGMENT_UNIFORMS`.
- **`fallback`** — pixel mirror (the editor's `FRAME` bitmaps, letterboxed). Used
  only for a fragment **storage buffer** (only the 3D `SceneRenderer3D` path uses
  these; the 2D node graph doesn't, so this is effectively unreachable).

## Protocol (`SecondMonitorMessage`)

Editor → viewer: `SHADER`, `UNIFORMS` (per-frame), `CAPS`, `COMPUTE_GRAPH` (on
structure change), `COMPUTE_UNIFORMS` (per-frame; **one message = one sim step**, see
"Step-locked feedback"), `FRAGMENT_GRAPH` (fragment-fed compute; on
structure/expression change), `FRAGMENT_UNIFORMS` (per-frame), `TEXTURE`,
`FEEDBACK_STATE` (a feedback sim's current state; seeds the viewer on connect/graph
change), `FEEDBACK_RESET` (a Feedback node was reset), `FRAME` (fallback only),
`RENDER_RES`, `CLOSE`.
Viewer → editor: `READY`, `RESIZE`, `NEED_FALLBACK`, `CLOSED`.

On `READY` the editor re-sends shader/compute-graph/fragment-graph/textures/caps/
render-res so a late or reconnecting viewer bootstraps correctly.

## Pacing (why it's smooth)

The viewer renders the latest state on its **own clock**, capped to ~60fps by
elapsed-since-last-render **with a tolerance** — NOT once per inbound message, and NOT
via a carry accumulator. History of why:

- Rendering every rAF over-drove compute on a high-refresh display.
- Rendering once per message made the viewer's vsync *beat* against the editor's
  ~60/s broadcast (two near-60Hz clocks → a periodic skipped/doubled frame).
- A carry accumulator targeting exactly the display rate *drifted* and dropped one
  frame every few seconds.

After ~200ms of silence (editor minimised/occluded → rAF throttled) the viewer holds
the last frame instead of spinning.

## Resolution control (`RENDER_RES { maxDim }`)

**The viewer is independent of the editor's floating preview.** Nothing done to the
preview — resizing it, changing its resolution setting, hiding it — reshapes,
rescales, or rebuilds the second-monitor output. Modes:

- `0` = **Auto (display)** — the default. Every compute node renders display-shaped
  at the viewer display's own resolution (long edge capped at `MAX_COMPUTE_RES` =
  2048) and the output fills the display edge-to-edge. The broadcast
  (preview-derived) sizes are ignored entirely, so an editor preview-resolution
  change never rebuilds the receiver (which would reset feedback sims).
- A fixed long-edge (720/1080/1440/2048) — same as Auto but at the chosen detail
  (display aspect).
- `-1` = **Match editor** — the explicit opt-in that adopts the editor's
  preview-derived compute sizes and letterboxes to the editor's framing. This is the
  mode for **exact feedback-sim matching** (state seeding requires equal dims), and
  the only mode in which the preview affects the viewer — by design, since it *is*
  "follow the editor".

In every mode the packed resolution uniform (floats 0,1) is overridden to the
receiver's actual texture size whenever it differs from the editor's, so UV/texel
math (edge kernels, blur radii) stays correct. The output fragment always renders at
the display backing res (a cheap blit); detail is the compute res, not output scale.
Controls: editor "Viewer Res" dropdown + viewer `[` / `]` hotkeys (hotkeys step
Auto/fixed presets; Match editor is dropdown-only).

> **Important:** compute effects are **resolution-dependent**. Reaction-diffusion,
> blur radius, edge thickness etc. change with the compute resolution. A viewer
> resolution that differs from the editor's makes feedback/compute look different in
> scale — use **Match editor** to keep the look (and the sims, via state seeding)
> identical.

## Aspect ratio

By default the viewer **fills its own display**: Auto/fixed compute textures are
display-shaped by construction and fragments are resolution-independent, so there is
nothing to letterbox and the editor's preview shape is irrelevant. Only **Match
editor** letterboxes (black bars from the body background) — to the compute output
texture's aspect for compute graphs, else to the editor's broadcast aspect — so the
framing matches the editor.

## Performance notes

- **No MSAA on the viewer** (`sampleCount = 1`): it only draws a fullscreen blit, so
  MSAA at display res was pure GPU cost that starved the shared GPU.
- **Compute profiler gated to its overlay** (`main.js`): it was enabled at startup and
  ran a per-frame `mapAsync` GPU readback (a CPU↔GPU sync that periodically stalled
  the shared GPU) even when hidden. Now it runs only while the overlay is visible.

## Live updates

`COMPUTE_GRAPH` is re-broadcast whenever a compute-graph **structure signature**
(node ids, kinds, **input wiring**, sizes) changes — not just on a WGSL change — so
rewiring a compute node's input (e.g. connecting a node into ComputeEdgeDetect)
updates the viewer live. The viewer's rebuild-dedup key includes `inputs`.

**Control pins are excluded.** The Feedback nodes' Reset pin is a CPU-only control
pin: its wiring is masked (to `null`, preserving pin indices) in the broadcast
`inputs` and in the structure signature, and its scalar source (a Trigger, say) is
never collected into `FRAGMENT_GRAPH`. Otherwise merely wiring a Trigger into a
Reset pin rebuilt the receiver's compute graph — which cleared its feedback sims.

**Feedback resets are mirrored.** The viewer replicates feedback sims independently,
so resetting one in the editor (the panel's "Reset Feedback" button or a rising edge
on the Reset pin — both funnel through `ComputeExecutor.resetNodeFeedback`)
broadcasts `FEEDBACK_RESET { nodeId }` and the receiver clears its own copy of that
sim. Textures restored by a project load also re-broadcast (`SaveLoadManager` calls
the same `onTextureChanged` hook a fresh upload does).

## In-viewer controls

`Esc` close · `F` (or double-click) fullscreen · `P` profiler overlay · `[` / `]`
compute resolution.

### Profiler (`P`)

A self-profiler (also `window.__secondMonitorProfiler.snapshot()`) that separates the
causes of a visible hitch — the editor's compute profiler can't see a present-side
stall in another window. Metrics: rendered / rAF / GPU-presented fps; frame-gap max +
stall count; sync render-dispatch ms; throttle vs idle skips; editor message rate +
max gap.

## Fragment-fed compute

A compute node whose input is a GLSL/fragment node (e.g. a fragment pattern →
`ComputeBlur`) renders **natively** on the viewer — it was the last pixel fallback.

- The editor broadcasts the fragment-input subgraph (`FRAGMENT_GRAPH`: each feeding
  fragment node + its transitive non-compute deps, as `{id, kind, params, inputs}`) on
  structure or **expression-param** change, and streams the editor's already-evaluated
  per-node `u_params` bytes every frame (`FRAGMENT_UNIFORMS`).
- The viewer reconstructs those nodes into its synthetic `window.graph` (alongside the
  compute nodes) so the `ComputeExecutor`'s own `FragmentTextureRenderer` compiles the
  **same WGSL** (same `buildWGSL`, same subgraph) and re-renders the fragment input,
  which the compute node then consumes — exactly as the editor auto-bridges it.
- **Why values match:** static params re-derive identically from the broadcast params
  and are also injected verbatim (`FragmentTextureRenderer.externalUniformMode`), so a
  param drag streams without a pipeline rebuild. Expression params compile to runtime
  reads of the globals buffer — `time` rides the per-frame snapshot and the editor's
  **audio envelopes** are mirrored onto the viewer window so `=audioEnvelope`
  expressions evaluate the same.

## Step-locked feedback (exact matching, fully native)

Feedback sims (reaction-diffusion, feedback trails, feedback fields) used to run as
**independent** simulations on the viewer — free-running on its own clock, so a fast
display over-advanced them, a slow editor under-fed them, and chaotic sims drifted
visibly from the editor within seconds. They are now **step-locked and state-seeded**,
which was the step-lock option previously listed under deferred work:

- **One `COMPUTE_UNIFORMS` message = one sim step.** The editor's executor steps its
  feedback sims once per rendered editor frame, and the state tap emits one snapshot
  per render — so each message *is* one step. The viewer queues them and runs exactly
  one executor pass per message, with **that step's exact uniform bytes**. On a frame
  where no step arrived, `ComputeExecutor.holdDispatch` freezes every dispatch and the
  blit re-presents the last result (a high-refresh display can no longer over-drive
  the sim). A backlog (rAF jitter, slow display) is replayed up to 3 steps per frame,
  each with its own uniforms, so the dispatch counts stay 1:1 with the editor; beyond
  a 4-step queue the oldest steps drop (a persistently slower display trails rather
  than the queue growing forever).
- **State seeding on connect.** Opening the viewer mid-session (or any compute-graph
  change, which rebuilds the receiver) broadcasts each feedback node's current sim
  state — a one-shot readback of its next-read ping-pong texture (`FEEDBACK_STATE`) —
  and the receiver uploads it into the same slot, so both sims evolve from the same
  state, in the same steps, from that moment on. Each `COMPUTE_UNIFORMS` message
  carries a step counter and the seed is stamped with the counter at capture, so the
  receiver drops queued steps the seed already contains instead of replaying them on
  top. Resets stay mirrored via `FEEDBACK_RESET`.

Caveats: in the default Auto (and fixed) resolution modes the viewer renders sims at
its own display resolution, so the pattern scale differs from the editor and the
state seed is skipped (dimension mismatch) — sims are still step-locked (same rate,
same resets) but evolve their own copy. Select **Viewer Res → Match editor** for
byte-exact sim matching. ComputeWarp/ComputeMix allocate ping-pong but carry no
cross-frame state, so they are excluded from seeding. Sims with state outside the
ping-pong textures (e.g. particle storage buffers) seed approximately but remain
step-locked.
