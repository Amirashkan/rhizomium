# Canvas coordinate spaces

Written up after a report that the cursor readout in the status bar "has a
different 0,0 than the canvas". It does — there is more than one canvas, and
they do not share an origin. This is the map of which space is which, who
converts between them, and what was actually wrong.

## The three spaces

| Space | Origin | Units | Who owns it |
| --- | --- | --- | --- |
| **Client** | top-left of the browser window | CSS px | the DOM |
| **Graph (world)** | wherever the graph was panned to | graph units | `src/core/ViewportManager.js` |
| **Output frame** | top-left of the composition | output px | `src/ui/OutputFormat.js` |

Two canvases are stacked in `editor/index.html`, both `position: fixed` and
both starting at `top: 40px` — below the menu bar:

- `#ui-canvas` (z-index 10) — the graph, drawn by `src/core/Renderer.js`.
- `#gpu-canvas` (z-index 0) — the render, which the floating preview
  reparents into its own panel (`src/ui/FloatingGPUPreview.js`), and which
  fullscreen, the VJ master output and the second-monitor path move again.

Because both canvases start 40px down the window, **client y is not canvas y**.
Everything that converts a pointer position subtracts the canvas' own
`getBoundingClientRect()` first; nothing may use `clientX/clientY` raw.

### Client → graph

```js
const rect = canvas.getBoundingClientRect();
viewport.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
// screenToCanvas: (screen - offset) / scale
```

This is the exact inverse of what the renderer paints with
(`ctx.translate(offsetX, offsetY); ctx.scale(scale, scale)` — `Renderer.js:215`),
so a node at world (x, y) is drawn under the pointer that reports (x, y).
`EventHandler._getCanvasPosition` and `StatusBar._graphReadout` both go through
this; `EventHandler` prefers `e.offsetX/offsetY` when the event target *is* the
canvas, which is the same number by definition.

### Client → output frame

The render canvas is fitted to whatever box it currently lives in
(`_fitCanvasToPanel` → `letterboxRect`), and the letterbox bars belong to the
wrapper, not to the canvas. So the canvas' client rect **is** the image, and a
fraction across the rect is that same fraction across the frame:

```js
const rect = gpuCanvas.getBoundingClientRect();
const u = (e.clientX - rect.left) / rect.width;
const v = (e.clientY - rect.top) / rect.height;
const { width, height } = resolveResolution('output');   // the composition size
```

Reported against `"output"` rather than `"preview"`: the preview renders at the
machine's preview quality, which is not the frame the user is composing. `v`
runs top-down, matching the compute shaders, which index
`texCoord / texSize` from `global_invocation_id` (`src/codegen/compilers/ComputeNodes.js`).

## What the report turned out to be

Measured in the running editor (Chromium, SwiftShader, `.claude/skills/verify`):
with the pointer at client (400, 300), the status bar said `x 400 y 260`,
`EventHandler._getCanvasPosition` returned `{x: 400, y: 260}`, and the renderer
transform agreed — the 40px is the menu bar, and every graph-space path already
subtracted it. **Graph space had no origin bug.**

The mismatch was that the readout quoted *graph* space wherever the pointer was,
including over the preview panel and the fullscreen output. Pointing at the
image and being told the node coordinate underneath it reads exactly like a
wrong origin. `StatusBar` now binds both surfaces and each reports its own
space (`out x … y …` over the render, with the frame size and uv in the
tooltip). One listener on `#gpu-canvas` covers floating, docked, fullscreen and
second-monitor, since all of those move the same element.

Covered by `tests/statusBarCursorReadout.test.js`.

## Open finding: the graph canvas is 40px too tall

`Editor.resize()` (`src/core/Editor.js`) sizes `#ui-canvas` to
`window.innerHeight`, while CSS puts its top at `40px` and sizes it
`calc(100vh - 40px)`. The inline style wins, so the canvas hangs 40px below the
window bottom:

```
rect: { top: 40, height: 800 }   in a 800px-tall window
```

Coordinates are unaffected — every conversion measures from the rect — but
anything reasoning about the *visible* area works against a viewport 40px
taller than what can be seen. `ViewportManager.fitToContent()` takes
`window.innerHeight` as its viewport height (it already takes the *width* from
`canvasViewportWidth()`, to clear a docked panel), so fit-to-view centres the
graph about 20px low — more once the 38px status bar is counted too.
`canvasViewportHeight()` in `src/ui/dockLayout.js` has the same value in it and
is currently unused; it is the natural place for the corrected number. Not
fixed here — it is a separate change from the readout.
