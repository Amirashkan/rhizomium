# TODO

Consolidated backlog: everything outstanding, gathered from code markers and
all root/docs design notes. Sources are cited so details stay in one place.
Last updated: 2026-07-27.

## Beta release checklist (v0.9.0-beta.2)

- [x] AI performer merged to `main` (#1) — `src/performer/`, panel in `src/ui/PerformerPanel.js`
- [x] Fix desktop right-click: Chromium's context-menu message loop eats the right-button `mouseup` on Windows, so the add-node palette never opened, a right-drag box-select never ended, and the 3D viewport's right-drag zoom never released (`src/core/EventHandler.js`, `src/scene/CameraController.js`)
- [x] Align versions: `package.json` → `0.9.0-beta.2`, `tauri.conf.json` stays `0.9.0` (Windows MSI bundling rejects pre-release suffixes)
- [ ] Verify on Windows: right-click opens the palette, right-drag box-select releases, 3D right-drag zoom releases — all three are WebView2-only and cannot be exercised from the test suite or a Linux browser
- [ ] Mark the drafted GitHub release as a **pre-release** before publishing (`.github/workflows/desktop-release.yml` drafts with `prerelease: false`)

## Beta release checklist (v0.9.0-beta.1)

- [x] Fix ESLint flat config (`linterOptions.env` → `languageOptions.globals`), add `eslint`/`globals` devDeps and `npm run lint`
- [x] Add Lint & Build job to CI (`.github/workflows/test.yml`), bump test matrix to Node 20/22
- [x] Fix duplicate class members (`GraphProcessor.processGraph`, `PreviewComputer._renderOutputThumbnail`, `TextureManager.getTexture`, `Renderer._getCategoryColor`)
- [x] Remove dead duplicate switch cases in `ParameterPanel.js` (colorramp / lineargradient / radialgradient)
- [x] Fix undefined references (`SaveLoadManager` dead recovery fn, `PreviewSettings` catch-scope `blob`, `FloatingGPUPreview` perfToken, `StatusManager.warn`, bare `updateStatus` → `window.updateStatus`)
- [x] Remove unused `@supabase/supabase-js` dependency
- [x] Delete stray files (`et --hard *`, `New Text Document.txt`, `test-output.txt`, `deployment-timestamp.txt`, `index.backup.*.html`)
- [x] Vercel: build with Vite (`buildCommand: npm run build:web`, `outputDirectory: dist`) — stops publishing the raw repo to the public site
- [x] Vercel: exclude local Python viewer tooling via `.vercelignore` (fixes `uv pip install` build failure)
- [x] Align versions: `package.json` → `0.9.0-beta.1`, `tauri.conf.json` → `0.9.0` (Windows MSI bundling rejects pre-release suffixes)
- [ ] Deploy a Vercel preview and smoke-test in a WebGPU browser: landing page, `/studio` editor, second-monitor window, save/load, export, gallery share
- [ ] Desktop (optional for beta): `npm run tauri:build` and sanity-check the bundle on at least one OS
- [ ] Desktop, multi-screen: with two displays attached, lay out "2 across" in **View → Output Screens…**, open the rig, and check each window lands on its own display and shows its own half — the crop path is Tauri-only, so it cannot be exercised from a browser or from the test suite
- [ ] Tag `v0.9.0-beta.1` and create a GitHub **pre-release** (attach Tauri bundles if built)
- [ ] Publish known-issues list for beta testers (seed from this file + `DEFERRED_WORK.md`)
- [ ] Set up a feedback channel (GitHub issue template for beta bugs)

## Sharing / TenderWorld integration

The editor's sharing + cloud file browser authenticate against
`https://art.tenderworld.org` with session cookies (`withCredentials`). The
client side is in place (`src/ui/FileManager.js`, `src/ui/PreviewSettings.js`);
the **server side lives in the tenderworld project**, spec in
`TENDERWORLD_API_INTEGRATION.md`. `app/api/auth-check/route.ts` in this repo is
the reference implementation of the auth-check handler for that Next.js
project — it is not served by this repo's deployment.

- [ ] Implement/verify on the tenderworld server: `GET /api/auth/check`, `GET /api/files/list`, `GET /api/files/download`, `POST /api/files/upload`, `DELETE /api/files/delete`, `POST /api/files/create-folder` (FileManager already calls all of these; `FileManager.js:607` notes they still need to be created)
- [ ] Server-side hardening checklist from `TENDERWORLD_API_INTEGRATION.md`: per-user file isolation, path-traversal prevention, file size limits, CORS with credentials for the editor domain, rate limiting
- [ ] End-to-end test of the share flow: sign-in redirect → image upload (`/api/rhizo-upload`) → publish page; plus the 401 and 413 error paths in `PreviewSettings.js`

## Unfinished features (stub handlers in code)

A handful of menu items in `main.js` are wired but empty
(`grep -n "TODO" main.js`): grid display + visibility toggle, global
node-preview toggle, anti-aliasing, frame range / loop / alpha / compression
export settings, new project, publish to cloud, unsaved-changes check on exit,
connect/disconnect pins, script editor, about dialog.

- [x] Window menu layout system — `src/ui/layoutManager.js`: the Default / Custom / Minimal presets, Save Current as Custom, the Floating Windows hide-and-restore toggle, and Reset Layout (positions, remembered panel sizes and dock widths).

- [x] Shader Compiler (Tools → Shader Tools) — `src/ui/ShaderCompilerWindow.js`: compiles the graph on demand, lists the fragment shader plus every compute node's shader, and prints the driver's errors and warnings against the source.

- [x] GLSL Utilities (Tools → Shader Tools) — `src/ui/GLSLUtilitiesWindow.js`: translates pasted GLSL into the WGSL a Custom GLSL node body speaks (reporting what it will not decide by itself rather than dropping it), a searchable snippet library, the built-in name reference, and "Insert into node" writing either one into the selected Custom GLSL node through the parameter panel's value manager.

- [ ] Triage: implement, or hide the menu items for beta so testers don't hit dead buttons
- [ ] `PreferencesWindow.js` stubs: keymap editor, reset shortcuts, node-preview toggle, auto-save interval, logging level
- [ ] `ParameterExpressionSystem.js:409`: proper time-based preview updates without spam

## Compute nodes — missing implementations

From `COMPUTE_NODES_STATUS.md` (infrastructure is complete; follow the pattern in
`src/codegen/compilers/ComputeNodes.js`):

- [x] `ComputeConvolution` — implemented as a 3x3 kernel convolution (`generateConvolutionShader`): Sharpen / Edge Detect / Emboss / Custom, blended by `strength`.
- [x] `ComputeParticles` — implemented as a stateless grid-based particle shader (single-pass, per-pixel; no particle buffers needed). Force Field (pin 0) and Velocity Field (pin 1, via the Warp/Mix second-input binding) both work.
- [x] `ComputeFluidSim` — implemented as a single-pass stable-fluids solver (`generateFluidSimShader`): semi-Lagrangian advection, per-frame pressure relaxation, flow-gated vorticity confinement, dye advection, built-in emitters when the Velocity Input pin is unconnected, plus a separate visualization pass (`src/gpu/fluidSimViz.js`) for the Dye/Velocity/Vorticity/Pressure views.
- [x] `ComputeCellular` — all four rule sets implemented (Conway Life, Seeds, Brian's Brain, Day & Night), density-seeded live grid, `speed` generation throttle, and a Reset/Reseed button.
- [ ] Optional new nodes: ComputeWarp, ComputeVoronoi, ComputeFFT, ComputeHistogram

## Thread separation — remaining integrations

From `THREAD_SEPARATION_PROGRESS.md` (PreviewComputer + expression evaluation
are integrated; verify current state before starting — the doc predates some
work and `workers/save-load-worker.js` / `workers/undo-manager-worker.js`
already exist):

- [ ] SaveLoadManager worker integration
- [ ] UndoManager worker integration
- [ ] ExecutionQueue → expression worker integration
- [ ] Profile actual main-thread savings; add error-recovery paths

## Performance — known open items

- [ ] Canvas node-editor rendering still costs 5–20 ms/frame during interactions; the accepted long-term fix is WebGPU-based UI rendering (or layered canvas) — see `ACTUAL_FIX_NEEDED.md` and `DEEP_REARCHITECTURE.md` (Option 1 recommended). Big architectural item, post-beta.
- [ ] Time-node-referenced parameter thumbnails refresh at ~10 fps (cosmetic; live output is GPU-clock smooth). Revisit per the ordered options in `TIME_NODE_REFERENCE_NOTES.md` — make per-thumbnail GPU readback async first, don't just raise the cadence.
- [ ] Verify presented FPS with a Time node driving a parameter (perf report measured dispatch, not presented frames — `TIME_NODE_REFERENCE_NOTES.md`)
- [ ] Code-split the 1.2 MB editor chunk (dynamic `import()` for compute/preview subsystems)

## Dual-screen & external viewer — issue backlogs (need re-triage)

These docs predate later fixes (e.g. letterboxing and fragment-fed compute now
have tests); re-check each item against current code before working on it:

- [ ] `DUAL_SCREEN_ISSUES.md`: 15 filed issues — headline ones: `broadcastFrameStream` never initialized in cloud mode (critical), silent error swallowing, no connection-state monitoring, offscreen-canvas + send-queue memory leaks, no cleanup on stop-streaming
- [ ] `FRAGMENT_COMPUTE_INTEROP_ISSUES.md`: 8 filed issues — headline ones: fragment nodes re-rendered every frame (cache exists but invalidation gaps), fragment param changes not detected, fragment/compute resolution mismatch, circular-dependency handling
- [ ] `EXTERNAL_VIEWER_ISSUES.md` testing matrix: resolutions, aspect ratios, fullscreen, IPC vs WebSocket modes
- [ ] `COMPUTE_NODE_EXTERNAL_VIEWER_FIXES.md` verification checklist (live param drag → viewer uniforms)

## Testing — future enhancements

From `docs/ACCEPTANCE_CHECKLIST.md` (current suite: 65 files / 500 tests, all passing):

- [ ] Visual regression tests
- [ ] End-to-end tests with Playwright (browser is preinstalled in CI-like envs)
- [ ] Performance regression detection + automated reports
- [ ] Memory-leak detection tests
- [ ] Stress tests for large graphs
- [ ] GPU hardware testing on dedicated runners

## Deferred work

Carried from `DEFERRED_WORK.md` (grep `rg -n "KNOWN LIMITATION" src` for in-code markers):

- [ ] `CustomGLSL` multi-line comparison mis-merge: `<`/`>` counted as generic delimiters collide with comparison operators (`src/codegen/compilers/UtilityNodes.js`, `compileCustomGLSL`). Needs a tokenizer.

Designs written, not implemented:

- [ ] Dynamic inputs for mixGPU-style blend nodes — `MIXGPU_MULTIPLE_INPUTS_PLAN.md`
- [ ] Plugin / node-creation API for third-party nodes — `PLUGIN_API_DESIGN.md`

## Lint burn-down (post-beta quality)

`npm run lint` is at **0 errors / ~786 warnings**. Bug-catching rules are hard
errors; legacy noise is warnings until cleaned up:

- [ ] ~670 unused variables/imports (`no-unused-vars`)
- [ ] ~120 empty blocks, mostly `catch {}` swallowing GPU errors silently (`no-empty`) — worth at least a debug log in `src/gpu/*`
- [ ] ~35 `case` declarations without block scope (`no-case-declarations`)
- [ ] 13 useless try/catch wrappers (`no-useless-catch`)
- [ ] Ratchet each rule from `warn` back to `error` in `eslint.config.js` as its count reaches zero

## Documentation screenshots still to re-capture

The node reference and the feature panels are illustrated from real captures.
These few are still headless captures taken in a CI container, where WebGPU
cannot present to a canvas — the previews come out black and node thumbnails
read `COMP`. **Blocked: the UI wants changes first, so these are deliberately
not re-shot yet.** Re-capture once those land.

`editor-overview`, `welcome-dialog`, `radial-menu`, `parameter-panel`,
`panel-audio-envelope` and `panel-midi-controllers` have since been re-shot
from the running app and are off this list.

Replacing one is a drop-in: overwrite `docs/images/<name>.png`, run
`node scripts/docs-images.mjs optimize <name>`, and every reference, caption
and alt text stays as it is. A sheet of several nodes at once is better still —
add its boxes to `docs/images/images.config.json` and run `slice`; positions
are fractions, so a re-capture at another resolution keeps working. See the
header of `scripts/docs-images.mjs`.

- [ ] `menu-file` — stale as well as headless: the Publish submenu is now
      **Publish Image… / Publish Animation…** (PR #317), not the old target
      picker with a commit message
- [ ] `menu-edit`, `menu-view`, `menu-node`, `menu-tools`, `menu-window`,
      `menu-help` — accurate but headless; currently unreferenced by any page,
      so either re-shoot or delete
- [ ] Cosmetic, worth fixing before any node re-shoot: the output value readout
      (`0.000`) is drawn over the preview thumbnail on nodes that have one —
      Polygon, Worley Noise, Cell Noise, Voronoi Noise all show it sitting on
      top of the image

`panel-osc-receiver` is shot and optimized but not referenced by any page yet —
the OSC Receiver panel has no section of its own in `interface.md`.

Not blocked, already done from real captures: every `node-*` image, the
`panel-*` panels, `node-graph-live`, `menu-bar`, `profiler-compact`,
`profiler-expanded` and `wgsl-console`.

## Housekeeping (nice to have)

- [ ] Move the ~90 internal design/investigation `.md` files from the repo root into `docs/` and archive the stale ones (`NEXT_STEPS.md` is outdated — the InteractionStateManager fixes it asks for are done and all tests pass)
- [ ] Decide whether `glsl-node-editor.docx` (232 KB) belongs in the repo
- [ ] Define `window.updateStatus` once (e.g. wire up `src/ui/StatusManager.js`, currently never instantiated) so the status messages in FileManager/PreferencesWindow/ParameterPanel actually show
- [ ] Stale root scripts to review: `fix-gpu-test.js`, `show-test-cube.js`, `test.html`, `check-gpu-init.html`, `GPUCanvas.py`
