// Keeping a node's own parameter panel honest when something OUTSIDE it moves a parameter.
//
// Three things do: a MIDI knob, an OSC message, and a slider in the Audio panel. Only the MIDI one
// was routed to the cheap display update, and even that one refreshed the field's text but not the
// evaluated readout beside it — which, for a textarea-backed numeric field, is the number the eye
// actually lands on. So a threshold moved from the Audio panel showed its new value in the field
// and its old value in the readout, permanently: the debounced full refresh repaints expression
// results only.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';

function makeBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, data) { (handlers.get(type) || []).forEach((fn) => fn(data)); },
  };
}

/** A panel showing one node, with its field registered the way the text handler registers them. */
function panelShowing(node, fieldValue) {
  const bus = makeBus();
  const panel = new ParameterPanel(bus, null, { nodes: [node] });
  panel.selectedNode = node;

  const input = document.createElement('textarea');
  input.value = String(fieldValue);
  const resultDisplay = document.createElement('span');
  resultDisplay.textContent = `→ ${fieldValue}`;
  panel.textInputHandler.activeInputs.set(`${node.id}_kickThresh`, {
    input, resultDisplay, param: { name: 'kickThresh' }, node,
  });

  return { panel, bus, input, resultDisplay };
}

describe('a parameter moved from outside its panel', () => {
  let node;
  beforeEach(() => { node = { id: '4', kind: 'Audio', params: { kickThresh: 0.5 }, inputs: [] }; });

  for (const source of ['midi', 'osc', 'audio-panel']) {
    it(`follows a change from ${source} in both the field and the readout`, () => {
      const { bus, input, resultDisplay } = panelShowing(node, 0.5);

      node.params.kickThresh = 0.77;
      bus.emit('PARAMETER_CHANGED', {
        node, parameterName: 'kickThresh', oldValue: 0.5, newValue: 0.77, source,
      });

      expect(input.value).toBe('0.77');
      expect(resultDisplay.textContent).toBe('→ 0.77');
    });
  }

  it('leaves the field alone while it is being typed in', () => {
    const { bus, input, resultDisplay } = panelShowing(node, 0.5);
    document.body.appendChild(input);
    input.focus();

    bus.emit('PARAMETER_CHANGED', {
      node, parameterName: 'kickThresh', oldValue: 0.5, newValue: 0.77, source: 'midi',
    });

    expect(input.value).toBe('0.5');
    expect(resultDisplay.textContent).toBe('→ 0.5');
    input.remove();
  });

  it('never writes over a field holding an expression', () => {
    // The controller's reading reaches the formula as `midi`; writing the number here would erase
    // it on the first CC. Only the evaluated readout moves.
    const { panel, bus, input, resultDisplay } = panelShowing(node, 0.5);
    input.value = '=midi * 0.6 + 0.2';
    node.params.kickThresh = '=midi * 0.6 + 0.2';
    panel.expressionSystem.evaluateExpression = vi.fn(() => 0.62);

    bus.emit('PARAMETER_CHANGED', {
      node, parameterName: 'kickThresh', oldValue: 0.5, newValue: 0.77, source: 'audio-panel',
    });

    expect(input.value).toBe('=midi * 0.6 + 0.2');
    expect(resultDisplay.textContent).toBe('→ 0.62');
  });
});
