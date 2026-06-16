// src/ui/secondMonitorReceiver.js
//
// Receiver for the Tauri second-monitor window (editor/second-monitor.html).
//
// Runs inside the borderless native window on the second display. It listens on
// the shared BroadcastChannel for mirrored frames from the editor and paints the
// latest one — letterboxed on black — from its OWN requestAnimationFrame loop.
// Driving the paint from this window's rAF (not the editor's) means the output
// runs at the second display's refresh rate and never freezes if the editor
// window is occluded or minimised.
//
// Keyboard: Esc closes the window; F (or double-click) toggles native
// fullscreen. Tauri APIs are loaded via guarded dynamic import so this module
// stays inert if ever opened outside the desktop app.

import { letterboxRect } from './letterbox.js';
import { isTauri } from '../utils/isTauri.js';
import {
  SecondMonitorMessage as MSG,
  openSecondMonitorChannel,
} from './secondMonitorFrameChannel.js';

export function initSecondMonitorReceiver(doc = document, win = window) {
  const canvas = doc.getElementById('second-monitor-output');
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let latest = null;     // most recent ImageBitmap
  let latestW = 0;
  let latestH = 0;
  let rafId = null;
  let closing = false;
  let cachedWindow = null;

  const channel = openSecondMonitorChannel();

  function setLatest(bitmap, w, h) {
    if (latest && latest !== bitmap) {
      try { latest.close(); } catch (_) { /* ignore */ }
    }
    latest = bitmap;
    latestW = w || (bitmap && bitmap.width) || 0;
    latestH = h || (bitmap && bitmap.height) || 0;
  }

  function onMessage(e) {
    const d = e?.data;
    if (!d) return;
    if (d.type === MSG.FRAME && d.bitmap) {
      setLatest(d.bitmap, d.sw, d.sh);
    } else if (d.type === MSG.CLOSE) {
      closeSelf();
    }
  }
  if (channel) channel.addEventListener('message', onMessage);

  function resizeBacking() {
    const dpr = win.devicePixelRatio || 1;
    const cssW = win.innerWidth || 1280;
    const cssH = win.innerHeight || 720;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }
  resizeBacking();
  win.addEventListener('resize', resizeBacking);

  function frame() {
    rafId = win.requestAnimationFrame(frame);
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (latest) {
      const { dx, dy, dw, dh } = letterboxRect(latestW, latestH, cw, ch);
      if (dw > 0 && dh > 0) {
        try { ctx.drawImage(latest, dx, dy, dw, dh); } catch (_) { /* skip frame */ }
      }
    }
  }
  rafId = win.requestAnimationFrame(frame);

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

  // Let the editor know a receiver is up (purely informational).
  if (channel) { try { channel.postMessage({ type: MSG.READY }); } catch (_) { /* ignore */ } }

  return {
    get latestSize() { return { width: latestW, height: latestH }; },
    onMessage,
    closeSelf,
    toggleFullscreen,
  };
}

// Auto-start when loaded as the receiver page's module (has a DOM, not a test).
if (typeof document !== 'undefined' && document.getElementById('second-monitor-output')) {
  initSecondMonitorReceiver();
}
