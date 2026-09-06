# Rhizomium

A node editor for real-time generative visuals. Build a shader by connecting
nodes, drive any parameter from audio, MIDI, OSC or a timeline, and push the
result to a projector, a video wall or an NDI feed.

Runs in the browser on WebGPU. No installation, no account.

[**Open the editor →**](https://studio.tenderworld.org/studio) ·
[Documentation](https://studio.tenderworld.org/docs) ·
[Contributing](CONTRIBUTING.md) · [Architecture](ARCHITECTURE.md)

> **Requires WebGPU:** Chrome or Edge 113+. Firefox and Safari support is
> arriving but is not there yet. Nothing else is needed to try it.

---

## Run it locally

```bash
git clone https://github.com/Amirashkan/rhizomium
cd rhizomium
npm install
npm run dev
```

That is the whole development setup. The editor opens on
`http://localhost:5173`, renders locally, and saves `.rz` patches to disk. No
Python, no account, no API key.

The Python servers in this repository are **optional bridges** for things a
browser cannot do itself — receiving OSC over UDP, sending NDI, streaming
frames to a native viewer. They are described under
[Local bridges](#local-bridges) below. You do not need them to work on the
editor.

```bash
npm test        # ~222 test files (Vitest)
npm run lint
npm run build:web
```

## What is open, and what is a service

Rhizomium is [AGPL-3.0-or-later](LICENSE). The editor is complete on its own:
it runs, renders and saves patches offline, forever, for free.

Two things in the wider product are services rather than parts of this
repository:

- **The gallery** (`art.tenderworld.org`) — accounts, patch sharing, plans and
  billing. A separate closed codebase. Nothing here requires it.
- **Hosted model usage** behind `api/ai/run.js`. That endpoint is AGPL like
  everything else and you can deploy it against your own OpenAI key; what a
  plan buys is *our* deployment of it.

Some features in the editor are gated on a plan — the web viewer, multi-screen
output, the generative AI tools. The gate is real and enforced server-side
(`api/_lib/grant.js`), and it is deliberately visible in the source. Setting
your tier in devtools lights up the buttons and earns you a 401.

**Working on AI features without an account:** set `AI_DEBUG_MODE` and use the
unsigned debug grant — see `src/ai/debugMode.js`. This is the supported local
path.

For redistribution or embedding under terms other than the AGPL, see
[COMMERCIAL.md](COMMERCIAL.md). Names and logos are reserved — see
[NOTICE](NOTICE).

## Contributing

Contributions are welcome, and the engine is where help is most valuable:
shader codegen, the WebGPU renderer, and the graph model.

Start with **[ARCHITECTURE.md](ARCHITECTURE.md)** — it traces one signal from a
node on the canvas to pixels on screen and names the file that owns each step.
Then [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and the sign-off we
ask for.

Adding a node is usually two files: a definition in `src/data/nodes/` and an
emitter in `src/codegen/compilers/`. There is a walkthrough in
[ARCHITECTURE.md § Adding a node](ARCHITECTURE.md#adding-a-node).

Issues labelled `good first issue` are a reasonable entry point. If you are
unsure whether something is wanted, open an issue before writing the patch.

## Features

- **WebGPU rendering** with a WGSL shader compiled from the graph
- **Compute nodes** alongside fragment nodes, with automatic bridging
- **Expressions** on any parameter, evaluated by an AST interpreter (never `eval`)
- **Audio reactivity** — mic or system audio, with envelope following
- **MIDI** and **OSC** parameter mapping, with learn mode
- **Timeline** keyframing
- **3D viewport** and field visualisation
- **Multi-screen output** and projection mapping *(plan feature)*
- **NDI output** to a vision mixer or OBS
- **Web patch viewer** — a link to a patch running live *(plan feature)*
- **Desktop app** via Tauri (Windows)
- **AI assistance** — patch review, refactoring, a creative director *(plan feature)*

## Desktop app (Tauri)

The editor also runs as a native app, **shipped for Windows**. It opens
straight into the editor; the landing page is left out of the bundle and a
small loading window (`splash.html`) shows while the editor boots.

```bash
npm run tauri:dev      # run in development
npm run tauri:build    # build a distributable
```

The `.msi` and NSIS `.exe` land in `src-tauri/target/release/bundle/`. Pushing
a `v*` tag builds them in CI and attaches them to a draft release
(`.github/workflows/desktop-release.yml`).

> Tauri renders in the OS WebView, so WebGPU support is the OS's, not Tauri's —
> and WebView2 on Windows is the only one that reliably has it today. That is
> why Windows is the only bundled platform; `tauri:dev` runs anywhere.
> Details in [docs/internal/DESKTOP_APP.md](docs/internal/DESKTOP_APP.md).

## Multi-screen output

*Vite dev server and desktop build only.*

**View → Open Output** opens chrome-free black windows on the displays the
patch is thrown onto and renders the live output there, letterboxed and
centred — a performance surface with no editor UI. The output paints on its own
animation frame, so it keeps the second display's refresh rate even when the
editor window is occluded. **Esc** closes it; **F** or double-click toggles
fullscreen.

**View → Output Screens…** lays a rig out across several displays: a projector
panorama, a video wall, or a stage where each surface shows its own slice. Every
screen renders the same composition and shows its own region of it, with
one-click layouts (2 across, 3 across, 2 × 2), edge-blend overlap for
projectors, and per-screen display and resolution. The composition's state is
broadcast once for the whole rig, so extra screens cost the editor almost
nothing. Requires the `output.multiscreen` entitlement; the rig saves with the
project. See [docs/multi-screen.md](docs/multi-screen.md).

Two backends are chosen automatically:

- **Desktop (Tauri):** the OS WebView blocks `window.open()`, so a borderless
  native window is created on the detected display via the Tauri window API and
  driven to true OS fullscreen. The editor mirrors `#gpu-canvas` by
  broadcasting frames over a same-origin `BroadcastChannel`;
  `editor/second-monitor.html` paints them. Needs the window/webview
  permissions in `src-tauri/capabilities/default.json`.
- **Browser (`npm run dev`):** a borderless popup opened synchronously inside
  the click and placed on an external display via the Window Management API
  (`getScreenDetails`), falling back to a draggable popup.

Hidden in the raw web deployments, where the in-editor floating preview is the
only output surface. The build is detected at runtime through
`import.meta.env` (`src/utils/isViteBuild.js`); the desktop path also checks
the Tauri globals (`src/utils/isTauri.js`).

## Web patch viewer (`/viewer`)

A published patch running live in a browser with no editor around it — the page
a link to your work leads to. **File → Open in Web Viewer**
(`Ctrl/⌘+Shift+W`) opens the patch you are editing in a second tab, handed over
through IndexedDB rather than through the gallery, so looking at your own work
does not mean publishing it first.

Requires the `viewer.web` entitlement, and unlike the live-output features it
refuses when the gallery is unreachable rather than allowing. Audio, MIDI, OSC
and the 3D field visualisers do not travel with a patch, and the page says so
under the render. See [docs/web-viewer.md](docs/web-viewer.md).

Web only: the desktop app's WebView blocks `window.open()`, and the
second-monitor viewer is its full-screen surface.

## Local bridges

Optional Python processes for protocols a browser cannot speak. All are
local-only and cannot work on a static web deploy.

```bash
pip install -r requirements.txt
```

**OSC** — arrives over UDP, which a browser cannot listen for, so a small
bridge forwards it. It starts automatically with `npm run dev`,
`npm run tauri:dev` and `python rhizo_server.py`; alongside a built desktop
binary run `npm run osc`. Open **Tools → OSC Receiver**, click **Connect**, and
point your sender at `udp://<this machine>:9000`. To map a control: select a
node, click a parameter field, click **Start OSC Learn**, then move the
control. Details in [src/osc/README.md](src/osc/README.md).

**NDI** — publishes the render onto the network for a vision mixer, OBS or
another machine. Run `npm run ndi`, then **View → NDI Output**
(`Mod+Shift+N`). Needs the runtime from <https://ndi.video/> and
`pip install cyndilib`; without them the bridge still runs and reports which is
missing rather than leaving a dead toggle. Details in
[src/output/README.md](src/output/README.md).

**External viewer** — IPC frame streaming to a native window. Run
`python rhizo_server.py`, then **Open External Viewer** in the toolbar. See
[docs/internal/RHIZOMIUM_VIEWER_SETUP.md](docs/internal/RHIZOMIUM_VIEWER_SETUP.md).

**MIDI** needs no bridge — it is Web MIDI. See
[src/midi/README.md](src/midi/README.md).

## Documentation

- [Full docs site](https://studio.tenderworld.org/docs) — user guide, node
  reference, tutorials
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the engine fits together
- [docs/frame-rate.md](docs/frame-rate.md) — **read this if the fps readout is
  below your monitor's refresh rate**
- [docs/node-reference.md](docs/node-reference.md) — every node
- [docs/compute-nodes.md](docs/compute-nodes.md) — the compute path
- [docs/multi-screen.md](docs/multi-screen.md),
  [docs/web-viewer.md](docs/web-viewer.md)
- [docs/internal/](docs/internal/) — engineering notes, investigation logs and
  design scratch. Useful when digging, not maintained as documentation, and
  deliberately not published to the docs site.

## Security

Please do not file security issues publicly. See [SECURITY.md](SECURITY.md).

## Licence

[GNU Affero General Public License v3.0 or later](LICENSE).
Commercial terms: [COMMERCIAL.md](COMMERCIAL.md). Trademarks: [NOTICE](NOTICE).
