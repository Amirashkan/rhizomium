# MIDI Controller Integration

Control your visuals in real-time using MIDI controllers! Connect knobs, sliders, and pads to any parameter in your node graph.

---

## Quick Start

### Step 1: Connect Your MIDI Controller

1. Connect your MIDI controller to your computer via USB
2. Make sure it's powered on and recognized by your system

### Step 2: Enable MIDI in Rhizomium

1. Click the **MIDI Settings** button in the toolbar
2. Click **Enable MIDI** to request browser access
3. Allow MIDI access when prompted by your browser
4. Your connected MIDI controllers will appear in the device list

### Step 3: Map a Parameter

**Using MIDI Learn (Easiest):**

1. Click on a node to open its parameters panel
2. Click on the parameter input field you want to control (e.g., "Radius", "Speed")
3. Click the **MIDI Learn** button (or press the MIDI learn shortcut)
4. Move a knob or slider on your MIDI controller
5. The parameter is now mapped! Move the controller to see it update in real-time

**Manual Mapping:**

1. Open MIDI Settings
2. Click **Add Binding**
3. Select the node and parameter from dropdowns
4. Select your MIDI controller and CC number
5. Configure range and curve settings
6. Click **Save**

---

## Understanding MIDI

### What is MIDI?

MIDI (Musical Instrument Digital Interface) is a protocol for sending control data. MIDI controllers send **CC (Control Change)** messages that can control any parameter.

### MIDI CC Numbers

Each knob/slider on your controller sends a CC number (0-127). Common assignments:
- **CC 1**: Modulation wheel
- **CC 7**: Volume
- **CC 10**: Pan
- **CC 11**: Expression

You can use any CC number - just move the control and Rhizomium will detect it.

---

## MIDI Settings Panel

### Device List

Shows all connected MIDI input devices:
- **Device Name** - Your controller's name
- **Status** - Connected/Disconnected
- **Activity Indicator** - Lights up when receiving MIDI data

### Active Bindings

Lists all current MIDI → Parameter mappings:
- **Node** - Which node is controlled
- **Parameter** - Which parameter
- **CC** - MIDI CC number
- **Range** - Min/Max values
- **Curve** - Response curve type

### MIDI Activity Monitor

Real-time display showing:
- **Last CC** - Most recent CC number received
- **Last Value** - Current CC value (0-127)
- **Visual Bar** - Live MIDI activity indicator

---

## Parameter Mapping Options

### Range Mapping

Control how MIDI values map to parameter values:

- **Min Value** - Parameter value when MIDI = 0
- **Max Value** - Parameter value when MIDI = 127
- **Example**: Map CC 1 (0-127) to Radius (0.0-1.0)

### Response Curves

Choose how MIDI input affects the parameter:

- **Linear** - Direct 1:1 mapping (default)
- **Exponential** - Faster response at higher values
- **Logarithmic** - Slower response at higher values
- **S-Curve** - Smooth acceleration/deceleration

### Invert

Flip the mapping direction:
- **Normal**: MIDI 0 → Min, MIDI 127 → Max
- **Inverted**: MIDI 0 → Max, MIDI 127 → Min

---

## Common Use Cases

### Live Performance

Map multiple parameters to different knobs:

```
CC 1 → Circle Radius
CC 2 → Rotation Speed
CC 3 → Color Hue
CC 4 → Noise Scale
```

Control everything in real-time during a performance!

### Audio-Visual Sync

Combine MIDI with audio:
- Use MIDI to control overall intensity
- Let audio control fine details
- Create layered control systems

### Parameter Automation

Record MIDI movements:
- Move knobs while timeline plays
- Create keyframe animations from MIDI
- Export as parameter curves

---

## Managing Bindings

### Edit a Binding

1. Open MIDI Settings
2. Find the binding in the list
3. Click **Edit**
4. Adjust range, curve, or CC number
5. Click **Save**

### Remove a Binding

1. Open MIDI Settings
2. Find the binding in the list
3. Click **Remove** (or trash icon)
4. Confirm removal

### Clear All Bindings

1. Open MIDI Settings
2. Click **Clear All**
3. Confirm to remove all MIDI mappings

---

## Saving MIDI Mappings

MIDI bindings are **automatically saved** with your project:

- When you save a project (Ctrl+S), MIDI mappings are included
- When you load a project, MIDI mappings are restored
- No need to re-map parameters each time!

---

## Troubleshooting

### MIDI Controller Not Detected

**Problem:** Controller doesn't appear in device list

**Solutions:**
- Check USB connection
- Restart browser
- Try a different USB port
- Check if controller works in other software
- Make sure controller is in MIDI mode (not DAW mode)

### MIDI Learn Not Working

**Problem:** Moving controller doesn't map parameter

**Solutions:**
- Make sure MIDI Learn is active (button highlighted)
- Check that MIDI device is enabled
- Verify MIDI activity monitor shows incoming data
- Try clicking the parameter field again
- Check browser console for errors (F12)

### Parameter Not Responding

**Problem:** MIDI mapped but parameter doesn't change

**Solutions:**
- Check binding is active (not disabled)
- Verify CC number matches controller output
- Check range values are correct
- Ensure parameter isn't locked or overridden
- Try removing and re-adding the binding

### Browser Doesn't Request MIDI Access

**Problem:** No MIDI permission prompt appears

**Solutions:**
- Check browser supports Web MIDI API (Chrome 43+, Edge 79+)
- Try clicking "Enable MIDI" again
- Check browser settings for MIDI permissions
- Try incognito/private mode
- Update browser to latest version

### MIDI Lag or Delay

**Problem:** Parameter updates feel delayed

**Solutions:**
- Close other MIDI applications
- Reduce MIDI throttle interval (if available)
- Check CPU usage isn't maxed out
- Try a different USB port (USB 3.0 preferred)
- Update MIDI controller drivers

---

## Tips & Tricks

### Multiple Controllers

You can connect **multiple MIDI controllers** at once:
- Each controller appears separately in device list
- Map different parameters to different controllers
- Great for complex setups!

### MIDI Through

Some controllers support MIDI through:
- Chain multiple controllers
- Use one controller to control another
- Create complex routing setups

### Preset Management

Save different MIDI mappings:
- Create project templates with MIDI mappings
- Save common mappings for reuse
- Share MIDI setups with others

### Performance Tips

- **Map frequently-used parameters** to easily accessible knobs
- **Use exponential curves** for fine control at low values
- **Group related parameters** on nearby knobs
- **Label your controller** with parameter names using tape/stickers

---

## Keyboard Shortcuts

- **MIDI Settings**: Click toolbar button (no default shortcut)
- **MIDI Learn**: Click parameter field + Learn button
- **Clear Binding**: Right-click binding in list → Remove

---

## Browser Compatibility

### Supported Browsers

- **Chrome 43+** (Recommended)
- **Edge 79+** (Recommended)
- **Firefox** (Web MIDI API not supported)
- **Safari** (Web MIDI API not supported)

### Platform Support

- **Windows 10+**
- **macOS 10.14+**
- **Linux** (with ALSA/MIDI support)
- **Chrome OS** (Limited controller support)

---

## See Also

- [Parameter Expressions](parameter-expressions.md) - Combine MIDI with expressions
- [Timeline Animation](timeline.md) - Record MIDI movements as keyframes
- [Audio Reactivity](audio-web.md) - Combine MIDI with audio input

