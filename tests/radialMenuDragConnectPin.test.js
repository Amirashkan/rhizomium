// Regression tests: the "drag + Tab" gesture must land the wire on the input pin that fits the
// source node, not blindly on pin 0.
//
// Bug: dragging a wire out of a Texture 2D (or any Compute) node, pressing Tab and picking a 2D
// transform wired the texture into the transform's pin 0 — "UV (opt.)" — because
// RadialMenu._createNode hardcoded `inputPin = 0`. The Texture pin (pin 1) stayed empty, so
// TransformNodes.getTextureBinding() found nothing, the node stayed in UV mode, and it passed
// downstream a "UV" that was really the sampled image. Same gesture with the wire dropped by hand
// on the Texture pin worked, which is what made it look like the transform itself was broken.
//
// Contract locked in: a texture source (Texture2D / Compute*) auto-connects to the target's Texture
// input pin when it has one; everything else still lands on pin 0.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RadialMenu } from '../src/ui/RadialMenu.js';
import { ConnectionManager } from '../src/core/ConnectionManager.js';
import { pickAutoConnectInputPin } from '../src/core/autoConnect.js';
import { makeNode } from '../src/data/NodeDefs.js';

describe('drag + Tab connects to the input pin that fits the source', () => {
  let graph;
  let connections;
  let menu;
  let previousEventHandler;
  let previousEditor;

  // Drop a source node into the graph and start dragging a wire out of its output pin, the state
  // the radial menu sees when Tab is pressed mid-drag.
  function dragFromOutputOf(kind) {
    const source = makeNode(kind, 0, 0);
    graph.nodes.push(source);
    connections.startWireDrag(source.id, 0, { x: 200, y: 100 }, false);
    return source;
  }

  // The node the menu just created — always the last one pushed.
  function created() {
    return graph.nodes[graph.nodes.length - 1];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    graph = { nodes: [], connections: [], selection: new Set() };
    connections = new ConnectionManager(graph, () => {});

    previousEventHandler = window.eventHandler;
    previousEditor = window.editor;
    window.eventHandler = { connections };
    window.editor = {};

    menu = new RadialMenu(graph, () => {});
    menu.canvasPos = { x: 200, y: 100 };
  });

  afterEach(() => {
    vi.useRealTimers();
    window.eventHandler = previousEventHandler;
    window.editor = previousEditor;
  });

  it('routes a Texture 2D into a Rotate 2D Texture pin, leaving UV free', () => {
    const source = dragFromOutputOf('Texture2D');

    menu._createNode('Rotate2D');
    const transform = created();

    expect(graph.connections).toEqual([
      { from: { nodeId: source.id, pin: 0 }, to: { nodeId: transform.id, pin: 1 } },
    ]);
    // The UV pin stays open so the transform keeps using the screen UV as its coordinate.
    expect(transform.inputs[0]).toBeNull();
    expect(transform.inputs[1]).toBe(source.id);
  });

  it('routes a Compute node into a Transform 2D Texture pin', () => {
    const source = dragFromOutputOf('ComputeNoise');

    menu._createNode('Transform2D');
    const transform = created();

    expect(transform.inputs[1]).toBe(source.id);
    expect(graph.connections[0].to).toEqual({ nodeId: transform.id, pin: 1 });
  });

  it('still uses pin 0 when the source is a coordinate rather than a texture', () => {
    const source = dragFromOutputOf('ConstVec2');

    menu._createNode('Rotate2D');
    const transform = created();

    expect(transform.inputs[0]).toBe(source.id);
    expect(graph.connections[0].to).toEqual({ nodeId: transform.id, pin: 0 });
  });

  it('still uses pin 0 for targets that have no Texture pin', () => {
    const source = dragFromOutputOf('ComputeNoise');

    menu._createNode('ComputeBlur'); // pinsIn: ["Input"]
    const blur = created();

    expect(blur.inputs[0]).toBe(source.id);
    expect(graph.connections[0].to).toEqual({ nodeId: blur.id, pin: 0 });
  });

  it('leaves the reverse drag alone: dragging from an input still takes output pin 0', () => {
    const target = makeNode('Transform2D', 0, 0);
    graph.nodes.push(target);
    // Drag backwards out of the transform's Texture pin, then Tab-create the source for it.
    connections.startWireDrag(target.id, 1, { x: 200, y: 100 }, true);

    menu._createNode('Texture2D');
    const source = created();

    expect(graph.connections).toEqual([
      { from: { nodeId: source.id, pin: 0 }, to: { nodeId: target.id, pin: 1 } },
    ]);
  });

  it('creates the node without a connection when there is no wire drag', () => {
    menu._createNode('Rotate2D');

    expect(graph.nodes).toHaveLength(1);
    expect(graph.connections).toHaveLength(0);
  });
});

describe('pickAutoConnectInputPin', () => {
  it('finds the Texture pin for every 2D transform', () => {
    for (const kind of ['Transform2D', 'Scale2D', 'Rotate2D', 'TileAndOffset', 'Flip2D',
      'PolarCoordinates', 'Twirl', 'Spherize']) {
      expect(pickAutoConnectInputPin('Texture2D', kind)).toBe(1);
    }
  });

  it('falls back to pin 0 for transforms with no Texture pin', () => {
    // UV to Color takes a UV and nothing else; Displacement's pin 1 is an Offset field.
    expect(pickAutoConnectInputPin('Texture2D', 'UVToColor')).toBe(0);
    expect(pickAutoConnectInputPin('Texture2D', 'Displacement')).toBe(0);
  });

  it('reports -1 for a target with no inputs at all', () => {
    expect(pickAutoConnectInputPin('Texture2D', 'ComputeNoise')).toBe(-1);
  });

  it('tolerates an unknown source or target kind', () => {
    expect(pickAutoConnectInputPin(undefined, 'Rotate2D')).toBe(0);
    expect(pickAutoConnectInputPin('Texture2D', 'NotANodeKind')).toBe(-1);
  });
});
