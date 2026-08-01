# Dual-Screen System Guide

Complete guide to using the WebSocket-based Dual-Screen system in Rhizomium GLSL Node Editor.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Usage Modes](#usage-modes)
5. [Setup Instructions](#setup-instructions)
6. [Troubleshooting](#troubleshooting)
7. [Technical Details](#technical-details)
8. [API Reference](#api-reference)

---

## Overview

The Dual-Screen system allows you to display your GLSL shader output on a second monitor or remote display via WebSocket streaming. This is perfect for:

- **Live performances** - Full-screen visuals on a projector while you edit on your laptop
- **VJ setups** - Dedicated output monitor for audience while keeping editor controls private
- **Remote viewing** - Stream visuals over network to another computer
- **Multi-monitor workflows** - Separate editing and viewing spaces

### Key Features

- **Real-time streaming** - Low-latency frame transmission (30+ FPS)
- **WebSocket-based** - Works over network, not just locally
- **Multiple viewers** - Support for many simultaneous connections
- **Two viewer types** - Native Python viewer or browser-based viewer
- **Auto-reconnect** - Viewers automatically reconnect if connection drops
- **Resolution-independent** - Automatically adapts to frame size changes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Editor (Browser)                            │
│  - WebGPU Renderer (gpu-canvas)                                 │
│  - FrameStreamClient.js                                         │
│  - Captures frames from canvas → sends to server                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTP POST
                              ↓ /api/stream-frame
┌─────────────────────────────────────────────────────────────────┐
│              Flask Server (rhizo_server.py)                     │
│  - Receives frames via HTTP                                     │
│  - Converts to binary format                                    │
│  - Broadcasts via WebSocket                                     │
│    Port 5000: HTTP/API                                          │
│    Port 8766: WebSocket (frame_stream_server.py)                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ WebSocket
                              ↓ ws://localhost:8766/ws
        ┌─────────────────────┴─────────────────────┐
        ↓                                           ↓
┌──────────────────────┐                  ┌──────────────────────┐
│  Python Viewer       │                  │  Browser Viewer      │
│  (rhizo_viewer.py)   │                  │  (viewer.html)       │
│  - Native OpenGL     │                  │  - HTML5 Canvas      │
│  - ModernGL Window   │                  │  - Works anywhere    │
│  - Local or Remote   │                  │  - Remote friendly   │
└──────────────────────┘                  └──────────────────────┘
```

---

## Quick Start

### Local Setup (Easiest)

1. **Start the server:**
   ```bash
   python rhizo_server.py
   ```

2. **Open the editor:**
   - Go to: `http://localhost:5000/studio`

3. **Launch viewer:**
   - Click the **"Open External Viewer"** button in the editor

4. **Move viewer to second monitor:**
   - Drag the viewer window to your second display
   - Press **F11** for fullscreen (if supported by viewer)

That's it! The editor will automatically stream frames to the viewer.

---

## Usage Modes

### Mode 1: Native Python Viewer (Recommended for Local)

**Best for:**
- Local dual-monitor setups
- Low latency requirements
- Dedicated viewer displays

**Launch:**
```bash
# Default WebSocket mode
python rhizo_viewer.py --ws

# Specify custom server
python rhizo_viewer.py --ws --url ws://192.168.1.100:8766/ws

# Fullscreen mode
python rhizo_viewer.py --ws --fullscreen
```

**Features:**
- OpenGL-accelerated rendering
- Very low latency
- Keyboard controls (ESC/Q to exit)
- Auto-reconnection

---

### Mode 2: Browser Viewer (Best for Remote)

**Best for:**
- Remote viewing over network
- Multiple simultaneous viewers
- Devices without Python

**Launch:**
1. Open in any browser: `http://localhost:5000/viewer.html`
2. Enter WebSocket URL: `ws://localhost:8766/ws`
3. Click **"Connect"**

**Features:**
- Works on any device with a browser
- Mobile-friendly
- Connection stats display
- Fullscreen button
- No installation required

**Remote Access:**
If your server is at `192.168.1.100`:
- Viewer URL: `http://192.168.1.100:5000/viewer.html`
- WebSocket URL: `ws://192.168.1.100:8766/ws`

---

## Setup Instructions

### Prerequisites

```bash
# Install Python dependencies
pip install -r requirements.txt

# Required packages:
# - flask
# - flask-cors
# - aiohttp
# - moderngl
# - moderngl-window
# - pygame
# - numpy
# - websockets
```

### Starting the System

#### Option A: Integrated Server (Recommended)

Starts both Flask and WebSocket servers together:

```bash
python rhizo_server.py
```

You'll see:
```
🌿 Rhizomium Integrated Server with Frame Streaming
======================================================================
Available URLs:
  Landing Page:  http://127.0.0.1:5000/
  Editor:        http://127.0.0.1:5000/studio
  Remote Viewer: http://127.0.0.1:5000/viewer.html

WebSocket:
  Frame Stream:  ws://127.0.0.1:8766/ws
```

#### Option B: Standalone Frame Streaming Server

If you only need the streaming server:

```bash
python frame_stream_server.py
```

---

### Network Configuration

#### For Local Use Only:
No configuration needed! Default settings work out of the box.

#### For Remote Access:

1. **Find your IP address:**
   ```bash
   # Linux/Mac
   ifconfig | grep "inet "

   # Windows
   ipconfig
   ```

2. **Update server binding:**
   Edit `rhizo_server.py` if needed:
   ```python
   # Change from:
   app.run(host='127.0.0.1', port=5000)

   # To:
   app.run(host='0.0.0.0', port=5000)  # Allows external connections
   ```

3. **Firewall settings:**
   - Allow incoming connections on ports 5000 and 8766
   - On Windows: Windows Defender Firewall → Advanced Settings → Inbound Rules
   - On Linux: `sudo ufw allow 5000` and `sudo ufw allow 8766`

4. **Connect remotely:**
   - Editor: `http://YOUR_IP:5000/studio`
   - Viewer: `http://YOUR_IP:5000/viewer.html`
   - WebSocket: `ws://YOUR_IP:8766/ws`

---

## Troubleshooting

### Viewer Shows Black Screen

**Problem:** Viewer window is open but shows only black/dark screen

**Solutions:**
1. Check that frame streaming is active:
   - In editor console: Should see "Frame streaming started"
   - Button should say "Streaming Active" with green background

2. Verify WebSocket connection:
   - Python viewer: Should show "WebSocket connected!"
   - Browser viewer: Status should be green "Connected"

3. Check server logs:
   ```bash
   # Should see periodic messages like:
   [FrameStreamServer] Streamed 60 frames at 30.2 FPS to 1 viewers
   ```

4. Try refreshing the editor page (F5)

---

### "Connection Refused" Error

**Problem:** Viewer can't connect to WebSocket

**Solutions:**
1. Verify server is running:
   ```bash
   # Should see both servers started:
   Frame Stream Server started on ws://0.0.0.0:8766/ws
   Flask server running on http://127.0.0.1:5000/
   ```

2. Check ports aren't blocked:
   ```bash
   # Test WebSocket port
   curl http://localhost:8766/health
   ```

3. Verify URL format:
   - Correct: `ws://localhost:8766/ws`
   - Wrong: `http://localhost:8766/ws` (missing 'ws://')
   - Wrong: `ws://localhost:8766` (missing '/ws' path)

---

### Poor Frame Rate / Lag

**Problem:** Viewer shows choppy playback

**Solutions:**

1. **Reduce target FPS in editor:**
   ```javascript
   // In browser console:
   frameStreamClient.setTargetFPS(20);  // Lower = less bandwidth
   ```

2. **Check network bandwidth:**
   - 1920x1080 @ 30 FPS ≈ 150 MB/s uncompressed
   - Use lower resolution if over network

3. **Use native viewer instead of browser:**
   ```bash
   # Native viewer has better performance
   python rhizo_viewer.py --ws
   ```

4. **Reduce editor canvas size:**
   - Smaller canvas = less data to stream

---

### Multiple Viewers Not Working

**Problem:** Second viewer doesn't receive frames

**Check:**
1. Server supports multiple viewers - this should work!
2. Check server console for connected viewer count:
   ```
   [FrameStreamServer] Viewer connected: 12345 (total: 2)
   ```

3. Both viewers should receive same frames simultaneously

---

### "Failed to Launch External Viewer"

**Problem:** Button click doesn't start viewer

**Solutions:**

1. **Check rhizo_viewer.py exists:**
   ```bash
   ls rhizo_viewer.py  # Should exist in project root
   ```

2. **Check Python dependencies:**
   ```bash
   pip install moderngl moderngl-window pygame websockets
   ```

3. **Try manual launch:**
   ```bash
   python rhizo_viewer.py --ws
   ```

4. **Check server logs** for specific error messages

---

## Technical Details

### Frame Protocol

#### Metadata Message (JSON):
```json
{
  "type": "frame_meta",
  "width": 1920,
  "height": 1080,
  "format": "rgb",
  "timestamp": 1699564820123,
  "frame_number": 12345,
  "fps": 30.5,
  "size": 6220800
}
```

#### Frame Data (Binary):
- Raw pixel data following metadata
- RGB format: 3 bytes per pixel (R, G, B)
- RGBA format: 4 bytes per pixel (R, G, B, A)
- Row-major order (top to bottom)

### Performance Characteristics

| Resolution | Format | Size per Frame | 30 FPS Bandwidth |
|------------|--------|----------------|------------------|
| 1920x1080  | RGB    | ~6.2 MB        | ~186 MB/s       |
| 1280x720   | RGB    | ~2.7 MB        | ~81 MB/s        |
| 854x480    | RGB    | ~1.2 MB        | ~36 MB/s        |

**Recommendations:**
- **Local network:** 1920x1080 @ 30 FPS works well
- **WiFi:** Consider 1280x720 @ 20-30 FPS
- **Remote/Internet:** Use 854x480 @ 15-20 FPS

### Latency Breakdown

Typical end-to-end latency (local network):
- Frame capture: ~2-5 ms
- Encoding (base64): ~10-20 ms
- Network transmission: ~1-5 ms (LAN), ~20-100 ms (WiFi)
- Decoding: ~5-10 ms
- Display: ~16 ms (60Hz) / ~33 ms (30Hz)

**Total:** ~40-80 ms (local), ~70-150 ms (WiFi)

---

## API Reference

### FrameStreamClient (JavaScript)

```javascript
// Initialize
const client = new FrameStreamClient('http://localhost:5000');

// Start streaming
await client.startStreaming();

// Send frame from canvas
client.sendFrameFromCanvas(canvas, 'rgb', 0.85);

// Set target FPS
client.setTargetFPS(30);

// Stop streaming
client.stopStreaming();

// Get stats
const stats = client.getStats();
console.log(stats);
// {
//   connected: true,
//   streaming: true,
//   frameCount: 1234,
//   fps: "30.5",
//   targetFps: 30,
//   queueSize: 0
// }
```

### Frame Streaming Server (Python)

```python
from frame_stream_server import FrameStreamServer
import asyncio

# Create server
server = FrameStreamServer(host='0.0.0.0', port=8766)

# Start server
await server.start()

# Broadcast a frame
frame_data = b'...'  # RGB pixel data
await server.broadcast_frame(frame_data, 1920, 1080, 'rgb')

# Get stats
stats = server.frame_count  # Total frames sent
viewers = len(server.viewers)  # Connected viewers
fps = server.fps  # Current FPS

# Stop server
await server.stop()
```

### HTTP API Endpoints

#### POST /api/stream-frame
Send a frame to all connected viewers.

**Request:**
```json
{
  "width": 1920,
  "height": 1080,
  "format": "rgb",
  "data": "base64_encoded_frame_data"
}
```

**Response:**
```json
{
  "success": true
}
```

#### GET /api/status
Get server and streaming status.

**Response:**
```json
{
  "status": "running",
  "frame_streaming": {
    "enabled": true,
    "viewers": 2,
    "fps": 30.5,
    "url": "ws://localhost:8766/ws"
  }
}
```

#### POST /api/launch-viewer  *(removed)*
This endpoint took a filesystem path from the request body and executed it,
with CORS open to every origin. It has been removed; launch `rhizo_viewer.py`
directly instead.

**Response:**
```json
{
  "success": true,
  "message": "External viewer launched",
  "pid": 12345
}
```

---

## Advanced Usage

### Custom Viewer Implementation

Create your own viewer by connecting to the WebSocket:

```python
import asyncio
import websockets
import json

async def custom_viewer():
    uri = "ws://localhost:8766/ws"

    async with websockets.connect(uri, max_size=None) as ws:
        async for message in ws:
            if isinstance(message, str):
                # Metadata
                meta = json.loads(message)
                if meta['type'] == 'frame_meta':
                    width = meta['width']
                    height = meta['height']
                    # Prepare for frame data...

            elif isinstance(message, bytes):
                # Frame data - process it
                process_frame(message, width, height)

asyncio.run(custom_viewer())
```

### Integration with OBS/Streaming Software

1. Use the browser viewer (`viewer.html`)
2. Add as "Browser Source" in OBS
3. URL: `http://localhost:5000/viewer.html?autoconnect=true`
4. Set resolution to match your canvas

---

## Credits

Built with:
- **Flask** - Web server
- **aiohttp** - WebSocket server
- **ModernGL** - OpenGL rendering
- **WebGPU** - Browser GPU acceleration

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review server logs for error messages
3. Open an issue on GitHub with:
   - Operating system
   - Python version
   - Browser version
   - Error messages from console
   - Server logs

---

**Happy streaming!**
