// src/codegen/liveCodeLiterals.js
// A numeric literal in a Custom GLSL body that is being Alt-dragged. While the drag lasts, the
// literal compiles as a uniform, so each step is a buffer write instead of a full shader rebuild
// (a rebuild per step dropped the editor under 5 fps). The literal is baked back on release.
// Kept in a WeakMap rather than on the node so it never reaches a save file or a clone.

export const LIVE_LITERAL_PARAM = 'liveLiteral';

const liveLiterals = new WeakMap();

/** @param {{prefix: string, suffix: string, cast: 'f32'|'i32'|'u32', value: number}} entry */
export function setLiveLiteral(node, entry) {
  liveLiterals.set(node, entry);
}

export function getLiveLiteral(node) {
  return node ? liveLiterals.get(node) || null : null;
}

export function clearLiveLiteral(node) {
  liveLiterals.delete(node);
}
