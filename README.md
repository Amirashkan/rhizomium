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

The editor can run as a native desktop app via [Tauri](https://tauri.app),
**shipped for Windows**. It opens straight into the editor: the landing page is
a web thing, so the desktop build leaves it out of the bundle entirely and shows
a small loading window (`splash.html`) while the editor boots hidden behind it.
See [DESKTOP_APP.md](DESKTOP_APP.md) for how that handoff works, why Windows is
the only bundled platform, and what code signing, auto-updates and releasing
still need.

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

This starts the Vite dev server on `http://localhost:5173`, shows the loading
window, and opens the editor once it has booted.

### Build a distributable

```bash
npm run tauri:build
```

The `.msi` and NSIS `.exe` are written to `src-tauri/target/release/bundle/`.
Pushing a `v*` tag builds them in CI and attaches them to a draft release
(`.github/workflows/desktop-release.yml`).

> **Note:** Tauri renders in the OS WebView, so WebGPU support is the OS's, not
> Tauri's — and WebView2 on Windows is the only one that reliably has it today.
> That is why Windows is the only platform bundled; `tauri:dev` still runs
> anywhere. Details in [DESKTOP_APP.md](DESKTOP_APP.md).

### Multi-Screen Output (Vite/desktop build only)

The Vite build (`npm run dev` and the Tauri desktop app) adds a **View → Open
Output** entry. It opens chrome-free black windows on the displays the patch is
thrown onto and renders the live output there, letterboxed and centred — a
pristine performance surface with no editor UI. The output paints on its own animation
frame, so it keeps running at the second display's refresh rate even when the
editor window is occluded or minimised. Press **Esc** to close it, or **F** /
double-click to toggle fullscreen.

**View → Output Screens…** lays a rig out across several displays: a projector
panorama, a video wall, or a stage where each surface shows its own slice. Every
screen renders the same composition and shows its own **region** of it, with
one-click layouts (2 across, 3 across, 2 × 2), an edge-blend overlap for
projectors, and per-screen display and resolution. The composition's state is
broadcast once for the whole rig, so a second and third screen cost the editor
almost nothing. It is a **Cloude Plus** entitlement (`output.multiscreen`), and
the rig saves with the project. Details in
[docs/multi-screen.md](docs/multi-screen.md).

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

### Web Patch Viewer (`/viewer`)

A published patch, running live in a browser with no editor around it — the page
a link to your work leads to. **File → Open in Web Viewer** (`Ctrl/⌘+Shift+W`)
opens the patch you are editing there in a second tab, handed over through
IndexedDB rather than through the gallery, so looking at your own work does not
mean publishing it first.

The viewer is a **Cloude** entitlement (`viewer.web`): free and signed-out
visitors get an upsell rather than a render, and unlike the live-output features
it refuses when the gallery cannot be reached instead of allowing. Audio, MIDI,
OSC and the 3D field visualisers do not travel with a patch, and the page says
so under the render. Details in [docs/web-viewer.md](docs/web-viewer.md).

Web only: the desktop app's WebView blocks `window.open()`, and the
second-monitor viewer is its full-screen surface.

## 📖 Documentation

- **[docs/multi-screen.md](docs/multi-screen.md)** - Driving several displays from one patch, with per-screen framing
- **[docs/web-viewer.md](docs/web-viewer.md)** - The web patch viewer, and the tier gate on it
- **[docs/frame-rate.md](docs/frame-rate.md)** - **Frame rate & display refresh — read this if the fps readout is lower than your monitor's refresh rate**
- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 3 steps
- **[RHIZOMIUM_VIEWER_SETUP.md](RHIZOMIUM_VIEWER_SETUP.md)** - External viewer setup
- **[DEPLOYMENT_NOTES.md](DEPLOYMENT_NOTES.md)** - Cloud vs local deployment
- **[src/osc/README.md](src/osc/README.md)** - OSC receiver and bridge
- **[src/midi/README.md](src/midi/README.md)** - MIDI controller integration
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and solutions

## ✨ Features

- **WebGPU Core** - Real-time GPU-accelerated rendering
- **Node Editor** - Visual shader programming
- **External Viewer** - IPC-based frame streaming to secondary displays
- **Audio Reactivity** - Audio envelope integration
- **MIDI Control** - Map hardware controllers to any parameter
- **OSC Control** - Map TouchOSC, Max, SuperCollider and friends to any parameter
- **Save/Load** - Project management with backups
- **Web Viewer** - Published patches running live in the browser (Cloude)

## 🎛️ OSC Control

OSC arrives over UDP, which a browser cannot listen for, so a small local
bridge forwards it to the editor. It starts automatically with
`python rhizo_server.py`, `npm run dev` and `npm run tauri:dev`; alongside a
built desktop binary, run `npm run osc`. Then open **Tools → OSC Receiver**,
click **Connect**, and point your sender at `udp://<this machine>:9000`.

Because the bridge is a local process, OSC is a local-only feature like the
external viewer — it cannot work on the static web deploy.

To map a control: select a node, click the parameter field, click **Start OSC
Learn**, then move the control. Full details — input ranges, multi-argument
messages, network exposure — are in [src/osc/README.md](src/osc/README.md).

## 📡 NDI Output

Publishes the render onto the network as an NDI source, for a vision mixer, OBS
or a monitor on another machine. NDI is a native protocol a browser cannot
speak, so a local bridge owns the sender: run `npm run ndi`, then open
**View → NDI Output** (`Mod+Shift+N`).

NDI itself needs the runtime from <https://ndi.video/> and `pip install
cyndilib`. Both are optional — without them the bridge still runs and tells the
editor which one is missing, rather than leaving a dead toggle.

Like OSC and the external viewer, this is a local-only feature: it cannot work
on the static web deploy. Full details — the wire protocol, the bandwidth it
costs, diagnostics — are in [src/output/README.md](src/output/README.md).

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
├── osc_bridge_server.py     ← OSC bridge (UDP → WebSocket)
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
    ├── midi/
    ├── osc/
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
