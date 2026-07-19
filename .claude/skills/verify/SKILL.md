---
name: verify
description: Drive the GLSL node editor end-to-end in this repo (WebGPU app) and observe changes at the running-app surface.
---

# Verifying changes in the GLSL node editor

## Launch

```bash
npm run dev -- --port 5199 --strictPort   # Vite; serve in background
```

The editor lives at **`/editor/index.html`** — the root `/` is a landing page
that never bootstraps the editor (`window.editor` stays undefined there).

## Driving it (headless Chromium + WebGPU)

Use `playwright-core` (install in the scratchpad, not the repo) with the
pre-installed browser:

```js
chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader',
         '--enable-features=Vulkan', '--no-sandbox']
})
```

Wait for `window.editor && window.rebuild`, then build graphs in-page:

```js
const { makeNode } = await import('/src/data/NodeDefs.js');
const n = makeNode('ComputeNoise', 100, 100);   // node.inputs[i] = sourceNode.id
window.editor.graph.nodes.push(n);
await window.rebuild();                          // updateShaderFromGraph
```

(`window.editor.createNode` returns null headless — `window.NodeDefs` isn't
populated; import `makeNode` directly instead.)

## Environment gotchas (this container, SwiftShader WebGPU)

- **Canvas presentation crashes the device.** Any render pass that targets
  `context.getCurrentTexture()` kills the GPUDevice with
  "A valid external Instance reference no longer exists" — headless or headed
  under Xvfb, MSAA or not. Verified standalone; not an app bug. Workaround:
  `page.addInitScript` that stubs `GPUCanvasContext.prototype.configure/
  getCurrentTexture` to return device-created offscreen textures
  (`RENDER_ATTACHMENT | COPY_SRC`). Everything else (compute, readback, render
  passes) then works, and you can `copyTextureToBuffer` the shimmed texture to
  assert on rasterized pixels.
- **Readback latency is extreme**: one `mapAsync` round-trip through the app's
  loaded main thread can take 10–50 s here (milliseconds on real hardware).
  Give async pipelines long windows and poll, or you'll see stale state and
  conclude things are broken.
- Watch `device.lost` and `uncapturederror` via an init-script wrap of
  `GPUAdapter.prototype.requestDevice` — WebGPU fails soft and the app will
  happily keep "rendering" on a dead device.

## Useful in-page globals

`window.gpuRenderer` (`.device`), `window.computeExecutor`
(`.nodeOutputs`, `.computeManagers`), `window.fieldMapperIntegration`,
`window.sceneRenderer3D`, `window.viewportPanel`, `window.viewport3D`,
`window.systemIntegration.scene`, `window.addTestCube()` (3D raster sanity
check), `window.latestGeneratedWGSL`.

## Tests / lint

`npm test` (vitest, happy-dom — no WebGPU, keep GPU-free units testable),
`npm run lint` (repo has ~800 pre-existing warnings; only errors gate).
