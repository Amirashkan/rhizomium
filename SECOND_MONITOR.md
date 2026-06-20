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
  image textures. The viewer runs its own `ComputeExecutor`, rebuilt from the
  broadcast `COMPUTE_GRAPH`, fed per-frame `COMPUTE_UNIFORMS`.
- **`fallback`** — pixel mirror (the editor's `FRAME` bitmaps, letterboxed). Used
  only for graphs the viewer can't reproduce from state:
  - a fragment **storage buffer** (only the 3D `SceneRenderer3D` path uses these; the
    2D node graph doesn't, so this is effectively unreachable), or
  - **fragment-fed compute** — a compute node whose input is a GLSL/fragment node
    (deferred; see `SECOND_MONITOR_FRAGMENT_FED_COMPUTE_PLAN.md`).

## Protocol (`SecondMonitorMessage`)

Editor → viewer: `SHADER`, `UNIFORMS` (per-frame), `CAPS`, `COMPUTE_GRAPH` (on
structure change), `COMPUTE_UNIFORMS` (per-frame), `TEXTURE`, `FRAME` (fallback only),
`RENDER_RES`, `CLOSE`.
Viewer → editor: `READY`, `RESIZE`, `NEED_FALLBACK`, `CLOSED`.

On `READY` the editor re-sends shader/compute-graph/textures/caps/render-res so a
late or reconnecting viewer bootstraps correctly.

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

"Viewer Res" decouples the viewer's **compute** resolution from the editor's
floating-preview size (the soft look came from the preview defaulting to 512px, then
upscaling):

- `0` = **Match editor** (use the broadcast/preview size).
- A fixed long-edge (720/1080/1440/2048, capped at `MAX_COMPUTE_RES` = 2048) scales
  every compute node (preserving aspect) so the viewer renders at that detail
  regardless of the editor's preview. The packed resolution uniform (floats 0,1) is
  overridden to match so UV/texel math (edge kernels, blur radii) is correct.

The output fragment always renders at the display backing res (a cheap blit); detail
is the compute res, not output scale. Controls: editor "Viewer Res" dropdown + viewer
`[` / `]` hotkeys.

> **Important:** compute effects are **resolution-dependent**. Reaction-diffusion,
> blur radius, edge thickness etc. change with the compute resolution. So a fixed
> Viewer Res that differs from the editor makes feedback/compute look different from
> the editor. Use **Match editor** to keep the look identical in scale.

## Aspect ratio

The viewer letterboxes the native output to the **editor's** aspect ratio (black bars
from the body background), matching the editor's framing instead of stretching to the
display. Derived from the broadcast resolution; falls back to filling the display
until the editor aspect is known.

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

## In-viewer controls

`Esc` close · `F` (or double-click) fullscreen · `P` profiler overlay · `[` / `]`
compute resolution.

### Profiler (`P`)

A self-profiler (also `window.__secondMonitorProfiler.snapshot()`) that separates the
causes of a visible hitch — the editor's compute profiler can't see a present-side
stall in another window. Metrics: rendered / rAF / GPU-presented fps; frame-gap max +
stall count; sync render-dispatch ms; throttle vs idle skips; editor message rate +
max gap.

## Deferred / future work

- **Fragment-fed compute** → native (last pixel fallback). See
  `SECOND_MONITOR_FRAGMENT_FED_COMPUTE_PLAN.md`.
- **Exact feedback matching.** Native feedback (reaction-diffusion, feedback trails,
  fluid) runs as an **independent** simulation on the viewer. Two reasons it can look
  different from the editor:
  1. **Resolution** (primary, and controllable): a different Viewer Res changes the
     pattern scale — use **Match editor** to avoid this.
  2. **Chaotic divergence** (secondary): even with an identical deterministic seed and
     the same resolution, the editor and viewer step the sim at slightly different
     counts (independent pacing), and chaotic sims amplify any difference over time.
  A deterministic seed (already in `ComputeShaderManager.initializeReactionDiffusion`)
  makes t=0 identical but can't hold chaotic sims in sync. Options if exact matching
  is wanted later:
  - **Mirror pixels** — route feedback graphs to the pixel fallback (exact, but a
    per-frame GPU→CPU canvas copy on the editor).
  - **Mirror the feedback texture** — broadcast just that node's output each frame;
    the viewer binds it and renders the rest natively (exact for feedback, lighter
    than full-canvas mirror, more plumbing).
  - **Step-lock** — drive the viewer's sim to dispatch 1:1 with the editor's frames so
    the deterministic sims stay in lockstep (fully native, no copy, but complex).
