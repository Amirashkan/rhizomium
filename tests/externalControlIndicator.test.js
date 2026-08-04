/**
 * "This parameter is on a controller" — the MIDI/OSC indicator in the parameter panel.
 *
 * MIDI and OSC write parameter values straight into the node and the uniform buffer, so a mapped
 * parameter looks exactly like a hand-set one: the number just moves by itself. These tests drive a
 * real ParameterPanel against real binding objects, because the indicator is only as good as the
 * `getBindingForParameter` contract it reads through — a rename there should fail here, not in a
 * live set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';
import { MIDIParameterBinding } from '../src/midi/MIDIParameterBinding.js';
import { OSCParameterBinding } from '../src/osc/OSCParameterBinding.js';

function makeEventSystem() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, data) {
      (handlers.get(type) || []).forEach((fn) => fn(data));
    },
  };
}

let node;
let graph;
let events;
let panel;

beforeEach(() => {
  node = { kind: 'Circle', id: 'n1', params: { radius: 0.25 }, inputs: [] };
  graph = { nodes: [node], connections: [] };
  events = makeEventSystem();
  panel = new ParameterPanel(events, null, graph);
  window.editor = {};
});

afterEach(() => {
  panel.panel?.remove();
  delete window.editor;
  delete window.midiBinding;
  delete window.oscBinding;
  delete window.midiSettingsPanel;
  delete window.oscSettingsPanel;
});

const withMIDI = () => {
  const binding = new MIDIParameterBinding(graph, events, null);
  window.editor.midiBinding = binding;
  return binding;
};

const withOSC = () => {
  const binding = new OSCParameterBinding(graph, events, null);
  window.editor.oscBinding = binding;
  return binding;
};

const paramRow = (name) =>
  panel.panelContent.querySelector(`.parameter-container[data-param="${name}"]`);

const badges = (name) =>
  Array.from(paramRow(name).querySelectorAll('.external-control-badge'))
    .map((el) => el.getAttribute('data-external-control'));

const sourceText = (name) =>
  paramRow(name).querySelector('.external-control-status')?.textContent.replace(/\s+/g, ' ').trim();

describe('MIDI indicator', () => {
  it('badges a parameter that is mapped to a CC, and names the source', () => {
    withMIDI().createBinding('dev-1', 0, 21, 'n1', 'radius');

    panel.renderParameters(node);

    expect(badges('radius')).toEqual(['midi']);
    // Channels are 0-based internally and 1-based on screen, as in the MIDI panel.
    expect(sourceText('radius')).toContain('CC21 (Ch1)');
  });

  it('leaves unmapped parameters unmarked', () => {
    withMIDI().createBinding('dev-1', 0, 21, 'n1', 'radius');

    panel.renderParameters(node);

    expect(badges('epsilon')).toEqual([]);
    expect(sourceText('epsilon')).toBeUndefined();
  });

  it('says so when the mapping exists but is switched off', () => {
    const midi = withMIDI();
    midi.createBinding('dev-1', 0, 21, 'n1', 'radius');
    midi.setBindingEnabled('dev-1', 0, 21, false);

    panel.renderParameters(node);

    expect(sourceText('radius')).toContain('(disabled)');
  });

  it('opens the MIDI settings panel when the badge is clicked — that is where mappings live', () => {
    withMIDI().createBinding('dev-1', 0, 21, 'n1', 'radius');
    const show = vi.fn();
    window.editor.midiSettingsPanel = { show };

    panel.renderParameters(node);
    paramRow('radius')
      .querySelector('.external-control-badge')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(show).toHaveBeenCalled();
  });
});

describe('OSC indicator', () => {
  it('badges a mapped parameter with its address', () => {
    withOSC().createBinding('/1/fader1', 0, 'n1', 'radius');

    panel.renderParameters(node);

    expect(badges('radius')).toEqual(['osc']);
    expect(sourceText('radius')).toContain('/1/fader1');
  });

  it('names the argument slot when it is not the first one', () => {
    withOSC().createBinding('/xy', 1, 'n1', 'radius');

    panel.renderParameters(node);

    expect(sourceText('radius')).toContain('/xy [1]');
  });
});

describe('both controllers on one parameter', () => {
  it('shows each source rather than hiding one behind the other', () => {
    // Neither binding map clears the other, so this really can happen — and a value fighting
    // between two controllers is exactly when you need to see both.
    withMIDI().createBinding('dev-1', 0, 21, 'n1', 'radius');
    withOSC().createBinding('/1/fader1', 0, 'n1', 'radius');

    panel.renderParameters(node);

    expect(badges('radius')).toEqual(['midi', 'osc']);
    expect(sourceText('radius')).toContain('CC21 (Ch1)');
    expect(sourceText('radius')).toContain('/1/fader1');
  });
});

describe('staying current', () => {
  it('marks the parameter as soon as it is mapped, without reselecting the node', () => {
    const midi = withMIDI();
    panel.selectedNode = node;
    panel.renderParameters(node);
    expect(badges('radius')).toEqual([]);

    midi.createBinding('dev-1', 0, 21, 'n1', 'radius');

    expect(badges('radius')).toEqual(['midi']);
  });

  it('drops the mark when the mapping is removed', () => {
    const osc = withOSC();
    osc.createBinding('/1/fader1', 0, 'n1', 'radius');
    panel.selectedNode = node;
    panel.renderParameters(node);
    expect(badges('radius')).toEqual(['osc']);

    osc.removeBindingForParameter('n1', 'radius');

    expect(badges('radius')).toEqual([]);
  });
});
