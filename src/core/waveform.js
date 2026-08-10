// Shared waveform maths for the Wave input node, so the GPU codegen
// (src/codegen/compilers/InputNodes.js), the `=node_<id>` expression mapping
// (utils/UnifiedExpressionSystem.js) and every CPU-side evaluation (PreviewComputer and the
// Hold/Count/Trigger/FeedbackReset signal evaluators) all describe the SAME curve. A Wave whose
// thumbnail disagreed with what it drives would be worse than no readout at all.
//
// One cycle is parameterised by a normalised phase p in [0, 1):
//
//     p = fract((time - syncTime) * frequency + phase)
//
// `syncTime` is when the cycle was last restarted by a pulse on the node's sync pin — 0 (and the
// subtraction omitted entirely) when nothing is wired to it. Detecting that pulse needs memory of
// the previous frame, which a fragment shader has none of, so WaveSyncProcessor tracks it on the
// CPU and streams the time in as a uniform, exactly as Hold and Count do.
//
// and every shape returns a BIPOLAR value in [-1, 1], phase-aligned with the sine (all shapes
// leave 0 rising at p = 0, peak at p = 0.25 and trough at p = 0.75) so switching shape keeps the
// motion in step. `unipolar` remaps that to [0, 1] before amplitude/offset are applied, which is
// what most consumers want (a radius, a mix factor, a brightness):
//
//     out = (unipolar ? raw * 0.5 + 0.5 : raw) * amplitude + offset
//
// Saw and Ramp Down are the exception to the alignment rule: a ramp is defined by its
// discontinuity, so it runs -1 -> 1 (or 1 -> -1) across the cycle and starts at its extreme.

/** Shape options, in the order they appear in the node's Shape dropdown. */
export const WAVE_SHAPES = ['Sine', 'Triangle', 'Square', 'Saw', 'Ramp Down'];

export const DEFAULT_WAVE_SHAPE = 'Sine';

const TAU = Math.PI * 2;

/** The shape a node is set to, normalised for comparison (lowercase, no spaces). */
export function waveShapeKey(shape) {
  return String(shape ?? DEFAULT_WAVE_SHAPE).toLowerCase().replace(/\s+/g, '');
}

/** The Wave node's shape param, normalised (see waveShapeKey). */
export function waveShapeOf(node) {
  return waveShapeKey(node?.params?.shape);
}

/**
 * WGSL for one shape, given an expression that evaluates to the normalised phase p.
 * `pulseWidth` is only read by Square (the fraction of the cycle spent high).
 */
function shapeExpression(shapeKey, p, pulseWidth) {
  switch (shapeKey) {
    case 'triangle':
      // Shifted a quarter cycle so the ramp crosses zero rising at p = 0, like the sine.
      return `(1.0 - 4.0 * abs(fract((${p}) + 0.25) - 0.5))`;
    case 'square':
      // High for the first `pulseWidth` of the cycle — which is the half the sine spends positive
      // at the default 0.5 duty.
      return `select(-1.0, 1.0, (${p}) < (${pulseWidth}))`;
    case 'saw':
      return `(2.0 * (${p}) - 1.0)`;
    case 'rampdown':
      return `(1.0 - 2.0 * (${p}))`;
    case 'sine':
    default:
      return `sin(${TAU} * (${p}))`;
  }
}

/**
 * A single WGSL expression for the node's output. Every operand is passed in as a WGSL
 * string (a uniform reference or a baked literal) so the caller controls how params are sourced.
 *
 * @param {object} args
 * @param {string} args.shape        - shape name or key (see WAVE_SHAPES)
 * @param {string} args.time         - expression for the clock, normally `g.time`
 * @param {string} args.frequency    - cycles per second
 * @param {string} args.phase        - phase offset in cycles (1.0 = a full cycle)
 * @param {string} args.amplitude
 * @param {string} args.offset
 * @param {string} args.pulseWidth   - Square duty, 0..1
 * @param {boolean} args.unipolar    - remap [-1,1] to [0,1] before amplitude/offset
 * @param {string} [args.syncTime]   - when the cycle was last restarted; omitted when unsynced
 * @returns {string} WGSL expression of type f32
 */
export function buildWaveExpression({
  shape,
  time = 'g.time',
  frequency = '1.0',
  phase = '0.0',
  amplitude = '1.0',
  offset = '0.0',
  pulseWidth = '0.5',
  unipolar = false,
  syncTime = null,
}) {
  // An unsynced wave (the common case) emits no subtraction at all rather than `- 0.0`.
  const clock = syncTime === null ? `(${time})` : `((${time}) - (${syncTime}))`;
  const p = `fract(${clock} * (${frequency}) + (${phase}))`;
  const raw = shapeExpression(waveShapeKey(shape), p, pulseWidth);
  const shaped = unipolar ? `((${raw}) * 0.5 + 0.5)` : raw;
  return `((${shaped}) * (${amplitude}) + (${offset}))`;
}

/**
 * The same curve on the CPU, for node previews and for the scalar-signal evaluators that feed
 * Hold / Count / Trigger / feedback resets. Mirrors buildWaveExpression exactly.
 *
 * @param {object} args - same fields as buildWaveExpression, but as numbers
 * @returns {number}
 */
export function evaluateWave({
  shape,
  time = 0,
  frequency = 1,
  phase = 0,
  amplitude = 1,
  offset = 0,
  pulseWidth = 0.5,
  unipolar = false,
  syncTime = 0,
}) {
  const fract = (x) => x - Math.floor(x);
  const p = fract((time - syncTime) * frequency + phase);

  let raw;
  switch (waveShapeKey(shape)) {
    case 'triangle':
      raw = 1 - 4 * Math.abs(fract(p + 0.25) - 0.5);
      break;
    case 'square':
      raw = p < pulseWidth ? 1 : -1;
      break;
    case 'saw':
      raw = 2 * p - 1;
      break;
    case 'rampdown':
      raw = 1 - 2 * p;
      break;
    case 'sine':
    default:
      raw = Math.sin(TAU * p);
      break;
  }

  const shaped = unipolar ? raw * 0.5 + 0.5 : raw;
  return shaped * amplitude + offset;
}

/** True when the node's `unipolar` param is on (it is stored as a bool, but may arrive as text). */
export function isWaveUnipolar(node) {
  const raw = node?.params?.unipolar;
  if (typeof raw === 'boolean') return raw;
  return String(raw ?? 'false').toLowerCase() === 'true';
}

/** Pin index of the Wave node's sync input, shared by the compiler and WaveSyncProcessor. */
export const WAVE_SYNC_PIN = 0;

/** True when something is wired to this Wave's sync pin — i.e. its phase is externally restarted. */
export function isWaveSynced(node) {
  const source = node?.inputs?.[WAVE_SYNC_PIN];
  return source !== null && source !== undefined && source !== '';
}

/**
 * When this Wave's cycle was last restarted, as advanced each frame by WaveSyncProcessor.
 * 0 for an unsynced wave, which is also the free-running origin — so this is safe to use
 * unconditionally on the CPU side.
 */
export function waveSyncTime(node) {
  const t = node?.__waveSyncTime;
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}
