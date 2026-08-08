// src/core/triggerMode.js
//
// Shared vocabulary for the Trigger node's `mode` param, used by the node definition, the WGSL
// compiler, TriggerNodeProcessor and every CPU signal evaluator (Hold / Count / Feedback reset /
// PreviewComputer). Kept in one leaf module so the two modes can't drift apart between surfaces —
// the same reason audioAnalysisPins.js exists.
//
//   "Threshold"        - the classic level detector: 1 while the input sits at or above the
//                        node's `threshold`, else 0. Pure, stateless, compiles straight to WGSL.
//   "On value change"  - fires whenever the input DIFFERS from the value it had on the previous
//                        frame by more than `minChange`, whatever its level. Comparing against the
//                        previous frame needs memory a fragment shader hasn't got, so this mode is
//                        driven on the CPU by TriggerNodeProcessor and streamed into the shader as
//                        a per-frame uniform (exactly like Hold and Count).

export const TRIGGER_MODE_THRESHOLD = 'Threshold';
export const TRIGGER_MODE_CHANGE = 'On value change';
export const TRIGGER_MODES = [TRIGGER_MODE_THRESHOLD, TRIGGER_MODE_CHANGE];

/** Default for `minChange`: a small deadband so float noise alone doesn't fire the pulse. */
export const TRIGGER_DEFAULT_MIN_CHANGE = 0.0001;

/**
 * Is this Trigger node in "On value change" mode? Anything else (including a missing param, i.e.
 * every graph saved before the mode existed) is the stateless threshold detector.
 * @param {Object} node
 * @returns {boolean}
 */
export function isTriggerChangeMode(node) {
  return node?.kind === 'Trigger' && node?.params?.mode === TRIGGER_MODE_CHANGE;
}

/**
 * The change-mode pulse TriggerNodeProcessor computed for this node this frame (0 or 1).
 * Falls back to 0 before the processor has run once.
 * @param {Object} node
 * @returns {number}
 */
export function triggerChangePulse(node) {
  return typeof node?.__triggerPulse === 'number' ? node.__triggerPulse : 0;
}
