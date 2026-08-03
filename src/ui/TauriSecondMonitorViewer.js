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
// All '@tauri-apps/api' access is via dynamic import() so that statically
// importing this module stays safe on the raw web deployments, which serve the
// source un-bundled and cannot resolve bare specifiers. This class is only ever
// constructed when isTauri() is true (see main.js).

import { isTauri } from '../utils/isTauri.js';
import { controlInputPinIndices } from '../data/NodeDefs.js';
import { getOutputOpacity, onOutputOpacityChange } from '../vj/MasterOutput.js';
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
  openSecondMonitorChannel,
} from './secondMonitorFrameChannel.js';

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
   * @param {string} [options.windowLabel]     Tauri window label (must be unique)
   * @param {Object} [options.renderer]        GPURenderer to tap for frames
   *                                           (falls back to window.gpuRenderer)
   * @param {(message: string, kind?: string) => void} [options.onStatus]
   * @param {(active: boolean) => void} [options.onActiveChange]
   */
  constructor(sourceCanvas, options = {}) {
    this.sourceCanvas = sourceCanvas;
    this.windowLabel = options.windowLabel || WINDOW_LABEL;
    this.renderer = options.renderer || null;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.onActiveChange = typeof options.onActiveChange === 'function'
      ? options.onActiveChange
      : () => {};

    this._win = null;            // the native WebviewWindow (frame target)
    this._unlistenMainClose = null; // editor close-requested unlisten (close child with editor)
    this._channel = null;        // BroadcastChannel to the receiver page
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
    // The viewer always RENDERS the output format (MATCH_OUTPUT, sent on every
    // RENDER_RES), so its sims and framing are identical to the editor's. Only
    // how many pixels the presentation surface spends is configurable here
    // (0 = the display's own resolution).
    this._displayMaxDim = 0;
    this._feedbackStateInFlight = false; // a feedback-state capture/broadcast is running
    this._stepSeq = 0;           // sim-step counter (one per COMPUTE_UNIFORMS message)
    this._active = false;
  }

  /** True while the second-monitor window is open. */
  get isActive() {
    return this._active;
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

  /** Open the native second-monitor window and start mirroring. */
  async open() {
    if (this._active) {
      try { await this._win?.setFocus(); } catch { /* ignore */ }
      return;
    }
    if (!this.sourceCanvas) {
      this.onStatus('No render canvas available to mirror', 'error');
      return;
    }
    if (!isTauri()) {
      this.onStatus('Second-monitor viewer requires the desktop app', 'error');
      return;
    }

    try {
      const channel = openSecondMonitorChannel();
      if (!channel) throw new Error('BroadcastChannel is unavailable');
      this._channel = channel;
      this._onChannelMessage = (e) => this._handleChannelMessage(e);
      channel.addEventListener('message', this._onChannelMessage);

      // The receiver renders its own frames, so the master fader's effect on the
      // editor's canvas never reaches it. Follow the level and send it across.
      this._unsubscribeOpacity = onOutputOpacityChange((opacity) => {
        this._broadcastMasterOpacity(opacity);
      });

      await this._createWindow();
    } catch (err) {
      console.error('[TauriSecondMonitorViewer] open failed:', err);
      this.onStatus('Could not open second-monitor window: ' + (err?.message || err), 'error');
      this._teardown();
      return;
    }

    this._active = true;
    this._startTap();
    this._applyRenderCap();
    this.onActiveChange(true);
    this.onStatus('Second-monitor viewer opened');
  }

  /** Close the window and stop mirroring. */
  async close() {
    const wasActive = this._active;
    this._stopTap();

    try { this._channel?.postMessage({ type: MSG.CLOSE }); } catch { /* ignore */ }

    const win = this._win;
    this._teardown();
    this._restoreRenderCap();
    if (win) { try { await win.close(); } catch { /* already gone */ } }

    if (wasActive) {
      this.onActiveChange(false);
      this.onStatus('Second-monitor viewer closed');
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

  /** Release channel/loop state without firing user callbacks. */
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
    if (typeof this._unlistenMainClose === 'function') {
      try { this._unlistenMainClose(); } catch { /* ignore */ }
    }
    this._unlistenMainClose = null;
    this._channel = null;
    this._onChannelMessage = null;
    this._win = null;
    this._active = false;
  }

  _handleChannelMessage(e) {
    const data = e?.data;
    if (!data) return;
    // The receiver closed itself (Esc or native close) — sync our state.
    if (data.type === MSG.CLOSED) { this.close(); return; }
    // The receiver cannot render natively (no WebGPU / device lost). Pin the
    // pixel path so it always has something to show.
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
      // A (re)connecting receiver needs the resolution contract: always render
      // the output format, at this display size.
      try {
        this._channel?.postMessage({
          type: MSG.RENDER_RES,
          maxDim: MATCH_OUTPUT,
          displayMaxDim: this._displayMaxDim,
        });
      } catch { /* ignore */ }
      // A mirror opened mid-set has to start at the level already on the fader,
      // not full brightness.
      this._broadcastMasterOpacity(getOutputOpacity());
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
   * Set the second viewer's DISPLAY size: the long edge, in device pixels, of the
   * surface it presents on. 0 (the default) uses the display's own resolution.
   * The render itself is always the output format, letterboxed into this surface,
   * so the viewer shows exactly the editor's framing and its sims stay 1:1 -
   * only the cost of presenting changes. Persists across reconnects (re-sent on
   * READY). No-op until a viewer is open.
   * @param {number} longEdge
   */
  setDisplayResolution(longEdge) {
    let v = Math.round(Number(longEdge));
    if (!Number.isFinite(v) || v <= 0) v = 0;
    else v = Math.max(MIN_DISPLAY_EDGE, Math.min(MAX_DISPLAY_EDGE, v));
    this._displayMaxDim = v;
    try {
      this._channel?.postMessage({
        type: MSG.RENDER_RES,
        maxDim: MATCH_OUTPUT,
        displayMaxDim: v,
      });
    } catch { /* ignore */ }
  }

  /** Current display long edge in device px; 0 = the display's own resolution. */
  get displayMaxDim() { return this._displayMaxDim; }

  /**
   * Create the native WebviewWindow on a detected second display (borderless,
   * fullscreen, always-on-top). Falls back to a centred, decorated window the
   * user can move when only one display is present.
   */
  async _createWindow() {
    const [{ WebviewWindow }, windowApi] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/window'),
    ]);

    const target = await this._resolveSecondMonitor(windowApi);
    const options = {
      url: this._receiverUrl(),
      title: 'Rhizomium — Output',
      decorations: !target,     // borderless on a real 2nd monitor
      alwaysOnTop: !!target,
      skipTaskbar: !!target,
      focus: true,
      visible: false,                  // reveal only after the receiver's first paint
      backgroundColor: [0, 0, 0, 255], // black RGBA; secondary defense against white flash
    };
    if (target) {
      // Monitor bounds are physical pixels; window options are logical pixels.
      const s = target.scaleFactor || 1;
      options.x = Math.round((target.position?.x || 0) / s);
      options.y = Math.round((target.position?.y || 0) / s);
      options.width = Math.max(1, Math.round((target.size?.width || 1920) / s));
      options.height = Math.max(1, Math.round((target.size?.height || 1080) / s));
    } else {
      options.width = 1280;
      options.height = 720;
      options.center = true;
    }

    // Reuse-proof: drop a window lingering under our label from a prior session.
    try {
      const existing = await WebviewWindow.getByLabel(this.windowLabel);
      if (existing) { try { await existing.close(); } catch { /* ignore */ } }
    } catch { /* getByLabel best-effort */ }

    const win = new WebviewWindow(this.windowLabel, options);
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      win.once('tauri://created', () => done(resolve));
      win.once('tauri://error', (ev) => done(reject, new Error(this._tauriErr(ev))));
      setTimeout(() => done(reject, new Error('window creation timed out')), 5000);
    });
    this._win = win;

    // The output window is a separate top-level window, so closing the editor
    // leaves it orphaned (and keeps the app alive). Close it with the editor.
    try {
      const mainWin = windowApi.getCurrentWindow?.();
      if (mainWin && typeof mainWin.onCloseRequested === 'function') {
        this._unlistenMainClose = await mainWin.onCloseRequested(() => {
          try { this._win?.close(); } catch { /* already gone */ }
        });
      }
    } catch { /* close-with-editor is best-effort */ }

    // True OS fullscreen on the target display. The borderless window already
    // fills the monitor, so a failure here is non-fatal.
    if (target) {
      try { await win.setFullscreen(true); } catch { /* borderless fill remains */ }
    }
    // Safety net: ensure the window is eventually shown even if the receiver's
    // first-paint reveal never fires (receiver error, or loaded outside Tauri).
    // show() is idempotent, so racing the receiver's own show() is harmless.
    setTimeout(() => { win.show().catch(() => {}); }, 1500);
    return win;
  }

  /**
   * Pick a display that is not the editor's current one.
   * @returns {Promise<object|null>} a Tauri Monitor, or null when single-display.
   */
  async _resolveSecondMonitor(windowApi) {
    try {
      const monitors = await windowApi.availableMonitors();
      if (!Array.isArray(monitors) || monitors.length === 0) return null;
      let current = null;
      try { current = await windowApi.currentMonitor(); } catch { /* ignore */ }
      const samePos = (a, b) =>
        a && b && a.position?.x === b.position?.x && a.position?.y === b.position?.y;
      return monitors.find((m) => !samePos(m, current)) || null;
    } catch (err) {
      console.warn('[TauriSecondMonitorViewer] monitor query failed:', err?.message || err);
      return null;
    }
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

  _tauriErr(ev) {
    const p = ev && typeof ev === 'object' ? ev.payload : ev;
    if (p == null) return 'window error';
    return typeof p === 'string' ? p : JSON.stringify(p);
  }

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
        if (typeof v === 'string' && (v.trim().startsWith('=') || /time|audioEnvelope/i.test(v))) {
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
