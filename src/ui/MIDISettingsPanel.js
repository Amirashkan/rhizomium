// src/ui/MIDISettingsPanel.js

import { makeDraggable } from './utils/draggable.js';
import { modalManager } from './ModalManager.js';

/**
 * MIDISettingsPanel - UI for configuring MIDI controllers and parameter mappings
 */
export class MIDISettingsPanel {
  constructor(midiManager, midiBinding) {
    this.midiManager = midiManager;
    this.midiBinding = midiBinding;
    this.panel = null;
    this.visible = false;
    this.learnButton = null;
    this.devicesList = null;
    this.bindingsList = null;
    this.cleanupDraggable = null;

    // Throttle updateActivity to prevent excessive DOM updates
    this.lastActivityUpdate = 0;
    this.activityUpdateThrottle = 100; // ms (10 updates/sec max)
    this.pendingActivityData = null;
    this.activityRAF = null;

    this.createPanel();
    this.setupEventListeners();
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'midi-settings-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 60px;
      right: 340px;
      width: 320px;
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
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 600;">MIDI Controllers</h3>
        <button id="midi-close-btn" style="
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

      <!-- MIDI Status -->
      <div style="margin-bottom: 16px; padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 500;">MIDI Status:</span>
          <span id="midi-status" style="font-family: monospace; color: #888;">Initializing...</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="midi-enable-btn" style="
            flex: 1;
            padding: 8px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
          ">Enable MIDI</button>
          <button id="midi-disable-btn" style="
            flex: 1;
            padding: 8px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
          " disabled>Disable MIDI</button>
        </div>
      </div>

      <!-- Connected Devices -->
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">Connected Devices</h4>
        <div id="midi-devices-list" style="
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          min-height: 60px;
          max-height: 150px;
          overflow-y: auto;
        ">
          <div style="color: #888; font-size: 12px; font-style: italic;">No devices connected</div>
        </div>
      </div>

      <!-- MIDI Learn -->
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">MIDI Learn</h4>
        <div style="padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
          <p style="margin: 0 0 8px 0; font-size: 11px; color: #888;">
            1. Select a parameter in the Parameter Panel<br>
            2. Click "Start MIDI Learn" below<br>
            3. Move any controller to assign it
          </p>
          <button id="midi-learn-btn" style="
            width: 100%;
            padding: 10px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          ">Start MIDI Learn</button>
          <div id="midi-learn-status" style="
            margin-top: 8px;
            padding: 8px;
            background: rgba(33, 150, 243, 0.2);
            border: 1px solid #2196F3;
            border-radius: 4px;
            font-size: 11px;
            color: #2196F3;
            display: none;
          ">
            Waiting for MIDI input...
          </div>
        </div>
      </div>

      <!-- Active Bindings -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="margin: 0; font-size: 13px; font-weight: 600; color: #aaa;">Active Bindings</h4>
          <button id="midi-clear-all-btn" style="
            padding: 4px 8px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
          ">Clear All</button>
        </div>
        <div id="midi-bindings-list" style="
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          min-height: 80px;
          max-height: 200px;
          overflow-y: auto;
        ">
          <div style="color: #888; font-size: 12px; font-style: italic;">No bindings configured</div>
        </div>
      </div>

      <!-- MIDI Activity Monitor -->
      <div style="margin-bottom: 8px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">MIDI Activity</h4>
        <div id="midi-activity" style="
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          min-height: 40px;
          font-family: monospace;
          font-size: 11px;
          color: #888;
        ">
          No recent activity
        </div>
      </div>

      <!-- Info -->
      <div style="font-size: 11px; color: #666; border-top: 1px solid #444; padding-top: 12px;">
        <p style="margin: 0;">
          MIDI CC values (0-127) are automatically mapped to parameter ranges.
        </p>
      </div>
    `;

    document.body.appendChild(this.panel);

    // Store references
    this.learnButton = this.panel.querySelector('#midi-learn-btn');
    this.devicesList = this.panel.querySelector('#midi-devices-list');
    this.bindingsList = this.panel.querySelector('#midi-bindings-list');

    // Make panel draggable by its header
    const header = this.panel.querySelector('div[style*="display: flex"]');
    if (header) {
      this.cleanupDraggable = makeDraggable(this.panel, header);
    }
  }

  setupEventListeners() {
    // Close button
    const closeBtn = this.panel.querySelector('#midi-close-btn');
    closeBtn.addEventListener('click', () => this.hide());

    // Enable/Disable buttons
    const enableBtn = this.panel.querySelector('#midi-enable-btn');
    const disableBtn = this.panel.querySelector('#midi-disable-btn');

    enableBtn.addEventListener('click', async () => {
      try {
        await this.midiManager.initialize();
        this.updateStatus();
        enableBtn.disabled = true;
        disableBtn.disabled = false;
      } catch (error) {

        await modalManager.alert('Failed to enable MIDI: ' + error.message, 'MIDI Error');
      }
    });

    disableBtn.addEventListener('click', () => {
      this.midiManager.disable();
      this.updateStatus();
      enableBtn.disabled = false;
      disableBtn.disabled = true;
    });

    // MIDI Learn button - using a single event listener that checks state
    this.learnButton.addEventListener('click', () => {
      if (this.midiBinding.learningMode) {
        this.midiBinding.cancelLearning();
      } else {
        this.startMIDILearn();
      }
    });

    // Clear all bindings
    const clearAllBtn = this.panel.querySelector('#midi-clear-all-btn');
    clearAllBtn.addEventListener('click', async () => {
      const confirmed = await modalManager.confirm(
        'Remove all MIDI bindings?',
        'Clear All Bindings',
        { danger: true, confirmLabel: 'Clear All' }
      );
      if (confirmed) {
        this.clearAllBindings();
      }
    });

    // Listen for MIDI events
    if (this.midiManager.eventSystem) {
      this.midiManager.eventSystem.on('MIDI_INITIALIZED', () => {
        this.updateStatus();
        this.updateDevicesList();
      });

      this.midiManager.eventSystem.on('MIDI_DEVICES_CHANGED', () => {
        this.updateDevicesList();
      });

      this.midiManager.eventSystem.on('MIDI_CC', (data) => {
        this.updateActivity(data);
      });

      this.midiManager.eventSystem.on('MIDI_BINDING_CREATED', () => {
        this.updateBindingsList();
      });

      this.midiManager.eventSystem.on('MIDI_BINDING_REMOVED', () => {
        this.updateBindingsList();
      });

      this.midiManager.eventSystem.on('MIDI_LEARN_STARTED', () => {
        this.showLearnMode();
      });

      this.midiManager.eventSystem.on('MIDI_LEARN_COMPLETED', (_data) => {
        this.hideLearnMode();
        this.updateBindingsList();
      });

      this.midiManager.eventSystem.on('MIDI_LEARN_CANCELLED', () => {
        this.hideLearnMode();
      });
    }

    // REMOVED: Wasteful setInterval that updated bindings list every 100ms
    // Bindings list now only updates when bindings actually change via events:
    // MIDI_BINDING_CREATED, MIDI_BINDING_REMOVED, MIDI_LEARN_COMPLETED
  }

  async startMIDILearn() {
    // Get selected parameter from parameter panel
    const paramPanel = window.editor?.paramPanel;

    if (!paramPanel || !paramPanel.isVisible() || !paramPanel.selectedNode) {
      await modalManager.alert('Please select a node first by clicking on it, then open the Parameter Panel.', 'MIDI Learn');
      return;
    }

    // Get selected parameter (either currently focused or last focused)
    const selectedParam = paramPanel.getSelectedParameter();

    if (!selectedParam || !selectedParam.name) {
      await modalManager.alert(
        'Please click on a parameter input field first.\n\nSteps:\n1. Click on a node to select it\n2. Click on any parameter field in the Parameter Panel\n3. Click "Start MIDI Learn" here\n4. Move a MIDI controller',
        'MIDI Learn'
      );
      return;
    }

    const paramName = selectedParam.name;
    const node = paramPanel.selectedNode;

    // Start learning
    this.midiBinding.startLearning(node.id, paramName, (_result) => {

    });
  }

  showLearnMode() {
    const learnStatus = this.panel.querySelector('#midi-learn-status');
    const paramPanel = window.editor?.paramPanel;
    const selectedParam = paramPanel?.getSelectedParameter();
    const node = paramPanel?.selectedNode;

    // Show which parameter is being learned
    if (selectedParam && node) {
      // node.kind comes out of the patch file, so build the markup instead of
      // interpolating it into innerHTML.
      learnStatus.replaceChildren(
        document.createTextNode('Waiting for MIDI input...'),
        document.createElement('br'),
        Object.assign(document.createElement('strong'), {
          textContent: `${node.kind}.${selectedParam.name}`,
        }),
      );
    } else {
      learnStatus.textContent = 'Waiting for MIDI input...';
    }

    learnStatus.style.display = 'block';
    this.learnButton.textContent = 'Cancel';
    this.learnButton.style.background = '#f44336';
  }

  hideLearnMode() {
    const learnStatus = this.panel.querySelector('#midi-learn-status');
    learnStatus.style.display = 'none';
    this.learnButton.textContent = 'Start MIDI Learn';
    this.learnButton.style.background = '#2196F3';
  }

  updateStatus() {
    const status = this.midiManager.getStatus();
    const statusEl = this.panel.querySelector('#midi-status');

    if (!status.supported) {
      statusEl.textContent = 'Not Supported';
      statusEl.style.color = '#f44336';
    } else if (status.enabled) {
      statusEl.textContent = 'Connected';
      statusEl.style.color = '#4CAF50';
    } else {
      statusEl.textContent = 'Disabled';
      statusEl.style.color = '#FF9800';
    }
  }

  updateDevicesList() {
    const devices = this.midiManager.getInputDevices();

    if (devices.length === 0) {
      this.devicesList.innerHTML = '<div style="color: #888; font-size: 12px; font-style: italic;">No devices connected</div>';
      return;
    }

    this.devicesList.innerHTML = devices.map(device => `
      <div style="
        padding: 8px;
        margin-bottom: 4px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        border-left: 3px solid ${device.state === 'connected' ? '#4CAF50' : '#f44336'};
      ">
        <div style="font-weight: 500; font-size: 12px;">${device.name}</div>
        <div style="font-size: 10px; color: #888;">${device.manufacturer || 'Unknown'}</div>
      </div>
    `).join('');
  }

  updateBindingsList() {
    const bindings = this.midiBinding.getAllBindings();

    if (bindings.length === 0) {
      this.bindingsList.innerHTML = '<div style="color: #888; font-size: 12px; font-style: italic;">No bindings configured</div>';
      return;
    }

    this.bindingsList.innerHTML = bindings.map((binding, _index) => {
      const node = window.editor?.graph?.nodes.find(n => n.id === binding.nodeId);
      const nodeName = node ? node.kind : 'Unknown';

      return `
        <div style="
          padding: 8px;
          margin-bottom: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          border-left: 3px solid ${binding.enabled ? '#2196F3' : '#666'};
        ">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
            <div style="flex: 1;">
              <div style="font-weight: 500; font-size: 11px; color: #2196F3;">
                CC${binding.cc} (Ch${binding.channel + 1})
              </div>
              <div style="font-size: 11px; color: #fff; margin-top: 2px;">
                ${nodeName}.${binding.paramName}
              </div>
              <div style="font-size: 10px; color: #888; margin-top: 2px;">
                Range: ${binding.min.toFixed(2)} - ${binding.max.toFixed(2)}
              </div>
            </div>
            <button
              onclick="window.editor.midiSettingsPanel.removeBinding('${binding.deviceId}', ${binding.channel}, ${binding.cc})"
              style="
                padding: 4px 8px;
                background: #f44336;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 10px;
              ">Remove</button>
          </div>
        </div>
      `;
    }).join('');
  }

  updateActivity(data) {
    // Store the latest data
    this.pendingActivityData = data;

    // Throttle updates to avoid excessive DOM reflows
    const now = performance.now();
    if (now - this.lastActivityUpdate < this.activityUpdateThrottle) {
      // Schedule update if not already scheduled
      if (!this.activityRAF) {
        this.activityRAF = requestAnimationFrame(() => {
          this._performActivityUpdate();
        });
      }
      return;
    }

    // Update immediately if enough time has passed
    this._performActivityUpdate();
  }

  _performActivityUpdate() {
    if (!this.pendingActivityData) return;

    const data = this.pendingActivityData;
    const activityEl = this.panel.querySelector('#midi-activity');
    const timestamp = new Date().toLocaleTimeString();

    activityEl.innerHTML = `
      <div>${timestamp}</div>
      <div>Device: ${data.deviceName}</div>
      <div>CC${data.cc} (Ch${data.channel + 1}): ${data.value} (${(data.normalizedValue * 100).toFixed(1)}%)</div>
    `;

    // Fade effect
    activityEl.style.opacity = '1';
    setTimeout(() => {
      activityEl.style.opacity = '0.5';
    }, 300);

    this.lastActivityUpdate = performance.now();
    this.activityRAF = null;
    this.pendingActivityData = null;
  }

  removeBinding(deviceId, channel, cc) {
    this.midiBinding.removeBinding(deviceId, channel, cc);
    this.updateBindingsList();
  }

  clearAllBindings() {
    const bindings = this.midiBinding.getAllBindings();
    bindings.forEach(binding => {
      this.midiBinding.removeBinding(binding.deviceId, binding.channel, binding.cc);
    });
    this.updateBindingsList();
  }

  show() {
    if (this.panel) {
      this.panel.style.display = 'block';
      this.visible = true;
      this.updateStatus();
      this.updateDevicesList();
      this.updateBindingsList();
    }
  }

  hide() {
    if (this.panel) {
      this.panel.style.display = 'none';
      this.visible = false;
    }
  }

  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible() {
    return this.visible;
  }
}

// Create singleton instance
let instance = null;

export function getMIDISettingsPanel(midiManager, midiBinding) {
  if (!instance && midiManager && midiBinding) {
    instance = new MIDISettingsPanel(midiManager, midiBinding);
  }
  return instance;
}

export default MIDISettingsPanel;
