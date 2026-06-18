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
  NATIVE_COMPUTE: 'native-compute', // also stateless compute and/or broadcast image textures
  FALLBACK: 'fallback',             // receiver paints mirrored FRAME bitmaps (pixel path)
});

/** Message `type` values exchanged over {@link SECOND_MONITOR_CHANNEL}. */
export const SecondMonitorMessage = Object.freeze({
  // editor → receiver
  SHADER: 'shader',     // { wgsl }            — current compiled shader (sent on change / on READY)
  UNIFORMS: 'uniforms', // { aspect, globals, params } — per-frame uniform byte snapshot (Float32Arrays)
  CAPS: 'caps',         // { tier }            — which path to use (see SecondMonitorTier)
  COMPUTE_GRAPH: 'compute-graph',       // { nodes:[{id,kind,wgsl,width,height,supportsFeedback,inputs}], executionOrder } — on change
  COMPUTE_UNIFORMS: 'compute-uniforms', // { nodes:[{id,packed,colorStops}] } — per-frame packed compute uniform bytes
  TEXTURE: 'texture',   // { nodeId, varKind, bitmap, width, height } — loaded image/video texture (on change)
  FRAME: 'frame',       // { bitmap, sw, sh }  — mirrored pixels (fallback path only)
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
  } catch (_) {
    return null;
  }
}
