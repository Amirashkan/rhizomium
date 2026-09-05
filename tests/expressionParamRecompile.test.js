import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExpressionParameterValueManager, expressionSystem } from '../src/utils/ParameterExpressionSystem.js';

// A parameter that holds an expression is INLINED into the generated WGSL (a Rectangle width of
// `=node_5 == 0 ? 0.5 : 0` compiles to a `select(...)` reading node_5's variable), unlike a plain
// number, which rides in as a live uniform. So a write that adds, removes, or edits an expression
// has to recompile the shader — otherwise the parameter panel's evaluated readout moves while the
// render stays on the previously generated code. Numeric writes must NOT recompile: they are
// uniforms already, and rebuilding on each one would stall MIDI/OSC and slider drags.

function makeNode(params = {}) {
  return { id: '7', kind: 'Rectangle', params: { ...params }, inputs: [] };
}

describe('ExpressionParameterValueManager.setValue shader recompilation', () => {
  let manager;
  let reasons;
  let previousEditor;

  beforeEach(() => {
    previousEditor = window.editor;
    reasons = [];
    window.editor = { onChange: (reason) => reasons.push(reason) };
    manager = new ExpressionParameterValueManager(
      { nodes: [] }, null, null, expressionSystem
    );
  });

  afterEach(() => {
    window.editor = previousEditor;
  });

  it('recompiles when a numeric parameter is replaced by an expression', () => {
    const node = makeNode({ width: 0.5 });

    manager.setValue(node, 'width', '=node_5 == 0 ? 0.5 : 0');

    expect(node.params.width).toBe('=node_5 == 0 ? 0.5 : 0');
    expect(reasons).toHaveLength(1);
  });

  it('recompiles when one expression is edited into another', () => {
    const node = makeNode({ width: '=node_5' });

    manager.setValue(node, 'width', '=node_5 == 0 ? 0.5 : 0');

    expect(reasons).toHaveLength(1);
  });

  it('recompiles when an expression is replaced by a plain number', () => {
    const node = makeNode({ width: '=node_5 == 0 ? 0.5 : 0' });

    manager.setValue(node, 'width', '0.25');

    expect(reasons).toHaveLength(1);
  });

  it('does not recompile for a numeric edit - that value is a live uniform', () => {
    const node = makeNode({ width: 0.5 });

    manager.setValue(node, 'width', '0.25');

    expect(node.params.width).toBe('0.25');
    expect(reasons).toEqual([]);
  });

  // Code the artist writes is the shader itself. A Custom GLSL body and an Expression node's
  // formula are compiled into the generated WGSL, so a write that changes one has to recompile —
  // otherwise the edited node's own thumbnail refreshes (it re-renders its subgraph) while the
  // main output keeps running the previous shader. Inserting a snippet from the GLSL Utilities
  // window goes straight through setValue with no other trigger, and looked exactly like that:
  // the node updated, the floating preview did not, until some unrelated action forced a rebuild.
  describe('code parameters compiled into the shader', () => {
    it('recompiles when a Custom GLSL body changes', () => {
      const node = { id: '7', kind: 'CustomGLSL', params: { code: 'input0' }, inputs: [] };

      manager.setValue(node, 'code', 'vec3<f32>(uv, 0.0)');

      expect(node.params.code).toBe('vec3<f32>(uv, 0.0)');
      expect(reasons).toHaveLength(1);
    });

    it("recompiles when an Expression node's formula changes", () => {
      const node = { id: '8', kind: 'Expr', params: { expr: 'a' }, inputs: [] };

      manager.setValue(node, 'expr', 'a * 2.0');

      expect(node.params.expr).toBe('a * 2.0');
      expect(reasons).toHaveLength(1);
    });
  });

  // The same argument reaches further than expressions. A `select` enum or a `bool` flag is
  // baked into the generated WGSL - uniforms are floats, there is no way to hand the shader the
  // string "Proportional" - so the uniform-only path leaves the old code running and the control
  // does nothing at all. Rectangle's Size Mode was dead on arrival for exactly this reason.
  describe('discrete controls baked into the shader', () => {
    it('recompiles when a select enum changes', () => {
      const node = makeNode({ sizeMode: 'Frame' });

      manager.setValue(node, 'sizeMode', 'Proportional');

      expect(node.params.sizeMode).toBe('Proportional');
      expect(reasons).toHaveLength(1);
    });

    it('recompiles when a bool flag changes', () => {
      // Number(false) is 0, so a boolean looks numeric to any value-shaped test - the node
      // definition's declared TYPE is what separates a baked flag from a uniform.
      const node = { id: '9', kind: 'Flip2D', params: { flipX: false }, inputs: [] };

      manager.setValue(node, 'flipX', true);

      expect(reasons).toHaveLength(1);
    });

    it('still skips the rebuild for the float on the same node', () => {
      // The whole point of the numeric skip is drag performance; adding enums must not cost it.
      const node = makeNode({ sizeMode: 'Frame', width: 0.5 });

      manager.setValue(node, 'width', '0.75');

      expect(reasons).toEqual([]);
    });
  });
});
