// src/ui/components/codeNumberScrub.js
// Alt+drag "scrubbing" of numeric literals in a code textarea (Custom GLSL editor).
// The text helpers are pure so they can be tested without a DOM.

// One token per match: identifiers (so the digits in vec3/input0/mat4x4 never count as numbers),
// hex literals (matched so their digits are skipped, never scrubbed), then decimal literals with an
// optional exponent and WGSL suffix.
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+[iu]?|(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?([fhiu]?)/g;

// A '-' right before a literal is its sign only when it can't be a binary minus, i.e. when the
// previous non-space character is not the end of an operand. `return` is the one keyword that
// ends in a letter and is still followed by a unary expression.
const OPERAND_END_RE = /[A-Za-z0-9_.)\]]/;

const PX_PER_STEP = 2;

function precedingOperandEnd(text, index) {
  let i = index - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
  if (i < 0 || text[i] === '\n') return false;
  if (!OPERAND_END_RE.test(text[i])) return false;
  return !/(^|[^A-Za-z0-9_])return$/.test(text.slice(Math.max(0, i - 6), i + 1));
}

/**
 * Find the numeric literal covering character `offset` in `text`.
 * Returns null when the offset isn't on a scrubbable number.
 */
export function findNumberAt(text, offset) {
  if (offset < 0 || offset >= text.length) return null;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let lineEnd = text.indexOf('\n', offset);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);

  // Skip comments: a number inside `// ...` is prose, not code.
  const commentAt = line.indexOf('//');

  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const start = lineStart + m.index;
    const end = start + m[0].length;
    if (offset < start) return null;
    if (offset >= end) continue;
    if (!m[1]) return null; // identifier or hex
    if (commentAt !== -1 && m.index >= commentAt) return null;

    const mantissa = m[1];
    const exponent = m[2] || '';
    const suffix = m[3] || '';
    let tokenStart = start;
    let negative = false;
    const signed = !precedingOperandEnd(text, start - (text[start - 1] === '-' ? 1 : 0));
    if (text[start - 1] === '-' && signed) {
      tokenStart = start - 1;
      negative = true;
    }
    const dot = mantissa.indexOf('.');
    return {
      start: tokenStart,
      end,
      text: text.slice(tokenStart, end),
      value: (negative ? -1 : 1) * parseFloat(mantissa),
      decimals: dot === -1 ? 0 : mantissa.length - dot - 1,
      hasDot: dot !== -1,
      exponent,
      suffix,
      isFloat: dot !== -1 || exponent !== '' || suffix === 'f' || suffix === 'h',
      // A literal after an operand (`a - 0.5`, `x*2`) can't take a sign without changing the
      // operator in front of it, and `u` literals are unsigned, so those stop at zero.
      canGoNegative: signed && suffix !== 'u',
    };
  }
  return null;
}

/** Every scrubbable numeric literal in `text`, in order. */
export function findNumbers(text) {
  const tokens = new RegExp(TOKEN_RE.source, 'g');
  const numbers = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    let m;
    while ((m = tokens.exec(line)) !== null) {
      if (!m[1]) continue;
      const number = findNumberAt(text, lineStart + m.index);
      if (number) numbers.push(number);
    }
    lineStart = lineEnd + 1;
  }
  return numbers;
}

/** Step size for a literal: one unit of its last written decimal place. */
export function stepFor(number, { coarse = false, fine = false } = {}) {
  let decimals = number.decimals;
  if (fine && number.isFloat) decimals += 1;
  let step = Math.pow(10, -decimals);
  if (coarse) step *= 10;
  if (!number.isFloat) step = Math.max(1, Math.round(step));
  return { step, decimals: number.isFloat ? decimals : 0 };
}

/** Write `value` back in the literal's own style (decimals, trailing dot, exponent, suffix). */
export function formatNumber(number, value, decimals = number.decimals) {
  const v = number.canGoNegative ? value : Math.max(0, value);
  let body;
  if (!number.isFloat) {
    body = String(Math.round(v));
  } else {
    body = Math.abs(v).toFixed(decimals);
    if (number.hasDot && decimals === 0) body += '.';
    // An f32 written without a dot or suffix would turn into an integer literal.
    if (!body.includes('.') && !number.exponent && !number.suffix) body += '.0';
    // toFixed can round a small negative to "0.00"; don't write "-0.00".
    if (v < 0 && Number(body.replace(/\.$/, '')) !== 0) body = '-' + body;
  }
  if (body === '-0') body = '0';
  return body + number.exponent + number.suffix;
}

/**
 * Map a pointer position to a character offset in a `white-space: pre` monospace textarea.
 * Returns -1 when the point is outside the text.
 */
export function offsetFromPoint(textarea, clientX, clientY) {
  const cs = getComputedStyle(textarea);
  const rect = textarea.getBoundingClientRect();
  const fontSize = parseFloat(cs.fontSize) || 12;
  const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
  const charWidth = measureCharWidth(cs) || fontSize * 0.6;
  const tabSize = parseInt(cs.tabSize, 10) || 2;

  const x = clientX - rect.left - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.paddingLeft) || 0) + textarea.scrollLeft;
  const y = clientY - rect.top - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.paddingTop) || 0) + textarea.scrollTop;
  if (x < 0 || y < 0) return -1;

  const lines = textarea.value.split('\n');
  const row = Math.floor(y / lineHeight);
  if (row >= lines.length) return -1;
  const col = Math.floor(x / charWidth);

  let offset = 0;
  for (let i = 0; i < row; i++) offset += lines[i].length + 1;
  const line = lines[row];
  let visual = 0;
  for (let i = 0; i < line.length; i++) {
    const width = line[i] === '\t' ? tabSize - (visual % tabSize) : 1;
    if (col < visual + width) return offset + i;
    visual += width;
  }
  return -1;
}

let measureCtx = null;
function measureCharWidth(cs) {
  try {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    if (!measureCtx) return 0;
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return measureCtx.measureText('0000000000').width / 10;
  } catch {
    return 0;
  }
}

/**
 * Wire Alt+drag scrubbing onto a code textarea.
 *   onArm() — called when Alt is pressed or held over the editor, ahead of a likely drag
 *   onScrubStart(number) — called on press; return true to receive onLiveValue instead of onPreview
 *   onLiveValue(code, value) — called once per frame with the edited code and the literal's value
 *   onPreview(code) — called (throttled) with the edited code while dragging
 *   onEnd(oldCode, newCode) — called once on release, before onCommit
 *   onCommit(oldCode, newCode) — called once on release if the code changed
 *   refresh() — re-render highlighting/line numbers after the text changes
 */
export function attachNumberScrub(textarea, {
  onArm, onScrubStart, onLiveValue, onPreview, onEnd, onCommit, refresh, previewIntervalMs = 100,
}) {
  const hit = (e) => findNumberAt(textarea.value, offsetFromPoint(textarea, e.clientX, e.clientY));

  // Show the drag cursor while Alt is held over a number.
  textarea.addEventListener('mousemove', (e) => {
    if (textarea._scrubbing) return;
    const overNumber = e.altKey && hit(e);
    textarea.style.cursor = overNumber ? 'ew-resize' : '';
    if (overNumber) onArm?.();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !e.repeat) onArm?.();
  });
  textarea.addEventListener('mouseleave', () => {
    if (!textarea._scrubbing) textarea.style.cursor = '';
  });

  textarea.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !e.altKey || textarea.readOnly || textarea.disabled) return;
    const number = hit(e);
    if (!number) return;

    e.preventDefault();
    e.stopPropagation();

    const originalCode = textarea.value;
    const { selectionStart, selectionEnd } = textarea;
    const prefix = originalCode.slice(0, number.start);
    const suffix = originalCode.slice(number.end);
    let value = number.value;
    let decimals = number.decimals;
    let lastX = e.clientX;
    let pending = 0;
    let lastPreview = 0;
    let previewTimer = null;
    let currentCode = originalCode;
    const live = !!onScrubStart?.(number);

    textarea._scrubbing = true;
    textarea.style.cursor = 'ew-resize';
    document.body.style.cursor = 'ew-resize';
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const flushPreview = () => {
      previewTimer = null;
      lastPreview = performance.now();
      onPreview?.(currentCode);
    };

    const onMove = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      pending += ev.clientX - lastX;
      lastX = ev.clientX;
      const steps = Math.trunc(pending / PX_PER_STEP);
      if (steps === 0) return;
      pending -= steps * PX_PER_STEP;

      const s = stepFor(number, { coarse: ev.shiftKey, fine: ev.ctrlKey || ev.metaKey });
      decimals = Math.max(decimals, s.decimals);
      value += steps * s.step;
      if (!number.canGoNegative && value < 0) value = 0;
      // Round to the written precision so repeated float adds don't drift.
      value = Number(value.toFixed(decimals));

      const text = formatNumber(number, value, decimals);
      const next = prefix + text + suffix;
      if (next === currentCode) return;
      currentCode = next;
      liveText = text;
      // Mouse moves can outpace the display; the text, highlighting and render catch up once a frame.
      if (!frame) frame = requestAnimationFrame(applyFrame);
    };

    let liveText = number.text;
    let frame = 0;
    let appliedCode = originalCode;
    const applyFrame = () => {
      frame = 0;
      if (currentCode === appliedCode) return;
      appliedCode = currentCode;

      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;
      textarea.value = currentCode;
      const shift = currentCode.length - originalCode.length;
      const map = (pos) => (pos >= number.end ? pos + shift : Math.min(pos, number.start + liveText.length));
      textarea.setSelectionRange(map(selectionStart), map(selectionEnd));
      textarea.scrollTop = scrollTop;
      textarea.scrollLeft = scrollLeft;
      refresh?.();

      if (live) {
        onLiveValue?.(currentCode, parseFloat(liveText));
        return;
      }
      const wait = previewIntervalMs - (performance.now() - lastPreview);
      if (wait <= 0) {
        if (previewTimer) clearTimeout(previewTimer);
        flushPreview();
      } else if (!previewTimer) {
        previewTimer = setTimeout(flushPreview, wait);
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      if (frame) cancelAnimationFrame(frame);
      applyFrame();
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = null;
      textarea._scrubbing = false;
      textarea.style.cursor = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = previousUserSelect;
      onEnd?.(originalCode, currentCode);
      if (currentCode !== originalCode) onCommit?.(originalCode, currentCode);
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  });
}
