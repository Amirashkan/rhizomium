# TODO

Short working list: deferred work + the beta release checklist.
Last updated: 2026-07-02.

## Beta release checklist (v0.9.0-beta.1)

- [x] Fix ESLint flat config (`linterOptions.env` → `languageOptions.globals`), add `eslint`/`globals` devDeps and `npm run lint`
- [x] Add Lint & Build job to CI (`.github/workflows/test.yml`), bump test matrix to Node 20/22
- [x] Fix duplicate class members (`GraphProcessor.processGraph`, `PreviewComputer._renderOutputThumbnail`, `TextureManager.getTexture`, `Renderer._getCategoryColor`)
- [x] Remove dead duplicate switch cases in `ParameterPanel.js` (colorramp / lineargradient / radialgradient)
- [x] Fix undefined references (`SaveLoadManager` dead recovery fn, `PreviewSettings` catch-scope `blob`, `FloatingGPUPreview` perfToken, `StatusManager.warn`, bare `updateStatus` → `window.updateStatus`)
- [x] Remove unused `@supabase/supabase-js` dependency
- [x] Delete stray files (`et --hard *`, `New Text Document.txt`, `test-output.txt`, `deployment-timestamp.txt`, `index.backup.*.html`)
- [x] Vercel: build with Vite (`buildCommand: npm run build:web`, `outputDirectory: dist`) — stops publishing the raw repo (internal docs, python scripts) to the public site
- [x] Align versions: `package.json` → `0.9.0-beta.1`, `tauri.conf.json` → `0.9.0` (Windows MSI bundling rejects pre-release suffixes, hence no `-beta.1` there)
- [ ] Deploy a Vercel preview and smoke-test in a WebGPU browser: landing page, `/studio` editor, second-monitor window, save/load, export
- [ ] Desktop (optional for beta): `npm run tauri:build` and sanity-check the bundle on at least one OS
- [ ] Tag `v0.9.0-beta.1` and create a GitHub **pre-release** (attach Tauri bundles if built)
- [ ] Publish known-issues list for beta testers (seed from this file + `DEFERRED_WORK.md`)
- [ ] Set up a feedback channel (GitHub issue template for beta bugs)

## Deferred work

Carried from `DEFERRED_WORK.md` (grep `rg -n "KNOWN LIMITATION" src` for in-code markers):

- [ ] `CustomGLSL` multi-line comparison mis-merge: `<`/`>` counted as generic delimiters collide with comparison operators (`src/codegen/compilers/UtilityNodes.js`, `compileCustomGLSL`). Needs a tokenizer.

Designs written, not implemented:

- [ ] Dynamic inputs for mixGPU-style blend nodes — `MIXGPU_MULTIPLE_INPUTS_PLAN.md`
- [ ] Plugin / node-creation API for third-party nodes — `PLUGIN_API_DESIGN.md`

## Lint burn-down (post-beta quality)

`npm run lint` is at **0 errors / ~787 warnings**. Bug-catching rules are hard
errors; legacy noise is warnings until cleaned up:

- [ ] ~670 unused variables/imports (`no-unused-vars`)
- [ ] ~120 empty blocks, mostly `catch {}` swallowing GPU errors silently (`no-empty`) — worth at least a debug log in `src/gpu/*`
- [ ] ~35 `case` declarations without block scope (`no-case-declarations`)
- [ ] 13 useless try/catch wrappers (`no-useless-catch`)
- [ ] Ratchet each rule from `warn` back to `error` in `eslint.config.js` as its count reaches zero

## Housekeeping (nice to have)

- [ ] Move the ~90 internal design/investigation `.md` files from the repo root into `docs/` (no longer publicly served after the Vercel fix, so purely tidiness)
- [ ] Decide whether `glsl-node-editor.docx` (232 KB) belongs in the repo
- [ ] Code-split the 1.2 MB editor chunk (dynamic `import()` for compute/preview subsystems)
- [ ] Define `window.updateStatus` once (e.g. wire up `src/ui/StatusManager.js`, currently never instantiated) so the status messages in FileManager/PreferencesWindow/ParameterPanel actually show
- [ ] Stale root scripts to review: `fix-gpu-test.js`, `show-test-cube.js`, `test.html`, `check-gpu-init.html`, `GPUCanvas.py`
