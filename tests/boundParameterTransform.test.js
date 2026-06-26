// Regression tests for transform expressions on bound parameters.
//
// A bound parameter mirrors its source's value. These tests cover the additional ability for a
// bound parameter to ALSO carry an expression that post-processes that driven value, with the live
// source value exposed to the expression as `bound`/`self` (e.g. "=bound * 2"). The transform is
// owned by the binding system (not node.params), so the binding keeps writing a plain numeric
// result that downstream codegen/uniforms/preview consume unchanged.

import { describe, it, expect, beforeEach } from 'vitest';
import { ParameterBindingSystem } from '../src/utils/ParameterBindingSystem.js';

function makeEventSystem() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, data) {
      (handlers.get(type) || []).forEach(fn => fn(data));
    },
  };
}

describe('bound parameter transform expressions', () => {
  let graph;
  let source;
  let target;
  let bindingSystem;

  beforeEach(() => {
    source = { id: 's', kind: 'ConstFloat', params: { value: 5 } };
    target = { id: 't', kind: 'CircleField', params: { radius: 0 } };
    graph = { nodes: [source, target], connections: [] };
    bindingSystem = new ParameterBindingSystem(graph, makeEventSystem(), null);
    bindingSystem.createBinding('s', 'value', 't', 'radius');
  });

  it('binding without a transform mirrors the source value', () => {
    expect(target.params.radius).toBe(5);
    expect(bindingSystem.getBoundTransform('t', 'radius')).toBeNull();
  });

  it('a transform post-processes the driven value using "bound"', () => {
    const changed = bindingSystem.setBoundTransform('t', 'radius', '=bound * 2');
    expect(changed).toBe(true);
    expect(target.params.radius).toBe(10);
    expect(bindingSystem.getBoundTransform('t', 'radius')).toBe('=bound * 2');
  });

  it('"self" is an alias for the driven value', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=self + 1');
    expect(target.params.radius).toBe(6);
  });

  it('a missing leading = is added automatically', () => {
    bindingSystem.setBoundTransform('t', 'radius', 'bound * 3');
    expect(bindingSystem.getBoundTransform('t', 'radius')).toBe('=bound * 3');
    expect(target.params.radius).toBe(15);
  });

  it('the transform re-applies when the source value changes', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=bound * 2');
    // Simulate the source parameter changing (PARAMETER_CHANGED fires after node.params is set).
    source.params.value = 7;
    bindingSystem.updateBoundParameters(source, 'value', 7, 'user');
    expect(target.params.radius).toBe(14);
  });

  it('clearing the transform restores the raw driven value', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=bound * 2');
    expect(target.params.radius).toBe(10);
    bindingSystem.setBoundTransform('t', 'radius', '');
    expect(target.params.radius).toBe(5);
    expect(bindingSystem.getBoundTransform('t', 'radius')).toBeNull();
  });

  it('an unknown identifier resolves to 0, matching the expression system', () => {
    // The shared expression system treats unknown identifiers as 0 rather than throwing, so a
    // transform referencing one yields 0 here too (consistent with plain expression parameters).
    bindingSystem.setBoundTransform('t', 'radius', '=bound * unknownThing');
    expect(target.params.radius).toBe(0);
  });

  it('a transform on a non-bound parameter is rejected', () => {
    const changed = bindingSystem.setBoundTransform('t', 'nope', '=bound * 2');
    expect(changed).toBe(false);
  });

  it('removing the binding also drops its transform', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=bound * 2');
    bindingSystem.removeBinding('s', 'value', 't', 'radius');
    expect(bindingSystem.getBoundTransform('t', 'radius')).toBeNull();
    expect(bindingSystem.getBindingInfo('t', 'radius').transform).toBeNull();
  });

  it('getBindingInfo exposes the transform', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=bound * 2');
    const info = bindingSystem.getBindingInfo('t', 'radius');
    expect(info.isBound).toBe(true);
    expect(info.transform).toBe('=bound * 2');
  });

  it('live drag propagation pushes the current source value through the transform', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=bound * 2');
    // Simulate the drag handler updating the source node.params mid-drag (no event fired yet).
    source.params.value = 9;
    const affected = bindingSystem.refreshLiveTargetsForSource(source);
    expect(target.params.radius).toBe(18);
    expect(affected.has(target)).toBe(true);
  });

  it('live drag propagation mirrors the raw value when there is no transform', () => {
    source.params.value = 11;
    bindingSystem.refreshLiveTargetsForSource(source);
    expect(target.params.radius).toBe(11);
  });

  describe('expression sources', () => {
    function bindExprSource(sourceExpr) {
      const s = { id: 's2', kind: 'Time', params: { value: sourceExpr } };
      const t = { id: 't2', kind: 'CircleField', params: { radius: 0 } };
      const g = { nodes: [s, t], connections: [] };
      const bs = new ParameterBindingSystem(g, makeEventSystem(), null);
      bs.createBinding('s2', 'value', 't2', 'radius');
      return { s, t, bs };
    }

    it('composes a live expression on the target instead of a frozen snapshot', () => {
      const { t } = bindExprSource('=time');
      expect(t.params.radius).toBe('=(time)');
    });

    it('substitutes the source expression into the transform', () => {
      const { t, bs } = bindExprSource('=time');
      bs.setBoundTransform('t2', 'radius', '=bound * 2');
      expect(t.params.radius).toBe('=(time) * 2');
    });

    it('substitutes "self" as well', () => {
      const { t, bs } = bindExprSource('=audioEnvelope');
      bs.setBoundTransform('t2', 'radius', '=self + 1');
      expect(t.params.radius).toBe('=(audioEnvelope) + 1');
    });

    it('recomposes when the source expression changes', () => {
      const { s, t, bs } = bindExprSource('=time');
      bs.setBoundTransform('t2', 'radius', '=bound * 2');
      expect(t.params.radius).toBe('=(time) * 2');
      // Source expression edited; PARAMETER_CHANGED would drive this.
      s.params.value = '=audioEnvelope';
      bs.updateBoundParameters(s, 'value', '=audioEnvelope', 'user');
      expect(t.params.radius).toBe('=(audioEnvelope) * 2');
    });

    it('reads the live expression from node.params even when node.value is a stale number', () => {
      // A ConstFloat keeps its live value in node.params.value (where codegen + the expression
      // panel read it); the legacy node.value can lag as an old number. The binding must follow
      // node.params, otherwise the source looks static and the target freezes.
      const s = { id: 's3', kind: 'ConstFloat', value: 0, params: { value: '=sin(time)' } };
      const t = { id: 't3', kind: 'ConstFloat', value: 0, params: { value: 0 } };
      const g = { nodes: [s, t], connections: [] };
      const bs = new ParameterBindingSystem(g, makeEventSystem(), null);
      bs.createBinding('s3', 'value', 't3', 'value');
      expect(t.params.value).toBe('=(sin(time))');
    });

    it('falls back to a plain number once the source becomes static', () => {
      const { s, t, bs } = bindExprSource('=time');
      expect(t.params.radius).toBe('=(time)');
      s.params.value = 4;
      bs.updateBoundParameters(s, 'value', 4, 'user');
      expect(t.params.radius).toBe(4);
    });
  });

  it('transforms survive a serialize/deserialize round trip', () => {
    bindingSystem.setBoundTransform('t', 'radius', '=bound + 1');
    const data = bindingSystem.serialize();

    const restored = new ParameterBindingSystem(graph, makeEventSystem(), null);
    restored.deserialize(data);

    expect(restored.getBoundTransform('t', 'radius')).toBe('=bound + 1');
    expect(restored.getBindingInfo('t', 'radius').isBound).toBe(true);
  });
});
