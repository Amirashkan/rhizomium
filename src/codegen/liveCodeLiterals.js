// src/codegen/liveCodeLiterals.js
// Alt-dragging a number in the Custom GLSL editor must not recompile the shader per step (a rebuild
// per step dropped the editor under 5 fps). Once a node is armed for dragging, each numeric literal
// in its body compiles as a uniform holding the literal's value, so a drag is a buffer write. The
// arming holds for as long as the code keeps the same shape around those literals — the
// "skeleton" — and the values are always read from the code itself, so a compile of the same code
// produces the same picture whether it is armed or not.
// Kept in WeakMaps rather than on the node so it never reaches a save file or a clone.

import { findNumbers } from '../ui/components/codeNumberScrub.js';

export const LIVE_LITERAL_PARAM_PREFIX = 'liveLiteral';

// Beyond this a body keeps its literals baked; the drag falls back to throttled recompiles.
export const MAX_LIVE_LITERALS = 256;

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+[iu]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fhiu]?|<<=|>>=|\+\+|--|<=|>=|==|!=|&&|\|\||<<|>>|->|[-+*/%&|^]=|\S/g;
const PLAIN_INT_RE = /^\d+$/;
// Operators whose two sides share one type, so an abstract integer takes the type of the other side.
const SAME_TYPE_OPS = new Set([
  '+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!=', '&', '|', '^',
  '=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
]);
const INT_TYPES = new Set(['i32', 'u32']);

function tokenize(code) {
  // Comments become blanks so offsets still line up with the code.
  const text = code.replace(/\/\/[^\n]*/g, (c) => ' '.repeat(c.length));
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) tokens.push({ text: m[0], start: m.index });
  return tokens;
}

// Names the body declares as integers: `: i32`, `= i32(...)`, `= 0` (an abstract integer makes a
// `let`/`var` an i32 — that is how every loop counter is written), or anything incremented.
function integerNames(tokens) {
  const names = new Map();
  tokens.forEach((t, i) => {
    if ((t.text === '++' || t.text === '--') && /^[A-Za-z_]/.test(tokens[i - 1]?.text || '')) {
      names.set(tokens[i - 1].text, 'i32');
    }
    if (t.text !== 'let' && t.text !== 'var') return;
    const name = tokens[i + 1]?.text;
    if (!name || !/^[A-Za-z_]/.test(name)) return;
    const after = tokens[i + 2]?.text;
    if (after === ':') {
      if (INT_TYPES.has(tokens[i + 3]?.text)) names.set(name, tokens[i + 3].text);
      return;
    }
    if (after !== '=') return;
    let j = i + 3;
    if (INT_TYPES.has(tokens[j]?.text) && tokens[j + 1]?.text === '(') {
      names.set(name, tokens[j].text);
      return;
    }
    if (tokens[j]?.text === '-') j++;
    if (PLAIN_INT_RE.test(tokens[j]?.text || '') && [';', ')', undefined].includes(tokens[j + 1]?.text)) {
      names.set(name, 'i32');
    }
  });
  return names;
}

// The integer type an operand token says it has, or null.
function operandIntType(tokens, i, names) {
  const t = tokens[i];
  if (!t) return null;
  if (names.has(t.text) && tokens[i + 1]?.text !== '(') return names.get(t.text);
  const suffixed = /^\d+([iu])$/.exec(t.text);
  if (suffixed) return suffixed[1] === 'i' ? 'i32' : 'u32';
  if (t.text === ')') {
    // `i32(x) * 2`: walk back to the call this paren closes.
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      if (tokens[j].text === ')') depth++;
      else if (tokens[j].text === '(' && --depth === 0) {
        const callee = tokens[j - 1]?.text;
        return INT_TYPES.has(callee) ? callee : null;
      }
    }
  }
  return null;
}

// What an unsuffixed integer literal is in its context: 'i32'/'u32'/'f32', or null when it has to
// stay a literal (a `case` selector or an `array<f32, 4>` size must be a constant).
function abstractIntCast(tokens, k, signed, names) {
  const p = signed ? k - 2 : k - 1;
  const prev = tokens[p]?.text;
  const next = tokens[k + 1]?.text;
  if (prev === 'case' || (prev === ',' && next === '>')) return null;
  if (prev === '=' && (tokens[p - 2]?.text === 'let' || tokens[p - 2]?.text === 'var')) {
    if ([';', ')', undefined].includes(next)) return 'i32'; // `var i = 0;` — the literal makes the type
  }
  if (prev === '=' && tokens[p - 2]?.text === ':') {
    const declared = tokens[p - 1]?.text;
    if (declared === 'f32' || INT_TYPES.has(declared)) return declared;
  }
  if (prev === '[' || next === ']') return 'i32';
  if (prev === '<<' || prev === '>>' || prev === '<<=' || prev === '>>=') return 'u32';
  if (SAME_TYPE_OPS.has(prev)) {
    const type = operandIntType(tokens, p - 1, names);
    if (type) return type;
  }
  if (SAME_TYPE_OPS.has(next) && next !== '=') {
    const type = operandIntType(tokens, k + 2, names);
    if (type) return type;
  }
  return 'f32';
}

/**
 * The literals of `code` that can be read from a uniform (with the WGSL type each reads as), plus
 * the code with them cut out. Unsuffixed integers are typed from their context; `ints: false`
 * leaves them baked. Returns null when there are none, or too many.
 */
export function scanLiveLiterals(code, { ints = true } = {}) {
  const tokens = tokenize(code);
  const tokenAt = new Map(tokens.map((t, i) => [t.start, i]));
  const names = ints ? integerNames(tokens) : null;
  const literals = [];
  for (const number of findNumbers(code)) {
    if (number.suffix === 'h') continue;
    const lineStart = code.lastIndexOf('\n', number.start - 1) + 1;
    if (/\b(const|override)\b/.test(code.slice(lineStart, number.start))) continue;
    let cast;
    if (number.isFloat) cast = 'f32';
    else if (number.suffix) cast = number.suffix === 'i' ? 'i32' : 'u32';
    else if (ints) {
      const signed = number.text.startsWith('-');
      const k = tokenAt.get(number.start + (signed ? 1 : 0));
      cast = k === undefined ? null : abstractIntCast(tokens, k, signed, names);
    }
    if (cast) literals.push({ ...number, cast });
  }
  if (literals.length === 0 || literals.length > MAX_LIVE_LITERALS) return null;
  let skeleton = '';
  let at = 0;
  for (const literal of literals) {
    skeleton += code.slice(at, literal.start) + '\u0000';
    at = literal.end;
  }
  skeleton += code.slice(at);
  return { skeleton, literals, ints };
}

const armed = new WeakMap(); // node -> { skeleton, ints }
const rejectedInts = new WeakMap(); // node -> skeleton whose integer typing failed to compile

/**
 * Arm `node` for `code` and return the scan its literals will compile from, or null when nothing
 * in it can be live. Integers are left out for a shape whose integer typing already failed.
 */
export function armLiveLiterals(node, code) {
  let scan = scanLiveLiterals(code);
  if (scan && rejectedInts.get(node) === scan.skeleton) scan = scanLiveLiterals(code, { ints: false });
  if (!scan) {
    armed.delete(node);
    return null;
  }
  armed.set(node, { skeleton: scan.skeleton, ints: scan.ints });
  return scan;
}

/** The scan to compile `code` with, or null when the node isn't armed for code of this shape. */
export function liveLiteralsFor(node, code) {
  const entry = node ? armed.get(node) : undefined;
  if (!entry) return null;
  const scan = scanLiveLiterals(code, { ints: entry.ints });
  return scan && scan.skeleton === entry.skeleton ? scan : null;
}

/**
 * The armed shader failed to compile: if integers were part of it, re-arm without them (the
 * guess at their types is the one part that can be wrong) and return the new scan. Returns
 * undefined when there was nothing to take back.
 */
export function rejectLiveIntegers(node, code) {
  const entry = armed.get(node);
  if (!entry?.ints || entry.skeleton !== scanLiveLiterals(code)?.skeleton) return undefined;
  rejectedInts.set(node, entry.skeleton);
  return armLiveLiterals(node, code);
}

export function disarmLiveLiterals(node) {
  armed.delete(node);
}
