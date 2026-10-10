// Mod+Shift+V is View → VJ Control. The ParameterPanel's binding copy/paste
// handler also listens for Mod+Shift+C/V on document and used to preventDefault()
// the key unconditionally — so the shortcut dispatcher on window (which skips
// already-prevented events) ignored it and the VJ panel never opened.

import { describe, it, expect, afterEach } from 'vitest';

import { ParameterPanel } from '../src/ui/ParameterPanel.js';
import { installShortcutDispatcher } from '../src/ui/shortcuts.js';

const pressModShiftV = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'V',
    code: 'KeyV',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
};

describe('Mod+Shift+V reaches the VJ Control row', () => {
  let cleanup = [];

  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    document.body.innerHTML = '';
  });

  it('opens VJ Control while a node with a last-touched parameter is selected', () => {
    const vjButton = document.createElement('button');
    vjButton.id = 'btn-toggle-vj';
    document.body.appendChild(vjButton);
    let clicks = 0;
    vjButton.addEventListener('click', () => {
      clicks += 1;
    });

    const panel = new ParameterPanel({ on() {}, emit() {} }, null, { nodes: [] });
    // A selected node plus a remembered parameter is what made the panel claim
    // the key before; focus is on the canvas, not in the panel.
    panel.selectedNode = { id: 'n1', kind: 'noise' };
    panel.getSelectedParameter = () => ({ name: 'scale' });

    cleanup.push(installShortcutDispatcher({ mac: false }));

    const event = pressModShiftV();
    expect(clicks).toBe(1);
    expect(event.defaultPrevented).toBe(true); // by the dispatcher, after the click
  });
});
