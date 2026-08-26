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
| `src/ai/aiClient.js` | Grant → backend → result, in that order. Addresses the backend by path on the web and by origin in the desktop app. |
| `src/ui/accountSession.js` | Signing in from inside the editor. Two flows: the cookie on the web, a paired bearer token on the desktop. Tools → Account… |
| `src/ai/desktopToken.js` | The desktop app's own credential, and the header it rides in. Inert on the web. |
| `src/utils/openExternal.js` | Opening a gallery page. `window.open()` is refused by the desktop webview. |
| `src/ai/patchContext.js` | Trims the project down to the graph before it leaves the machine. |
| `src/ai/applyResult.js` | Puts a generated node or patch onto the canvas. |
| `src/ai/outputGating.js` | The unmetered `output.*` flags. |
| `src/viewer/viewerGate.js` | The unmetered `viewer.web` flag — and the one gate that refuses where outputGating allows. |
| `src/ui/AIPanel.js` | The panel — Tools → AI Assistant. A dock on the right edge, not a modal; the same menu row opens and closes it. |
| `src/ui/dockLayout.js` | How much of the window the dock holds, and how the canvases are told. |
| `src/styles/ai-panel.css` | Its styles, on the app's own tokens. |

### Backend (Vercel functions, same deployment)

| File | What it does |
|---|---|
| `api/ai/run.js` | `POST /api/ai/run`. The one door to the model. |
| `api/_lib/grant.js` | HMAC verification, expiry, replay tracking. |
| `api/_lib/features.js` | Per-feature system prompts and response schemas. |
| `api/_lib/nodeCatalog.js` | The real node registry as prompt text, and as a validator. |

### Tests

`tests/tierEntitlements.test.js`, `tests/aiGrantVerification.test.js`,
`tests/aiEndpointGate.test.js`, `tests/aiPatchContext.test.js` — 60 tests
covering the catalogue, the client's error mapping and free-tier fallback, the
grant verifier against grants signed exactly as the gallery signs them, and the
endpoint's refusal ordering.

`tests/aiPanelDock.test.js` covers the panel as a dock: that opening it hands
the canvas a narrower window and closing it gives the width back, that it never
takes more than half the window, and that a feature with nothing valid to read —
or no allowance left — is disabled with the reason on screen rather than failing
on click. `tests/aiPanelRepeatGuard.test.js` covers the repeat guard and where
its answer is shown.

`tests/viewerGate.test.js` covers the web viewer's gate, including the
asymmetry: the same degraded entitlements that let `output.multiscreen` through
refuse `viewer.web`, and both directions are asserted in one test so a change
that made them agree has to say so.

---

## 2. What an operator must set

Both variables go on the **editor's** Vercel project (`studio.tenderworld.org`),
as server-side environment variables. Neither is ever exposed to the browser —
`npm run build:web` output contains no reference to either, and the check is
worth repeating after any change to `api/`:

```sh
grep -r "OPENAI_API_KEY\|TIER_GRANT_SECRET\|sk-proj-" dist/   # must find nothing
```

| Variable | Value |
|---|---|
| `TIER_GRANT_SECRET` | **The same value as the gallery's.** Generated with `openssl rand -hex 32`. Get it from whoever runs the gallery deployment. |
| `OPENAI_API_KEY` | An OpenAI API key. Server-side only. |
| `OPENAI_MODEL` | *Optional.* Puts every feature on one model, overriding both the default and any model a feature names for itself. Defaults to `gpt-5.6-terra`, except `ai.canvas_assist`, which asks for `gpt-5.6-luna`. Must name a model on the Responses API that supports Structured Outputs — every feature answers through a JSON schema. A model the account cannot reach answers `503 not_configured` and names itself in the log. |
| `OPENAI_REASONING` | *Optional.* Set to `off` when `OPENAI_MODEL` names a model with no reasoning mode: the `reasoning` parameter is then left off the request, which such a model would otherwise reject outright. Off also removes each feature's reasoning headroom from its output budget, leaving the answer the whole allowance. Anything else, or unset, keeps reasoning on. |

Without either, `/api/ai/run` answers `503 not_configured` on every request and
says so plainly rather than failing as an invalid grant.

### What a call is allowed to spend

The input is not what costs the time. A review sends about 7,000 tokens —
5,800 of catalogue and instructions, cached across calls, and roughly a
thousand of patch — and prefilling that is a moment. Everything after it is
decode, so three settings in `features.js` decide how long a feature takes:

| | what it does |
|---|---|
| `effort` | How many reasoning tokens the model spends before answering. The only setting that changes how long a call *takes* rather than how long it is *allowed* to take. Every feature but the creative director now runs at `medium` or below. |
| `maxTokens` | The answer. Sized from what the feature's schema actually produces — a review's summary and eight findings is under 2,000 tokens — because the sum below is a hard stop: a call that reaches it comes back `incomplete`, which is a wasted action. |
| `reasoningTokens` | Room to think, on top of the answer. |

`maxTokens + reasoningTokens` is `max_output_tokens`, and it is also the worst
case anybody can be made to wait for: `run.js` derives that call's deadline
from it at `ASSUMED_TOKENS_PER_SECOND`. A canvas-assist call allowed 3,500
tokens is held to well under a minute; only the largest refactor of the largest
patch approaches the function's own limit.

`ai.patch_refactor` is the one feature whose budget is sized per call, by
`answerBudget()`: it hands back the whole patch it was given, so a ten-node
tidy and a four-hundred-node one need allowances an order of magnitude apart.

Every completed call logs one line — seconds, reasoning tokens, answer tokens,
input and cached tokens. **Read a few of those before changing any of the
numbers above**; they were estimates until that line existed, which is how a
review came to be allowed 32,000 output tokens and then ran past the function's
time limit.

Two things keep the model from re-deriving what is already known:
`api/_lib/patchFacts.js` computes reachability, empty input pins and broken
wires in JavaScript and hands them over as stated facts, and the prompt tells
the model they are exact. On a large graph that traversal was the bulk of the
reasoning — and the part a model gets wrong.

**`maxDuration` is set to 300s** in `vercel.json`, and `FUNCTION_BUDGET_SECONDS`
in `api/ai/run.js` is the same number — `tests/aiRequestTimeout.test.js` reads
both and fails if they drift. It was 60s, which a review or a generation at
`effort: high` does not fit inside on a real patch. What made that worth fixing
twice over is how it failed: the platform kills the invocation at the limit and
writes its own 504, carrying none of the CORS headers the handler set, so the
browser refuses to read it and reports

```
No 'Access-Control-Allow-Origin' header is present on the requested resource
```

— a CORS error where nothing is wrong with CORS. The handler now stops the
model 15s short of the limit itself and answers `504 timed_out`, with the
headers on it and a message the editor can show. Lower both numbers together on
a deployment whose plan caps functions shorter; the editor's own backstop
(`REQUEST_TIMEOUT_MS` in `src/ai/aiClient.js`) sits just past the platform's
limit and should stay that way.

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

The catalogue text is built once per process and byte-identical on every
request, so those ~8,600 tokens sit at the front of a prefix the model's own
cache can find and are billed in full once per cache window rather than once
per call.

### The web viewer is now an editor surface too

`viewer.web` is catalogued with `surface: 'gallery'`, and it still is one — the
gallery decides which published works offer a live view. But the page that runs
the patch ships from this project, at `/viewer`, because this is where the
codegen and the renderer live. See [docs/web-viewer.md](docs/web-viewer.md).

The `surface` field is untouched: it is the gallery's word for whose UI lists
the feature, and the AI panel filters on `surface === 'editor'` to build itself.
A viewer page that appeared in that panel would be wrong. The editor's one entry
point to it — File → Open in Web Viewer — is a menu row, not a catalogue row.

### The panel is docked beside the canvas, not stacked over it

Every editor-surface feature reads or rewrites the graph, and the panel used to
be a centred modal over it. That made three things impossible at once: reading a
finding while looking at the nodes it names, watching "Show nodes" select them,
and seeing what a generated patch was about to replace.

So it is a dock on the right edge, and the canvases are inset by its width
rather than covered:

- `src/ui/dockLayout.js` holds the number and publishes it twice — as the CSS
  variable `--rz-canvas-inset-right` (which the `#gpu-canvas` / `#ui-canvas`
  rules subtract from `100vw`, and which `gpuRenderer.resizeCanvas()` picks up
  because it measures `clientWidth`), and as `canvasViewportWidth()` for the JS
  that sizes the 2D canvas (`Editor.resize`) or reasons about the visible area
  (`ViewportManager.fitToContent`).
- Changing it fires a window `resize`, because every consequence — re-measuring
  both canvases, redrawing the graph, rebuilding the MSAA texture — is already
  wired to that event. A dock opening *is* a resize as far as the canvases are
  concerned.
- The dock never takes more than half the window, and its width is dragged from
  the left edge, keyboard-adjustable, and remembered in
  `glsl-node-editor.ai-panel.prefs`.

Answers land in the panel's session log rather than in a modal, for the same
reason. The confirm dialogs stayed where they were: applying a generated patch
replaces the canvas, and that is a decision worth interrupting for — the log
keeps an "Apply…" button afterwards so a changed mind costs nothing.

### The panel says what an action costs, before and after

These are metered calls against someone's money, and the gallery spends the
quota when the grant is issued — before the model is called at all. A spinner
that says nothing else is a bill with no itemisation, so the dock shows:

- **Allowance** — actions left today across the metered features, each feature's
  own `used`/`limit` as a bar, and when the window resets. A feature whose
  allowance is spent has its button disabled rather than failing on click.
- **What gets sent** — nodes, wires, selection, and how close the payload is to
  the `MAX_NODES` cap, read straight off `window.graph` so it costs nothing.
  Payload size and an estimated token count need the project exporter (textures
  included), which is far too heavy to run on a timer while someone is
  building, so they are measured on request — and again for free after every
  run, since the patch was built anyway. The reading is marked *stale* the
  moment the graph's shape moves rather than quietly ageing.
- **Per run** — seconds, and the `usage` the backend already returned (input,
  output, cached and reasoning tokens), which the panel previously discarded.
- **This session** — runs, failures, tokens and the mean time per call. Failures
  are counted because a failed call still spends an action.

Two controls come out of that. **Scope** sends either the whole patch or only
the selected nodes and the wires between them (`buildPatchContext(project,
{ nodeIds })`) — a specific answer about one branch, and the way a patch over
the node cap gets reviewed at all. **Reuse the last answer** exposes the repeat
guard that was already there, for an artist who would rather always pay for a
fresh opinion.

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

`viewer.web` is unmetered too and goes the other way — it refuses when the
lookup fails. The trade is not the same one: the viewer is a web page that has
just fetched a patch over the network, so a failed entitlements call means the
network is down or the visitor is not signed in, which are the two cases the
gate exists for. Nobody is on stage waiting for it. The cost is that a viewer
served from `localhost` refuses until `/api/entitlements` is stubbed or the
gallery trusts the local origin, which docs/web-viewer.md says out loud.

### Multi-screen output was already built here, and is now gated

`output.multiscreen` is a `cloude_plus` entitlement per the handoff, but the
second-monitor viewer already ships in this editor and was previously
ungated. Wiring the check means existing users on a lower tier lose it.

**This is a product decision, not a technical one.** It is one call site —
`main.js`, the `btn-second-monitor` handler — and deleting the
`requireOutputFeature` block restores the old behaviour. Closing an already-open
viewer is never gated, so a tier that lapses mid-show cannot strand a window on
a projector.

### The desktop app is a cross-origin client, and the gallery has to know it

Everything above assumes the editor and the gallery are two origins that
already trust each other — they are, and that is how `studio.tenderworld.org`
reads a session held by `art.tenderworld.org`.

The desktop app is a third origin: `tauri://localhost`, or
`http://tauri.localhost` on Windows — and, unlike the other two, a different
*site*, so the gallery's session cookie is never sent on its requests. It
authenticates with a bearer token obtained by a pairing handshake instead. The
CORS allow-list needs both origins either way. `DESKTOP_APP.md` §The account
has the flow, and the gallery's `GLSL_EDITOR_TIER_INTEGRATION.md` §3.5 has its
half of the contract.

Two things follow for anyone reading this file to debug a desktop install:

- **The AI backend is named, not derived.** `/api/ai/run` does not exist inside
  the bundle. `aiClient.js` uses `STUDIO_ORIGIN` when `isTauri()`, and
  `src-tauri/tauri.conf.json` has to list that origin in `connect-src`.
  `tests/desktopAccount.test.js` holds the two together.
- **Our own backend needs an allow-list too, not just the gallery's.** Naming
  the origin makes the AI call cross-origin, and its JSON body makes it
  preflighted: the browser sends `OPTIONS` first and will not send the `POST`
  at all unless the answer names its origin. `api/_lib/cors.js` holds that
  list — the three `tauri://`/`tauri.localhost` origins, any loopback address
  (so `npm run dev` and `tauri dev` on :5173 can work against a real backend),
  whatever domain the deployment itself answers on, and anything in
  `AI_ALLOWED_ORIGINS` for a self-hosted studio. `api/ai/run.js` applies it
  before every path out, so a 401 or a 503 is readable rather than arriving as
  a CORS failure. It is not the gate — the signed grant is; see §Security.
- **The output flags failing open matters more here.** `output.ndi` and
  `output.multiscreen` allow on an unreachable gallery (see below), which is
  what keeps a desktop install usable at a venue — and what kept the missing
  CORS entry from taking the second monitor down with it.

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

**Not yet verified: any model output.** The backend now calls OpenAI (see §7),
and no live call has been made since the switch — the last calls under the
previous provider failed on an account with no credit, so no feature has ever
produced a real result here. Once `OPENAI_API_KEY` is set on a funded account,
each of the six features needs exercising once. The failure to expect from an
unfunded account is a `429 insufficient_quota`, which this backend reports as
`503 not_configured` rather than as "the service is busy".

**`upgradeUrl` points at `/pricing`, which does not exist yet.** Locked features
link there today — including the web viewer's upsell, which is the first paid
surface a signed-out visitor is likely to meet.

## 6. Adding a feature

1. Add the key to `src/ai/tiers.js` — **after** it exists in the gallery's
   `lib/tiers.ts`; the keys are permanent and end up in signed grants.
2. Add an entry to `api/_lib/features.js` with its system prompt and response
   schema, and a `case` in `buildUserMessage`. Keep `strict: true` unless the
   shape genuinely needs an open map — see §7.
3. If it needs typed input, add it to `PROMPTED` in `src/ui/AIPanel.js`; if it
   applies a result to the canvas, handle it in `presentResult`.

The panel draws itself from `catalog`, so a feature the gallery adds appears —
locked, with the tier it needs — without a release here.

---

## 7. How the model is called

`api/ai/run.js` talks to **OpenAI's Responses API** through the `openai`
package. One call per feature, one shape to it, and nothing about the provider
reaches the browser — `aiClient.js` posts to `/api/ai/run` and reads a result.

**The answer is JSON, not prose.** Each feature declares a `format` in
`features.js` — an OpenAI [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
response format. The model answers inside that schema or the call fails; there
is no prose to parse and no "the model replied in the wrong shape" path to
handle in the editor.

`strict: true` is the default and four of the six features use it: the platform
then guarantees the shape, at the cost of a schema subset — every property must
be `required`, and every object must set `additionalProperties: false`.

The two patch-writing features run `strict: false`, and the reason is worth
knowing before anyone "fixes" it. A patch's `params` is an open map: parameter
names and value types come from the node registry and differ per node kind,
which no closed schema can express. Strict mode forbids exactly that. So those
two are validated after the fact instead — `validateGeneratedPatch()` in
`nodeCatalog.js` drops any parameter the node does not declare and refuses a
patch that would not open, and the endpoint answers `502 unusable_answer`
rather than putting a broken document on someone's canvas.

**Which model runs what.** `DEFAULT_MODEL` in `run.js` is `gpt-5.6-terra` —
$2.00 per million input tokens against gpt-5.5's $5.00 — and a feature that
wants something else names its own `model` in `features.js`.

It ran the other way round for a while: the default was the cost-efficient
`gpt-5.6-luna`, on the argument that reading a graph and reporting on it does
not need a large model. Half right. These features are not asked to describe a
patch, they are asked to judge one — is this wiring what the artist meant, will
this value render black, is this chain worth collapsing — and a finding that is
wrong costs an artist more than the saving, because they act on it.

So the exception now goes the other way: `ai.canvas_assist` names luna for
itself. It fires while the artist works, its suggestions are accepted in one
click, and one it misses costs nothing where a slow one costs the flow it was
meant to support. That is the only place in the editor where cheap-and-quick is
the better answer.

| feature | model | effort | why |
|---|---|---|---|
| `ai.canvas_assist` | luna | `low` | speed is the product |
| `ai.patch_review` | terra | `medium` | run often, waited on; the graph facts are precomputed, so there is little left to reason about |
| `ai.patch_refactor` | terra | `medium` | strictest correctness bar, but also the largest answer — effort on top of that budget is where the wait comes from |
| `ai.patch_generator` | terra | `high` | writes a document the artist has to debug if it is wrong, and they are waiting on it deliberately |
| `ai.node_generator` | terra | `high` | writes shader code that has to compile |
| `ai.creative_director` | terra | `xhigh` | the thinking is the product |

Capability is where correctness comes from; `effort` is where the seconds come
from. That is the whole rule behind the table: raise the model where a mistake
costs the artist something, raise the effort only where they are already
waiting on purpose. `OPENAI_MODEL` overrides all of it.

**Reasoning.** Each feature declares an `effort`, mapped in `run.js` to what
the Responses API takes. `xhigh` — which only `ai.creative_director` asks for —
lands on `high`: OpenAI's ceiling varies by model, `high` is the deepest
setting every GPT-5-class model accepts, and a rejected effort value fails the
whole call for a marginal gain. Raise it in the `EFFORT` map if the deployment
pins a model that takes more. Reasoning tokens are billed as output; a
deployment that wants them gone — or that names a model with no reasoning mode
at all, which would reject the parameter outright — sets `OPENAI_REASONING=off`
and the parameter is left off the request entirely.

**Budgets.** Reasoning tokens are spent out of `max_output_tokens`, so
`maxTokens` in `features.js` describes the *answer* and `run.js` adds
`REASONING_HEADROOM` on top. Without it a feature that thinks hard runs out
mid-sentence and comes back `incomplete` — a spent call with nothing to show.
That case is reported as `502 answer_truncated`, not handed over as a partial
result, because half a patch is not a patch.

**Caching is automatic.** The system prompt goes in `instructions`, where it is
the stable prefix of every request for a feature; the node catalogue is most of
its ~21KB and never varies within a deploy. OpenAI caches long prefixes on its
own, so there is nothing to mark and nothing to keep in sync. `nodeCatalogText()`
is built once per process, which is what keeps that prefix byte-identical, and
each call carries a `prompt_cache_key` of the feature's name so requests that
share a prefix are routed to where it is already warm. `usage.cacheReadTokens`
in the response says what it saved.

**The patch is not sent as JSON.** It goes over in the compact line format that
`PATCH_FORMAT_LEGEND` in `features.js` describes — one line per node, one per
wire — with any parameter still at its registry default left out, since the
catalogue in the cached prefix already stated it. The same graph as indented
JSON runs five to nine times longer, and none of that length is information: a
sixty-node patch is 11,548 tokens as JSON and 1,299 in this format. The legend
costs ~370 tokens once, at the end of the cached prefix. Answers are
unaffected: those still come back as JSON through Structured Outputs.
`tests/aiPromptEncoding.test.js` holds the encoding to what a model needs to
name a node in its answer.

**Requests are not stored.** `store: false` on every call. Artists' patches are
their work, and there is no reason to leave copies of them on someone else's
server for 30 days.

**Failures worth separating.** An unpaid bill arrives as a `429` with
`insufficient_quota` — the same status as a rate limit, and the one 429 that
retrying cannot fix. It is checked first and answered `503 not_configured`, so
an artist is not told to try again in a moment while an operator needs to top
up an account. A `404` means `OPENAI_MODEL` names a model this account cannot
reach; the log names the value.
