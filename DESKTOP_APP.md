# Rhizomium as a desktop app

The Tauri shell in `src-tauri/` turns the editor into an installable
application. This is what it does today, how to run and build it, and what is
still between it and something you can hand to a stranger.

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

Rust, plus your platform's native webview toolchain:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- **macOS** — Xcode Command Line Tools: `xcode-select --install`
- **Windows** — [Microsoft C++ Build Tools] with the "Desktop development with
  C++" workload. WebView2 ships with Windows 10 (recent) and 11.
- **Linux** — `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev
  libssl-dev libayatana-appindicator3-dev librsvg2-dev` (Debian/Ubuntu names).
  Read the WebGPU section below before spending time here.

[Microsoft C++ Build Tools]: https://visualstudio.microsoft.com/visual-cpp-build-tools/

### Development

```bash
npm install
npm run tauri:dev
```

Vite starts on :5173, Tauri opens the splash and the hidden editor window
against it, and edits to the frontend hot-reload as usual. DevTools open
automatically in debug builds.

### Building installers locally

```bash
npm run tauri:build
```

Output lands in `src-tauri/target/release/bundle/`: `.dmg` and `.app` on macOS,
`.msi` and `.exe` (NSIS) on Windows, `.deb`/`.rpm`/`.AppImage` on Linux.

This runs `npm run build:desktop` first — the mode that produces the splash and
omits the landing page. Do not point it at `build:web`: the app would open on a
404 where `splash.html` should be.

---

## The one thing that decides whether this ships: WebGPU

Rhizomium is a WebGPU application, and Tauri renders in the **operating
system's** webview rather than a bundled Chromium. So desktop support is not a
question of Tauri — it is a question of whether that webview has WebGPU.

| Platform | Webview | WebGPU |
| --- | --- | --- |
| Windows 10/11 | WebView2 (Chromium) | **Yes.** Chromium has shipped WebGPU by default since 113. |
| macOS 26+ | WKWebView (Safari 26) | **Yes**, on by default. |
| macOS 15 and earlier | WKWebView | **No.** WebGPU is opt-in there, and [Safari's feature flags do not apply to WKWebView][apple-forum] — an embedded webview only gets a feature once it is on by default. |
| Linux | WebKitGTK | **No** usable support. |

[apple-forum]: https://developer.apple.com/forums/thread/770862

Consequences, stated plainly:

- **Windows is the solid target.** Ship it.
- **macOS works on Tahoe (26) and later.** On earlier macOS the app installs,
  launches, and shows the device-warning overlay. `bundle.macOS.minimumSystemVersion`
  is currently `10.15`, which lets those users install something that cannot
  run. Raising it to `26.0` would stop that at the installer instead — a
  product call worth making deliberately, not by leaving the default.
- **Linux is not shippable as-is**, which is why it is absent from the release
  workflow's matrix. The realistic options are to wait for WebKitGTK, or to
  ship the Linux build against a Chromium-based webview instead (Tauri's Servo
  and CEF work, or an Electron shell for that platform only). Do not add a
  Linux row to the matrix without testing the result on a real machine.

**Verify before every release.** Install the bundle on the actual OS version
you intend to support and confirm the editor reaches its canvas rather than the
warning overlay. Everything else in this document is packaging; this is the
part that decides whether there is an app.

---

## From "it builds" to "it ships"

### 1. Code signing — macOS

Unsigned, Gatekeeper tells the user the app is damaged and offers to move it to
the trash. Signing and notarisation are not optional for distribution outside
the App Store.

1. Join the Apple Developer Program ($99/yr).
2. Create a **Developer ID Application** certificate, export it as `.p12`.
3. Create an app-specific password at appleid.apple.com for notarisation.
4. Add these repository secrets:

   | Secret | Value |
   | --- | --- |
   | `APPLE_CERTIFICATE` | the `.p12`, base64: `base64 -i cert.p12 \| pbcopy` |
   | `APPLE_CERTIFICATE_PASSWORD` | the password you set on export |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | 10-character team ID |

`.github/workflows/desktop-release.yml` already reads all six. Adding them is
the whole change — signing and stapling then happen on the next tag.

If you add a hardened-runtime entitlement later (camera, microphone — Rhizomium
uses audio input), it goes in `bundle.macOS.entitlements`.

### 2. Code signing — Windows

Unsigned, SmartScreen shows "Windows protected your PC" on every install until
the binary builds reputation.

- **Azure Trusted Signing** is the cheap current route (~$10/mo, no hardware
  token) and works from CI via `bundle.windows.signCommand`.
- **An OV/EV certificate** from a CA is the traditional route; EV requires a
  hardware token, which CI cannot use directly.

Then set `bundle.windows.certificateThumbprint`, `digestAlgorithm: "sha256"`
and a `timestampUrl` — a timestamp is what keeps already-shipped installers
valid after the certificate expires.

### 3. Auto-updates

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
- add the **private** key as `TAURI_SIGNING_PRIVATE_KEY` — the release workflow
  already passes it through.

The private key is the thing that lets you push code to every installed copy.
Treat it accordingly: it never goes in the repository.

### 4. Releasing

```bash
npm version 0.9.0        # updates package.json; keep tauri.conf.json in step
git push && git push --tags
```

`desktop-release.yml` builds macOS (universal) and Windows and attaches the
bundles to a **draft** release. Check the artefacts, then publish.

Note the two version numbers: `package.json` feeds the splash and the editor's
about box, `src-tauri/tauri.conf.json` feeds the installer and the OS "about"
panel. They are not currently linked — bump both.

### 5. Loose ends

- **Application menu.** There is no native menu bar, so on macOS the app has no
  Rhizomium menu and no ⌘Q. The editor's own menu bar covers File/Edit/View
  inside the window, but the OS-level one is worth adding.
- **Help → Documentation.** Opens `/docs/`, a docsify site that loads docsify
  itself from a CDN — which the app's CSP blocks. In the desktop app it opens
  blank. Either vendor docsify into the bundle or point the menu item at the
  hosted documentation.
- **`.rz` file association** is configured and handled (`lib.rs`), but only
  really testable from an installed build — worth an explicit check per release.
- **Crash reporting.** Nothing is collected today, so a crash on someone else's
  machine is invisible.
