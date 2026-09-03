// src/core/numericParam.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { buildParamScope, externalControlScope } from '../utils/paramReferences.js';

/**
 * Resolve a node parameter that a CPU processor needs as a number this frame.
 *
 * Six processors (Audio Analysis, Count, Hold, Wave sync, Trigger, Feedback reset) all need the
 * same thing: a parameter that may be a plain number or an `=expr`, evaluated the same way the
 * shader would so the CPU and the GPU never disagree. They each carried a byte-identical copy of
 * this, which is why the gap below was six bugs rather than one.
 *
 * The gap: a parameter driven by MIDI or OSC reads its controller through the `midi` / `osc`
 * identifiers (see midi/README.md), and those are per parameter — `externalControlScope` keys off
 * the node id AND the parameter name, so they cannot live in the frame-wide context the callers
 * build. Without them a threshold written as `=midi` evaluated to nothing and silently fell back to
 * its default, so a knob mapped to a threshold moved the shader-side value and not the CPU-side
 * decision that actually fires the trigger. Sibling parameters are in scope for the same reason
 * they are on the GPU path: `=threshold * 0.5` should mean the same thing wherever it is resolved.
 *
 * Both scopes are built only when the parameter actually holds an expression — the common case is
 * a plain number, and this runs per node per frame.
 *
 * @param {object} node
 * @param {string} name      parameter name
 * @param {number} def       value to use when nothing usable is there
 * @param {object} ctx       frame-wide context (time, audio globals, PI/E, ...)
 * @param {*} [fallback]     value to read instead when the parameter is absent
 * @returns {number}
 */
export function numericParamValue(node, name, def, ctx, fallback) {
  let raw = node?.params?.[name];
  if (raw === undefined || raw === null) raw = fallback;
  if (raw === undefined || raw === null) return def;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : def;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const isExpression =
      trimmed.startsWith('=') || /[a-zA-Z_]/.test(trimmed) || trimmed.includes('(');
    if (isExpression) {
      try {
        const expr = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
        const scope = {
          ...ctx,
          ...buildParamScope(node, { excludeParam: name, baseContext: ctx }),
          ...externalControlScope(node?.id, name),
        };
        const result = unifiedExpressionSystem.evaluateCPU(expr, scope);
        const num = typeof result === 'number' ? result : parseFloat(result);
        return Number.isFinite(num) ? num : def;
      } catch {
        return def;
      }
    }
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : def;
  }
  return def;
}
