# Installation & Setup

This guide covers running Rhizomium from source. To just use Rhizomium, install
the Windows desktop app from the
[latest release](https://github.com/Amirashkan/rhizomium/releases/latest) -
there is no web version to sign up for.

---

## Requirements

- **Node.js 20 or later** (CI runs 20 and 22)
- **A WebGPU browser** for the dev server: Chrome or Edge 113+. There is no
  WebGL fallback.
- **A GPU with WebGPU support.** Check at [webgpu.io](https://webgpu.io/).
- **Git**

For the desktop build you also need:

- [Rust](https://rustup.rs)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the "Desktop development with C++" workload
- WebView2 - already present on Windows 11 and up-to-date Windows 10

Python is **not** required. It is only used by the optional local servers
below.

---

## Run the editor in a browser

```bash
git clone https://github.com/Amirashkan/rhizomium.git
cd rhizomium
npm install
npm run dev
```

Vite serves on **http://localhost:5173**. The landing page is at `/` and the
editor at `/editor/`.

AI features call `/api/ai/run`, which only exists on the deployment. The dev
server forwards `/api` to `https://studio.tenderworld.org` (override with
`API_PROXY`) and `/gallery-api` to `https://art.tenderworld.org` (override
with `GALLERY_PROXY`), so they work from a local run with a signed-in account.

---

## Run the desktop app

```bash
npm install
npm run tauri:dev
```

Vite starts on :5173 and Tauri opens the splash and editor windows against it;
frontend edits hot-reload. `tauri:dev` runs on macOS and Linux too, but only
Windows has a WebView with WebGPU, so the editor itself only works there.

Build installers with:

```bash
npm run tauri:build
```

This produces `.msi` and `.exe` (NSIS) installers in
`src-tauri/target/release/bundle/`. Bundling is Windows-only.

More detail - signing, updates, the WebView matrix - is in
[`docs/internal/DESKTOP_APP.md`](https://github.com/Amirashkan/rhizomium/blob/develop/docs/internal/DESKTOP_APP.md).

---

## Build for the web

```bash
npm run build:web
```

Output goes to `dist/`, including the docs site under `dist/docs`. See
[Vercel Deployment](vercel.md) for hosting it.

`npm run build:desktop` is the same build with the splash window as the front
door instead of the landing page; `tauri:build` runs it for you.

---

## Checks

Before opening a pull request:

```bash
npm run lint
npm test
npm run build:web
```

All three must pass; CI runs them on every push. `npm run test:watch` and
`npm run test:ui` are there for working on tests.

---

## OSC, NDI and Live Input

These need things a browser cannot do (UDP, NDI), so they are part of the
desktop app (`src-tauri/src/bridge`), which starts each one when a patch first
uses it — under `npm run tauri:dev` exactly as in an installed build. Nothing
needs to be run alongside. See
[src/osc/README.md](https://github.com/Amirashkan/rhizomium/blob/develop/src/osc/README.md),
[src/output/README.md](https://github.com/Amirashkan/rhizomium/blob/develop/src/output/README.md)
and [external-input.md](external-input.md).

## Optional local servers (Python)

None are needed for the editor itself, and none work on a static web deploy.

```bash
pip install -r requirements.txt
```

| Server | Start it with | Used by |
|---|---|---|
| Collab room relay | `python collab_room_server.py` | The collab space |

`python rhizo_server.py` is an all-in-one alternative: a Flask server on
**http://127.0.0.1:5000** that serves the repository and starts the collab
relay and the frame-stream server alongside it. `npm run dev` is the normal way
to run the editor.

MIDI needs no bridge - it uses Web MIDI. See [MIDI Controller Integration](midi.md).

---

## Troubleshooting

**"WebGPU not supported"** - use Chrome or Edge 113+, make sure hardware
acceleration is on, and check [webgpu.io](https://webgpu.io/). Firefox and
Safari are not supported.

**Port 5173 is in use** - the dev server uses `strictPort`, so it fails
instead of picking another port. Stop whatever holds 5173 (often a second
`npm run dev`).

**`npm install` fails** - check `node --version` is 20 or later, then delete
`node_modules` and `package-lock.json` changes you did not make and try again.

**Blank editor** - open DevTools (F12) and read the Console. A shader error
from your patch is shown in the editor's WGSL console; anything else there is
worth an [issue](https://github.com/Amirashkan/rhizomium/issues).

---

## Next steps

1. **[Quick Start Guide](quickstart-web.md)** - learn the basics
2. **[Your First Graph](guide.md)** - build an animated pattern
3. **[Working with Audio](audio-web.md)** - audio-reactive visuals
4. **[FAQ](faq-web.md)** - common questions
