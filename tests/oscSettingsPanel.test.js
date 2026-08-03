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

function makeManager(events, addresses = [], statusOverrides = {}) {
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
      bridge: { udpHost: '0.0.0.0', udpPort: 9000, udpListening: true, udpError: null },
      lastError: null,
      ...statusOverrides,
    }),
    getAddresses: () => addresses,
    getValue: (address, argIndex = 0) =>
      addresses.find((a) => a.address === address)?.args?.[argIndex] ?? 0,
    isConnected: () => true,
    initialize: vi.fn(),
    disable: vi.fn(),
    setUdpPort: vi.fn(() => true),
  };
}

function makeBinding(bindings = []) {
  return {
    learningMode: false,
    continuousLearn: false,
    getAllBindings: () => bindings,
    removeBinding: vi.fn(),
    removeBindingForParameter: vi.fn(),
    updateBindingForParameter: vi.fn(),
    createBinding: vi.fn(),
    startLearning: vi.fn(),
    retargetLearning: vi.fn(),
    cancelLearning: vi.fn(),
    setContinuousLearn: vi.fn(),
  };
}

function binding(overrides = {}) {
  return {
    address: '/a',
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
    ...overrides,
  };
}

/** Stand in for a node selected in the Parameter Panel. */
function selectParameter(kind, nodeId, paramName) {
  window.editor = {
    paramPanel: {
      isVisible: () => true,
      selectedNode: { id: nodeId, kind },
      getSelectedParameter: () => ({ name: paramName }),
    },
    graph: { nodes: [{ id: nodeId, kind }] },
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

  it('does not claim to be working when the bridge cannot hear OSC', () => {
    // Reaching the bridge while its UDP port is held by another application is
    // the confusing case: the socket is fine but no OSC will ever arrive.
    const manager = makeManager(makeEventSystem(), [], {
      bridge: {
        udpHost: '0.0.0.0',
        udpPort: 9000,
        udpListening: false,
        udpError: 'Could not listen on UDP 0.0.0.0:9000 — Address already in use.',
      },
    });
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-status').textContent).toBe('UDP port busy');
    expect(panel.panel.querySelector('#osc-bridge-info').textContent)
      .toContain('Address already in use');
  });

  it('offers a way out of a busy port instead of just reporting it', () => {
    const manager = makeManager(makeEventSystem(), [], {
      bridge: { udpHost: '0.0.0.0', udpPort: 9000, udpListening: false, udpError: 'busy' },
    });
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-udp-row').style.display).toBe('flex');
    expect(panel.panel.querySelector('#osc-udp-port').value).toBe('9000');

    panel.panel.querySelector('#osc-udp-port').value = '9001';
    panel.panel.querySelector('#osc-udp-apply').click();

    expect(manager.setUdpPort).toHaveBeenCalledWith('9001');
  });

  it('does not call a refused port move a success', () => {
    // Listening, but carrying an error: the move was refused and the bridge
    // stayed put. Showing only where it listens would read as if it worked.
    const manager = makeManager(makeEventSystem(), [], {
      bridge: {
        udpHost: '0.0.0.0',
        udpPort: 9001,
        udpListening: true,
        udpError: 'Could not listen on UDP 0.0.0.0:9000 — Address already in use.',
      },
    });
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    const info = panel.panel.querySelector('#osc-bridge-info').textContent;
    expect(info).toContain('9001');
    expect(info).toContain('Address already in use');
  });

  it('names the command to run when the bridge is not there', () => {
    const manager = makeManager(makeEventSystem(), [], {
      connected: false,
      enabled: true,
      bridge: null,
      lastError: 'Could not reach the OSC bridge at ws://127.0.0.1:8767/ws',
    });
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-bridge-info').textContent)
      .toContain('python osc_bridge_server.py');
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
    // By parameter, not by address: several bindings can share one channel, so
    // removing by address would take its siblings with it.
    const bindings = makeBinding([binding({ argIndex: 2 })]);
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), bindings);
    panel.show();

    panel.panel.querySelector('#osc-bindings-list button').click();

    expect(bindings.removeBindingForParameter).toHaveBeenCalledWith('n1', 'radius');
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

  it('binds a channel straight from the list, no wiggling required', () => {
    selectParameter('CircleField', 'n1', 'radius');
    const manager = makeManager(makeEventSystem(), [
      { address: '/vcv/ch1', types: 'f', args: [0.5], value: 0.5, count: 1, lastSeen: 1 },
    ]);
    const bindings = makeBinding();
    panel = new OSCSettingsPanel(manager, bindings);
    panel.show();

    panel.panel.querySelector('#osc-addresses-list button').click();

    expect(bindings.createBinding).toHaveBeenCalledWith(
      '/vcv/ch1', 0, 'n1', 'radius', expect.any(Object),
    );
  });

  it('offers one Bind per argument on a multi-value channel', () => {
    selectParameter('CircleField', 'n1', 'radius');
    const manager = makeManager(makeEventSystem(), [
      { address: '/xy', types: 'ff', args: [0.3, 0.7], value: 0.3, count: 1, lastSeen: 1 },
    ]);
    const bindings = makeBinding();
    panel = new OSCSettingsPanel(manager, bindings);
    panel.show();

    const buttons = panel.panel.querySelectorAll('#osc-addresses-list button');
    expect(buttons).toHaveLength(2);

    buttons[1].click();
    expect(bindings.createBinding).toHaveBeenCalledWith(
      '/xy', 1, 'n1', 'radius', expect.any(Object),
    );
  });

  it('seeds the input range from what the channel actually sends', () => {
    // A 0-127 source bound blind would arrive clamped to 1.
    selectParameter('CircleField', 'n1', 'radius');
    const manager = makeManager(makeEventSystem(), [
      { address: '/cc', types: 'f', args: [127], value: 127, count: 1, lastSeen: 1 },
    ]);
    manager.getValue = () => 127;
    const bindings = makeBinding();
    panel = new OSCSettingsPanel(manager, bindings);
    panel.show();

    panel.panel.querySelector('#osc-addresses-list button').click();

    expect(bindings.createBinding).toHaveBeenCalledWith(
      '/cc', 0, 'n1', 'radius', { inputMax: 127 },
    );
  });

  it('keeps channels in a stable order however they arrive', () => {
    // getAddresses() returns most-recently-active first, which reshuffles
    // constantly with a rack running. The list has to stay put or you can
    // never find the channel you were looking at.
    const addresses = [
      { address: '/vcv/ch10', types: 'f', args: [1], value: 1, count: 1, lastSeen: 9 },
      { address: '/vcv/ch2', types: 'f', args: [1], value: 1, count: 1, lastSeen: 5 },
      { address: '/vcv/ch1', types: 'f', args: [1], value: 1, count: 1, lastSeen: 1 },
    ];
    panel = new OSCSettingsPanel(makeManager(makeEventSystem(), addresses), makeBinding());
    panel.show();

    const order = () =>
      Array.from(panel.panel.querySelectorAll('#osc-addresses-list .osc-channel-address'))
        .map((el) => el.textContent);

    // Numeric, so ch2 sorts before ch10.
    expect(order()).toEqual(['/vcv/ch1', '/vcv/ch2', '/vcv/ch10']);

    // Activity changes the manager's ordering; the panel's must not move.
    addresses.reverse();
    panel.updateAddressesList();
    expect(order()).toEqual(['/vcv/ch1', '/vcv/ch2', '/vcv/ch10']);
  });

  it('does not rebuild rows when only values change', () => {
    // Re-appending a row between mousedown and mouseup swallows the click,
    // which left Bind dead for exactly the senders this list is for.
    const addresses = [
      { address: '/vcv/ch1', types: 'f', args: [0.1], value: 0.1, count: 1, lastSeen: 1 },
    ];
    panel = new OSCSettingsPanel(makeManager(makeEventSystem(), addresses), makeBinding());
    panel.show();

    const before = panel.panel.querySelector('#osc-addresses-list button');
    addresses[0].args = [0.9];
    panel.updateAddressesList();

    expect(panel.panel.querySelector('#osc-addresses-list button')).toBe(before);
    expect(panel.panel.querySelector('#osc-addresses-list').textContent).toContain('0.9');
  });

  it('shows what each channel is driving', () => {
    window.editor = { graph: { nodes: [{ id: 'n1', kind: 'CircleField' }] } };
    const manager = makeManager(makeEventSystem(), [
      { address: '/lfo', types: 'f', args: [0.5], value: 0.5, count: 1, lastSeen: 1 },
      { address: '/spare', types: 'f', args: [0.5], value: 0.5, count: 1, lastSeen: 2 },
    ]);
    panel = new OSCSettingsPanel(manager, makeBinding([
      binding({ address: '/lfo', paramName: 'radius' }),
      binding({ address: '/lfo', paramName: 'rotation' }),
    ]));
    panel.show();

    const rows = Array.from(panel.panel.querySelectorAll('#osc-addresses-list > div'));
    const lfoRow = rows.find((r) => r.textContent.includes('/lfo'));
    const spareRow = rows.find((r) => r.textContent.includes('/spare'));

    expect(lfoRow.textContent).toContain('CircleField.radius');
    expect(lfoRow.textContent).toContain('CircleField.rotation');
    expect(spareRow.textContent).not.toContain('CircleField');
  });

  it('labels the argument slot when a channel drives several parameters', () => {
    window.editor = { graph: { nodes: [{ id: 'n1', kind: 'CircleField' }] } };
    const manager = makeManager(makeEventSystem(), [
      { address: '/xy', types: 'ff', args: [0.3, 0.7], value: 0.3, count: 1, lastSeen: 1 },
    ]);
    panel = new OSCSettingsPanel(manager, makeBinding([
      binding({ address: '/xy', argIndex: 1, paramName: 'rotation' }),
    ]));
    panel.show();

    expect(panel.panel.querySelector('#osc-addresses-list').textContent)
      .toContain('[1] → CircleField.rotation');
  });

  it('lets Bind win over an armed learn instead of racing it', () => {
    selectParameter('CircleField', 'n1', 'radius');
    const manager = makeManager(makeEventSystem(), [
      { address: '/vcv/ch1', types: 'f', args: [0.5], value: 0.5, count: 1, lastSeen: 1 },
    ]);
    const bindings = makeBinding();
    bindings.learningMode = true;
    panel = new OSCSettingsPanel(manager, bindings);
    panel.show();

    panel.panel.querySelector('#osc-addresses-list button').click();

    expect(bindings.cancelLearning).toHaveBeenCalled();
    expect(bindings.createBinding).toHaveBeenCalledWith(
      '/vcv/ch1', 0, 'n1', 'radius', expect.any(Object),
    );
  });

  it('still binds after focus leaves the parameter field', () => {
    // Clicking Bind blurs the Parameter Panel input, and that panel reads its
    // selection from what is focused.
    selectParameter('CircleField', 'n1', 'radius');
    const manager = makeManager(makeEventSystem(), [
      { address: '/vcv/ch1', types: 'f', args: [0.5], value: 0.5, count: 1, lastSeen: 1 },
    ]);
    const bindings = makeBinding();
    panel = new OSCSettingsPanel(manager, bindings);
    panel.show();          // captures the selection

    // Focus moved: the panel now reports nothing selected.
    window.editor.paramPanel.getSelectedParameter = () => null;
    panel.panel.querySelector('#osc-addresses-list button').click();

    expect(bindings.createBinding).toHaveBeenCalledWith(
      '/vcv/ch1', 0, 'n1', 'radius', expect.any(Object),
    );
  });

  it('forgets a sticky target whose node was deleted', () => {
    selectParameter('CircleField', 'n1', 'radius');
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());
    panel.show();

    window.editor.paramPanel.getSelectedParameter = () => null;
    window.editor.graph.nodes = [];

    expect(panel.currentTarget()).toBeNull();
  });

  it('filters a long channel list', () => {
    const manager = makeManager(makeEventSystem(), [
      { address: '/vcv/ch1', types: 'f', args: [1], value: 1, count: 1, lastSeen: 2 },
      { address: '/other/thing', types: 'f', args: [1], value: 1, count: 1, lastSeen: 1 },
    ]);
    panel = new OSCSettingsPanel(manager, makeBinding());
    panel.show();

    panel.filterInput.value = 'vcv';
    panel.filterInput.dispatchEvent(new Event('input'));

    const text = panel.panel.querySelector('#osc-addresses-list').textContent;
    expect(text).toContain('/vcv/ch1');
    expect(text).not.toContain('/other/thing');
  });

  it('groups several targets under the channel that drives them', () => {
    window.editor = { graph: { nodes: [{ id: 'n1', kind: 'CircleField' }] } };
    panel = new OSCSettingsPanel(
      makeManager(makeEventSystem()),
      makeBinding([
        binding({ address: '/lfo', paramName: 'radius' }),
        binding({ address: '/lfo', paramName: 'rotation' }),
      ]),
    );
    panel.show();

    const text = panel.panel.querySelector('#osc-bindings-list').textContent;
    expect(text).toContain('2 targets');
    expect(text).toContain('CircleField.radius');
    expect(text).toContain('CircleField.rotation');
    // One heading for the shared channel, not one per target.
    expect(text.match(/\/lfo/g)).toHaveLength(1);
  });

  it('edits a range without touching the channel siblings', () => {
    window.editor = { graph: { nodes: [{ id: 'n1', kind: 'CircleField' }] } };
    const bindings = makeBinding([binding({ max: 1 })]);
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), bindings);
    panel.show();

    const numbers = panel.panel.querySelectorAll('#osc-bindings-list input[type="number"]');
    expect(numbers).toHaveLength(4); // inputMin, inputMax, min, max

    numbers[3].value = '10';
    numbers[3].dispatchEvent(new Event('change'));

    expect(bindings.updateBindingForParameter).toHaveBeenCalledWith('n1', 'radius', { max: 10 });
  });

  it('ignores a range edit that is not a number', () => {
    window.editor = { graph: { nodes: [{ id: 'n1', kind: 'CircleField' }] } };
    const bindings = makeBinding([binding({ max: 1 })]);
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), bindings);
    panel.show();

    const numbers = panel.panel.querySelectorAll('#osc-bindings-list input[type="number"]');
    numbers[3].value = 'abc';
    numbers[3].dispatchEvent(new Event('change'));

    expect(bindings.updateBindingForParameter).not.toHaveBeenCalled();
    expect(numbers[3].value).toBe('1');
  });

  it('turns continuous learn on for mapping a rack', () => {
    const bindings = makeBinding();
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), bindings);
    panel.show();

    panel.continuousBox.checked = true;
    panel.continuousBox.dispatchEvent(new Event('change'));

    expect(bindings.setContinuousLearn).toHaveBeenCalledWith(true);
  });

  it('shows which parameter a bind would land on', () => {
    selectParameter('CircleField', 'n1', 'radius');
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-target').textContent).toBe('CircleField.radius');
  });

  it('says so when nothing is selected to bind to', () => {
    window.editor = undefined;
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());
    panel.show();

    expect(panel.panel.querySelector('#osc-target').textContent).toBe('nothing selected');
  });

  it('retargets an armed continuous learn as the selection moves', () => {
    selectParameter('CircleField', 'n1', 'radius');
    const bindings = makeBinding();
    bindings.learningMode = true;
    bindings.continuousLearn = true;
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), bindings);
    panel.show();

    selectParameter('CircleField', 'n1', 'rotation');
    panel.refreshTarget();

    expect(bindings.retargetLearning).toHaveBeenCalledWith('n1', 'rotation');
  });

  it('prefills the bridge URL so it can be pointed elsewhere', () => {
    panel = new OSCSettingsPanel(makeManager(makeEventSystem()), makeBinding());

    expect(panel.panel.querySelector('#osc-url').value).toBe('ws://127.0.0.1:8767/ws');
  });
});
