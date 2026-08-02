# In-App Icon Spec

Brief for the design agent. This enumerates every icon the GLSL node editor needs,
derived from the actual UI surfaces in the codebase (menus, panels, canvas-drawn node
controls). Each entry lists the sprite id to use, what it means, where it appears, and
what placeholder it currently replaces.

---

## 1. Design constraints (match the existing sprite)

The app already ships one icon set: `src/assets/category-icons.svg`, mirrored inline in
`src/ui/RadialMenu.js:9-20`. New icons must be drop-in compatible with it.

| Constraint | Value |
| --- | --- |
| Canvas | `viewBox="0 0 24 24"` |
| Style | Outline / stroke-only. `fill="none"`, `stroke="currentColor"` |
| Stroke weight | `1.6`, `stroke-linecap="round"`, `stroke-linejoin="round"` |
| Color | Monochrome only — **`currentColor`**, never a hardcoded hex. Each radial-menu segment tints its own icon (`RadialMenu.js:769`), so any baked-in color breaks theming. |
| Solid accents | Allowed sparingly as `fill="currentColor" stroke="none"` on small dots/blocks (see `icon-texture`, `icon-vector`) |
| Delivery | `<symbol id="icon-NAME">` elements inside one sprite SVG, referenced via `<use href="#icon-NAME">` |
| Naming | kebab-case, `icon-` prefix. Category icons **must** be `icon-${category.toLowerCase()}` — the lookup is string-built at `RadialMenu.js:762` |
| Optical grid | Keep artwork inside a 20×20 safe area (2px padding) so it reads at 26px and at 12px |

### Render sizes in use

| Size | Surface |
| --- | --- |
| 26px | Radial menu category glyphs (`RadialMenu.js:757`) |
| 20px | Floating toggle buttons (`editor/index.html:441`) |
| 14–16px | Menu-bar dropdown items, panel toolbars |
| 10–12px | Node title-bar controls drawn on canvas (`src/core/Renderer.js:692-719`) — these need a **simplified, chunkier variant**; the 1.6 stroke will not survive at this size |

> **Ask:** for group 2 (node title-bar controls) deliver a second, 16×16 variant with
> ~2px stroke and no fine detail. Everything else can be single-variant 24×24.

---

## 2. Node category icons — 12 total (highest priority)

These drive the radial node-creation menu. **The current sprite is out of sync with the
node registry.** Canonical list is `NodeCategories` in `src/data/nodes/NodeTypes.js:10-22`.

### 2a. Keep as-is (8) — already drawn, no work needed
`icon-input`, `icon-output`, `icon-math`, `icon-vector`, `icon-transform`,
`icon-utility`, `icon-blend`, `icon-texture`

### 2b. Missing — must be drawn (4)

| Sprite id | Category | Meaning | Direction |
| --- | --- | --- | --- |
| `icon-pattern` | Pattern | Gradients, shapes, procedural patterns | Repeating geometric motif — e.g. checker/tile grid or concentric rings |
| `icon-noise` | Noise | Perlin, Simplex, Voronoi | Irregular cellular/organic field — Voronoi cells or a scattered-dot cloud |
| `icon-color` | Color | Color ops, HSV, palettes | Overlapping color discs or a gradient ramp bar (monochrome-safe: use stroke density, not hue) |
| `icon-compute` | Compute | GPU compute nodes | Grid of dispatch cells / chip motif. Currently falls back to a *text label* (`RadialMenu.js:773`) — the only category without a glyph |

### 2c. Stale — in the sprite but not real categories (4)
`icon-simulation`, `icon-generators`, `icon-effects`, `icon-modifiers`

These render for nothing today. Design agent should treat them as **available for
reuse/retirement**, not as a spec to match. `icon-simulation` may be worth keeping as a
starting point for `icon-compute`.

---

## 3. Node title-bar controls — 5 (needs the 16×16 chunky variant)

Currently drawn as raw text glyphs on the canvas at ~10px, `src/core/Renderer.js:692-719`.

| Sprite id | Meaning | Currently |
| --- | --- | --- |
| `icon-node-bypass` | Bypass/disable node (amber when active) | Text `"X"` |
| `icon-node-preview-on` | Node preview enabled | Text `"•"` |
| `icon-node-preview-off` | Node preview disabled | Text `"○"` |
| `icon-node-size` | Cycle preview size S→M→L | Text `"S"/"M"/"L"` |
| `icon-node-error` | Node failed to compile | *(none — no affordance today)* |

---

## 4. Menu bar — 44

Structure from `editor/index.html:217-425`. All items are text-only today; icons go to the
left of the label in dropdowns.

**File (10):** `icon-new-project`, `icon-open-project`, `icon-save`, `icon-save-as`,
`icon-file-manager`, `icon-export`, `icon-publish-image`, `icon-publish-animation`,
`icon-backups`, `icon-exit`

**Edit (8):** `icon-undo` *(replaces `&#8634;`)*, `icon-redo` *(replaces `&#8635;`)*,
`icon-cut`, `icon-copy`, `icon-paste`, `icon-delete`, `icon-rebuild`, `icon-preferences`

**View (13):** `icon-panel-params`, `icon-panel-preview`, `icon-viewport-3d`,
`icon-zoom-in`, `icon-zoom-out`, `icon-zoom-reset`, `icon-grid`, `icon-snap`,
`icon-preview-export-settings`, `icon-console`, `icon-timeline`, `icon-vj-control`,
`icon-second-monitor`

**Node (6):** `icon-node-create`, `icon-node-delete`, `icon-node-duplicate`,
`icon-pins-connect`, `icon-pins-disconnect`, `icon-node-settings`

**Tools (5):** `icon-script-editor`, `icon-shader-compiler`, `icon-glsl-utilities`,
`icon-audio-settings`, `icon-midi-settings`

**Window (5):** `icon-layout-default`, `icon-layout-custom`, `icon-layout-minimal`,
`icon-floating-windows`, `icon-reset-layout`

**Help (4):** `icon-documentation`, `icon-shortcuts`, `icon-welcome`, `icon-about`

**Chevrons (2):** `icon-chevron-down` *(replaces `▾`, 9 uses)*, `icon-chevron-right`
*(replaces `▸`, 9 uses)*

---

## 5. Window & panel chrome — 7

Every floating panel hand-rolls these. `×` alone appears in `VJControlPanel.js:86`,
`FileManager.js:49`, `ParameterBindingMenu.js:359`, `ComputeProfilerOverlay.js:92`.

`icon-close` *(replaces `×`)*, `icon-expand` *(replaces `+`, `ComputeProfilerOverlay.js:73`)*,
`icon-collapse` *(replaces `−`, `:381`)*, `icon-minimize`, `icon-maximize`,
`icon-drag-handle`, `icon-resize-grip`

---

## 6. Transport & timeline — 8

`TimelinePanel.js:76-78`, `VJControlPanel.js:259-262`.

| Sprite id | Currently |
| --- | --- |
| `icon-play` | `▶` |
| `icon-pause` | `⏸` |
| `icon-stop` | `■` |
| `icon-loop` | `⟲` |
| `icon-skip-prev` | `⏮` |
| `icon-skip-next` | `⏭` |
| `icon-record` | *(none)* |
| `icon-frames-vs-seconds` | text toggle `TimelinePanel.js:150` |

---

## 7. VJ control panel — 11

`VJControlPanel.js:81-330`. Emoji-heavy today; this is the single worst surface.

| Sprite id | Currently |
| --- | --- |
| `icon-vj` | `🎭` (panel title) |
| `icon-scenes` | `🎬` (tab) |
| `icon-presets` | `⚡` (tab) |
| `icon-playlist` | `📋` (tab) |
| `icon-capture` | `📸` |
| `icon-add` | `➕` |
| `icon-move-up` | `▲` |
| `icon-move-down` | `▼` |
| `icon-tap-tempo` | `👆` |
| `icon-beat` | `○○○○` beat indicator, `:337` |
| `icon-transition` | *(none — "Transition" label only)* |

---

## 8. File manager — 12

`FileManager.js:44-63`, `:661`.

| Sprite id | Currently |
| --- | --- |
| `icon-folder` | `📁` |
| `icon-folder-new` | text "New Folder" |
| `icon-file` | `📄` |
| `icon-file-image` | `🖼` |
| `icon-file-shader` | *(none — for `.wgsl`/`.glsl`)* |
| `icon-save-disk` | `💾` |
| `icon-refresh` | `↻` |
| `icon-upload` | `⬆` |
| `icon-download` | *(none)* |
| `icon-trash` | `🗑` |
| `icon-user` | text "Logged in as…" `:566` |
| `icon-cloud-off` | text "Cloud file manager unavailable" `:542` |

---

## 9. Parameter panel & binding — 14

`ParameterPanel.js`, `ParameterBindingMenu.js`, `src/ui/components/*`.

`icon-link` *(replaces `🔗`, `ParameterBindingMenu.js:510`)*, `icon-unlink`,
`icon-expression` *(replaces `∞`)*, `icon-copy-value` *(replaces `📋`)*, `icon-paste-value`,
`icon-reset-default`, `icon-attach` *(replaces `📎`)*, `icon-search` *(replaces `🔍`)*,
`icon-midi-learn` *(replaces `🎹`)*, `icon-audio-bind`, `icon-lock-param`,
`icon-color-swatch`, `icon-gradient-stops`, `icon-code-edit`

*(the last three back the `ColorInputHandler`, `ColorStopInputHandler`, and
`GLSLCodeInputHandler`/`WGSLCodeInputHandler` components)*

---

## 10. Status & feedback — 6

`StatusManager.js:43-48` defines exactly four states with colors but no glyphs.
`✅`(39×), `✓`(36×), `❌`(32×), `⚠`(22×), `✗`(18×) are scattered across the codebase.

`icon-status-info`, `icon-status-success`, `icon-status-warning`, `icon-status-error`,
`icon-loading` *(spinner-ready: design as a single arc for CSS rotation)*, `icon-compiling`

> `⚠️` also drives the device-unsupported overlay, `editor/index.html:203`.

---

## 11. Preview / viewport / GPU — 11

`FloatingGPUPreview.js`, `ViewportPanel.js`, `exportRender.js`, `ComputeProfilerOverlay.js`.

`icon-preview-eye`, `icon-fullscreen-enter`, `icon-fullscreen-exit`, `icon-aspect-ratio`,
`icon-resolution`, `icon-camera-fov` *(`ViewportPanel.js:238`)*, `icon-shape`
*(`:201`)*, `icon-orbit`, `icon-reset-view`, `icon-render-export`,
`icon-profiler` *(replaces `⚡`, `ComputeProfilerOverlay.js`)*

---

## 12. Graph canvas tools — 9

No toolbar exists yet; these are for one. `src/core/EventHandler.js`, `src/core/autoConnect.js`.

`icon-tool-select`, `icon-tool-pan`, `icon-tool-box-select`, `icon-fit-to-view`,
`icon-auto-layout`, `icon-wire` *(replaces `→`, 60 uses in connection code)*,
`icon-wire-cut`, `icon-group-frame`, `icon-comment`

---

## 13. Audio & MIDI — 7

`src/audio/*`, `src/midi/*`, `AudioSettingsPanel.js`, `MIDISettingsPanel.js`.

`icon-audio-input`, `icon-waveform`, `icon-spectrum`, `icon-envelope`, `icon-bpm`,
`icon-midi-port`, `icon-mute`

---

## Totals

| Group | Count |
| --- | --- |
| 2. Node categories (4 new + 8 existing) | 4 new |
| 3. Node title-bar controls *(+16px variant)* | 5 |
| 4. Menu bar | 44 |
| 5. Window chrome | 7 |
| 6. Transport & timeline | 8 |
| 7. VJ panel | 11 |
| 8. File manager | 12 |
| 9. Parameter panel & binding | 14 |
| 10. Status & feedback | 6 |
| 11. Preview / viewport / GPU | 11 |
| 12. Graph canvas tools | 9 |
| 13. Audio & MIDI | 7 |
| **Total new icons** | **138** |

### Suggested phasing

1. **Phase 1 (12)** — the 4 missing categories + 5 node title-bar controls + 3 chrome
   (`close`, `expand`, `collapse`). These fix actual gaps: `Compute` has no glyph, and node
   controls are unreadable text glyphs.
2. **Phase 2 (37)** — every surface that currently renders an emoji: VJ panel, file
   manager, transport, status. Emoji render inconsistently across platforms and ignore theme color.
3. **Phase 3 (89)** — menu bar, parameter panel, viewport, canvas tools, audio/MIDI.

### Out of scope

Brand assets already exist and are not part of this request: `app-icon.png`,
`favicon.ico`, `assets/logo.png`, `src/assets/logo.png`.
