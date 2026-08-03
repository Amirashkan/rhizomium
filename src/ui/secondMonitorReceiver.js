// src/ui/secondMonitorReceiver.js
//
// Receiver for the Tauri second-monitor window (editor/second-monitor.html).
//
// Runs inside the borderless native window on the second display. There are two
// render paths, chosen by the editor per shader (see TauriSecondMonitorViewer):
//
//  • NATIVE (primary): this window runs its OWN WebGPU renderer. The editor
//    broadcasts the compiled WGSL (on change) and a per-frame snapshot of the
//    uniform bytes; we re-render the shader on the #second-monitor-gpu canvas
//    from our own rAF, at this display's native resolution and refresh rate. No
//    pixels cross the process boundary, so the editor keeps full framerate.
//
//    Compute graphs — including stateful/feedback sims and fragment-fed compute (a
//    compute node whose input is a GLSL/fragment node) — are reproduced here too:
//    this window runs its OWN ComputeExecutor (and FragmentTextureRenderer), rebuilt
//    from the broadcast graph. Feedback sims are STEP-LOCKED to the editor: each
//    COMPUTE_UNIFORMS message is one editor sim step, replayed here with that step's
//    exact uniform bytes (held when none arrived, caught up when several queued), and
//    seeded from the editor's current sim state (FEEDBACK_STATE) on connect — so the
//    two sims evolve identically instead of drifting on independent clocks.
//
//  • FALLBACK (pixels): for the few graphs the receiver can't reproduce from state
//    alone (a fragment storage buffer — only the un-mirrored 3D path uses these),
//    the editor broadcasts FRAME bitmaps and we paint them, letterboxed on black,
//    onto the 2D #second-monitor-output canvas — kept so nothing ever regresses.
//
// The paint is driven by this window's own rAF, capped to ~60fps on OUR OWN clock
// and rendering whatever editor state is latest — NOT once per inbound message
// (message-arrival gating made our vsync sample the editor's ~60/s broadcast and
// beat against it). Pacing is by elapsed-since-last-render with a jitter tolerance,
// not a carry accumulator: an accumulator targeting exactly the display rate slowly
// drifts and drops one frame every few seconds. With the tolerance, a panel at (or
// just above) the cap renders every frame; only genuinely high-refresh displays get
// throttled, which is what keeps compute from over-driving (re-running the full-res
// pipeline every refresh wasted the GPU and dragged both windows below framerate,
// worst for fragment+compute graphs). After a short silence (the editor window
// minimised/occluded so its rAF is throttled) we hold the last frame rather than
// spin re-rendering and re-stepping feedback sims.
//
// Keyboard: Esc closes the window; F (or double-click) toggles native
// fullscreen. Tauri APIs are loaded via guarded dynamic import so this module
// stays inert if ever opened outside the desktop app.

import { letterboxRect } from './letterbox.js';
import { isTauri } from '../utils/isTauri.js';
import { GPURenderer } from '../gpu/gpuRenderer.js';
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
  openSecondMonitorChannel,
} from './secondMonitorFrameChannel.js';

/** Default native-renderer factory: a window-local WebGPU device + GPURenderer. */
async function defaultCreateRenderer(canvas) {
  const gpu = (typeof navigator !== 'undefined') ? navigator.gpu : null;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (!device) return null;
    const renderer = new GPURenderer(device, canvas);
    renderer.externalUniformMode = true; // uniforms come from the editor's snapshots
    return renderer;
  } catch {
    return null;
  }
}

/**
 * Default compute-runtime factory: stand up the receiver's OWN ComputeExecutor +
 * TextureManager + synthetic graph globals on `win`, sharing the renderer's GPU
 * device. With these present, GPURenderer.render() drives compute and binds
 * compute/image textures with no change. Loaded lazily (dynamic import) so the
 * fragment-only path never pulls the compute system in.
 */
async function defaultCreateComputeRuntime(device, win) {
  const [{ ComputeExecutor }, { TextureManager }, exprMod] = await Promise.all([
    import('../gpu/ComputeExecutor.js'),
    import('../core/TextureManager.js'),
    import('../utils/UnifiedExpressionSystem.js'),
  ]);
  win.computeNodeRegistry = win.computeNodeRegistry || new Map();
  if (!win.graph) {
    win.graph = {
      nodes: [],
      getNode(id) { return this.nodes.find((n) => String(n.id) === String(id)) || null; },
    };
  }
  // Fragment-fed compute: the receiver rebuilds fragment subgraphs with its own
  // FragmentTextureRenderer (via ComputeExecutor), which runs the same buildWGSL the
  // editor does. Some codegen paths (gradient/expression params) read the singleton
  // off window — expose it so expression-valued fragment params compile here too.
  if (!win.unifiedExpressionSystem && exprMod && exprMod.unifiedExpressionSystem) {
    win.unifiedExpressionSystem = exprMod.unifiedExpressionSystem;
  }
  // Audio envelopes differ per window; injected compute uniforms already bake in
  // the editor's values, so these stay 0 and unused — but defined to avoid undefined.
  win._audioEnvelopeValue = win._audioEnvelopeBass = win._audioEnvelopeMids = 0;
  win._audioEnvelopeHighs = win._audioEnvelopeFull = 0;
  const textureManager = new TextureManager();
  await textureManager.initialize(device);
  const computeExecutor = new ComputeExecutor(device);
  win.textureManager = textureManager;
  win.computeExecutor = computeExecutor;
  return { computeExecutor, textureManager };
}

export function initSecondMonitorReceiver(doc = document, win = window, opts = {}) {
  const fbCanvas = doc.getElementById('second-monitor-output'); // 2D fallback
  const gpuCanvas = doc.getElementById('second-monitor-gpu');   // WebGPU native
  if (!fbCanvas && !gpuCanvas) return null;
  const fbCtx = fbCanvas && typeof fbCanvas.getContext === 'function'
    ? fbCanvas.getContext('2d') : null;
  const createRenderer = typeof opts.createRenderer === 'function'
    ? opts.createRenderer : defaultCreateRenderer;
  const createComputeRuntime = typeof opts.createComputeRuntime === 'function'
    ? opts.createComputeRuntime : defaultCreateComputeRuntime;

  let tier = TIER.FALLBACK;     // start safe: show pixels until told to go native
  let renderer = null;          // window-local GPURenderer (native path)
  let rendererPromise = null;   // in-flight creation
  let pendingWgsl = null;       // WGSL seen before the renderer existed
  let appliedWgsl = null;       // WGSL currently set on the renderer
  let snapshot = null;          // latest uniform snapshot { aspect, globals, params }
  let latest = null;            // most recent fallback ImageBitmap
  let latestW = 0, latestH = 0;
  let rafId = null;
  let closing = false;
  // Render pacing. We render the latest received state on our OWN clock, capped to
  // ~RENDER_FPS, NOT once per inbound message — see the frame loop. We pace on
  // elapsed-since-last-render (not a carry accumulator): an accumulator targeting
  // exactly the display rate slowly drifts and drops one frame every few seconds.
  const RENDER_STEP_MS = 1000 / 60;        // cap target (matches the editor's 60fps cap)
  const RENDER_STEP_TOL = RENDER_STEP_MS * 0.25; // jitter slack so a ~60Hz panel never skips
  const IDLE_HOLD_MS = 200;                // hold the last frame after this much silence
  let lastRenderTs = null;                 // rAF timestamp of the previous actual render
  let lastMessageTs = nowMs();             // wall clock of the last inbound editor message
  // Viewer compute-resolution mode. The viewer is INDEPENDENT of the editor's
  // floating preview: 0 = Auto (default — compute renders at THIS display's own
  // resolution) and a positive value fixes the long edge; in both, the broadcast
  // (preview-derived) sizes are ignored so nothing the user does to the floating
  // preview can reshape, rescale, or rebuild this window. MATCH_EDITOR (-1) is the
  // explicit opt-in that adopts the editor's dims for exact feedback-sim matching.
  const MATCH_EDITOR = -1;
  let computeMaxDim = 0;
  // Long edge (device px) of the surface we present on; 0 = this display's own
  // resolution. Independent of what we RENDER, which the editor pins to its
  // output format - the render is letterboxed into whatever this yields.
  let displayMaxDim = 0;
  const isMatchEditor = () => computeMaxDim === MATCH_EDITOR;
  let editorAspect = 0;                     // editor's aspect ratio (w/h); 0 = unknown → fill
  let computeAspect = 0;                    // compute output texture aspect (w/h); preferred in the
                                            // native-compute tier so the viewer letterboxes to the
                                            // compute texture's shape, not the editor's display box.
  let lastComputeGraphMsg = null;          // last COMPUTE_GRAPH (re-applied when the override changes)
  const computeDimsOverride = new Map();   // node id -> [w,h] actually used (for the packed-resolution override)
  let cachedWindow = null;

  // Native-compute runtime (Tier 2): the receiver's own ComputeExecutor + TextureManager.
  let computeRuntime = null;        // { computeExecutor, textureManager }
  let computeRuntimePromise = null;
  let pendingComputeGraph = null;   // COMPUTE_GRAPH seen before the runtime existed
  let pendingTextures = [];         // TEXTURE messages seen before the runtime existed
  let latestComputeUniforms = null; // re-applied once the executor finishes init
  let appliedComputeKey = null;     // dedupe costly graph rebuilds
  const prevPacked = new Map();     // node id -> last packed bytes (re-dispatch detection)
  const prevColorStops = new Map(); // node id -> last color-stop bytes (gradient re-dispatch)

  // Step-lock: ONE editor sim step per COMPUTE_UNIFORMS message. The editor emits it
  // once per rendered editor frame (its executor steps feedback sims once per render),
  // so replaying exactly one executor pass per message — with that message's exact
  // uniform bytes — keeps the receiver's feedback sims in lockstep with the editor
  // instead of free-running on this window's own clock (which over-advanced them on
  // fast displays and under-advanced them when the editor slowed down).
  const STEP_QUEUE_MAX = 4;         // pending steps kept while this display lags
  const STEP_CATCHUP_MAX = 3;       // steps replayed in a single rendered frame
  let stepQueue = [];               // queued COMPUTE_UNIFORMS messages (1 = 1 step)
  let stepJobBusy = false;          // an async catch-up replay is in flight
  let pendingFeedbackStates = [];   // FEEDBACK_STATE seen before the managers existed

  // Fragment-fed compute (Tier 2): the fragment subgraph feeding compute nodes, plus
  // the editor's per-frame evaluated u_params bytes. Reconstructed into the synthetic
  // graph so the executor's FragmentTextureRenderer can re-render it natively.
  let lastFragmentGraphMsg = null;  // last FRAGMENT_GRAPH (re-merged when the compute graph rebuilds)
  let pendingFragmentGraph = null;  // FRAGMENT_GRAPH seen before the runtime existed
  let fragmentNodeIds = new Set();  // ids currently merged into win.graph (for clean replacement)
  const prevFragmentParams = new Map(); // node id -> last injected u_params (re-render detection)

  const channel = openSecondMonitorChannel();

  // --- native renderer lifecycle ------------------------------------------
  function ensureRenderer() {
    if (renderer) return Promise.resolve(renderer);
    if (rendererPromise) return rendererPromise;
    if (!gpuCanvas) return Promise.resolve(null);
    sizeGpuCanvas(); // size before construction so the context configures correctly
    rendererPromise = Promise.resolve(createRenderer(gpuCanvas)).then((r) => {
      renderer = r || null;
      if (!renderer) {
        requestPixelFallback();
        return null;
      }
      // Injected uniforms must survive render(); never let it re-derive them
      // from window.* globals this window doesn't have.
      renderer.externalUniformMode = true;
      // No MSAA on the output window. We only draw a fullscreen triangle that samples
      // the (already-rendered) shader/compute result — there are no geometry edges to
      // antialias, so MSAA is pure cost: a 4x multisample target at the display's
      // native resolution is tens-to-hundreds of MB of GPU memory + bandwidth every
      // frame, which starved the shared GPU (the editor's framerate) and added memory
      // pressure. Must be set before the first shader builds the pipeline. (The editor
      // keeps its own MSAA; this only affects this mirror window's blit.)
      try { renderer.sampleCount = 1; } catch { /* ignore */ }
      // Count GPU-completed frames so the profiler can show real throughput
      // (onFramePresented fires on onSubmittedWorkDone, not at dispatch time).
      try { renderer.onFramePresented = () => profiler.presented(); } catch { /* ignore */ }
      if (pendingWgsl) { applyShader(pendingWgsl); pendingWgsl = null; }
      return renderer;
    }).catch(() => {
      renderer = null;
      requestPixelFallback();
      return null;
    });
    return rendererPromise;
  }

  function requestPixelFallback() {
    tier = TIER.FALLBACK;
    try { channel?.postMessage({ type: MSG.NEED_FALLBACK }); } catch { /* ignore */ }
  }

  function applyShader(wgsl) {
    if (!renderer || !wgsl || wgsl === appliedWgsl) return;
    try { renderer.setShaderSource(wgsl); appliedWgsl = wgsl; } catch { /* ignore */ }
  }

  // --- native compute runtime (Tier 2) ------------------------------------
  function ensureComputeRuntime() {
    if (computeRuntime) return Promise.resolve(computeRuntime);
    if (computeRuntimePromise) return computeRuntimePromise;
    computeRuntimePromise = ensureRenderer().then((r) => {
      const device = r && r.device;
      if (!device) return null;
      return Promise.resolve(createComputeRuntime(device, win)).then((rt) => {
        computeRuntime = rt || null;
        if (computeRuntime) {
          if (pendingComputeGraph) { const m = pendingComputeGraph; pendingComputeGraph = null; applyComputeGraph(m); }
          if (pendingFragmentGraph) { const m = pendingFragmentGraph; pendingFragmentGraph = null; applyFragmentGraph(m); }
          if (pendingTextures.length) { const t = pendingTextures; pendingTextures = []; t.forEach(applyTexture); }
        }
        return computeRuntime;
      });
    }).catch(() => null);
    return computeRuntimePromise;
  }

  /** Rebuild the receiver's compute registry + synthetic graph and (re)initialize the executor. */
  function applyComputeGraph(msg) {
    if (!computeRuntime) { pendingComputeGraph = msg; ensureComputeRuntime(); return; }
    const exec = computeRuntime.computeExecutor;
    if (!exec) return;
    lastComputeGraphMsg = msg; // remember so a compute-res change can re-apply it
    const nodes = msg.nodes || [];
    // Compute sizing. In Auto (0, default) and fixed modes the broadcast
    // (preview-derived) sizes are IGNORED: every node renders display-shaped at
    // this display's resolution (or the fixed long edge), so nothing the user does
    // to the editor's floating preview can rescale or rebuild this window. Only
    // "Match editor" (-1) adopts the editor's dims (exact feedback-sim matching).
    const MAX_COMPUTE_RES = 2048;
    let ourDims = null; // non-match modes: one display-shaped size for all nodes
    if (!isMatchEditor()) {
      const { bw, bh } = backingSize();
      const longEdge = Math.max(1, Math.min(MAX_COMPUTE_RES, computeMaxDim > 0 ? computeMaxDim : Math.max(bw, bh)));
      const scale = longEdge / Math.max(1, Math.max(bw, bh));
      ourDims = [
        Math.max(1, Math.min(MAX_COMPUTE_RES, Math.round(bw * scale))),
        Math.max(1, Math.min(MAX_COMPUTE_RES, Math.round(bh * scale))),
      ];
    }
    const dimsFor = (n) => (ourDims ? ourDims.slice() : [n.width || 0, n.height || 0]);
    // Dedup key includes `inputs` (rewiring, e.g. a node connected into
    // ComputeEdgeDetect, changes the graph even when ids/kinds don't) and the sizes
    // that actually apply: OUR display-derived dims outside match mode (so a preview
    // resize on the editor never rebuilds us, but a real display change does), the
    // broadcast dims only in match mode.
    const key = JSON.stringify([
      computeMaxDim,
      ourDims,
      nodes.map((n) => [n.id, n.kind, n.wgsl, ...(isMatchEditor() ? [n.width, n.height] : []), n.inputs || []]),
    ]);
    if (key === appliedComputeKey) return; // unchanged graph — skip the costly re-init
    if (!win.computeNodeRegistry) win.computeNodeRegistry = new Map();
    if (!win.graph) {
      win.graph = { nodes: [], getNode(id) { return this.nodes.find((n) => String(n.id) === String(id)) || null; } };
    }
    const registry = win.computeNodeRegistry;
    registry.clear();
    win.graph.nodes = [];
    computeDimsOverride.clear();
    for (const n of nodes) {
      const [w, h] = dimsFor(n);
      // Whenever our size differs from the editor's, the packed per-frame resolution
      // (floats 0,1) must be overridden so UV/texel math matches OUR texture.
      if ((n.width || 0) !== w || (n.height || 0) !== h) computeDimsOverride.set(n.id, [w, h]);
      const node = {
        id: n.id,
        kind: n.kind,
        inputs: Array.isArray(n.inputs) ? n.inputs.slice() : [],
        params: {},
        computeResolution: [w, h],
      };
      win.graph.nodes.push(node);
      registry.set(n.id, {
        node,
        getInput: () => null,
        resolution: [w, h],
        wgslCode: n.wgsl,
        supportsFeedback: !!n.supportsFeedback,
        lastInputHash: null,
      });
    }
    // Letterbox to the COMPUTE output texture's aspect, not the editor's display
    // box. Compute textures are sized from the render-resolution setting, which is
    // often a different aspect than the on-screen preview, and the output samples
    // that fixed-aspect texture — so framing the viewer to the editor's canvas
    // aspect stretched it. Use the largest-area node's dims (all compute nodes
    // share the render resolution by default).
    let bestArea = 0, nextAspect = 0;
    for (const n of nodes) {
      const [w, h] = dimsFor(n);
      if (w > 0 && h > 0 && w * h > bestArea) { bestArea = w * h; nextAspect = w / h; }
    }
    if (nextAspect > 0 && Math.abs(nextAspect - computeAspect) > 0.001) {
      computeAspect = nextAspect;
      sizeGpuCanvas();
    }
    // Re-append the fragment subgraph: rebuilding win.graph.nodes above dropped it,
    // but the executor's auto-bridge needs the fragment feeders present to render them.
    mergeFragmentNodesIntoGraph();
    appliedComputeKey = key;
    Promise.resolve(exec.initialize ? exec.initialize() : null).then(() => {
      // Every manager consumes our injected per-node bytes rather than re-packing.
      exec.computeManagers?.forEach?.((m) => { if (m) m.externalUniformMode = true; });
      if (Array.isArray(msg.executionOrder) && msg.executionOrder.length) {
        exec.executionOrder = msg.executionOrder.slice();
      }
      if (latestComputeUniforms) applyComputeUniforms(latestComputeUniforms);
      // Seed feedback sims whose state arrived before the managers existed.
      if (pendingFeedbackStates.length) {
        const states = pendingFeedbackStates;
        pendingFeedbackStates = [];
        states.forEach(applyFeedbackState);
      }
    }).catch(() => { appliedComputeKey = null; });
  }

  /**
   * Seed a feedback sim with the editor's current state (FEEDBACK_STATE). The
   * manager uploads it into its next-read ping-pong texture, so with the per-step
   * lockstep both sims evolve identically from here. Before the manager exists
   * (graph still initializing) the state is parked and re-applied after init.
   * A dimension mismatch (viewer-resolution override) is rejected by the manager
   * — the receiver keeps its own sim, which by design differs in scale anyway.
   */
  function applyFeedbackState(msg) {
    if (!msg || msg.nodeId == null) return;
    const exec = computeRuntime && computeRuntime.computeExecutor;
    const managers = exec && exec.computeManagers;
    const mgr = (managers && typeof managers.get === 'function')
      ? (managers.get(msg.nodeId) || managers.get(String(msg.nodeId)))
      : null;
    if (!mgr || typeof mgr.writeFeedbackState !== 'function') {
      // Bounded parking: the editor re-sends the full state on every (re)connect
      // and graph change, so dropping the oldest entries is safe.
      pendingFeedbackStates.push(msg);
      if (pendingFeedbackStates.length > 16) pendingFeedbackStates.shift();
      ensureComputeRuntime();
      return;
    }
    try {
      if (mgr.writeFeedbackState(msg.data, msg.width, msg.height) && typeof msg.step === 'number') {
        // The seed already contains every step up to msg.step — replaying those
        // queued steps on top would advance the sim past the editor. Drop them.
        stepQueue = stepQueue.filter((s) => !(typeof s.step === 'number' && s.step <= msg.step));
      }
    } catch { /* keep own state */ }
  }

  function applyComputeUniforms(msg) {
    latestComputeUniforms = msg;
    const exec = computeRuntime && computeRuntime.computeExecutor;
    const managers = exec && exec.computeManagers;
    if (!managers || typeof managers.get !== 'function') return;
    for (const n of (msg.nodes || [])) {
      const mgr = managers.get(n.id);
      if (!mgr || typeof mgr.writeRawComputeUniforms !== 'function') continue;
      // When the compute resolution is overridden, the texture is a different size
      // than the editor's, so the resolution baked into the packed uniform (floats
      // 0,1) must be replaced with ours — otherwise the shader's UV/texel math is
      // wrong (stretched output, mis-scaled kernels).
      const ov = computeDimsOverride.get(n.id);
      if (ov && n.packed && n.packed.length >= 2) { n.packed[0] = ov[0]; n.packed[1] = ov[1]; }
      try { mgr.writeRawComputeUniforms(n.packed, n.colorStops || null); } catch { /* ignore */ }
      // Static-input stateless nodes are skipped by the executor's change detection;
      // when the injected uniforms OR color stops change, invalidate the hash so it
      // re-dispatches. (Color stops live in a separate buffer, not in `packed`.)
      if (_computeChanged(n.id, n.packed, n.colorStops)) {
        try { exec.inputHashes?.delete?.(n.id); } catch { /* ignore */ }
        // Cascade: nodes downstream of this one must also re-dispatch so an
        // upstream parameter change propagates through the chain in real time
        // (without it, only the changed node re-runs and consumers show stale input).
        _invalidateDownstream(exec, n.id);
      }
    }
  }

  function _packedChanged(id, packed) {
    const prev = prevPacked.get(id);
    let changed = true;
    if (prev && packed && prev.length === packed.length) {
      changed = false;
      for (let i = 0; i < packed.length; i++) {
        // Index 2 is `time`, which ticks every frame (see computeUniformLayout.js).
        // Skipping it stops static nodes (e.g. a large-radius Blur) from being
        // re-dispatched 60x/s on this GPU when nothing actually changed. Genuinely
        // time-dependent kinds (Noise, feedback) still re-dispatch via the
        // executor's own TIME_DEPENDENT_NODES path, independent of this check.
        if (i === 2) continue;
        if (prev[i] !== packed[i]) { changed = true; break; }
      }
    }
    if (packed) prevPacked.set(id, packed.slice ? packed.slice() : packed);
    return changed;
  }

  function _colorStopsChanged(id, cs) {
    const prev = prevColorStops.get(id);
    let changed = true;
    if (!cs && !prev) changed = false;
    else if (cs && prev && cs.length === prev.length) {
      changed = false;
      for (let i = 0; i < cs.length; i++) { if (cs[i] !== prev[i]) { changed = true; break; } }
    }
    if (cs) prevColorStops.set(id, cs.slice ? cs.slice() : cs);
    return changed;
  }

  // True when a node's injected uniforms (ignoring time) or its color stops changed.
  function _computeChanged(id, packed, colorStops) {
    const p = _packedChanged(id, packed);
    const c = _colorStopsChanged(id, colorStops);
    return p || c;
  }

  // Invalidate the dispatch cache of every node transitively downstream of
  // `changedId`, so an upstream change re-runs the whole dependent chain.
  function _invalidateDownstream(exec, changedId) {
    const nodes = win.graph && win.graph.nodes;
    if (!exec || !exec.inputHashes || !Array.isArray(nodes)) return;
    const queue = [changedId];
    const seen = new Set([changedId]);
    while (queue.length) {
      const id = queue.shift();
      for (const node of nodes) {
        if (node && Array.isArray(node.inputs) && node.inputs.includes(id) && !seen.has(node.id)) {
          seen.add(node.id);
          try { exec.inputHashes.delete(node.id); } catch { /* ignore */ }
          queue.push(node.id);
        }
      }
    }
  }

  // --- fragment-fed compute (Tier 2) --------------------------------------
  /**
   * Merge the broadcast fragment subgraph into the synthetic win.graph alongside the
   * compute nodes, replacing any previously-merged fragment nodes. These carry full
   * `params` (unlike compute nodes, whose params are empty) so the executor's
   * FragmentTextureRenderer compiles the same WGSL the editor did. Compute ids are
   * never shadowed — the compute graph owns those.
   */
  function mergeFragmentNodesIntoGraph() {
    if (!win.graph) {
      win.graph = { nodes: [], getNode(id) { return this.nodes.find((n) => String(n.id) === String(id)) || null; } };
    }
    if (fragmentNodeIds.size) {
      win.graph.nodes = win.graph.nodes.filter((n) => !fragmentNodeIds.has(n.id));
    }
    fragmentNodeIds = new Set();
    const msg = lastFragmentGraphMsg;
    if (!msg || !Array.isArray(msg.nodes)) return;
    const registry = win.computeNodeRegistry;
    for (const n of msg.nodes) {
      if (registry && (registry.has(n.id) || registry.has(String(n.id)))) continue; // compute owns this id
      win.graph.nodes.push({
        id: n.id,
        kind: n.kind,
        params: n.params || {},
        inputs: Array.isArray(n.inputs) ? n.inputs.slice() : [],
      });
      fragmentNodeIds.add(n.id);
    }
  }

  /**
   * Rebuild the fragment subgraph in the synthetic graph. The compute runtime owns the
   * FragmentTextureRenderer (created by ComputeExecutor); clear its cache so it
   * recompiles against the new structure/expression params.
   */
  function applyFragmentGraph(msg) {
    lastFragmentGraphMsg = msg;
    if (!computeRuntime) { pendingFragmentGraph = msg; ensureComputeRuntime(); return; }
    mergeFragmentNodesIntoGraph();
    const fr = computeRuntime.computeExecutor && computeRuntime.computeExecutor.fragmentRenderer;
    try { fr?.clearCache?.(); } catch { /* ignore */ }
    prevFragmentParams.clear(); // force a re-render with the next injected uniforms
  }

  /**
   * Inject the editor's per-frame evaluated fragment u_params bytes so the receiver's
   * FragmentTextureRenderer writes them verbatim (same field order as its own
   * buildWGSL) instead of re-deriving from this window's clock/audio. When a node's
   * bytes change, drop its parameter hash so the renderer re-renders it (a static
   * fragment node would otherwise be skipped by its own change detection). Downstream
   * compute re-dispatch is already handled by the executor's auto-bridge.
   */
  function applyFragmentUniforms(msg) {
    const exec = computeRuntime && computeRuntime.computeExecutor;
    const fr = exec && exec.fragmentRenderer;
    if (!fr) return;
    fr.externalUniformMode = true;
    if (!fr.externalUniforms) fr.externalUniforms = new Map();
    for (const n of (msg.nodes || [])) {
      fr.externalUniforms.set(n.id, n.params);
      if (_fragmentParamsChanged(n.id, n.params)) {
        try { fr.parameterHashes?.delete?.(n.id); } catch { /* ignore */ }
      }
    }
  }

  // True when a fragment node's injected u_params changed since last frame. Unlike the
  // compute packed bytes there is no time slot to ignore — these are static params only.
  function _fragmentParamsChanged(id, params) {
    const prev = prevFragmentParams.get(id);
    let changed = true;
    if (prev && params && prev.length === params.length) {
      changed = false;
      for (let i = 0; i < params.length; i++) { if (prev[i] !== params[i]) { changed = true; break; } }
    }
    if (params) prevFragmentParams.set(id, params.slice ? params.slice() : params);
    return changed;
  }

  function applyTexture(msg) {
    if (!msg || !msg.bitmap) return;
    if (!computeRuntime) { pendingTextures.push(msg); ensureComputeRuntime(); return; }
    const tm = computeRuntime.textureManager;
    if (tm && typeof tm.injectExternalTexture === 'function') {
      try { tm.injectExternalTexture(msg.nodeId, msg.bitmap); } catch { /* ignore */ }
    }
  }

  function clearComputeRuntime() {
    try { win.computeExecutor?.clear?.(); } catch { /* ignore */ }
    appliedComputeKey = null;
    latestComputeUniforms = null;
    stepQueue = [];
    pendingFeedbackStates = [];
    prevPacked.clear();
    prevColorStops.clear();
    lastFragmentGraphMsg = null;
    pendingFragmentGraph = null;
    fragmentNodeIds = new Set();
    prevFragmentParams.clear();
    // Drop the compute aspect so the plain native tier reframes to the editor's
    // display aspect; reflow now since no further COMPUTE_GRAPH will arrive.
    computeAspect = 0;
    sizeGpuCanvas();
  }

  /** Apply a tier change from the editor: ensure runtimes and tear down compute when leaving. */
  function setTier(next) {
    if (!next || next === tier) return;
    const leavingCompute = (tier === TIER.NATIVE_COMPUTE) && (next !== TIER.NATIVE_COMPUTE);
    tier = next;
    if (next === TIER.NATIVE || next === TIER.NATIVE_COMPUTE) ensureRenderer();
    if (next === TIER.NATIVE_COMPUTE) ensureComputeRuntime();
    if (leavingCompute) clearComputeRuntime();
  }

  /**
   * Apply the editor's master fader (× any running scene transition) to this
   * window's output. We render our own frames, so the editor's canvas opacity
   * never reaches us - the level arrives over the channel instead. The page
   * behind is black, so this fades to black exactly as the editor's does, and
   * it covers both the native and fallback surfaces at once.
   */
  function applyMasterOpacity(value) {
    const n = Number(value);
    const level = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
    [gpuCanvas, fbCanvas].forEach(canvas => {
      if (canvas && canvas.style) canvas.style.opacity = String(level);
    });
  }

  // --- channel handling ----------------------------------------------------
  function onMessage(e) {
    const d = e?.data;
    if (!d) return;
    switch (d.type) {
      case MSG.SHADER:
        if (tier === TIER.FALLBACK) tier = TIER.NATIVE; // promote; CAPS refines the tier
        if (renderer) applyShader(d.wgsl);
        else { pendingWgsl = d.wgsl; ensureRenderer(); }
        break;
      case MSG.UNIFORMS: {
        snapshot = { aspect: d.aspect || null, globals: d.globals || null, params: d.params || null };
        // Track the EDITOR's aspect ratio (resolution x/y) so we can letterbox the
        // output to match the editor's framing instead of stretching to the display.
        const eg = d.globals;
        const asp = (eg && eg.length >= 2 && eg[0] > 0 && eg[1] > 0) ? eg[0] / eg[1] : 0;
        if (asp > 0 && Math.abs(asp - editorAspect) > 0.001) {
          editorAspect = asp;
          sizeGpuCanvas();
        }
        break;
      }
      case MSG.CAPS:
        setTier(d.tier);
        break;
      case MSG.COMPUTE_GRAPH:
        setTier(TIER.NATIVE_COMPUTE);
        applyComputeGraph(d);
        break;
      case MSG.COMPUTE_UNIFORMS:
        // One message = one editor sim step. Queue it; the render loop applies each
        // step's exact uniform bytes and runs exactly one executor pass per step
        // (step-lock). Bounded: if this display can't keep up, drop the OLDEST steps
        // — the sims fall a few steps behind rather than the queue growing forever.
        latestComputeUniforms = d;
        stepQueue.push(d);
        if (stepQueue.length > STEP_QUEUE_MAX) stepQueue.splice(0, stepQueue.length - STEP_QUEUE_MAX);
        break;
      case MSG.FEEDBACK_STATE:
        applyFeedbackState(d);
        break;
      case MSG.FRAGMENT_GRAPH:
        setTier(TIER.NATIVE_COMPUTE);
        applyFragmentGraph(d);
        break;
      case MSG.FRAGMENT_UNIFORMS:
        applyFragmentUniforms(d);
        break;
      case MSG.TEXTURE:
        applyTexture(d);
        break;
      case MSG.FRAME:
        if (d.bitmap) setLatest(d.bitmap, d.sw, d.sh);
        break;
      case MSG.MASTER_OPACITY:
        applyMasterOpacity(d.opacity);
        break;
      case MSG.RENDER_RES:
        setComputeMaxDim(d.maxDim);
        setDisplayMaxDim(d.displayMaxDim);
        break;
      case MSG.FEEDBACK_RESET:
        // A Feedback node was reset in the editor (panel button / Reset pin). Our
        // sim is an independent replica, so clear it too. Before the runtime
        // exists there is nothing accumulated yet — safe to ignore.
        try { computeRuntime?.computeExecutor?.resetNodeFeedback?.(d.nodeId); } catch { /* ignore */ }
        break;
      case MSG.CLOSE:
        closeSelf();
        break;
      default:
        break;
    }
    // Track liveness only: while editor state keeps arriving we render at a steady
    // cap (below); after IDLE_HOLD_MS of silence (editor minimised/occluded so its
    // rAF is throttled) we hold the last frame instead of spinning. We deliberately
    // do NOT render once-per-message: that made our vsync sample the editor's ~60/s
    // broadcast, and the two near-60Hz clocks beat in/out of phase — a periodic
    // skipped/doubled frame seen as a hitch on the fullscreen output.
    lastMessageTs = nowMs();
    profiler.message();
  }
  if (channel) channel.addEventListener('message', onMessage);

  function setLatest(bitmap, w, h) {
    if (latest && latest !== bitmap) { try { latest.close(); } catch { /* ignore */ } }
    latest = bitmap;
    latestW = w || (bitmap && bitmap.width) || 0;
    latestH = h || (bitmap && bitmap.height) || 0;
  }

  // --- sizing --------------------------------------------------------------
  // Scale factor that brings a device-pixel box down to the configured display
  // long edge. 1 when the display size is Auto or the box already fits, so the
  // surface is only ever capped, never upscaled.
  function displayScaleFor(bw, bh) {
    if (!(displayMaxDim > 0)) return 1;
    const longEdge = Math.max(bw, bh);
    return longEdge > displayMaxDim ? displayMaxDim / longEdge : 1;
  }

  function backingSize() {
    const dpr = win.devicePixelRatio || 1;
    const cssW = win.innerWidth || 1280;
    const cssH = win.innerHeight || 720;
    const fullW = Math.max(1, Math.round(cssW * dpr));
    const fullH = Math.max(1, Math.round(cssH * dpr));
    const scale = displayScaleFor(fullW, fullH);
    return {
      dpr, cssW, cssH,
      bw: Math.max(1, Math.round(fullW * scale)),
      bh: Math.max(1, Math.round(fullH * scale)),
    };
  }

  // Letterboxing applies in match mode - which is what the editor always asks for
  // now, so the viewer frames the composition exactly like the editor's preview
  // does. The EDITOR'S aspect is the authority: it is the output format's shape,
  // the same number the preview fits its panel to. The compute texture's own
  // aspect is only a fallback for before the first UNIFORMS message arrives; it
  // used to be preferred, from when a capped texture could be reshaped relative
  // to the composition (a 2560x1080 output became a 2048x1080 texture) and the
  // sampled output would stretch. Compute textures are now capped along their
  // long edge, preserving shape, so the two agree and the editor's is the one to
  // trust. In the legacy display-shaped modes there is nothing to letterbox to.
  function effectiveAspect() {
    if (!isMatchEditor()) return 0; // fill the display
    if (editorAspect > 0) return editorAspect;
    if (tier === TIER.NATIVE_COMPUTE && computeAspect > 0) return computeAspect;
    return 0;
  }

  function sizeGpuCanvas() {
    if (!gpuCanvas) return;
    const { dpr, cssW, cssH } = backingSize();
    // Fill the display by default. Only the explicit "Match editor" mode letterboxes
    // (effectiveAspect() > 0) to the editor's framing — the black bars come from the
    // body background. renderNative derives the shader resolution/aspect from this
    // canvas, so in the default modes the composition is framed to THIS display and
    // the editor's floating preview can never reshape it.
    let elW = cssW, elH = cssH, left = 0, top = 0;
    const a = effectiveAspect();
    if (a > 0) {
      const rect = letterboxRect(a, 1, cssW, cssH);
      if (rect.dw > 0 && rect.dh > 0) { elW = rect.dw; elH = rect.dh; left = rect.dx; top = rect.dy; }
    }
    // The element keeps its letterboxed CSS box (so the output still fills the
    // display's usable area); only the pixels behind it are capped.
    const fullW = Math.max(1, Math.round(elW * dpr));
    const fullH = Math.max(1, Math.round(elH * dpr));
    const scale = displayScaleFor(fullW, fullH);
    const bw = Math.max(1, Math.round(fullW * scale));
    const bh = Math.max(1, Math.round(fullH * scale));
    if (gpuCanvas.width !== bw) gpuCanvas.width = bw;
    if (gpuCanvas.height !== bh) gpuCanvas.height = bh;
    gpuCanvas.style.width = elW + 'px';
    gpuCanvas.style.height = elH + 'px';
    gpuCanvas.style.left = left + 'px';
    gpuCanvas.style.top = top + 'px';
    gpuCanvas.style.right = 'auto';
    gpuCanvas.style.bottom = 'auto';
    // Keep the renderer's cached size in step so it rebuilds MSAA on next render.
    if (renderer && renderer._cachedCanvasSize) {
      renderer._cachedCanvasSize.width = bw;
      renderer._cachedCanvasSize.height = bh;
      renderer._cachedCanvasSize.clientWidth = bw;
      renderer._cachedCanvasSize.clientHeight = bh;
    }
  }

  function sizeFallbackCanvas() {
    if (!fbCanvas) return;
    const { cssW, cssH, bw, bh } = backingSize();
    if (fbCanvas.width !== bw) fbCanvas.width = bw;
    if (fbCanvas.height !== bh) fbCanvas.height = bh;
    fbCanvas.style.width = cssW + 'px';
    fbCanvas.style.height = cssH + 'px';
  }

  function reportSize() {
    try {
      channel?.postMessage({
        type: MSG.RESIZE,
        width: (gpuCanvas || fbCanvas)?.width || 0,
        height: (gpuCanvas || fbCanvas)?.height || 0,
        dpr: win.devicePixelRatio || 1,
      });
    } catch { /* ignore */ }
  }

  // --- viewer compute resolution -------------------------------------------
  // Long-edge presets (px) for the [ / ] hotkeys. 0 = Auto (this display's own
  // resolution). "Match editor" (-1) is reachable only from the editor's dropdown.
  const COMPUTE_RES_PRESETS = [0, 720, 1080, 1440, 2048];

  /**
   * Set the viewer's compute-resolution mode: 0 = Auto (this display's own
   * resolution, the default), a positive long edge in px, or -1 = "Match editor"
   * (adopt the editor's preview-derived dims for exact sim matching). Rebuilds the
   * compute graph at the new size.
   */
  /**
   * Presentation surface long edge in device px (0 = this display's own
   * resolution). Only affects how many pixels we present with - never what we
   * render, which stays the editor's output format.
   */
  function setDisplayMaxDim(next) {
    let v = Math.round(Number(next));
    if (!Number.isFinite(v) || v <= 0) v = 0;
    if (v === displayMaxDim) return;
    displayMaxDim = v;
    sizeGpuCanvas();
    // Compute textures are display-derived outside match mode, so a changed
    // surface size has to re-key the graph there too.
    if (!isMatchEditor() && lastComputeGraphMsg) {
      appliedComputeKey = null;
      applyComputeGraph(lastComputeGraphMsg);
    }
  }

  function setComputeMaxDim(next) {
    let v = Math.round(Number(next));
    if (!Number.isFinite(v)) v = 0;
    v = v <= MATCH_EDITOR ? MATCH_EDITOR : Math.max(0, Math.min(2048, v));
    if (v === computeMaxDim) return;
    computeMaxDim = v;
    if (lastComputeGraphMsg) {
      appliedComputeKey = null;          // force a rebuild at the new resolution
      applyComputeGraph(lastComputeGraphMsg);
    }
    // Switching between "match editor" (letterboxed to the editor's framing) and the
    // display-filling modes changes the canvas shape — re-size now so the viewer
    // stops/starts following the editor immediately, not on the next resize.
    sizeGpuCanvas();
    reportSize();
  }

  /** Step to the adjacent preset (dir +1 = higher res, -1 = lower). */
  function stepComputeRes(dir) {
    const p = COMPUTE_RES_PRESETS;
    let i = 0, best = Infinity;
    for (let k = 0; k < p.length; k++) {
      const d = Math.abs(p[k] - computeMaxDim);
      if (d < best) { best = d; i = k; }
    }
    i = Math.max(0, Math.min(p.length - 1, i + dir));
    setComputeMaxDim(p[i]);
  }

  function onResize() {
    sizeFallbackCanvas();
    sizeGpuCanvas();
    reportSize();
    // Auto mode sizes compute to THIS display — a real window/display size change
    // must rebuild at the new size. The dedup key includes our derived dims, so a
    // no-op resize (same backing size) is skipped inside applyComputeGraph.
    if (!isMatchEditor() && lastComputeGraphMsg && computeRuntime) {
      applyComputeGraph(lastComputeGraphMsg);
    }
    lastMessageTs = nowMs(); // count a resize as activity so we repaint at the new size
  }
  sizeFallbackCanvas();
  sizeGpuCanvas();
  win.addEventListener('resize', onResize);

  // --- render loop ---------------------------------------------------------
  function showCanvas(which) {
    if (gpuCanvas) gpuCanvas.style.display = which === 'gpu' ? 'block' : 'none';
    if (fbCanvas) fbCanvas.style.display = which === '2d' ? 'block' : 'none';
  }

  function renderNative() {
    const r = renderer;
    if (!r || !r.pipeline || !snapshot) return false;
    if (stepJobBusy) return true; // a catch-up replay from a previous frame is still in flight
    const g = snapshot.globals;
    const a = snapshot.aspect;
    const w = gpuCanvas.width;
    const h = gpuCanvas.height;
    // The snapshot carries the EDITOR's resolution; override with ours so the
    // shader resolves correctly at this display's native size.
    if (g && g.length >= 2) { g[0] = w; g[1] = h; }
    if (a && a.length >= 1) { a[0] = w / Math.max(1, h); }
    const timeSec = (g && g.length >= 3)
      ? g[2]
      : (win.performance ? win.performance.now() * 0.001 : 0);
    // Fragment-fed compute: the executor's FragmentTextureRenderer re-evaluates
    // expression params (=audioEnvelope, =time) at runtime against the globals it
    // builds from these window values. Mirror the editor's broadcast audio (globals
    // floats 3..7) so those expressions match; time already rides timeSec above.
    if (g && g.length >= 8) {
      win._audioEnvelopeValue = g[3];
      win._audioEnvelopeBass = g[4];
      win._audioEnvelopeMids = g[5];
      win._audioEnvelopeHighs = g[6];
      win._audioEnvelopeFull = g[7];
    }

    // Step-lock (native-compute): run the executor once per queued editor step, with
    // that step's exact uniform bytes — never on this window's own cadence.
    const exec = (tier === TIER.NATIVE_COMPUTE) ? (computeRuntime && computeRuntime.computeExecutor) : null;
    if (exec) {
      if (stepQueue.length === 0) {
        // No editor step since the last render (this display outpaced the editor):
        // hold the sims at their current state; the blit re-presents the last result.
        exec.holdDispatch = true;
      } else if (stepQueue.length === 1) {
        exec.holdDispatch = false;
        applyComputeUniforms(stepQueue.shift());
      } else {
        // Backlog (rAF jitter or a slow display): replay each missed step with its
        // own uniforms so the sims advance exactly as the editor's did, then render
        // the final one. Async because executor passes await pipeline work; guarded
        // by stepJobBusy so frames can't interleave.
        const steps = stepQueue.splice(0, STEP_CATCHUP_MAX);
        const last = steps.pop();
        const audio = (g && g.length >= 8)
          ? { audioEnvelope: g[3], audioEnvelopeBass: g[4], audioEnvelopeMids: g[5], audioEnvelopeHighs: g[6], audioEnvelopeFull: g[7] }
          : {};
        stepJobBusy = true;
        (async () => {
          try {
            exec.holdDispatch = false;
            for (const s of steps) {
              const device = r.device;
              if (!device || typeof device.createCommandEncoder !== 'function') break;
              applyComputeUniforms(s);
              const encoder = device.createCommandEncoder({ label: 'step-lock-catchup' });
              await exec.execute(encoder, timeSec, audio);
              device.queue.submit([encoder.finish()]);
            }
            applyComputeUniforms(last);
            r.writeRawUniforms(snapshot);
            r.render({ timeSec });
          } catch {
            /* skip this frame — the next tick renders */
          } finally {
            stepJobBusy = false;
          }
        })();
        return true;
      }
    }

    try {
      r.writeRawUniforms(snapshot);
      r.render({ timeSec });
      return true;
    } catch {
      return false;
    }
  }

  function paintFallback() {
    if (!fbCtx || !fbCanvas) return;
    const cw = fbCanvas.width;
    const ch = fbCanvas.height;
    fbCtx.fillStyle = '#000';
    fbCtx.fillRect(0, 0, cw, ch);
    if (latest) {
      const { dx, dy, dw, dh } = letterboxRect(latestW, latestH, cw, ch);
      if (dw > 0 && dh > 0) {
        try { fbCtx.drawImage(latest, dx, dy, dw, dh); } catch { /* skip frame */ }
      }
    }
  }

  function nowMs() {
    return (win.performance && typeof win.performance.now === 'function')
      ? win.performance.now() : Date.now();
  }

  /**
   * Lightweight self-profiler for this output window (toggle with P). It measures
   * exactly the signals that distinguish the possible causes of a visible hitch:
   *   • rAF gap max + stall count  → a present/GC stall (the frame never reached the
   *                                  display on time — invisible to the editor's
   *                                  compute profiler, which only times compute).
   *   • render (sync dispatch) ms  → CPU-side render/compute-encode cost.
   *   • GPU-presented fps          → real throughput (onFramePresented), vs rendered.
   *   • throttle / idle skips      → our own fps cap or idle-hold kicking in.
   *   • editor message gap         → the editor starving us of state.
   * Off by default; accumulates only while on, so it can't perturb the normal path.
   */
  function makeReceiverProfiler() {
    const el = doc.getElementById('second-monitor-profiler');
    const WIN_MS = 500;
    const STALL_MS = RENDER_STEP_MS * 1.5; // an rAF gap this long = a dropped frame
    let on = false;
    let winStart = 0, lastRaf = 0, lastMsg = 0, renderT0 = 0;
    let rafCount = 0, rendered = 0, presented = 0, throttle = 0, idle = 0, stalls = 0, msgs = 0;
    let gapMax = 0, drawSum = 0, drawMax = 0, msgGapMax = 0;
    let lastStats = null;

    function resetWindow(t) {
      winStart = t; rafCount = 0; rendered = 0; presented = 0; throttle = 0; idle = 0;
      stalls = 0; msgs = 0; gapMax = 0; drawSum = 0; drawMax = 0; msgGapMax = 0;
    }

    function flush(t) {
      const sec = Math.max(1e-3, (t - winStart) / 1000);
      lastStats = {
        tier,
        renderFps: Math.round(rendered / sec),
        rafFps: Math.round(rafCount / sec),
        gpuFps: Math.round(presented / sec),
        gapMaxMs: +gapMax.toFixed(1),
        stalls,
        drawAvgMs: +(rendered ? drawSum / rendered : 0).toFixed(2),
        drawMaxMs: +drawMax.toFixed(2),
        throttle, idle,
        msgsPerSec: Math.round(msgs / sec),
        msgGapMaxMs: +msgGapMax.toFixed(1),
      };
      if (el) {
        const s = lastStats;
        el.textContent =
          `2nd-monitor · ${s.tier}\n` +
          `render ${s.renderFps} fps  (rAF ${s.rafFps} · gpu ${s.gpuFps})\n` +
          `frame  gap max ${s.gapMaxMs}ms · stalls ${s.stalls}\n` +
          `draw   ${s.drawAvgMs}ms avg · ${s.drawMaxMs}ms max\n` +
          `skip   throttle ${s.throttle} · idle ${s.idle}\n` +
          `editor ${s.msgsPerSec} msg/s · gap max ${s.msgGapMaxMs}ms`;
      }
      resetWindow(t);
    }

    return {
      get on() { return on; },
      snapshot() { return lastStats; },
      toggle() {
        on = !on;
        if (el) el.style.display = on ? 'block' : 'none';
        if (on) { resetWindow(nowMs()); lastRaf = 0; lastMsg = 0; }
      },
      raf(now) {
        if (!on) return;
        if (lastRaf) {
          const gap = now - lastRaf;
          if (gap > gapMax) gapMax = gap;
          if (gap > STALL_MS) stalls++;
        }
        lastRaf = now;
        rafCount++;
        if (now - winStart >= WIN_MS) flush(now);
      },
      skip(kind) { if (on) { if (kind === 'throttle') throttle++; else idle++; } },
      renderStart() { if (on) renderT0 = nowMs(); },
      renderEnd() {
        if (!on) return;
        const ms = nowMs() - renderT0;
        drawSum += ms; if (ms > drawMax) drawMax = ms; rendered++;
      },
      presented() { if (on) presented++; },
      message() {
        if (!on) return;
        const t = nowMs();
        if (lastMsg) { const g = t - lastMsg; if (g > msgGapMax) msgGapMax = g; }
        lastMsg = t; msgs++;
      },
    };
  }

  const profiler = makeReceiverProfiler();

  function frame(ts) {
    rafId = win.requestAnimationFrame(frame);
    const now = (typeof ts === 'number') ? ts : nowMs();
    profiler.raf(now);

    // Idle hold: when the editor stops broadcasting (its window minimised/occluded
    // so its rAF is throttled, or it's closing), hold the last frame rather than
    // re-rendering it — and re-stepping feedback sims — on our own clock.
    if (now - lastMessageTs > IDLE_HOLD_MS) { profiler.skip('idle'); return; }

    // Cap to ~RENDER_FPS on OUR OWN clock, rendering whatever state is latest (we do
    // NOT render once-per-message: that made our vsync sample the editor's ~60/s
    // broadcast and beat against it). Pace on elapsed-since-last-render, with a
    // tolerance: a panel running at — or a hair above — the cap rate then renders
    // EVERY frame instead of dropping one every few seconds (the drift a carry
    // accumulator caused). Only genuinely high-refresh displays get throttled, which
    // is what keeps compute from over-driving.
    if (lastRenderTs != null && now - lastRenderTs < RENDER_STEP_MS - RENDER_STEP_TOL) {
      profiler.skip('throttle');
      return;
    }
    lastRenderTs = now;

    profiler.renderStart();
    if ((tier === TIER.NATIVE || tier === TIER.NATIVE_COMPUTE) && renderNative()) {
      showCanvas('gpu');
      profiler.renderEnd();
      return;
    }
    showCanvas('2d');
    paintFallback();
    profiler.renderEnd();
  }
  showCanvas('2d');
  paintFallback();   // fill black immediately, before first rAF frame

  // Reveal the (hidden) native window only once a black frame is committed to the
  // surface, so the second display never shows a white pre-paint frame. Double rAF
  // ensures the browser has actually painted before the OS reveals the window.
  // Scheduled before the frame loop so the loop remains the last-pending rAF.
  win.requestAnimationFrame(() => win.requestAnimationFrame(async () => {
    const w = await tauriWindow();
    if (w) {
      try { await w.show(); } catch { /* ignore */ }
      try { await w.setFocus(); } catch { /* ignore */ }
    }
  }));

  rafId = win.requestAnimationFrame(frame);

  // --- input / lifecycle ---------------------------------------------------
  win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSelf();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'p' || e.key === 'P') profiler.toggle();
    else if (e.key === ']') stepComputeRes(1);    // higher compute resolution (sharper)
    else if (e.key === '[') stepComputeRes(-1);   // lower compute resolution (faster)
  });
  win.addEventListener('dblclick', () => toggleFullscreen());
  win.addEventListener('beforeunload', () => {
    try { channel?.postMessage({ type: MSG.CLOSED }); } catch { /* ignore */ }
  });

  async function tauriWindow() {
    if (!isTauri()) return null;
    if (cachedWindow) return cachedWindow;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      cachedWindow = getCurrentWindow();
    } catch {
      cachedWindow = null;
    }
    return cachedWindow;
  }

  async function toggleFullscreen() {
    const w = await tauriWindow();
    if (!w) return;
    let cur = false;
    try { cur = await w.isFullscreen(); } catch { /* assume windowed */ }
    const next = !cur;
    try { await w.setFullscreen(next); } catch { /* ignore */ }
    try { await w.setDecorations(!next); } catch { /* ignore */ }
  }

  async function closeSelf() {
    if (closing) return;
    closing = true;
    clearComputeRuntime();
    try { win.textureManager?.destroy?.(); } catch { /* ignore */ }
    try { channel?.postMessage({ type: MSG.CLOSED }); } catch { /* ignore */ }
    if (rafId != null) { try { win.cancelAnimationFrame(rafId); } catch { /* ignore */ } }
    const w = await tauriWindow();
    if (w) { try { await w.close(); return; } catch { /* fall through */ } }
    try { win.close(); } catch { /* ignore */ }
  }

  // Announce we're listening and whether native rendering is possible, so the
  // editor can pick the right path from the start.
  if (channel) {
    const webgpu = !!gpuCanvas && typeof navigator !== 'undefined' && !!navigator.gpu;
    try { channel.postMessage({ type: MSG.READY, webgpu }); } catch { /* ignore */ }
    if (!webgpu) { try { channel.postMessage({ type: MSG.NEED_FALLBACK }); } catch { /* ignore */ } }
  }
  reportSize();

  // Expose the profiler on the window so it can be read from devtools
  // (e.g. `__secondMonitorProfiler.snapshot()`) without the overlay.
  try { win.__secondMonitorProfiler = profiler; } catch { /* ignore */ }

  return {
    get tier() { return tier; },
    get renderer() { return renderer; },
    get computeRuntime() { return computeRuntime; },
    get latestSize() { return { width: latestW, height: latestH }; },
    get computeMaxDim() { return computeMaxDim; },
    get displayMaxDim() { return displayMaxDim; },
    setComputeMaxDim,
    setDisplayMaxDim,
    profiler,
    onMessage,
    closeSelf,
    toggleFullscreen,
  };
}

// Auto-start when loaded as the receiver page's module (has a DOM, not a test).
if (typeof document !== 'undefined'
    && (document.getElementById('second-monitor-output') || document.getElementById('second-monitor-gpu'))) {
  initSecondMonitorReceiver();
}
