// A moving playhead is a uniform write, not a shader rebuild.
//
// The two paths through the renderer cost very different amounts (CLAUDE.md,
// "the one performance rule"): a recompile runs buildWGSL() and builds a new
// pipeline; a uniform write puts a float in a buffer. TimelineManager took the
// first for every keyframed value that moved — once per parameter per frame.
//
// At the desk that was a sticky scrub nobody had measured. Under the performer
// it became a set: ActionExecutor.armTimeline() enables the timeline on every
// section and PerformerEngine.tick() drives the playhead from the frame loop,
// so a show whose looks carry keyframes rebuilt its shader sixty times a
// second for as long as it ran.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TimelineManager } from '../src/core/TimelineManager.js';
import { NodeDefs } from '../src/data/NodeDefs.js';

/** An editor with the two paths counted, and a node with a float on it. */
function rig({ reserved = true } = {}) {
  const node = { id: 'n1', kind: 'ComputeNoise', params: { speed: 0 } };
  const counts = { rebuilds: 0, redraws: 0 };
  const editor = {
    graph: { nodes: [node] },
    onChange: () => { counts.rebuilds++; },
    markDirty: () => { counts.redraws++; },
  };

  // What the compiler reserved. A float that reaches the shader has a slot;
  // something read only on the CPU does not, and that is the case that still
  // has to take the slow path.
  window.nodeCompiler = {
    uniformManager: { uniformValues: new Map(reserved ? [['n1.speed', 0]] : []) },
  };

  const manager = new TimelineManager(editor);
  manager.addKeyframeAt('n1', 'speed', 0, 0);
  manager.addKeyframeAt('n1', 'speed', 10, 1);
  manager.enable();
  counts.rebuilds = 0;
  counts.redraws = 0;

  return { manager, node, counts };
}

beforeEach(() => {
  window.NodeDefs = NodeDefs;
});

afterEach(() => {
  delete window.nodeCompiler;
  delete window.NodeDefs;
});

describe('a playhead moving across keyframes', () => {
  it('rebuilds nothing when the parameter has a uniform', () => {
    const { manager, counts } = rig();

    for (let frame = 0; frame < 60; frame++) manager.setCurrentTime(frame / 60);

    expect(counts.rebuilds).toBe(0);
  });

  it('still puts the value on the node and in the uniform', () => {
    const { manager, node } = rig();

    manager.setCurrentTime(5);

    expect(node.params.speed).toBeCloseTo(0.5, 5);
    expect(window.nodeCompiler.uniformManager.uniformValues.get('n1.speed')).toBeCloseTo(0.5, 5);
  });

  it('still redraws the canvas, so the node follows the playhead', () => {
    const { manager, counts } = rig();

    for (let frame = 0; frame < 10; frame++) manager.setCurrentTime(frame / 60);

    expect(counts.redraws).toBeGreaterThan(0);
  });

  it('takes the slow path for a parameter the compiler reserved nothing for', () => {
    // A discrete value that decides what the shader IS, a vector, something
    // the CPU reads and the shader never sees: no slot, so a rebuild is the
    // only way the change reaches the screen.
    const { manager, counts } = rig({ reserved: false });

    manager.setCurrentTime(5);

    expect(counts.rebuilds).toBe(1);
  });

  it('does neither when nothing actually moved', () => {
    const { manager, counts } = rig();

    manager.setCurrentTime(5);
    const after = { ...counts };
    manager.setCurrentTime(5);

    expect(counts.rebuilds).toBe(after.rebuilds);
    expect(counts.redraws).toBe(after.redraws);
  });
});
