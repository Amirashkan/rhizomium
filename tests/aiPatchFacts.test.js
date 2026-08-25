import { describe, it, expect } from 'vitest';
import { patchFacts } from '../api/_lib/patchFacts.js';
import { buildUserMessage } from '../api/_lib/features.js';

/**
 * The graph arithmetic, done before the model sees the graph.
 *
 * Following every wire to work out which branches reach the output is the most
 * expensive thing a review does on a large patch, and the least reliable: it
 * is arithmetic, it scales with the graph, and a language model asked to do it
 * across sixty nodes miscounts. These tests are about the answers being right,
 * because a fact that is wrong is worse than no fact at all — the prompt tells
 * the model to trust them without checking.
 */

/** A patch built from `id kind` pairs and `from:pin->to:pin` wires. */
function patchOf(nodes, wires = []) {
  return {
    nodes: nodes.map(([id, kind, extra = {}]) => ({ id, kind, x: 0, y: 0, ...extra })),
    connections: wires.map(([from, fromPin, to, toPin]) => ({
      from: { nodeId: from, pin: fromPin },
      to: { nodeId: to, pin: toPin },
    })),
  };
}

describe('patchFacts', () => {
  it('says nothing about an empty canvas', () => {
    expect(patchFacts({ nodes: [], connections: [] })).toBe('');
    expect(patchFacts(null)).toBe('');
  });

  it('counts what reaches the output, and names what does not', () => {
    // solid -> out, and a stray Circle wired to nothing.
    const facts = patchFacts(
      patchOf([['solid', 'ComputeNoise'], ['out', 'OutputFinal'], ['stray', 'ComputePattern']], [
        ['solid', 0, 'out', 0],
      ])
    );

    expect(facts).toContain('2 of 3 nodes reach an Output node');
    expect(facts).toMatch(/Reach no Output node.*stray/);
  });

  it('follows a chain all the way back, not just one wire', () => {
    const facts = patchFacts(
      patchOf(
        [['a', 'ComputeNoise'], ['b', 'ComputeGlitch'], ['c', 'ComputeGlitch'], ['out', 'OutputFinal']],
        [['a', 0, 'b', 0], ['b', 0, 'c', 0], ['c', 0, 'out', 0]]
      )
    );

    expect(facts).toContain('4 of 4 nodes reach an Output node');
    expect(facts).not.toContain('Reach no Output node');
  });

  it('survives a cycle rather than walking it forever', () => {
    const facts = patchFacts(
      patchOf([['a', 'ComputeGlitch'], ['b', 'ComputeGlitch'], ['out', 'OutputFinal']], [
        ['a', 0, 'b', 0],
        ['b', 0, 'a', 0],
        ['b', 0, 'out', 0],
      ])
    );

    expect(facts).toContain('3 of 3 nodes reach an Output node');
  });

  it('says outright when nothing renders', () => {
    const facts = patchFacts(patchOf([['solid', 'ComputeNoise']]));

    expect(facts).toContain('Nothing in this patch is in the Output category');
    // No point counting what reaches an output that is not there.
    expect(facts).not.toContain('reach an Output node');
  });

  it('names empty input pins, and refuses to call them faults', () => {
    const facts = patchFacts(patchOf([['out', 'OutputFinal']]));

    expect(facts).toContain('out:0(color)');
    expect(facts).toContain('a list to judge, not a list of faults');
  });

  it('takes a variable-input node at its own pin count', () => {
    // A node the artist has opened up to three inputs, with one wired.
    const facts = patchFacts(
      patchOf(
        [['mix', 'ComputeMix', { inputCount: 3 }], ['solid', 'ComputeNoise'], ['out', 'OutputFinal']],
        [['solid', 0, 'mix', 0], ['mix', 0, 'out', 0]]
      )
    );

    expect(facts).toContain('mix:1');
    expect(facts).toContain('mix:2');
    expect(facts).not.toContain('mix:0');
  });

  it('reports a wire to a node or a pin that is not there', () => {
    const facts = patchFacts(
      patchOf([['out', 'OutputFinal']], [['ghost', 0, 'out', 0], ['out', 0, 'out', 7]])
    );

    expect(facts).toContain('ghost:0 -> out:0');
    expect(facts).toContain('out:0 -> out:7');
  });

  it('summarises rather than printing a wall of ids', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => [`n${i}`, 'ComputeNoise']);
    const facts = patchFacts(patchOf([...nodes, ['out', 'OutputFinal']]));

    expect(facts).toContain('and 28 more');
    expect(facts).not.toContain('n39');
  });

  it('rides along with the patch on every feature that is given one', () => {
    const patch = patchOf([['solid', 'ComputeNoise'], ['out', 'OutputFinal']], [['solid', 0, 'out', 0]]);

    for (const feature of ['ai.patch_review', 'ai.patch_refactor', 'ai.canvas_assist']) {
      expect(buildUserMessage(feature, { patch })).toContain('Worked out from the wires');
    }
  });
});
