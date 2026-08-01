# Rhizomium External Viewer Setup

This guide explains how to set up and use the Rhizomium external viewer with IPC (shared memory) frame streaming.

## Components

### 1. IPC Modules
- **ipc_protocol.py** - Protocol definitions for frame headers and commands
- **ipc_shared.py** - SharedFrameChannel class for shared memory communication

### 2. GPU Canvas
- **GPUCanvas.py** - ModernGL-based rendering with IPC integration
  - Renders frames using GPU
  - Sends frames via shared memory to external viewer

### 3. External Viewer
- **rhizo_viewer.py** - Standalone viewer application
  - Receives frames from GPUCanvas via shared memory
  - Displays frames in fullscreen window
  - Supports multi-monitor setup

### 4. Backend Server
- **rhizo_server.py** - Integrated Flask server (RECOMMENDED)
  - Serves static files (editor UI)
  - Provides API endpoints
  - Single server for everything
- ~~**viewer_api.py**~~ - removed (executed a request-supplied path; see below)
  - Use if you have your own web server
  - Endpoint: `POST /api/launch-viewer` *(removed)*
  - Auto-detects and launches Python or executable viewer

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

Required packages:
- numpy (IPC frame handling)
- moderngl (GPU rendering)
- moderngl-window (Viewer window)
- pygame (Window backend)
- flask + flask-cors (API server)

## Usage

### Option 1: Integrated Server (RECOMMENDED)

1. Start the integrated server:
```bash
python rhizo_server.py
# OR use the startup scripts:
# ./START_SERVER.sh (Linux/Mac)
# START_SERVER.bat (Windows)
```

2. Open your browser to:
```
http://127.0.0.1:5000/studio
```

3. Click the **"Open External Viewer"** button in the toolbar

The viewer will launch automatically!

### Option 2: Manual Launch (for testing)

1. Start the GPUCanvas renderer:
```bash
python GPUCanvas.py
```

2. In another terminal, launch the external viewer:
```bash
python rhizo_viewer.py
```

### Option 3: Standalone API Server

If you already have a web server:

1. Start the API server:
> **Removed.** `viewer_api.py` and the `POST /api/launch-viewer` endpoint no
> longer exist. The endpoint executed a filesystem path taken from the request
> body, and CORS was open to every origin, so any website open in the artist's
> browser could start a local process. Nothing in the editor called it. Launch
> `rhizo_viewer.py` directly instead.

2. Open the Rhizomium editor in your browser

3. Click the **"Open External Viewer"** button

The viewer will automatically connect to the shared memory channel and display frames.

## Controls

**External Viewer:**
- `ESC` or `Q` - Exit viewer
- Window can be moved to secondary monitor manually
- Supports fullscreen mode

## Architecture

```
┌──────────────┐     Shared Memory      ┌──────────────────┐
│  GPUCanvas   │ ◄─────────────────────► │ rhizo_viewer.py  │
│  (Renderer)  │   SharedFrameChannel    │  (Viewer Window) │
└──────────────┘                         └──────────────────┘
       ▲                                          ▲
       │                                          │
       │                                          │
   Renders                                   Launched by
    frames                                        │
       │                                          │
       │                                  ┌───────┴──────┐
       │                                  │  (removed)   │
       │                                  │ (Flask API)  │
       │                                  └──────────────┘
       │                                          ▲
       │                                          │
       └──────────────────────────────────────────┘
                   Web UI Button Click
```

## Monitor Setup

To display on a secondary monitor:

1. **Windowed Mode** (default):
   - Launch viewer
   - Drag window to secondary monitor
   - Press `F11` or maximize window

2. **Fullscreen Mode** (modify rhizo_viewer.py):
   - Set `fullscreen = True` in WindowConfig
   - Configure monitor index in window args

## Troubleshooting

**"Waiting for stream" message:**
- GPUCanvas is not running
- Shared memory channel not created yet
- Try starting GPUCanvas first

**"Viewer not found" error:**
- Ensure rhizo_viewer.py exists in project root
- Launch `rhizo_viewer.py` directly (`viewer_api.py` was removed)

**Black screen in viewer:**
- Frame size mismatch
- Check GPUCanvas output resolution matches viewer texture size

**Performance issues:**
- Reduce resolution in GPUCanvas
- Enable vsync in viewer (default: enabled)
- Check GPU utilization

## Development

To modify the viewer:

1. Edit `rhizo_viewer.py` for viewer changes
2. Edit `GPUCanvas.py` for renderer changes
3. Edit `ipc_protocol.py` for protocol changes

Restart both components after changes.

## Notes

- Shared memory name: `rhizo_frame` (default)
- Frame format: RGB, 3 components, uint8
- Connection auto-retry: 2 seconds
- Default resolution: 1920x1080 (configurable)
