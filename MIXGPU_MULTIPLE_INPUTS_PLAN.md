# Plan: Add More Inputs to Nodes Like mixGPU

Status: **PLAN / DESIGN ONLY — no code changed yet.**

Goal: give the user an option to add (and remove) extra input pins on nodes
that blend/combine multiple textures — starting with the GPU **Mix** node
(`ComputeMix`, shown as "mixGPU"), built as a reusable "dynamic inputs"
mechanism so other compute nodes can opt in later.

---

## 1. How inputs work today (findings)

The Mix node is `ComputeMix` in `src/data/nodes/ComputeNodes.js:423`:

```js
ComputeMix: {
  label: "Mix",
  cat: "Utility",
  inputs: 2,                          // <-- fixed count
  pinsIn: ["Input A", "Input B"],     // <-- fixed labels
  pinsOut: ["Texture"],
  params: [ mode, amount, opacity ],
  ...
}
```

The input **count** and **labels** are read from the *static* node definition
(`NodeDefs[kind]`) in several places — there is currently **no per-node
instance override**. Key read sites:

| Concern | File / line | Reads |
|---|---|---|
| Node height / row count | `src/core/Renderer.js:1187` | `def.inputs` |
| Node width (label widths) | `src/core/Renderer.js:1220` | loops `inCount` over `pinsIn` |
| Pin label text | `src/core/Renderer.js:1172` (`_inputLabel`) | `pinsIn[i]` |
| Pin positions (render) | `src/core/Renderer.js:1243` | `def.inputs` |
| Pin hit-testing (connections) | `src/core/ConnectionManager.js:387` | `nodeDef.inputs` |
| Pin geometry (shared) | `src/core/pinLayout.js` | takes `inCount` as a param ✅ already generic |

Connections are stored per node as `node.inputs[pinIndex] = sourceNodeId`
(`src/core/ConnectionManager.js:142`). The array is already dynamic-length;
only the *count of pins drawn/hit-tested* is fixed by the static def.

### GPU side (the hard part)

The Mix node's two inputs are wired through a **hardcoded two-texture path**
that piggybacks on the feedback machinery:

- `src/codegen/compilers/ComputeNodes.js:135` — `ComputeMix` is in
  `feedbackNodes`, so it gets `supportsFeedback = true` purely to obtain a
  second texture binding.
- `generateMixShader()` (`ComputeNodes.js:2646`) declares exactly:
  - `@binding(2) inputTextureA`
  - `@binding(3) texSampler`
  - `@binding(4) inputTextureB`
  and blends `colorA`/`colorB` once.
- `src/gpu/ComputeShaderManager.js`:
  - bind-group **layout** (`:378-440`) hardcodes binding 2 = input,
    binding 3 = sampler, binding 4 = "feedback OR second input".
  - `recreateBindGroup()` (`:647-652`) special-cases `ComputeMix` to put the
    second input (`warpFieldTexture`) at binding 4.
  - second input is fed via `setWarpFieldTexture()` (reused, not renamed).
- `src/gpu/ComputeExecutor.js:592-600` and `:899-909` — special-case
  `ComputeMix`, taking `node.inputs[1]` and calling `setWarpFieldTexture`.

So today the second input is literally "the feedback slot, reused." Adding
inputs C, D, … means introducing **new bindings (5, 6, …)** and a real
multi-input path instead of the feedback hack.

---

## 2. Design

### 2.1 Data model — per-node input count

- Add an optional def field marking a node as expandable:
  ```js
  ComputeMix: {
    inputs: 2,
    dynamicInputs: { min: 2, max: 8, baseLabel: "Input" },
    ...
  }
  ```
- Store the live count on the **node instance** as `node.inputCount`
  (defaults to `def.inputs` when absent). This already serializes with the
  node via save/load and undo (they persist whole node objects).

### 2.2 New helper module — `src/data/nodeInputs.js`

Single source of truth so every read site agrees:

```js
getInputCount(node)        // node.inputCount ?? def.inputs ?? 0
getInputLabel(node, i)     // pinsIn[i] || `${baseLabel} ${letter(i)}`  → "Input C"
getDynamicSpec(node)       // def.dynamicInputs | null
canAddInput(node)          // spec && count < spec.max
canRemoveInput(node)       // spec && count > spec.min
addNodeInput(node)         // count++, return new index
removeNodeInput(node)      // detach node.inputs[last], count--
```

### 2.3 Wire the helper into render + hit-test

Replace the static reads with `getInputCount(node)` / `getInputLabel(node,i)`:

- `Renderer.js`: `_ensureNodeSize`, `_minNodeWidth`, `_getNodePinPositions`,
  `_inputLabel`.
- `ConnectionManager.js:387`: `getInputCount(n)`.

`pinLayout.js` already takes `inCount` as an argument — no change needed; the
node simply grows by `ROW_H` per extra row automatically.

### 2.4 UI — context-menu add/remove

`src/ui/MenuManager.js` `showNodeMenu()` (`:131`) already builds the
right-click node menu (Duplicate / Delete). Add, only when
`getDynamicSpec(node)` is set:

- **"Add Input"** — `addNodeInput(node)`, then recompile + redraw.
- **"Remove Input"** — disabled at `min`; detaches the last pin's connection
  first, then `removeNodeInput(node)`, recompile + redraw.

Recompile/redraw hook: the same path used after add/delete node
(`editor`/graph dirty → rebuild WGSL → `requestRedraw`). Confirm exact call
during implementation (likely `window.editor.markDirty()` + connection
manager refresh).

> Alternative considered: a small "＋ / －" chip in the node header. Deferred —
> the context menu reuses existing menu plumbing and is lower-risk for a first
> cut.

### 2.5 GPU — generalize to N inputs

This is the core work. Target: inputs at bindings **2, 4, 5, 6, …**
(keep 2 = A and 4 = B for backward-compat; append C+ at 5,6,…). Sampler stays
at binding 3.

1. **Shader (`generateMixShader`)** — take `inputCount`, emit one
   `texture_2d<f32>` binding per input, sample each, and **fold** the blend:
   ```
   acc = colorA
   acc = blend(acc, colorB, mode)
   acc = blend(acc, colorC, mode)   // for each extra input
   ...
   apply amount + opacity at the end
   ```
   Skip-on-unbound: extra inputs default to a transparent fallback so an
   unconnected pin is a no-op (don't darken/zero the result).

2. **`ComputeShaderManager`**:
   - Stop abusing `supportsFeedback` for Mix's second input. Add an explicit
     `inputCount` (passed through `initialize`) and an `extraInputTextures[]`
     array with `setExtraInputTexture(i, tex)`.
   - Bind-group **layout** + `recreateBindGroup()`: emit input-texture entries
     for bindings 2, 4, 5 … `4 + (inputCount-2)` based on `inputCount`.
   - Mark `_bindGroupNeedsUpdate` when any extra texture ref changes.

3. **Compiler registration** (`ComputeNodes.js:129`): pass `inputCount` into
   the registry entry and into shader generation; remove `ComputeMix` from the
   `feedbackNodes` hack (it no longer needs the feedback slot).

4. **`ComputeExecutor`**: replace the `node.inputs[1]`-only special case with a
   loop over `node.inputs[1..inputCount-1]` → `setExtraInputTexture(i-1, tex)`.
   `node.inputs[0]` still → `setInputTexture`.

### 2.6 Persistence / undo

- `node.inputCount` rides along with existing whole-node serialization — verify
  in `src/core/SaveLoadManager.js` and `src/core/UndoManager.js` that no
  field whitelist drops it (spot-check shows nodes are saved wholesale).
- Removing an input must also clear the dangling connection record on the
  source side; reuse `ConnectionManager`'s existing disconnect path.

---

## 3. Touch list (for the implementation pass)

| File | Change |
|---|---|
| `src/data/nodes/ComputeNodes.js` | add `dynamicInputs` to `ComputeMix` |
| `src/data/nodeInputs.js` | **new** helper module |
| `src/core/Renderer.js` | use helper for count + labels (4 sites) |
| `src/core/ConnectionManager.js` | use helper for pin count + disconnect-on-remove |
| `src/ui/MenuManager.js` | Add/Remove Input menu items |
| `src/codegen/compilers/ComputeNodes.js` | N-input `generateMixShader`, pass `inputCount`, drop Mix from feedback hack |
| `src/gpu/ComputeShaderManager.js` | `inputCount`, `extraInputTextures`, dynamic bindings |
| `src/gpu/ComputeExecutor.js` | loop-wire all extra inputs |
| `tests/` | extend `computeUniformLayout` / pin-layout / a Mix-shader test |

## 4. Risks / open questions

1. **Bind-group correctness** is the main risk — layout and bind-group entries
   must match the generated WGSL bindings exactly or the pipeline fails to
   create. Keep A=2 / B=4 to avoid disturbing existing graphs; only append.
2. **Blend semantics for N>2**: proposed sequential fold (A op B op C…). Worth
   a quick confirm — alternative is "all blended onto A" with per-input amount.
   Going with the simple fold unless told otherwise.
3. **Generalizing beyond Mix**: `ComputeWarp` also uses the second-input slot,
   but its second input is a *warp field* (different semantics), so it stays
   2-input. The `dynamicInputs` flag is opt-in per node, so nothing else
   changes behavior.
4. **Recompile trigger** from the menu needs the exact editor dirty/rebuild
   call — to be confirmed against `Editor.js` during implementation.

## 5. Suggested implementation order

1. `nodeInputs.js` helper + `dynamicInputs` on `ComputeMix`.
2. Render + hit-test read sites (pins grow/shrink; no GPU yet).
3. Context-menu Add/Remove + recompile/redraw.
4. GPU: shader N-input fold → `ComputeShaderManager` bindings →
   `ComputeExecutor` wiring.
5. Tests + manual verify in the running editor.

Each step is independently testable; steps 1–3 are visible in the UI even
before the GPU path lands (extra pins draw and connect; the shader would just
ignore inputs past B until step 4).
