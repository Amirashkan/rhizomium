# Audio Envelope Server

Real-time audio envelope extraction for GLSL shader integration.

## Features

- Real-time audio input (microphone or loopback)
- Hybrid envelope follower (RMS + ADSR)
- WebSocket streaming for low-latency updates
- Configurable parameters via HTTP API
- Multiple output shaping curves (linear, exponential, sigmoid)

## Installation

```bash
# Install Python dependencies
pip install -r requirements.txt
```

## Usage

### Start the server

```bash
# Using microphone input
python -m audio.audio_server --mode mic

# Using system audio loopback (desktop audio)
python -m audio.audio_server --mode loopback

# Custom host and port
python -m audio.audio_server --host 0.0.0.0 --port 8765 --rate 60
```

### Command-line options

- `--host`: Server host (default: localhost)
- `--port`: Server port (default: 8765)
- `--mode`: Audio input mode - `mic` or `loopback` (default: mic)
- `--rate`: Update rate in Hz (default: 60)

## API Endpoints

### WebSocket

**Endpoint:** `ws://localhost:8765/ws`

Streams real-time envelope values:

```json
{
  "type": "envelope",
  "value": 0.75,
  "timestamp": 1234567890.123
}
```

### HTTP

**Get current envelope value:**
```bash
GET http://localhost:8765/envelope
```

Response:
```json
{
  "envelope": 0.75,
  "timestamp": 1234567890.123
}
```

**Get server status:**
```bash
GET http://localhost:8765/status
```

Response:
```json
{
  "status": "running",
  "clients": 2,
  "mode": "mic",
  "samplerate": 48000
}
```

**Update configuration:**
```bash
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

## Frontend Integration

The audio envelope is automatically available in GLSL shaders as a built-in variable:

```glsl
// Use 'audioEnvelope' in your shader expressions
color = vec3(audioEnvelope);

// Or in parameter expressions (prefix with =)
// =audioEnvelope * 2.0
```

## Architecture

1. **AudioEngine** (`audio_engine.py`): Captures audio via PortAudio/WASAPI
2. **AudioEnvelopeProcessor** (`audio_envelope_processor.py`): Processes RMS → Follower → Gate → ADSR
3. **AudioServer** (`audio_server.py`): Exposes envelope values via WebSocket/HTTP

## Parameters

### Follower
- `attack_ms`: Attack time in milliseconds (0-200)
- `release_ms`: Release time in milliseconds (0-500)
- `threshold`: Gate threshold (0-1)

### ADSR
- `attack_ms`: Attack time in milliseconds (0-2000)
- `decay_ms`: Decay time in milliseconds (0-2000)
- `sustain`: Sustain level (0-1)
- `release_ms`: Release time in milliseconds (0-3000)

### Shaping
- `curve`: Output curve - "linear", "exp", or "sigmoid"
- `normalize`: Auto-normalize to 0-1 range

## Troubleshooting

### No audio input detected
- Check your system's audio input permissions
- For loopback mode on Windows, ensure you have a loopback device available
- Try listing available devices with `python -m sounddevice`

### WebSocket connection fails
- Ensure the server is running
- Check firewall settings
- Verify the port is not in use

### High latency
- Reduce `--rate` value (e.g., 30 Hz instead of 60 Hz)
- Use lower block size in audio engine (requires code modification)
- Check CPU usage
