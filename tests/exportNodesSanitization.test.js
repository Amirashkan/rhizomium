import { describe, it, expect } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

// Call exportNodes on a stubbed `this` to avoid the constructor's
// side effects (timers, IndexedDB, unload handlers)
function exportNodes(nodes) {
  const stub = { graph: { nodes }, textureManager: null };
  return SaveLoadManager.prototype.exportNodes.call(stub);
}

describe('SaveLoadManager.exportNodes', () => {
  it('skips runtime-only "__" properties and functions', () => {
    const canvasLike = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : {};

    const [exported] = exportNodes([
      {
        id: 'node_1',
        kind: 'Float',
        x: 10,
        y: 20,
        value: 0.5,
        __thumb: canvasLike,
        __cache: { foo: 1 },
        onChange: () => {},
        inputs: [],
        outputs: [],
      },
    ]);

    expect(exported.id).toBe('node_1');
    expect(exported.kind).toBe('Float');
    expect(exported.value).toBe(0.5);
    expect(exported.__thumb).toBeUndefined();
    expect(exported.__cache).toBeUndefined();
    expect(exported.onChange).toBeUndefined();
  });

  it('still exports regular custom properties', () => {
    const [exported] = exportNodes([
      {
        id: 'node_2',
        kind: 'Slider',
        expr: 'sin(t)',
        min: 0,
        max: 1,
        props: { label: 'speed' },
        inputs: [null],
      },
    ]);

    expect(exported.expr).toBe('sin(t)');
    expect(exported.min).toBe(0);
    expect(exported.max).toBe(1);
    expect(exported.props).toEqual({ label: 'speed' });
    expect(exported.inputs).toHaveLength(1);
  });
});
