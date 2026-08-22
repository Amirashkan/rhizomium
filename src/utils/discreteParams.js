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
// this module does, and it is why an expression-driven discrete control costs a recompile whenever
// its resolved value flips (Editor watches for exactly that; see _refreshDiscreteExpressionParams).
//
// The evaluated result is coerced by parameter type:
//   boolean  non-zero / "true" -> true, 0 / "" / "false" -> false
//   select   a string matching an option wins; otherwise a number picks an option by VALUE first
//            ("=512" on ['256','512','1024'] selects '512') and by INDEX second ("=1" selects the
//            second option). Anything unresolvable falls back to the caller's default, never to the
//            raw "=..." text — a compiler comparing that string against option names would silently
//            take the wrong branch.

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

export function coerceBoolean(result, fallback = false) {
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return Number.isFinite(result) && result !== 0;
  if (typeof result === 'string') {
    const t = result.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false' || t === '') return false;
    const n = Number(t);
    // A leftover identifier ("node_5 > 1" from a failed evaluation) is not an answer — keep the
    // parameter on its previous/default setting rather than reading it as truthy.
    return Number.isFinite(n) ? n !== 0 : Boolean(fallback);
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
  if (!isExpressionValue(rawValue)) return rawValue;

  const def = getParamDef(node, name);
  const kind = discreteParamKind(def);
  if (!kind) return rawValue;

  let result;
  try {
    result = expressionSystem.evaluateExpression(rawValue, {}, node);
  } catch {
    result = undefined;
  }

  if (kind === 'boolean') {
    const fallback = defaultValue !== undefined ? defaultValue : def?.default ?? false;
    return coerceBoolean(result, coerceBoolean(fallback));
  }

  const values = optionValues(def);
  const fallback = defaultValue !== undefined ? String(defaultValue) : def?.default ?? values[0];
  return coerceOption(result, values, fallback);
}

/**
 * A node's params with every expression-driven discrete parameter replaced by the option it
 * resolves to. Returns the SAME object when there is nothing to resolve, so the common case costs
 * one scan and no allocation — this runs per compute node per frame on the uniform-packing path.
 *
 * Used where a consumer reads params by name and branches on them (computeUniformLayout maps
 * `quality === 'Low'` to an index, `colorize` to 1.0/0.0): handed raw "=..." text, the first
 * silently takes the default branch and the second is truthy no matter what it evaluates to.
 */
export function resolveDiscreteParams(node) {
  const params = node?.params;
  if (!params || !hasDiscreteExpressionParams(node)) return params;

  const resolved = { ...params };
  for (const [name, value] of Object.entries(params)) {
    if (!isExpressionValue(value)) continue;
    if (!discreteParamKind(getParamDef(node, name))) continue;
    resolved[name] = resolveDiscreteParam(node, name, value);
  }
  return resolved;
}

/**
 * The resolved value of every expression-driven discrete parameter on a node, as a
 * "name=value" signature — or '' when the node has none.
 *
 * A discrete control is BAKED into the generated WGSL, so a live driver (audio, the clock, another
 * node) cannot move it the way it moves a uniform: the shader has to be rebuilt. Rebuilding every
 * frame is out of the question, but the resolved value is discrete and so changes rarely — Editor
 * polls this signature and rebuilds only on a flip.
 */
export function discreteExpressionSignature(node) {
  const params = node?.params;
  if (!params) return '';

  let signature = '';
  for (const [name, value] of Object.entries(params)) {
    if (!isExpressionValue(value)) continue;
    const def = getParamDef(node, name);
    if (!discreteParamKind(def)) continue;
    signature += `${name}=${resolveDiscreteParam(node, name, value)};`;
  }
  return signature;
}

/** True when any parameter on the node is a discrete control driven by an expression. */
export function hasDiscreteExpressionParams(node) {
  const params = node?.params;
  if (!params) return false;
  return Object.entries(params).some(
    ([name, value]) => isExpressionValue(value) && discreteParamKind(getParamDef(node, name))
  );
}
