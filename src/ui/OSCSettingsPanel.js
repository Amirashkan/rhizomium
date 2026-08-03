// src/ui/OSCSettingsPanel.js

import { makeDraggable } from './utils/draggable.js';
import { modalManager } from './ModalManager.js';
import { formatOSCArg } from '../osc/OSCDecoder.js';

/**
 * OSCSettingsPanel - UI for the OSC bridge connection and address mappings.
 *
 * Laid out to match MIDISettingsPanel so the two feel like one system, with one
 * deliberate difference: every string that came off the network (addresses,
 * argument values, the bridge's own error text) is written with textContent
 * rather than interpolated into innerHTML. Device names in the MIDI panel come
 * from hardware the user plugged in; OSC addresses come from anything that can
 * reach the port.
 */

const PLACEHOLDER_STYLE = 'color: #888; font-size: 12px; font-style: italic;';

function placeholder(text) {
  const div = document.createElement('div');
  div.style.cssText = PLACEHOLDER_STYLE;
  div.textContent = text;
  return div;
}

function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class OSCSettingsPanel {
  constructor(oscManager, oscBinding) {
    this.oscManager = oscManager;
    this.oscBinding = oscBinding;
    this.panel = null;
    this.visible = false;
    this.cleanupDraggable = null;

    // Throttle the activity readout — OSC senders happily push hundreds of
    // messages a second and each one must not cost a DOM write.
    this.lastActivityUpdate = 0;
    this.activityUpdateThrottle = 100;
    this.pendingActivityData = null;
    this.activityRAF = null;

    // The address list is rebuilt wholesale, so it gets the same treatment.
    this.addressesDirty = false;
    this.addressesRAF = null;

    this.createPanel();
    this.setupEventListeners();
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'osc-settings-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 60px;
      right: 340px;
      width: 340px;
      max-height: 80vh;
      background: rgba(30, 30, 30, 0.95);
      border: 1px solid #555;
      border-radius: 8px;
      padding: 16px;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      display: none;
      overflow-y: auto;
    `;

    this.panel.innerHTML = `
      <div id="osc-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 600;">OSC Receiver</h3>
        <button id="osc-close-btn" style="
          background: none;
          border: none;
          color: #aaa;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          line-height: 24px;
          text-align: center;
        ">&times;</button>
      </div>

      <!-- Connection -->
      <div style="margin-bottom: 16px; padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 500;">Bridge:</span>
          <span id="osc-status" style="font-family: monospace; color: #888;">Disconnected</span>
        </div>
        <input id="osc-url" type="text" spellcheck="false" style="
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 8px;
          padding: 6px 8px;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid #555;
          border-radius: 4px;
          color: #ddd;
          font-family: monospace;
          font-size: 11px;
        " />
        <div style="display: flex; gap: 8px;">
          <button id="osc-connect-btn" style="
            flex: 1;
            padding: 8px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
          ">Connect</button>
          <button id="osc-disconnect-btn" style="
            flex: 1;
            padding: 8px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
          " disabled>Disconnect</button>
        </div>
        <div id="osc-bridge-info" style="margin-top: 8px; font-size: 11px; color: #888;"></div>
        <div id="osc-udp-row" style="margin-top: 8px; display: none; align-items: center; gap: 6px;">
          <span style="font-size: 11px; color: #aaa;">UDP port</span>
          <input id="osc-udp-port" type="number" min="1" max="65535" style="
            width: 80px;
            padding: 4px 6px;
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid #555;
            border-radius: 4px;
            color: #ddd;
            font-family: monospace;
            font-size: 11px;
          " />
          <button id="osc-udp-apply" style="
            padding: 4px 10px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
          ">Move</button>
        </div>
      </div>

      <!-- Incoming addresses -->
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">Incoming Addresses</h4>
        <div id="osc-addresses-list" style="
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          min-height: 60px;
          max-height: 150px;
          overflow-y: auto;
        "></div>
      </div>

      <!-- OSC Learn -->
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">OSC Learn</h4>
        <div style="padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
          <p style="margin: 0 0 8px 0; font-size: 11px; color: #888;">
            1. Select a parameter in the Parameter Panel<br>
            2. Click "Start OSC Learn" below<br>
            3. Move a control on your OSC sender to assign it
          </p>
          <button id="osc-learn-btn" style="
            width: 100%;
            padding: 10px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          ">Start OSC Learn</button>
          <div id="osc-learn-status" style="
            margin-top: 8px;
            padding: 8px;
            background: rgba(33, 150, 243, 0.2);
            border: 1px solid #2196F3;
            border-radius: 4px;
            font-size: 11px;
            color: #2196F3;
            display: none;
          ">Waiting for OSC input...</div>
        </div>
      </div>

      <!-- Active bindings -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="margin: 0; font-size: 13px; font-weight: 600; color: #aaa;">Active Bindings</h4>
          <button id="osc-clear-all-btn" style="
            padding: 4px 8px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
          ">Clear All</button>
        </div>
        <div id="osc-bindings-list" style="
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          min-height: 80px;
          max-height: 200px;
          overflow-y: auto;
        "></div>
      </div>

      <!-- Activity -->
      <div style="margin-bottom: 8px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">OSC Activity</h4>
        <div id="osc-activity" style="
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          min-height: 40px;
          font-family: monospace;
          font-size: 11px;
          color: #888;
          word-break: break-all;
        ">No recent activity</div>
      </div>

      <div style="font-size: 11px; color: #666; border-top: 1px solid #444; padding-top: 12px;">
        <p style="margin: 0;">
          OSC arrives over UDP, so it reaches the editor through the bridge
          started with <code>rhizo_server.py</code>. Point your sender at the
          bridge's UDP port shown above.
        </p>
      </div>
    `;

    document.body.appendChild(this.panel);

    this.urlInput = this.panel.querySelector('#osc-url');
    this.statusEl = this.panel.querySelector('#osc-status');
    this.bridgeInfoEl = this.panel.querySelector('#osc-bridge-info');
    this.addressesList = this.panel.querySelector('#osc-addresses-list');
    this.bindingsList = this.panel.querySelector('#osc-bindings-list');
    this.activityEl = this.panel.querySelector('#osc-activity');
    this.learnButton = this.panel.querySelector('#osc-learn-btn');
    this.connectBtn = this.panel.querySelector('#osc-connect-btn');
    this.disconnectBtn = this.panel.querySelector('#osc-disconnect-btn');

    this.udpRow = this.panel.querySelector('#osc-udp-row');
    this.udpPortInput = this.panel.querySelector('#osc-udp-port');

    this.urlInput.value = this.oscManager.url;
    this.addressesList.appendChild(placeholder('No OSC messages received'));
    this.bindingsList.appendChild(placeholder('No bindings configured'));

    const header = this.panel.querySelector('#osc-header');
    if (header) {
      this.cleanupDraggable = makeDraggable(this.panel, header);
    }
  }

  setupEventListeners() {
    this.panel.querySelector('#osc-close-btn').addEventListener('click', () => this.hide());

    this.connectBtn.addEventListener('click', async () => {
      const url = this.urlInput.value.trim();
      if (url && url !== this.oscManager.url) {
        this.oscManager.url = url;
      }

      this.connectBtn.disabled = true;
      try {
        await this.oscManager.initialize();
      } catch {
        // The manager keeps retrying in the background, so this is a status
        // report rather than a dead end. OSC needs a local bridge because
        // browsers cannot open a UDP socket, so the fix is almost always "that
        // process is not running" rather than anything about the sender — which
        // is worth spelling out, since the sender is where people look first.
        await modalManager.alert(
          `Could not reach the OSC bridge at ${this.oscManager.url}.\n\n` +
            `The bridge is a local process that receives OSC over UDP and passes ` +
            `it to the editor — a browser cannot listen for UDP itself. Until it ` +
            `is running, nothing your OSC sender does will connect.\n\n` +
            `Start it from the project folder:\n\n` +
            `    python osc_bridge_server.py\n\n` +
            `(python rhizo_server.py starts it too, along with the editor's server. ` +
            `If that server was already running, restart it — the bridge is new.)`,
          'OSC Bridge Not Running',
        );
      } finally {
        this.updateStatus();
      }
    });

    this.disconnectBtn.addEventListener('click', () => {
      this.oscManager.disable();
      this.updateStatus();
      this.updateAddressesList();
    });

    this.urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.connectBtn.click();
    });

    const applyUdpPort = () => {
      if (this.oscManager.setUdpPort(this.udpPortInput.value)) {
        // The bridge answers with a status message, which refreshes the panel.
        this.udpPortInput.blur();
      }
    };
    this.panel.querySelector('#osc-udp-apply').addEventListener('click', applyUdpPort);
    this.udpPortInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyUdpPort();
    });

    this.learnButton.addEventListener('click', () => {
      if (this.oscBinding.learningMode) {
        this.oscBinding.cancelLearning();
      } else {
        this.startOSCLearn();
      }
    });

    this.panel.querySelector('#osc-clear-all-btn').addEventListener('click', async () => {
      const confirmed = await modalManager.confirm(
        'Remove all OSC bindings?',
        'Clear All Bindings',
        { danger: true, confirmLabel: 'Clear All' },
      );
      if (confirmed) this.clearAllBindings();
    });

    const events = this.oscManager.eventSystem;
    if (!events) return;

    events.on('OSC_CONNECTED', () => this.updateStatus());
    events.on('OSC_DISCONNECTED', () => this.updateStatus());
    events.on('OSC_ERROR', () => this.updateStatus());
    events.on('OSC_BRIDGE_INFO', () => this.updateStatus());

    events.on('OSC_MESSAGE', (data) => {
      this.updateActivity(data);
      this.scheduleAddressesUpdate();
    });

    events.on('OSC_BINDING_CREATED', () => this.updateBindingsList());
    events.on('OSC_BINDING_REMOVED', () => this.updateBindingsList());
    events.on('OSC_BINDING_UPDATED', () => this.updateBindingsList());

    events.on('OSC_LEARN_STARTED', () => this.showLearnMode());
    events.on('OSC_LEARN_COMPLETED', () => {
      this.hideLearnMode();
      this.updateBindingsList();
    });
    events.on('OSC_LEARN_CANCELLED', () => this.hideLearnMode());
  }

  async startOSCLearn() {
    const paramPanel = window.editor?.paramPanel;

    if (!paramPanel || !paramPanel.isVisible() || !paramPanel.selectedNode) {
      await modalManager.alert(
        'Please select a node first by clicking on it, then open the Parameter Panel.',
        'OSC Learn',
      );
      return;
    }

    const selectedParam = paramPanel.getSelectedParameter();
    if (!selectedParam?.name) {
      await modalManager.alert(
        'Please click on a parameter input field first.\n\nSteps:\n1. Click on a node to select it\n' +
          '2. Click any parameter field in the Parameter Panel\n3. Click "Start OSC Learn" here\n' +
          '4. Move a control on your OSC sender',
        'OSC Learn',
      );
      return;
    }

    if (!this.oscManager.isConnected()) {
      await modalManager.alert(
        'Connect to the OSC bridge before learning — no messages can arrive until then.',
        'OSC Learn',
      );
      return;
    }

    this.oscBinding.startLearning(paramPanel.selectedNode.id, selectedParam.name);
  }

  showLearnMode() {
    const learnStatus = this.panel.querySelector('#osc-learn-status');
    const paramPanel = window.editor?.paramPanel;
    const selectedParam = paramPanel?.getSelectedParameter();
    const node = paramPanel?.selectedNode;

    if (selectedParam && node) {
      // node.kind comes out of the patch file, so build the markup instead of
      // interpolating it into innerHTML.
      learnStatus.replaceChildren(
        document.createTextNode('Waiting for OSC input...'),
        document.createElement('br'),
        Object.assign(document.createElement('strong'), {
          textContent: `${node.kind}.${selectedParam.name}`,
        }),
      );
    } else {
      learnStatus.textContent = 'Waiting for OSC input...';
    }

    learnStatus.style.display = 'block';
    this.learnButton.textContent = 'Cancel';
    this.learnButton.style.background = '#f44336';
  }

  hideLearnMode() {
    this.panel.querySelector('#osc-learn-status').style.display = 'none';
    this.learnButton.textContent = 'Start OSC Learn';
    this.learnButton.style.background = '#2196F3';
  }

  updateStatus() {
    const status = this.oscManager.getStatus();

    if (!status.supported) {
      this.statusEl.textContent = 'Not Supported';
      this.statusEl.style.color = '#f44336';
    } else if (status.connected) {
      this.statusEl.textContent = 'Connected';
      this.statusEl.style.color = '#4CAF50';
    } else if (status.enabled) {
      this.statusEl.textContent = 'Connecting...';
      this.statusEl.style.color = '#FF9800';
    } else {
      this.statusEl.textContent = 'Disconnected';
      this.statusEl.style.color = '#888';
    }

    this.connectBtn.disabled = status.connected;
    this.disconnectBtn.disabled = !status.enabled;

    this.bridgeInfoEl.replaceChildren();
    this.udpRow.style.display = 'none';

    if (status.connected && status.bridge?.udpPort) {
      const { udpHost, udpPort, udpListening, udpError } = status.bridge;

      // Keep the field showing the bridge's actual port, except while the
      // artist is typing a new one into it.
      if (document.activeElement !== this.udpPortInput) {
        this.udpPortInput.value = String(udpPort);
      }

      if (udpListening === false) {
        // Connected to the bridge, but it cannot hear OSC. Say which of the two
        // is broken, because "connected" otherwise reads as "working".
        this.statusEl.textContent = 'UDP port busy';
        this.statusEl.style.color = '#f44336';
        this.bridgeInfoEl.appendChild(
          el('div', 'color: #f44336;', udpError || `UDP ${udpPort} is not available.`),
        );
        this.bridgeInfoEl.appendChild(
          el(
            'div',
            'margin-top: 4px;',
            'Usually your OSC sender holding the same port: it should send TO this port ' +
              'from a different one, not listen on it. Free it and the bridge picks it up ' +
              'within a few seconds — or move the bridge here and point your sender at the new port.',
          ),
        );
        // Only offer the control when it is the answer to something.
        this.udpRow.style.display = 'flex';
      } else {
        this.bridgeInfoEl.appendChild(
          el('div', null, `Listening for OSC on UDP ${udpHost ?? '0.0.0.0'}:${udpPort}`),
        );
        // Listening, but carrying an error: a request to move ports was
        // refused and the bridge stayed where it was. Saying only where it is
        // listening would read as if the move had worked.
        if (udpError) {
          this.bridgeInfoEl.appendChild(el('div', 'color: #FF9800; margin-top: 4px;', udpError));
        }
        this.udpRow.style.display = 'flex';
      }
    }

    if (!status.connected && status.lastError) {
      this.bridgeInfoEl.appendChild(el('div', 'color: #f44336;', status.lastError));
      this.bridgeInfoEl.appendChild(
        el('div', 'margin-top: 4px;', 'Start it with:  python osc_bridge_server.py'),
      );
    }
  }

  scheduleAddressesUpdate() {
    if (this.addressesRAF) return;
    this.addressesRAF = requestAnimationFrame(() => {
      this.addressesRAF = null;
      if (this.visible) this.updateAddressesList();
    });
  }

  updateAddressesList() {
    const addresses = this.oscManager.getAddresses();
    this.addressesList.replaceChildren();

    if (addresses.length === 0) {
      this.addressesList.appendChild(placeholder('No OSC messages received'));
      return;
    }

    for (const entry of addresses.slice(0, 40)) {
      const row = el(
        'div',
        `padding: 6px 8px;
         margin-bottom: 4px;
         background: rgba(255, 255, 255, 0.05);
         border-radius: 4px;
         border-left: 3px solid #4CAF50;`,
      );

      row.appendChild(
        el('div', 'font-family: monospace; font-size: 11px; color: #fff;', entry.address),
      );
      row.appendChild(
        el(
          'div',
          'font-size: 10px; color: #888; margin-top: 2px;',
          entry.args.length > 0 ? entry.args.map(formatOSCArg).join(', ') : '(no arguments)',
        ),
      );

      this.addressesList.appendChild(row);
    }
  }

  updateBindingsList() {
    const bindings = this.oscBinding.getAllBindings();
    this.bindingsList.replaceChildren();

    if (bindings.length === 0) {
      this.bindingsList.appendChild(placeholder('No bindings configured'));
      return;
    }

    for (const binding of bindings) {
      const node = window.editor?.graph?.nodes?.find((n) => n.id === binding.nodeId);
      const nodeName = node ? node.kind : 'Unknown';

      const row = el(
        'div',
        `padding: 8px;
         margin-bottom: 6px;
         background: rgba(255, 255, 255, 0.05);
         border-radius: 4px;
         border-left: 3px solid ${binding.enabled ? '#2196F3' : '#666'};
         display: flex;
         justify-content: space-between;
         align-items: flex-start;`,
      );

      const details = el('div', 'flex: 1; min-width: 0;');
      details.appendChild(
        el(
          'div',
          'font-weight: 500; font-size: 11px; color: #2196F3; font-family: monospace; word-break: break-all;',
          binding.argIndex > 0 ? `${binding.address} [${binding.argIndex}]` : binding.address,
        ),
      );
      details.appendChild(
        el('div', 'font-size: 11px; color: #fff; margin-top: 2px;', `${nodeName}.${binding.paramName}`),
      );
      details.appendChild(
        el(
          'div',
          'font-size: 10px; color: #888; margin-top: 2px;',
          `In ${binding.inputMin} – ${binding.inputMax} → ` +
            `${binding.min.toFixed(2)} – ${binding.max.toFixed(2)}` +
            (binding.curve !== 'linear' ? ` (${binding.curve})` : '') +
            (binding.inverted ? ' inverted' : ''),
        ),
      );

      const removeBtn = el(
        'button',
        `padding: 4px 8px;
         margin-left: 8px;
         background: #f44336;
         color: white;
         border: none;
         border-radius: 3px;
         cursor: pointer;
         font-size: 10px;
         flex: none;`,
        'Remove',
      );
      // A listener rather than an inline onclick: the address is attacker-shaped
      // text and must never be spliced into code.
      removeBtn.addEventListener('click', () => {
        this.removeBinding(binding.address, binding.argIndex);
      });

      row.appendChild(details);
      row.appendChild(removeBtn);
      this.bindingsList.appendChild(row);
    }
  }

  updateActivity(data) {
    this.pendingActivityData = data;

    const now = performance.now();
    if (now - this.lastActivityUpdate < this.activityUpdateThrottle) {
      if (!this.activityRAF) {
        this.activityRAF = requestAnimationFrame(() => this._performActivityUpdate());
      }
      return;
    }

    this._performActivityUpdate();
  }

  _performActivityUpdate() {
    this.activityRAF = null;

    const data = this.pendingActivityData;
    this.pendingActivityData = null;
    if (!data || !this.visible) return;

    const args = data.args?.length ? data.args.map(formatOSCArg).join(', ') : '(no arguments)';

    this.activityEl.replaceChildren(
      el('div', null, new Date().toLocaleTimeString()),
      el('div', 'color: #ddd;', data.address),
      el('div', null, args),
      el('div', 'color: #666;', `${this.oscManager.messageRate.toFixed(0)} msg/s`),
    );

    this.activityEl.style.opacity = '1';
    setTimeout(() => {
      this.activityEl.style.opacity = '0.5';
    }, 300);

    this.lastActivityUpdate = performance.now();
  }

  removeBinding(address, argIndex) {
    this.oscBinding.removeBinding(address, argIndex);
    this.updateBindingsList();
  }

  clearAllBindings() {
    for (const binding of this.oscBinding.getAllBindings()) {
      this.oscBinding.removeBinding(binding.address, binding.argIndex);
    }
    this.updateBindingsList();
  }

  show() {
    if (!this.panel) return;
    this.panel.style.display = 'block';
    this.visible = true;
    this.updateStatus();
    this.updateAddressesList();
    this.updateBindingsList();
  }

  hide() {
    if (!this.panel) return;
    this.panel.style.display = 'none';
    this.visible = false;
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }

  destroy() {
    if (this.activityRAF) cancelAnimationFrame(this.activityRAF);
    if (this.addressesRAF) cancelAnimationFrame(this.addressesRAF);
    this.cleanupDraggable?.();
    this.panel?.remove();
    this.panel = null;
  }
}

let instance = null;

export function getOSCSettingsPanel(oscManager, oscBinding) {
  if (!instance && oscManager && oscBinding) {
    instance = new OSCSettingsPanel(oscManager, oscBinding);
  }
  return instance;
}

export default OSCSettingsPanel;
