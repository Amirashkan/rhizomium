/**
 * MasterOutput.js
 *
 * Single owner of the rendered output's opacity.
 *
 * Two things fade the output — the master fader in the VJ panel and scene
 * transitions — and they have to compose rather than overwrite each other.
 * Writing canvas.style.opacity from both meant a crossfade ending at 1.0 wiped
 * out a master fader parked at 40%, and moving the fader mid-transition fought
 * the animation frame-by-frame.
 */

const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
};

const state = {
  master: 1,
  transition: 1
};

// Surfaces that are not DOM elements in this document - the second-monitor
// window renders its own copy of the output in a separate JS context, so it
// has to be told the level rather than inheriting it from a style.
const listeners = new Set();

/**
 * Follow the effective output opacity.
 * @param {(opacity: number) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onOutputOpacityChange(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * The on-screen surfaces the output is drawn to. #gpu-canvas is reparented into
 * the floating preview when that panel is open, so looking it up by id each time
 * keeps working wherever it currently lives.
 */
export function getOutputSurfaces() {
  const canvas = document.getElementById('gpu-canvas');
  return canvas ? [canvas] : [];
}

/** Effective opacity: master fader × transition fade. */
export function getOutputOpacity() {
  return state.master * state.transition;
}

function applyOutputOpacity() {
  const opacity = getOutputOpacity();
  getOutputSurfaces().forEach(surface => {
    surface.style.opacity = String(opacity);
  });

  listeners.forEach(listener => {
    try {
      listener(opacity);
    } catch {
      // A mirror that cannot take the level must not stall the local fade.
    }
  });

  return opacity;
}

/** Master fader (VJ panel). Survives transitions. */
export function setMasterOpacity(value) {
  state.master = clamp01(value);
  return applyOutputOpacity();
}

export function getMasterOpacity() {
  return state.master;
}

/** Transition fade (TransitionManager). Rides on top of the master fader. */
export function setTransitionOpacity(value) {
  state.transition = clamp01(value);
  return applyOutputOpacity();
}

/** Drop any transition fade, e.g. when a transition is cancelled part-way. */
export function clearTransitionOpacity() {
  return setTransitionOpacity(1);
}

/** Test seam — resets both layers to fully opaque. */
export function resetOutputOpacity() {
  state.master = 1;
  state.transition = 1;
  return applyOutputOpacity();
}
