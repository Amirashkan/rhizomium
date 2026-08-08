// Codegen tests for the boolean logic gates (AND / OR / XOR / NOT / NAND / NOR / XNOR).
//
// The gates threshold their inputs into 0/1 masks and emit branch-free arithmetic, so the same
// expression is valid for f32 and vecN. These tests pin down the emitted WGSL: that each gate
// implements its truth table, that a scalar B input is widened to a vec3 A input (a width mismatch
// would invalidate the whole shader module), and that the output stays 0.0/1.0.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

// Node 1/2 are scalar producers, node 3 is a vec3 producer, node 10 is the gate under test.
function buildGate(kind, inputs, params = {}) {
  const graph = {
    nodes: [
      { id: '1', kind: 'ConstFloat', params: { value: 1.0 }, inputs: [] },
      { id: '2', kind: 'ConstFloat', params: { value: 0.0 }, inputs: [] },
      { id: '3', kind: 'Combine3', params: {}, inputs: [] },
      { id: '10', kind, params, inputs },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['10'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : result.wgsl || result.code || result.shader;
  return code.split('\n').filter((l) => l.includes('_10'));
}

function gateLine(lines) {
  return lines.find((l) => l.includes('let node_10 ='));
}

describe('boolean logic gate codegen', () => {
  beforeEach(() => {
    delete window.editor;
    delete window.nodeCompiler;
  });

  it('thresholds both inputs into 0/1 masks', () => {
    const lines = buildGate('And', ['1', '2']);
    expect(lines.some((l) => /let logicA_10 = step\(.*node_1\)/.test(l))).toBe(true);
    expect(lines.some((l) => /let logicB_10 = step\(.*node_2\)/.test(l))).toBe(true);
  });

  it('emits the branch-free form of each truth table', () => {
    expect(gateLine(buildGate('And', ['1', '2']))).toContain('logicA_10 * logicB_10');
    expect(gateLine(buildGate('Or', ['1', '2']))).toContain('max(logicA_10, logicB_10)');
    expect(gateLine(buildGate('Xor', ['1', '2']))).toContain('abs(logicA_10 - logicB_10)');
    expect(gateLine(buildGate('Nand', ['1', '2']))).toContain('1.0 - (logicA_10 * logicB_10)');
    expect(gateLine(buildGate('Nor', ['1', '2']))).toContain('1.0 - max(logicA_10, logicB_10)');
    expect(gateLine(buildGate('Xnor', ['1', '2']))).toContain('1.0 - abs(logicA_10 - logicB_10)');
    expect(gateLine(buildGate('Not', ['1']))).toContain('1.0 - logicA_10');
  });

  it('widens a scalar B to the vec3 A width so the gate stays uniform', () => {
    const lines = buildGate('And', ['3', '1']);
    // A is the vec3 producer, B is scalar and must be widened before thresholding.
    expect(lines.some((l) => l.includes('let logicB_10 = step(vec3<f32>(') && l.includes('vec3<f32>(node_1)'))).toBe(true);
    // The one() used by the complement gates follows the same width.
    expect(gateLine(buildGate('Nand', ['3', '1']))).toContain('vec3(1.0) - ');
  });

  it('narrows a vec3 B to a scalar A width', () => {
    const lines = buildGate('And', ['1', '3']);
    expect(lines.some((l) => l.includes('let logicB_10 = step(') && !l.includes('vec3<f32>(node_3)'))).toBe(true);
  });

  it('treats an unconnected input as false', () => {
    const lines = buildGate('And', ['1', null]);
    expect(lines.some((l) => /let logicB_10 = step\([^)]*, 0\.0\)/.test(l))).toBe(true);
  });

  it('emits the threshold as a float, never an integer literal', () => {
    // A whole-number threshold must not reach WGSL as "1" -- step(1, f32) does not compile.
    const lines = buildGate('And', ['1', '2'], { threshold: 1 });
    const maskLine = lines.find((l) => l.includes('let logicA_10 ='));
    expect(maskLine).not.toMatch(/step\(1,/);
  });
});

// The CPU preview must agree with the shader, otherwise a gate's pin readout and thumbnail
// contradict what is actually rendered.
describe('boolean logic gate CPU preview', () => {
  function gateValue(kind, a, b, params = {}) {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', inputs: [], params: { value: a } },
        { id: '2', kind: 'ConstFloat', inputs: [], params: { value: b } },
        { id: '10', kind, inputs: ['1', '2'], params },
      ],
      connections: [],
    };
    const computer = new PreviewComputer();
    computer.computePreviews(graph);
    return computer.lastComputedValues.get('10');
  }

  const truthTable = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ];

  const expected = {
    And:  [0, 0, 0, 1],
    Or:   [0, 1, 1, 1],
    Xor:  [0, 1, 1, 0],
    Nand: [1, 1, 1, 0],
    Nor:  [1, 0, 0, 0],
    Xnor: [1, 0, 0, 1],
  };

  for (const [kind, outputs] of Object.entries(expected)) {
    it(`${kind} matches its truth table`, () => {
      truthTable.forEach(([a, b], i) => {
        expect(gateValue(kind, a, b)).toBe(outputs[i]);
      });
    });
  }

  it('NOT inverts its single input', () => {
    expect(gateValue('Not', 0, 0)).toBe(1);
    expect(gateValue('Not', 1, 0)).toBe(0);
  });

  it('honours the threshold parameter', () => {
    // 0.4 is false at the default 0.5 threshold but true once the threshold drops to 0.3.
    expect(gateValue('And', 0.4, 1)).toBe(0);
    expect(gateValue('And', 0.4, 1, { threshold: 0.3 })).toBe(1);
  });
});
