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

## 🖥️ Desktop App (Tauri)

The editor can run as a native desktop app via [Tauri](https://tauri.app). Unlike
the web build there is no server doing URL rewrites, so the app is wired to load
the editor's real entry (`editor/index.html`) directly.

### Prerequisites (one time)

- [Node.js](https://nodejs.org) 18+
- The [Tauri system prerequisites](https://tauri.app/start/prerequisites/) for
  your OS (Rust toolchain + WebView dependencies).

```bash
# install JS deps (Vite, Tauri CLI, etc.)
npm install

# generate the app icon set from the logo (writes src-tauri/icons/)
npm run tauri icon assets/logo.png
```

### Run in development

```bash
npm run tauri:dev
```

This starts the Vite dev server on `http://localhost:5173` and opens the Tauri
window pointing at it. Click **Launch Studio** to open the editor.

### Build a distributable

```bash
npm run tauri:build
```

Installers/binaries are written to `src-tauri/target/release/bundle/`.

> **Note:** Tauri uses the OS WebView (WebView2 on Windows, WebKitGTK on Linux,
> WKWebView on macOS). WebGPU — which this app requires — is best supported by
> WebView2, so Windows is the most reliable target today.

### Second-Monitor Viewer (Vite/desktop build only)

The Vite build (`npm run dev` and the Tauri desktop app) adds a **View → Second
Monitor Viewer** entry. It opens a chrome-free black window on a second display
and mirrors the live output there, letterboxed and centred — a pristine
performance surface with no editor UI. The output paints on its own animation
frame, so it keeps running at the second display's refresh rate even when the
editor window is occluded or minimised. Press **Esc** to close it, or **F** /
double-click to toggle fullscreen.

There are two backends, chosen automatically at runtime:

- **Desktop app (Tauri):** the OS WebView blocks `window.open()`, so a real,
  borderless native window is created on the detected second display via the
  Tauri window API and driven to true OS fullscreen. The editor mirrors
  `#gpu-canvas` by broadcasting frames over a same-origin `BroadcastChannel`;
  the receiver page (`editor/second-monitor.html`) paints them. This requires
  the window/webview permissions in `src-tauri/capabilities/default.json`.
- **Browser (`npm run dev`):** a borderless popup is opened synchronously inside
  the click (so it is not blocked) and placed on a detected external display via
  the Window Management API (`getScreenDetails`), falling back to a draggable
  popup. The popup mirrors the canvas directly.

This entry is intentionally hidden in the raw web deployments (the Python server
and the static Vercel host), where the in-editor floating preview is the only
output surface. The build is detected at runtime via `import.meta.env`, which
Vite injects but the raw deployments do not (see `src/utils/isViteBuild.js`);
the desktop path additionally checks for the Tauri globals (`src/utils/isTauri.js`).

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

### ⚠️ CRITICAL PERFORMANCE REQUIREMENT FOR ALL AGENTS ⚠️

**30 FPS IS NEVER ACCEPTED. ALL OPTIMIZATIONS MUST TARGET 60 FPS.**

- **Target frame time:** <16.67ms (60 FPS)
- **Throttling values:** Use 16.67ms (60 FPS), NOT 33.33ms (30 FPS)
- **Frame skipping:** Should target 60 FPS, not 30 FPS
- **Any code that limits performance to 30 FPS must be changed to 60 FPS**

This is a non-negotiable requirement. If you see any 30 FPS throttling, frame skipping that results in 30 FPS, or comments mentioning 30 FPS as acceptable, you MUST change it to 60 FPS.

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

**Note:** The standalone `viewer_api.py` server and the `POST /api/launch-viewer` endpoint were removed: the endpoint took a filesystem path from the request body and executed it, and with CORS open to all origins any website could reach it on localhost. Nothing in the editor called it.

## 🔧 Requirements

- Python 3.8+
- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- See [requirements.txt](requirements.txt) for Python packages
