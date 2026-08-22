# AI and tier integration — editor side

What was built in this repository against `GLSL_EDITOR_TIER_INTEGRATION.md`, the
handoff from the gallery. The gallery (`art.tenderworld.org`) owns accounts and
tiers; this project is the client and the AI backend.

Read `GLSL_EDITOR_TIER_INTEGRATION.md` for the contract itself. This document
covers what implements it here, what an operator has to set, and the decisions
that were made along the way.

---

## 1. What is here

### Browser

| File | What it does |
|---|---|
| `src/ai/tiers.js` | The tier catalogue, mirrored from the gallery's `lib/tiers.ts`. Decides **what to draw**, never what to do. |
| `src/ai/entitlements.js` | `GET /api/entitlements` (cached for the session) and `POST /api/entitlements/grant` (per action). Maps 402/429/503 to distinct, typed errors. |
| `src/ai/aiClient.js` | Grant → backend → result, in that order. |
| `src/ai/patchContext.js` | Trims the project down to the graph before it leaves the machine. |
| `src/ai/applyResult.js` | Puts a generated node or patch onto the canvas. |
| `src/ai/outputGating.js` | The unmetered `output.*` flags. |
| `src/ui/AIPanel.js` | The panel — Tools → AI Assistant… |
| `src/styles/ai-panel.css` | Its styles, on the app's own tokens. |

### Backend (Vercel functions, same deployment)

| File | What it does |
|---|---|
| `api/ai/run.js` | `POST /api/ai/run`. The one door to the model. |
| `api/_lib/grant.js` | HMAC verification, expiry, replay tracking. |
| `api/_lib/features.js` | Per-feature system prompts and tool schemas. |
| `api/_lib/nodeCatalog.js` | The real node registry as prompt text, and as a validator. |

### Tests

`tests/tierEntitlements.test.js`, `tests/aiGrantVerification.test.js`,
`tests/aiEndpointGate.test.js`, `tests/aiPatchContext.test.js` — 60 tests
covering the catalogue, the client's error mapping and free-tier fallback, the
grant verifier against grants signed exactly as the gallery signs them, and the
endpoint's refusal ordering.

---

## 2. What an operator must set

Both variables go on the **editor's** Vercel project (`studio.tenderworld.org`),
as server-side environment variables. Neither is ever exposed to the browser —
`npm run build:web` output contains no reference to either, and the check is
worth repeating after any change to `api/`:

```sh
grep -r "ANTHROPIC_API_KEY\|TIER_GRANT_SECRET\|anthropic-ai" dist/   # must find nothing
```

| Variable | Value |
|---|---|
| `TIER_GRANT_SECRET` | **The same value as the gallery's.** Generated with `openssl rand -hex 32`. Get it from whoever runs the gallery deployment. |
| `ANTHROPIC_API_KEY` | An Anthropic API key. Server-side only. |

Without either, `/api/ai/run` answers `503 not_configured` on every request and
says so plainly rather than failing as an invalid grant.

**`maxDuration` is set to 60s** in `vercel.json`, which is the ceiling on Hobby.
Patch generation at `effort: high` can approach it on a large patch; on a Pro
plan with Fluid compute, raise it to 300.

---

## 3. How a call actually flows

```
Editor                          Gallery                    /api/ai/run
  │                                │                            │
  │ 1. POST /entitlements/grant    │                            │
  │    { feature }                 │                            │
  ├───────────────────────────────►│ reads tier from the DB     │
  │                                │ spends quota               │
  │ 2. { grant: "<payload>.<hmac>" }│ signs                     │
  │◄───────────────────────────────┤                            │
  │                                                             │
  │ 3. POST /api/ai/run { grant, feature, input }                │
  ├────────────────────────────────────────────────────────────►│
  │                                                             │ verify HMAC
  │                                                             │ check exp
  │                                                             │ feature ← GRANT
  │                                                             │ call the model
  │ 4. { result, warnings, usage }                              │
  │◄────────────────────────────────────────────────────────────┤
```

Step 3 is the only step that matters for security. Three things happen there
before a model is reached, and the order is deliberate:

1. **The signature and expiry are checked** against `TIER_GRANT_SECRET`. Every
   failure returns the same `401` — telling an attacker which check failed is
   free information — while the reason is logged.
2. **The feature comes from the grant, never from the body.** The body's
   `feature` field is only ever compared, and a mismatch is a `403`. Without
   this, one grant for the cheapest free feature would authorise the most
   expensive `cloude_plus` one.
3. **Only then** is the model called.

Everything the editor says about its own tier is decoration. Setting
`tier = 'cloude_plus'` in devtools lights up every button and buys nothing.

---

## 4. Decisions worth knowing about

### The catalogue is vendored, not fetched

`src/ai/tiers.js` mirrors the gallery's `lib/tiers.ts`. **When that file
changes, this one has to change too.** A copy that has drifted costs a
wrong-looking button, not a free upgrade — the UI may draw a feature as
available that the grant call then refuses — so drift is survivable, but the
tests in `tests/tierEntitlements.test.js` are what catch it.

### The backend validates generated patches against the real node registry

`api/_lib/nodeCatalog.js` imports the editor's own `NodeDefs`, so the model is
told exactly which of the 142 node kinds exist, and anything it invents anyway
is caught before it reaches a canvas. A patch with an unknown node kind, or with
no output node, is answered `502` rather than handed over — a document that
cannot open is a failed call, not a result.

The catalogue text is byte-identical on every request and sits behind a
`cache_control` breakpoint, so those ~4,000 tokens are billed once per cache
window rather than once per call.

### The unmetered output flags fail *open*, deliberately

Everywhere else, not knowing means falling back to the free tier — wrong in the
safe direction, because guessing the other way gives away paid model calls.
`output.ndi` and `output.multiscreen` are the exception, and
`src/ai/outputGating.js` says why at length:

- They cost the operator nothing — no model call, no server render.
- They are used live, and the desktop build runs in venues with no network.

Allowing wrongly means someone sees a feature they have not paid for while
offline. Refusing wrongly means a paying artist's second screen goes dark in
front of an audience. Only a confident, live "no" refuses.

### Multi-screen output was already built here, and is now gated

`output.multiscreen` is a `cloude_plus` entitlement per the handoff, but the
second-monitor viewer already ships in this editor and was previously
ungated. Wiring the check means existing users on a lower tier lose it.

**This is a product decision, not a technical one.** It is one call site —
`main.js`, the `btn-second-monitor` handler — and deleting the
`requireOutputFeature` block restores the old behaviour. Closing an already-open
viewer is never gated, so a tier that lapses mid-show cannot strand a window on
a projector.

### Replay tracking is in-process

`claimGrantId()` is an in-memory set, so on serverless it only catches replays
that land on the same warm instance. That is the honest limit of remembering
anything in process memory, and it is applied only to `ai.creative_director`,
where one call is minutes of model time. Cheap, frequent features skip it —
the gallery has already metered them. If replay becomes a real cost, the
upgrade is a Redis or Postgres set behind the same function.

---

## 5. Verification status

**Verified live** (2026-08-22, against production):

- `GET /api/entitlements` answers signed-out visitors with the anonymous free
  allowance — 5 / 5 / 20, which is the free column divided by three, as
  designed.
- The grant flow works end to end. A grant was signed by the gallery, verified
  by this backend, and the quota was spent — which also proves
  `TIER_GRANT_SECRET` matches on both sides, since a mismatch would have failed
  verification.
- `POST /api/ai/run` with no grant returns `401 invalid_grant`. The gate is
  enforcing in production.
- Both environment variables are set on the editor: the two `503 not_configured`
  checks run before anything else, so a `401` from the grant check proves they
  passed.

**Not yet verified: any model output.** The first live calls failed with
`400 invalid_request_error` — *"Your credit balance is too low to access the
Anthropic API"*. The wiring is correct and the request reaches Anthropic
authenticated; the account simply has no credit. Once credit is added, each of
the six features still needs exercising once, since no feature has yet produced
a real result.

**`upgradeUrl` points at `/pricing`, which does not exist yet.** Locked features
link there today.

## 6. Adding a feature

1. Add the key to `src/ai/tiers.js` — **after** it exists in the gallery's
   `lib/tiers.ts`; the keys are permanent and end up in signed grants.
2. Add an entry to `api/_lib/features.js` with its system prompt and tool
   schema, and a `case` in `buildUserMessage`.
3. If it needs typed input, add it to `PROMPTED` in `src/ui/AIPanel.js`; if it
   applies a result to the canvas, handle it in `presentResult`.

The panel draws itself from `catalog`, so a feature the gallery adds appears —
locked, with the tier it needs — without a release here.
