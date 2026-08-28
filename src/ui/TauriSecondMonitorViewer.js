// src/ui/TauriSecondMonitorViewer.js
//
// Second-monitor full-screen viewer — Tauri/desktop backend.
//
// In the desktop app `window.open()` is governed by the OS WebView and is
// blocked (it returns null), so the browser popup path in SecondMonitorViewer.js
// cannot be used. This backend instead opens a real, borderless, native
// WebviewWindow on the second display via the Tauri window API and drives it to
// true OS fullscreen — which, unlike the browser's gesture-gated
// requestFullscreen(), is reliable.
//
// A second WebviewWindow is a separate JS context with its OWN WebGPU device,
// so rather than copy pixels into it we let it re-render the shader itself. Over
// a same-origin BroadcastChannel this backend registers on the renderer's STATE
// tap (GPURenderer.setStateTap) and broadcasts only the compiled WGSL (on
// change) plus a per-frame snapshot of the uniform bytes — well under 1 KB. The
// receiver page (editor/second-monitor.html) re-renders from its own rAF at the
// second display's native refresh rate. The editor pays essentially nothing per
// frame, where the old approach (capturing #gpu-canvas with createImageBitmap
// and structured-cloning a multi-MB frame every present) dropped it to ~30fps.
//
// Textured and compute graphs (including stateful/feedback sims and fragment-fed
// compute — a compute node whose input is a fragment node) are reproduced natively
// too: the WGSL, the compute subgraph, the fragment subgraph and the per-frame
// uniform bytes are broadcast and the receiver re-renders from them. Feedback sims
// are exact, not approximate: each per-frame COMPUTE_UNIFORMS message is one editor
// sim step the receiver replays 1:1 (step-lock), and on connect/graph-change each
// sim's current ping-pong state is read back once and broadcast (FEEDBACK_STATE) to
// seed the receiver's replica. Only graphs the receiver can't reproduce from state
// alone — a fragment storage buffer (3D path) — revert to the pixel FRAME tap
// (GPURenderer.setFrameTap) so the second monitor never shows broken output.
//
// MULTI-SCREEN. One editor drives a whole rig of these windows — a studio's
// projectors or wall panels — and the cost of the second and third is close to
// nothing, because they all render the SAME composition. The state stream above
// is broadcast ONCE over one shared channel no matter how many screens are open;
// each receiver re-renders it and shows its own crop of the result. What is per
// screen is only the framing (see screenRegion.js), the display it sits on, and
// its presentation resolution — a handful of bytes, sent when they change.
//
// So this class is two things: the broadcast ENGINE (one per editor, started
// with the first screen and stopped with the last), and the open RIG — the map
// of screen id to native window. The single-output case is just a rig of one,
// on the screen id 'main', which is why open()/close()/toggle() and the menu
// button behave exactly as they always did.
//
// All '@tauri-apps/api' access is via dynamic import() so that statically
// importing this module stays safe on the raw web deployments, which serve the
// source un-bundled and cannot resolve bare specifiers. This class is only ever
// constructed when isTauri() is true (see main.js).

import { isTauri } from '../utils/isTauri.js';
import { controlInputPinIndices } from '../data/NodeDefs.js';
import { getOutputOpacity, onOutputOpacityChange } from '../vj/MasterOutput.js';
import { MAIN_SCREEN_ID, makeScreen } from '../screens/ScreenModel.js';
import { sanitizeRegion } from '../screens/screenRegion.js';
import { readDisplayLayout, openScreenWindow } from './ScreenWindow.js';
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
  openSecondMonitorChannel,
} from './secondMonitorFrameChannel.js';

// Legacy default for the `windowLabel` option. Window labels now come from the
// screen id (see ScreenWindow.screenWindowLabel); this is kept only so an older
// caller passing the option is not surprised by a different window.
const WINDOW_LABEL = 'second-monitor';

// The viewer always renders the editor's output format (protocol value -1), so
// its sims replicate the editor's exactly and its framing is the composition's.
// Only the presentation surface is configurable, between these long edges.
const MATCH_OUTPUT = -1;
const MIN_DISPLAY_EDGE = 256;
const MAX_DISPLAY_EDGE = 7680;

export class TauriSecondMonitorViewer {
  /**
   * @param {HTMLCanvasElement} sourceCanvas  the live GPU canvas to mirror
   * @param {Object} [options]
   * @param {string} [options.windowLabel]     legacy alias, unused (labels come
   *                                           from the screen id — see ScreenWindow)
   * @param {Object} [options.renderer]        GPURenderer to tap for frames
   *                                           (falls back to window.gpuRenderer)
   * @param {(message: string, kind?: string) => void} [options.onStatus]
   * @param {(active: boolean) => void} [options.onActiveChange]
   * @param {(screens: object[]) => void} [options.onScreensChange] called with the
   *   open screens whenever a window opens or closes
   * @param {(screenId: string) => void} [options.onScreenSelfClosed] called when a
   *   receiver shut ITSELF down (Esc, or the window's own close button) rather
   *   than being closed from here — the rig's owner has to hear about it, or the
   *   next edit reopens a projector somebody deliberately switched off
   */
  constructor(sourceCanvas, options = {}) {
    this.sourceCanvas = sourceCanvas;
    this.windowLabel = options.windowLabel || WINDOW_LABEL;
    this.renderer = options.renderer || null;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.onActiveChange = typeof options.onActiveChange === 'function'
      ? options.onActiveChange
      : () => {};
    this.onScreensChange = typeof options.onScreensChange === 'function'
      ? options.onScreensChange
      : () => {};
    this.onScreenSelfClosed = typeof options.onScreenSelfClosed === 'function'
      ? options.onScreenSelfClosed
      : () => {};

    // The open rig: screen id -> { screen, win, unlistenEditorClose, displayIndex }.
    // Empty means no output at all, which is what `isActive` reports on.
    /** @type {Map<string, {screen: object, win: object, unlistenEditorClose: (()=>void)|null, displayIndex: number}>} */
    this._screens = new Map();
    this._unlistenMainClose = null; // editor close-requested unlisten (close children with editor)
    this._channel = null;        // BroadcastChannel to the receiver pages
    this._onChannelMessage = null;
    this._unsubscribeOpacity = null; // VJ master fader subscription
    this._stateTap = null;       // handler registered on the renderer's state tap
    this._frameTap = null;       // handler registered on the renderer's frame tap (fallback)
    this._mode = null;           // 'native' | 'fallback', decided per shader
    this._lastWgsl = undefined;  // last WGSL broadcast (undefined = none yet)
    this._lastComputeSig = null; // last compute-graph structure signature broadcast
    this._lastFragmentSig = null; // last fragment-subgraph structure signature broadcast
    this._sentFragmentNodes = false; // whether a non-empty FRAGMENT_GRAPH has been sent
    this._forceFallback = false; // receiver can't render natively → pixels only
    // Latest projection-mapping snapshot, or null while the output is unmapped.
    // Held so a viewer opened (or reconnected) mid-set starts already aligned.
    // The mapping is composition-wide: every screen in the rig warps through it,
    // each folding in its own framing (see screenRegion.composeMappingWithRegion).
    this._mapping = null;
    this._feedbackStateInFlight = false; // a feedback-state capture/broadcast is running
    this._stepSeq = 0;           // sim-step counter (one per COMPUTE_UNIFORMS message)
    this._active = false;
  }

  /** True while any output window is open. */
  get isActive() {
    return this._active;
  }

  /** How many output windows are open right now. */
  get screenCount() {
    return this._screens.size;
  }

  /** The screen records currently holding a window, in the order they opened. */
  openScreens() {
    return [...this._screens.values()].map((entry) => entry.screen);
  }

  /** Whether a screen's window is open. */
  isScreenOpen(screenId) {
    return this._screens.has(screenId);
  }

  /** Whether second-display placement is available (always true under Tauri). */
  static supportsDisplayPlacement() {
    return isTauri();
  }

  /** Open if closed, close if open. @returns {Promise<boolean>} active state */
  async toggle() {
    if (this._active) {
      await this.close();
      return false;
    }
    await this.open();
    return this._active;
  }

  /**
   * Open the single-output screen. The one-screen case — the output button in the
   * menu — goes through here, and gets exactly the window it always did.
   */
  async open() {
    await this.openScreen(makeScreen({ id: MAIN_SCREEN_ID }));
  }

  /**
   * Open one screen's output window, starting the broadcast engine if this is the
   * first. Opening a screen that is already open just focuses its window.
   *
   * @param {object} screen a screen record (see ScreenModel.makeScreen)
   */
  async openScreen(screen) {
    if (!screen || !screen.id) return;
    const existing = this._screens.get(screen.id);
    if (existing) {
      // Already open: adopt any changed framing, and bring it forward.
      this.setScreenConfig(screen);
      try { await existing.win?.setFocus(); } catch { /* ignore */ }
      return;
    }
    if (!this.sourceCanvas) {
      this.onStatus('No render canvas available to mirror', 'error');
      return;
    }
    if (!isTauri()) {
      this.onStatus('Multi-screen output requires the desktop app', 'error');
      return;
    }

    const wasActive = this._active;
    try {
      this._ensureEngine();
      await this._createScreenWindow(screen);
    } catch (err) {
      console.error('[TauriSecondMonitorViewer] open failed:', err);
      this.onStatus('Could not open output window: ' + (err?.message || err), 'error');
      if (!this._screens.size) this._teardown();
      return;
    }

    this._active = true;
    // Send the framing straight away rather than waiting for the receiver's
    // READY. The page is still loading and will miss this one, and READY re-sends
    // it — but a receiver that reconnects without a fresh READY (a reload racing
    // our bookkeeping) then still has a config to work from.
    this._broadcastScreenConfig(screen.id);
    if (!wasActive) {
      this._startTap();
      this._applyRenderCap();
      this.onActiveChange(true);
    }
    this.onScreensChange(this.openScreens());
    this.onStatus(this._screens.size > 1
      ? `Output open on ${this._screens.size} screens`
      : 'Second-monitor viewer opened');
  }

  /**
   * Close one screen's window, stopping the broadcast engine when it was the last.
   * @param {string} screenId
   */
  async closeScreen(screenId) {
    const entry = this._screens.get(screenId);
    if (!entry) return;
    this._screens.delete(screenId);

    // Tell the receiver first: a window that shuts itself down goes black rather
    // than showing a frozen last frame while the OS tears it down.
    try { this._channel?.postMessage({ type: MSG.CLOSE, screenId }); } catch { /* ignore */ }
    if (typeof entry.unlistenEditorClose === 'function') {
      try { entry.unlistenEditorClose(); } catch { /* ignore */ }
    }
    try { await entry.win?.close(); } catch { /* already gone */ }

    if (this._screens.size === 0) {
      const wasActive = this._active;
      this._stopTap();
      this._teardown();
      this._restoreRenderCap();
      if (wasActive) {
        this.onActiveChange(false);
        this.onStatus('Second-monitor viewer closed');
      }
    } else {
      this.onStatus(`Output open on ${this._screens.size} screen${this._screens.size === 1 ? '' : 's'}`);
    }
    this.onScreensChange(this.openScreens());
  }

  /** Close every output window and stop mirroring. */
  async close() {
    const ids = [...this._screens.keys()];
    for (const id of ids) await this.closeScreen(id);
    // Nothing was open: still make sure no engine state is left behind.
    if (!ids.length) {
      this._stopTap();
      this._teardown();
      this._restoreRenderCap();
    }
  }

  /**
   * Bring the open rig in line with a list of screens: open what should be open,
   * close what should not, and push new framing to the rest.
   *
   * This is what the screens panel calls on every edit, so it must be cheap and
   * non-destructive for screens that did not change — retiling a wall must not
   * blink every projector that kept its tile.
   *
   * @param {object[]} screens the screens that should hold a window
   * @returns {Promise<void>}
   */
  syncScreens(screens) {
    // Model changes arrive faster than windows open — a layout button rewrites
    // the whole rig in one go, and the panel notifies once per edit. Chain the
    // syncs so two never interleave: overlapping runs would both see a screen as
    // missing and open its window twice.
    const run = () => this._syncScreensNow(screens);
    this._syncChain = (this._syncChain || Promise.resolve()).then(run, run);
    return this._syncChain;
  }

  /** One sync pass. Always run through {@link syncScreens}, never directly. */
  async _syncScreensNow(screens) {
    const wanted = new Map((Array.isArray(screens) ? screens : []).map((s) => [s.id, s]));

    for (const id of [...this._screens.keys()]) {
      if (!wanted.has(id)) await this.closeScreen(id);
    }
    for (const [id, screen] of wanted) {
      const open = this._screens.get(id);
      if (!open) {
        await this.openScreen(screen);
      } else if (this._screenChanged(open.screen, screen)) {
        // A display reassignment is the one edit that needs the window itself
        // moved, which Tauri does not do in place — reopen just that screen.
        if ((open.screen.displayIndex ?? -1) !== (screen.displayIndex ?? -1)) {
          await this.closeScreen(id);
          await this.openScreen(screen);
        } else {
          open.screen = screen;
          this.setScreenConfig(screen);
        }
      }
    }
  }

  /** Whether two screen records differ in anything a window cares about. */
  _screenChanged(a, b) {
    return a.name !== b.name
      || (a.displayIndex ?? -1) !== (b.displayIndex ?? -1)
      || (a.displayMaxDim || 0) !== (b.displayMaxDim || 0)
      || JSON.stringify(sanitizeRegion(a.region)) !== JSON.stringify(sanitizeRegion(b.region));
  }

  /**
   * Push a screen's framing to its window: which crop of the composition it
   * shows, what it is called, and how many pixels it presents with.
   * @param {object} screen
   */
  setScreenConfig(screen) {
    if (!screen || !screen.id) return;
    const entry = this._screens.get(screen.id);
    if (entry) entry.screen = { ...entry.screen, ...screen };
    this._broadcastScreenConfig(screen.id);
  }

  /** Send one screen's SCREEN_CONFIG + resolution contract, if it is open. */
  _broadcastScreenConfig(screenId) {
    const entry = this._screens.get(screenId);
    if (!entry || !this._channel) return;
    const screen = entry.screen;
    try {
      this._channel.postMessage({
        type: MSG.SCREEN_CONFIG,
        screenId,
        name: screen.name || '',
        region: sanitizeRegion(screen.region),
        displayMaxDim: screen.displayMaxDim || 0,
      });
    } catch { /* ignore */ }
    // The render contract is per screen too: every screen RENDERS the output
    // format (so all their sims match the editor's exactly) and differs only in
    // how many pixels it presents with.
    try {
      this._channel.postMessage({
        type: MSG.RENDER_RES,
        screenId,
        maxDim: MATCH_OUTPUT,
        displayMaxDim: screen.displayMaxDim || 0,
      });
    } catch { /* ignore */ }
  }

  /**
   * Stand up the shared broadcast engine: the one channel and the one master-fader
   * subscription the whole rig runs on. Idempotent — the second and third screen
   * reuse what the first stood up, which is why they cost the editor almost
   * nothing.
   */
  _ensureEngine() {
    if (this._channel) return;
    const channel = openSecondMonitorChannel();
    if (!channel) throw new Error('BroadcastChannel is unavailable');
    this._channel = channel;
    this._onChannelMessage = (e) => this._handleChannelMessage(e);
    channel.addEventListener('message', this._onChannelMessage);

    // The receivers render their own frames, so the master fader's effect on the
    // editor's canvas never reaches them. Follow the level and send it across.
    this._unsubscribeOpacity = onOutputOpacityChange((opacity) => {
      this._broadcastMasterOpacity(opacity);
    });
  }

  /** Create one screen's native window and register it in the open rig. */
  async _createScreenWindow(screen) {
    const windowApi = await import('@tauri-apps/api/window');
    const { monitors, editorIndex } = await readDisplayLayout(windowApi);
    // Automatic placement must not stack two screens on one projector, so it
    // skips the displays the rig has already claimed.
    const taken = new Set();
    for (const entry of this._screens.values()) {
      if (entry.displayIndex >= 0) taken.add(entry.displayIndex);
    }
    const opened = await openScreenWindow({
      screen,
      pageUrl: this._receiverUrl(),
      monitors,
      editorIndex,
      taken,
    });
    this._screens.set(screen.id, {
      screen,
      win: opened.win,
      unlistenEditorClose: opened.unlistenEditorClose,
      displayIndex: opened.displayIndex,
    });
    return opened;
  }

  /** Resolve the receiver page URL as a sibling of the current editor page. */
  _receiverUrl() {
    try {
      const { pathname } = window.location;
      const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '');
      return dir + 'second-monitor.html';
    } catch {
      return '/editor/second-monitor.html';
    }
  }

  /**
   * Cap the editor's render loop to a fixed 60fps while the output window is open.
   * In vsync mode the editor renders once per rAF — i.e. at the editor monitor's
   * refresh rate (e.g. 75Hz) — so on a high-refresh display it over-drives the
   * (now full-resolution) compute work and the framerate suffers, more so when
   * the output is on a slower display. A fixed-60 cap evens that out.
   */
  _applyRenderCap() {
    const loop = (typeof window !== 'undefined') ? window.renderLoop : null;
    if (!loop || typeof loop.setMode !== 'function') return;
    try {
      const st = typeof loop.getState === 'function' ? loop.getState() : null;
      this._savedLoopMode = st ? st.mode : (loop.mode || null);
      this._savedLoopFps = st ? st.fixedFps : (loop.fixedFps || null);
    } catch { this._savedLoopMode = null; this._savedLoopFps = null; }
    try { loop.setFixedFps(60); loop.setMode('fixed'); } catch { /* ignore */ }
  }

  /** Restore the editor's render-loop mode/fps captured in _applyRenderCap. */
  _restoreRenderCap() {
    const loop = (typeof window !== 'undefined') ? window.renderLoop : null;
    if (!loop || typeof loop.setMode !== 'function') return;
    try {
      if (this._savedLoopMode) loop.setMode(this._savedLoopMode);
      if (this._savedLoopFps != null && typeof loop.setFixedFps === 'function') loop.setFixedFps(this._savedLoopFps);
    } catch { /* ignore */ }
    this._savedLoopMode = null;
    this._savedLoopFps = null;
  }

  /** Tear down completely (alias of close for symmetry with other managers). */
  destroy() {
    this.close();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Release the shared engine — channel, subscriptions, loop state — without
   * firing user callbacks. Any window still registered is dropped from the rig
   * here; closing the windows themselves is closeScreen's job.
   */
  _teardown() {
    this._stopTap();
    if (this._channel && this._onChannelMessage) {
      try { this._channel.removeEventListener('message', this._onChannelMessage); } catch { /* ignore */ }
    }
    if (typeof this._unsubscribeOpacity === 'function') {
      try { this._unsubscribeOpacity(); } catch { /* ignore */ }
    }
    this._unsubscribeOpacity = null;
    try { this._channel?.close(); } catch { /* ignore */ }
    for (const entry of this._screens.values()) {
      if (typeof entry.unlistenEditorClose === 'function') {
        try { entry.unlistenEditorClose(); } catch { /* ignore */ }
      }
    }
    this._screens.clear();
    if (typeof this._unlistenMainClose === 'function') {
      try { this._unlistenMainClose(); } catch { /* ignore */ }
    }
    this._unlistenMainClose = null;
    this._channel = null;
    this._onChannelMessage = null;
    this._active = false;
  }

  _handleChannelMessage(e) {
    const data = e?.data;
    if (!data) return;
    // Receivers name themselves; a message from a page that predates screen
    // addressing is the single-output screen.
    const screenId = data.screenId || MAIN_SCREEN_ID;
    // A receiver closed itself (Esc or native close) — sync that screen's state,
    // and tell the owner so the rig records the screen as off rather than
    // reopening it on the next unrelated edit.
    if (data.type === MSG.CLOSED) {
      if (this._screens.has(screenId)) {
        try { this.onScreenSelfClosed(screenId); } catch { /* ignore */ }
      }
      this.closeScreen(screenId);
      return;
    }
    // A receiver cannot render natively (no WebGPU / device lost). Pin the pixel
    // path so it always has something to show. The tap is shared, so one screen
    // that cannot go native puts the whole rig on pixels — which is correct: a
    // fallback screen has nothing else to paint.
    if (data.type === MSG.NEED_FALLBACK) {
      this._forceFallback = true;
      this._enterFallback();
      return;
    }
    // A (re)connecting receiver needs the current shader + tier to bootstrap.
    if (data.type === MSG.READY) {
      const native = this._mode === 'native' || this._mode === 'native-compute';
      if (native && this._lastWgsl) {
        try { this._channel?.postMessage({ type: MSG.SHADER, wgsl: this._lastWgsl }); } catch { /* ignore */ }
      }
      if (this._mode === 'native-compute') {
        this._broadcastComputeGraph();
        this._broadcastFragmentGraph();
        this._broadcastAllTextures();
        this._broadcastFeedbackStates();
      }
      if (this._mode) {
        try { this._channel?.postMessage({ type: MSG.CAPS, tier: this._mode }); } catch { /* ignore */ }
      }
      // Everything above is composition-wide and reaches the whole rig. What this
      // screen still needs is its own framing and resolution contract.
      this._broadcastScreenConfig(screenId);
      if (!this._screens.has(screenId)) {
        // A receiver we have no record of (a reload racing our bookkeeping):
        // it still needs the resolution contract, or it renders at the wrong size.
        try {
          this._channel?.postMessage({
            type: MSG.RENDER_RES,
            screenId,
            maxDim: MATCH_OUTPUT,
            displayMaxDim: 0,
          });
        } catch { /* ignore */ }
      }
      // A mirror opened mid-set has to start at the level already on the fader,
      // not full brightness.
      this._broadcastMasterOpacity(getOutputOpacity());
      // Likewise the mapping: a projector re-opened onto the same rig must come
      // back on its surfaces, not full-frame.
      this._broadcastMapping();
    }
  }

  /** Send the current output level (master fader × any running transition). */
  _broadcastMasterOpacity(opacity) {
    if (!this._channel) return;
    const level = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
    try {
      this._channel.postMessage({ type: MSG.MASTER_OPACITY, opacity: level });
    } catch { /* ignore */ }
  }

  /**
   * Set the projection mapping the output window warps its frames through.
   *
   * Called on every edit while a corner is being dragged, so this stays a
   * single small structured-clone with no rendering work on the editor's side.
   *
   * @param {{enabled:boolean, surfaces:object[]}|null} snapshot a
   *   MappingModel.serialize() result, or null to present unmapped
   */
  setMapping(snapshot) {
    this._mapping = snapshot || null;
    this._broadcastMapping();
  }

  /** Send the held mapping snapshot, if a receiver is listening. */
  _broadcastMapping() {
    if (!this._channel || !this._mapping) return;
    try {
      this._channel.postMessage({ type: MSG.MAPPING, mapping: this._mapping });
    } catch { /* ignore */ }
  }

  /**
   * Set a screen's DISPLAY size: the long edge, in device pixels, of the surface
   * it presents on. 0 (the default) uses the display's own resolution. The render
   * itself is always the output format, letterboxed into this surface, so the
   * screen shows exactly the editor's framing (cropped to its region) and its
   * sims stay 1:1 — only the cost of presenting changes. Persists across
   * reconnects (re-sent on READY). No-op unless that screen is open.
   * @param {number} longEdge
   * @param {string} [screenId] which screen; defaults to the single-output screen
   */
  setDisplayResolution(longEdge, screenId = MAIN_SCREEN_ID) {
    let v = Math.round(Number(longEdge));
    if (!Number.isFinite(v) || v <= 0) v = 0;
    else v = Math.max(MIN_DISPLAY_EDGE, Math.min(MAX_DISPLAY_EDGE, v));
    const entry = this._screens.get(screenId);
    if (entry) entry.screen = { ...entry.screen, displayMaxDim: v };
    else if (screenId === MAIN_SCREEN_ID) this._pendingMainDisplayMaxDim = v;
    this._broadcastScreenConfig(screenId);
  }

  /**
   * A screen's presentation long edge in device px; 0 = the display's own
   * resolution.
   * @param {string} [screenId]
   */
  displayResolutionFor(screenId = MAIN_SCREEN_ID) {
    const entry = this._screens.get(screenId);
    if (entry) return entry.screen.displayMaxDim || 0;
    return screenId === MAIN_SCREEN_ID ? (this._pendingMainDisplayMaxDim || 0) : 0;
  }

  /** The single-output screen's display long edge; 0 = the display's own resolution. */
  get displayMaxDim() { return this.displayResolutionFor(MAIN_SCREEN_ID); }
  /**
   * Start mirroring. Prefer the native STATE tap: broadcast tiny uniform bytes
   * and let the receiver re-render. The first snapshot picks native vs the pixel
   * fallback from the shader's bindings. Old renderers without a state tap use
   * the pixel frame tap directly.
   */
  _startTap() {
    const renderer = this._resolveRenderer();
    if (!renderer) return;
    this._lastWgsl = undefined;
    this._lastComputeSig = null;
    this._lastFragmentSig = null;
    this._sentFragmentNodes = false;
    this._mode = null;
    if (typeof renderer.setStateTap === 'function') {
      this._stateTap = (snap) => this._onState(snap);
      renderer.setStateTap(this._stateTap);
    } else if (typeof renderer.setFrameTap === 'function') {
      this._enterFallback();
    }
  }

  _stopTap() {
    const renderer = this._resolveRenderer();
    if (renderer) {
      if (this._stateTap && typeof renderer.setStateTap === 'function') {
        try { renderer.setStateTap(null); } catch { /* ignore */ }
      }
      if (this._frameTap && typeof renderer.setFrameTap === 'function') {
        try { renderer.setFrameTap(null); } catch { /* ignore */ }
      }
    }
    this._stateTap = null;
    this._frameTap = null;
    this._mode = null;
    this._lastWgsl = undefined;
  }

  /**
   * One per-frame state snapshot from the renderer. On a shader change it (re)picks
   * native vs the pixel fallback and broadcasts the WGSL; in native mode it then
   * broadcasts the uniform bytes. The payload is well under 1 KB, so the
   * structured clone BroadcastChannel performs is negligible — unlike the multi-MB
   * frame copy the old pixel path did every frame.
   */
  _onState(snap) {
    if (!this._active || !this._channel || !snap) return;
    const wgsl = snap.wgsl || null;
    // Re-evaluate the tier every frame, not only on a WGSL change: the 3D scene
    // condition (_hasExternalSceneOutput) can flip WITHOUT the shader changing — a
    // Field Visualizer publishes its output the frame after it's wired, and is
    // removed on node delete. The check is cheap (a small resource scan + a set
    // size), and _applyTier no-ops when the mode is unchanged.
    const desiredTier = this._decideTier();
    const tierChanged = desiredTier !== this._modeTier();
    if (wgsl !== this._lastWgsl || tierChanged) {
      this._lastWgsl = wgsl;
      this._applyTier(desiredTier);
      if (this._mode === 'native' || this._mode === 'native-compute') {
        try { this._channel.postMessage({ type: MSG.SHADER, wgsl }); } catch { /* ignore */ }
        if (this._mode === 'native-compute') {
          this._broadcastComputeGraph();
          this._broadcastFragmentGraph();
          this._broadcastAllTextures();
          this._broadcastFeedbackStates();
          this._lastComputeSig = this._computeGraphSignature();
          this._lastFragmentSig = this._fragmentGraphSignature();
        }
      }
    }
    // Re-broadcast the compute graph when its STRUCTURE changes without a WGSL change
    // — e.g. a new node connected into a compute node's input (ComputeEdgeDetect),
    // or a compute resolution change. Otherwise the receiver kept the old wiring
    // until the viewer was re-opened.
    if (this._mode === 'native-compute') {
      const sig = this._computeGraphSignature();
      if (sig !== this._lastComputeSig) {
        this._lastComputeSig = sig;
        this._broadcastComputeGraph();
        this._broadcastAllTextures();
        // A structure change rebuilds the receiver's compute graph, which clears
        // its feedback sims — re-seed them from the editor's current state.
        this._broadcastFeedbackStates();
      }
      // Re-broadcast the fragment subgraph when ITS structure changes (a fragment
      // node rewired into compute, or an expression param edited — both change the
      // compiled WGSL). Static param VALUES are NOT in the signature: they stream via
      // FRAGMENT_UNIFORMS below, so dragging a param doesn't trigger a pipeline rebuild.
      const fsig = this._fragmentGraphSignature();
      if (fsig !== this._lastFragmentSig) {
        this._lastFragmentSig = fsig;
        this._broadcastFragmentGraph();
      }
    }
    if (this._mode === 'native' || this._mode === 'native-compute') {
      try {
        this._channel.postMessage({
          type: MSG.UNIFORMS,
          aspect: snap.aspect || null,
          globals: snap.globals || null,
          params: snap.params || null,
        });
      } catch { /* channel closed mid-flight */ }
      if (this._mode === 'native-compute' && snap.compute) {
        // One message = one editor sim step; `step` lets the receiver align a
        // FEEDBACK_STATE seed with the stream (drop steps the state already contains).
        this._stepSeq += 1;
        try { this._channel.postMessage({ type: MSG.COMPUTE_UNIFORMS, nodes: snap.compute, step: this._stepSeq }); } catch { /* ignore */ }
      }
      if (this._mode === 'native-compute' && snap.fragment) {
        try { this._channel.postMessage({ type: MSG.FRAGMENT_UNIFORMS, nodes: snap.fragment }); } catch { /* ignore */ }
      }
    }
  }

  /**
   * A compute node's inputs with control-pin slots (e.g. the Feedback nodes' Reset
   * pin) masked to null. Control pins carry CPU-only scalars the receiver never
   * consumes — resets arrive as FEEDBACK_RESET messages instead — so their wiring
   * must not enter the broadcast graph or its structure signature. Otherwise merely
   * wiring a Trigger into a Reset pin rebuilt the receiver's compute graph, which
   * cleared its feedback sims. Masking (not removing) preserves pin indices.
   */
  _broadcastableInputs(node) {
    const inputs = Array.isArray(node.inputs) ? node.inputs.slice() : [];
    const controlPins = controlInputPinIndices(node.kind);
    if (controlPins.size) {
      for (const pin of controlPins) { if (pin < inputs.length) inputs[pin] = null; }
    }
    return inputs;
  }

  /**
   * Cheap signature of the compute subgraph's STRUCTURE (node ids, kinds, input
   * wiring and texture sizes). Changes when a node is added/removed, rewired, or
   * resized — used to re-broadcast COMPUTE_GRAPH so the receiver rebuilds. Does NOT
   * include per-frame uniforms (those stream separately) or control-pin wiring
   * (resets ride FEEDBACK_RESET; a rebuild would clear the receiver's sims).
   */
  _computeGraphSignature() {
    const exec = (typeof window !== 'undefined') ? window.computeExecutor : null;
    const registry = (typeof window !== 'undefined') ? window.computeNodeRegistry : null;
    if (!registry || typeof registry.forEach !== 'function') return '';
    const parts = [];
    registry.forEach((data, id) => {
      const node = data && data.node;
      if (!node) return;
      const mgr = (exec && exec.computeManagers && typeof exec.computeManagers.get === 'function')
        ? exec.computeManagers.get(id) : null;
      const res = data.resolution || node.computeResolution || [];
      const w = (mgr && mgr.textureWidth) || res[0] || 0;
      const h = (mgr && mgr.textureHeight) || res[1] || 0;
      const inputs = this._broadcastableInputs(node).join(',');
      parts.push(`${id}:${node.kind}:${inputs}:${w}x${h}`);
    });
    return parts.join('|');
  }

  /** Decide the mirror tier for the current shader (native / native-compute / fallback). */
  _decideTier() {
    if (this._forceFallback) return TIER.FALLBACK;
    // 3D Field Visualizer (and any externally-owned scene) output is a live
    // GPUTexture the editor injects into the compute-texture table — a rendered 3D
    // scene with no WGSL and no ping-pong sim, so the receiver has no way to
    // reproduce it from the broadcast state. classifyMirrorTier() only sees a
    // texture binding and would pick native-compute, leaving the receiver to render
    // black where the 3D view should be. Route these graphs to the pixel-mirror
    // fallback instead so the second monitor shows the composited scene.
    if (this._hasExternalSceneOutput()) return TIER.FALLBACK;
    const renderer = this._resolveRenderer();
    if (renderer && typeof renderer.classifyMirrorTier === 'function') {
      return renderer.classifyMirrorTier();
    }
    // Back-compat with renderers lacking the classifier.
    if (renderer && typeof renderer.isNativeMirrorEligible === 'function' && renderer.isNativeMirrorEligible()) {
      return TIER.NATIVE;
    }
    return TIER.FALLBACK;
  }

  /**
   * True when the editor has any externally-owned scene output — currently the 3D
   * Field Visualizer, which renders its scene to an offscreen GPUTexture and
   * publishes it into the compute-executor's texture table (tracked in
   * `externalOutputNodeIds`, which FieldMapperIntegration keeps in step with the
   * live field-mapper nodes: added on publish, removed on node delete). These
   * textures are rendered pixels, not reproducible from the broadcast WGSL/uniform
   * state, so any graph consuming one must mirror pixels rather than re-render.
   */
  _hasExternalSceneOutput() {
    const exec = (typeof window !== 'undefined') ? window.computeExecutor : null;
    const ids = exec && exec.externalOutputNodeIds;
    return !!(ids && typeof ids.size === 'number' && ids.size > 0);
  }

  /** The TIER constant matching the current mirror mode (FALLBACK when none set). */
  _modeTier() {
    if (this._mode === 'native-compute') return TIER.NATIVE_COMPUTE;
    if (this._mode === 'native') return TIER.NATIVE;
    return TIER.FALLBACK;
  }

  _applyTier(tier) {
    if (tier === TIER.NATIVE_COMPUTE) this._enterNativeCompute();
    else if (tier === TIER.NATIVE) this._enterNative();
    else this._enterFallback();
  }

  _enterNative() { this._setMirrorMode('native', TIER.NATIVE); }
  _enterNativeCompute() { this._setMirrorMode('native-compute', TIER.NATIVE_COMPUTE); }
  _enterFallback() { this._setMirrorMode('fallback', TIER.FALLBACK); }

  /**
   * Switch mirror mode: the pixel frame tap runs only in fallback; per-node
   * compute uniform collection runs only in native-compute; advertise the tier.
   */
  _setMirrorMode(mode, tier) {
    if (this._mode === mode) return;
    this._mode = mode;
    const renderer = this._resolveRenderer();
    if (mode === 'fallback') {
      if (renderer && typeof renderer.setFrameTap === 'function') {
        this._frameTap = (bitmap) => this._onTappedFrame(bitmap);
        try { renderer.setFrameTap(this._frameTap); } catch { /* ignore */ }
      }
    } else {
      if (this._frameTap && renderer && typeof renderer.setFrameTap === 'function') {
        try { renderer.setFrameTap(null); } catch { /* ignore */ }
      }
      this._frameTap = null;
    }
    if (renderer && typeof renderer.setStateTapComputeMode === 'function') {
      try { renderer.setStateTapComputeMode(mode === 'native-compute'); } catch { /* ignore */ }
    }
    try { this._channel?.postMessage({ type: MSG.CAPS, tier }); } catch { /* ignore */ }
  }

  /** Broadcast the compute subgraph (per-node WGSL + metadata) for the receiver to rebuild. */
  _broadcastComputeGraph() {
    const exec = (typeof window !== 'undefined') ? window.computeExecutor : null;
    const registry = (typeof window !== 'undefined') ? window.computeNodeRegistry : null;
    if (!exec || !registry || typeof registry.forEach !== 'function') return;
    const nodes = [];
    registry.forEach((data, id) => {
      const node = data && data.node;
      if (!node) return;
      // Broadcast the manager's ACTUAL texture size (the editor renders compute at
      // the preview resolution, e.g. FHD). The registry `resolution` field is often
      // empty, which left the receiver on its low 1024² default → blurry output.
      const mgr = (exec.computeManagers && typeof exec.computeManagers.get === 'function')
        ? exec.computeManagers.get(id) : null;
      const res = data.resolution || node.computeResolution || [];
      const width = (mgr && mgr.textureWidth) || res[0] || 0;
      const height = (mgr && mgr.textureHeight) || res[1] || 0;
      nodes.push({
        id,
        kind: node.kind,
        wgsl: data.wgslCode,
        width,
        height,
        supportsFeedback: !!data.supportsFeedback,
        inputs: this._broadcastableInputs(node),
      });
    });
    const executionOrder = Array.isArray(exec.executionOrder) ? exec.executionOrder.slice() : [];
    try { this._channel.postMessage({ type: MSG.COMPUTE_GRAPH, nodes, executionOrder }); } catch { /* ignore */ }
  }

  /**
   * Collect the fragment-input subgraph: every fragment node that feeds a compute
   * node, plus its transitive non-compute dependencies (other fragment/value/image
   * nodes the codegen needs). Compute nodes are excluded — they ride COMPUTE_GRAPH,
   * and the receiver already has them in its synthetic graph. Each node is serialized
   * as {id, kind, params, inputs} from window.graph so the receiver can rebuild it and
   * its own FragmentTextureRenderer can compile identical WGSL.
   * @returns {Array<{id, kind, params, inputs}>}
   */
  _collectFragmentSubgraph() {
    const registry = (typeof window !== 'undefined') ? window.computeNodeRegistry : null;
    const graph = (typeof window !== 'undefined') ? window.graph : null;
    if (!registry || typeof registry.forEach !== 'function' || !graph) return [];
    const isCompute = (id) => registry.has(id) || registry.has(String(id));
    const getNode = (id) => {
      try {
        if (graph.getNode) return graph.getNode(id);
        if (Array.isArray(graph.nodes)) return graph.nodes.find((n) => String(n.id) === String(id)) || null;
      } catch { /* ignore */ }
      return null;
    };
    const collected = new Map(); // id -> serialized node
    const visit = (id) => {
      if (id == null || isCompute(id) || collected.has(id)) return;
      const node = getNode(id);
      if (!node) return;
      collected.set(node.id, {
        id: node.id,
        kind: node.kind,
        params: node.params ? { ...node.params } : {},
        inputs: Array.isArray(node.inputs) ? node.inputs.slice() : [],
      });
      if (Array.isArray(node.inputs)) for (const inId of node.inputs) visit(inId);
    };
    // Seed from every compute node's non-compute (fragment) inputs. Control pins
    // (e.g. the Feedback nodes' Reset pin) are masked out: their scalar sources
    // (a Trigger, say) are CPU-only and must not be broadcast as fragment feeders.
    registry.forEach((data) => {
      const node = data && data.node;
      if (!node) return;
      for (const inId of this._broadcastableInputs(node)) {
        if (inId != null && !isCompute(inId)) visit(inId);
      }
    });
    return [...collected.values()];
  }

  /**
   * Broadcast the fragment-input subgraph for the receiver to reconstruct. Skipped
   * entirely for graphs with no fragment-fed compute (the common case) so pure compute
   * graphs never carry the message; sent once with an empty list to clear the receiver
   * after the last fragment feeder is disconnected.
   */
  _broadcastFragmentGraph() {
    if (!this._channel) return;
    const nodes = this._collectFragmentSubgraph();
    if (nodes.length === 0 && !this._sentFragmentNodes) return; // nothing to send or clear
    this._sentFragmentNodes = nodes.length > 0;
    try { this._channel.postMessage({ type: MSG.FRAGMENT_GRAPH, nodes }); } catch { /* ignore */ }
  }

  /**
   * Cheap signature of the fragment subgraph's STRUCTURE — node ids, kinds, wiring,
   * and only EXPRESSION-valued params (those compile into the WGSL, so they need a
   * receiver-side rebuild). Static numeric param values are deliberately excluded:
   * they stream every frame via FRAGMENT_UNIFORMS, so changing one must NOT force a
   * pipeline rebuild on the receiver.
   */
  _fragmentGraphSignature() {
    const nodes = this._collectFragmentSubgraph();
    if (!nodes.length) return '';
    const parts = nodes.map((n) => {
      const exprs = [];
      for (const k in n.params) {
        const v = n.params[k];
        if (typeof v !== 'string') continue;
        const trimmed = v.trim();
        // Expressions compile into the WGSL, so they need a receiver-side rebuild. So does any
        // other NON-NUMERIC string param — a select like the Trigger node's Mode or the Resolution
        // node's Mode picks which code the compiler emits, and unlike a numeric param it never
        // streams via FRAGMENT_UNIFORMS, so without it the receiver would keep running the shader
        // built for the old mode.
        const isExpr = trimmed.startsWith('=') || /time|audioEnvelope/i.test(trimmed);
        if (isExpr || !Number.isFinite(parseFloat(trimmed))) {
          exprs.push(`${k}=${v}`);
        }
      }
      const inputs = Array.isArray(n.inputs) ? n.inputs.join(',') : '';
      return `${n.id}:${n.kind}:${inputs}:${exprs.join('&')}`;
    });
    return parts.join('|');
  }

  /** Broadcast every currently-loaded image/video texture to the receiver. */
  _broadcastAllTextures() {
    const tm = (typeof window !== 'undefined') ? window.textureManager : null;
    if (!tm || !tm.textures || typeof tm.textures.forEach !== 'function') return;
    tm.textures.forEach((info, nodeId) => { this._broadcastTexture(nodeId, info); });
  }

  /**
   * Broadcast the CURRENT state of every feedback sim (its next-read ping-pong
   * texture, read back once) so the receiver's replica starts from the editor's
   * state instead of t=0. With the per-step COMPUTE_UNIFORMS lockstep, the two
   * sims then evolve identically. Fire-and-forget: capture is async (GPU→CPU
   * readback) and must never block the state tap; sequential per node so the
   * readbacks don't pile up. Coalesced — a call while one is running is dropped
   * (every call site re-sends the full current state anyway).
   */
  _broadcastFeedbackStates() {
    if (this._feedbackStateInFlight) return;
    const exec = (typeof window !== 'undefined') ? window.computeExecutor : null;
    const managers = exec && exec.computeManagers;
    if (!managers || typeof managers.forEach !== 'function') return;
    const jobs = [];
    managers.forEach((m, id) => {
      if (m && m.supportsFeedback && typeof m.captureFeedbackState === 'function') jobs.push([id, m]);
    });
    if (!jobs.length) return;
    this._feedbackStateInFlight = true;
    (async () => {
      try {
        for (const [nodeId, mgr] of jobs) {
          if (!this._active || !this._channel) break;
          // Read the step counter in the same sync block that encodes/submits the
          // readback, so the state is stamped with the last step it contains and the
          // receiver can drop queued steps the seed already includes.
          const atStep = this._stepSeq;
          let state = null;
          try { state = await mgr.captureFeedbackState(); } catch { /* skip node */ }
          if (!state || !this._active || !this._channel) continue;
          try {
            this._channel.postMessage({
              type: MSG.FEEDBACK_STATE,
              nodeId,
              width: state.width,
              height: state.height,
              data: state.data,
              step: atStep,
            });
          } catch { /* channel closed mid-flight */ }
        }
      } finally {
        this._feedbackStateInFlight = false;
      }
    })();
  }

  /**
   * Called by the editor when a Feedback node's sim was reset (the panel's
   * "Reset Feedback" button or a rising edge on its Reset pin — both funnel
   * through ComputeExecutor.resetNodeFeedback). The receiver replicates feedback
   * sims independently, so it must clear its own copy too. No-op unless a
   * native-compute mirror is open.
   */
  onFeedbackReset(nodeId) {
    if (!this._active || this._mode !== 'native-compute') return;
    try { this._channel?.postMessage({ type: MSG.FEEDBACK_RESET, nodeId }); } catch { /* ignore */ }
  }

  /**
   * Called by the editor when a texture is (re)loaded. Re-broadcasts it if a
   * native-compute mirror is open. No-op otherwise.
   */
  onTextureChanged(nodeId) {
    if (!this._active || this._mode !== 'native-compute') return;
    const tm = (typeof window !== 'undefined') ? window.textureManager : null;
    const info = (tm && (tm.getTexture?.(nodeId) || tm.textures?.get?.(nodeId))) || null;
    if (info) this._broadcastTexture(nodeId, info);
  }

  async _broadcastTexture(nodeId, info) {
    if (!this._channel || !info) return;
    const src = info.bitmap || info.image || info.source || info.video;
    if (!src || typeof createImageBitmap !== 'function') return;
    let bitmap;
    try { bitmap = await createImageBitmap(src); } catch { return; }
    if (!this._active || !this._channel) { try { bitmap.close?.(); } catch { /* ignore */ } return; }
    try {
      this._channel.postMessage({
        type: MSG.TEXTURE,
        nodeId,
        varKind: info.isCube ? 'cube' : '2d',
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
      });
    } catch {
      /* channel closed mid-flight */
    } finally {
      // The receiver gets a structured-clone copy; free ours.
      try { bitmap.close?.(); } catch { /* ignore */ }
    }
  }

  /**
   * Re-point the taps at a freshly created renderer (e.g. after a GPU device loss
   * recreated window.gpuRenderer). Called from main.js after device reinit.
   */
  reattach() {
    if (!this._active) return;
    this._stopTap();
    this.renderer = null; // force _resolveRenderer to pick up the new global
    this._startTap();
  }

  /** The GPURenderer to mirror — explicit option first, else the global one. */
  _resolveRenderer() {
    if (this.renderer) return this.renderer;
    this.renderer = (typeof window !== 'undefined' && window.gpuRenderer) || null;
    return this.renderer;
  }

  /**
   * Forward one captured frame to the receiver. We own the bitmap and must free
   * it. BroadcastChannel structured-clones it synchronously inside postMessage,
   * so the receiver gets an independent copy and we can close ours immediately.
   */
  _onTappedFrame(bitmap) {
    if (!bitmap) return;
    if (!this._active || !this._channel) { try { bitmap.close(); } catch { /* ignore */ } return; }
    const src = this.sourceCanvas;
    const sw = (src && src.width) || bitmap.width;
    const sh = (src && src.height) || bitmap.height;
    try {
      this._channel.postMessage({ type: MSG.FRAME, bitmap, sw, sh });
    } catch {
      // Channel closed mid-flight — nothing to deliver.
    } finally {
      try { bitmap.close(); } catch { /* ignore */ }
    }
  }
}
