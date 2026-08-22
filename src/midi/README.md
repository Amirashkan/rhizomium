# MIDI Controller Integration

The GLSL Node Editor now supports real-time parameter control via MIDI controllers using the Web MIDI API.

## Features

- **Automatic Device Detection**: Automatically detects and lists connected MIDI controllers
- **MIDI Learn Mode**: Easy mapping of MIDI CC (Control Change) messages to node parameters
- **Real-time Parameter Control**: Control any node parameter in real-time using MIDI controllers
- **Configurable Mappings**: Customize parameter ranges, curves, and inversion per binding
- **Persistent Bindings**: MIDI bindings are saved and loaded with your projects
- **Visual Feedback**: Real-time MIDI activity monitoring and binding visualization

## Components

### MIDIManager (`src/midi/MIDIManager.js`)
Handles Web MIDI API interactions:
- Requests MIDI access from the browser
- Detects connected MIDI input/output devices
- Receives and parses MIDI messages
- Emits events for MIDI activity

### MIDIParameterBinding (`src/midi/MIDIParameterBinding.js`)
Maps MIDI CC messages to node parameters:
- Creates bindings between MIDI CC and parameters
- Handles MIDI learn mode for easy mapping
- Applies value transformations (linear, exponential, logarithmic curves)
- Supports parameter range mapping
- Serializes/deserializes bindings for save/load
- Feeds a parameter that holds an expression instead of overwriting it — the mapped
  reading is recorded in `parameters/ExternalParameterControl.js` and the expression
  reads it as `midi` (`=midi + sin(time)`). See "Expressions on a mapped parameter"
  below.

### MIDISettingsPanel (`src/ui/MIDISettingsPanel.js`)
Provides user interface for MIDI configuration:
- Displays connected MIDI devices
- Shows active bindings
- MIDI learn button for easy mapping
- Real-time MIDI activity monitor
- Binding management (remove, clear all)

## Usage

### Opening MIDI Settings

1. Click the **"MIDI Settings"** button in the toolbar
2. Click **"Enable MIDI"** to request browser MIDI access
3. Your connected MIDI controllers will appear in the device list

### Mapping a MIDI Controller to a Parameter

**Using MIDI Learn:**

1. Open the Parameter Panel (click on a node)
2. Click on the parameter input field you want to control
3. Open MIDI Settings and click **"Start MIDI Learn"**
4. Move any MIDI controller (knob, slider, etc.)
5. The binding is created automatically

**Manual Binding:**

```javascript
// Access the MIDI binding system
const midiBinding = window.midiBinding;

// Create a binding
midiBinding.createBinding(
  deviceId,    // MIDI device ID
  channel,     // MIDI channel (0-15)
  cc,          // CC number (0-127)
  nodeId,      // Node ID
  paramName,   // Parameter name
  {
    min: 0,           // Minimum value
    max: 1,           // Maximum value
    curve: 'linear',  // 'linear', 'exponential', 'logarithmic'
    inverted: false   // Invert the value
  }
);
```

### Removing Bindings

- Click **"Remove"** on any binding in the MIDI Settings panel
- Click **"Clear All"** to remove all bindings

### MIDI Message Types Supported

Currently supports:
- **Control Change (CC)** messages (0xB0-0xBF)

Future support planned for:
- Note On/Off
- Pitch Bend
- Channel Pressure

## Browser Compatibility

The Web MIDI API is supported in:
- Chrome/Edge (Desktop)
- Opera (Desktop)

**Not supported in:**
- Firefox (requires flag `dom.webmidi.enabled`)
- Safari
- Most mobile browsers

## Architecture

### Event Flow

```
MIDI Controller → Web MIDI API → MIDIManager → Events
                                                   ↓
                                            MIDIParameterBinding
                                                   ↓
                                              Parameter Update
                                                   ↓
                                               Shader Rebuild
```

### Expressions on a mapped parameter

A mapped parameter used to be nothing but the controller's output: the reading was
written straight over `node.params`, so a parameter could be a formula or it could
be mapped, never both. The reading is now recorded next to the parameter as well:

```
CC → mapNormalizedValue → recordExternalReading(nodeId, param, 'midi')
                        → node.params[param]        (plain value only)
                        → u_params._<id>_<param>    (always, raw reading)
```

`applyControlValue` returns `false` and leaves the parameter alone when it holds an
expression. The expression reaches the reading through the `midi` identifier:

- **CPU** — `externalControlScope()` puts `midi`/`osc` into the evaluation context
  (`utils/paramReferences.js`), so panel readouts, node overlays and previews agree.
- **GPU** — `externalControlRefMapping()` compiles `midi` to the parameter's own
  uniform field, which is exactly where the reading is written. The controller
  therefore moves an expression parameter at 60fps with no shader recompile, the
  same as a plain one.

`midi` and `osc` are reserved identifiers, so a node parameter that happens to be
named `midi` can never shadow the controller.

### Events

**MIDI_INITIALIZED**: Fired when MIDI access is granted
```javascript
{ inputCount, outputCount }
```

**MIDI_DEVICES_CHANGED**: Fired when devices connect/disconnect
```javascript
{ inputs: [...], outputs: [...] }
```

**MIDI_CC**: Fired on Control Change message
```javascript
{
  deviceId,
  deviceName,
  channel,      // 0-15
  cc,           // 0-127
  value,        // 0-127
  normalizedValue  // 0-1
}
```

**MIDI_BINDING_CREATED**: Fired when a binding is created
```javascript
{ deviceId, channel, cc, nodeId, paramName, min, max, curve, inverted }
```

**MIDI_BINDING_REMOVED**: Fired when a binding is removed

**MIDI_LEARN_STARTED**: Fired when MIDI learn mode starts
**MIDI_LEARN_COMPLETED**: Fired when MIDI learn is successful
**MIDI_LEARN_CANCELLED**: Fired when MIDI learn is cancelled

## Examples

### Example 1: Control Rotation with a MIDI Knob

1. Create an Angular Gradient node
2. Click on the node to open the Parameter Panel
3. Click on the `rotation` parameter input
4. Open MIDI Settings → Start MIDI Learn
5. Turn a knob on your MIDI controller
6. The rotation will now be controlled in real-time by that knob!

### Example 2: Multiple Parameter Control

Map different MIDI knobs to different parameters:
- CC 1 → Angular Gradient rotation
- CC 2 → Radial Gradient radius
- CC 3 → Noise scale
- CC 4 → Blend strength

### Example 3: Programmatic Access

```javascript
// Get current MIDI status
const status = window.midiManager.getStatus();
console.log('MIDI Enabled:', status.enabled);
console.log('Devices:', status.devices);

// Get all bindings
const bindings = window.midiBinding.getAllBindings();
console.log('Active bindings:', bindings);

// Get CC value
const ccValue = window.midiManager.getCCValue(deviceId, channel, cc);
```

## Troubleshooting

**MIDI Settings button not working:**
- Make sure you're using a compatible browser (Chrome/Edge)
- Check browser console for errors

**No devices detected:**
- Ensure your MIDI controller is connected before opening the page
- Try refreshing the page after connecting the device
- Check that the device works in other MIDI applications

**Bindings not working:**
- Make sure MIDI is enabled in the MIDI Settings panel
- Check that the parameter supports dynamic values
- Verify the binding appears in the Active Bindings list

**MIDI Learn not responding:**
- Ensure you've clicked on a parameter input field first
- Make sure the MIDI device is sending CC messages (not notes)
- Check the MIDI Activity monitor to see if messages are being received

## Performance

- MIDI messages are processed at the rate they're received
- Parameter updates trigger shader rebuilds (same as manual editing)
- Multiple rapid CC changes are handled efficiently
- No significant performance impact on rendering

## Security & Privacy

- Web MIDI API requires explicit user permission
- MIDI access is granted per-session (doesn't persist)
- No MIDI data is sent to external servers
- All MIDI processing happens locally in the browser

## Future Enhancements

Planned features:
- [ ] Note On/Off support for trigger-based parameters
- [ ] Pitch Bend support
- [ ] MIDI output (feedback to controller LEDs)
- [ ] Velocity sensitivity
- [ ] MIDI mapping presets
- [ ] MPE (MIDI Polyphonic Expression) support
- [ ] MIDI clock sync for timeline
