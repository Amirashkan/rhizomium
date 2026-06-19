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
//    Compute graphs — including stateful/feedback sims — are reproduced here too:
//    this window runs its OWN ComputeExecutor and evolves an independent copy of
//    the simulation from the broadcast graph + per-frame uniform bytes.
//
//  • FALLBACK (pixels): for the few graphs the receiver can't reproduce from state
//    alone (a compute node fed by a fragment node, or fragment storage buffers),
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
  } catch (_) {
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
  const [{ ComputeExecutor }, { TextureManager }] = await Promise.all([
    import('../gpu/ComputeExecutor.js'),
    import('../core/TextureManager.js'),
  ]);
  win.computeNodeRegistry = win.computeNodeRegistry || new Map();
  if (!win.graph) {
    win.graph = {
      nodes: [],
      getNode(id) { return this.nodes.find((n) => String(n.id) === String(id)) || null; },
    };
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
      // Count GPU-completed frames so the profiler can show real throughput
      // (onFramePresented fires on onSubmittedWorkDone, not at dispatch time).
      try { renderer.onFramePresented = () => profiler.presented(); } catch (_) { /* ignore */ }
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
    try { channel?.postMessage({ type: MSG.NEED_FALLBACK }); } catch (_) { /* ignore */ }
  }

  function applyShader(wgsl) {
    if (!renderer || !wgsl || wgsl === appliedWgsl) return;
    try { renderer.setShaderSource(wgsl); appliedWgsl = wgsl; } catch (_) { /* ignore */ }
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
    const nodes = msg.nodes || [];
    const key = JSON.stringify(nodes.map((n) => [n.id, n.kind, n.wgsl, n.width, n.height]));
    if (key === appliedComputeKey) return; // unchanged graph — skip the costly re-init
    if (!win.computeNodeRegistry) win.computeNodeRegistry = new Map();
    if (!win.graph) {
      win.graph = { nodes: [], getNode(id) { return this.nodes.find((n) => String(n.id) === String(id)) || null; } };
    }
    const registry = win.computeNodeRegistry;
    registry.clear();
    win.graph.nodes = [];
    for (const n of nodes) {
      const node = {
        id: n.id,
        kind: n.kind,
        inputs: Array.isArray(n.inputs) ? n.inputs.slice() : [],
        params: {},
        computeResolution: [n.width || 0, n.height || 0],
      };
      win.graph.nodes.push(node);
      registry.set(n.id, {
        node,
        getInput: () => null,
        resolution: [n.width || 0, n.height || 0],
        wgslCode: n.wgsl,
        supportsFeedback: !!n.supportsFeedback,
        lastInputHash: null,
      });
    }
    appliedComputeKey = key;
    Promise.resolve(exec.initialize ? exec.initialize() : null).then(() => {
      // Every manager consumes our injected per-node bytes rather than re-packing.
      exec.computeManagers?.forEach?.((m) => { if (m) m.externalUniformMode = true; });
      if (Array.isArray(msg.executionOrder) && msg.executionOrder.length) {
        exec.executionOrder = msg.executionOrder.slice();
      }
      if (latestComputeUniforms) applyComputeUniforms(latestComputeUniforms);
    }).catch(() => { appliedComputeKey = null; });
  }

  function applyComputeUniforms(msg) {
    latestComputeUniforms = msg;
    const exec = computeRuntime && computeRuntime.computeExecutor;
    const managers = exec && exec.computeManagers;
    if (!managers || typeof managers.get !== 'function') return;
    for (const n of (msg.nodes || [])) {
      const mgr = managers.get(n.id);
      if (!mgr || typeof mgr.writeRawComputeUniforms !== 'function') continue;
      try { mgr.writeRawComputeUniforms(n.packed, n.colorStops || null); } catch (_) { /* ignore */ }
      // Static-input stateless nodes are skipped by the executor's change detection;
      // when the injected uniforms OR color stops change, invalidate the hash so it
      // re-dispatches. (Color stops live in a separate buffer, not in `packed`.)
      if (_computeChanged(n.id, n.packed, n.colorStops)) {
        try { exec.inputHashes?.delete?.(n.id); } catch (_) { /* ignore */ }
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
          try { exec.inputHashes.delete(node.id); } catch (_) { /* ignore */ }
          queue.push(node.id);
        }
      }
    }
  }

  function applyTexture(msg) {
    if (!msg || !msg.bitmap) return;
    if (!computeRuntime) { pendingTextures.push(msg); ensureComputeRuntime(); return; }
    const tm = computeRuntime.textureManager;
    if (tm && typeof tm.injectExternalTexture === 'function') {
      try { tm.injectExternalTexture(msg.nodeId, msg.bitmap); } catch (_) { /* ignore */ }
    }
  }

  function clearComputeRuntime() {
    try { win.computeExecutor?.clear?.(); } catch (_) { /* ignore */ }
    appliedComputeKey = null;
    latestComputeUniforms = null;
    prevPacked.clear();
    prevColorStops.clear();
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
      case MSG.UNIFORMS:
        snapshot = { aspect: d.aspect || null, globals: d.globals || null, params: d.params || null };
        break;
      case MSG.CAPS:
        setTier(d.tier);
        break;
      case MSG.COMPUTE_GRAPH:
        setTier(TIER.NATIVE_COMPUTE);
        applyComputeGraph(d);
        break;
      case MSG.COMPUTE_UNIFORMS:
        applyComputeUniforms(d);
        break;
      case MSG.TEXTURE:
        applyTexture(d);
        break;
      case MSG.FRAME:
        if (d.bitmap) setLatest(d.bitmap, d.sw, d.sh);
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
    if (latest && latest !== bitmap) { try { latest.close(); } catch (_) { /* ignore */ } }
    latest = bitmap;
    latestW = w || (bitmap && bitmap.width) || 0;
    latestH = h || (bitmap && bitmap.height) || 0;
  }

  // --- sizing --------------------------------------------------------------
  function backingSize() {
    const dpr = win.devicePixelRatio || 1;
    const cssW = win.innerWidth || 1280;
    const cssH = win.innerHeight || 720;
    return {
      dpr, cssW, cssH,
      bw: Math.max(1, Math.round(cssW * dpr)),
      bh: Math.max(1, Math.round(cssH * dpr)),
    };
  }

  function sizeGpuCanvas() {
    if (!gpuCanvas) return;
    const { cssW, cssH, bw, bh } = backingSize();
    if (gpuCanvas.width !== bw) gpuCanvas.width = bw;
    if (gpuCanvas.height !== bh) gpuCanvas.height = bh;
    gpuCanvas.style.width = cssW + 'px';
    gpuCanvas.style.height = cssH + 'px';
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
    } catch (_) { /* ignore */ }
  }

  function onResize() {
    sizeFallbackCanvas();
    sizeGpuCanvas();
    reportSize();
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
    try {
      r.writeRawUniforms(snapshot);
      r.render({ timeSec });
      return true;
    } catch (_) {
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
        try { fbCtx.drawImage(latest, dx, dy, dw, dh); } catch (_) { /* skip frame */ }
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
  rafId = win.requestAnimationFrame(frame);

  // --- input / lifecycle ---------------------------------------------------
  win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSelf();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'p' || e.key === 'P') profiler.toggle();
  });
  win.addEventListener('dblclick', () => toggleFullscreen());
  win.addEventListener('beforeunload', () => {
    try { channel?.postMessage({ type: MSG.CLOSED }); } catch (_) { /* ignore */ }
  });

  const hint = doc.getElementById('second-monitor-hint');
  if (hint) win.setTimeout(() => { hint.style.opacity = '0'; }, 4000);

  async function tauriWindow() {
    if (!isTauri()) return null;
    if (cachedWindow) return cachedWindow;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      cachedWindow = getCurrentWindow();
    } catch (_) {
      cachedWindow = null;
    }
    return cachedWindow;
  }

  async function toggleFullscreen() {
    const w = await tauriWindow();
    if (!w) return;
    let cur = false;
    try { cur = await w.isFullscreen(); } catch (_) { /* assume windowed */ }
    const next = !cur;
    try { await w.setFullscreen(next); } catch (_) { /* ignore */ }
    try { await w.setDecorations(!next); } catch (_) { /* ignore */ }
  }

  async function closeSelf() {
    if (closing) return;
    closing = true;
    clearComputeRuntime();
    try { win.textureManager?.destroy?.(); } catch (_) { /* ignore */ }
    try { channel?.postMessage({ type: MSG.CLOSED }); } catch (_) { /* ignore */ }
    if (rafId != null) { try { win.cancelAnimationFrame(rafId); } catch (_) { /* ignore */ } }
    const w = await tauriWindow();
    if (w) { try { await w.close(); return; } catch (_) { /* fall through */ } }
    try { win.close(); } catch (_) { /* ignore */ }
  }

  // Announce we're listening and whether native rendering is possible, so the
  // editor can pick the right path from the start.
  if (channel) {
    const webgpu = !!gpuCanvas && typeof navigator !== 'undefined' && !!navigator.gpu;
    try { channel.postMessage({ type: MSG.READY, webgpu }); } catch (_) { /* ignore */ }
    if (!webgpu) { try { channel.postMessage({ type: MSG.NEED_FALLBACK }); } catch (_) { /* ignore */ } }
  }
  reportSize();

  // Expose the profiler on the window so it can be read from devtools
  // (e.g. `__secondMonitorProfiler.snapshot()`) without the overlay.
  try { win.__secondMonitorProfiler = profiler; } catch (_) { /* ignore */ }

  return {
    get tier() { return tier; },
    get renderer() { return renderer; },
    get computeRuntime() { return computeRuntime; },
    get latestSize() { return { width: latestW, height: latestH }; },
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
