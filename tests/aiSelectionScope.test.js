import { describe, it, expect } from 'vitest';

/**
 * What "Selection" is supposed to mean.
 *
 * The panel has had a scope switch since the AI features landed, and it only
 * ever changed what was *sent*. Everything downstream — the facts worked out
 * from the wires, the prompt, the check on the answer, and above all what the
 * editor did with the answer — treated a selection as though it were the whole
 * document. The result was that the two scopes did the same thing to the
 * canvas, and the narrower one did more damage:
 *
 *   A refactor of six nodes out of a hundred came back as a six-node patch,
 *   and the editor imported it over the canvas. The other ninety-four nodes
 *   were gone.
 *
 *   Before that could even happen, the answer had to survive a check that
 *   every returned patch contains an Output node. A selection of three maths
 *   nodes does not, so a correct answer was refused as broken — after the
 *   artist had been charged for it.
 *
 *   And the model was being told, in facts presented as exact, that nothing in
 *   the patch renders and that pins fed from outside the selection are empty.
 *
 * These tests hold the fixed behaviour: the selection travels with its edges,
 * the edges are described rather than dropped, and the answer is spliced back
 * into the patch it came out of.
 */

const { buildPatchContext } = await import('../src/ai/patchContext.js');
const { planSelectionSplice } = await import('../src/ai/applyResult.js');
const { patchFacts } = await import('../api/_lib/patchFacts.js');
const { describePatch, buildUserMessage } = await import('../api/_lib/features.js');
const { validateGeneratedPatch } = await import('../api/_lib/nodeCatalog.js');

/**
 * uv → mul → mix → out, with `mul` and `mix` the part an artist would select:
 * a middle slice, wired to something on each side.
 */
function project() {
  return {
    nodes: [
      { id: 'uv', kind: 'UV', position: { x: 0, y: 0 }, params: {} },
      { id: 'mul', kind: 'Multiply', position: { x: 200, y: 0 }, params: {} },
      { id: 'mix', kind: 'Mix', position: { x: 400, y: 0 }, params: { amount: 0.5 } },
      { id: 'out', kind: 'OutputFinal', position: { x: 600, y: 0 }, params: {} },
    ],
    connections: [
      { from: { nodeId: 'uv', pin: 0 }, to: { nodeId: 'mul', pin: 0 } },
      { from: { nodeId: 'mul', pin: 0 }, to: { nodeId: 'mix', pin: 0 } },
      { from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
    ],
  };
}

const MIDDLE = ['mul', 'mix'];

describe('the patch a selection sends', () => {
  it('carries the wires that cross its edge, with the outside node named', () => {
    const patch = buildPatchContext(project(), { nodeIds: MIDDLE });

    expect(patch.scope).toBe('selection');
    expect(patch.nodes.map((node) => node.id)).toEqual(['mul', 'mix']);
    // Its own wire is an ordinary connection; the two crossing ones are not.
    expect(patch.connections).toHaveLength(1);
    expect(patch.boundary).toHaveLength(2);

    const incoming = patch.boundary.find((edge) => edge.direction === 'in');
    expect(incoming).toMatchObject({
      inside: { nodeId: 'mul', pin: 0 },
      outside: { nodeId: 'uv', kind: 'UV', pin: 0 },
    });

    const outgoing = patch.boundary.find((edge) => edge.direction === 'out');
    expect(outgoing).toMatchObject({
      inside: { nodeId: 'mix', pin: 0 },
      outside: { nodeId: 'out', kind: 'OutputFinal', pin: 0 },
    });
  });

  it('says how large the patch it came out of is', () => {
    expect(buildPatchContext(project(), { nodeIds: MIDDLE }).patchNodeCount).toBe(4);
  });

  it('leaves a whole-patch send exactly as it was', () => {
    const patch = buildPatchContext(project());
    expect(patch.scope).toBe('patch');
    expect(patch.boundary).toEqual([]);
    expect(patch.connections).toHaveLength(3);
  });
});

describe('what the model is told about a selection', () => {
  const patch = buildPatchContext(project(), { nodeIds: MIDDLE });

  it('draws the crossing wires apart from the patch, marked as outside', () => {
    const text = describePatch(patch);
    expect(text).toContain('Wires crossing the edge of the selection:');
    expect(text).toContain('uv:0 [UV, outside] -> mul:0');
    expect(text).toContain('mix:0 -> out:0 [OutputFinal, outside]');
  });

  it('no longer claims a selection with no Output node renders nothing', () => {
    const facts = patchFacts(patch);
    expect(facts).not.toContain('none of it renders');
    expect(facts).toContain('2 nodes selected out of a patch of 4');
    // `mix` feeds the rest of the patch, so both nodes reach something.
    expect(facts).toContain('2 of 2 selected nodes reach an Output node');
    expect(facts).not.toContain('Reach neither');
  });

  it('does not report a pin fed from outside the selection as empty', () => {
    const facts = patchFacts(patch);
    // mul:0 is wired to uv, which was not selected. mul:1 really is empty.
    expect(facts).toContain('mul:1');
    expect(facts).not.toContain('mul:0');
  });

  it('still says none of a whole patch renders when nothing outputs', () => {
    const noOutput = buildPatchContext({
      nodes: [{ id: 'uv', kind: 'UV', position: { x: 0, y: 0 } }],
      connections: [],
    });
    expect(patchFacts(noOutput)).toContain('none of it renders');
  });

  it('tells a scoped refactor the rest of the patch is not its to change', () => {
    const message = buildUserMessage('ai.patch_refactor', { patch });
    expect(message).toContain('Tidy the selected part of this patch');
    expect(message).toContain('Keep the ids you were given');
    expect(message).toContain('do not delete a branch because it reaches no Output node');
  });

  it('says none of that when the whole patch was sent', () => {
    const message = buildUserMessage('ai.patch_refactor', { patch: buildPatchContext(project()) });
    expect(message).toContain('Tidy this patch');
    expect(message).not.toContain('Keep the ids you were given');
  });
});

describe('checking a scoped answer', () => {
  const selection = {
    nodes: [
      { id: 'mul', kind: 'Multiply', x: 200, y: 0, params: {} },
      { id: 'mix', kind: 'Mix', x: 400, y: 0, params: { amount: 0.5 } },
    ],
    connections: [{ from: { nodeId: 'mul', pin: 0 }, to: { nodeId: 'mix', pin: 0 } }],
  };

  it('is refused for having no Output node when it is the whole document', () => {
    expect(() => validateGeneratedPatch(selection)).toThrow(/no output node/i);
  });

  it('is accepted when it is a piece of one', () => {
    const { patch } = validateGeneratedPatch(selection, { requireOutput: false });
    expect(patch.nodes.map((node) => node.id)).toEqual(['mul', 'mix']);
  });
});

describe('splicing a refactored selection back into the patch', () => {
  /** What a refactor of the middle slice might give back. */
  const answer = {
    nodes: [
      { id: 'mul', kind: 'Multiply', x: 200, y: 0, name: 'scale uv', params: {} },
      { id: 'mix', kind: 'Mix', x: 400, y: 0, params: { amount: 0.25 } },
    ],
    connections: [{ from: { nodeId: 'mul', pin: 0 }, to: { nodeId: 'mix', pin: 0 } }],
  };

  it('keeps every node outside the selection', () => {
    const plan = planSelectionSplice(answer, { projectData: project(), nodeIds: MIDDLE });

    expect(plan.projectData.nodes.map((node) => node.id)).toEqual(['uv', 'mul', 'mix', 'out']);
    expect(plan.untouched).toBe(2);
    expect(plan.replaced).toBe(2);
    expect(plan.removed).toEqual([]);
  });

  it('reconnects the wires that crossed the edge', () => {
    const plan = planSelectionSplice(answer, { projectData: project(), nodeIds: MIDDLE });

    expect(plan.reconnected).toBe(2);
    expect(plan.droppedWires).toEqual([]);
    const wires = plan.projectData.connections.map(
      (conn) => `${conn.from.nodeId}:${conn.from.pin}->${conn.to.nodeId}:${conn.to.pin}`
    );
    expect(wires).toContain('uv:0->mul:0');
    expect(wires).toContain('mix:0->out:0');
    expect(wires).toContain('mul:0->mix:0');
  });

  it('takes the refactor\'s names and parameters', () => {
    const plan = planSelectionSplice(answer, { projectData: project(), nodeIds: MIDDLE });
    const nodes = new Map(plan.projectData.nodes.map((node) => [node.id, node]));

    expect(nodes.get('mul').name).toBe('scale uv');
    expect(nodes.get('mix').params.amount).toBe(0.25);
    // And leaves the rest of the patch's own records alone.
    expect(nodes.get('out')).toEqual(project().nodes[3]);
  });

  it('drops a node the refactor removed, and says which wire went with it', () => {
    const dropped = {
      nodes: [{ id: 'mix', kind: 'Mix', x: 400, y: 0, params: {} }],
      connections: [],
    };
    const plan = planSelectionSplice(dropped, { projectData: project(), nodeIds: MIDDLE });

    expect(plan.removed).toEqual(['mul']);
    expect(plan.projectData.nodes.map((node) => node.id)).toEqual(['uv', 'mix', 'out']);
    expect(plan.droppedWires).toEqual(['uv:0 → mul:0 (mul was removed)']);
    // The wire out of the selection is untouched by any of that.
    expect(plan.reconnected).toBe(1);
  });

  it('will not let a generated node take the id of one outside the selection', () => {
    const collides = {
      nodes: [
        { id: 'mul', kind: 'Multiply', x: 200, y: 0, params: {} },
        { id: 'mix', kind: 'Mix', x: 400, y: 0, params: {} },
        { id: 'out', kind: 'Multiply', x: 500, y: 0, params: {} },
      ],
      connections: [{ from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } }],
    };
    const plan = planSelectionSplice(collides, { projectData: project(), nodeIds: MIDDLE });

    expect(plan.renamed).toEqual([{ from: 'out', to: 'out_ai' }]);
    // The artist's OutputFinal is still an OutputFinal, and still wired.
    const nodes = new Map(plan.projectData.nodes.map((node) => [node.id, node]));
    expect(nodes.get('out').kind).toBe('OutputFinal');
    expect(nodes.get('out_ai').kind).toBe('Multiply');

    const wires = plan.projectData.connections.map(
      (conn) => `${conn.from.nodeId}:${conn.from.pin}->${conn.to.nodeId}:${conn.to.pin}`
    );
    expect(wires).toContain('mix:0->out:0');
    expect(wires).toContain('mix:0->out_ai:0');
  });

  it('will not cut a wire from the rest of the patch to make room for its own', () => {
    // The model wires something into mix:0 — the pin `mul` already feeds. The
    // artist's own wiring is placed first, so this one is dropped rather than
    // the boundary being rewired around it.
    const greedy = {
      nodes: [
        { id: 'mul', kind: 'Multiply', x: 200, y: 0, params: {} },
        { id: 'mix', kind: 'Mix', x: 400, y: 0, params: {} },
      ],
      connections: [{ from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'mul', pin: 0 } }],
    };
    const plan = planSelectionSplice(greedy, { projectData: project(), nodeIds: MIDDLE });

    const intoMul = plan.projectData.connections.filter((conn) => conn.to.nodeId === 'mul');
    expect(intoMul).toHaveLength(1);
    expect(intoMul[0].from.nodeId).toBe('uv');
  });

  it('keeps a texture the model only saw a placeholder for', () => {
    const withTexture = {
      nodes: [
        { id: 'tex', kind: 'Texture2D', position: { x: 0, y: 0 }, params: { image: 'data:image/png;base64,AAAA' } },
        { id: 'out', kind: 'OutputFinal', position: { x: 200, y: 0 }, params: {} },
      ],
      connections: [{ from: { nodeId: 'tex', pin: 0 }, to: { nodeId: 'out', pin: 0 } }],
    };
    const echoed = {
      nodes: [{ id: 'tex', kind: 'Texture2D', x: 0, y: 40, params: { image: '<embedded data>' } }],
      connections: [],
    };

    const plan = planSelectionSplice(echoed, { projectData: withTexture, nodeIds: ['tex'] });
    const tex = plan.projectData.nodes.find((node) => node.id === 'tex');

    expect(tex.params.image).toBe('data:image/png;base64,AAAA');
    // The move it did make still lands.
    expect(tex.position.y).toBe(40);
  });
});
