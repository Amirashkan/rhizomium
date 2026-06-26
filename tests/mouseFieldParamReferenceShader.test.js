// Regression test: a Mouse (or Time/RandomTime) node referenced by a Field node's parameter
// (e.g. a Circle's radius = "=node_28_x") must resolve to the live GPU global (g.mouse.x),
// not be emitted verbatim as an undefined identifier.
//
// Bug: FieldNodes.getParam resolved node references via the ambient window.editor.graph. In the
// external viewer / studio context window.editor is absent, so the reference fell through to the
// generator's passthrough and produced WGSL like `shape_circle_27(..., (node_28_x), ...)`, failing
// the whole shader module with "unresolved value 'node_28'". The radius then read as 0.00.
//
// Fix: the graph being compiled is threaded into the compilers (NodeCompiler.compileNodes -> each
// compiler's setGraph), so generateShader resolves input-node references off that graph regardless
// of window.editor.

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

  it('resolves a bare reference (=node_28) to the whole g.mouse global, not an undefined identifier', () => {
    const line = buildCircleRadiusCall('=node_28');
    expect(line).toContain('g.mouse');
    expect(line).not.toMatch(/\(node_28\)/);
  });

  it('resolves a Mouse reference inside an arithmetic expression', () => {
    const line = buildCircleRadiusCall('=node_28_y * 0.5');
    expect(line).toContain('g.mouse.y');
    expect(line).not.toMatch(/\bnode_28\b/);
  });
});
