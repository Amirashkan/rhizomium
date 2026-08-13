// Regression: a `=node_<wave>` reference has to be evaluated from the CLOCK, not from the node's
// preview value.
//
// Bug (reported as "the feedback doesn't show the wave, it just updates time to time, and it's
// stepped"): a Wave was not one of the kinds ParameterExpressionSystem resolves live, so
// `=node_<wave>` fell through to node.__preview / PreviewComputer's cache — refreshed by the
// preview pass, which is throttled to ~10fps. Two things followed:
//
//   1. the value moved in ~10fps steps instead of smoothly (visible as stepped motion), and
//   2. FragmentTextureRenderer's render hash folds in the EVALUATED value of each `=expression`
//      param to decide whether to re-render. A value that only changes at the throttled cadence
//      means the texture bridged into a compute node is only re-rendered at that cadence — so a
//      Wave -> Polygon.centerY -> Compute Feedback chain updated a few times a second.
//
// A wave is pure maths on the clock, so it can be evaluated exactly at any instant, and is.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ParameterExpressionSystem } from '../src/utils/ParameterExpressionSystem.js';
import { evaluateWaveNode, evaluateWave } from '../src/core/waveform.js';

describe('Wave reference liveness (CPU evaluation)', () => {
  let es, wave;
  const consumer = { id: 'poly', kind: 'Polygon', params: {} };

  const atTime = (t) => {
    window.renderLoop._simTime = t;
    return es.evaluateExpression('=node_7', { time: t }, consumer);
  };

  beforeEach(() => {
    es = new ParameterExpressionSystem();
    wave = {
      id: '7',
      kind: 'Wave',
      inputs: [null],
      params: { shape: 'Sine', frequency: 0.5, unipolar: true },
      // A deliberately stale preview value: this is what the buggy path returned.
      __preview: 0.123,
    };
    globalThis.window = globalThis.window || {};
    window.renderLoop = { _simTime: 0 };
    window.editor = {
      graph: { nodes: [wave, consumer] },
      previewComputer: { lastComputedValues: new Map([['7', 0.123]]) },
    };
  });

  afterEach(() => {
    delete window.editor;
    delete window.renderLoop;
  });

  it('evaluates the wave from the clock, ignoring its throttled preview value', () => {
    const t = 1.0;
    const expected = evaluateWave({ shape: 'Sine', frequency: 0.5, unipolar: true, time: t });
    expect(atTime(t)).toBeCloseTo(expected, 6);
    // The stale __preview must not leak through — that was the whole bug.
    expect(atTime(t)).not.toBeCloseTo(0.123, 3);
  });

  it('moves smoothly frame to frame instead of stepping at the preview cadence', () => {
    // Twelve consecutive 60fps frames must give twelve distinct values. Under the bug these came
    // in flat runs of ~6, which is what read as stepped motion.
    const values = [];
    for (let i = 0; i < 12; i++) values.push(atTime(1.0 + i / 60));

    expect(new Set(values.map(v => v.toFixed(6))).size).toBe(12);
    // ...and they trace the actual wave, not just any changing number.
    values.forEach((v, i) => {
      const t = 1.0 + i / 60;
      expect(v).toBeCloseTo(
        evaluateWave({ shape: 'Sine', frequency: 0.5, unipolar: true, time: t }), 6
      );
    });
  });

  it('tracks a sync restart, so a synced wave reads its restarted cycle', () => {
    wave.__waveSyncTime = 1.0;
    expect(atTime(1.0)).toBeCloseTo(
      evaluateWave({ shape: 'Sine', frequency: 0.5, unipolar: true, time: 1.0, syncTime: 1.0 }), 6
    );
  });

  it('follows the wave params, so editing Frequency changes the reference immediately', () => {
    const slow = atTime(0.5);
    wave.params.frequency = 4;
    const fast = atTime(0.5);
    expect(slow).not.toBeCloseTo(fast, 3);
  });

  it('leaves ordinary nodes on the preview path', () => {
    // Only clock-driven kinds are resolved live; a Remap still reads its computed preview.
    const remap = { id: '9', kind: 'Remap', params: {}, __preview: 0.42 };
    window.editor.graph.nodes.push(remap);
    window.editor.previewComputer.lastComputedValues.set('9', 0.42);
    expect(es.evaluateExpression('=node_9', {}, consumer)).toBeCloseTo(0.42);
  });
});

describe('evaluateWaveNode', () => {
  it('reads the node params, sync origin and unipolar flag', () => {
    const node = {
      kind: 'Wave',
      params: { shape: 'Square', frequency: 2, pulseWidth: 0.25, amplitude: 3, offset: 1 },
      __waveSyncTime: 0.5,
    };
    expect(evaluateWaveNode(node, 1.0)).toBeCloseTo(
      evaluateWave({
        shape: 'Square', frequency: 2, pulseWidth: 0.25, amplitude: 3, offset: 1,
        time: 1.0, syncTime: 0.5,
      }), 6
    );
  });

  it('falls back to the parameter defaults for an unresolvable expression param', () => {
    // The default resolver reads plain numbers only; a caller that CAN evaluate `=expr` passes
    // its own resolver. Either way the wave must still produce a value rather than NaN.
    const node = { kind: 'Wave', params: { frequency: '=node_3' } };
    expect(evaluateWaveNode(node, 0.25)).toBeCloseTo(evaluateWave({ time: 0.25, frequency: 1 }), 6);
  });

  it('accepts a caller-supplied param resolver', () => {
    const node = { kind: 'Wave', params: { frequency: '=whatever' } };
    const resolve = (n, name, def) => (name === 'frequency' ? 2 : def);
    expect(evaluateWaveNode(node, 0.125, resolve)).toBeCloseTo(1, 6); // 2 Hz sine peaks at t=0.125
  });
});
