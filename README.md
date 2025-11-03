# Rhizomium — GLSL Node Editor

A modular GPU node environment built for real-time generative visuals with WebGPU and IPC-based external viewer support.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Start the Server

**Linux/Mac:**
```bash
./START_SERVER.sh
```

**Windows:**
```batch
START_SERVER.bat
```

**Or manually:**
```bash
python rhizo_server.py
```

### 3. Open the Editor

Navigate to: **http://127.0.0.1:5000/studio**

## 📖 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 3 steps
- **[RHIZOMIUM_VIEWER_SETUP.md](RHIZOMIUM_VIEWER_SETUP.md)** - External viewer setup
- **[DEPLOYMENT_NOTES.md](DEPLOYMENT_NOTES.md)** - Cloud vs local deployment
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and solutions

## ✨ Features

- **WebGPU Core** - Real-time GPU-accelerated rendering
- **Node Editor** - Visual shader programming
- **External Viewer** - IPC-based frame streaming to secondary displays
- **Audio Reactivity** - Audio envelope integration
- **Save/Load** - Project management with backups

## 🎨 Using the External Viewer

**⚠️ Local-Only Feature:** The external viewer requires running the Python server locally. It will NOT work on cloud-hosted deployments (Vercel, Netlify, etc.). See [DEPLOYMENT_NOTES.md](DEPLOYMENT_NOTES.md).

**On local server:**
1. Click **"Open External Viewer"** in the editor toolbar
2. The viewer window opens automatically
3. Frames render in real-time via shared memory

## 🛠️ Development

### Project Structure

```
rhizomium/
├── rhizo_server.py          ← Integrated web server + API
├── rhizo_viewer.py          ← External viewer application
├── GPUCanvas.py             ← GPU renderer with IPC
├── ipc_protocol.py          ← IPC protocol definitions
├── ipc_shared.py            ← Shared memory channel
├── editor/                  ← Editor UI
│   └── index.html
├── main.js                  ← Main editor logic
└── src/                     ← Source modules
    ├── gpu/
    ├── core/
    └── ui/
```

### Running Components Separately

**Server:**
```bash
python rhizo_server.py
```

**GPU Renderer (testing):**
```bash
python GPUCanvas.py
```

**External Viewer (manual):**
```bash
python rhizo_viewer.py
```

## 🌐 Alternative Server Options

**Python built-in:**
```bash
python -m http.server 8000
```

**Node.js serve:**
```bash
npx serve .
```

**Note:** These require running `viewer_api.py` separately for external viewer support.

## 🔧 Requirements

- Python 3.8+
- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- See [requirements.txt](requirements.txt) for Python packages
