// src/ui/components/discreteExpressionField.js
//
// The "fx" switch that lets a dropdown or a true/false toggle hold an expression.
//
// A numeric field is always an expression field — you type "=audioEnvelope * 2" straight into it.
// A discrete control has no room for that: the widget IS the value. So each one grows a small fx
// chip that swaps the widget for the standard expression textarea and back, with a readout showing
// which option the expression currently resolves to (utils/discreteParams.js does the resolving,
// and the same rules apply in the compilers).
//
// Switching back to the widget writes the resolved option, so leaving expression mode never leaves
// the parameter holding text no compiler can read.

import { SEMANTIC, SURFACE, TEXT, FONT_MONO } from '../../core/theme.js';
import { expressionSystem } from '../../utils/ParameterExpressionSystem.js';
import {
  isExpressionValue,
  resolveDiscreteParam,
  optionValues,
  getParamDef,
} from '../../utils/discreteParams.js';

/** The raw stored value — NOT the evaluated one; expression mode is decided by the text. */
export function rawParamValue(node, param) {
  return node?.params?.[param.name] ?? param.default;
}

export function isExpressionParam(node, param) {
  return isExpressionValue(rawParamValue(node, param));
}

/**
 * A starting expression for a parameter switched into fx mode, seeded from its current setting so
 * the switch itself changes nothing on screen: a toggle becomes "=1"/"=0", a dropdown becomes the
 * index of the selected option.
 */
export function seedExpression(node, param, isBoolean) {
  const current = rawParamValue(node, param);

  if (isBoolean) {
    const on = current === true || String(current).trim().toLowerCase() === 'true';
    return on ? '=1' : '=0';
  }

  const values = optionValues(getParamDef(node, param.name) || param);
  const index = values.findIndex((v) => v === String(current));
  return `=${index < 0 ? 0 : index}`;
}

export function createFxToggle(active, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'discrete-fx-toggle';
  btn.textContent = 'fx';
  btn.title = active
    ? 'Drive this control by hand again (keeps the value the expression currently resolves to)'
    : 'Drive this control with an expression (e.g. =audioEnvelope > 0.3)';
  btn.setAttribute('aria-pressed', String(Boolean(active)));
  btn.style.cssText = `
    padding: 2px 7px;
    border-radius: 6px;
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    background: ${active ? 'rgba(167, 139, 250, 0.24)' : SURFACE.well};
    border: 1px solid ${active ? SEMANTIC.audio : SURFACE.line};
    color: ${active ? '#c9b9f7' : TEXT.tertiary};
  `;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function createRow() {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-top: 4px;';
  return row;
}

/**
 * Render a discrete parameter as an expression field, with the resolved option underneath.
 *
 * @param {object} support - { expressionHandler, requestRerender } supplied by ParameterPanel.
 */
export function renderExpressionMode({ param, node, div, label, valueManager, onChange, support, isBoolean }) {
  support.expressionHandler.create(param, node, div, label, valueManager, onChange);

  const input = div.querySelector('textarea.param-input');

  // The generic "→ 0.87" readout is the wrong answer for a discrete control: what matters is which
  // option that number lands on. Replaced rather than stacked, so the field carries one verdict.
  const genericResult = div.querySelector('.expression-result');
  if (genericResult) genericResult.style.display = 'none';

  const readout = document.createElement('div');
  readout.className = 'expression-result discrete-expression-result';
  readout.style.cssText = `
    font-size: 10px;
    font-family: ${FONT_MONO};
    color: ${TEXT.tertiary};
    margin-top: 3px;
    min-height: 12px;
  `;

  const refresh = () => {
    const text = input ? input.value.trim() : rawParamValue(node, param);
    if (!isExpressionValue(text)) {
      readout.textContent = '';
      readout.style.color = TEXT.tertiary;
      return;
    }
    const validation = expressionSystem.validateExpression(text, {}, node);
    if (!validation.valid) {
      readout.textContent = `Error: ${validation.error}`;
      readout.style.color = SEMANTIC.error;
      return;
    }
    const resolved = resolveDiscreteParam(node, param.name, text);
    readout.textContent = `→ ${isBoolean ? (resolved ? 'Enabled' : 'Disabled') : resolved}`;
    readout.style.color = TEXT.tertiary;
  };

  if (input) {
    input.addEventListener('input', refresh);
    input.addEventListener('blur', refresh);
  }
  refresh();

  const row = createRow();
  row.appendChild(
    createFxToggle(true, () => {
      // Leave fx mode holding whatever the expression resolves to right now, so the widget has a
      // real option to show and the compilers a real value to bake.
      const resolved = resolveDiscreteParam(node, param.name, rawParamValue(node, param));
      valueManager.setValue(node, param.name, resolved);
      if (typeof onChange === 'function') onChange(`Parameter Change: ${param.name}`);
      support.requestRerender?.(node);
    })
  );

  div.appendChild(readout);
  div.appendChild(row);
  return readout;
}

/** The fx chip shown next to a plain widget; clicking it switches the parameter into fx mode. */
export function appendEnterExpressionToggle({ param, node, div, valueManager, onChange, support, isBoolean }) {
  const row = createRow();
  row.appendChild(
    createFxToggle(false, () => {
      valueManager.setValue(node, param.name, seedExpression(node, param, isBoolean));
      if (typeof onChange === 'function') onChange(`Parameter Change: ${param.name}`);
      support.requestRerender?.(node);
    })
  );
  div.appendChild(row);
}
