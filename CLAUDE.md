# Rhizomium — working notes for Claude Code

A WebGPU node editor for real-time generative visuals. Read
[ARCHITECTURE.md](ARCHITECTURE.md) before changing anything in the graph,
codegen or renderer — it traces one signal from a node to pixels and names the
file that owns each step.

---

## Branch workflow — read this before your first commit

**`develop` is the permanent integration branch. Everything lands there.**
`main` is release-only and moves only when Ashkan asks for a release.

A Claude Code session is handed a throwaway branch name (`claude/<random>`).
That branch is a *workspace*, not a destination: nobody pulls it, a different
one appears next session, and this repository has already accumulated 400+ of
them (see `scripts/audit-branches.sh`). Ashkan pulls `develop` and only
`develop` — that is his test place. If your work is not on `develop`, it does
not exist to him.

### Start of every session — before writing any code

```bash
git fetch origin develop
git merge --no-edit origin/develop
```

Your session branch was cut from `main`, which is behind `develop` by however
much shipped since the last release. Skip this step and you are building on
stale code and will hand back a conflict.

If `origin/develop` does not exist yet, create it from `main` and push it.

### End of every session — after the checks below pass

```bash
npm run lint && npm test && npm run build:web    # all three, no exceptions

git push -u origin <session-branch>              # the harness requires this
git fetch origin develop
git checkout -B develop origin/develop
git merge --no-edit <session-branch>
git push -u origin develop
git checkout <session-branch>                    # leave the session where it started
```

**Pushing `develop` directly is pre-authorised** — Ashkan granted standing
permission on 2026-09-17. Do not open a pull request for it, and do not ask
again. Merge, push, and tell him in one line what landed.

**Never push to `main`.** A release is a separate, explicit request: only then
does `develop` merge into `main`.

Leave the session branch pushed as well. It is the harness's record of the
session, and it costs nothing once the work is already on `develop`.

### If the work is not finished

Push the session branch, say so plainly, and leave `develop` alone —
`develop` is expected to build and run. Half-finished work waits on its own
branch until the next session merges `origin/develop` and completes it.

---

## Checks

```bash
npm run lint         # eslint
npm test             # vitest, ~222 test files
npm run build:web    # vite build
```

CI (`.github/workflows/test.yml`) runs these plus integration, performance and
Rust/Tauri checks on every push to `main` and `develop`, and on every pull
request. A push to `develop` is a push to a branch CI watches — a red `develop`
is a broken test place, so run the three commands locally first.

## Seeing a change actually work

The `verify` skill (`.claude/skills/verify/SKILL.md`) drives the editor
end-to-end in headless Chromium with a software WebGPU adapter, and documents
this container's gotchas (canvas presentation crashes the device — render to an
offscreen texture instead). Use it when a change needs to be observed in the
running app rather than only under Vitest.

The editor is served at **`/editor/index.html`** — the site root is a landing
page that never bootstraps the editor.

## The one performance rule

There are two paths through the renderer and they cost very different amounts:

- **Recompile** — the graph changed shape, `buildWGSL()` runs, a new WGSL
  module is built.
- **Uniform write** — only a value changed, a number goes into a buffer,
  nothing recompiles.

Dragging a slider must take the second path. A change that moves it to the
first drops frames and is wrong however clean it reads.
