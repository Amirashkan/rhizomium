import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluateExpressionSafely, getNumericParam, PREVIEW_TIME } from '../src/utils/safeExpression.js';
import { TextureRenderers } from '../src/core/preview/renderers/TextureRenderers.js';
import { BasicRenderers } from '../src/core/preview/renderers/BasicRenderers.js';

/**
 * Patches are traded: publish.js uploads a `.rz` alongside the artwork so a
 * visitor can download the source and reopen it here. That makes every
 * `node.params` string untrusted input, and preview code used to hand it to
 * eval()/new Function(). These tests pin the expression path shut.
 */

// Expressions that were live code-execution payloads against the old
// eval()-based evaluators. Each stays syntactically plausible so it would have
// sailed through the `/\btime\b/` gate the renderers used as their only filter.
const PAYLOADS = [
  'time + (globalThis.__pwned = 1, 0)',
  'time; globalThis.__pwned = 1',
  'time + self.fetch("https://attacker.example")',
  'time + globalThis.constructor.constructor("globalThis.__pwned = 1")()',
  'time + top.location.assign("https://attacker.example")',
  'time + localStorage.getItem("x").length',
  '(() => { globalThis.__pwned = 1; return 1; })()',
  'time.constructor.constructor("globalThis.__pwned = 1")()',
];

describe('patch expressions cannot execute code', () => {
  beforeEach(() => {
    delete globalThis.__pwned;
  });

  afterEach(() => {
    delete globalThis.__pwned;
  });

  it.each(PAYLOADS)('refuses to run: %s', (payload) => {
    const result = evaluateExpressionSafely(payload, { time: PREVIEW_TIME }, -1);

    expect(globalThis.__pwned).toBeUndefined();
    // Rejected expressions fall back rather than returning an attacker's value.
    expect(result).toBe(-1);
  });

  it.each(PAYLOADS)('TextureRenderers.getParameterValue is inert for: %s', (payload) => {
    const renderers = new TextureRenderers({ size: 32 });
    const node = { params: { radius: payload } };

    const value = renderers.getParameterValue(node, 'radius', 0.25);

    expect(globalThis.__pwned).toBeUndefined();
    expect(value).toBe(0.25);
  });

  it.each(PAYLOADS)('BasicRenderers._evaluateExpression is inert for: %s', (payload) => {
    const renderers = new BasicRenderers({ size: 32 });

    const value = renderers._evaluateExpression(payload, { time: PREVIEW_TIME, x: 1 });

    expect(globalThis.__pwned).toBeUndefined();
    expect(value).toBe(0);
  });

  it('does not reach identifiers outside the supplied scope', () => {
    globalThis.__secret = 42;
    try {
      expect(evaluateExpressionSafely('__secret', {}, -1)).toBe(-1);
    } finally {
      delete globalThis.__secret;
    }
  });

  it('rejects calls to functions outside the builtin math table', () => {
    expect(evaluateExpressionSafely('fetch(1)', {}, -1)).toBe(-1);
    expect(evaluateExpressionSafely('alert(1)', {}, -1)).toBe(-1);
  });
});

describe('legitimate expressions still evaluate', () => {
  it('evaluates arithmetic', () => {
    expect(evaluateExpressionSafely('2 + 3 * 4', {}, -1)).toBe(14);
  });

  it('evaluates math builtins against the scope', () => {
    expect(evaluateExpressionSafely('sin(time)', { time: Math.PI / 2 }, -1)).toBeCloseTo(1);
    expect(evaluateExpressionSafely('max(a, b)', { a: 3, b: 7 }, -1)).toBe(7);
    expect(evaluateExpressionSafely('clamp(5, 0, 1)', {}, -1)).toBe(1);
  });

  it('accepts a leading "=" the way stored parameters carry it', () => {
    expect(evaluateExpressionSafely('=1 + 1', {}, -1)).toBe(2);
  });

  it('resolves PI', () => {
    expect(evaluateExpressionSafely('PI', {}, -1)).toBeCloseTo(Math.PI);
  });
});

describe('getNumericParam', () => {
  it('passes numbers through', () => {
    expect(getNumericParam({ params: { r: 0.5 } }, 'r', 0.25)).toBe(0.5);
  });

  it('parses numeric strings', () => {
    expect(getNumericParam({ params: { r: '0.75' } }, 'r', 0.25)).toBe(0.75);
  });

  it('evaluates expression strings against the scope', () => {
    expect(getNumericParam({ params: { r: 'sin(time)' } }, 'r', 0.25, { time: Math.PI / 2 })).toBeCloseTo(1);
  });

  it('falls back for missing, non-finite and unusable params', () => {
    expect(getNumericParam({ params: {} }, 'r', 0.25)).toBe(0.25);
    expect(getNumericParam({ params: { r: NaN } }, 'r', 0.25)).toBe(0.25);
    expect(getNumericParam({ params: { r: {} } }, 'r', 0.25)).toBe(0.25);
    expect(getNumericParam(null, 'r', 0.25)).toBe(0.25);
  });
});
