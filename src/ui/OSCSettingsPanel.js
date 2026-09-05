// src/ui/OSCSettingsPanel.js

import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';
import { modalManager } from './ModalManager.js';
import { formatOSCArg } from '../osc/OSCDecoder.js';

/**
 * OSCSettingsPanel - UI for the OSC bridge connection and address mappings.
 *
 * Laid out to match MIDISettingsPanel so the two feel like one system, with two
 * deliberate differences.
 *
 * First, everything that came off the network — addresses, argument values, the
 * bridge's own error text — is written with textContent rather than
 * interpolated into innerHTML. Device names in the MIDI panel come from
 * hardware the user plugged in; OSC addresses come from anything that can reach
 * the port.
 *
 * Second, this is built for mapping a rack rather than a knob. A MIDI
 * controller has a handful of CCs and you learn them one at a time; an OSC
 * source sends a dozen channels at once and they are all visible in the address
 * list before you map any of them. So a channel can be bound by clicking it,
 * learn stays armed across consecutive maps, and one channel can drive several
 * parameters.
 */

const PLACEHOLDER_STYLE = 'color: #6f6559; font-size: 12px; font-style: italic;';

// How often to re-read the Parameter Panel's selection. There is no selection
// event to listen for, and the "current target" readout is only honest if it
// tracks what the artist last clicked.
const TARGET_POLL_MS = 250;

const CURVES = ['linear', 'exponential', 'logarithmic'];

function placeholder(text) {
  const div = document.createElement('div');
  div.style.cssText = PLACEHOLDER_STYLE;
  div.textContent = text;
  return div;
}

/**
 * Order channels by address, numerically where they end in digits.
 *
 * A rack's channels are '/vcv/ch1'…'/vcv/ch10', and plain string order puts
 * ch10 between ch1 and ch2 — which reads as a bug when you are looking down a
 * list for the one you want.
 */
function compareAddresses(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SMALL_INPUT = `
  width: 46px;
  padding: 2px 4px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255,244,230,0.08);
  border-radius: 3px;
  color: #cabfb0;
  font-family: var(--rz-font-mono);
  font-size: 10px;
`;

const CHIP_BUTTON = `
  padding: 3px 8px;
  background: rgba(33, 150, 243, 0.25);
  color: #8ecbff;
  border: 1px solid rgba(33, 150, 243, 0.5);
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
`;

export class OSCSettingsPanel {
  constructor(oscManager, oscBinding) {
    this.oscManager = oscManager;
    this.oscBinding = oscBinding;
    this.panel = null;
    this.visible = false;
    this.cleanupDraggable = null;
    this.cleanupResizable = null;

    // Throttle the activity readout — OSC senders happily push hundreds of
    // messages a second and each one must not cost a DOM write.
    this.lastActivityUpdate = 0;
    this.activityUpdateThrottle = 100;
    this.pendingActivityData = null;
    this.activityRAF = null;

    // Address rows are built once and their values updated in place. With a
    // rack running, rebuilding the list on every message would be the most
    // expensive thing the editor does.
    this.addressRows = new Map();
    this.addressesRAF = null;
    this.addressFilter = '';
    this.addressOrderKey = '';

    this.targetTimer = null;
    this.lastTargetKey = null;
    this.stickyTarget = null;

    this.createPanel();
    this.setupEventListeners();
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'osc-settings-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 96px;
      right: 372px;
      width: 360px;
      max-height: 84vh;
      background: rgba(30, 30, 30, 0.95);
      border: 1px solid rgba(255,244,230,0.08);
      border-radius: 8px;
      color: #f3ede4;
      font-family: var(--rz-font-ui);
      font-size: 13px;
      /* Above the MIDI panel, which otherwise sits at the same spot with the
         same z-index — two stacked panels look like one misbehaving panel. */
      z-index: 1001;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      display: none;
      flex-direction: column;
      overflow: hidden;
    `;

    this.panel.innerHTML = `
      <div id="osc-header" style="display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 12px; flex: 0 0 auto;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 600;">OSC Receiver</h3>
        <button id="osc-close-btn" style="
          background: none; border: none; color: #8f867a; font-size: 20px;
          cursor: pointer; padding: 0; width: 24px; height: 24px;
          line-height: 24px; text-align: center;
        ">&times;</button>
      </div>

      <!-- Everything below the header scrolls, so the panel itself stays a
           fixed box: the resize handles live on its edges and must not scroll
           away with the content. -->
      <div class="osc-panel-body" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 16px 16px;">

      <!-- Connection -->
      <div style="margin-bottom: 14px; padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 500;">Bridge:</span>
          <span id="osc-status" style="font-family: var(--rz-font-mono); color: #6f6559;">Disconnected</span>
        </div>
        <input id="osc-url" type="text" spellcheck="false" style="
          width: 100%; box-sizing: border-box; margin-bottom: 8px; padding: 6px 8px;
          background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255,244,230,0.08); border-radius: 4px;
          color: #cabfb0; font-family: var(--rz-font-mono); font-size: 11px;
        " />
        <div style="display: flex; gap: 8px;">
          <button id="osc-connect-btn" style="
            flex: 1; padding: 8px; background: #c6f24e; color: #14110a; border: none;
            border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;
          ">Connect</button>
          <button id="osc-disconnect-btn" style="
            flex: 1; padding: 8px; background: #f8615a; color: white; border: none;
            border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;
          " disabled>Disconnect</button>
        </div>
        <div id="osc-bridge-info" style="margin-top: 8px; font-size: 11px; color: #6f6559;"></div>
        <div id="osc-udp-row" style="margin-top: 8px; display: none; align-items: center; gap: 6px;">
          <span style="font-size: 11px; color: #8f867a;">UDP port</span>
          <input id="osc-udp-port" type="number" min="1" max="65535" style="
            width: 80px; padding: 4px 6px; background: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(255,244,230,0.08); border-radius: 4px; color: #cabfb0;
            font-family: var(--rz-font-mono); font-size: 11px;
          " />
          <button id="osc-udp-apply" style="
            padding: 4px 10px; background: #c6f24e; color: #14110a; border: none;
            border-radius: 3px; cursor: pointer; font-size: 11px;
          ">Move</button>
        </div>
      </div>

      <!-- Mapping target + learn -->
      <div style="margin-bottom: 14px; padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
          <span style="font-weight: 500; font-size: 12px;">Mapping to:</span>
          <span id="osc-target" style="font-family: var(--rz-font-mono); font-size: 11px; color: #f5a524;">nothing selected</span>
        </div>
        <p style="margin: 0 0 8px 0; font-size: 11px; color: #6f6559;">
          Click a parameter in the Parameter Panel, then press <strong>Bind</strong>
          on a channel below. Or start learn and <em>move</em> a control — channels
          sitting still are ignored, so a rack streaming all its outputs will not
          grab the mapping.
        </p>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button id="osc-learn-btn" style="
            flex: 1; padding: 9px; background: #c6f24e; color: #14110a; border: none;
            border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
          ">Start OSC Learn</button>
          <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: #8f867a; cursor: pointer;">
            <input id="osc-continuous" type="checkbox" style="cursor: pointer;" />
            keep armed
          </label>
        </div>
        <div id="osc-learn-status" style="
          margin-top: 8px; padding: 8px; background: rgba(33, 150, 243, 0.2);
          border: 1px solid #c6f24e; border-radius: 4px; font-size: 11px;
          color: #c6f24e; display: none;
        ">Waiting for OSC input...</div>
      </div>

      <!-- Incoming channels -->
      <div style="margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px;">
          <h4 style="margin: 0; font-size: 13px; font-weight: 600; color: #8f867a; white-space: nowrap;">
            Channels <span id="osc-address-count" style="color: rgba(255,244,230,0.13); font-weight: 400;"></span>
          </h4>
          <input id="osc-filter" type="text" placeholder="filter…" spellcheck="false" style="
            flex: 1; min-width: 0; padding: 3px 6px; background: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(255,244,230,0.08); border-radius: 3px; color: #cabfb0;
            font-family: var(--rz-font-mono); font-size: 10px;
          " />
        </div>
        <div id="osc-addresses-list" style="
          background: rgba(0, 0, 0, 0.3); border-radius: 4px; padding: 8px;
          min-height: 60px; max-height: 190px; overflow-y: auto;
        "></div>
      </div>

      <!-- Active bindings -->
      <div style="margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="margin: 0; font-size: 13px; font-weight: 600; color: #8f867a;">
            Bindings <span id="osc-binding-count" style="color: rgba(255,244,230,0.13); font-weight: 400;"></span>
          </h4>
          <button id="osc-clear-all-btn" style="
            padding: 4px 8px; background: #f8615a; color: white; border: none;
            border-radius: 3px; cursor: pointer; font-size: 10px;
          ">Clear All</button>
        </div>
        <div id="osc-bindings-list" style="
          background: rgba(0, 0, 0, 0.3); border-radius: 4px; padding: 8px;
          min-height: 60px; max-height: 240px; overflow-y: auto;
        "></div>
      </div>

      <!-- Activity -->
      <div style="margin-bottom: 8px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #8f867a;">OSC Activity</h4>
        <div id="osc-activity" style="
          background: rgba(0, 0, 0, 0.3); border-radius: 4px; padding: 8px;
          min-height: 40px; font-family: var(--rz-font-mono); font-size: 11px; color: #6f6559;
          word-break: break-all;
        ">No recent activity</div>
      </div>

      <div style="font-size: 11px; color: rgba(255,244,230,0.13); border-top: 1px solid #1a1611; padding-top: 12px;">
        <p style="margin: 0;">
          One channel can drive several parameters — bind it again to another.
          Ranges below the arrow map the incoming value onto the parameter.
        </p>
      </div>
      </div>
    `;

    document.body.appendChild(this.panel);

    this.urlInput = this.panel.querySelector('#osc-url');
    this.statusEl = this.panel.querySelector('#osc-status');
    this.bridgeInfoEl = this.panel.querySelector('#osc-bridge-info');
    this.udpRow = this.panel.querySelector('#osc-udp-row');
    this.udpPortInput = this.panel.querySelector('#osc-udp-port');
    this.targetEl = this.panel.querySelector('#osc-target');
    this.addressesList = this.panel.querySelector('#osc-addresses-list');
    this.addressCountEl = this.panel.querySelector('#osc-address-count');
    this.bindingsList = this.panel.querySelector('#osc-bindings-list');
    this.bindingCountEl = this.panel.querySelector('#osc-binding-count');
    this.activityEl = this.panel.querySelector('#osc-activity');
    this.learnButton = this.panel.querySelector('#osc-learn-btn');
    this.continuousBox = this.panel.querySelector('#osc-continuous');
    this.filterInput = this.panel.querySelector('#osc-filter');
    this.connectBtn = this.panel.querySelector('#osc-connect-btn');
    this.disconnectBtn = this.panel.querySelector('#osc-disconnect-btn');

    this.urlInput.value = this.oscManager.url;
    this.addressesList.appendChild(placeholder('No OSC messages received'));
    this.bindingsList.appendChild(placeholder('No bindings configured'));

    const header = this.panel.querySelector('#osc-header');
    if (header) this.cleanupDraggable = makeDraggable(this.panel, header);
    // Parked against the right edge beside the parameter panel; keep it there.
    this.cleanupResizable = makeResizable(this.panel, {
      minWidth: 300,
      minHeight: 240,
      anchor: { x: 'right', y: 'top' },
    });
  }

  // --------------------------------------------------------------------
  // Wiring
  // --------------------------------------------------------------------

  setupEventListeners() {
    this.panel.querySelector('#osc-close-btn').addEventListener('click', () => this.hide());

    this.connectBtn.addEventListener('click', async () => {
      const url = this.urlInput.value.trim();
      if (url && url !== this.oscManager.url) this.oscManager.url = url;

      this.connectBtn.disabled = true;
      try {
        await this.oscManager.initialize();
      } catch {
        // The manager keeps retrying in the background, so this is a status
        // report rather than a dead end. OSC needs a local bridge because
        // browsers cannot open a UDP socket, so the fix is almost always "that
        // process is not running" rather than anything about the sender —
        // which is worth spelling out, since the sender is where people look.
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
      if (this.oscManager.setUdpPort(this.udpPortInput.value)) this.udpPortInput.blur();
    };
    this.panel.querySelector('#osc-udp-apply').addEventListener('click', applyUdpPort);
    this.udpPortInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyUdpPort();
    });

    this.learnButton.addEventListener('click', () => {
      if (this.oscBinding.learningMode) this.oscBinding.cancelLearning();
      else this.startOSCLearn();
    });

    this.continuousBox.addEventListener('change', () => {
      this.oscBinding.setContinuousLearn(this.continuousBox.checked);
    });

    this.filterInput.addEventListener('input', () => {
      this.addressFilter = this.filterInput.value.trim().toLowerCase();
      this.updateAddressesList();
    });

    this.panel.querySelector('#osc-clear-all-btn').addEventListener('click', async () => {
      const count = this.oscBinding.getAllBindings().length;
      if (!count) return;
      const confirmed = await modalManager.confirm(
        `Remove all ${count} OSC binding${count === 1 ? '' : 's'}?`,
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

    // Structural changes only: re-rendering on every OSC_BINDING_UPDATED would
    // tear out the range field being typed into.
    events.on('OSC_BINDING_CREATED', () => this.updateBindingsList());
    events.on('OSC_BINDING_REMOVED', () => this.updateBindingsList());

    events.on('OSC_LEARN_STARTED', () => this.showLearnMode());
    events.on('OSC_LEARN_AWAITING_TARGET', () => this.showLearnMode());
    events.on('OSC_LEARN_COMPLETED', () => {
      this.updateBindingsList();
      if (!this.oscBinding.learningMode) this.hideLearnMode();
    });
    events.on('OSC_LEARN_CANCELLED', () => this.hideLearnMode());
  }

  // --------------------------------------------------------------------
  // Mapping target
  // --------------------------------------------------------------------

  /**
   * The parameter a bind would land on, or null.
   *
   * Falls back to the last parameter seen selected. Clicking Bind moves focus
   * out of the Parameter Panel's input, and the panel reads its selection from
   * what is focused — so asking at click time can come back empty for a
   * parameter the artist has plainly just chosen.
   */
  currentTarget() {
    const live = this.liveTarget();
    if (live) {
      this.stickyTarget = live;
      return live;
    }

    // Only reuse it while the node is still in the graph.
    const sticky = this.stickyTarget;
    if (sticky && window.editor?.graph?.nodes?.some((n) => n.id === sticky.node.id)) {
      return sticky;
    }

    this.stickyTarget = null;
    return null;
  }

  /** What the Parameter Panel says is selected right now. */
  liveTarget() {
    const paramPanel = window.editor?.paramPanel;
    if (!paramPanel?.selectedNode) return null;

    const param = paramPanel.getSelectedParameter?.();
    if (!param?.name) return null;

    return { node: paramPanel.selectedNode, paramName: param.name };
  }

  /**
   * Refresh the target readout, and retarget an armed continuous learn.
   *
   * There is no selection event to subscribe to, so this is polled while the
   * panel is open and does nothing unless the selection actually changed.
   */
  refreshTarget() {
    const target = this.currentTarget();
    const key = target ? `${target.node.id}.${target.paramName}` : null;
    if (key === this.lastTargetKey) return;
    this.lastTargetKey = key;

    if (target) {
      this.targetEl.textContent = `${target.node.kind}.${target.paramName}`;
      this.targetEl.style.color = '#c6f24e';
      if (this.oscBinding.continuousLearn && this.oscBinding.learningMode) {
        this.oscBinding.retargetLearning(target.node.id, target.paramName);
      }
    } else {
      this.targetEl.textContent = 'nothing selected';
      this.targetEl.style.color = '#f5a524';
    }
  }

  async startOSCLearn() {
    const target = this.currentTarget();
    if (!target) {
      await modalManager.alert(
        'Pick a parameter first.\n\n1. Click a node to select it\n' +
          '2. Click the parameter field you want to drive\n' +
          '3. Then start learn, or press Bind on a channel',
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

    this.oscBinding.startLearning(target.node.id, target.paramName);
  }

  /** Bind an address (and argument slot) to whatever is selected. */
  async bindAddress(address, argIndex) {
    // Pressing Bind is an explicit choice about which channel to map, so it
    // wins over an armed learn rather than racing it — otherwise the next
    // message to arrive would map a different channel to the same parameter.
    if (this.oscBinding.learningMode) this.oscBinding.cancelLearning();

    const target = this.currentTarget();
    if (!target) {
      await modalManager.alert(
        'Pick a parameter first — click a node, then the parameter field you want this channel to drive.',
        'Bind Channel',
      );
      return;
    }

    // Seed the input range from what this channel is actually sending, the way
    // learn does, so a 0-127 or 0-360 source does not arrive clamped to 1.
    const observed = this.oscManager.getValue(address, argIndex);
    const options = {};
    if (observed > 1) options.inputMax = observed;
    else if (observed < 0) options.inputMin = observed;

    this.oscBinding.createBinding(address, argIndex, target.node.id, target.paramName, options);
  }

  showLearnMode() {
    const learnStatus = this.panel.querySelector('#osc-learn-status');
    const target = this.currentTarget();

    if (this.oscBinding.continuousLearn && !this.oscBinding.learningTarget?.nodeId) {
      learnStatus.textContent = 'Mapped. Select the next parameter…';
    } else if (target) {
      // node.kind comes out of the patch file, so build the markup instead of
      // interpolating it into innerHTML.
      learnStatus.replaceChildren(
        document.createTextNode('Move a control to map it…'),
        document.createElement('br'),
        Object.assign(document.createElement('strong'), {
          textContent: `${target.node.kind}.${target.paramName}`,
        }),
      );
    } else {
      learnStatus.textContent = 'Move a control to map it…';
    }

    learnStatus.style.display = 'block';
    this.learnButton.textContent = 'Stop Learning';
    this.learnButton.style.background = '#f8615a';
  }

  hideLearnMode() {
    this.panel.querySelector('#osc-learn-status').style.display = 'none';
    this.learnButton.textContent = 'Start OSC Learn';
    this.learnButton.style.background = '#c6f24e';
  }

  // --------------------------------------------------------------------
  // Connection status
  // --------------------------------------------------------------------

  updateStatus() {
    const status = this.oscManager.getStatus();

    if (!status.supported) {
      this.statusEl.textContent = 'Not Supported';
      this.statusEl.style.color = '#f8615a';
    } else if (status.connected) {
      this.statusEl.textContent = 'Connected';
      this.statusEl.style.color = '#c6f24e';
    } else if (status.enabled) {
      this.statusEl.textContent = 'Connecting...';
      this.statusEl.style.color = '#f5a524';
    } else {
      this.statusEl.textContent = 'Disconnected';
      this.statusEl.style.color = '#6f6559';
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
        this.statusEl.style.color = '#f8615a';
        this.bridgeInfoEl.appendChild(
          el('div', 'color: #f8615a;', udpError || `UDP ${udpPort} is not available.`),
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
      } else {
        this.bridgeInfoEl.appendChild(
          el('div', null, `Listening for OSC on UDP ${udpHost ?? '0.0.0.0'}:${udpPort}`),
        );
        // Listening, but carrying an error: a request to move ports was
        // refused and the bridge stayed where it was. Saying only where it is
        // listening would read as if the move had worked.
        if (udpError) {
          this.bridgeInfoEl.appendChild(el('div', 'color: #f5a524; margin-top: 4px;', udpError));
        }
      }
      this.udpRow.style.display = 'flex';
    }

    if (!status.connected && status.lastError) {
      this.bridgeInfoEl.appendChild(el('div', 'color: #f8615a;', status.lastError));
      this.bridgeInfoEl.appendChild(
        el('div', 'margin-top: 4px;', 'Start it with:  python osc_bridge_server.py'),
      );
    }
  }

  // --------------------------------------------------------------------
  // Channels
  // --------------------------------------------------------------------

  scheduleAddressesUpdate() {
    if (this.addressesRAF) return;
    this.addressesRAF = requestAnimationFrame(() => {
      this.addressesRAF = null;
      if (this.visible) this.updateAddressesList();
    });
  }

  matchesFilter(address) {
    return !this.addressFilter || address.toLowerCase().includes(this.addressFilter);
  }

  /**
   * Refresh the channel list.
   *
   * Two rules here, both learned the hard way.
   *
   * Rows are sorted by address and their DOM order is only touched when the
   * set of channels actually changes. Sorting by recency meant a running rack
   * reshuffled the list continuously, so a channel was never where you last
   * saw it — and re-appending a row between mousedown and mouseup cancels the
   * click, which left the Bind buttons dead for exactly the senders this list
   * exists to serve.
   *
   * Rows are reused and only their values rewritten, because rebuilding this
   * list per message would be the most expensive thing on screen.
   */
  updateAddressesList() {
    const entries = this.oscManager
      .getAddresses()
      .filter((e) => this.matchesFilter(e.address))
      .sort((a, b) => compareAddresses(a.address, b.address));
    const total = this.oscManager.getStatus().addressCount;

    this.addressCountEl.textContent = total
      ? (entries.length === total ? `(${total})` : `(${entries.length}/${total})`)
      : '';

    if (entries.length === 0) {
      this.addressRows.clear();
      this.addressOrderKey = '';
      this.addressesList.replaceChildren(
        placeholder(total ? 'No channels match the filter' : 'No OSC messages received'),
      );
      return;
    }

    // Drop rows that no longer belong (filtered out, or evicted).
    const wanted = new Set(entries.map((e) => e.address));
    for (const [address, row] of this.addressRows) {
      if (!wanted.has(address)) {
        row.root.remove();
        this.addressRows.delete(address);
      }
    }

    const targetsByKey = this.bindingTargetsByChannel();

    let rebuilt = false;
    for (const entry of entries) {
      let row = this.addressRows.get(entry.address);

      // Argument count decides the row's controls, so a message that grows or
      // shrinks needs its row rebuilt rather than refreshed.
      if (row && row.argCount !== Math.max(entry.args.length, 1)) {
        row.root.remove();
        this.addressRows.delete(entry.address);
        row = null;
      }

      if (!row) {
        row = this.buildAddressRow(entry);
        this.addressRows.set(entry.address, row);
        rebuilt = true;
      }

      this.refreshAddressRow(row, entry, targetsByKey);
    }

    // Only reorder when the membership changed — which is when a channel is
    // first heard, not on every message.
    const orderKey = entries.map((e) => e.address).join(' ');
    if (rebuilt || orderKey !== this.addressOrderKey) {
      this.addressOrderKey = orderKey;
      this.addressesList.replaceChildren(
        ...entries.map((e) => this.addressRows.get(e.address).root),
      );
    }
  }

  /** "address:argIndex" -> the parameters that slot drives. */
  bindingTargetsByChannel() {
    const byKey = new Map();
    for (const binding of this.oscBinding.getAllBindings()) {
      const key = `${binding.address}:${binding.argIndex}`;
      const node = window.editor?.graph?.nodes?.find((n) => n.id === binding.nodeId);
      const label = `${node ? node.kind : 'Unknown'}.${binding.paramName}`;
      if (byKey.has(key)) byKey.get(key).push(label);
      else byKey.set(key, [label]);
    }
    return byKey;
  }

  buildAddressRow(entry) {
    const argCount = Math.max(entry.args.length, 1);

    const root = el(
      'div',
      `padding: 6px 8px; margin-bottom: 5px; background: rgba(255, 255, 255, 0.05);
       border-radius: 4px; border-left: 3px solid #c6f24e;`,
    );

    const top = el('div', 'display: flex; justify-content: space-between; gap: 8px; align-items: baseline;');
    const addressEl = el(
      'div',
      'font-family: var(--rz-font-mono); font-size: 11px; color: #f3ede4; word-break: break-all;',
      entry.address,
    );
    addressEl.className = 'osc-channel-address';
    const valueEl = el('div', 'font-family: var(--rz-font-mono); font-size: 10px; color: #8ecbff; white-space: nowrap;');
    top.append(addressEl, valueEl);

    const controls = el('div', 'display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; align-items: center;');
    const bindButtons = [];
    for (let i = 0; i < argCount; i++) {
      const button = el('button', CHIP_BUTTON, argCount === 1 ? 'Bind' : `Bind ${i}`);
      button.addEventListener('click', () => this.bindAddress(entry.address, i));
      controls.appendChild(button);
      bindButtons.push(button);
    }

    // What this channel currently drives. Without it the only way to answer
    // "is this one already doing something, and what?" is to read the bindings
    // list and match addresses by eye.
    const targetsEl = el('div', 'margin-top: 4px; font-size: 10px; color: #a5d6a7;');

    root.append(top, controls, targetsEl);
    return { root, valueEl, targetsEl, bindButtons, argCount };
  }

  refreshAddressRow(row, entry, targetsByKey) {
    row.valueEl.textContent = entry.args.length
      ? entry.args.map(formatOSCArg).join('  ')
      : '(no args)';

    // Mark which slots are already driving something, so a rack of channels
    // shows at a glance what is left to map.
    const lines = [];
    row.bindButtons.forEach((button, i) => {
      const targets = targetsByKey.get(`${entry.address}:${i}`);
      const bound = !!targets?.length;

      button.style.background = bound ? 'rgba(198, 242, 78, 0.25)' : 'rgba(33, 150, 243, 0.25)';
      button.style.borderColor = bound ? 'rgba(198, 242, 78, 0.5)' : 'rgba(33, 150, 243, 0.5)';
      button.style.color = bound ? '#a5d6a7' : '#8ecbff';
      button.title = bound ? 'Already mapped — bind again to drive another parameter' : '';

      if (bound) {
        const prefix = row.bindButtons.length > 1 ? `[${i}] ` : '';
        lines.push(`${prefix}→ ${targets.join(', ')}`);
      }
    });

    // Node kinds and parameter names, so build the text rather than markup.
    row.targetsEl.replaceChildren(...lines.map((line) => el('div', null, line)));
  }

  // --------------------------------------------------------------------
  // Bindings
  // --------------------------------------------------------------------

  updateBindingsList() {
    const bindings = this.oscBinding.getAllBindings();
    this.bindingCountEl.textContent = bindings.length ? `(${bindings.length})` : '';
    this.bindingsList.replaceChildren();

    if (bindings.length === 0) {
      this.bindingsList.appendChild(placeholder('No bindings configured'));
      return;
    }

    // Group by channel so a source driving several parameters reads as one
    // thing rather than as repeated rows.
    const byChannel = new Map();
    for (const binding of bindings) {
      const key = `${binding.address}:${binding.argIndex}`;
      if (!byChannel.has(key)) byChannel.set(key, []);
      byChannel.get(key).push(binding);
    }

    for (const [, group] of byChannel) {
      this.bindingsList.appendChild(this.buildChannelGroup(group));
    }
  }

  buildChannelGroup(group) {
    const [first] = group;
    const wrapper = el(
      'div',
      `margin-bottom: 8px; padding: 7px 8px; background: rgba(255, 255, 255, 0.05);
       border-radius: 4px; border-left: 3px solid #c6f24e;`,
    );

    const heading = el('div', 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px;');
    heading.appendChild(
      el(
        'div',
        'font-weight: 500; font-size: 11px; color: #c6f24e; font-family: var(--rz-font-mono); word-break: break-all;',
        first.argIndex > 0 ? `${first.address} [${first.argIndex}]` : first.address,
      ),
    );
    if (group.length > 1) {
      heading.appendChild(
        el('div', 'font-size: 10px; color: #6f6559; white-space: nowrap;', `${group.length} targets`),
      );
    }
    wrapper.appendChild(heading);

    for (const binding of group) wrapper.appendChild(this.buildBindingRow(binding));
    return wrapper;
  }

  buildBindingRow(binding) {
    const node = window.editor?.graph?.nodes?.find((n) => n.id === binding.nodeId);
    const nodeName = node ? node.kind : 'Unknown';

    const row = el('div', 'margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.07);');

    const header = el('div', 'display: flex; justify-content: space-between; align-items: center; gap: 6px;');
    header.appendChild(
      el('div', 'font-size: 11px; color: #f3ede4; flex: 1; min-width: 0;', `${nodeName}.${binding.paramName}`),
    );

    const enableBox = document.createElement('input');
    enableBox.type = 'checkbox';
    enableBox.checked = binding.enabled !== false;
    enableBox.title = 'Enabled';
    enableBox.style.cssText = 'cursor: pointer; flex: none;';
    enableBox.addEventListener('change', () => {
      this.oscBinding.updateBindingForParameter(binding.nodeId, binding.paramName, {
        enabled: enableBox.checked,
      });
    });
    header.appendChild(enableBox);

    const removeBtn = el(
      'button',
      `padding: 2px 7px; background: #f8615a; color: white; border: none;
       border-radius: 3px; cursor: pointer; font-size: 10px; flex: none;`,
      '×',
    );
    removeBtn.title = 'Remove this binding';
    // A listener rather than an inline onclick: the address is attacker-shaped
    // text and must never be spliced into code.
    removeBtn.addEventListener('click', () => {
      this.oscBinding.removeBindingForParameter(binding.nodeId, binding.paramName);
      this.updateBindingsList();
    });
    header.appendChild(removeBtn);
    row.appendChild(header);

    row.appendChild(this.buildRangeControls(binding));
    return row;
  }

  buildRangeControls(binding) {
    const controls = el(
      'div',
      'display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; font-size: 10px; color: #6f6559;',
    );

    const field = (key, title) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = String(binding[key]);
      input.title = title;
      input.style.cssText = SMALL_INPUT;
      const commit = () => {
        const value = parseFloat(input.value);
        if (!Number.isFinite(value)) {
          input.value = String(binding[key]);
          return;
        }
        this.oscBinding.updateBindingForParameter(binding.nodeId, binding.paramName, {
          [key]: value,
        });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });
      return input;
    };

    controls.append(
      el('span', null, 'in'),
      field('inputMin', 'Lowest value this channel sends'),
      field('inputMax', 'Highest value this channel sends'),
      el('span', 'color: rgba(255,244,230,0.13);', '→'),
      field('min', 'Parameter value at the low end'),
      field('max', 'Parameter value at the high end'),
    );

    const curve = document.createElement('select');
    curve.style.cssText = `${SMALL_INPUT} width: auto;`;
    curve.title = 'Response curve';
    for (const name of CURVES) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name.slice(0, 3);
      if (binding.curve === name) option.selected = true;
      curve.appendChild(option);
    }
    curve.addEventListener('change', () => {
      this.oscBinding.updateBindingForParameter(binding.nodeId, binding.paramName, {
        curve: curve.value,
      });
    });
    controls.appendChild(curve);

    const invert = document.createElement('input');
    invert.type = 'checkbox';
    invert.checked = !!binding.inverted;
    invert.title = 'Invert';
    invert.style.cssText = 'cursor: pointer;';
    invert.addEventListener('change', () => {
      this.oscBinding.updateBindingForParameter(binding.nodeId, binding.paramName, {
        inverted: invert.checked,
      });
    });
    controls.append(invert, el('span', null, 'inv'));

    return controls;
  }

  clearAllBindings() {
    for (const binding of this.oscBinding.getAllBindings()) {
      this.oscBinding.removeBindingForParameter(binding.nodeId, binding.paramName);
    }
    this.updateBindingsList();
  }

  removeBinding(address, argIndex) {
    this.oscBinding.removeBinding(address, argIndex);
    this.updateBindingsList();
  }

  // --------------------------------------------------------------------
  // Activity
  // --------------------------------------------------------------------

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
      el('div', 'color: #cabfb0;', data.address),
      el('div', null, args),
      el('div', 'color: rgba(255,244,230,0.13);', `${this.oscManager.messageRate.toFixed(0)} msg/s`),
    );

    this.activityEl.style.opacity = '1';
    setTimeout(() => {
      this.activityEl.style.opacity = '0.5';
    }, 300);

    this.lastActivityUpdate = performance.now();
  }

  // --------------------------------------------------------------------
  // Visibility
  // --------------------------------------------------------------------

  show() {
    if (!this.panel) return;
    this.panel.style.display = 'flex';
    this.visible = true;
    this.continuousBox.checked = !!this.oscBinding.continuousLearn;
    this.updateStatus();
    this.updateAddressesList();
    this.updateBindingsList();

    this.lastTargetKey = undefined;
    this.refreshTarget();
    if (!this.targetTimer) {
      this.targetTimer = setInterval(() => this.refreshTarget(), TARGET_POLL_MS);
    }
  }

  hide() {
    if (!this.panel) return;
    this.panel.style.display = 'none';
    this.visible = false;
    if (this.targetTimer) {
      clearInterval(this.targetTimer);
      this.targetTimer = null;
    }
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }

  destroy() {
    this.hide();
    if (this.activityRAF) cancelAnimationFrame(this.activityRAF);
    if (this.addressesRAF) cancelAnimationFrame(this.addressesRAF);
    this.cleanupDraggable?.();
    this.cleanupResizable?.();
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
