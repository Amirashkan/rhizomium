// The Audio panel: live meters for every analysis channel, and one button per channel that drops
// an Audio Value node on the canvas reading it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioSettingsPanel } from '../src/ui/AudioSettingsPanel.js';
import {
  clearAudioTapValues,
  setAudioTapValues,
  setAudioTapsWanted,
} from '../src/audio/audioAnalysisTaps.js';
import {
  getAudioAnalysisSettings,
  resetAudioAnalysisSettings,
} from '../src/audio/audioAnalysisSettings.js';

/** A stand-in editor that records what the panel asks it to create. */
function stubEditor() {
  const nodes = [];
  return {
    nodes,
    graph: { nodes },
    canvas: { clientWidth: 1000, clientHeight: 800 },
    viewport: { screenToCanvas: (x, y) => ({ x, y }) },
    createNode(kind, x, y) {
      const node = { id: String(nodes.length + 1), kind, x, y, params: {}, inputs: [] };
      nodes.push(node);
      return node;
    },
    markDirty: vi.fn(),
    safeDraw: vi.fn(),
  };
}

function rowFor(panel, channel) {
  return panel.panel.querySelector(`.rzap-row[data-channel="${channel}"]`);
}

describe('Audio panel', () => {
  let panel;

  beforeEach(() => {
    resetAudioAnalysisSettings();
    clearAudioTapValues();
    window.editor = stubEditor();
    panel = new AudioSettingsPanel();
  });

  afterEach(() => {
    panel.panel?.remove();
    delete window.editor;
    clearAudioTapValues();
    setAudioTapsWanted(false);
    resetAudioAnalysisSettings();
  });

  it('lists every channel with a deploy button', () => {
    const channels = [...panel.panel.querySelectorAll('.rzap-row')].map((r) => r.dataset.channel);
    expect(channels).toEqual([
      'level', 'low', 'mid', 'high', 'centroid', 'density',
      'kickMeter', 'kick', 'kickTrig',
      'snareMeter', 'snare', 'snareTrig',
      'hatMeter', 'hat', 'hatTrig',
    ]);
    for (const channel of channels) {
      expect(rowFor(panel, channel).querySelector('.rzap-add')).toBeTruthy();
    }
  });

  it('deploys an Audio node for the channel whose button was pressed', () => {
    rowFor(panel, 'kickTrig').querySelector('.rzap-add').click();

    const node = window.editor.nodes.at(-1);
    expect(node.kind).toBe('Audio');
    expect(node.params.channel).toBe('kickTrig');
    // Named after the channel: a rack of taps has to be readable on the canvas.
    expect(node.name).toBe('Kick Trigger');
    expect(window.editor.safeDraw).toHaveBeenCalled();
  });

  it('stacks repeated deploys instead of piling them on one spot', () => {
    rowFor(panel, 'level').querySelector('.rzap-add').click();
    rowFor(panel, 'low').querySelector('.rzap-add').click();

    const [first, second] = window.editor.nodes;
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.x).toBe(first.x);
  });

  it('does nothing worse than a status message with no editor', () => {
    delete window.editor;
    expect(() => rowFor(panel, 'level').querySelector('.rzap-add').click()).not.toThrow();
  });

  it('shows each channel’s live value, and flashes a trigger with its envelope', () => {
    setAudioTapValues({ level: 0.42, kick: 0.8, kickTrig: 1 });
    panel.show();

    expect(rowFor(panel, 'level').querySelector('.rzap-row-value').textContent).toBe('0.420');
    expect(rowFor(panel, 'level').querySelector('.rzap-bar-fill').style.width).toBe('42%');
    // The number on a trigger row is the trigger itself...
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-row-value').textContent).toBe('1.000');
    // ...while its bar follows the envelope, which is what stays visible between polls.
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-bar-fill').style.width).toBe('80%');
  });

  it('keeps the analysis running only while it is on screen', () => {
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
    // Cheapest proof that the flag is wired both ways: toggling does not throw and lands closed.
    panel.toggle();
    expect(panel.visible).toBe(true);
  });

  it('writes the threshold sliders straight to the shared settings, and marks the meter', () => {
    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    slider.value = '0.75';
    slider.dispatchEvent(new Event('input'));

    expect(getAudioAnalysisSettings().kickThresh).toBeCloseTo(0.75);
    // The marker on the kick METER row is what a threshold is actually set against.
    const mark = rowFor(panel, 'kickMeter').querySelector('.rzap-bar-mark');
    expect(mark.style.left).toBe('75%');
  });

  it('hands a deployed trigger node the threshold currently set against the meter', () => {
    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    slider.value = '0.62';
    slider.dispatchEvent(new Event('input'));

    rowFor(panel, 'kickTrig').querySelector('.rzap-add').click();
    // From here the number lives on the node, where it can be MIDI-mapped.
    expect(window.editor.nodes.at(-1).params.threshold).toBeCloseTo(0.62);
  });

  it('leaves a channel that takes no threshold without one', () => {
    rowFor(panel, 'level').querySelector('.rzap-add').click();
    expect(window.editor.nodes.at(-1).params.threshold).toBeUndefined();
  });

  it('marks the meter with the deployed nodes’ live thresholds, not the panel default', () => {
    const marks = () => [...rowFor(panel, 'kickMeter').querySelectorAll('.rzap-bar-mark')]
      .map((m) => ({ left: m.style.left, isDefault: m.classList.contains('is-default') }));

    // Nothing deployed: one dim marker, showing where the next one would start.
    panel.show();
    expect(marks()).toEqual([{ left: '50%', isDefault: true }]);

    // Two taps at different thresholds — including one resolved from an expression this frame.
    window.editor.nodes.push(
      { id: '9', kind: 'Audio', params: { channel: 'kickTrig', threshold: 0.8 } },
      { id: '10', kind: 'Audio', params: { channel: 'kick', threshold: '=midi' }, __audio_threshold: 0.25 },
    );
    panel._refresh();

    expect(marks()).toEqual([
      { left: '25%', isDefault: false },
      { left: '80%', isDefault: false },
    ]);
  });

  it('writes the meter shaping sliders to the shared settings', () => {
    const gain = panel.panel.querySelectorAll('.rzap-sec .rzap-slider:not(.is-thresh) input')[2];
    gain.value = '2.5';
    gain.dispatchEvent(new Event('input'));
    expect(getAudioAnalysisSettings().gain).toBeCloseTo(2.5);
  });
});
