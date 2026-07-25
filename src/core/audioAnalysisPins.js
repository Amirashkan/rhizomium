/**
 * The Audio Analysis node's output pins, in order, and how to read their live CPU-side values.
 *
 * This order is the contract between four places that must agree: the node's pinsOut
 * (data/nodes/InputNodes.js), the compiler's outputPins (codegen/compilers/InputNodes.js), the
 * uniforms AudioAnalysisProcessor writes, and every consumer that resolves a pin reference on the
 * CPU (Hold, Count, FeedbackReset, PreviewComputer, FragmentTextureRenderer). It lives here so
 * adding an output is one edit rather than six, and so what this replaced — a switch on pin index
 * repeated in each consumer — cannot drift out of sync between them.
 */
export const AUDIO_ANALYSIS_PINS = [
  'level', 'low', 'mid', 'high',
  'kick', 'kickTrig', 'snare', 'snareTrig', 'hat', 'hatTrig',
  'kickMeter', 'snareMeter', 'hatMeter',
  'centroid', 'density',
];

/**
 * Live value of one output pin, as stashed on the node by AudioAnalysisProcessor each frame.
 * Out-of-range indices fall back to pin 0 (`level`), matching how a bare `=node_<id>` resolves.
 */
export function audioAnalysisPinValue(node, pinIndex) {
  const name = AUDIO_ANALYSIS_PINS[pinIndex] || AUDIO_ANALYSIS_PINS[0];
  const v = node?.[`__audio_${name}`];
  return typeof v === 'number' ? v : 0;
}

/** Every pin's live value, keyed by name — for callers that need the whole set (preview, hashing). */
export function audioAnalysisPinValues(node) {
  const out = {};
  for (const name of AUDIO_ANALYSIS_PINS) {
    const v = node?.[`__audio_${name}`];
    out[name] = typeof v === 'number' ? v : 0;
  }
  return out;
}
