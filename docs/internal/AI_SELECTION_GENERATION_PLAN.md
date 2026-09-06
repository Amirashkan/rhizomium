# Plan: generative AI that edits a selection

Status: **NOT IMPLEMENTED.** Design record for the half of "Selection scope" that
did not land with the scope fix.

Related: [`AI_TIER_INTEGRATION.md`](AI_TIER_INTEGRATION.md) §*Scope has to mean
something after the answer comes back too*, which describes what did land.

---

## 1. What was asked for

> the AI tools apparently have no difference in whole graph and selected nodes
> scope. I expect when it's on selection mode, it's able to change and edit the
> existing ones.

Two separate things were wrong under that one sentence.

**The reading and rewriting features.** Fixed. `ai.patch_refactor` in Selection
scope used to send the selection and then import the answer over the whole
canvas, so tidying six nodes of a hundred left a canvas with six nodes on it —
the two scopes did the same thing, and the narrower one was destructive. It now
splices: the selected nodes are replaced, the rest of the patch is untouched,
and the wires crossing the edge are reconnected by id and pin.

**The generative features.** Not fixed, and not fixable by the same move.
`ai.patch_generator` and `ai.node_generator` do not read the canvas at all —
`needsPatch()` returns false for both — so there is nothing for a scope to
narrow. Whichever way the switch is set:

| Feature | What it does with the scope | What it does to the canvas |
|---|---|---|
| `ai.patch_generator` | nothing | replaces the whole canvas from a prompt |
| `ai.node_generator` | nothing | adds one CustomGLSL node at the viewport centre |

Their cards now say so (`AIPanel.scopeNote()`), which is honest but is not the
feature. The feature is: **"change these nodes so that X"** — a prompt *and* a
selection, changing existing nodes rather than writing new ones over them.

## 2. Why it is a new feature, not a flag

The obvious move — pass `patch` to `ai.patch_generator` when the scope is
Selection — does not work, and the reason is worth writing down because it is
the same reason the refactor needed a splice rather than a filter.

`ai.patch_generator` is prompted to build a coherent piece from nothing, and its
answer is validated as a document: `validateGeneratedPatch()` requires an Output
node, and `applyGeneratedPatch()` asks the artist to confirm *"This replaces what
is on the canvas now"*. Every one of those is right for a generator and wrong for
an edit. Handing it a patch would give it a prompt that says "build" and an input
that says "here is something you must not break", which is the shape of a feature
that half-does both.

So: a fourth patch feature, `ai.patch_edit`, sitting between the two that exist.

| | `ai.patch_refactor` | **`ai.patch_edit`** | `ai.patch_generator` |
|---|---|---|---|
| Prompt | no | **yes** | yes |
| Reads the canvas | yes | **yes** | no |
| May change the render | **no** — the whole constraint | **yes** — the point | n/a |
| Answer | the patch | **the selection** | a whole patch |
| Applied by | replace, or splice when scoped | **splice, always** | replace |
| Output node required | when unscoped | **no** | yes |

## 3. What already exists

Most of the substrate landed with the scope fix. This is deliberate — the splice
was built as a general "put this answer where that selection was", not as a
refactor detail.

- **`buildPatchContext(project, { nodeIds })`** — sends the selection plus
  `boundary`, the wires crossing its edge with the outside node named and typed.
  `patchNodeCount` says how large the patch it came out of is.
- **`SELECTION_RULES` in `api/_lib/features.js`** — the paragraph appended to the
  user turn that says the edge is fixed, the ids are fixed, the rest of the patch
  is not the model's to change, and a branch reaching no Output node is the
  normal shape of a selection rather than dead code. Written to be shared by any
  scoped feature, not just the refactor.
- **`describePatch()` / `patchFacts()`** — both render and reason about
  `boundary`, so a scoped call is not told that nothing renders and that its
  externally-fed pins are empty.
- **`validateGeneratedPatch(patch, { requireOutput: false })`** — already takes
  the flag.
- **`planSelectionSplice()` / `spliceSelectionPatch()` in `applyResult.js`** —
  replaces the selection, keeps everything else verbatim, reconnects the crossing
  wires, renames a returned id that collides with a node outside the selection,
  and refuses to cut the artist's wiring to make room for the model's. Pure plan
  first, so a dialog can state the outcome before it happens.

None of that is refactor-specific. An edit feature reuses all of it.

## 4. What is left to build

### 4.1 Backend — `api/_lib/features.js`

A feature entry alongside `ai.patch_refactor`. It writes an answer the same
shape and size, so it takes the same budget shape: `scaleWithPatch: true`,
`maxTokens: 32000`, `reasoningTokens: 8000`.

- **`effort`** — `high`, not the refactor's `medium`. The refactor is medium
  because its constraint ("do not change the render") is what makes it cheap to
  check; an edit has no such constraint and is closer to the generator, which is
  high for the same reason.
- **`system`** — the shared context, then: change what the brief asks for and
  nothing else; the artist chose these nodes, so a change outside them is not
  yours to make; prefer the smallest change that answers the brief.
- **`format`** — `PATCH_SCHEMA` plus `summary` and the same `changes` array the
  refactor uses. The change list is what the confirm dialog reads out, and an
  edit needs it more than a refactor does, because an edit is *allowed* to change
  the render and the artist has to see what it will do before saying yes.

`buildUserMessage()` gains a case that is the refactor's scoped branch with a
brief in front of it:

```js
case 'ai.patch_edit': {
  const brief = String(input.brief || '').trim();
  if (!brief) throw new BadInputError('Say what you want changed.');
  return `Change the selected nodes: ${brief}\n\n${patchText()}${SELECTION_RULES}`;
}
```

`shapeResult()` in `api/ai/run.js` treats it like a scoped refactor —
`requireOutput: false`, unconditionally, since this feature only ever runs on a
selection.

### 4.2 Entitlements — `src/ai/tiers.js`

`tier: 'cloude'`, `surface: 'editor'`, `metered: true`, and a quota beside the
refactor's (3/6 a day at cloude/cloude_plus). It rewrites the artist's document
like the refactor does and costs about the same, so it should not be cheaper.

### 4.3 Panel — `src/ui/AIPanel.js`

- A `PROMPTED` entry: `inputKey: 'brief'`, action `'Change selection'`,
  placeholder along the lines of *"make this branch react to the bass instead of
  to time"*.
- `needsPatch()` already returns true for anything that is not one of the two
  generators, so the patch is gathered and the preflight runs without a change.
- **Force the scope.** This is the one piece with no precedent: the feature is
  meaningless unscoped, so its card should run against the selection whatever the
  switch says, and its `scopeNote()` should read `Always the selection` rather
  than following `this.prefs.scope`. `run()` currently derives `sentNodeIds` from
  `this.prefs.scope`; it would derive it from the feature as well.
- Apply through `applyScopedRefactor()`, which is already written against a plan
  and a change list and needs only its wording generalised — it says *"refactor"*
  in two toasts.

### 4.4 `ai.node_generator`, separately

Smaller and worth doing on its own: a generated node lands at
`viewportCentre()` and unwired. When the artist has exactly one node selected,
it could land beside it and inherit its wiring — the selected node's input on
pin 0, and whatever read the selected node reading the new one instead. That is
`insertGeneratedNode()` plus the boundary logic that already exists, and it needs
no backend change at all.

## 5. Open questions

1. **Is `changes` enough to decide on?** A refactor promises the render is
   unchanged, so its dialog is about trust. An edit changes the render on
   purpose, and a list of changes is a poor preview of a picture. The honest
   answer may be that the splice is cheap to undo (it writes a backup and leaves
   the rest of the patch alone) and that the dialog should say so rather than try
   to describe the result.
2. **Should an edit be allowed to grow the selection?** `planSelectionSplice()`
   already handles added nodes, renaming ones that collide. The question is
   whether the prompt should encourage it — *"add a Noise node feeding this"* is
   a reasonable brief and the machinery takes it today.
3. **One feature or two?** `ai.patch_edit` could subsume the scoped refactor by
   taking an empty brief to mean "just tidy it". Probably not worth it: the
   refactor's value is its constraint, and a feature whose constraint depends on
   whether a text box is empty is hard to explain on a card.
