# The collab space

Two or more artists on one canvas: the same nodes, the same wires, each
other's pointers. It is a Cloude entitlement (`collab.space`), and it is the
feature the pricing page has been describing as *"real-time multi-artist
sessions on one canvas"*.

This document is the honest version of that sentence. What follows is what the
foundation actually does today, what it deliberately does not do, and what has
to happen before it can be sold as a hosted service rather than run between
machines you control.

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

## Running the relay

`rhizo_server.py` starts one on `ws://127.0.0.1:8767/room` alongside the frame
stream and the OSC bridge. On its own:

```bash
python3 collab_room_server.py --host 0.0.0.0 --token some-shared-secret
```

`GET /health` and `GET /stats` report rooms, message counts and drops.
`/api/status` on the main server carries the relay's URL and room count too.

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
- **It is not a multi-tenant service yet.** See below.

## What it would take to host this

The editor's gate (`src/collab/collabGate.js`) is a licence check in a browser
the visitor controls — same as every other gate in this integration, and it says
so at the top of the file. The enforceable boundary is the relay, and today the
relay can only check a shared `--token`. It has no share of the gallery's
signing secret, so it cannot verify a grant.

The step that changes that is the one `api/_lib/grant.js` already implements for
the AI backend: the editor asks the gallery for a signed grant naming
`collab.space`, presents it when it joins, and the relay verifies the signature
before it puts the peer in a room. Until then:

- on loopback it is a local, single-machine feature;
- on a LAN or a host with `--token` it is as private as that token is;
- it should not face the open internet.

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
