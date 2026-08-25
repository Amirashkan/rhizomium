import { describe, it, expect } from 'vitest';
import { buildUserMessage, describePatch, AI_FEATURES } from '../api/_lib/features.js';
import { nodeCatalogText, isDefaultParamValue } from '../api/_lib/nodeCatalog.js';

/**
 * What a patch costs on its way to the model.
 *
 * Every AI feature in the editor is metered, and the graph is the bulk of what
 * each call sends. These tests hold the encoding to two things: it must say
 * everything a model needs to name a node in its answer, and it must not say
 * anything twice.
 */

describe('describePatch', () => {
  it('writes a node as one line, with its id, kind and position', () => {
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'UV', x: 0, y: 0 }],
      connections: [],
    });

    expect(text.split('\n')[0]).toBe('a UV @0,0');
  });

  it('keeps the artist\'s own name for a node', () => {
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'UV', x: 0, y: 0, name: 'base coords' }],
      connections: [],
    });

    expect(text).toContain('a UV @0,0 "base coords"');
  });

  it('omits a parameter sitting at its registry default', () => {
    // The catalogue in the system prompt already states this default. Sending
    // it again is the same fact, paid for twice.
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'SDFSmoothUnion', x: 0, y: 0, params: { smoothness: 0.1 } }],
      connections: [],
    });

    expect(text).toBe('a SDFSmoothUnion @0,0\n\n(No wires: nothing in this patch is connected to anything else.)');
  });

  it('keeps a parameter the artist moved', () => {
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'SDFSmoothUnion', x: 0, y: 0, params: { smoothness: 0.42 } }],
      connections: [],
    });

    expect(text).toContain('smoothness=0.42');
  });

  it('keeps a parameter the registry gives no default', () => {
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'CustomGLSL', x: 0, y: 0, params: { inputCount: 3 } }],
      connections: [],
    });

    // Not a declared default, so there is nothing in the prompt saying it.
    expect(text).toContain('inputCount=3');
  });

  it('quotes a value that could not be read back bare', () => {
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'CustomGLSL', x: 0, y: 0, params: { code: 'sin(input0)\n* 2.0' } }],
      connections: [],
    });

    const line = text.split('\n')[0];
    expect(line).toContain('code="sin(input0)\\n* 2.0"');
    // One node, one line: a newline inside a value must not break the format.
    expect(line.endsWith('"')).toBe(true);
  });

  it('leaves numbers and booleans unquoted', () => {
    const text = describePatch({
      nodes: [{ id: 'a', kind: 'ConstFloat', x: 0, y: 0, params: { value: 2.5 } }],
      connections: [],
    });

    expect(text).toContain('value=2.5');
  });

  it('writes both pin indices on every wire', () => {
    // Pins are what the model has to get right in its own answers; leaving a
    // zero implicit here would teach it that they are optional.
    const text = describePatch({
      nodes: [
        { id: 'a', kind: 'UV', x: 0, y: 0 },
        { id: 'b', kind: 'OutputFinal', x: 220, y: 0 },
      ],
      connections: [{ from: { nodeId: 'a', pin: 0 }, to: { nodeId: 'b', pin: 1 } }],
    });

    expect(text).toContain('a:0 -> b:1');
  });

  it('says so plainly when there is nothing on the canvas', () => {
    expect(describePatch({})).toBe('(The canvas is empty.)');
    expect(describePatch(undefined)).toBe('(The canvas is empty.)');
  });

  it('is dramatically shorter than the same graph as indented JSON', () => {
    const nodes = [];
    for (let i = 0; i < 40; i += 1) {
      nodes.push({
        id: `n${i}`,
        kind: 'SDFSmoothUnion',
        x: i * 220,
        y: 0,
        params: { smoothness: 0.1 },
      });
    }
    const patch = { nodes, connections: [] };

    const asJson = JSON.stringify(patch, null, 1).length;
    expect(describePatch(patch).length).toBeLessThan(asJson / 4);
  });
});

describe('buildUserMessage', () => {
  it('sends the patch in the line format, not as JSON', () => {
    const message = buildUserMessage('ai.patch_review', {
      patch: { nodes: [{ id: 'a', kind: 'UV', x: 0, y: 0 }], connections: [] },
    });

    expect(message).toContain('a UV @0,0');
    expect(message).not.toContain('```json');
  });

  it('still tells the model which nodes are selected', () => {
    const message = buildUserMessage('ai.canvas_assist', {
      patch: { nodes: [{ id: 'a', kind: 'UV', x: 0, y: 0 }], connections: [] },
      selectedNodeIds: ['a'],
    });

    expect(message).toContain('selected: a');
  });
});

describe('the cached prefix', () => {
  it('explains the patch format in every feature\'s system prompt', () => {
    // The format is only cheap because it is described once, in the part of
    // the request that is cached. A feature that omitted it would be sending
    // the model a notation it was never taught.
    for (const config of Object.values(AI_FEATURES)) {
      expect(config.system()).toContain('compact line format');
    }
  });

  it('is byte-identical between calls', () => {
    // Prefix caching survives nothing else.
    expect(nodeCatalogText()).toBe(nodeCatalogText());
    expect(AI_FEATURES['ai.patch_review'].system()).toBe(
      AI_FEATURES['ai.patch_review'].system()
    );
  });
});

describe('isDefaultParamValue', () => {
  it('compares by value, so a colour array is not sent back unchanged', () => {
    expect(isDefaultParamValue('SDFSmoothUnion', 'smoothness', 0.1)).toBe(true);
    expect(isDefaultParamValue('SDFSmoothUnion', 'smoothness', 0.2)).toBe(false);
  });

  it('is false for anything it cannot vouch for', () => {
    expect(isDefaultParamValue('NoSuchNode', 'smoothness', 0.1)).toBe(false);
    expect(isDefaultParamValue('SDFSmoothUnion', 'notAParam', 0.1)).toBe(false);
  });
});
