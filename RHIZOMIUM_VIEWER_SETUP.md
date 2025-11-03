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

### 4. Backend API
- **viewer_api.py** - Flask API server for launching viewer
  - Endpoint: `POST /api/launch-viewer`
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

### Option 1: Manual Launch

1. Start the GPUCanvas renderer:
```bash
python GPUCanvas.py
```

2. In another terminal, launch the external viewer:
```bash
python rhizo_viewer.py
```

### Option 2: Via Web UI

1. Start the API server:
```bash
python viewer_api.py
```

2. Open the Rhizomium editor (`editor/index.html`)

3. Click the **"Open External Viewer"** button in the HUD toolbar

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
       │                                  │ viewer_api.py│
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
- Check Python interpreter path in viewer_api.py

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
