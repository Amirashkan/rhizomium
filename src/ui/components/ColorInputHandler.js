// Input handler for `type: 'color'` parameters (e.g. ComputeParticles' color).
// Renders a native color swatch plus an alpha slider and stores the value in the
// canonical [r,g,b,a] float array form the uniform packers expect. Tolerates
// legacy values (hex strings, comma lists) left behind by the old fallback text
// input.

function toColorArray(value, fallback = [1, 1, 1, 1]) {
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2], value.length > 3 ? value[3] : 1];
  }
  if (typeof value === 'string') {
    const hex = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    }
    const parts = value.split(',').map((s) => parseFloat(s));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    }
  }
  return [...fallback];
}

function toHex(color) {
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(color[0])}${c(color[1])}${c(color[2])}`;
}

import { ACCENT, SURFACE, TEXT, FONT_MONO } from '../../core/theme.js';

export class ColorInputHandler {
  constructor(undoManager) {
    this.undoManager = undoManager;
  }

  create(param, node, container, label, valueManager, onUpdate) {
    const current = toColorArray(
      valueManager.getValue(node, param.name) ?? param.default,
      toColorArray(param.default)
    );

    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    `;

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.value = toHex(current);
    swatch.className = 'param-input';
    swatch.setAttribute('data-param', param.name);
    swatch.style.cssText = `
      width: 42px;
      height: 26px;
      padding: 0;
      border: 1px solid ${SURFACE.lineStrong};
      border-radius: 7px;
      background: ${SURFACE.well};
      cursor: pointer;
    `;

    const alphaSlider = document.createElement('input');
    alphaSlider.type = 'range';
    alphaSlider.min = '0';
    alphaSlider.max = '1';
    alphaSlider.step = '0.01';
    alphaSlider.value = String(current[3]);
    alphaSlider.title = 'Alpha / intensity';
    alphaSlider.style.cssText = `
      flex: 1;
      cursor: pointer;
      accent-color: ${ACCENT.base};
    `;

    const alphaLabel = document.createElement('span');
    alphaLabel.textContent = `A ${Number(current[3]).toFixed(2)}`;
    alphaLabel.style.cssText = `
      font-size: 10px;
      font-family: ${FONT_MONO};
      color: ${TEXT.secondary};
      min-width: 44px;
      text-align: right;
    `;

    const commit = (actionLabel) => {
      const hex = swatch.value;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const a = parseFloat(alphaSlider.value);
      const oldValue = valueManager.getValue(node, param.name);
      const newValue = [r, g, b, a];

      if (this.undoManager) {
        this.undoManager.recordParameterChange(
          node,
          param.name,
          oldValue,
          newValue,
          `${actionLabel} ${param.displayName || param.name}`
        );
      }
      valueManager.setValue(node, param.name, newValue);
      onUpdate(`${actionLabel} ${param.displayName || param.name}`);
    };

    // 'input' fires continuously while dragging the picker/slider for live
    // feedback; 'change' commits once for the undo record.
    swatch.addEventListener('input', () => {
      const hex = swatch.value;
      const value = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
        parseFloat(alphaSlider.value)
      ];
      valueManager.setValue(node, param.name, value);
      onUpdate(`Adjust ${param.displayName || param.name}`);
    });
    swatch.addEventListener('change', (e) => {
      e.stopPropagation();
      commit('Set');
    });
    alphaSlider.addEventListener('input', () => {
      alphaLabel.textContent = `A ${parseFloat(alphaSlider.value).toFixed(2)}`;
      const prev = toColorArray(valueManager.getValue(node, param.name) ?? param.default);
      prev[3] = parseFloat(alphaSlider.value);
      valueManager.setValue(node, param.name, prev);
      onUpdate(`Adjust ${param.displayName || param.name} alpha`);
    });
    alphaSlider.addEventListener('change', (e) => {
      e.stopPropagation();
      commit('Set');
    });

    row.appendChild(swatch);
    row.appendChild(alphaSlider);
    row.appendChild(alphaLabel);
    container.appendChild(row);
  }
}
