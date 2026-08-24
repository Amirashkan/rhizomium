# Rhizomium as a desktop app

The Tauri shell in `src-tauri/` turns the editor into an installable Windows
application. This is what it does today, how to run and build it, and what is
still between it and something you can hand to a stranger.

**Windows only, for now.** See [Why Windows only](#why-windows-only) for the
reason and what it would take to add the others back.

---

## How launch works

The desktop app has no landing page. `index.html` is marketing — it exists to
persuade someone to try Rhizomium, and someone who has already installed it and
double-clicked the icon has been persuaded. Shipping it inside the app meant
every launch opened on a "Launch Studio" button that the artist then had to
press to get to the thing they opened.

So the desktop build leaves it out entirely and opens the editor directly,
behind a small loading window:

```
  launch
    │
    ├─ splashscreen ── splash.html, borderless, centred, always on top
    │                  460×196, drawn immediately, no dependencies
    │
    └─ main ────────── editor/index.html, created HIDDEN
                       boots: GPU adapter → device → first shader → panels
                         │
                         └─ invoke('app_ready')
                              │
                              ├─ show + focus main
                              └─ close splashscreen
```

The pieces:

| File | Role |
| --- | --- |
| `splash.html` | The loading window. Self-contained: no stylesheet, no framework, no Tauri API. It is the one page that must render before anything else works. |
| `src-tauri/tauri.conf.json` | Declares both windows. `main` is `"visible": false` and points at `editor/index.html`. |
| `src-tauri/src/lib.rs` | `app_ready` command → `reveal_editor()`. Latched by an atomic so it runs exactly once. |
| `src/core/tauriSplash.js` | `signalAppReady()` — the frontend side. No-ops in a browser. |
| `main.js` | Calls it from `initialize()`'s `finally`, and from the device-check failure paths. |
| `vite.config.js` | `--mode desktop` swaps `index.html` out of the bundle for `splash.html`. |

Two details worth keeping:

- **Every boot path signals, including the failures.** A machine without WebGPU
  never reaches `initialize()` — it renders the device-warning overlay instead.
  That overlay lives *inside the main window*, so the handoff has to happen
  there too or the user stares at a splash screen and never learns why.
- **`SPLASH_TIMEOUT` (20s) is a dead man's switch.** If the frontend cannot
  report at all — a bundle that fails to parse, a webview that dies — Rust
  reveals the editor anyway. Without it a bad build is a borderless box with no
  title bar, no menu and no way to close it short of the task manager.

Coverage: `tests/desktopLaunch.test.js`.

---

## Running it

### Prerequisites

- [Rust](https://rustup.rs)
- [Microsoft C++ Build Tools] with the "Desktop development with C++" workload
- WebView2 — already present on Windows 11 and on up-to-date Windows 10

[Microsoft C++ Build Tools]: https://visualstudio.microsoft.com/visual-cpp-build-tools/

### Development

```bash
npm install
npm run tauri:dev
```

Vite starts on :5173, Tauri opens the splash and the hidden editor window
against it, and edits to the frontend hot-reload as usual. DevTools open
automatically in debug builds.

`tauri:dev` works on macOS and Linux too — it is only *bundling* that is
Windows-only — but the editor itself will not run there (see below).

### Building installers

```bash
npm run tauri:build
```

Produces `.msi` and `.exe` (NSIS) in `src-tauri/target/release/bundle/`.
`bundle.targets` is pinned to `["msi", "nsis"]`, so running this on macOS or
Linux fails rather than quietly producing an installer that cannot run the app.

This runs `npm run build:desktop` first — the mode that produces the splash and
omits the landing page. Do not point it at `build:web`: the app would open on a
404 where `splash.html` should be.

---

## Why Windows only

Rhizomium is a WebGPU application, and Tauri renders in the **operating
system's** webview rather than a bundled Chromium. So platform support is not a
question of Tauri — it is a question of whether that webview has WebGPU.

| Platform | Webview | WebGPU |
| --- | --- | --- |
| Windows 10/11 | WebView2 (Chromium) | **Yes.** Chromium has shipped WebGPU by default since 113. |
| macOS 26+ | WKWebView (Safari 26) | Yes, on by default. |
| macOS 15 and earlier | WKWebView | No. WebGPU is opt-in there, and [Safari's feature flags do not apply to WKWebView][apple-forum] — an embedded webview only gets a feature once it is on by default. |
| Linux | WebKitGTK | No usable support. |

[apple-forum]: https://developer.apple.com/forums/thread/770862

Windows is the one platform where the app simply works, so it is the one
platform being built. On the others the installer would succeed, the app would
launch, and the editor would show its "no GPU device" screen.

To bring them back later:

- **macOS** — requires a Developer ID certificate and notarisation (see the
  Apple docs for `tauri-action`'s `APPLE_*` secrets), plus a decision about
  `bundle.macOS.minimumSystemVersion`: leaving Tauri's default lets pre-Tahoe
  users install something that cannot run, so it wants pinning to `26.0`.
  Add `"app"`/`"dmg"` to `bundle.targets` and a `macos-latest` job to
  `desktop-release.yml`.
- **Linux** — needs a Chromium-based webview instead of WebKitGTK (Tauri's
  Servo and CEF work, or an Electron shell for that platform only). Not a
  packaging change; do not add it back without testing on a real machine.

The `.rz` file-association code in `lib.rs` keeps its macOS branch either way —
it is `cfg`-gated and costs nothing on Windows.

**Verify before every release.** Install the `.msi` on a real Windows machine
and confirm the editor reaches its canvas rather than the warning overlay.
Everything below is packaging; this is the part that decides whether there is
an app.

---

## From "it builds" to "it ships"

### 1. Code signing

Unsigned, SmartScreen shows "Windows protected your PC" on every install until
the binary builds reputation. Two routes:

- **Azure Trusted Signing** — the cheap current option (~$10/mo, no hardware
  token) and the one that works from CI, via `bundle.windows.signCommand`.
- **An OV or EV certificate** from a CA — the traditional route. EV requires a
  hardware token, which CI cannot use directly.

Then set, under `bundle.windows`:

```jsonc
"certificateThumbprint": "…",
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com"
```

The timestamp is what keeps already-shipped installers valid after the
certificate expires — do not skip it.

### 2. Auto-updates

Without this, every fix means asking users to go and download a new installer.

```bash
npm run tauri add updater
npx tauri signer generate -w ~/.tauri/rhizomium.key
```

Then:
- put the **public** key in `plugins.updater.pubkey`, and an endpoint in
  `plugins.updater.endpoints` (a GitHub release `latest.json` is the usual
  choice);
- set `bundle.createUpdaterArtifacts: true`;
- add the **private** key as the `TAURI_SIGNING_PRIVATE_KEY` repository secret
  — the release workflow already passes it through.

The private key is the thing that lets you push code to every installed copy.
Treat it accordingly: it never goes in the repository.

### 3. Releasing

```bash
npm version 0.9.0        # updates package.json; keep tauri.conf.json in step
git push && git push --tags
```

`.github/workflows/desktop-release.yml` builds the installers and attaches them
to a **draft** release. Check the artefacts, then publish.

Note the two version numbers: `package.json` feeds the splash and the editor's
about box, `src-tauri/tauri.conf.json` feeds the installer and the Windows
"Apps & features" entry. They are not currently linked — bump both.

### 4. Loose ends

- **Help → Documentation** opens `/docs/`, a docsify site that loads docsify
  itself from a CDN — which the app's CSP blocks. In the desktop app it opens
  blank. Either vendor docsify into the bundle or point the menu item at the
  hosted documentation.
- **`.rz` file association** is configured and handled (`lib.rs`), but only
  really testable from an installed build — worth an explicit check per release.
- **Crash reporting.** Nothing is collected today, so a crash on someone else's
  machine is invisible.
