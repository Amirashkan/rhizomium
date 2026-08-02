// A parameter drag must not freeze an animated graph's previews. The per-frame pass that advances
// time/audio-driven node values and re-reads their GPU thumbnails used to be gated off outright
// while `_parameterDragging` was set, so shift+dragging any parameter froze every audio-reactive
// node preview for the whole drag while the main output kept reacting to the music. Regression
// cover for the "dragging parameters stops audio reactivity" report.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

describe('parameter drag vs. animated-preview liveness', () => {
  let integration, editor, registered;

  const frame = { paused: false, realTime: 0 };

  beforeEach(() => {
    registered = null;
    globalThis.window = globalThis.window || {};
    window.renderLoop = {
      rafManager: {
        registerHandler: (name, handler, priority, options) => {
          registered = { name, handler, priority, options };
        },
      },
    };
    editor = {
      isPreviewEnabled: true,
      _parameterDragging: false,
      graph: { nodes: [], connections: [] },
      hasActiveAnimations: () => false,
    };
    integration = new PreviewIntegration(editor, { updateAllPreviews: () => {} });
    integration.initialize();
  });

  afterEach(() => {
    delete window.renderLoop;
    delete window.audioCapture;
    delete window.computeExecutor;
    delete window.fieldMapperIntegration;
  });

  const condition = () => registered.options.condition(frame);

  it('runs the animated-preview pass while a parameter is dragged and audio is playing', () => {
    window.audioCapture = { getIsPlaying: () => true };
    expect(condition()).toBe(true);

    editor._parameterDragging = true;
    expect(condition()).toBe(true);
  });

  it('still skips the pass mid-drag when nothing in the graph animates', () => {
    editor._parameterDragging = true;
    expect(condition()).toBe(false);
  });

  it('keeps the pass alive mid-drag for a time-animated graph with no audio', () => {
    editor._parameterDragging = true;
    editor.hasActiveAnimations = () => true;
    expect(condition()).toBe(true);
  });

  it('keeps the pass alive mid-drag for a self-animated compute graph', () => {
    editor._parameterDragging = true;
    window.computeExecutor = { isGraphAnimated: () => true };
    expect(condition()).toBe(true);
  });

  it('keeps the pass alive mid-drag when a 3D field mapper is present', () => {
    editor._parameterDragging = true;
    window.fieldMapperIntegration = { fieldMappers: new Map([['a', {}]]) };
    expect(condition()).toBe(true);
  });

  it('still honors the preview-disabled and paused gates during audio playback', () => {
    window.audioCapture = { getIsPlaying: () => true };

    editor.isPreviewEnabled = false;
    expect(condition()).toBe(false);

    editor.isPreviewEnabled = true;
    expect(registered.options.condition({ paused: true, realTime: 0 })).toBe(false);
  });

  it('halves the pass cadence while dragging so the drag stays responsive', () => {
    let timeNodes = 0;
    integration.updateTimeNodes = () => { timeNodes++; };
    integration.updateAnimatedFragmentPreviews = () => {};

    // 20ms after the last run: enough for the 16.67ms idle gate, not for the 33.34ms drag gate.
    integration.lastTimeUpdate = 0;
    editor._parameterDragging = true;
    registered.handler({ paused: false, realTime: 0.02 });
    expect(timeNodes).toBe(0);

    editor._parameterDragging = false;
    registered.handler({ paused: false, realTime: 0.02 });
    expect(timeNodes).toBe(1);
  });
});
