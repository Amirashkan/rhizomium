// src/midi/MIDIManager.js

/**
 * MIDIManager - Handles Web MIDI API interactions
 * Detects MIDI controllers, receives messages, and emits events
 */
export class MIDIManager {
  constructor(eventSystem) {
    this.eventSystem = eventSystem;
    this.midiAccess = null;
    this.inputs = new Map(); // Map<inputId, MIDIInput>
    this.outputs = new Map(); // Map<outputId, MIDIOutput>
    this.isSupported = false;
    this.isEnabled = false;

    // Store latest CC values for each controller/channel/cc combination
    // Format: Map<"deviceId:channel:cc", value>
    this.ccValues = new Map();

    // Store device info
    this.devices = new Map(); // Map<deviceId, {name, manufacturer, state}>

    this.checkSupport();
  }

  /**
   * Check if Web MIDI API is supported
   */
  checkSupport() {
    this.isSupported = typeof navigator !== 'undefined' &&
                       typeof navigator.requestMIDIAccess === 'function';

    if (!this.isSupported) {
      console.warn('Web MIDI API is not supported in this browser');
    }

    return this.isSupported;
  }

  /**
   * Request MIDI access and initialize
   */
  async initialize() {
    if (!this.isSupported) {
      throw new Error('Web MIDI API is not supported');
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.isEnabled = true;

      console.log('MIDI Access granted');

      // Set up device change listeners
      this.midiAccess.addEventListener('statechange', (e) => {
        this.handleStateChange(e);
      });

      // Scan for existing devices
      this.scanDevices();

      this.eventSystem.emit('MIDI_INITIALIZED', {
        inputCount: this.inputs.size,
        outputCount: this.outputs.size
      });

      return true;
    } catch (error) {
      console.error('Failed to get MIDI access:', error);
      this.isEnabled = false;
      throw error;
    }
  }

  /**
   * Scan for connected MIDI devices
   */
  scanDevices() {
    if (!this.midiAccess) return;

    // Clear existing devices
    this.inputs.clear();
    this.outputs.clear();
    this.devices.clear();

    // Scan inputs
    for (const input of this.midiAccess.inputs.values()) {
      this.addInput(input);
    }

    // Scan outputs
    for (const output of this.midiAccess.outputs.values()) {
      this.addOutput(output);
    }

    console.log(`Found ${this.inputs.size} MIDI inputs and ${this.outputs.size} MIDI outputs`);

    this.eventSystem.emit('MIDI_DEVICES_CHANGED', {
      inputs: Array.from(this.inputs.values()).map(input => this.getDeviceInfo(input)),
      outputs: Array.from(this.outputs.values()).map(output => this.getDeviceInfo(output))
    });
  }

  /**
   * Add a MIDI input device
   */
  addInput(input) {
    this.inputs.set(input.id, input);

    // Store device info
    this.devices.set(input.id, {
      name: input.name,
      manufacturer: input.manufacturer,
      state: input.state,
      type: 'input'
    });

    // Set up message listener
    input.onmidimessage = (message) => this.handleMIDIMessage(message, input);

    console.log(`Added MIDI input: ${input.name} (${input.manufacturer})`);
  }

  /**
   * Add a MIDI output device
   */
  addOutput(output) {
    this.outputs.set(output.id, output);

    // Store device info
    this.devices.set(output.id, {
      name: output.name,
      manufacturer: output.manufacturer,
      state: output.state,
      type: 'output'
    });

    console.log(`Added MIDI output: ${output.name} (${output.manufacturer})`);
  }

  /**
   * Remove a MIDI device
   */
  removeDevice(deviceId) {
    const device = this.devices.get(deviceId);

    if (device) {
      this.inputs.delete(deviceId);
      this.outputs.delete(deviceId);
      this.devices.delete(deviceId);

      console.log(`Removed MIDI device: ${device.name}`);
    }
  }

  /**
   * Handle MIDI device state changes (connect/disconnect)
   */
  handleStateChange(event) {
    const port = event.port;

    console.log(`MIDI device ${port.state}: ${port.name}`);

    if (port.state === 'connected') {
      if (port.type === 'input') {
        this.addInput(port);
      } else if (port.type === 'output') {
        this.addOutput(port);
      }
    } else if (port.state === 'disconnected') {
      this.removeDevice(port.id);
    }

    this.eventSystem.emit('MIDI_DEVICES_CHANGED', {
      inputs: Array.from(this.inputs.values()).map(input => this.getDeviceInfo(input)),
      outputs: Array.from(this.outputs.values()).map(output => this.getDeviceInfo(output))
    });
  }

  /**
   * Handle incoming MIDI messages
   */
  handleMIDIMessage(message, input) {
    const data = message.data;
    const command = data[0] >> 4;
    const channel = data[0] & 0x0F;
    const note = data[1];
    const velocity = data[2];

    // Parse message type
    let messageType = 'unknown';
    let parsedData = {};

    switch (command) {
      case 0x9: // Note On
        messageType = 'noteon';
        parsedData = { channel, note, velocity };
        break;

      case 0x8: // Note Off
        messageType = 'noteoff';
        parsedData = { channel, note, velocity };
        break;

      case 0xB: // Control Change (CC)
        messageType = 'cc';
        const cc = note;
        const value = velocity;
        parsedData = { channel, cc, value };

        // Store CC value
        const ccKey = `${input.id}:${channel}:${cc}`;
        this.ccValues.set(ccKey, value);

        // Emit CC event
        this.eventSystem.emit('MIDI_CC', {
          deviceId: input.id,
          deviceName: input.name,
          channel,
          cc,
          value,
          normalizedValue: value / 127 // Normalize to 0-1
        });
        break;

      case 0xE: // Pitch Bend
        messageType = 'pitchbend';
        const pitchBend = (velocity << 7) | note;
        parsedData = { channel, value: pitchBend };
        break;

      case 0xD: // Channel Pressure (Aftertouch)
        messageType = 'pressure';
        parsedData = { channel, pressure: note };
        break;
    }

    // Emit generic MIDI message event
    this.eventSystem.emit('MIDI_MESSAGE', {
      deviceId: input.id,
      deviceName: input.name,
      type: messageType,
      data: parsedData,
      raw: Array.from(data),
      timestamp: message.timeStamp
    });
  }

  /**
   * Get CC value for a specific device/channel/cc
   */
  getCCValue(deviceId, channel, cc) {
    const key = `${deviceId}:${channel}:${cc}`;
    return this.ccValues.get(key) || 0;
  }

  /**
   * Get normalized CC value (0-1)
   */
  getNormalizedCCValue(deviceId, channel, cc) {
    return this.getCCValue(deviceId, channel, cc) / 127;
  }

  /**
   * Get device information
   */
  getDeviceInfo(device) {
    return {
      id: device.id,
      name: device.name,
      manufacturer: device.manufacturer,
      state: device.state,
      type: device.type
    };
  }

  /**
   * Get all connected input devices
   */
  getInputDevices() {
    return Array.from(this.inputs.values()).map(input => this.getDeviceInfo(input));
  }

  /**
   * Get all connected output devices
   */
  getOutputDevices() {
    return Array.from(this.outputs.values()).map(output => this.getDeviceInfo(output));
  }

  /**
   * Send a MIDI message to an output device
   */
  sendMessage(deviceId, data) {
    const output = this.outputs.get(deviceId);

    if (output) {
      output.send(data);
      return true;
    }

    console.warn(`Output device ${deviceId} not found`);
    return false;
  }

  /**
   * Disable MIDI and cleanup
   */
  disable() {
    if (this.midiAccess) {
      // Remove all message listeners
      for (const input of this.inputs.values()) {
        input.onmidimessage = null;
      }

      this.inputs.clear();
      this.outputs.clear();
      this.devices.clear();
      this.ccValues.clear();
      this.midiAccess = null;
      this.isEnabled = false;

      console.log('MIDI disabled');
    }
  }

  /**
   * Get MIDI status
   */
  getStatus() {
    return {
      supported: this.isSupported,
      enabled: this.isEnabled,
      inputCount: this.inputs.size,
      outputCount: this.outputs.size,
      devices: Array.from(this.devices.values())
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    this.disable();
  }
}
