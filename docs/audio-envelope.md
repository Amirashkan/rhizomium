# Audio Envelope User Guide

## Overview

The Audio Envelope feature allows you to control shader parameters in real-time based on audio input (microphone or desktop audio). This creates dynamic, audio-reactive visuals that respond to music, voice, or any other sound.

## Quick Start

### 1. Start the Audio Server

First, you need to start the audio server that captures audio and processes the envelope:

```bash
# Navigate to the audio directory
cd audio

# Install dependencies (first time only)
pip install -r requirements.txt

# Start the server with microphone input
python -m audio.audio_server --mode mic

# OR use desktop audio (loopback)
python -m audio.audio_server --mode loopback
```

You should see output like:
```
Audio engine started (mode: mic, rate: 48000Hz)
Audio envelope server running on http://localhost:8765
WebSocket endpoint: ws://localhost:8765/ws
HTTP endpoint: http://localhost:8765/envelope
Update rate: 60 Hz
```

### 2. Open the GLSL Node Editor

Open your browser and navigate to the GLSL Node Editor (usually `http://localhost:8080/editor` or wherever your editor is hosted).

### 3. Open Audio Settings

Click the **Audio Settings** button in the top menu. You should see:
- Status: Connected (green) or Disconnected (red)
- Current envelope value (0.000 - 1.000)
- A visual bar showing the current value

### 4. Use Audio in Parameters

Now you can use `audioEnvelope` in any parameter expression! Simply prefix your expression with `=`:

**Example 1: Basic usage**
```
=audioEnvelope
```
This will directly use the audio envelope value (0.0 to 1.0).

**Example 2: Scale the value**
```
=audioEnvelope * 5.0
```
Multiply the envelope by 5 to get values from 0 to 5.

**Example 3: Add offset**
```
=audioEnvelope + 0.5
```
Add a base value of 0.5, so values range from 0.5 to 1.5.

**Example 4: Use with lerp**
```
=lerp(1.0, 10.0, audioEnvelope)
```
Interpolate between 1.0 and 10.0 based on audio.

**Example 5: Combine with time**
```
=sin(time) * audioEnvelope
```
Create pulsing effects that are modulated by audio.

## Audio Settings Panel

![The Audio panel: File / Mic / System source, Attack, Release and Gain settings, and live meters for the signal and drum channels](images/panel-audio-envelope.webp)

Load an MP3, WAV or OGG file, then use Play / Pause / Stop to drive the envelope. The meter shows the current `audioEnvelope` value, which is what parameter expressions read.

The Audio Settings panel allows you to fine-tune how audio is processed:

### Follower

The follower tracks the audio signal's amplitude:

- **Attack (0-200ms)**: How quickly the envelope rises when sound is detected
  - Lower = snappier response
  - Higher = smoother rise

- **Release (0-500ms)**: How quickly the envelope falls when sound stops
  - Lower = quick decay
  - Higher = sustained hold

- **Threshold (0.0-1.0)**: Minimum level to trigger the envelope
  - Lower = more sensitive
  - Higher = only loud sounds trigger

### ADSR Envelope

The ADSR (Attack, Decay, Sustain, Release) shapes the envelope response:

- **Attack (0-2000ms)**: Time to reach peak after gate opens
- **Decay (0-2000ms)**: Time to fall from peak to sustain level
- **Sustain (0.0-1.0)**: Level held while audio is present
- **Release (0-3000ms)**: Time to fade out after audio stops

### Shaping

- **Curve**:
  - **Linear**: Direct 1:1 mapping
  - **Exponential**: Emphasizes louder sounds (default)
  - **Sigmoid**: S-curve for smoother transitions

- **Auto-normalize**: Automatically scales to 0-1 range

## Use Cases & Examples

### 1. Audio-Reactive Circle Radius

Create a circle that grows with audio:

1. Add a **CircleField** node
2. Set the radius parameter to: `=audioEnvelope * 5.0`
3. The circle will pulse with the audio

### 2. Color Intensity

Make colors brighter with audio:

1. Add a **Colorize** or any color node
2. Set intensity/brightness to: `=lerp(0.2, 1.0, audioEnvelope)`
3. Colors will brighten with louder audio

### 3. Rotation Speed

Spin faster with louder sounds:

1. Add a **Rotate** node
2. Set angle to: `=time * (1.0 + audioEnvelope * 10.0)`
3. Rotation speed increases with audio

### 4. Pattern Frequency

Create more detailed patterns with audio:

1. Add a **Noise** or pattern node
2. Set frequency to: `=2.0 + audioEnvelope * 8.0`
3. Pattern becomes more detailed with sound

### 5. Multiple Parameters

Combine audio with multiple parameters:

```
# Node A - Rotation
angle: =time * audioEnvelope

# Node B - Scale
scale: =1.0 + audioEnvelope * 0.5

# Node C - Color hue
hue: =audioEnvelope * 360
```

## Troubleshooting

### Server won't start
- **Error: "No module named sounddevice"**
  - Run: `pip install -r requirements.txt`

- **Error: "No audio input devices found"**
  - Check your system audio settings
  - Make sure a microphone is connected (for `mic` mode)
  - For `loopback` mode, check if your OS supports it

### Frontend won't connect
- **Status shows "Disconnected"**
  - Make sure the server is running (`python -m audio.audio_server`)
  - Check the browser console for errors
  - Verify the server is running on `localhost:8765`
  - Try refreshing the page

### No audio response
- **Value stays at 0.000**
  - Make some noise into your microphone
  - Try lowering the **Threshold** in Audio Settings
  - Check your system's microphone permissions
  - Verify the correct audio input is selected in system settings

### Jerky/stuttering visuals
- **Reduce update rate**:
  ```bash
  python -m audio.audio_server --rate 30
  ```
- **Increase Release time** in Audio Settings for smoother decay
- **Use Exponential or Sigmoid curve** instead of Linear

## Advanced Tips

### 1. Smooth Transitions

For smoother audio response, increase the Follower Release time:
- Release: 300-500ms for smooth transitions
- Release: 50-100ms for snappy, beat-reactive effects

### 2. Beat Detection

For beat-reactive effects:
- Set Threshold higher (0.3-0.5)
- Use low Attack (10-30ms)
- Use medium Release (100-200ms)

### 3. Ambient Response

For gentle ambient reactions:
- Set Threshold lower (0.05-0.15)
- Use medium Attack (100-200ms)
- Use long Release (400-800ms)
- Use Sigmoid curve for smooth response

### 4. Combining Multiple Effects

Layer audio effects by using different mappings:
```
# Node A - Fast response
param1: =audioEnvelope

# Node B - Slow response (manually smooth)
param2: =audioEnvelope * 0.3 + 0.7

# Node C - Inverted
param3: =1.0 - audioEnvelope
```

## Server Command-Line Options

```bash
python -m audio.audio_server [options]

Options:
  --host HOST         Server host (default: localhost)
  --port PORT         Server port (default: 8765)
  --mode MODE         Audio mode: mic or loopback (default: mic)
  --rate RATE         Update rate in Hz (default: 60)

Examples:
  # Use microphone with 30Hz update rate
  python -m audio.audio_server --mode mic --rate 30

  # Use desktop audio on all network interfaces
  python -m audio.audio_server --mode loopback --host 0.0.0.0

  # Use custom port
  python -m audio.audio_server --port 9000
```

## API Reference

### HTTP Endpoints

**Get current envelope value:**
```
GET http://localhost:8765/envelope

Response:
{
  "envelope": 0.75,
  "timestamp": 1234567890.123
}
```

**Get server status:**
```
GET http://localhost:8765/status

Response:
{
  "status": "running",
  "clients": 2,
  "mode": "mic",
  "samplerate": 48000
}
```

**Update configuration:**
```
POST http://localhost:8765/config
Content-Type: application/json

{
  "follower": {
    "attack_ms": 50.0,
    "release_ms": 200.0,
    "threshold": 0.1
  },
  "adsr": {
    "attack_ms": 120.0,
    "decay_ms": 180.0,
    "sustain": 0.7,
    "release_ms": 600.0
  },
  "shaping": {
    "curve": "exp",
    "normalize": true
  }
}
```

### WebSocket

**Connect to WebSocket:**
```javascript
const ws = new WebSocket('ws://localhost:8765/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Audio envelope:', data.value);
};
```

**Message format:**
```json
{
  "type": "envelope",
  "value": 0.75,
  "timestamp": 1234567890.123
}
```

## Performance Considerations

- **Update Rate**: 60Hz is good for most use cases. Use 30Hz if experiencing performance issues.
- **Multiple Clients**: The server can handle multiple browser tabs/clients simultaneously.
- **CPU Usage**: Audio processing is lightweight (<5% CPU on modern systems).
- **Latency**: Typical latency is 20-50ms from audio input to visual update.

## Security Notes

- The audio server runs locally on your machine
- By default, it only accepts connections from localhost
- To allow remote connections, use `--host 0.0.0.0` (not recommended for public networks)
- No audio data is stored or transmitted beyond your local machine

## Support

If you encounter issues:

1. Check the browser console for JavaScript errors
2. Check the server console for Python errors
3. Verify audio permissions in your OS settings
4. Try the `/status` endpoint to check server health
5. Restart both the server and the browser

## What's Next?

Try experimenting with:
- Different audio sources (music, voice, ambient sounds)
- Multiple parameters controlled by audio
- Combining audio with other expressions (time, math functions)
- Creating complex audio-reactive compositions
- Recording your audio-reactive creations

Enjoy creating audio-reactive visuals!
