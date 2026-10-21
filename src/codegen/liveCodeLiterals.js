// src/codegen/liveCodeLiterals.js
// Alt-dragging a number in the Custom GLSL editor must not recompile the shader per step (a rebuild
// per step dropped the editor under 5 fps). Once a node is armed for dragging, each float (or
// i/u-suffixed) literal in its body compiles as a uniform holding the literal's value, so a drag is
// a buffer write. The arming holds for as long as the code keeps the same shape around those
// literals — the "skeleton" — and the values are always read from the code itself, so a compile
// of the same code produces the same picture whether it is armed or not.
// Kept in a WeakMap rather than on the node so it never reaches a save file or a clone.

import { findNumbers, uniformCastFor } from '../ui/components/codeNumberScrub.js';

export const LIVE_LITERAL_PARAM_PREFIX = 'liveLiteral';

// Beyond this a body keeps its literals baked; the drag falls back to throttled recompiles.
export const MAX_LIVE_LITERALS = 256;

const armed = new WeakMap();

/**
 * The literals of `code` that can be read from a uniform, plus the code with them cut out.
 * Returns null when there are none, or too many.
 */
export function scanLiveLiterals(code) {
  const literals = findNumbers(code)
    .map((number) => ({ ...number, cast: uniformCastFor(code, number) }))
    .filter((number) => number.cast);
  if (literals.length === 0 || literals.length > MAX_LIVE_LITERALS) return null;
  let skeleton = '';
  let at = 0;
  for (const literal of literals) {
    skeleton += code.slice(at, literal.start) + '\u0000';
    at = literal.end;
  }
  skeleton += code.slice(at);
  return { skeleton, literals };
}

export function armLiveLiterals(node, skeleton) {
  armed.set(node, skeleton);
}

/** The scan to compile `code` with, or null when the node isn't armed for code of this shape. */
export function liveLiteralsFor(node, code) {
  const skeleton = node ? armed.get(node) : undefined;
  if (skeleton === undefined) return null;
  const scan = scanLiveLiterals(code);
  return scan && scan.skeleton === skeleton ? scan : null;
}

export function disarmLiveLiterals(node) {
  armed.delete(node);
}
