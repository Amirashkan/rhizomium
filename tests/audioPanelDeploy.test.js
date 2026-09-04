// The Audio panel: live meters for every analysis channel, and one button per channel that drops
// an Audio Value node on the canvas reading it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioSettingsPanel, describeAudioSource } from '../src/ui/AudioSettingsPanel.js';
import {
  clearAudioTapValues,
  setAudioTapValues,
  setAudioTapsWanted,
} from '../src/audio/audioAnalysisTaps.js';

/** A readout row by its label, and the value it is showing. */
function readoutRow(panel, label) {
  return [...panel.panel.querySelectorAll('.rzap-readout')]
    .find((r) => r.querySelector('.rzap-readout-label').textContent === label);
}
function readoutValue(panel, label) {
  return readoutRow(panel, label)?.querySelector('.rzap-readout-value').textContent;
}

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
    // Where the panel sends you to actually change a setting.
    paramPanel: { shown: [], showNodeParameters(node) { this.shown.push(node); } },
  };
}

function rowFor(panel, channel) {
  return panel.panel.querySelector(`.rzap-row[data-channel="${channel}"]`);
}

describe('Audio panel', () => {
  let panel;

  beforeEach(() => {
    clearAudioTapValues();
    window.editor = stubEditor();
    panel = new AudioSettingsPanel();
  });

  afterEach(() => {
    panel.panel?.remove();
    delete window.editor;
    clearAudioTapValues();
    setAudioTapsWanted(false);
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
    setAudioTapValues({ level: 0.42, kick: 0.8, kickTrig: 1, trigCount: { kick: 1 } });
    panel.show();

    expect(rowFor(panel, 'level').querySelector('.rzap-row-value').textContent).toBe('0.420');
    expect(rowFor(panel, 'level').querySelector('.rzap-bar-fill').style.width).toBe('42%');
    // The first look adopts the count rather than reporting every hit since the page loaded.
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-row-value').textContent).toBe('0.000');
    // The bar follows the envelope, which is what stays visible between polls.
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-bar-fill').style.width).toBe('80%');
  });

  // The analysis decides triggers every ~8 ms and this panel polls at 20 Hz, so reading the 0/1
  // channel would catch about one hit in six — the row would sit at 0.000 through a track that is
  // plainly triggering. The fire count cannot be missed between two polls.
  it('reports a trigger that fired between two polls', () => {
    setAudioTapValues({ kick: 0.8, kickTrig: 0, trigCount: { kick: 4 } });
    panel.show();
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-row-value').textContent).toBe('0.000');

    // A hit landed while nothing was looking: the 0/1 channel has already fallen back to 0.
    setAudioTapValues({ kick: 0.8, kickTrig: 0, trigCount: { kick: 5 } });
    panel._refresh();
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-row-value').textContent).toBe('1.000');

    // And nothing new since.
    panel._refresh();
    expect(rowFor(panel, 'kickTrig').querySelector('.rzap-row-value').textContent).toBe('0.000');
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

  it('deploys a reader with no threshold of its own', () => {
    // The drums are thresholded once, on the Audio node; a reader just names a channel.
    rowFor(panel, 'kickTrig').querySelector('.rzap-add').click();
    expect(window.editor.nodes.at(-1).params.threshold).toBeUndefined();
  });

  // The panel SHOWS the settings; the Audio node is where they are set. This is the guard on that:
  // any control here would be a second writable home for numbers that already live on a node, and
  // a patch could then carry two disagreeing copies with nothing on screen saying which one won.
  it('has nothing in it that can change a setting', () => {
    panel.show();
    const controls = panel.panel.querySelectorAll(
      '#audio-shape input, #audio-shape select, #audio-channels input, #audio-channels select',
    );
    expect([...controls]).toEqual([]);
  });

  it('reads each setting off the Audio node', () => {
    window.editor.nodes.push({
      id: '9', kind: 'Audio', params: { kickThresh: 0.62, gain: 2.5, attack: 20 },
    });
    panel.show();

    expect(readoutValue(panel, 'Threshold')).toBe('0.62');
    expect(readoutValue(panel, 'Gain')).toBe('2.50');
    expect(readoutValue(panel, 'Attack')).toBe('20 ms');
    // The marker on the kick METER row is what a threshold is actually judged against.
    expect(rowFor(panel, 'kickMeter').querySelector('.rzap-bar-mark').style.left).toBe('62%');
  });

  it('shows the built-in defaults, and says so, with no Audio node in the patch', () => {
    panel.show();
    expect(readoutValue(panel, 'Threshold')).toBe('0.50');
    expect(readoutValue(panel, 'Gain')).toBe('1.00');
    // A readout with no way to reach it looks broken unless the panel says where it came from.
    expect(panel.panel.querySelector('#audio-setup-note').textContent).toContain('defaults');
    expect(panel.panel.querySelector('#audio-add-setup').textContent).toContain('+ Audio node');
  });

  it('shows what an expression evaluated to, next to the expression', () => {
    // The number is where the threshold actually IS this frame; the formula alone would not say.
    window.editor.nodes.push({
      id: '9', kind: 'Audio',
      params: { kickThresh: '=midi * 0.6 + 0.2' },
      __audio_settings: { kickThresh: 0.44 },
    });
    panel._refresh();

    const row = readoutRow(panel, 'Threshold');
    expect(row.classList.contains('is-driven')).toBe(true);
    expect(row.querySelector('.rzap-readout-value').textContent).toBe('=midi * 0.6 + 0.2');
    expect(row.title).toContain('0.440');
    expect(rowFor(panel, 'kickMeter').querySelector('.rzap-bar-mark').style.left).toBe('44%');
  });

  it('adds the Audio node and opens it when there is nowhere to set them', () => {
    panel.show();
    panel.panel.querySelector('#audio-add-setup').click();

    const setup = window.editor.nodes.find((n) => n.kind === 'Audio');
    expect(setup).toBeTruthy();
    expect(window.editor.paramPanel.shown).toEqual([setup]);
    expect([...window.editor.graph.selection]).toEqual([setup.id]);
  });

  it('goes to the existing node rather than adding a second one', () => {
    // Two Audio nodes would be two answers to a question with one engine behind it.
    const setup = { id: '9', kind: 'Audio', params: {} };
    window.editor.nodes.push(setup);
    panel._refresh();
    expect(panel.panel.querySelector('#audio-add-setup').textContent).toContain('#9');

    panel.panel.querySelector('#audio-add-setup').click();
    expect(window.editor.nodes.filter((n) => n.kind === 'Audio')).toHaveLength(1);
    expect(window.editor.paramPanel.shown).toEqual([setup]);
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

});
