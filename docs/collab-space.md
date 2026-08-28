# The collab space

Two or more artists on one canvas: the same nodes, the same wires, each
other's pointers. It is a Cloude entitlement (`collab.space`), and it is the
feature the pricing page has been describing as *"real-time multi-artist
sessions on one canvas"*.

This document is the honest version of that sentence. What follows is what the
foundation actually does today, what it deliberately does not do, and what still
stands between it and a hosted service rather than a relay you run yourself.

## Using it

**Tools → Collab Space…** opens the panel. It shows one of four things:

| What you see | Why |
| --- | --- |
| The join form | Your account has `collab.space`. |
| "Sign in to the gallery" | You may already be paying — you are just not signed in here. |
| "Collab space is part of Cloude" | Your plan is Free. |
| "Not switched on for accounts yet" | The gallery has not published the key. Nothing to buy. |

The first person into a room sets the canvas. Everyone after that **adopts** it:
their open patch is replaced. The panel says so and asks first, because that is
destructive to unsaved work.

A relay can turn you away as well — the room is full, the token is wrong, the
pass was not accepted. The panel shows the relay's own sentence and stops there
rather than reconnecting: none of those answers change by asking again a second
later, and burying the explanation under "Reconnecting…" is how a configuration
problem gets reported as a flaky network.

## Running the relay

`rhizo_server.py` starts one on `ws://127.0.0.1:8767/room` alongside the frame
stream and the OSC bridge. On its own there are three ways to run it, and they
differ in what they can prove about whoever just connected:

```bash
# 1. Loopback. Anyone who can reach the port is in — which, on loopback, is you.
python3 collab_room_server.py

# 2. A shared token. As private as the token is. It proves the peer was told
#    the token; it says nothing about who they are or what they pay for.
python3 collab_room_server.py --host 0.0.0.0 --token some-shared-secret

# 3. A gallery-signed pass. The only one that can face the internet.
TIER_GRANT_SECRET=<the gallery's signing secret> \
  python3 collab_room_server.py --host 0.0.0.0
```

The third mode admits a peer only if it presents a grant the gallery signed,
naming `collab.space` and not yet expired — see **Who gets in** below. The two
can be combined; the token is checked first, at the HTTP upgrade, and the grant
at the hello.

`GET /health` and `GET /stats` report rooms, message counts, drops and refusals;
both say whether the relay is gated (`grantRequired`), so an operator can tell
an open relay from a closed one without trying to join. `/api/status` on the
main server carries the relay's URL, room count and gating too.

The relay carries messages and nothing else. It never parses an op, holds no
history, and keeps no state worth losing — restart it and the editors reconnect
and re-adopt. A joining peer is pointed at the peer who has been in the room
longest, and asks *that editor* for the canvas, so the room's truth lives in the
editors rendering it rather than in a server.

## How the sync works

`src/collab/ops.js` snapshots the graph, diffs the snapshot against the last one
it sent, and emits ops for what changed. It does **not** hook the editor's
mutation paths. The graph changes from a great many places — drags, the
parameter panel, paste, undo, the AI panel's apply step — and a hook per call
site is how a feature like this ends up with a silent hole the first time
someone adds another one. A diff covers a new mutation path the day it is
written, by nobody.

The cost is resolution: a diff sees results, not gestures. A drag arrives as a
handful of positions rather than a stroke.

Ordering is last-writer-wins per target, on a Lamport clock with the peer id
breaking ties, so every peer resolves the same pair of concurrent edits the same
way.

### Both halves of a wire

A wire lives twice — in `graph.connections` as `{from:{nodeId,pin},
to:{nodeId,pin}}`, which is what the renderer draws, and in `node.inputs[pin]`,
which is what codegen, the graph processor and the compute executor read.
Writing only the first produces a canvas that *looks* wired and compiles as if
it were not, and the symptom (a black preview) appears three steps from the
cause. Every wire op maintains both. `tests/collabOps.test.js` exists mostly to
keep that true.

Note that `Graph.remove()` cannot be relied on for this: it filters connections
on `conn.fromNode` / `conn.toNode`, field names the live connection shape does
not have, so it leaves the wires behind. The op applier removes them itself.

## What this is not

Stated here because the pricing page's sentence is broader than the build:

- **It is not conflict-free editing.** Concurrent edits *converge* — two artists
  dragging one node land on one position — but two artists restructuring the
  same branch can still produce a graph neither of them intended. There is no
  operational transform and no CRDT.
- **It does not merge two canvases.** Joining adopts the room's. There is no
  honest merge of two unrelated patches: the node ids differ and the same wire
  means different things on each side.
- **It does not replay a gap.** A reconnecting peer re-adopts the room's canvas.
  Edits made while the socket was down are lost, on purpose — a best-effort
  replay of an unknown gap is how two canvases quietly stop matching, and a
  quiet mismatch is worse than a visible loss.
- **Remote edits are not in your undo history.** Ctrl+Z undoes your own work.
  Silently undoing someone else's would be worse than not offering it.
- **It is not a hosted service.** The relay can now verify who is knocking (see
  *Who gets in*), which is what a public address requires; it still has no
  accounts, no per-room ownership, and no way for one subscriber to say who else
  may join *their* room. A grant proves someone pays for the collab space, not
  that they were invited to this canvas. Rooms are named, and a guessed name is
  as good as an invited one.

## Who gets in

The editor's gate (`src/collab/collabGate.js`) is a licence check in a browser
the visitor controls — same as every other gate in this integration, and it says
so at the top of the file. A determined artist can turn it off with devtools and
open the panel anyway. What they cannot do is forge a token signed with a secret
their browser has never held, which is why the relay is the boundary that counts.

The sequence, when the relay is run with `TIER_GRANT_SECRET`:

1. The editor asks the gallery for a grant naming `collab.space`
   (`src/collab/collabGrant.js`). This is the same call every AI action makes,
   and for this key it spends nothing: `collab.space` is unmetered.
2. It presents the grant in its `hello`.
3. The relay verifies the HMAC signature against the shared secret, checks the
   expiry, checks the grant names `collab.space` and not some other feature, and
   checks it has not already admitted that grant's `jti` (`collab_grant.py`).
   Only then does the peer go into a room.

`collab_grant.py` is a port of `api/_lib/grant.js` — the same format, the same
checks, in the language the relay is written in.
`tests/collabRelayGrant.test.js` signs tokens in Node and runs them through both
verifiers, asserting they agree, so the two cannot drift apart quietly.

Four things about this are worth knowing before relying on it:

- **A grant is a ticket at the door, not a subscription check on a timer.** It is
  verified when a peer joins and never again. Re-checking mid-session would mean
  throwing a paying artist out of a live room the moment a five-minute token
  aged out, which is worse than what it would prevent. A peer stays until its
  socket closes.
- **One grant admits one peer.** The relay remembers each grant's `jti` for ten
  minutes, so a token pasted into a second browser is refused. This is also why
  the editor asks for a fresh grant before *every* hello, the reconnect's
  included — a cached one would come back as a replay.
- **Every refusal says the same thing.** Wrong signature, expired, wrong feature
  and malformed all answer `grant_invalid`; only the log says which. That
  follows `grant.js`: telling someone which check their forged token failed is
  free help with the next one. A hello carrying no grant at all is the exception
  — `grant_required` — because it is nearly always an honest mismatch (an editor
  that could not reach the gallery, or one pointed at a relay it did not know was
  gated) and the remedy is different.
- **The gallery has to be able to issue one.** The relay verifies grants; it does
  not mint them. Until `collab.space` exists in the gallery's catalogue and its
  grant endpoint will sign for it, a gated relay will refuse everyone — correctly,
  and unhelpfully. See the next section for the order to do it in.

## Where the tier catalogue has to change too

`src/ai/tiers.js` is a **mirror** of the gallery's `lib/tiers.ts`, and
`entitlements.can()` reads the live `features` array rather than computing from
the tier. So `collab.space` has to exist in the gallery before any account can
use it — adding it here only decides what gets drawn (AI_TIER_INTEGRATION.md §6
is the order to do it in).

Until the gallery publishes the key, the gate reports `feature_unpublished` and
the panel offers nothing to buy, rather than telling a paying subscriber to
upgrade to a plan they already hold.

The landing page's pricing block still lists Collab Space among the things that
are planned rather than built (and PR #389 moved it there deliberately, because
at the time it was true). Moving that line back into the Cloude column is a
product decision and belongs with the gallery change, not with this one.
