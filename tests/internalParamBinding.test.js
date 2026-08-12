// Internal (same-node) parameter binding.
//
// A parameter expression could only reach other nodes (=node_5) or the built-in globals. Naming a
// sibling parameter of the same node — a Transform 2D whose Scale Y is "=scaleX" — hit the shader
// generator's unknown-identifier guard and compiled to "0.0", so the render read zero no matter how
// Scale X was set. These tests cover the identifier resolving on both surfaces: the WGSL the
// compilers emit, and the CPU evaluation behind the parameter readout / node preview.

import { describe, it, expect } from 'vitest';
import {
  buildParamRefMapping,
  buildParamScope,
  referencesParams,
  paramUniformField,
  compilerParamRefMapping,
} from '../src/utils/paramReferences.js';
import { TransformNodes } from '../src/codegen/compilers/TransformNodes.js';
import {
  ParameterExpressionSystem,
  ExpressionTextInputHandler,
} from '../src/utils/ParameterExpressionSystem.js';

function makeUniformManager() {
  return { uniformValues: new Map() };
}

function makeTransformNode(params) {
  return { id: 4, kind: 'Scale2D', params };
}

describe('internal parameter binding - WGSL', () => {
  it('binds a parameter to a sibling parameter\'s uniform instead of zeroing out', () => {
    const compiler = new TransformNodes();
    compiler.setUniformManager(makeUniformManager());
    const node = makeTransformNode({ scaleX: 2.5, scaleY: '=scaleX' });

    expect(compiler.getShaderParam(node, 'scaleY', 1.0)).toBe(paramUniformField(4, 'scaleX'));
  });

  it('registers the source parameter as a uniform so the binding tracks it live', () => {
    const compiler = new TransformNodes();
    const uniformManager = makeUniformManager();
    compiler.setUniformManager(uniformManager);
    const node = makeTransformNode({ scaleX: 2.5, scaleY: '=scaleX' });

    compiler.getShaderParam(node, 'scaleY', 1.0);
    expect(uniformManager.uniformValues.get('4.scaleX')).toBe(2.5);
  });

  it('supports arithmetic on a sibling parameter', () => {
    const compiler = new TransformNodes();
    compiler.setUniformManager(makeUniformManager());
    const node = makeTransformNode({ scaleX: 2, scaleY: '=scaleX*2+1' });

    expect(compiler.getShaderParam(node, 'scaleY', 1.0))
      .toBe(`((${paramUniformField(4, 'scaleX')} * 2.0) + 1.0)`);
  });

  it('resolves a sibling that is itself an expression', () => {
    const node = makeTransformNode({ scaleX: '=time*2', scaleY: '=scaleX' });
    const mapping = buildParamRefMapping(node, '=scaleX', { excludeParam: 'scaleY' });

    expect(mapping.scaleX).toBe('(g.time * 2.0)');
  });

  it('bakes a literal when no uniform manager is available', () => {
    const node = makeTransformNode({ scaleX: '1.5', scaleY: '=scaleX' });
    expect(buildParamRefMapping(node, '=scaleX', { excludeParam: 'scaleY' }).scaleX).toBe('1.5');
  });

  it('never binds a parameter to itself', () => {
    const node = makeTransformNode({ scaleX: '=scaleX' });
    expect(buildParamRefMapping(node, '=scaleX', { excludeParam: 'scaleX' })).toEqual({});
  });

  it('resolves a reference cycle to nothing instead of recursing forever', () => {
    const node = makeTransformNode({ scaleX: '=scaleY', scaleY: '=scaleX' });
    expect(buildParamRefMapping(node, '=scaleX', { excludeParam: 'scaleY' })).toEqual({});
  });

  it('does not let a parameter shadow a built-in global', () => {
    const node = makeTransformNode({ time: 5, scaleY: '=time' });
    expect(buildParamRefMapping(node, '=time', { excludeParam: 'scaleY' })).toEqual({});
  });

  it('ignores an enum/text parameter as a binding source', () => {
    const node = makeTransformNode({ mode: 'Stripes', scaleY: '=mode' });
    expect(buildParamRefMapping(node, '=mode', { excludeParam: 'scaleY' })).toEqual({});
  });

  it('leaves expressions that reference no sibling parameter untouched', () => {
    const compiler = new TransformNodes();
    compiler.setUniformManager(makeUniformManager());
    const node = makeTransformNode({ scaleX: 1, scaleY: '=time*2' });

    expect(compiler.getShaderParam(node, 'scaleY', 1.0)).toBe('(g.time * 2.0)');
  });
});

describe('internal parameter binding - expression source parameters', () => {
  // A sibling that is itself an expression must compile the way it compiles in its OWN field:
  // through the caller's parameter resolver, so node references, scalar coercions and fallbacks
  // are the ones that caller applies. Compiling the expression text standalone gets those wrong.
  function fakeCompiler(node, resolved) {
    const calls = [];
    return {
      calls,
      graph: null,
      uniformManager: { uniformValues: new Map() },
      getShaderParam(n, name) {
        calls.push(name);
        return resolved[name] ?? null;
      },
      node,
    };
  }

  it('compiles an expression sibling through the caller\'s own resolver', () => {
    const node = makeTransformNode({ scaleX: '=node_7', scaleY: '=scaleX' });
    const compiler = fakeCompiler(node, { scaleX: 'node_7_resolved' });

    const mapping = compilerParamRefMapping(compiler, node, '=scaleX', 'scaleY');
    expect(compiler.calls).toEqual(['scaleX']);
    expect(mapping.scaleX).toBe('node_7_resolved');
  });

  it('drops the binding when the caller cannot resolve the source', () => {
    const node = makeTransformNode({ scaleX: '=node_', scaleY: '=scaleX' });
    const compiler = fakeCompiler(node, { scaleX: null });

    expect(compilerParamRefMapping(compiler, node, '=scaleX', 'scaleY')).toEqual({});
  });

  it('does not re-enter the resolver for a parameter already being resolved', () => {
    const node = makeTransformNode({ scaleX: '=scaleY', scaleY: '=scaleX' });
    const compiler = {
      graph: null,
      uniformManager: { uniformValues: new Map() },
      getShaderParam(n, name) {
        // Mimics a real compiler: resolving a parameter resolves its references too.
        const mapping = compilerParamRefMapping(this, n, n.params[name], name);
        return mapping[name === 'scaleX' ? 'scaleY' : 'scaleX'] ?? null;
      },
    };

    expect(() => compilerParamRefMapping(compiler, node, '=scaleX', 'scaleY')).not.toThrow();
    expect(compilerParamRefMapping(compiler, node, '=scaleX', 'scaleY')).toEqual({});
  });

  it('still resolves a numeric sibling to its uniform, not through the resolver', () => {
    const node = makeTransformNode({ scaleX: 2, scaleY: '=scaleX' });
    const compiler = fakeCompiler(node, {});

    expect(compilerParamRefMapping(compiler, node, '=scaleX', 'scaleY').scaleX)
      .toBe(paramUniformField(4, 'scaleX'));
    expect(compiler.calls).toEqual([]);
  });
});

describe('internal parameter binding - readout during a drag', () => {
  // The drag handler writes node.params and the GPU uniform on every mouse-move and only commits on
  // release, so a field bound to the dragged parameter has no event of its own: its green evaluated
  // readout used to sit at the pre-drag value while the render moved.
  function mountField(handler, node, paramName) {
    const input = document.createElement('textarea');
    input.value = node.params[paramName];
    const resultDisplay = document.createElement('div');
    handler.activeInputs.set(`${node.id}_${paramName}`, {
      input,
      resultDisplay,
      param: { name: paramName, type: 'float' },
      node,
      valueManager: null,
    });
    return { input, resultDisplay };
  }

  it('refreshes a bound field\'s readout from the current parameter value', () => {
    const expressionSystem = new ParameterExpressionSystem();
    const handler = new ExpressionTextInputHandler(null, expressionSystem);
    const node = makeTransformNode({ scaleX: 2, scaleY: '=scaleX' });
    const { resultDisplay } = mountField(handler, node, 'scaleY');

    handler.refreshNodeExpressionDisplays(node.id, 'scaleX');
    expect(resultDisplay.textContent).toBe('→ 2');

    node.params.scaleX = '5.500'; // what a drag mouse-move writes
    handler.refreshNodeExpressionDisplays(node.id, 'scaleX');
    expect(resultDisplay.textContent).toBe('→ 5.5');
  });

  it('leaves plain numeric fields and other nodes alone', () => {
    const expressionSystem = new ParameterExpressionSystem();
    const handler = new ExpressionTextInputHandler(null, expressionSystem);
    const node = makeTransformNode({ scaleX: 2, scaleY: '=scaleX' });
    const numeric = mountField(handler, node, 'scaleX');
    const other = mountField(handler, { id: 9, kind: 'Scale2D', params: { scaleY: '=scaleX' } }, 'scaleY');

    handler.refreshNodeExpressionDisplays(node.id);
    expect(numeric.resultDisplay.textContent).toBe('');
    expect(other.resultDisplay.textContent).toBe('');
  });
});

describe('internal parameter binding - CPU evaluation', () => {
  it('evaluates a sibling reference to the sibling\'s value', () => {
    const sys = new ParameterExpressionSystem();
    const node = makeTransformNode({ scaleX: 2.5, scaleY: '=scaleX' });

    expect(sys.evaluateExpression('=scaleX', {}, node)).toBe(2.5);
  });

  it('evaluates a sibling whose own value is an expression', () => {
    const sys = new ParameterExpressionSystem();
    const node = makeTransformNode({ scaleX: '=1+1', scaleY: '=scaleX*3' });

    expect(sys.evaluateExpression('=scaleX*3', {}, node)).toBe(6);
  });

  it('parses a numeric string parameter as a number', () => {
    expect(buildParamScope(makeTransformNode({ scaleX: '2.5' })).scaleX).toBe(2.5);
  });

  it('keeps a reference cycle out of the scope', () => {
    const scope = buildParamScope(makeTransformNode({ scaleX: '=scaleY', scaleY: '=scaleX' }));
    expect(scope.scaleX).toBeUndefined();
    expect(scope.scaleY).toBeUndefined();
  });

  it('reports sibling references so the caller can skip the result cache', () => {
    const node = makeTransformNode({ scaleX: 1, scaleY: '=scaleX' });
    expect(referencesParams(node, 'scaleX', 'scaleY')).toBe(true);
    expect(referencesParams(node, 'time*2', 'scaleY')).toBe(false);
  });

  it('re-evaluates rather than caching, so the value follows the source parameter', () => {
    const sys = new ParameterExpressionSystem();
    const node = makeTransformNode({ scaleX: 2, scaleY: '=scaleX' });

    expect(sys.evaluateExpression('=scaleX', {}, node)).toBe(2);
    node.params.scaleX = 7;
    expect(sys.evaluateExpression('=scaleX', {}, node)).toBe(7);
  });
});
