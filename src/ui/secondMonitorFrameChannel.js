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
//
// MULTI-SCREEN. One editor can drive several output windows at once — a studio
// rig of projectors or wall panels, each framed on its own crop of the same
// composition. They all share this one channel, because they all render the SAME
// composition: the state stream above is broadcast ONCE no matter how many
// screens are open, and every receiver re-renders from it. That is what makes a
// second and third screen nearly free on the editor's side.
//
// What differs per screen — its framing, its presentation resolution, whether it
// should shut down — is ADDRESSED: those messages carry a `screenId`, and a
// receiver ignores any addressed message that is not its own (see
// {@link isForScreen}). Messages with no `screenId` are composition-wide and every
// receiver consumes them. A receiver learns which screen it is from the `screen`
// query parameter on its URL (see {@link screenIdFromUrl}).

import { MAIN_SCREEN_ID } from '../screens/ScreenModel.js';

export const SECOND_MONITOR_CHANNEL = 'rhizomium:second-monitor';

/** The screen a plain single-output session drives. Re-exported for receivers. */
export { MAIN_SCREEN_ID };

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
  RENDER_RES: 'render-res', // ADDRESSED. { screenId, maxDim, displayMaxDim } — maxDim is the viewer's compute long edge and the editor always sends -1 (render the output format, so the viewer's sims match exactly); displayMaxDim caps the PRESENTATION surface's long edge in device px (0 = the display's own resolution). The render is letterboxed into the display either way
  MAPPING: 'mapping', // { enabled, surfaces:[{id,name,enabled,locked,opacity,softEdge,dst,src}] } — projection-mapping surfaces (a MappingModel snapshot). The receiver warps its own rendered frame through these before presenting, so the output lands on the physical surfaces the projector is aimed at. Sent on every edit (a corner drag streams) and on READY
  SCREEN_CONFIG: 'screen-config', // { screenId, name, region:{x,y,w,h}, displayMaxDim } — ADDRESSED. What makes this screen different from its neighbours in the rig: the crop of the composition it shows (full = mirror), what to call it, and how many pixels it presents with. Sent on open, on every edit, and on that screen's READY
  FEEDBACK_RESET: 'feedback-reset', // { nodeId } — a Feedback node was reset in the editor (panel button or Reset pin); the receiver clears its own sim to match
  CLOSE: 'close',       // ADDRESSED. { screenId } — shut that screen's window down
  // receiver → editor
  READY: 'ready',       // { screenId, webgpu } page loaded and now listening
  RESIZE: 'resize',     // { screenId, width, height, dpr } receiver reported its backing size
  NEED_FALLBACK: 'need-fallback', // { screenId } receiver cannot render natively — send pixels instead
  CLOSED: 'closed',     // { screenId } the window closed (Esc / native close)
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

/**
 * Which screen a receiver page is: the `screen` query parameter on its URL.
 *
 * The editor gives each output window its own URL when it opens it, so a
 * receiver knows its identity before the first message arrives and never has to
 * be told. A page opened without one is the single-output screen, which is what
 * keeps a plain one-screen session — and any older bookmark of the receiver
 * page — working unchanged.
 *
 * @param {{search?: string}} [loc] a Location-like object; defaults to the page's
 * @returns {string} the screen id
 */
export function screenIdFromUrl(loc) {
  const source = loc || (typeof window !== 'undefined' ? window.location : null);
  const search = source && typeof source.search === 'string' ? source.search : '';
  if (!search) return MAIN_SCREEN_ID;
  try {
    const id = new URLSearchParams(search).get('screen');
    return (id && id.trim()) ? id.trim() : MAIN_SCREEN_ID;
  } catch {
    return MAIN_SCREEN_ID;
  }
}

/**
 * Whether a message is this receiver's to act on.
 *
 * Composition-wide messages carry no `screenId` and are for everyone — that is
 * the whole state stream, broadcast once and re-rendered by every screen.
 * Addressed messages are for exactly one screen in the rig.
 *
 * @param {{screenId?: string}} message
 * @param {string} screenId the receiver's own id
 * @returns {boolean}
 */
export function isForScreen(message, screenId) {
  const target = message && message.screenId;
  if (target == null) return true;
  return target === screenId;
}

/**
 * The URL for one screen's receiver page: the page, plus its identity.
 * @param {string} pageUrl the receiver page (absolute or relative)
 * @param {string} screenId
 * @returns {string}
 */
export function screenReceiverUrl(pageUrl, screenId) {
  const id = (typeof screenId === 'string' && screenId) ? screenId : MAIN_SCREEN_ID;
  const sep = String(pageUrl).includes('?') ? '&' : '?';
  return `${pageUrl}${sep}screen=${encodeURIComponent(id)}`;
}
