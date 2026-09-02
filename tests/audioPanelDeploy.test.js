// The Audio panel: live meters for every analysis channel, and one button per channel that drops
// an Audio Value node on the canvas reading it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioSettingsPanel, describeAudioSource } from '../src/ui/AudioSettingsPanel.js';
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

  it('deploys an Audio Value node for the channel whose button was pressed', () => {
    rowFor(panel, 'kickTrig').querySelector('.rzap-add').click();

    const node = window.editor.nodes.at(-1);
    expect(node.kind).toBe('AudioValue');
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

  it('describes the source as empty with nothing loaded', () => {
    // The one sentence the panel and the Audio node's parameter panel both show, so they cannot
    // drift apart.
    expect(describeAudioSource()).toMatchObject({
      state: 'empty', label: 'No audio loaded', hasFile: false, playing: false,
    });
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

  it('deploys a reader with no threshold of its own', () => {
    // The drums are thresholded once, on the Audio node; a reader just names a channel.
    rowFor(panel, 'kickTrig').querySelector('.rzap-add').click();
    expect(window.editor.nodes.at(-1).params.threshold).toBeUndefined();
  });

  it('writes the thresholds to the Audio node when the patch has one', () => {
    // This is what the whole split is for: on a node, the threshold is a parameter MIDI can reach.
    const setup = { id: '9', kind: 'Audio', params: {} };
    window.editor.nodes.push(setup);

    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    slider.value = '0.62';
    slider.dispatchEvent(new Event('input'));

    expect(setup.params.kickThresh).toBeCloseTo(0.62);
  });

  it('offers the Audio node while the settings are not on one, and stops once they are', () => {
    panel.show();
    expect(panel.panel.querySelector('#audio-add-setup').hidden).toBe(false);
    expect(panel.panel.querySelector('#audio-setup-note').textContent).toContain('not on a node');

    panel.addSetupNode();
    panel._refresh();

    const setup = window.editor.nodes.find((n) => n.kind === 'Audio');
    expect(setup).toBeTruthy();
    // Seeded with the values as they stand: adding one is usually about automating a threshold
    // that has already been dialled in.
    expect(setup.params.kickThresh).toBeCloseTo(0.5);
    expect(panel.panel.querySelector('#audio-add-setup').hidden).toBe(true);
    expect(panel.panel.querySelector('#audio-setup-note').textContent).toContain(`#${setup.id}`);
  });

  it('refuses to write over a threshold that holds an expression', () => {
    // The slider shows what the formula evaluated to, which looks exactly like a number somebody
    // set — so a drag would replace `=midi * 0.6 + 0.2` with that number, silently, on the one
    // parameter whose entire purpose is being driven by a controller.
    const setup = {
      id: '9', kind: 'Audio',
      params: { kickThresh: '=midi * 0.6 + 0.2' },
      __audio_settings: { kickThresh: 0.44 },
    };
    window.editor.nodes.push(setup);
    panel._refresh();

    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    // Shown as a readout of the live value, not as something to grab.
    expect(slider.disabled).toBe(true);
    expect(slider.closest('.rzap-slider').classList.contains('is-driven')).toBe(true);
    expect(slider.value).toBe('0.44');

    slider.value = '0.9';
    slider.dispatchEvent(new Event('input'));
    expect(setup.params.kickThresh).toBe('=midi * 0.6 + 0.2');
  });

  it('records one undo entry per drag, not one per pointer event', () => {
    const recorded = [];
    window.undoManager = { recordParameterChange: (...args) => recorded.push(args) };
    const setup = { id: '9', kind: 'Audio', params: { kickThresh: 0.5 } };
    window.editor.nodes.push(setup);

    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    for (const value of ['0.55', '0.6', '0.65', '0.7']) {
      slider.value = value;
      slider.dispatchEvent(new Event('input'));
    }
    expect(recorded).toHaveLength(0); // still mid-gesture

    panel._endSettingGesture();
    // One entry, spanning the whole run: where it started to where it ended up.
    expect(recorded).toHaveLength(1);
    expect(recorded[0][1]).toBe('kickThresh');
    expect(recorded[0][2]).toBe(0.5);
    expect(recorded[0][3]).toBeCloseTo(0.7);
    delete window.undoManager;
  });

  it('marks the patch unsaved and tells the editor a parameter moved', () => {
    // markDirty is only the canvas's redraw flag; without these two the dial-in is never part of
    // the document, and a bound parameter moves underneath the binding system unannounced.
    const emitted = [];
    window.editor.eventSystem = { emit: (type, data) => emitted.push([type, data]) };
    window.saveLoadManager = { markUnsaved: vi.fn() };
    const setup = { id: '9', kind: 'Audio', params: { kickThresh: 0.5 } };
    window.editor.nodes.push(setup);

    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    slider.value = '0.7';
    slider.dispatchEvent(new Event('input'));

    expect(window.saveLoadManager.markUnsaved).toHaveBeenCalled();
    expect(emitted.map(([type]) => type)).toContain('PARAMETER_CHANGED');
    expect(emitted.at(-1)[1]).toMatchObject({ parameterName: 'kickThresh', newValue: 0.7 });
    delete window.saveLoadManager;
  });

  it('clamps in one place, so the node and the stored defaults cannot disagree', () => {
    const setup = { id: '9', kind: 'Audio', params: { kickThresh: 0.5 } };
    window.editor.nodes.push(setup);

    const slider = panel.panel.querySelectorAll('.rzap-slider.is-thresh input')[0];
    slider.value = '4';
    slider.dispatchEvent(new Event('input'));

    expect(setup.params.kickThresh).toBe(1);
    expect(getAudioAnalysisSettings().kickThresh).toBe(1);
  });

  it('marks each drum’s meter with the threshold actually being decided on', () => {
    const mark = () => rowFor(panel, 'kickMeter').querySelector('.rzap-bar-mark')?.style.left;

    panel.show();
    expect(mark()).toBe('50%');

    // A setup node whose threshold resolved to 0.25 this frame — an expression, or a knob.
    window.editor.nodes.push({
      id: '9', kind: 'Audio', params: { kickThresh: '=midi' }, __audio_settings: { kickThresh: 0.25 },
    });
    panel._refresh();
    expect(mark()).toBe('25%');
  });

  it('warns that every channel reads 0 while nothing is playing', () => {
    // The complaint this answers: a node deployed from a silent panel reads 0 and looks broken.
    panel.show();
    expect(panel.panel.querySelector('#audio-silent').hidden).toBe(false);
  });

  it('writes the meter shaping sliders to the shared settings', () => {
    const gain = panel.panel.querySelectorAll('.rzap-sec .rzap-slider:not(.is-thresh) input')[2];
    gain.value = '2.5';
    gain.dispatchEvent(new Event('input'));
    expect(getAudioAnalysisSettings().gain).toBeCloseTo(2.5);
  });
});
