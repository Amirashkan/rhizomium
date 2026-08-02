// Tests for OSCSettingsPanel.
//
// The panel is mostly glue, but it is the one place where text that arrived
// over the network gets put on the page, so that is what these focus on.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OSCSettingsPanel } from '../src/ui/OSCSettingsPanel.js';

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

function makeManager(events, addresses = []) {
  return {
    eventSystem: events,
    url: 'ws://127.0.0.1:8767/ws',
    messageRate: 0,
    getStatus: () => ({
      supported: true,
      enabled: true,
      connected: true,
      url: 'ws://127.0.0.1:8767/ws',
      addressCount: addresses.length,
      bridge: { udpHost: '0.0.0.0', udpPort: 9000 },
      lastError: null,
    }),
    getAddresses: () => addresses,
    isConnected: () => true,
    initialize: vi.fn(),
    disable: vi.fn(),
  };
}

function makeBinding(bindings = []) {
  return {
    learningMode: false,
    getAllBindings: () => bindings,
    removeBinding: vi.fn(),
    startLearning: vi.fn(),
    cancelLearning: vi.fn(),
  };
}

let panel;

beforeEach(() => {
  globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 0));
});

afterEach(() => {
  panel?.destroy?.();
  panel = null;
  document.body.replaceChildren();
});

describe('OSCSettingsPanel rendering', () => {
  it('builds and starts hidden', () => {
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());

    expect(document.querySelector('#osc-settings-panel')).toBeTruthy();
    expect(panel.isVisible()).toBe(false);
  });

  it('shows the bridge UDP port once connected', () => {
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-bridge-info').textContent).toContain('9000');
    expect(panel.panel.querySelector('#osc-status').textContent).toBe('Connected');
  });

  it('lists incoming addresses with their arguments', () => {
    const manager = makeManager(makeEventSystem(), [
      { address: '/1/fader1', types: 'f', args: [0.5], value: 0.5, count: 1, lastSeen: 1 },
    ]);
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    const text = panel.panel.querySelector('#osc-addresses-list').textContent;
    expect(text).toContain('/1/fader1');
    expect(text).toContain('0.5');
  });

  it('renders a hostile address as text, never as markup', () => {
    // An OSC address comes from anything that can reach the UDP port, so it is
    // untrusted input being written to the page.
    const hostile = '/<img src=x onerror=alert(1)>';
    const manager = makeManager(makeEventSystem(), [
      { address: hostile, types: 'f', args: [1], value: 1, count: 1, lastSeen: 1 },
    ]);
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    const list = panel.panel.querySelector('#osc-addresses-list');
    expect(list.querySelector('img')).toBeNull();
    expect(list.textContent).toContain(hostile);
  });

  it('renders a hostile address in the bindings list as text too', () => {
    const hostile = "/x'); alert(1); //";
    panel = new OSCSettingsPanel(
      makeManager(makeEventSystem()),
      makeBinding([{
        address: hostile,
        argIndex: 0,
        nodeId: 'n1',
        paramName: 'radius',
        min: 0,
        max: 1,
        inputMin: 0,
        inputMax: 1,
        curve: 'linear',
        inverted: false,
        enabled: true,
      }]),
    );
    panel.show();

    const list = panel.panel.querySelector('#osc-bindings-list');
    expect(list.textContent).toContain(hostile);
    // No inline handler carrying the address into an attribute.
    expect(list.innerHTML).not.toContain('onclick');
  });

  it('removes a binding through the Remove button', () => {
    const binding = makeBinding([{
      address: '/a',
      argIndex: 2,
      nodeId: 'n1',
      paramName: 'radius',
      min: 0,
      max: 1,
      inputMin: 0,
      inputMax: 1,
      curve: 'linear',
      inverted: false,
      enabled: true,
    }]);
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), binding);
    panel.show();

    panel.panel.querySelector('#osc-bindings-list button').click();

    expect(binding.removeBinding).toHaveBeenCalledWith('/a', 2);
  });

  it('shows placeholders when there is nothing to list', () => {
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-addresses-list').textContent)
      .toContain('No OSC messages received');
    expect(panel.panel.querySelector('#osc-bindings-list').textContent)
      .toContain('No bindings configured');
  });

  it('toggles visibility', () => {
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());

    panel.toggle();
    expect(panel.isVisible()).toBe(true);
    panel.toggle();
    expect(panel.isVisible()).toBe(false);
  });

  it('prefills the bridge URL so it can be pointed elsewhere', () => {
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());

    expect(panel.panel.querySelector('#osc-url').value).toBe('ws://127.0.0.1:8767/ws');
  });
});
