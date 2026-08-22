import { describe, it, expect, beforeEach } from 'vitest';
import { SelectInputHandler } from '../src/ui/components/SelectInputHandler.js';
import { BooleanInputHandler } from '../src/ui/components/BooleanInputHandler.js';
import { ExpressionTextInputHandler, expressionSystem } from '../src/utils/ParameterExpressionSystem.js';

// A dropdown can only show one of its own options and a checkbox can only show on/off, so neither
// widget can hold "=audioEnvelope > 0.3" — re-rendering the panel would quietly overwrite it with
// the evaluated value. Each grows an fx switch instead: on, the parameter is edited as text; off,
// it goes back to the widget holding whatever the expression last resolved to.

function makeValueManager() {
  return {
    setValue(node, name, value) {
      if (!node.params) node.params = {};
      node.params[name] = value;
    },
    getValue(node, name) {
      const raw = node.params?.[name];
      return expressionSystem.isExpression(raw)
        ? expressionSystem.evaluateExpression(raw, {}, node)
        : expressionSystem.parseValue(raw);
    },
  };
}

function makeSupport() {
  const support = {
    expressionHandler: new ExpressionTextInputHandler(null, expressionSystem),
    rerenders: 0,
    requestRerender: () => { support.rerenders += 1; },
  };
  return support;
}

describe('discrete parameters with an fx switch', () => {
  let valueManager;
  let support;
  let div;

  beforeEach(() => {
    valueManager = makeValueManager();
    support = makeSupport();
    div = document.createElement('div');
  });

  it('a dropdown holding an expression is edited as text, not as a <select>', () => {
    const handler = new SelectInputHandler();
    handler.setExpressionSupport(support);
    const param = { name: 'sizeMode', type: 'select', options: ['Proportional', 'Frame'], default: 'Proportional' };
    const node = { id: '1', kind: 'Rectangle', params: { sizeMode: '=1' } };

    handler.create(param, node, div, null, valueManager, () => {});

    expect(div.querySelector('select')).toBeNull();
    expect(div.querySelector('textarea.param-input')?.value).toBe('=1');
    // The readout names the resolved OPTION — "→ 1" would not tell the user which mode is live.
    expect(div.querySelector('.discrete-expression-result')?.textContent).toBe('→ Frame');
  });

  it('leaving fx mode stores the option the expression resolved to', () => {
    const handler = new SelectInputHandler();
    handler.setExpressionSupport(support);
    const param = { name: 'sizeMode', type: 'select', options: ['Proportional', 'Frame'], default: 'Proportional' };
    const node = { id: '1', kind: 'Rectangle', params: { sizeMode: '=1' } };

    handler.create(param, node, div, null, valueManager, () => {});
    div.querySelector('.discrete-fx-toggle').click();

    expect(node.params.sizeMode).toBe('Frame');
    expect(support.rerenders).toBe(1);
  });

  it('entering fx mode on a toggle seeds an expression matching its current state', () => {
    const handler = new BooleanInputHandler();
    handler.setExpressionSupport(support);
    const param = { name: 'flipX', type: 'boolean', default: false };
    const node = { id: '2', kind: 'Flip2D', params: { flipX: true } };

    handler.create(param, node, div, null, valueManager, () => {});
    expect(div.querySelector('input[type="checkbox"]').checked).toBe(true);

    div.querySelector('.discrete-fx-toggle').click();
    expect(node.params.flipX).toBe('=1');
    expect(support.rerenders).toBe(1);
  });

  it('a toggle holding an expression reads out Enabled/Disabled', () => {
    const handler = new BooleanInputHandler();
    handler.setExpressionSupport(support);
    const param = { name: 'flipX', type: 'boolean', default: false };
    const node = { id: '2', kind: 'Flip2D', params: { flipX: '=2 > 1' } };

    handler.create(param, node, div, null, valueManager, () => {});

    expect(div.querySelector('input[type="checkbox"]')).toBeNull();
    expect(div.querySelector('.discrete-expression-result')?.textContent).toBe('→ Enabled');
  });

  it('a widget with no expression support attached is unchanged', () => {
    const handler = new SelectInputHandler();
    const param = { name: 'sizeMode', type: 'select', options: ['Proportional', 'Frame'], default: 'Proportional' };
    const node = { id: '1', kind: 'Rectangle', params: { sizeMode: 'Frame' } };

    handler.create(param, node, div, null, valueManager, () => {});

    expect(div.querySelector('select').value).toBe('Frame');
    expect(div.querySelector('.discrete-fx-toggle')).toBeNull();
  });

  it('a dropdown of numeric options keeps its selection', () => {
    // getValue parses '512' to the NUMBER 512, which matches no <option> value; the dropdown used
    // to fall back to its default and silently change the setting on every re-render.
    const handler = new SelectInputHandler();
    handler.setExpressionSupport(support);
    const param = { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' };
    const node = { id: '3', kind: 'ComputeNoise', params: { resolution: '1024' } };

    handler.create(param, node, div, null, valueManager, () => {});

    expect(div.querySelector('select').value).toBe('1024');
  });
});
