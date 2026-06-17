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
//  • FALLBACK (pixels): for graphs the snapshot can't reproduce (textures,
//    compute/feedback), the editor broadcasts FRAME bitmaps and we paint them,
//    letterboxed on black, onto the 2D #second-monitor-output canvas — the
//    original behaviour, kept so nothing ever regresses.
//
// Driving the paint from this window's own rAF (not the editor's) means the
// output runs at the second display's refresh rate and never freezes if the
// editor window is occluded or minimised.
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

export function initSecondMonitorReceiver(doc = document, win = window, opts = {}) {
  const fbCanvas = doc.getElementById('second-monitor-output'); // 2D fallback
  const gpuCanvas = doc.getElementById('second-monitor-gpu');   // WebGPU native
  if (!fbCanvas && !gpuCanvas) return null;
  const fbCtx = fbCanvas && typeof fbCanvas.getContext === 'function'
    ? fbCanvas.getContext('2d') : null;
  const createRenderer = typeof opts.createRenderer === 'function'
    ? opts.createRenderer : defaultCreateRenderer;

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
  let cachedWindow = null;

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

  // --- channel handling ----------------------------------------------------
  function onMessage(e) {
    const d = e?.data;
    if (!d) return;
    switch (d.type) {
      case MSG.SHADER:
        tier = TIER.NATIVE;
        if (renderer) applyShader(d.wgsl);
        else { pendingWgsl = d.wgsl; ensureRenderer(); }
        break;
      case MSG.UNIFORMS:
        snapshot = { aspect: d.aspect || null, globals: d.globals || null, params: d.params || null };
        break;
      case MSG.CAPS:
        if (d.tier === TIER.NATIVE) { tier = TIER.NATIVE; ensureRenderer(); }
        else if (d.tier === TIER.FALLBACK) { tier = TIER.FALLBACK; }
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

  function frame() {
    rafId = win.requestAnimationFrame(frame);
    if (tier === TIER.NATIVE && renderNative()) {
      showCanvas('gpu');
      return;
    }
    showCanvas('2d');
    paintFallback();
  }
  showCanvas('2d');
  rafId = win.requestAnimationFrame(frame);

  // --- input / lifecycle ---------------------------------------------------
  win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSelf();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
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

  return {
    get tier() { return tier; },
    get renderer() { return renderer; },
    get latestSize() { return { width: latestW, height: latestH }; },
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
