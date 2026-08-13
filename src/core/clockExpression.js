// src/core/clockExpression.js
//
// One answer to "does this parameter advance on its own clock?", shared by everything that has to
// decide whether a graph is animating: the render loop's redraw check (Editor.hasActiveAnimations),
// and the preview cache's dirty check (PreviewComputer._evaluateDirtyNodes).
//
// The `=` prefix is optional on purpose. The compilers treat a bare `sin(time)` as a live
// expression and emit `sin(g.time)` for it (see InputNodes.resolveParam / ComputeNodes.getParam /
// TransformNodes.getShaderParam, all of which test `startsWith('=') || /\btime\b/`), so the callers
// here must agree — otherwise the shader animates while the CPU side declares the graph static and
// stops refreshing it.
//
// Matching is word-bounded so a parameter that merely contains the letters (a "timeline" label, an
// "overtime" caption on a Text node) isn't misread as animated.

const CLOCK_IDENTIFIER_RE = /\b(time|frame|audioEnvelope(?:Bass|Mids|Highs|Full)?)\b/;

/** True when a parameter value is an expression that advances with the clock or the audio signal. */
export function isClockExpression(value) {
  return typeof value === 'string' && CLOCK_IDENTIFIER_RE.test(value);
}

/** True when any of a node's parameters is such an expression. */
export function hasClockExpressionParam(node) {
  const params = node?.params;
  if (!params || typeof params !== 'object') return false;
  for (const value of Object.values(params)) {
    if (isClockExpression(value)) return true;
  }
  return false;
}
