// src/utils/discreteParams.js
//
// Expression support for DISCRETE parameters — a `select` dropdown or a `boolean` toggle.
//
// A numeric parameter holding an expression is compiled straight into the WGSL (see
// codegen/compilers/*.getShaderParam) or delivered as a uniform, so it stays live with no help
// from this module. A discrete parameter cannot take either route: the compilers branch on it in
// JavaScript at compile time — a Rectangle's `sizeMode` decides which half-extent is carried into
// aspect space, a Flip2D's `flipX` becomes a literal -1.0, a Threshold's `mode` picks an index —
// and there is no way to hand a shader a string. So an expression in one of these fields has to be
// evaluated on the CPU and collapsed to a concrete option BEFORE the branch is taken. That is what
// this module does, and it is why a driven discrete control costs a recompile whenever its resolved
// value flips (Editor watches for exactly that; see syncDrivenDiscreteParams).
//
// The same applies to a discrete parameter under MIDI or OSC: those write a raw NUMBER straight
// into node.params, and a number is not an option name either — a knob on a Mix node's blend mode
// stored 0.53, which every option lookup read as the first mode.
//
// The value is coerced by parameter type:
//   boolean  >= 0.5 / "true" -> true, below / "" / "false" -> false
//   select   a string matching an option wins; otherwise a number picks an option by VALUE first
//            ("=512" on ['256','512','1024'] selects '512') and by INDEX second ("=1" selects the
//            second option, and a knob mapped 0..n-1 sweeps the list). Anything unresolvable falls
//            back to the parameter's default, never to the raw text — a compiler comparing that
//            against option names would silently take the wrong branch.

import { NodeDefs } from '../data/NodeDefs.js';
import { expressionSystem } from './ParameterExpressionSystem.js';

/** True for a stored parameter value that is an expression ("=audioEnvelope > 0.3"). */
export function isExpressionValue(value) {
  return typeof value === 'string' && value.trim().startsWith('=');
}

/**
 * The parameter definition for node.kind/name, or null. Looked up in NodeDefs rather than taken
 * from the node so this works during compilation, where only the graph node is at hand.
 */
export function getParamDef(node, name) {
  const params = NodeDefs?.[node?.kind]?.params;
  if (!Array.isArray(params)) return null;
  return params.find((p) => p?.name === name) || null;
}

/**
 * 'boolean' | 'select' for a discrete parameter, else null.
 * A parameter carrying an `options` list is a dropdown whatever its declared type — the parameter
 * panel already routes it to the select widget on that basis (ParameterPanel.getInputHandler).
 */
export function discreteParamKind(def) {
  if (!def) return null;
  const type = def.type;
  if (type === 'bool' || type === 'boolean') return 'boolean';
  if (type === 'select' || (Array.isArray(def.options) && def.options.length > 0)) return 'select';
  return null;
}

/** Option values as plain strings; accepts both `['a','b']` and `[{value,label}]` forms. */
export function optionValues(def) {
  if (!Array.isArray(def?.options)) return [];
  return def.options
    .map((o) => (typeof o === 'string' ? o : o?.value))
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));
}

/**
 * A number reads as ON at or above 0.5 rather than at anything non-zero. A comparison yields 1/0
 * either way, but the halfway point is what a fader wants: a MIDI knob mapped to a toggle should
 * switch at the middle of its travel, not the instant it leaves the bottom.
 */
export function coerceBoolean(result, fallback = false) {
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return Number.isFinite(result) && result >= 0.5;
  if (typeof result === 'string') {
    const t = result.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false' || t === '') return false;
    const n = Number(t);
    // A leftover identifier ("node_5 > 1" from a failed evaluation) is not an answer — keep the
    // parameter on its previous/default setting rather than reading it as truthy.
    return Number.isFinite(n) ? n >= 0.5 : Boolean(fallback);
  }
  return Boolean(fallback);
}

export function coerceOption(result, values, fallback) {
  if (!values.length) return fallback;

  if (typeof result === 'boolean') {
    return values[result ? 1 : 0] ?? fallback;
  }

  if (typeof result === 'string') {
    const t = result.trim();
    const match = values.find((v) => v.toLowerCase() === t.toLowerCase());
    if (match !== undefined) return match;
    const n = Number(t);
    if (t !== '' && Number.isFinite(n)) return coerceOption(n, values, fallback);
    return fallback;
  }

  if (typeof result === 'number' && Number.isFinite(result)) {
    // Value first: a mode list of resolutions ('256','512','1024') reads far more naturally as
    // "=512" than as "=1", and an index that also names an option resolves the same either way.
    const byValue = values.find((v) => Number(v) === result);
    if (byValue !== undefined) return byValue;
    const index = Math.min(values.length - 1, Math.max(0, Math.round(result)));
    return values[index];
  }

  return fallback;
}

/**
 * Resolve one discrete parameter to a concrete value.
 *
 * Returns `rawValue` untouched when it is not an expression, or when the parameter is not discrete —
 * so this is safe to drop in at the front of a compiler's generic getParam(), where every numeric
 * expression must still reach getShaderParam() as its original "=..." text.
 */
export function resolveDiscreteParam(node, name, rawValue, defaultValue = undefined) {
  const def = getParamDef(node, name);
  const kind = discreteParamKind(def);
  if (!kind) return rawValue;

  const values = kind === 'select' ? optionValues(def) : [];

  // A value that is already an option (or a real boolean) is the answer — no work, and a legacy
  // spelling the consumers handle themselves (a lower-cased mode name) is left exactly as stored.
  if (!isExpressionValue(rawValue)) {
    if (kind === 'boolean') {
      if (typeof rawValue === 'boolean' || rawValue === undefined || rawValue === null) {
        return rawValue;
      }
    } else if (values.includes(String(rawValue))) {
      return rawValue;
    }

    // Anything else numeric is a LIVE EXTERNAL DRIVER: MIDI and OSC write a raw number straight
    // into node.params, so without this a knob on a Mix node's blend mode stores 0.53 — a name no
    // option list contains, which every option lookup silently reads as the first mode.
    const numeric = typeof rawValue === 'number'
      ? rawValue
      : (typeof rawValue === 'string' && rawValue.trim() !== '' && Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : null);
    if (numeric === null || !Number.isFinite(numeric)) return rawValue;

    if (kind === 'boolean') return coerceBoolean(numeric, false);

    // A number that names no option is only read as an INDEX while it is in range. An expression
    // clamps (the user wrote it for this field, so the nearest option is what they meant), but a
    // stray stored number is more likely junk from an older save — and quietly turning that into
    // the last option would change the shape a patch was authored with. Out of range, the value
    // is left alone for the consumer's own default to catch.
    const byValue = values.find((v) => Number(v) === numeric);
    if (byValue !== undefined) return byValue;
    const index = Math.round(numeric);
    if (index < 0 || index > values.length - 1) return rawValue;
    return values[index];
  }

  let result;
  try {
    // The parameter name is passed explicitly so a `midi`/`osc` reference inside the expression
    // resolves to the controller mapped to THIS field (see ParameterExpressionSystem) rather than
    // being recovered by scanning the node's params for matching text.
    result = expressionSystem.evaluateExpression(rawValue, {}, node, name);
  } catch {
    result = undefined;
  }

  if (kind === 'boolean') {
    const fallback = defaultValue !== undefined ? defaultValue : def?.default ?? false;
    return coerceBoolean(result, coerceBoolean(fallback));
  }

  const fallback = defaultValue !== undefined ? String(defaultValue) : def?.default ?? values[0];
  return coerceOption(result, values, fallback);
}

/**
 * True when a discrete parameter's stored value is not itself a usable option — an expression, or
 * the raw number a MIDI/OSC binding writes — so something has to resolve it before use.
 */
export function needsDiscreteResolution(node, name, value) {
  if (!discreteParamKind(getParamDef(node, name))) return false;
  return resolveDiscreteParam(node, name, value) !== value;
}

/**
 * A node's params with every driven discrete parameter replaced by the option it resolves to.
 * Returns the SAME object when there is nothing to resolve, so the common case costs one scan and
 * no allocation — this runs per compute node per frame on the uniform-packing path.
 *
 * Used where a consumer reads params by name and branches on them (computeUniformLayout maps
 * `quality === 'Low'` to an index, `colorize` to 1.0/0.0): handed raw "=..." text or a MIDI
 * number, the first silently takes the default branch and the second is truthy no matter what.
 */
export function resolveDiscreteParams(node) {
  const params = node?.params;
  if (!params || !hasDrivenDiscreteParams(node)) return params;

  const resolved = { ...params };
  for (const [name, value] of Object.entries(params)) {
    if (!needsDiscreteResolution(node, name, value)) continue;
    resolved[name] = resolveDiscreteParam(node, name, value);
  }
  return resolved;
}

/**
 * The resolved value of every driven discrete parameter on a node, as a "name=value" signature —
 * or '' when the node has none.
 *
 * A discrete control is BAKED into the generated WGSL, so a live driver (audio, the clock, a MIDI
 * knob) cannot move it the way it moves a uniform: the shader has to be rebuilt. Rebuilding every
 * frame is out of the question, but the resolved value is discrete and so changes rarely — Editor
 * polls this signature and rebuilds only on a flip.
 */
export function discreteResolutionSignature(node) {
  const params = node?.params;
  if (!params) return '';

  let signature = '';
  for (const [name, value] of Object.entries(params)) {
    if (!needsDiscreteResolution(node, name, value)) continue;
    signature += `${name}=${resolveDiscreteParam(node, name, value)};`;
  }
  return signature;
}

/** True when any parameter on the node is a discrete control something else is driving. */
export function hasDrivenDiscreteParams(node) {
  const params = node?.params;
  if (!params) return false;
  return Object.entries(params).some(([name, value]) => needsDiscreteResolution(node, name, value));
}

/**
 * The range a new MIDI or OSC binding should span for a discrete parameter.
 *
 * A dropdown names no min/max in its definition, so both controllers used to fall back to 0..1 —
 * which maps a whole knob sweep onto the first two of a Mix node's nine blend modes. A discrete
 * parameter is addressed by option INDEX, so its natural range is 0..n-1 (0..1 for a toggle, which
 * then switches at the middle of the fader's travel).
 *
 * Lives here rather than beside the other controller plumbing in ExternalParameterControl because
 * that module is imported, transitively, by the expression system this one depends on — putting it
 * there closes an import cycle and leaves EXTERNAL_CONTROL_SOURCES uninitialised at load.
 *
 * @returns {{min: number, max: number}|null} null when the parameter is not discrete, so the
 *                                            caller keeps its existing min/max fallback.
 */
export function discreteControlRange(node, paramName) {
  const def = getParamDef(node, paramName);
  const kind = discreteParamKind(def);
  if (!kind) return null;
  if (kind === 'boolean') return { min: 0, max: 1 };

  return { min: 0, max: Math.max(1, optionValues(def).length - 1) };
}
