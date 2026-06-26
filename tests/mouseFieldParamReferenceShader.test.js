// Regression test: a Mouse (or Time/RandomTime) node referenced by a Field node's parameter
// (e.g. a Circle's radius = "=node_28_x") must resolve to the live GPU global, produce valid
// scalar WGSL, and never emit an undefined identifier — including while the reference is still
// being typed.
//
// Bugs fixed:
//  1. FieldNodes.getParam resolved node references via the ambient window.editor.graph, which is
//     absent in the external viewer / studio context, so the reference fell through to the
//     generator's passthrough -> "unresolved value 'node_28'".
//  2. A Mouse node is a vec4 (g.mouse); referenced bare into an f32 radius it produced a
//     "type mismatch ... expected 'f32', got 'vec4<f32>'". Shape params are scalar, so a Mouse
//     reference now maps to a single channel (default .x).
//  3. While typing (e.g. "=node_2" on the way to "=node_28"), the incomplete reference named a
//     node that does not exist yet and was emitted verbatim, spamming WGSL parse errors on every
//     keystroke. Unknown references now fall back to the parameter default.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function buildCircleRadiusCall(radiusExpr) {
  const graph = {
    nodes: [
      { id: '28', kind: 'Mouse', params: {}, inputs: [] },
      { id: '27', kind: 'Circle', params: { centerX: 0.5, centerY: 0.5, radius: radiusExpr, epsilon: 0.01 }, inputs: [] },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['27'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : result.wgsl;
  return code.split('\n').find((l) => l.includes('let node_27 = shape_circle_27'));
}

describe('Mouse node reference in a Circle parameter (no window.editor / studio context)', () => {
  beforeEach(() => {
    // Simulate the external viewer / studio page where window.editor is not set.
    delete window.editor;
  });

  it('resolves a component reference (=node_28_x) to the matching g.mouse channel', () => {
    const line = buildCircleRadiusCall('=node_28_x');
    expect(line).toContain('g.mouse.x');
    expect(line).not.toContain('node_28_x');
  });

  it('reduces a bare Mouse reference (=node_28) to a single scalar channel, not a vec4', () => {
    const line = buildCircleRadiusCall('=node_28');
    expect(line).toContain('g.mouse.x');
    // The whole vec4 (bare g.mouse) must not be passed into the f32 radius slot.
    expect(line).not.toMatch(/\(g\.mouse\)/);
    expect(line).not.toMatch(/\(node_28\)/);
  });

  it('resolves a Mouse reference inside an arithmetic expression', () => {
    const line = buildCircleRadiusCall('=node_28_y * 0.5');
    expect(line).toContain('g.mouse.y');
    expect(line).not.toMatch(/\bnode_28\b/);
  });

  it('falls back to the default for an incomplete reference being typed (=node_2)', () => {
    // Only node 28 exists; "=node_2" is a half-typed id and must not reach the shader.
    const line = buildCircleRadiusCall('=node_2');
    expect(line).not.toMatch(/node_2\b/);
    expect(line).toContain('0.25'); // Circle radius default
  });

  it('resolves an incomplete suffix (=node_28_) to the default channel without crashing', () => {
    const line = buildCircleRadiusCall('=node_28_');
    expect(line).toContain('g.mouse.x');
    expect(line).not.toMatch(/\(node_28_\)/);
  });
});
