# Plugin / Node-Creation API — Design

Status: **proposal** (no implementation yet)
Audience goal: **third-party authors** can ship custom nodes without forking the repo.

## 1. Why

Adding a single node today touches three unrelated places, all keyed by the
same `kind` string with nothing keeping them in sync:

| Concern | Where it lives now | Aggregated by |
|---------|--------------------|---------------|
| **Definition** (label, category, pins, params) | `src/data/nodes/*.js` | manual object spread in `src/data/NodeDefs.js` (`NodeDefs = { ...InputNodes, ... }`) |
| **Codegen** (WGSL emission) | a `case` in a `compile()` switch in `src/codegen/compilers/*.js` | a hardcoded `if (this.compilers.X.handles(kind))` chain in `src/codegen/processors/NodeCompiler.js` + matching hardcoded imports |
| **Preview** (node thumbnail) | a renderer module | `RendererRegistry.register(nodeType, renderer)` in `src/core/preview/RendererRegistry.js` |

Observations that shape the design:

- The **data layer** is already semi-declarative — `src/data/nodes/NodeTypes.js`
  exposes `createNodeDef` / `createPin` / `createParam` and `validateNodeDef`.
- The **preview layer** already has a real registration API (`register` /
  `registerMultiple` / `unregister`).
- The **codegen layer** is the outlier: it is *not* extensible without editing
  core dispatch (`NodeCompiler.js`) and adding an import. An unknown `kind`
  silently falls through to `vec3<f32>(0.0)` (`NodeCompiler.js`, final `else`).

So most of the machinery exists; the work is to (a) make codegen dispatch
data-driven, (b) put a single registration facade in front of all three layers,
and (c) define a safe boundary for code that did not ship in this repo.

## 2. The target API

A node is registered as one object that co-locates all three concerns:

```js
import { registerNode } from 'glsl-node-editor/plugin-api';

registerNode({
  kind: 'MyThing',            // unique id, namespaced for plugins (see §6)
  label: 'My Thing',
  category: 'Math',           // must be an existing NodeCategories value
  pinsIn:  [{ label: 'a', type: 'f32' }],
  pinsOut: [{ label: 'out', type: 'f32' }],
  params:  [{ name: 'k', type: 'float', default: 1, label: 'K' }],

  // Codegen: same signature the existing compilers already receive.
  compile(node, getInput, getParam) {
    const a = getInput(0, 'f32', '0.0');
    const k = getParam('k', 1.0);
    return {
      line: `let node_${node.id} = ${a} * ${k};`,
      outputType: 'f32',
    };
  },

  // Optional. Falls back to a generic renderer if omitted.
  preview: myRenderer,
});
```

`registerNode` is the *only* surface third parties touch. It writes the
definition into the node registry, the `compile` fn into the codegen map, and
`preview` into `RendererRegistry`. It validates eagerly and throws on a
malformed registration instead of letting a bad node fail later as a silent
`vec3(0.0)`.

Companion exports: `unregisterNode(kind)`, `getNodeDef(kind)`,
`listNodes({ category })`, and the existing `createPin` / `createParam`
helpers re-exported for convenience.

## 3. Phase 1 — Make codegen dispatch data-driven

**Goal:** a new `kind` no longer requires editing `NodeCompiler.js`.

- Introduce a codegen registry: `Map<kind, compileFn>`.
- Each existing compiler module registers the kinds it owns into the map
  (it already lists them in `handles()` — that list becomes the registration).
- `NodeCompiler.compileNode` replaces the `if/else handles()` ladder with a
  single `const fn = registry.get(kind)` lookup; the final fallback
  (`vec3<f32>(0.0)`) is preserved for genuinely unknown kinds.
- The bypass path, ComputeFieldMapper special-case, and the `getInput` /
  `getParam` closures are unchanged — only dispatch changes.

**Risk:** low. Behavior is identical; this is a mechanical refactor.
**Tests:** existing codegen/compile tests must pass unchanged; add one test
that a kind registered at runtime is reachable by the compiler.

This phase is the keystone — without it, no facade can fully hide the codegen
layer from plugin authors.

## 4. Phase 2 — The `registerNode` facade

**Goal:** one call wires up all three layers, with validation.

- Implement `registerNode` to:
  1. validate the def (`validateNodeDef` + pin/param checks from `NodeTypes.js`,
     plus: unknown category rejected, duplicate `kind` rejected unless
     `{ override: true }`),
  2. insert the def into the node registry that `NodeDefs` / menu / `makeNode`
     read from,
  3. insert `compile` into the Phase-1 codegen map,
  4. if `preview` is present, call `RendererRegistry.register(kind, preview)`.
- Make `NodeDefs` a **view over the registry** rather than a static spread, so
  registrations (including late/plugin ones) appear everywhere the def is read:
  radial menu, `makeNode`, save/load, validation.
- Define ordering/teardown: `unregisterNode` reverses all three insertions so a
  plugin can be hot-unloaded cleanly.

**Risk:** medium — `NodeDefs` is read in many places; the view must preserve
iteration order and shape. Cover with the existing node-enumeration tests.

## 5. Phase 3 — Migrate built-ins onto the facade

**Goal:** prove the API against the ~100 shipping nodes and delete the manual
aggregation points.

- Migrate one **category at a time** (Input → Math → … ), converting each
  `data/nodes/*.js` def + matching `compilers/*.js` case + preview registration
  into `registerNode` calls.
- After each category: run the full suite; the node should be indistinguishable
  from before in menu, codegen output, and preview.
- When the last category is migrated, remove the static spread in `NodeDefs.js`
  and the hardcoded compiler imports in `NodeCompiler.js`.

**Risk:** medium but incremental and individually revertable.
This phase is internal-only and can land before the public boundary (§6) is
finalized.

## 6. Phase 4 — The third-party plugin boundary

This is where "third party" becomes real. Everything above is in-process API;
this phase defines how non-repo code reaches it and what it is allowed to do.

### 6.1 Packaging & discovery
- A plugin is an ES module exposing `export function register(api) { ... }`
  where `api` is the §2 surface (`registerNode`, helpers). Plugins never import
  app internals directly — only the passed `api` — so the internal layout can
  change without breaking them.
- A **manifest** (`plugin.json`: name, version, namespace, entry, API-version
  range) declares the plugin. A loader discovers manifests (bundled dir and/or
  user-imported), checks the API-version range, then calls `register(api)`.
- **Namespacing:** plugin `kind`s are auto-prefixed (`namespace/MyThing`) so two
  plugins cannot collide with each other or with built-ins. Categories: plugins
  may use existing categories or declare a new one (shown in the menu under a
  "Plugins" group).

### 6.2 Trust model (the hard part)
A plugin supplies **codegen** — JS that returns WGSL strings that get spliced
into the live shader. That is arbitrary code execution plus arbitrary shader
text. Options, to be chosen explicitly:

- **Trusted/manual install (ship first):** user explicitly imports a plugin
  file; it runs with full page privileges, same as any script they add. Simple,
  honest, no false sense of safety. Pair with a clear install-time warning.
- **Declarative-only codegen (safer, more limited):** instead of a JS `compile`
  fn, a plugin provides a constrained template (`outputType` + a WGSL snippet
  with `${input0}` / `${param.k}` placeholders) that the host expands. No plugin
  JS runs; the host controls all interpolation. Covers the large majority of
  nodes (the built-ins are mostly one-liners) and is the recommended default for
  an open marketplace.
- **Worker/sandbox for JS compile (future):** run JS `compile` in a Worker with
  no DOM/network. Heavier; revisit only if declarative templates prove too
  limiting.

Recommendation: support **declarative templates as the public default**, and
allow JS `compile` only for trusted/manually-installed plugins behind an
explicit opt-in. Validate every plugin-produced WGSL string (length, charset,
no host-uniform spoofing) before it enters the shader regardless of path.

### 6.3 Validation, errors, persistence
- Registration validates eagerly (§4); a failing plugin is skipped with a
  surfaced error, never a half-registered node.
- A saved graph that references a `kind` whose plugin is absent must
  **round-trip** — preserve the node data and show a clear "missing plugin"
  placeholder rather than dropping the node or crashing load.
- API-version negotiation: the host advertises a version; the loader refuses
  plugins outside the supported range with a readable message.

### 6.4 Docs
- Replace the FAQ admission ("custom nodes require modifying the source code",
  `docs/faq.md`, `docs/faq-web.md`) with a "Writing a plugin" guide once Phase 4
  ships, including the declarative-template path and at least one worked example.

## 7. Sequencing summary

| Phase | Deliverable | Audience | Risk |
|-------|-------------|----------|------|
| 1 | Codegen dispatch → registry map | internal | low |
| 2 | `registerNode` facade + validation | internal | medium |
| 3 | Built-ins migrated; manual aggregation deleted | internal | medium (incremental) |
| 4 | Manifest/loader, namespacing, trust model, plugin docs | third-party | high (design-led) |

Phases 1–3 are safe to land independently and immediately reduce the cost of
adding built-in nodes. Phase 4 is gated on the trust-model decision in §6.2 —
that choice (declarative-default vs. trusted-JS) should be settled before any
loader code is written.
