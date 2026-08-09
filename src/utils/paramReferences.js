// src/utils/paramReferences.js
//
// Internal (same-node) parameter references in expressions.
//
// A parameter expression could previously only reach *other nodes* (`=node_5`, `=node_5_x`) or the
// built-in globals (`time`, `audioEnvelope`, ...). Naming a sibling parameter of the same node —
// e.g. a Transform 2D whose Scale Y is `=scaleX` — hit the shader generator's unknown-identifier
// guard and fell back to `0.0`, so the render read zero however the source parameter was set.
//
// These helpers resolve a bare identifier that names another parameter on the *same node*:
//   - GPU: to that parameter's uniform field (so the binding stays live — dragging the source
//     parameter updates the bound one without a shader recompile), or, when the source is itself an
//     expression, to that expression's generated WGSL.
//   - CPU: to the parameter's evaluated number, so the panel readout, the node overlay and the
//     render agree.
//
// A parameter whose value is itself an expression resolves recursively; a reference cycle
// (`scaleX = "=scaleY"`, `scaleY = "=scaleX"`) resolves to nothing rather than recursing forever,
// and the caller falls back to the parameter default.

import { unifiedExpressionSystem } from './UnifiedExpressionSystem.js';

// Identifiers owned by the expression language itself. A parameter that happens to share one of
// these names must never shadow the global, or `=time` would stop meaning the clock.
const RESERVED_IDENTIFIERS = new Set([
  'time', 'frame', 'aspect', 'PI', 'E',
  'audioEnvelope', 'audioEnvelopeBass', 'audioEnvelopeMids',
  'audioEnvelopeHighs', 'audioEnvelopeFull',
]);

/** WGSL uniform field for a node parameter (matches the compilers' own key sanitisation). */
export function paramUniformField(nodeId, paramName) {
  const sanitized = `${nodeId}.${paramName}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return `u_params.${sanitized.startsWith('_') ? sanitized : `_${sanitized}`}`;
}

function floatLiteral(n) {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function isExpressionValue(value) {
  return typeof value === 'string' && value.trim().startsWith('=');
}

function identifiersOf(expression) {
  try {
    return unifiedExpressionSystem.extractIdentifiers(expression);
  } catch {
    // Incomplete/unparseable expression (the user is still typing) — nothing to bind.
    return null;
  }
}

/** Parameter names on `node` that `expression` references, excluding reserved globals. */
function referencedParamNames(node, expression, excludeParam) {
  const identifiers = identifiersOf(expression);
  if (!identifiers) return [];
  return identifiers.filter(name =>
    name !== excludeParam &&
    !RESERVED_IDENTIFIERS.has(name) &&
    Object.prototype.hasOwnProperty.call(node.params, name)
  );
}

/**
 * Does this expression name another parameter of the same node? Callers use it to keep such an
 * expression out of the result cache — the cache key doesn't capture the source parameter, so a
 * cached binding would freeze at the value it had when first evaluated.
 */
export function referencesParams(node, expression, excludeParam = null) {
  if (!node?.params || typeof expression !== 'string') return false;
  return referencedParamNames(node, expression, excludeParam).length > 0;
}

/**
 * Identifier -> WGSL mapping for the sibling parameters an expression references.
 *
 * @param {object} node            Node owning the expression.
 * @param {string} expression      The parameter expression (with or without the leading '=').
 * @param {object} [options]
 * @param {object} [options.uniformManager] Uniform manager; when present a numeric sibling is
 *                                          delivered as a uniform instead of a baked literal.
 * @param {string} [options.excludeParam]   Name of the parameter being compiled — never binds to
 *                                          itself.
 * @param {object} [options.graph]          Graph used to resolve node references nested inside a
 *                                          sibling's own expression.
 * @returns {object} mapping (empty when the expression references no sibling parameter)
 */
export function buildParamRefMapping(node, expression, options = {}) {
  const { uniformManager = null, excludeParam = null, graph = null } = options;
  const mapping = {};
  if (!node?.params || typeof expression !== 'string') return mapping;

  const visited = new Set(excludeParam ? [excludeParam] : []);
  for (const name of referencedParamNames(node, expression, excludeParam)) {
    const wgsl = _resolveParamAsWGSL(node, name, { uniformManager, graph, visited });
    if (wgsl !== null) mapping[name] = wgsl;
  }
  return mapping;
}

/**
 * buildParamRefMapping for a node compiler, taking the uniform manager and graph the compiler was
 * handed. Compilers all resolve parameter expressions the same way, so this keeps the call one line
 * at each getParam/getShaderParam site.
 */
export function compilerParamRefMapping(compiler, node, expression, paramName) {
  return buildParamRefMapping(node, expression, {
    uniformManager: compiler?.uniformManager ?? null,
    excludeParam: paramName,
    graph: compiler?.graph ?? null,
  });
}

function _resolveParamAsWGSL(node, name, ctx) {
  if (ctx.visited.has(name)) return null; // reference cycle
  const raw = node.params[name];

  if (isExpressionValue(raw)) {
    const nested = { ...ctx, visited: new Set([...ctx.visited, name]) };
    const nestedMapping = {};
    for (const ref of referencedParamNames(node, raw, null)) {
      const resolved = _resolveParamAsWGSL(node, ref, nested);
      if (resolved === null) return null; // cycle or unusable value anywhere in the chain
      nestedMapping[ref] = resolved;
    }
    try {
      return unifiedExpressionSystem.generateShader(raw, nestedMapping, ctx.graph);
    } catch {
      return null;
    }
  }

  const num = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(num)) return null; // enum/text parameter — not a numeric binding source

  if (ctx.uniformManager?.uniformValues) {
    // Register the source parameter as a uniform so the binding tracks it live: editing the source
    // rewrites the uniform and the bound parameter follows without a shader rebuild.
    ctx.uniformManager.uniformValues.set(`${node.id}.${name}`, num);
    return paramUniformField(node.id, name);
  }
  return floatLiteral(num);
}

/**
 * CPU scope holding this node's parameters by name, so an expression can read a sibling.
 * Expression-valued parameters are evaluated (recursively, cycle-guarded); a parameter that cannot
 * be resolved is simply left out of the scope, and the referencing expression then fails the way
 * any unknown identifier does.
 *
 * @param {object} node
 * @param {object} [options]
 * @param {string} [options.excludeParam] Parameter being evaluated — never resolves to itself.
 * @param {object} [options.baseContext]  Globals (time, audio, node references, ...) available to
 *                                        nested parameter expressions.
 */
export function buildParamScope(node, options = {}) {
  const { excludeParam = null, baseContext = {} } = options;
  const scope = {};
  if (!node?.params) return scope;

  const visited = new Set(excludeParam ? [excludeParam] : []);
  for (const name of Object.keys(node.params)) {
    if (name === excludeParam || RESERVED_IDENTIFIERS.has(name)) continue;
    const value = _resolveParamAsValue(node, name, { baseContext, visited });
    if (value !== undefined) scope[name] = value;
  }
  return scope;
}

function _resolveParamAsValue(node, name, ctx) {
  if (ctx.visited.has(name)) return undefined; // reference cycle
  const raw = node.params[name];

  if (isExpressionValue(raw)) {
    const nested = { ...ctx, visited: new Set([...ctx.visited, name]) };
    const scope = { ...ctx.baseContext };
    for (const ref of referencedParamNames(node, raw, null)) {
      const resolved = _resolveParamAsValue(node, ref, nested);
      if (resolved === undefined) return undefined;
      scope[ref] = resolved;
    }
    try {
      const result = unifiedExpressionSystem.evaluateCPUOrThrow(raw, scope);
      return Number.isFinite(result) ? result : undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    // A fully numeric string ("1.0", "-.5", "2e3") is the parameter's number; anything else is an
    // enum/text value (e.g. "Stripes") and stays a string so a comparison against it still works.
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
      const num = parseFloat(trimmed);
      return Number.isFinite(num) ? num : undefined;
    }
    return raw;
  }
  return undefined;
}
