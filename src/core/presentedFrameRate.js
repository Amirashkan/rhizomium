// src/core/presentedFrameRate.js
//
// One number, one place: how many frames the window actually puts on screen.
//
// Counted from requestAnimationFrame, which fires once per frame the browser
// presents. That is the only rate anyone can see.
//
// Every other rate this app can count — render dispatches, GPU submissions,
// simulation steps — is a rate the app CHOSE. The render loop defaults to a
// fixed 60fps timestep, so its accumulator issues 60 of those a second whether
// the window presents 60, 48 or 12. Counting them and printing the result as
// "FPS" produces a number that reads 60 on a machine showing 48, and cannot
// report anything else: it is the target rate wearing a measurement's clothes.
// That is what this module exists to replace.
//
// Rates the app chose are still worth knowing — how fast the GPU finishes a
// frame tells you whether a heavy graph is the problem. They just have to be
// labelled as what they are, next to this number rather than instead of it.

// Averaging window. Long enough not to twitch, short enough that a stall shows
// up while you are still looking at what caused it.
const WINDOW_MS = 500;

let fps = 0;
let peak = 0;
let rafId = null;
let frames = 0;
let windowStart = 0;
const listeners = new Set();

function tick(now) {
  frames++;
  const elapsed = now - windowStart;
  if (elapsed >= WINDOW_MS) {
    const sample = (frames * 1000) / elapsed;
    // Light smoothing only. Heavier averaging hides exactly the dips this is
    // here to reveal.
    fps = fps ? fps * 0.5 + sample * 0.5 : sample;
    peak = Math.max(peak, fps);
    frames = 0;
    windowStart = now;
    for (const fn of listeners) {
      try { fn(fps); } catch { /* a bad listener must not stop the count */ }
    }
  }
  rafId = requestAnimationFrame(tick);
}

function ensureRunning() {
  if (rafId !== null || typeof requestAnimationFrame !== "function") return;
  frames = 0;
  windowStart = performance.now();
  rafId = requestAnimationFrame(tick);
}

/**
 * Frames per second the window is presenting, smoothed. 0 until the first
 * window has closed (~500ms after the first caller).
 */
export function getPresentedFps() {
  ensureRunning();
  return fps;
}

/** Seconds-to-milliseconds twin of the above: how long a presented frame lasts. */
export function getPresentedFrameMs() {
  const rate = getPresentedFps();
  return rate > 0 ? 1000 / rate : 0;
}

/**
 * The best rate seen so far, used as the display's refresh rate — what a
 * healthy reading would look like here.
 *
 * The platform exposes no refresh-rate API, so the highest rate the window has
 * actually achieved is the closest honest stand-in. Grading against this rather
 * than a hardcoded 60 is the difference between a 48Hz compositor reading as
 * fine and reading as a permanent warning; on a 75Hz panel it is also the only
 * way 60 shows up as the dropped frames it is.
 */
export function getPresentedFpsCeiling() {
  ensureRunning();
  return Math.max(30, peak);
}

/**
 * Called with the new rate every time the averaging window closes.
 * @returns {() => void} unsubscribe
 */
export function subscribePresentedFps(fn) {
  listeners.add(fn);
  ensureRunning();
  return () => listeners.delete(fn);
}

/** Test seam: stop the loop and forget everything measured so far. */
export function __resetPresentedFrameRate() {
  if (rafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
  }
  rafId = null;
  fps = 0;
  peak = 0;
  frames = 0;
  windowStart = 0;
  listeners.clear();
}
