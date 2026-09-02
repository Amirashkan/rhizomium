// v7 -> v8: the all-in-one Audio Analysis node became the single-channel Audio node.
//
// A patch saved with the old node has to come back doing the same thing, which means converting it
// into one Audio node per pin the patch actually READ — through a wire or through a
// `=node_<id>_N` reference — and re-pointing everything that named it.

import { describe, it, expect } from 'vitest';
import { migrateProjectData, SAVE_FORMAT_VERSION } from '../src/core/projectMigrations.js';

/** A v7 project carrying one Audio Analysis node. */
function project({ nodes = [], connections = [], ...rest } = {}) {
  return {
    app: 'Rhizomium-Web',
    format: 'rhizomium-project',
    version: 7,
    nodes,
    connections,
    ...rest,
  };
}

const analysis = (params = {}) => ({
  id: '28',
  kind: 'AudioAnalysis',
  position: { x: 100, y: 200 },
  size: { width: 180, height: 320 },
  inputs: [],
  params: { kickThresh: 0.62, snareThresh: 0.4, hatThresh: 0.5, attack: 12, ...params },
});

// After the whole chain: the channel readers are AudioValue, and whatever thresholds they carried
// have been gathered onto one Audio setup node.
const audioNodes = (result) => result.nodes.filter((n) => n.kind === 'AudioValue');
const setupNode = (result) => result.nodes.find((n) => n.kind === 'Audio');

describe('converting an Audio Analysis node to Audio nodes', () => {
  it('leaves a project without one alone', () => {
    const data = project({ nodes: [{ id: 'a', kind: 'ConstFloat', params: { value: 1 } }] });
    const result = migrateProjectData(data);
    expect(result.version).toBe(SAVE_FORMAT_VERSION);
    expect(result.nodes).toEqual(data.nodes);
  });

  it('converts a single wired pin in place, keeping the id and the wire', () => {
    const result = migrateProjectData(project({
      nodes: [analysis(), { id: '9', kind: 'Circle', inputs: [{ index: 0 }], params: {} }],
      // Pin 4 is `kick`.
      connections: [{ from: { nodeId: '28', pin: 4 }, to: { nodeId: '9', pin: 0 } }],
    }));

    const audio = audioNodes(result);
    expect(audio).toHaveLength(1);
    expect(audio[0].id).toBe('28');
    // The threshold is no longer the reader's: it moved to the setup node with the rest of the
    // analysis's settings, where a controller can reach it.
    expect(audio[0].params).toEqual({ channel: 'kick' });
    expect(audio[0].name).toBe('Kick');
    expect(setupNode(result).params.kickThresh).toBeCloseTo(0.62);
    // Reusing the id is what lets a single-pin patch migrate without touching its wiring.
    expect(result.connections).toEqual([{ from: { nodeId: '28', pin: 0 }, to: { nodeId: '9', pin: 0 } }]);
  });

  it('splits a patch that reads several pins, one node each, and re-points every wire', () => {
    const result = migrateProjectData(project({
      nodes: [
        analysis(),
        { id: '9', kind: 'Circle', inputs: [{ index: 0 }], params: {} },
        { id: '10', kind: 'Circle', inputs: [{ index: 0 }], params: {} },
      ],
      connections: [
        // level (pin 0) and hatTrig (pin 9).
        { from: { nodeId: '28', pin: 0 }, to: { nodeId: '9', pin: 0 } },
        { from: { nodeId: '28', pin: 9 }, to: { nodeId: '10', pin: 0 } },
      ],
    }));

    const audio = audioNodes(result);
    expect(audio.map((n) => n.params.channel)).toEqual(['level', 'hatTrig']);
    expect(audio[0].id).toBe('28');
    // The extra continues the document's own numbering rather than colliding with anything.
    expect(audio[1].id).toBe('29');
    // Stacked, not piled.
    expect(audio[1].position.y).toBeGreaterThan(audio[0].position.y);
    expect(audio[1].position.x).toBe(audio[0].position.x);

    expect(result.connections).toEqual([
      { from: { nodeId: '28', pin: 0 }, to: { nodeId: '9', pin: 0 } },
      { from: { nodeId: '29', pin: 0 }, to: { nodeId: '10', pin: 0 } },
    ]);
  });

  it('gathers the drum thresholds onto one setup node', () => {
    const result = migrateProjectData(project({
      nodes: [analysis()],
      connections: [
        { from: { nodeId: '28', pin: 5 }, to: { nodeId: '9', pin: 0 } },  // kickTrig
        { from: { nodeId: '28', pin: 7 }, to: { nodeId: '9', pin: 1 } },  // snareTrig
        { from: { nodeId: '28', pin: 0 }, to: { nodeId: '9', pin: 2 } },  // level
      ],
    }));

    const setup = setupNode(result);
    expect(setup.params.kickThresh).toBeCloseTo(0.62);
    expect(setup.params.snareThresh).toBeCloseTo(0.4);
    // A channel that decides nothing contributes no threshold.
    expect(setup.params.hatThresh).toBeUndefined();
    // And no reader keeps one of its own.
    for (const node of audioNodes(result)) expect(node.params.threshold).toBeUndefined();
  });

  it('keeps an expression threshold as the expression it is', () => {
    const result = migrateProjectData(project({
      nodes: [analysis({ kickThresh: '=midi * 0.5' })],
      connections: [{ from: { nodeId: '28', pin: 5 }, to: { nodeId: '9', pin: 0 } }],
    }));
    expect(setupNode(result).params.kickThresh).toBe('=midi * 0.5');
  });

  it('rewrites the references a patch used instead of a wire', () => {
    const result = migrateProjectData(project({
      nodes: [
        analysis(),
        // A bare reference means pin 0; `_4` is the kick envelope.
        { id: '9', kind: 'Circle', inputs: [], params: { radius: '=node_28', glow: '=node_28_4 * 2' } },
        { id: '10', kind: 'Expr', inputs: [], params: { expr: 'a' }, expr: '=node_28_4 + node_28' },
      ],
    }));

    const audio = audioNodes(result);
    const idFor = (channel) => audio.find((n) => n.params.channel === channel).id;
    const circle = result.nodes.find((n) => n.id === '9');

    expect(circle.params.radius).toBe(`=node_${idFor('level')}`);
    expect(circle.params.glow).toBe(`=node_${idFor('kick')} * 2`);
    // Mirrored fields outside params are rewritten too.
    expect(result.nodes.find((n) => n.id === '10').expr)
      .toBe(`=node_${idFor('kick')} + node_${idFor('level')}`);
  });

  it('does not mistake one id for another that starts with the same digits', () => {
    const result = migrateProjectData(project({
      nodes: [
        analysis(),
        { id: '281', kind: 'ConstFloat', inputs: [], params: { value: 3 } },
        { id: '9', kind: 'Circle', inputs: [], params: { radius: '=node_281 + node_28' } },
      ],
    }));
    // node_281 is a different node and must survive untouched.
    expect(result.nodes.find((n) => n.id === '9').params.radius).toBe('=node_281 + node_28');
  });

  it('keeps a node nothing reads, as its first channel', () => {
    const result = migrateProjectData(project({ nodes: [analysis()] }));
    const audio = audioNodes(result);
    expect(audio).toHaveLength(1);
    expect(audio[0].params.channel).toBe('level');
  });

  it('follows a MIDI or OSC binding to the threshold it now lives on', () => {
    const result = migrateProjectData(project({
      nodes: [analysis()],
      connections: [{ from: { nodeId: '28', pin: 5 }, to: { nodeId: '9', pin: 0 } }],
      midiBindings: {
        bindings: [
          { deviceId: 'd', channel: 0, cc: 7, nodeId: '28', paramName: 'kickThresh', min: 0, max: 1 },
          { deviceId: 'd', channel: 0, cc: 8, nodeId: '9', paramName: 'radius', min: 0, max: 1 },
        ],
      },
      oscBindings: {
        bindings: [{ address: '/x', nodeId: '28', paramName: 'kickThresh' }],
      },
    }));

    // The knob that was on the old node's Kick Thresh ends up on the setup node's, through both
    // conversions, still pointed at the same decision.
    const setup = setupNode(result);
    expect(result.midiBindings.bindings[0]).toMatchObject({
      cc: 7, nodeId: setup.id, paramName: 'kickThresh',
    });
    // An unrelated binding is left exactly as it was.
    expect(result.midiBindings.bindings[1]).toMatchObject({ nodeId: '9', paramName: 'radius' });
    expect(result.oscBindings.bindings[0]).toMatchObject({ nodeId: setup.id, paramName: 'kickThresh' });
  });

  it('carries a v8 patch — channel readers named Audio, each with its own threshold — across', () => {
    const result = migrateProjectData({
      ...project({}),
      version: 8,
      nodes: [
        { id: '3', kind: 'Audio', inputs: [], params: { channel: 'kickTrig', threshold: 0.7 } },
        { id: '4', kind: 'Audio', inputs: [], params: { channel: 'kick', threshold: 0.3 } },
        { id: '5', kind: 'Audio', inputs: [], params: { channel: 'level' } },
      ],
    });

    expect(audioNodes(result).map((n) => [n.id, n.params.channel]))
      .toEqual([['3', 'kickTrig'], ['4', 'kick'], ['5', 'level']]);
    // Two nodes disagreed about the kick; the tighter one is the one that was dialled in, and a
    // looser sibling would have been firing on everything.
    expect(setupNode(result).params.kickThresh).toBeCloseTo(0.7);
  });

  it('leaves a v8 patch with nothing dialled in without a setup node', () => {
    const result = migrateProjectData({
      ...project({}),
      version: 8,
      nodes: [{ id: '3', kind: 'Audio', inputs: [], params: { channel: 'level' } }],
    });
    expect(setupNode(result)).toBeUndefined();
    expect(audioNodes(result)).toHaveLength(1);
  });
});
