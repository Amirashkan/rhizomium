// Regression test: a fragment node's GPU thumbnail preview builds its OWN uniform manager (separate
// from the main renderer's). An Audio node's value is advanced every frame by
// AudioAnalysisProcessor and written only into the MAIN uniform manager, so the preview's copy of
// `<id>.value` stayed at its compile-time default (0). A Circle whose radius is `=node_<id>`
// therefore rendered a FROZEN thumbnail even though the main output reacted to audio.
//
// Fix: _syncAudioUniforms() overwrites that preview-snapshot entry with the live node value
// (__audio_value) before each render, mirroring _syncHoldUniforms() for Hold.
// _buildFragmentNodeHash() folds it in too, so a non-forced render path re-fires when it moves.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

describe('Audio live values sync into a fragment preview', () => {
  let savedGraph, savedEditor;
  beforeEach(() => { savedGraph = window.graph; savedEditor = window.editor; });
  afterEach(() => { window.graph = savedGraph; window.editor = savedEditor; });

  function setupGraph(audio) {
    const nodes = [audio];
    window.editor = { graph: { nodes } };
    window.graph = { getNode: (id) => nodes.find((n) => String(n.id) === String(id)) };
  }

  // Drive the real methods without the constructor (which needs a GPUDevice).
  const fr = () => Object.create(FragmentTextureRenderer.prototype);

  function fakeUniformManager(entries) {
    return { uniformValues: new Map(entries) };
  }

  it('overwrites <id>.value with the live node value', () => {
    const audio = { id: '27', kind: 'Audio', params: { channel: 'level' }, __audio_value: 0.63 };
    setupGraph(audio);

    // Preview snapshot compiled with defaults (0), plus an unrelated uniform that must be untouched.
    const um = fakeUniformManager([['27.value', 0], ['9.radius', 0.5]]);
    fr()._syncAudioUniforms(um);

    expect(um.uniformValues.get('27.value')).toBeCloseTo(0.63, 6);
    expect(um.uniformValues.get('9.radius')).toBe(0.5); // unrelated key untouched
  });

  it('does not touch a `.value` key that belongs to a non-Audio node', () => {
    // `value` is a common parameter name — a Float node has one — so the kind check is what keeps
    // this from stamping on someone else's uniform.
    const other = { id: '5', kind: 'ConstFloat', params: { value: 0.5 } };
    setupGraph(other);
    const um = fakeUniformManager([['5.value', 0.5]]);
    fr()._syncAudioUniforms(um);
    expect(um.uniformValues.get('5.value')).toBe(0.5);
  });

  it('hash changes when the referenced value moves', () => {
    const audio = { id: '27', kind: 'Audio', params: { channel: 'level' }, __audio_value: 0.2 };
    // A Circle whose radius references the audio node.
    const circle = { id: '30', kind: 'Circle', params: { radius: '=node_27' } };
    const nodes = [audio, circle];
    window.editor = { graph: { nodes } };
    window.graph = { getNode: (id) => nodes.find((n) => String(n.id) === String(id)) };

    const r = fr();
    const h1 = r._buildFragmentNodeHash(circle, 0, {});
    audio.__audio_value = 0.85;
    const h2 = r._buildFragmentNodeHash(circle, 0, {});
    expect(h1).not.toBe(h2);
  });
});
