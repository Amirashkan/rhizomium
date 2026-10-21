import { describe, it, expect } from 'vitest';
import { findNumberAt, stepFor, formatNumber } from '../src/ui/components/codeNumberScrub.js';

const at = (text, needle, into = 0) => findNumberAt(text, text.indexOf(needle) + into);

describe('findNumberAt', () => {
  it('finds a float literal under the offset', () => {
    const n = at('sin(input0) * 2.5', '2.5', 1);
    expect(n).toMatchObject({ text: '2.5', value: 2.5, decimals: 1, isFloat: true });
  });

  it('ignores digits inside identifiers and hex literals', () => {
    expect(at('vec3<f32>(input0)', 'input0', 5)).toBeNull();
    expect(at('mat4x4<f32>()', '4x4', 0)).toBeNull();
    expect(at('let a = 0xFFu;', 'FF', 0)).toBeNull();
  });

  it('ignores numbers in line comments', () => {
    expect(at('// Example: sin(input0) * 2.0\ninput0', '2.0')).toBeNull();
  });

  it('takes a unary minus as the sign but not a binary minus', () => {
    expect(at('vec3(-1.5, 0.0, 0.0)', '1.5')).toMatchObject({ text: '-1.5', value: -1.5, canGoNegative: true });
    expect(at('return -2.0;', '2.0')).toMatchObject({ text: '-2.0', value: -2 });
    expect(at('a-0.5', '0.5')).toMatchObject({ text: '0.5', value: 0.5, canGoNegative: false });
    expect(at('x * 3.0', '3.0')).toMatchObject({ canGoNegative: true });
  });

  it('keeps exponent and suffix out of the mantissa', () => {
    expect(at('let k = 1.5e-3f;', '1.5')).toMatchObject({ value: 1.5, decimals: 1, exponent: 'e-3', suffix: 'f' });
    expect(at('let i = 4u;', '4')).toMatchObject({ isFloat: false, suffix: 'u', canGoNegative: false });
  });
});

describe('stepFor', () => {
  it('steps by the last written decimal place', () => {
    expect(stepFor({ decimals: 2, isFloat: true }).step).toBeCloseTo(0.01);
    expect(stepFor({ decimals: 1, isFloat: true }, { coarse: true }).step).toBeCloseTo(1);
    expect(stepFor({ decimals: 1, isFloat: true }, { fine: true })).toMatchObject({ decimals: 2 });
  });

  it('keeps integer literals integral', () => {
    expect(stepFor({ decimals: 0, isFloat: false }, { fine: true })).toEqual({ step: 1, decimals: 0 });
  });
});

describe('formatNumber', () => {
  it('writes the literal in its original style', () => {
    expect(formatNumber(at('x = 1.0;', '1.0'), 1.25, 2)).toBe('1.25');
    expect(formatNumber(at('x = 1.;', '1.'), 2)).toBe('2.');
    expect(formatNumber(at('x = 2;', '2'), 5)).toBe('5');
    expect(formatNumber(at('x = 1.5e-3f;', '1.5'), 1.7)).toBe('1.7e-3f');
  });

  it('crosses zero only where a sign is allowed', () => {
    expect(formatNumber(at('vec2(0.5, 1.0)', '0.5'), -0.2)).toBe('-0.2');
    expect(formatNumber(at('a-0.5', '0.5'), -0.2)).toBe('0.0');
    expect(formatNumber(at('let i = 4u;', '4'), -3)).toBe('0u');
  });

  it('never writes negative zero', () => {
    expect(formatNumber(at('vec2(0.5, 1.0)', '0.5'), -0.0001)).toBe('0.0');
  });
});
