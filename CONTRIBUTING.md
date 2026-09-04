# Contributing to Rhizomium

Thanks for looking. The engine is where help is most valuable — shader codegen,
the WebGPU renderer, and the graph model — but fixes, tests, docs and new nodes
are all welcome.

## Setup

```bash
git clone https://github.com/Amirashkan/glsl-node-editor
cd glsl-node-editor
npm install
npm run dev
```

Requires Node 20+ and a WebGPU browser (Chrome/Edge 113+). That is everything.
The Python servers are optional bridges for OSC, NDI and the native viewer —
you do not need them, and CI does not run them.

Before opening a pull request:

```bash
npm run lint
npm test
npm run build:web
```

All three must pass. CI runs them on Node 20 and 22.

## Read this first

**[ARCHITECTURE.md](ARCHITECTURE.md)** traces one signal from a node on the
canvas through codegen and the renderer to pixels, naming the file that owns
each step. It is short and it will save you a lot of grep.

The one thing to internalise before changing anything: there are two paths, and
they have very different costs.

- **Recompile** — the graph changed shape, so `buildWGSL()` runs and a new WGSL
  module is created.
- **Uniform write** — only a value changed, so a number is written into a
  buffer and nothing is recompiled.

Dragging a slider must take the second path. If a change makes it take the
first, the editor drops frames and the change is wrong however clean it looks.

## Adding a node

Almost always two files, both named after the category:

1. `src/data/nodes/<Category>Nodes.js` — the definition. Label, category, pin
   counts and names, parameters with types and defaults. Copy a neighbour.
2. `src/codegen/compilers/<Category>Nodes.js` — the emitter. Add the kind to
   `handles()`, add a branch to `compile()` that returns WGSL.

If your output type depends on the input types (`type: "dynamic"`), check
`src/codegen/processors/TypeConverter.js` handles your combinations.

Then add a test. A test that compiles a small graph and asserts on the
generated WGSL is cheap and catches most regressions.

A node that needs its own compute pass is a larger job — start from
`src/gpu/ComputeNodeBase.js` and [docs/compute-nodes.md](docs/compute-nodes.md).

## Tests

Vitest, ~222 files under `tests/`.

```bash
npm test                  # once
npm run test:watch
npm run test:coverage
npm run test:performance  # mocked benchmarks
```

WebGPU is not available in the test environment, so GPU-facing tests use mocks.
Anything that genuinely needs an adapter has to be verified by hand in a
browser — say so in the pull request, and say what you checked.

## Performance

This is a real-time tool and frame rate is a correctness property, not a nice
to have.

- **Target 60 fps.** Frame budget is 16.67 ms.
- Throttling intervals should be 16.67 ms, not 33.33 ms. If you find code
  throttled to 30 fps, that is a bug, not a decision.
- Do not add a per-subsystem `requestAnimationFrame` loop. There is one shared
  RAF (`src/core/UnifiedRAFManager.js`) and redraws are scheduled through
  `src/core/RedrawScheduler.js`.
- Call `Editor.markDirty(reason, region)` with a real `reason` string — it
  drives throttling decisions and shows up in the profiler.

Background: [docs/REDRAW_THROTTLING_POLICY.md](docs/REDRAW_THROTTLING_POLICY.md),
[docs/frame-rate.md](docs/frame-rate.md).

## Security-sensitive areas

Two rules that are not style preferences:

- **Never introduce `eval()` or `new Function()`.** The editor opens `.rz`
  patches written on other people's machines and treats them as untrusted.
  Expressions go through the AST interpreter in
  `src/utils/UnifiedExpressionSystem.js`, and `editor/index.html` sets a CSP
  without `unsafe-eval` so a shortcut fails loudly instead of quietly reopening
  the hole.
- **Do not weaken the grant check.** `api/_lib/grant.js` is the boundary that
  makes this repository safe to publish. Tier values in the browser are for
  deciding what to *draw*, never what to *do*.

Found a vulnerability? [SECURITY.md](SECURITY.md) — please do not open a public
issue.

## Pull requests

- One change per pull request. A drive-by refactor in the same diff makes the
  actual change hard to review.
- Say what you tested, and how. "Ran the tests" and "dropped the node in and
  watched the preview" are both useful; a screenshot or clip of a visual change
  is better still.
- Match the surrounding code. There is no TypeScript build; it is plain ES
  modules. Comments here tend to explain *why*, not *what* — that is a
  convention worth keeping.
- Unsure whether something is wanted? Open an issue first. That is cheaper than
  writing a patch nobody merges.

CI runs lint, build, unit tests on Node 20 and 22, integration tests and
mocked performance benchmarks.

## Sign your commits off (DCO)

Every commit needs a `Signed-off-by` line:

```bash
git commit -s -m "Your message"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

This is the [Developer Certificate of Origin](https://developercertificate.org/)
— you are certifying that you wrote the patch, or otherwise have the right to
submit it under the AGPL.

It is **not** a copyright assignment. You keep the copyright on what you write.
Rhizomium is also sold under commercial licences ([COMMERCIAL.md](COMMERCIAL.md)),
which means we can only relicense code whose authors have agreed. If that ever
becomes relevant to something you wrote, we will ask you by name, and you may
say no.

Forgot the sign-off? `git commit --amend -s` and force-push your branch.

## Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Short version: be decent.
