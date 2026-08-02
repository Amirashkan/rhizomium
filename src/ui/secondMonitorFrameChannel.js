// src/ui/secondMonitorFrameChannel.js
//
// Shared BroadcastChannel protocol between the editor (the state source) and the
// second-monitor receiver page.
//
// In the Tauri/desktop build the output runs in a separate native
// WebviewWindow with its own JS context, so the editor cannot draw into it
// directly the way the browser popup path does. BroadcastChannel works between
// Tauri v2 windows of the same origin (well supported on the WebView2/Windows
// target this app prioritises).
//
// Primary path (NATIVE): the receiver runs its OWN WebGPU renderer and the
// editor broadcasts only the tiny state needed to re-render — the compiled WGSL
// (on change) plus a per-frame snapshot of the uniform bytes (well under 1 KB).
// This costs the editor essentially nothing per frame. It replaces the old
// approach of capturing #gpu-canvas with createImageBitmap and structured-
// cloning a multi-MB frame across the process boundary every frame, which
// stalled the editor's render loop (it dropped to ~30fps with the mirror open).
//
// Fallback path (PIXELS): when a graph uses state the receiver cannot yet
// reproduce natively (textures, compute/feedback), the editor reverts to
// broadcasting FRAME bitmaps and the receiver paints them — so nothing ever
// regresses visually, just at the old cost.

export const SECOND_MONITOR_CHANNEL = 'rhizomium:second-monitor';

/** Native-render tier the editor advertises to the receiver via {@link SecondMonitorMessage.CAPS}. */
export const SecondMonitorTier = Object.freeze({
  NATIVE: 'native',                 // fragment + uniforms only
  NATIVE_COMPUTE: 'native-compute', // also compute (stateless or stateful/feedback, replicated) and/or image textures
  FALLBACK: 'fallback',             // receiver paints mirrored FRAME bitmaps (pixel path)
});

/** Message `type` values exchanged over {@link SECOND_MONITOR_CHANNEL}. */
export const SecondMonitorMessage = Object.freeze({
  // editor → receiver
  SHADER: 'shader',     // { wgsl }            — current compiled shader (sent on change / on READY)
  UNIFORMS: 'uniforms', // { aspect, globals, params } — per-frame uniform byte snapshot (Float32Arrays)
  CAPS: 'caps',         // { tier }            — which path to use (see SecondMonitorTier)
  COMPUTE_GRAPH: 'compute-graph',       // { nodes:[{id,kind,wgsl,width,height,supportsFeedback,inputs}], executionOrder } — on change
  COMPUTE_UNIFORMS: 'compute-uniforms', // { nodes:[{id,packed,colorStops}] } — per-frame packed compute uniform bytes. One message = ONE editor sim step: the receiver steps its compute graph exactly once per message (step-lock), so feedback sims stay 1:1 with the editor
  FEEDBACK_STATE: 'feedback-state',     // { nodeId, width, height, data:Uint8Array } — a feedback node's current sim state (its next-read ping-pong texture); seeds the receiver's sim so a mid-session viewer matches the editor exactly
  FRAGMENT_GRAPH: 'fragment-graph',     // { nodes:[{id,kind,params,inputs}] } — fragment subgraph feeding compute (on structure/expression change)
  FRAGMENT_UNIFORMS: 'fragment-uniforms', // { nodes:[{id,params}] } — per-frame evaluated fragment u_params bytes (static params; streams without a rebuild)
  TEXTURE: 'texture',   // { nodeId, varKind, bitmap, width, height } — loaded image/video texture (on change)
  FRAME: 'frame',       // { bitmap, sw, sh }  — mirrored pixels (fallback path only)
  MASTER_OPACITY: 'master-opacity', // { opacity } — VJ master fader × any running scene transition, 0..1. The receiver renders its own frames, so the editor's canvas opacity means nothing to it; this carries the level across. Sent on change and on READY
  RENDER_RES: 'render-res', // { maxDim, displayMaxDim } — maxDim is the viewer's compute long edge and the editor always sends -1 (render the output format, so the viewer's sims match exactly); displayMaxDim caps the PRESENTATION surface's long edge in device px (0 = the display's own resolution). The render is letterboxed into the display either way
  FEEDBACK_RESET: 'feedback-reset', // { nodeId } — a Feedback node was reset in the editor (panel button or Reset pin); the receiver clears its own sim to match
  CLOSE: 'close',       // shut the window down
  // receiver → editor
  READY: 'ready',       // { webgpu } page loaded and now listening
  RESIZE: 'resize',     // { width, height, dpr } receiver reported its backing size
  NEED_FALLBACK: 'need-fallback', // receiver cannot render natively — send pixels instead
  CLOSED: 'closed',     // the window closed (Esc / native close)
});

/**
 * Open the shared BroadcastChannel.
 * @returns {BroadcastChannel|null} the channel, or null where unsupported.
 */
export function openSecondMonitorChannel() {
  if (typeof BroadcastChannel !== 'function') return null;
  try {
    return new BroadcastChannel(SECOND_MONITOR_CHANNEL);
  } catch {
    return null;
  }
}
