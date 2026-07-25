// Regression test: a fragment node's GPU thumbnail preview builds its OWN uniform manager (separate
// from the main renderer's). The Audio Analysis outputs are advanced every frame by
// AudioAnalysisProcessor and written only into the MAIN uniform manager, so the preview's copies of
// `<id>.level/.kick/...` stayed at their compile-time default (0). A Circle whose radius is
// "=node_<id>_0" therefore rendered a FROZEN thumbnail even though the main output reacted to audio.
//
// Fix: _syncAudioUniforms() overwrites those preview-snapshot entries with the live node values
// (__audio_<pin>) before each render, mirroring _syncHoldUniforms() for Hold.
// _buildFragmentNodeHash() also folds in all three so a non-forced render path re-fires when any of
// them changes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

describe('Audio Analysis live values sync into a fragment preview', () => {
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

  it('overwrites <id>.level/.kick/.kickTrig with the live node values', () => {
    const audio = { id: '27', kind: 'AudioAnalysis', params: {},
      __audio_level: 0.63, __audio_kick: 0.4, __audio_kickTrig: 1 };
    setupGraph(audio);

    // Preview snapshot compiled with defaults (0), plus an unrelated uniform that must be untouched.
    const um = fakeUniformManager([
      ['27.level', 0], ['27.kick', 0], ['27.kickTrig', 0], ['9.radius', 0.5],
    ]);
    fr()._syncAudioUniforms(um);

    expect(um.uniformValues.get('27.level')).toBeCloseTo(0.63, 6);
    expect(um.uniformValues.get('27.kick')).toBeCloseTo(0.4, 6);
    expect(um.uniformValues.get('27.kickTrig')).toBeCloseTo(1, 6);
    expect(um.uniformValues.get('9.radius')).toBe(0.5); // unrelated key untouched
  });

  it('does not touch matching keys that belong to a non-Audio node', () => {
    const other = { id: '5', kind: 'ConstFloat', params: {} };
    setupGraph(other);
    const um = fakeUniformManager([['5.level', 0.5]]);
    fr()._syncAudioUniforms(um);
    expect(um.uniformValues.get('5.level')).toBe(0.5);
  });

  it('hash changes when the referenced level (pin 0) moves, not only the kick', () => {
    const audio = { id: '27', kind: 'AudioAnalysis', params: {},
      __audio_level: 0.2, __audio_kick: 0.3, __audio_kickTrig: 0 };
    // A Circle whose radius references pin 0 (level) of the audio node.
    const circle = { id: '30', kind: 'Circle', params: { radius: '=node_27_0' } };
    const nodes = [audio, circle];
    window.editor = { graph: { nodes } };
    window.graph = { getNode: (id) => nodes.find((n) => String(n.id) === String(id)) };

    const r = fr();
    const h1 = r._buildFragmentNodeHash(circle, 0, {});
    audio.__audio_level = 0.85; // only the level changed
    const h2 = r._buildFragmentNodeHash(circle, 0, {});
    expect(h1).not.toBe(h2);
  });
});
