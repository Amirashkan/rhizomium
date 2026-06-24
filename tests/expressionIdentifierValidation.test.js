// Regression tests for unknown identifiers in parameter expressions.
//
// Background: a parameter expression like "=1+sin(time)*2" is compiled to WGSL by
// UnifiedExpressionSystem. An unknown identifier (e.g. the typo "tim" for "time")
// used to be emitted verbatim, producing `sin(tim)` — invalid WGSL that fails the
// ENTIRE shader module and floods the console with WebGPU validation errors, so the
// whole render goes black. The shader generator now rejects unknown identifiers and
// falls back to "0.0", matching the CPU evaluator, so one bad expression only zeroes
// its own parameter.

import { describe, it, expect } from 'vitest';
import { UnifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';

describe('expression identifier validation', () => {
  const sys = new UnifiedExpressionSystem();

  it('a typo identifier falls back to 0.0 instead of emitting broken WGSL', () => {
    expect(sys.generateShader('=1+sin(tim)*2')).toBe('0.0');
  });

  it('a valid time expression still compiles to the GPU clock', () => {
    expect(sys.generateShader('=1+sin(time)*2')).toBe('(1.0 + (sin(g.time) * 2.0))');
  });

  it('audioEnvelope keeps working', () => {
    expect(sys.generateShader('=audioEnvelope*5')).toBe('(g.audioEnvelope * 5.0)');
  });

  it('node_<id> references are still passed through verbatim', () => {
    expect(sys.generateShader('=node_5*2')).toBe('(node_5 * 2.0)');
  });

  it('a caller-provided variable mapping is still honored', () => {
    expect(sys.generateShader('=node_5+1', { node_5: 'g.time' })).toBe('(g.time + 1.0)');
  });

  it('built-in constants keep working', () => {
    expect(sys.generateShader('=PI')).toBe('3.14159265359');
  });
});
