// The Wave input node: a free-running LFO whose curve has to read the same on the GPU, in the
// node's own preview, and in the CPU signal evaluators that feed Hold / Count / Trigger. All three
// go through src/core/waveform.js, so these tests pin the maths there and check each consumer
// actually uses it.

import { describe, it, expect } from 'vitest';
import {
  WAVE_SHAPES,
  DEFAULT_WAVE_SHAPE,
  buildWaveExpression,
  evaluateWave,
  isWaveUnipolar,
} from '../src/core/waveform.js';
import { InputNodes as InputNodeCompiler } from '../src/codegen/compilers/InputNodes.js';
import { NodeDefs, makeNode } from '../src/data/NodeDefs.js';

describe('Wave node definition', () => {
  it('is a parameter-only Input node with a single f32 output', () => {
    const def = NodeDefs.Wave;
    expect(def.cat).toBe('Input');
    expect(def.inputs).toBe(0);
    expect(def.pinsOut).toEqual([{ label: 'out', type: 'f32' }]);
  });

  it('offers every waveform in the shape dropdown', () => {
    const shape = NodeDefs.Wave.params.find(p => p.name === 'shape');
    expect(shape.type).toBe('select');
    expect(shape.options).toEqual(WAVE_SHAPES);
    expect(shape.default).toBe(DEFAULT_WAVE_SHAPE);
  });

  it('dims Pulse Width unless the shape is Square (it has no meaning otherwise)', () => {
    const pulseWidth = NodeDefs.Wave.params.find(p => p.name === 'pulseWidth');
    expect(pulseWidth.activeWhen).toEqual({ shape: 'Square' });
  });

  it('makes a node that oscillates out of the box', () => {
    const node = makeNode('Wave', 0, 0);
    expect(node.params.shape).toBe('Sine');
    expect(node.params.frequency).toBe(1.0);
    expect(node.params.amplitude).toBe(1.0);
  });
});

describe('waveform maths', () => {
  const at = (shape, time, extra = {}) => evaluateWave({ shape, time, ...extra });

  it('runs a sine over one cycle per second at the default frequency', () => {
    expect(at('Sine', 0)).toBeCloseTo(0, 6);
    expect(at('Sine', 0.25)).toBeCloseTo(1, 6);
    expect(at('Sine', 0.5)).toBeCloseTo(0, 6);
    expect(at('Sine', 0.75)).toBeCloseTo(-1, 6);
    expect(at('Sine', 1)).toBeCloseTo(0, 6);
  });

  it('phase-aligns triangle and square with the sine', () => {
    // Zero rising at the start, peak at a quarter, trough at three quarters — so switching shape
    // keeps the motion in step rather than jumping.
    expect(at('Triangle', 0)).toBeCloseTo(0, 6);
    expect(at('Triangle', 0.25)).toBeCloseTo(1, 6);
    expect(at('Triangle', 0.5)).toBeCloseTo(0, 6);
    expect(at('Triangle', 0.75)).toBeCloseTo(-1, 6);

    // Square is high exactly while the sine is positive at the default 0.5 duty.
    expect(at('Square', 0.1)).toBe(1);
    expect(at('Square', 0.4)).toBe(1);
    expect(at('Square', 0.6)).toBe(-1);
    expect(at('Square', 0.9)).toBe(-1);
  });

  it('ramps saw and ramp-down across the full cycle in opposite directions', () => {
    expect(at('Saw', 0)).toBeCloseTo(-1, 6);
    expect(at('Saw', 0.5)).toBeCloseTo(0, 6);
    expect(at('Saw', 0.999)).toBeCloseTo(1, 2);

    expect(at('Ramp Down', 0)).toBeCloseTo(1, 6);
    expect(at('Ramp Down', 0.5)).toBeCloseTo(0, 6);
    expect(at('Ramp Down', 0.999)).toBeCloseTo(-1, 2);
  });

  it('narrows the square with pulse width', () => {
    expect(at('Square', 0.2, { pulseWidth: 0.25 })).toBe(1);
    expect(at('Square', 0.3, { pulseWidth: 0.25 })).toBe(-1);
  });

  it('scales frequency and shifts phase in cycles, not radians', () => {
    // 2 Hz reaches the sine peak in half the time.
    expect(evaluateWave({ shape: 'Sine', time: 0.125, frequency: 2 })).toBeCloseTo(1, 6);
    // A quarter-cycle phase offset makes the sine start at its peak — the cos of a quadrature pair.
    expect(evaluateWave({ shape: 'Sine', time: 0, phase: 0.25 })).toBeCloseTo(1, 6);
  });

  it('remaps to 0..1 BEFORE amplitude and offset when unipolar', () => {
    expect(evaluateWave({ shape: 'Sine', time: 0.25, unipolar: true })).toBeCloseTo(1, 6);
    expect(evaluateWave({ shape: 'Sine', time: 0.75, unipolar: true })).toBeCloseTo(0, 6);
    expect(evaluateWave({ shape: 'Sine', time: 0, unipolar: true })).toBeCloseTo(0.5, 6);
    // Amplitude still reads as the peak in either mode.
    expect(
      evaluateWave({ shape: 'Sine', time: 0.25, unipolar: true, amplitude: 3, offset: 2 })
    ).toBeCloseTo(5, 6);
  });

  it('applies amplitude and offset to the bipolar wave', () => {
    expect(evaluateWave({ shape: 'Sine', time: 0.25, amplitude: 0.5, offset: 1 })).toBeCloseTo(1.5, 6);
    expect(evaluateWave({ shape: 'Sine', time: 0.75, amplitude: 0.5, offset: 1 })).toBeCloseTo(0.5, 6);
  });

  it('accepts a shape however it is spelled in the dropdown', () => {
    expect(evaluateWave({ shape: 'Ramp Down', time: 0 })).toBeCloseTo(1, 6);
    expect(evaluateWave({ shape: 'rampdown', time: 0 })).toBeCloseTo(1, 6);
    // An unknown/missing shape falls back to the sine rather than producing nothing.
    expect(evaluateWave({ shape: undefined, time: 0.25 })).toBeCloseTo(1, 6);
  });

  it('reads the unipolar flag whether it is stored as a bool or as text', () => {
    expect(isWaveUnipolar({ params: { unipolar: true } })).toBe(true);
    expect(isWaveUnipolar({ params: { unipolar: 'true' } })).toBe(true);
    expect(isWaveUnipolar({ params: { unipolar: false } })).toBe(false);
    expect(isWaveUnipolar({ params: {} })).toBe(false);
  });
});

describe('Wave node codegen', () => {
  const compiler = new InputNodeCompiler();

  it('handles the Wave kind', () => {
    expect(compiler.handles('Wave')).toBe(true);
  });

  it('drives the wave off g.time with every varying param as a live uniform', () => {
    // getParam registers numeric params as uniforms, so dragging Frequency doesn't recompile.
    const node = { id: '7', kind: 'Wave', params: { shape: 'Sine', frequency: 2 } };
    const getParam = (name) => `u_params._7_${name}`;
    const result = compiler.compile(node, () => null, getParam);
    expect(result.outputType).toBe('f32');
    expect(result.line).toBe(
      'let node_7 = ((sin(6.283185307179586 * (fract((g.time) * (u_params._7_frequency) + (u_params._7_phase))))) * (u_params._7_amplitude) + (u_params._7_offset));'
    );
  });

  it('bakes numeric params when no uniform registration is available', () => {
    const node = { id: '8', kind: 'Wave', params: { shape: 'Saw', frequency: 2 } };
    const result = compiler.compile(node, () => null, null);
    expect(result.line).toContain('2.000000');
    expect(result.line).toContain('2.0 * (fract(');
  });

  it('emits the selected shape rather than branching at runtime', () => {
    const shapeLine = (shape, params = {}) => {
      const node = { id: '1', kind: 'Wave', params: { shape, ...params } };
      return compiler.compile(node, () => null, null).line;
    };
    expect(shapeLine('Sine')).toContain('sin(');
    expect(shapeLine('Triangle')).toContain('abs(fract(');
    expect(shapeLine('Square')).toContain('select(-1.0, 1.0,');
    expect(shapeLine('Saw')).toContain('2.0 * (fract(');
    expect(shapeLine('Ramp Down')).toContain('1.0 - 2.0 * (fract(');
    // No dynamic dispatch: picking one shape must not emit another's formula.
    expect(shapeLine('Square')).not.toContain('sin(');
  });

  it('emits the 0..1 remap only when Unipolar is on', () => {
    const bipolar = compiler.compile({ id: '2', kind: 'Wave', params: {} }, () => null, null).line;
    const unipolar = compiler.compile(
      { id: '2', kind: 'Wave', params: { unipolar: true } }, () => null, null
    ).line;
    expect(bipolar).not.toContain('* 0.5 + 0.5');
    expect(unipolar).toContain('* 0.5 + 0.5');
  });

  it('inlines an expression param instead of registering a uniform for it', () => {
    // `=...` params can reference other nodes, so they are resolved at compile time.
    const node = { id: '4', kind: 'Wave', params: { frequency: '=time', amplitude: 2 } };
    const result = compiler.compile(node, () => null, (name) => `u_params._4_${name}`);
    // frequency became the live clock, while the plain numeric amplitude stayed a uniform.
    expect(result.line).toContain('(g.time) * (g.time)');
    expect(result.line).not.toContain('u_params._4_frequency');
    expect(result.line).toContain('u_params._4_amplitude');
  });
});

describe('shader and CPU agreement', () => {
  // The whole point of sharing waveform.js: the expression the GPU runs and the number the node's
  // readout shows must be the same curve. Evaluate the emitted WGSL as JS (the operators and the
  // functions used — sin/fract/abs/select — all have direct equivalents) and compare.
  const evalWgsl = (expr, time) => {
    const fract = (x) => x - Math.floor(x);
    const select = (whenFalse, whenTrue, cond) => (cond ? whenTrue : whenFalse);
    return new Function('g', 'fract', 'select', 'sin', 'abs', `return ${expr};`)(
      { time }, fract, select, Math.sin, Math.abs
    );
  };

  for (const shape of WAVE_SHAPES) {
    it(`matches between GPU and CPU for ${shape}`, () => {
      const params = { frequency: '1.7', phase: '0.3', amplitude: '2.0', offset: '0.5', pulseWidth: '0.35' };
      const expr = buildWaveExpression({ shape, ...params });
      for (const time of [0, 0.1, 0.33, 0.5, 0.87, 1.4, 3.75]) {
        const gpu = evalWgsl(expr, time);
        const cpu = evaluateWave({
          shape,
          time,
          frequency: 1.7,
          phase: 0.3,
          amplitude: 2.0,
          offset: 0.5,
          pulseWidth: 0.35,
        });
        expect(gpu).toBeCloseTo(cpu, 6);
      }
    });
  }
});
