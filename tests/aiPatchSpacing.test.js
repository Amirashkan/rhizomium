// A generated patch lands on the canvas at the coordinates the model wrote, and models write
// coordinates badly: twenty nodes at (0, 0), or a grid stepped by 100 when a node with its preview
// band open is 250 tall. The artist opens the patch, sees one card, and drags nineteen others out
// from under it before they can look at what was made.
//
// So the coordinates are checked before the patch is handed over. These tests are about that check:
// a patch that already stands clear keeps every coordinate it came with, and a patch that does not
// is laid out from its own wiring instead.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  spaceOutPatch,
  hasOverlappingNodes,
  nodeHeight,
  freeSpotNear,
  NODE_W,
} from '../src/ai/patchLayout.js';
import { validateGeneratedPatch } from '../api/_lib/nodeCatalog.js';
import { insertGeneratedNode, replaceGraphWithPatch } from '../src/ai/applyResult.js';

/** A chain of `kinds`, wired one into the next, with every node at the same point. */
function stackedChain(kinds) {
  return {
    nodes: kinds.map((kind, i) => ({ id: `n${i}`, kind, x: 0, y: 0, params: {} })),
    connections: kinds.slice(1).map((_, i) => ({
      from: { nodeId: `n${i}`, pin: 0 },
      to: { nodeId: `n${i + 1}`, pin: 0 },
    })),
  };
}

/** Every pair of nodes, as the rectangles they occupy on the canvas. */
function pairsOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const apart =
        a.x + NODE_W <= b.x ||
        b.x + NODE_W <= a.x ||
        a.y + nodeHeight(a) <= b.y ||
        b.y + nodeHeight(b) <= a.y;
      if (!apart) return `${a.kind} and ${b.kind} are on top of each other`;
    }
  }
  return null;
}

describe('a patch whose nodes are all in the same place', () => {
  const patch = stackedChain(['UV', 'SimplexNoise', 'ColorMix', 'OutputFinal']);

  it('is recognised as overlapping', () => {
    expect(hasOverlappingNodes(patch.nodes)).toBe(true);
  });

  it('comes back with every node clear of every other', () => {
    const spaced = spaceOutPatch(patch);
    expect(pairsOverlap(spaced.nodes)).toBeNull();
    expect(hasOverlappingNodes(spaced.nodes)).toBe(false);
  });

  it('reads left to right, in the order the signal flows', () => {
    const spaced = spaceOutPatch(patch);
    const x = Object.fromEntries(spaced.nodes.map((node) => [node.kind, node.x]));

    expect(x.UV).toBeLessThan(x.SimplexNoise);
    expect(x.SimplexNoise).toBeLessThan(x.ColorMix);
    expect(x.ColorMix).toBeLessThan(x.OutputFinal);
  });

  it('leaves the wires alone', () => {
    expect(spaceOutPatch(patch).connections).toEqual(patch.connections);
  });
});

describe('a patch spread out far enough already', () => {
  it('keeps the layout it was given', () => {
    const patch = {
      nodes: [
        { id: 'a', kind: 'UV', x: 0, y: 0, params: {} },
        { id: 'b', kind: 'SimplexNoise', x: 400, y: 0, params: {} },
        { id: 'c', kind: 'OutputFinal', x: 800, y: 0, params: {} },
      ],
      connections: [],
    };

    // The same object back, so a caller can tell nothing was touched.
    expect(spaceOutPatch(patch)).toBe(patch);
  });
});

describe('a chain laid out tightly, but with nothing buried', () => {
  it('is left alone: a tight layout is the model\'s business, a pile is not', () => {
    const patch = {
      nodes: [
        { id: 'a', kind: 'UV', x: 0, y: 0, params: {} },
        { id: 'b', kind: 'SimplexNoise', x: 260, y: 0, params: {} },
        { id: 'c', kind: 'OutputFinal', x: 520, y: 0, params: {} },
      ],
      connections: [],
    };

    expect(hasOverlappingNodes(patch.nodes)).toBe(false);
    expect(spaceOutPatch(patch)).toBe(patch);
  });
});

describe('a grid the model thought was spread out', () => {
  // 220 across and 140 down is what the schema suggests, and it is not enough for two visual nodes
  // in a column: a node showing its preview stands around 250 tall.
  it('is still caught, because a node is taller than the gap', () => {
    const nodes = [
      { id: 'a', kind: 'SimplexNoise', x: 0, y: 0, params: {} },
      { id: 'b', kind: 'VoronoiNoise', x: 0, y: 140, params: {} },
    ];

    expect(nodeHeight(nodes[0])).toBeGreaterThan(140);
    expect(hasOverlappingNodes(nodes)).toBe(true);
  });
});

describe('two branches meeting at a mix', () => {
  it('puts both sources left of what they feed and neither on the other', () => {
    const patch = {
      nodes: [
        { id: 'noise', kind: 'SimplexNoise', x: 10, y: 0, params: {} },
        { id: 'ramp', kind: 'ColorInvert', x: 10, y: 20, params: {} },
        { id: 'mix', kind: 'ColorMix', x: 10, y: 10, params: {} },
        { id: 'out', kind: 'OutputFinal', x: 10, y: 30, params: {} },
      ],
      connections: [
        { from: { nodeId: 'noise', pin: 0 }, to: { nodeId: 'mix', pin: 0 } },
        { from: { nodeId: 'ramp', pin: 0 }, to: { nodeId: 'mix', pin: 1 } },
        { from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
      ],
    };

    const spaced = spaceOutPatch(patch);
    const at = Object.fromEntries(spaced.nodes.map((node) => [node.id, node]));

    expect(pairsOverlap(spaced.nodes)).toBeNull();
    expect(at.noise.x).toBeLessThan(at.mix.x);
    expect(at.ramp.x).toBeLessThan(at.mix.x);
    expect(at.mix.x).toBeLessThan(at.out.x);
    // Two nodes in one column: the one the model put higher stays higher.
    expect(at.noise.y).toBeLessThan(at.ramp.y);
  });
});

describe('a patch that feeds back into itself', () => {
  it('is laid out rather than looping forever', () => {
    const patch = {
      nodes: [
        { id: 'a', kind: 'Multiply', x: 0, y: 0, params: {} },
        { id: 'b', kind: 'Add', x: 0, y: 0, params: {} },
        { id: 'out', kind: 'OutputFinal', x: 0, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'b', pin: 0 } },
        { from: { nodeId: 'b', pin: 0 }, to: { nodeId: 'a', pin: 0 } },
        { from: { nodeId: 'b', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
      ],
    };

    const spaced = spaceOutPatch(patch);
    expect(pairsOverlap(spaced.nodes)).toBeNull();
  });
});

describe('the patch a validated answer hands over', () => {
  it('never has two nodes in the same place', () => {
    const answer = {
      nodes: [
        { id: '1', kind: 'UV', x: 0, y: 0, params: {} },
        { id: '2', kind: 'SimplexNoise', x: 0, y: 0, params: {} },
        { id: '3', kind: 'ColorInvert', x: 0, y: 0, params: {} },
        { id: '4', kind: 'OutputFinal', x: 0, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: '1', pin: 0 }, to: { nodeId: '2', pin: 0 } },
        { from: { nodeId: '2', pin: 0 }, to: { nodeId: '3', pin: 0 } },
        { from: { nodeId: '3', pin: 0 }, to: { nodeId: '4', pin: 0 } },
      ],
    };

    const { patch, warnings } = validateGeneratedPatch(answer);

    expect(pairsOverlap(patch.nodes)).toBeNull();
    // Spacing a patch out is not something the artist needs a warning about.
    expect(warnings).toEqual([]);
  });

  it('measures a grown Compute Mix at the height its extra pins give it', () => {
    // The wires ask for five inputs; the layout has to leave room for the node that opens with
    // five pins, not the two its definition declares.
    const answer = {
      nodes: [
        { id: 'mix', kind: 'ComputeMix', x: 0, y: 0, params: {} },
        { id: 'a', kind: 'SimplexNoise', x: 0, y: 0, params: {} },
        { id: 'b', kind: 'VoronoiNoise', x: 0, y: 0, params: {} },
        { id: 'out', kind: 'OutputFinal', x: 0, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'mix', pin: 0 } },
        { from: { nodeId: 'b', pin: 0 }, to: { nodeId: 'mix', pin: 4 } },
        { from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
      ],
    };

    const { patch } = validateGeneratedPatch(answer);
    const mix = patch.nodes.find((node) => node.id === 'mix');

    expect(mix.inputCount).toBe(5);
    expect(pairsOverlap(patch.nodes)).toBeNull();
  });
});

describe('a generated node dropped onto a canvas that already has one', () => {
  beforeEach(() => {
    window.graph = { nodes: [], selection: new Set() };
    window.editor = undefined;
    window.undoManager = undefined;
  });

  it('lands beside what is there, not on top of it', () => {
    const first = insertGeneratedNode({ code: 'input0', inputs: [{ type: 'vec2' }] });
    const second = insertGeneratedNode({ code: 'input0 * 2.0', inputs: [{ type: 'vec2' }] });
    const third = insertGeneratedNode({ code: 'input0 * 3.0', inputs: [{ type: 'vec2' }] });

    expect(pairsOverlap([first, second, third])).toBeNull();
  });

  it('uses the spot it was aiming for when nothing is in the way', () => {
    const spot = freeSpotNear(120, 40, { kind: 'CustomGLSL' }, []);
    expect(spot).toEqual({ x: 120, y: 40 });
  });
});

describe('the view a patch lands in', () => {
  it('moves to hold the whole patch, however wide the layout made it', async () => {
    let framed = null;
    window.graph = { nodes: [], selection: new Set() };
    window.saveLoadManager = {
      createBackup: async () => {},
      importProject: async () => {},
    };
    window.editor = {
      markDirty: () => {},
      viewport: { fitToContent: (bounds) => { framed = bounds; } },
    };

    const patch = stackedChain(['UV', 'SimplexNoise', 'ColorMix', 'OutputFinal']);
    await replaceGraphWithPatch(patch, { reason: 'test' });

    // Four nodes spaced out are wider than the 220-per-node grid the model
    // asked for, and every one of them has to be on screen.
    expect(framed).not.toBeNull();
    expect(framed.maxX - framed.minX).toBeGreaterThan(3 * NODE_W);
    expect(framed.maxY).toBeGreaterThan(framed.minY);
  });
});
