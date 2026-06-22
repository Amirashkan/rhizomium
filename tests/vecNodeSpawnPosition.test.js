// Regression tests for ConstVec2/3/4 spawn position and parameter storage.
//
// Bug: Vec2/Vec3/Vec4 nodes always spawned at a fixed point (0,0) in the canvas instead of where
// they were created. Root cause was a conflation between the node's canvas position (node.x/node.y)
// and the component parameters which are also named "x" and "y". Creating the node overwrote its
// position with the param defaults, and editing/dragging the X/Y value teleported the node.
//
// The contract these tests lock in:
//   - node.x / node.y are the canvas POSITION only.
//   - Vec component values live in node.params (x/y/z/w) — the source of truth read by codegen.
//   - Editing an X/Y parameter changes node.params, never the node's position.

import { describe, it, expect } from 'vitest';
import { makeNode } from '../src/data/NodeDefs.js';
import { ParameterValueManager } from '../src/ui/components/ParameterValueManager.js';

describe('ConstVec node spawn position', () => {
  it('keeps the spawn position passed to makeNode (does not reset to 0,0)', () => {
    for (const kind of ['ConstVec2', 'ConstVec3', 'ConstVec4']) {
      const node = makeNode(kind, 523, 317);
      expect(node.x, `${kind} x position`).toBe(523);
      expect(node.y, `${kind} y position`).toBe(317);
    }
  });

  it('spawns at distinct positions instead of a single fixed point', () => {
    const a = makeNode('ConstVec3', 100, 200);
    const b = makeNode('ConstVec3', 800, 650);
    expect([a.x, a.y]).toEqual([100, 200]);
    expect([b.x, b.y]).toEqual([800, 650]);
  });

  it('initialises component values in node.params, separate from position', () => {
    const v4 = makeNode('ConstVec4', 400, 400);
    // Component defaults from the node definition — independent of position.
    expect(v4.params.x).toBe(0.0);
    expect(v4.params.y).toBe(0.0);
    expect(v4.params.z).toBe(0.0);
    expect(v4.params.w).toBe(1.0);
    // Position is untouched by the param defaults.
    expect(v4.x).toBe(400);
    expect(v4.y).toBe(400);
  });
});

describe('ConstVec parameter edits do not move the node', () => {
  function makeManager() {
    const graph = { nodes: [], connections: null };
    return { graph, vm: new ParameterValueManager(graph, null, null) };
  }

  it('writes X/Y edits to node.params and leaves the canvas position unchanged', () => {
    const { vm } = makeManager();
    const node = makeNode('ConstVec2', 640, 480);

    vm.updateNodeParameter(node, 'x', 0.75, null);
    vm.updateNodeParameter(node, 'y', -0.5, null);

    // Component values updated...
    expect(node.params.x).toBe(0.75);
    expect(node.params.y).toBe(-0.5);
    // ...but the node did NOT teleport.
    expect(node.x).toBe(640);
    expect(node.y).toBe(480);
  });

  it('reads the X/Y parameter value from node.params, not the node position', () => {
    const { vm } = makeManager();
    const node = makeNode('ConstVec3', 1000, 720);
    node.params.x = 0.25;
    node.params.y = 0.5;

    // Raw read must return the component value, not the canvas coordinate.
    expect(vm.getRawParameterValue(node, 'x', 0)).toBe(0.25);
    expect(vm.getRawParameterValue(node, 'y', 0)).toBe(0.5);
  });
});
