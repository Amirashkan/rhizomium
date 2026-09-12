# The AI Performer

You play the music. It plays the visuals.

The performer reads what you send it — OSC from your DAW, the audio the editor
is already analysing, and a tempo it keeps with you — and drives the visuals
from a **scenario**: a written score that says what the set is made of and what
it is allowed to do.

```
your DAW ──OSC──> osc_bridge_server.py ──ws──> OSCManager ─┐
                                                           │
              audio analysis (src/audio/) ─────────────────┼──> SignalBus
                                                           │       │
                            PerformerClock ────────────────┘       │
                                                                   ▼
                      Scenario ────────────────────────────> PerformerEngine
                    (the score)                                    │
                                                    ┌──────────────┴───────────┐
                                                    ▼                          ▼
                                            ActionExecutor            PerformerDirector
                                    scenes · presets · parameters      (the model, off
                                    · transitions · the graph           the frame loop)
```

## Two brains, on purpose

A model call takes seconds. A bar at 128 BPM takes under two. Anything that
waits for a model before it can react is a set that is visibly behind the
music, so the performer is split:

**The fast half** — `PerformerEngine` — runs every frame, is fully synchronous
and never awaits anything. It advances the clock, refreshes the signals, runs
the standing drives, fires the moves that are due, decides whether the section
is over, and releases whatever the quantiser was holding for this bar line.
Everything it does is decided by the scenario you wrote.

**The slow half** — `PerformerDirector` — is asked what to do over the next
stretch, and answers with a handful of actions. Its answer carries the moment
it was *asked* at, and the engine throws away a plan that arrives too late: an
answer to a moment that has passed is worse than no answer.

*When* it is asked is `DirectorCadence`'s decision, and it is not a bar count.
A floor bounds what a set can cost; novelty — a texture change, a drop — beats
the floor's timer; failing both, an interval in seconds. Nothing changing for a
long time stretches that interval, because asking a model to look at a drone
every thirty seconds bills you to be told it is still a drone.

Turn the director off and the set still runs, exactly as written. That is the
intended way to play it the first few times.

## Music with no pulse

Most performer software assumes a beat. This one does not, because most of the
sets it was built for do not have one.

`MusicalListener` (`src/audio/`) keeps a rolling memory of what the music has
been *doing* — building or receding, how busy it is, how bright, and above all
how long the current texture has held — and that is what the director is shown.
A filter sweep under a constant level moves no meter at all but changes the
shape of the spectrum, so that is what gets measured.

Tempo is one field in that description rather than the ground under it. When a
steady beat is really heard, `pulse` reports it. When it is not, `pulse` reports
`free` and **no number**, which is the honest answer for drone, ambient and
free improvised material — a detector asked to find a tempo in it will always
find something, and that something means nothing.

So a scenario for unmetered music is written in seconds rather than bars:
`{ "seconds": 90 }` for enters and holds, `overSeconds` on moves,
`"quantize": "onset"` to land a change on the next thing the musician actually
plays, and `rules.director.everySeconds` for the cadence. `everyBars` still
works where there are bars — it is converted using the tempo that was *heard*,
not the one in the BPM box, and falls back to seconds when there is no pulse to
convert against.

The panel's listening readout tells you which of these you are in, and
separates "hearing nothing" (a routing problem) from "hearing quiet music".

## Start here

1. Open **View → AI Performer** (`Ctrl/Cmd+Alt+R`).
2. **Scenario** tab → **Example**, then **Load**. Or write a brief and press
   **Write a scenario** to have the model draft one, which lands in the editor
   for you to read before anything plays it.
3. Point your DAW at the OSC bridge (see [`../osc/README.md`](../osc/README.md)
   — the performer listens on the same bridge) and send
   `/rhizo/perf/start`.

Nothing starts on its own. The engine is stopped, the director is off and the
panel is closed until you open it.

## The scenario

A plain JSON document with four parts. [`Scenario.js`](Scenario.js) has the
full shape and `EXAMPLE_SCENARIO` at the bottom of it is a working set.

```jsonc
{
  "name": "Night set",
  "bpm": 128,

  // The named live values everything else reads.
  "signals": [
    { "name": "energy", "source": "osc",   "address": "/rhizo/perf/energy", "smooth": 0.4 },
    { "name": "filter", "source": "osc",   "address": "/live/filter", "inputMin": 0, "inputMax": 127 },
    { "name": "bass",   "source": "audio", "channel": "low", "attack": 0.01, "release": 0.25 }
  ],

  // The set, in order.
  "sections": [{
    "id": "build",
    "name": "Build",
    "enter": { "when": "energy > 0.45" },   // or { "cue": "drop" } | { "bars": 32 } | { "seconds": 90 } | "manual"
    "hold":  { "bars": 8 },                 // or { "seconds": 30 } — the floor: nothing ends it sooner
    "look":  { "scene": "build-scene" },    // or { "preset": … } | { "patch": … }
    "transition": { "type": "crossfade", "duration": 1, "quantize": "phrase" },

    // A signal driving a parameter, for as long as this section is up.
    "drives": [{ "signal": "bass", "node": "Warp", "param": "amount", "min": 0, "max": 0.6 }],

    // Something that happens a set distance in.
    "moves": [{ "at": { "bars": 8 },
                "do": [{ "type": "param", "node": "Warp", "param": "speed", "to": 1.6, "overBars": 8 }] }],

    "next": "drop",
    "intensity": 0.6,
    "mood": "tightening, still dark"       // never executed — what the director is told
  }],

  // Moments you fire by hand, out of order.
  "cues": [{ "name": "drop", "do": [{ "type": "section", "to": "drop" }] }],

  // The fence.
  "rules": { "minSectionBars": 4, "allowGraphEdits": false,
             "director": { "enabled": true, "everyBars": 16, "freedom": 0.4 } }
             //             ...or "everySeconds": 45, on music with no bars
}
```

### Signals

`source` is `osc`, `audio`, `clock` or `manual`. Every signal is published
normalised to 0–1, so a scenario written against a 0–1 fader keeps working when
the sender turns out to send 0–127 — that is what `inputMin`/`inputMax` are for,
and they are the only place that knowledge lives.

`smooth`, `attack` and `release` are **time constants in seconds**, not
coefficients. A 0.4 s signal takes 0.4 s on a 60 Hz laptop and on a 144 Hz rig,
which is what makes a rehearsed set reproducible. Leave them at 0 for a trigger
channel: smoothing a one-frame kick pulse is the same as deleting it.

Four derived readings come free, as `<name>_raw`, `<name>_rise`, `<name>_peak`
and `<name>_avg`. `bass_rise > 0.4` is "the bass is coming up", which is a
different question from "the bass is loud" and usually the one you meant.

Every scenario can also read the clock without declaring anything: `bar`,
`beat`, `phrase`, `barPhase`, `beatPhase`, `phrasePhase`, `bpm`, `energy`,
`intensity`, `sectionBars`, `sectionPhase`.

### Sections

`enter` says what *ends the section before it*. `hold` says the minimum this
one stays up, and a section that states a hold has also said how long it runs —
which is what lets a closing section point `next` back at an opener that is
otherwise entered by hand, so a set loops.

Conditions go through the editor's own expression system: an AST interpreter,
never `eval` (see ARCHITECTURE.md §5). A condition that throws is reported once
and then retired, rather than filling the log sixty times a second.

Section changes are quantised by `transition.quantize` — `beat`, `half`, `bar`,
`phrase` or `off`. A change decided at bar 3.2 lands on bar 4, and it *still*
lands even if the condition that decided it has since stopped being true: a
decision already made should not be un-made by the wait.

### Actions

The whole vocabulary is [`actions.js`](actions.js) and nothing invents a verb
outside it:

| | |
| --- | --- |
| `scene` | switch scene, through a transition |
| `preset` | apply a parameter preset |
| `param` | move one parameter, now or over bars |
| `drive` / `undrive` | bind a signal to a parameter, or release it |
| `transition` | set the transition the next change uses |
| `master` / `speed` / `blackout` | the output |
| `section` / `cue` | move the set |
| `graph` | replace the patch — recompiles the shader |
| `log` | say something without doing anything |

### Rules

The fence, and it is enforced in exactly one place (`ActionExecutor.refuse`).
The failure it guards against is not the performer doing the wrong thing once —
it is doing the right thing forty times a second.

| | default | |
| --- | --- | --- |
| `minSectionBars` | 4 | nothing cuts a section shorter, including the director |
| `minSceneChangeSeconds` | 4 | scene loads rebuild the graph |
| `maxActionsPerBar` | 12 | a budget, weighted by what each action costs |
| `allowGraphEdits` | **false** | a graph edit recompiles the shader and can drop frames |
| `masterCeiling` / `masterFloor` | 1 / 0 | a house limit the performer cannot undo |
| `director.freedom` | 0.4 | 0 = play it as written, 1 = treat it as a starting point |

## Talking to it from your DAW

Signals you declare are polled. These are the *moments*, taken from the message
stream so one cannot be missed between two frames:

| Address | Takes | |
| --- | --- | --- |
| `/rhizo/perf/start` `/stop` `/pause` `/panic` | bang | transport |
| `/rhizo/perf/cue <name>` | string | fire a cue |
| `/rhizo/perf/cue/<name>` | bang | …for a sender that only bangs |
| `/rhizo/perf/section <name\|index>` | string or int | jump |
| `/rhizo/perf/next` | bang | move the set on |
| `/rhizo/perf/bpm <f>` · `/tap` · `/bar` · `/beat` | | tempo and grid |
| `/rhizo/perf/energy <0-1>` | float | how hard the music is going |
| `/rhizo/perf/signal/<name> <f>` | float | drive a named signal |
| `/rhizo/perf/steer <text>` · `/director <0\|1>` | | the AI |
| `/rhizo/perf/master <0-1>` · `/blackout <0\|1>` | | the output |

Two things worth knowing, because each costs a set:

**Buttons send twice** — 1 on press, 0 on release. Every trigger here is
edge-triggered, so a cue on a button fires once.

**A bang carries no value.** An absent argument means *fire*; only an explicit
0 means *off*. A sender that bangs twice in a row means it twice.

`/rhizo/perf/bar` on your downbeat is the single most useful thing to wire up:
it realigns the grid to you without losing count, forward to the nearest bar
line rather than back, so a section waiting on bar 32 is released by the
downbeat you just played.

## Safety

- **The musician always wins.** A cue clears anything the director has queued.
  You should never have to fight the software for your own set.
- **PANIC** kills the output and pauses, ignoring `masterFloor` — it is the
  control you reach for when what is on screen *is* the problem.
- **Stop leaves the output where it was.** If the performer faded to 40% for a
  breakdown, stopping does not slam it back to full in front of an audience.
  It does release every standing drive, so your parameters are yours again.
- The director is **off until you switch it on**, and switches itself off
  rather than spending a set on refusals if the answer is "no quota".

## The files

| | |
| --- | --- |
| `Scenario.js` | the document: normalise (never throws) and validate (reports everything at once) |
| `actions.js` | the vocabulary, and what each action costs |
| `PerformerClock.js` | a monotonic musical clock that survives a tempo change and a backgrounded tab |
| `SignalBus.js` | named signals: normalisation, frame-rate-independent smoothing, derived readings |
| `ActionExecutor.js` | the only file that touches the editor |
| `PerformerEngine.js` | the frame loop and the state machine |
| `PerformerDirector.js` | the model, kept off the frame loop |
| `PerformerOSC.js` | the `/rhizo/perf/*` namespace |
| `../ui/PerformerPanel.js` | the panel |

## The AI, and what it costs

Two grant-gated features, exactly like every other AI feature in the editor
(ARCHITECTURE.md, "Open-core boundary" — setting a tier in devtools buys a
lit-up button and a 401):

- **`ai.performer_scenario`** writes a scenario from a brief. Slow, run once at
  a desk. It is told what scenes, presets, parameters and OSC addresses you
  actually have, and told not to invent any others.
- **`ai.performer_live`** improvises inside one while you play. Its quota is
  **per hour**, not per day: it is the one feature whose spend tracks how long
  you perform for rather than how many times you press a button. Each call
  carries the minutes of set since the last one, so a cadence that reacts to
  the music does not make the bill unpredictable. (The gallery's grant issuer
  has to charge those minutes before the allowance itself reads in minutes —
  see `src/ai/tiers.js`.)

## Running it locally

For a long time this did not work at all, silently, and the reason is worth
writing down because nothing on screen said it.

`npm run dev` serves the editor from `localhost:5173`, and the gallery is
reached from there through the server-side `/gallery-api` proxy in
`vite.config.js`. That hop is what makes the call work — it takes CORS out of
the picture — and it is also why **no session cookie rides along**: the browser
has no `art.tenderworld.org` cookie to send from localhost in the first place.

Until recently the bearer token that exists for exactly this problem was gated
on `isTauri()`, so a dev browser held neither credential. The gallery read
every dev run as anonymous and priced it at the free tier — whatever the
artist's real account was. `ai.performer_live` costs more than free, and its
refusal is **not transient**: `PerformerDirector._noteFailure()` sets
`enabled = false` and stops asking for the rest of the session. One tier
lookup at startup, one line in the log, and then silence for the whole set.

So: **pair the dev server, the same way the desktop app does.**

1. Run `npm run dev` and open `http://localhost:5173/editor/index.html`.
2. **Tools → Account…** → sign in. On `localhost:5173` this now takes the
   pairing flow rather than the cookie flow (`accountSession.js`,
   `usesBearerToken()`): a code appears, you approve it on the gallery's
   `/desktop` page while signed in there, and the editor collects the token.
3. The dialog should then show your real tier. If it still says Free, the token
   did not arrive — check the console, which names which credential each
   gallery call went out with.

The token is stored per origin, so pairing `localhost:5173` is separate from
pairing an installed desktop app, and signing out of one leaves the other.

### What `AI_DEBUG_MODE` is, and is not

It is a **deployment** variable, not a local one. Setting it in your shell
achieves nothing, because `vite.config.js` proxies `/api` to
`https://studio.tenderworld.org`, and `api/_lib/grant.js` ignores
`AI_DEBUG_MODE` outright on a production deployment unless
`AI_DEBUG_ALLOW_PRODUCTION` is set too. `?aidebug=1` in the browser lights up
every button and then earns a 401 — which is exactly what `src/ai/debugMode.js`
says it does.

To develop against a backend that honours debug grants, run one:
`vercel dev` with `AI_DEBUG_MODE=1` and `OPENAI_API_KEY` set, then point the
editor at it with `API_PROXY=http://localhost:3000 npm run dev`. A debug run is
still a real model call on a real key — it skips the accounting, not the bill.

Everything that is not one of the two model calls — the clock, the listener,
the cadence, the executor, the panel — runs with no account at all.
