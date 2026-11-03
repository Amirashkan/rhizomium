// Regression tests for the YAKO.rz 5 fps bug.
//
// A project whose nodes carry their media inside `node.params` — an Audio Sampler with the whole
// MP3 as a data URL (6.4 MB), 14 Text nodes each with an embedded font subset — ran at 6.3 fps
// with one CPU core pinned, while the GPU sat ~4% busy. Two independent faults multiplied:
//
//   1. PreviewComputer/NodeValueComputer._computeParameterHash was `JSON.stringify(node.params)`
//      and _buildDependentsMap ran the `node_<id>` regex (after a `.trim()` copy) over every
//      parameter value, so each preview refresh did ~7.4 MB of string work.
//   2. ComputeShaderManager.evaluateParam guarded that refresh with a 1 ms wall-clock window.
//      Since the refresh itself took longer than 1 ms, the window had always expired by the next
//      expression, so the refresh ran again for each of the 55 node-referencing expressions,
//      every frame — ~400 MB of string work per frame.
//
// These tests pin both fixes: large payloads are reduced to a signature and never regex-scanned,
// and the refresh runs once per frame however long it takes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LARGE_PARAM_VALUE_LENGTH,
  isLargeParamPayload,
  hasExpressionPrefix,
  paramPayloadSignature,
  computeParameterHash,
} from '../src/utils/paramPayloads.js';
import { isClockExpression, hasClockExpressionParam } from '../src/core/clockExpression.js';
import { expressionSystem } from '../src/utils/ParameterExpressionSystem.js';
import { textNodeHasLiveExpression } from '../src/core/TextRasterizer.js';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';
import { PreviewComputer } from '../src/core/PreviewComputer.js';
import { NodeValueComputer } from '../src/core/preview/NodeValueComputer.js';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';
import { ComputeShaderManager } from '../src/gpu/ComputeShaderManager.js';

/** An embedded media payload the size of YAKO's MP3. */
function audioDataUrl(bytes = 6.4 * 1024 * 1024, fill = 'A') {
  return `data:audio/mpeg;base64,${fill.repeat(bytes)}`;
}

function fontDataUrl(bytes = 70 * 1024) {
  return `data:font/woff2;base64,${'B'.repeat(bytes)}`;
}

/**
 * A payload that spells a clock identifier the way real base64 can: `+`, `/` and `=` are part of
 * the alphabet and are non-word characters, so `\btime\b` and an unanchored /time/i both match
 * inside one. The scans that used to run over payloads therefore did not just cost time, they
 * reported the node as animated.
 */
function payloadSpelling(word) {
  const half = 'A'.repeat(5000);
  return `data:audio/mpeg;base64,${half}+${word}/${half}`;
}

/** A graph shaped like YAKO.rz: 7.4 MB of params, 55 node-referencing expressions. */
function yakoLikeNodes() {
  const nodes = [
    { id: '35', kind: 'AudioSampler', inputs: [], params: { audioData: audioDataUrl(), gain: 1 } },
  ];
  for (let i = 0; i < 14; i++) {
    nodes.push({
      id: `t${i}`,
      kind: 'Text',
      inputs: [],
      params: { text: 'YAKO', fontData: fontDataUrl(), size: 48 },
    });
  }
  for (let i = 0; i < 55; i++) {
    nodes.push({
      id: `e${i}`,
      kind: 'ConstFloat',
      inputs: [],
      params: { value: `=node_${12 + (i % 6)} * 2` },
    });
  }
  return nodes;
}

describe('large parameter payloads (paramPayloads)', () => {
  it('classifies embedded media as a payload and leaves ordinary values alone', () => {
    expect(isLargeParamPayload(audioDataUrl())).toBe(true);
    expect(isLargeParamPayload(fontDataUrl())).toBe(true);

    expect(isLargeParamPayload('=node_12 * 2')).toBe(false);
    expect(isLargeParamPayload('0.5')).toBe(false);
    expect(isLargeParamPayload('Stripes')).toBe(false);
    expect(isLargeParamPayload(42)).toBe(false);
    expect(isLargeParamPayload(null)).toBe(false);
    expect(isLargeParamPayload(undefined)).toBe(false);
    expect(isLargeParamPayload({ big: 'no' })).toBe(false);
  });

  it('treats a value at the threshold as ordinary and one past it as a payload', () => {
    expect(isLargeParamPayload('x'.repeat(LARGE_PARAM_VALUE_LENGTH))).toBe(false);
    expect(isLargeParamPayload('x'.repeat(LARGE_PARAM_VALUE_LENGTH + 1))).toBe(true);
  });

  it('never treats an expression as a payload, however long it is', () => {
    const giant = `=node_12 ${'+ 1 '.repeat(5000)}`;
    expect(giant.length).toBeGreaterThan(LARGE_PARAM_VALUE_LENGTH);
    expect(isLargeParamPayload(giant)).toBe(false);
    expect(isLargeParamPayload(`   \n  ${giant}`)).toBe(false);
  });

  it('hashes a node with embedded media into a few hundred bytes, not megabytes', () => {
    const node = { id: '35', params: { audioData: audioDataUrl(), gain: 1 } };

    const hash = computeParameterHash(node);

    expect(hash.length).toBeLessThan(400);
    expect(hash).toContain(paramPayloadSignature(node.params.audioData));
    // Small parameters are still hashed in full, so ordinary edits stay detectable.
    expect(hash).toContain('"gain":1');
  });

  it('keeps the hash stable for an unchanged payload and changes it for a different one', () => {
    const a = { params: { audioData: audioDataUrl() } };
    const sameAgain = { params: { audioData: audioDataUrl() } };
    const shorter = { params: { audioData: audioDataUrl(6.4 * 1024 * 1024 - 1) } };
    const otherMedia = { params: { audioData: audioDataUrl(6.4 * 1024 * 1024, 'C') } };

    expect(computeParameterHash(a)).toBe(computeParameterHash(sameAgain));
    expect(computeParameterHash(a)).not.toBe(computeParameterHash(shorter));
    expect(computeParameterHash(a)).not.toBe(computeParameterHash(otherMedia));
  });

  it('still notices an edit to a small parameter sitting next to a payload', () => {
    const before = computeParameterHash({ params: { audioData: audioDataUrl(), gain: 1 } });
    const after = computeParameterHash({ params: { audioData: audioDataUrl(), gain: 2 } });

    expect(before).not.toBe(after);
  });

  it('hasExpressionPrefix matches trim().startsWith("=") without copying the value', () => {
    expect(hasExpressionPrefix('=node_12')).toBe(true);
    expect(hasExpressionPrefix('  \n\t =sin(time)')).toBe(true);
    expect(hasExpressionPrefix('0.5')).toBe(false);
    expect(hasExpressionPrefix('')).toBe(false);
    expect(hasExpressionPrefix('   ')).toBe(false);
    expect(hasExpressionPrefix(audioDataUrl())).toBe(false);
    expect(hasExpressionPrefix(7)).toBe(false);
    expect(hasExpressionPrefix(null)).toBe(false);

    // Same answer as the expression it replaces, for every ordinary value.
    for (const value of ['=x', ' =x', 'x', '', ' ', '=', 'a=b']) {
      expect(hasExpressionPrefix(value)).toBe(value.trim().startsWith('='));
    }
  });

  it('returns the documented sentinels for a missing node or unserialisable params', () => {
    expect(computeParameterHash(null)).toBe('no-params');
    expect(computeParameterHash({})).toBe('no-params');

    const cyclic = {};
    cyclic.self = cyclic;
    expect(computeParameterHash({ params: cyclic })).toBe('param-hash-error');
  });
});

describe('PreviewComputer with embedded media params', () => {
  let computer;

  beforeEach(() => {
    computer = new PreviewComputer();
  });

  it('_computeParameterHash does not copy the embedded payload', () => {
    const node = { id: '35', kind: 'AudioSampler', params: { audioData: audioDataUrl(), gain: 1 } };

    expect(computer._computeParameterHash(node).length).toBeLessThan(400);
  });

  it('_extractNodeReferences skips a payload but still reads real expressions', () => {
    expect(computer._extractNodeReferences(audioDataUrl())).toEqual([]);
    // Even a payload that happens to contain the reference text is not scanned: a data URL
    // never holds an expression, and scanning it is what cost the frame.
    expect(computer._extractNodeReferences(`${audioDataUrl()}node_12`)).toEqual([]);

    expect(computer._extractNodeReferences('=node_12 * 2')).toEqual(['12']);
    expect(computer._extractNodeReferences('=node_10_x + node_20_y')).toEqual(['10', '20']);
  });

  it('_buildDependentsMap still wires expression dependents across a 7 MB graph', () => {
    const nodes = yakoLikeNodes();

    const map = computer._buildDependentsMap(nodes);

    expect(map.get('12').has('e0')).toBe(true);
    expect(map.get('17').has('e5')).toBe(true);
    // The media nodes reference nothing, so they contribute no edges.
    expect(map.has('35')).toBe(false);
  });

  it('hashing and dependency-mapping a 7 MB graph 55 times stays well under a frame budget', () => {
    const nodes = yakoLikeNodes();

    const started = performance.now();
    for (let refresh = 0; refresh < 55; refresh++) {
      computer._buildDependentsMap(nodes);
      for (const node of nodes) computer._computeParameterHash(node);
    }
    const elapsed = performance.now() - started;

    // Before the fix this was ~400 MB of string work (55 x 7.4 MB) and took seconds. The budget
    // is deliberately loose so the test measures the algorithmic change, not the host machine.
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('NodeValueComputer with embedded media params', () => {
  it('_computeParameterHash does not copy the embedded payload', () => {
    const computer = new NodeValueComputer({ graph: { nodes: [] } });
    const node = { id: '35', kind: 'AudioSampler', params: { audioData: audioDataUrl() } };

    const hash = computer._computeParameterHash(node);

    expect(hash.length).toBeLessThan(400);
    expect(computer._computeParameterHash({ id: 'x' })).toBe('no-params');
  });
});

describe('PreviewIntegration with embedded media params', () => {
  it('_extractNodeReferences skips a payload but still reads real expressions', () => {
    const extract = PreviewIntegration.prototype._extractNodeReferences;

    expect(extract.call(null, audioDataUrl())).toEqual([]);
    expect(extract.call(null, '=node_12 * 2')).toEqual(['12']);
  });

  it('_buildExpressionDependentsMap ignores payloads and keeps expression edges', () => {
    const integration = Object.create(PreviewIntegration.prototype);
    integration.editor = { graph: { nodes: yakoLikeNodes() } };

    const map = integration._buildExpressionDependentsMap();

    expect(map.get('12').has('e0')).toBe(true);
    expect(map.has('35')).toBe(false);
  });
});

describe('ComputeShaderManager.evaluateParam preview refresh', () => {
  let refreshes;
  let previousEditor;

  function installEditor({ costMs = 0 } = {}) {
    refreshes = 0;
    const previewComputer = {
      computePreviews: () => {
        refreshes++;
        if (costMs > 0) {
          const until = performance.now() + costMs;
          while (performance.now() < until) { /* burn, like a real 7 MB refresh */ }
        }
      },
    };
    window.editor = { previewComputer, graph: { nodes: [] } };
    return previewComputer;
  }

  /** The 55 node-referencing expressions of one frame, all evaluated at the same sim time. */
  function evaluateFrame(manager, time) {
    for (let i = 0; i < 55; i++) {
      manager.evaluateParam(`=node_${12 + (i % 6)} * 2`, 0, time);
    }
  }

  beforeEach(() => {
    previousEditor = window.editor;
  });

  afterEach(() => {
    window.editor = previousEditor;
    vi.restoreAllMocks();
  });

  it('refreshes once per frame, not once per expression', () => {
    installEditor();
    const manager = Object.create(ComputeShaderManager.prototype);

    evaluateFrame(manager, 1.0);

    expect(refreshes).toBe(1);
  });

  it('refreshes again on the next frame', () => {
    installEditor();
    const manager = Object.create(ComputeShaderManager.prototype);

    evaluateFrame(manager, 1.0);
    evaluateFrame(manager, 1.016);
    evaluateFrame(manager, 1.032);

    expect(refreshes).toBe(3);
  });

  it('still refreshes once per frame when the refresh itself costs more than a millisecond', () => {
    // The original bug: the guard was a 1 ms window, so a refresh slower than 1 ms re-ran for
    // every expression in the frame.
    installEditor({ costMs: 3 });
    const manager = Object.create(ComputeShaderManager.prototype);

    evaluateFrame(manager, 2.0);

    expect(refreshes).toBe(1);
  });

  it('shares the per-frame refresh across every compute node in the frame', () => {
    installEditor();
    const a = Object.create(ComputeShaderManager.prototype);
    const b = Object.create(ComputeShaderManager.prototype);

    evaluateFrame(a, 4.0);
    evaluateFrame(b, 4.0);

    expect(refreshes).toBe(1);
  });

  it('does not refresh for an expression with no node reference', () => {
    installEditor();
    const manager = Object.create(ComputeShaderManager.prototype);

    manager.evaluateParam('=sin(time)', 0, 5.0);
    manager.evaluateParam('0.5', 0, 5.0);

    expect(refreshes).toBe(0);
  });

  it('falls back to a bounded wall-clock refresh when the clock is not advancing', () => {
    installEditor();
    const manager = Object.create(ComputeShaderManager.prototype);
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    manager.evaluateParam('=node_12', 0, Number.NaN);
    manager.evaluateParam('=node_12', 0, Number.NaN);
    expect(refreshes).toBe(1);

    clock += 101; // past the stall window
    manager.evaluateParam('=node_12', 0, Number.NaN);
    expect(refreshes).toBe(2);
  });

  it('leaves the value itself intact', () => {
    installEditor();
    const manager = Object.create(ComputeShaderManager.prototype);

    expect(manager.evaluateParam(0.25, 0, 1.0)).toBe(0.25);
    expect(manager.evaluateParam('0.75', 0, 1.0)).toBe(0.75);
    expect(manager.evaluateParam(true, 0, 1.0)).toBe(1.0);
    expect(manager.evaluateParam('Stripes', 7, 1.0)).toBe(7);
  });
});

describe('clock-expression detection with embedded media params', () => {
  it('does not read a clock identifier out of a media payload', () => {
    // base64 can spell `+time/`, and the clock regex is word-bounded, so the unguarded test
    // matched — marking an Audio Sampler clock-driven for the rest of the session.
    expect(isClockExpression(payloadSpelling('time'))).toBe(false);
    expect(isClockExpression(payloadSpelling('frame'))).toBe(false);
    expect(isClockExpression(payloadSpelling('audioEnvelope'))).toBe(false);

    expect(hasClockExpressionParam({
      id: '35',
      kind: 'AudioSampler',
      params: { audioData: payloadSpelling('time'), gain: 1 },
    })).toBe(false);
  });

  it('still detects a real clock expression', () => {
    expect(isClockExpression('=sin(time)')).toBe(true);
    expect(isClockExpression('sin(time)')).toBe(true);
    expect(isClockExpression('=audioEnvelopeBass * 2')).toBe(true);
    expect(isClockExpression('timeline')).toBe(false);

    expect(hasClockExpressionParam({
      id: 't0',
      kind: 'Text',
      params: { fontData: fontDataUrl(), size: '=sin(time) * 10' },
    })).toBe(true);
  });
});

describe('expressionSystem.isExpression with embedded media params', () => {
  it('answers without copying the payload and keeps its old answers', () => {
    expect(expressionSystem.isExpression(audioDataUrl())).toBe(false);
    expect(expressionSystem.isExpression('=node_12')).toBe(true);
    expect(expressionSystem.isExpression('  =sin(time)')).toBe(true);
    expect(expressionSystem.isExpression('0.5')).toBe(false);
    expect(expressionSystem.isExpression(3)).toBe(false);
    expect(expressionSystem.isExpression(undefined)).toBe(false);
  });
});

describe('TextRasterizer.textNodeHasLiveExpression with an embedded font', () => {
  it('ignores the font payload and still reads the text params', () => {
    const font = fontDataUrl();

    expect(textNodeHasLiveExpression({ kind: 'Text', params: { fontData: font, text: 'YAKO' } }))
      .toBe(false);
    expect(textNodeHasLiveExpression({ kind: 'Text', params: { fontData: font, size: '=sin(time)' } }))
      .toBe(true);
    expect(textNodeHasLiveExpression({ kind: 'Text', params: { fontData: font, text: 'bpm {level}' } }))
      .toBe(true);
    expect(textNodeHasLiveExpression({ kind: 'Circle', params: { r: '=sin(time)' } })).toBe(false);
  });
});

describe('FragmentTextureRenderer._hasTimeDependentParameters with embedded media', () => {
  const hasTimeDeps = (nodes) =>
    FragmentTextureRenderer.prototype._hasTimeDependentParameters.call(null, nodes[0], nodes);

  it('does not read `time` out of a font payload', () => {
    // The match is unanchored and case-insensitive, so any payload spelling "time" in any case
    // marked the node animated — re-rasterising all 14 Text nodes every frame.
    expect(hasTimeDeps([
      { id: 't0', kind: 'Text', params: { fontData: payloadSpelling('TiMe'), text: 'YAKO' } },
    ])).toBe(false);
  });

  it('still detects a real time or audio parameter anywhere in the chain', () => {
    expect(hasTimeDeps([
      { id: 't0', kind: 'Text', params: { fontData: fontDataUrl(), size: '=sin(time) * 10' } },
    ])).toBe(true);
    expect(hasTimeDeps([
      { id: 'c0', kind: 'Circle', params: { r: 0.5 } },
      { id: 'c1', kind: 'Circle', params: { r: '=audioEnvelope' } },
    ])).toBe(true);
    expect(hasTimeDeps([
      { id: 'c0', kind: 'Circle', params: { r: 0.5 } },
    ])).toBe(false);
  });
});

describe('preview renderers hasExpressions with embedded media params', () => {
  it('answers without copying the payload', async () => {
    const modules = await Promise.all([
      import('../src/core/preview/renderers/BasicRenderers.js'),
      import('../src/core/preview/renderers/TransformRenderers.js'),
      import('../src/core/preview/renderers/NoiseRenderers.js'),
      import('../src/core/preview/renderers/TextureRenderers.js'),
    ]);
    const classes = [
      modules[0].BasicRenderers,
      modules[1].TransformRenderers,
      modules[2].NoiseRenderers,
      modules[3].TextureRenderers,
    ];

    for (const Cls of classes) {
      const hasExpressions = Cls.prototype.hasExpressions;
      expect(hasExpressions.call(null, { params: { audioData: audioDataUrl() } })).toBe(false);
      expect(hasExpressions.call(null, { params: { fontData: fontDataUrl(), size: '=sin(time)' } }))
        .toBe(true);
      expect(hasExpressions.call(null, { params: { size: 10 } })).toBe(false);
      expect(hasExpressions.call(null, {})).toBe(false);
    }
  });
});
