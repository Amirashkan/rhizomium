# The AI Performer

You play the music. It plays the visuals.

The performer reads what you send it — OSC from your DAW, the audio the editor
is already analysing, and a tempo it keeps with you — and drives the visuals
from a **scenario**: a written score that says what the set is made of and what
it is allowed to do.

```
 a folder ──> manifest ──> ShowBuilder ──> patches ──> scenes ──┐  (once,
 (media)      (the plan)        ▲                     scenario ─┘   at a desk)
                                └── your own clips, onto the looks

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

   With no scenes on the rig yet, start one tab earlier: **Show** → **Example**
   → **Build the show**, which makes the looks first. See
   [The manifest](#the-manifest-building-a-show-that-does-not-exist-yet) below.
   If the show is built on footage you already have, **Open folder…** first and
   point it at the directory holding both — see
   [The show folder](#the-show-folder-building-on-your-own-footage).

   Already holding a set — your own, or one somebody sent you — on a rig with
   none of its scenes on it? Open it in **Scenario** and press **Build the
   missing looks**. See
   [The set that does exist](#the-set-that-does-exist-on-a-rig-that-does-not).
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
| `audio` | play, pause or stop the set's own bed — see [the sound in the folder](#the-sound-in-the-folder) |
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
| `allowAudio` | true | the set may play the beds its looks name; off leaves the sound to you |
| `masterCeiling` / `masterFloor` | 1 / 0 | a house limit the performer cannot undo |
| `director.freedom` | 0.4 | 0 = play it as written, 1 = treat it as a starting point |

## The manifest: building a show that does not exist yet

A scenario can only name things that are already on the rig. That is the right
rule at showtime — a section pointing at a scene somebody renamed is an inert
section and a warning, never a set that stops in front of an audience — and it
leaves one case with nowhere to start: you have the show in your head and an
empty editor. Asked for a scenario against a rig with no scenes on it, the
model is told outright not to invent any, so it writes a set whose every look
is unset. Correct, and useless.

A **manifest** is the other end of that. It describes the looks *before they
exist*, in prose, and **Build the show** turns it into them:

1. One patch-generator call per look, each installed as a scene under the
   look's name.
2. One scenario call — which can now name those scenes, because by then they
   are on the rig.
3. A binding pass that makes each section play the scene actually built for it.

Step 3 is not a safety net for a bad model. It is the step that makes the
difference between a document *about* a show and the show: after it, every
patch that was built is played by a section, and the scenario's names and the
rig's names are the same names. A look nothing in the set plays gets a section
of its own rather than being dropped — you paid for that patch.

```jsonc
{
  "show": "Night set",
  "brief": "A 40-minute support slot. Dark and patient, one drop I fire by hand.",
  "palette": "near-black, cold blue-grey, one white accent only in the drop",
  "bpm": 128,
  "pulse": "metered",            // or "free" — see "Music with no pulse" above

  "looks": [{
    "id": "opening",
    "name": "Opening",
    "brief": "Slow fog drifting across the frame, one cold light source, almost black.",
    "mood": "patient, cold, barely moving",
    "intensity": 0.2,            // where it sits in the shape of the set
    "reactsTo": ["low"],         // audio channels it should visibly answer
    "drivable": ["how fast the fog drifts", "how far the light reaches"],
    "hold": { "bars": 32 },      // or { "seconds": 180 }
    "next": "build"
  }],

  // Straight through to the scenario.
  "signals": [{ "name": "energy", "source": "osc", "address": "/rhizo/perf/energy" }],
  "cues": ["drop", "blackout"],
  "rules": { "minSectionBars": 4 }
}
```

A look with a `scene` instead of a `brief` names one you already have: it costs
nothing and is bound into the set exactly like a generated one, which is how a
show mixes looks you built by hand with looks you had built for you.

`palette` and `brief` are what stop five separately generated patches from
looking like five separate shows — every look call is told the whole set, in
order, and where in it this one sits. `drivable` is the other half: a patch is
being built to be *performed*, so each of those becomes a named node whose
parameter a drive can reach, set to a value with somewhere left to travel. A
parameter already at its maximum on the first frame is a fader with no throw.

### What it costs, and what happens when it runs out

A build is one `ai.patch_generator` call per look plus one
`ai.performer_scenario` call — metered exactly like pressing those buttons
yourself, because that is what it is doing. The **Check** button says how many
before you start.

So the rules are about not wasting what you have already spent:

- **Nothing already paid for is thrown away.** A look that fails does not take
  the ones before it with it. A scenario call that fails after the patches are
  built falls back to a set written from the manifest alone, with no model in
  it — plain, but it plays your looks.
- **Out of quota stops the build**, rather than being discovered once per
  remaining look.
- **Stop** ends it after the look being built now. A call already in flight has
  already been paid for, so between calls is the only cancellation worth having.
- **Nothing is loaded.** The scenes are installed, because that is what you
  asked for, and they are inert until something cuts to one. The scenario lands
  in the **Scenario** tab as a document, unloaded, exactly like a drafted one —
  which is what makes this safe to run an hour before doors.

`Save…` writes a `.rzshow.json` you can keep next to the set and rebuild from.

## The show folder: building on your own footage

Everything above builds what a shader can draw from nothing. That leaves out the
artist who shot the material, or who was sent the festival's logo and a plate of
the room — and the patch generator is told outright that it may not use a
**Texture 2D** node, for the good reason that a model cannot supply a file and a
texture node pointing at nothing renders black in front of an audience.

A **show folder** is where the file comes from. It is an ordinary directory:

```
Night set/
  night-set.rzshow.json     the manifest
  media/
    fog-loop.mp4            the footage the show is made of
    grain.png
    plates/room.jpg
  set.wav                   the bed a look can play under itself
```

**Open folder…** on the Show tab takes both halves at once: the manifest fills
the editor, and every clip beside it becomes something a look can name.

```jsonc
"looks": [{
  "id": "opening",
  "name": "Opening",
  "brief": "The room, barely lit, the fog crawling across it and nothing sharp.",
  "media": ["fog-loop", "plates/room.jpg"],
  "drivable": ["how far the fog has eaten the plate"]
}]
```

A reference is whatever you would have said: the filename, the name without its
extension, a folder to take everything out of, or `"*"` for the lot. Case and
punctuation do not matter. A name that matches nothing is a **warning at the
desk** rather than a surprise at build time — and a name two clips answer to is
also a warning, because guessing between them is how the wrong plate ends up in
the drop.

What then happens is the only part worth knowing in detail:

1. The look's patch call is told that its clips are already loaded, on nodes
   named `Media: fog-loop`, and to compose the look around them. That call is
   the only one in the editor allowed to contain a texture node at all, and only
   up to the number of clips you supplied.
2. The clips are put on those nodes the moment the answer arrives — by name,
   then by order, and a spare node gets a clip used twice rather than being left
   showing nothing.
3. The scene is installed **carrying its media inline**, the way a saved project
   does. So the looks survive being copied to the rig's laptop, and cutting to
   one at showtime loads its footage down the same path an opened project takes.

Two limits, both the editor's own rather than this feature's: a video over
**24 MB** and an image over **50 MB** cannot be inlined into a patch, so they are
listed as skipped with the size in the reason. And **four clips to a look**,
because every one of them is decoded on every frame that look is up.

### The sound in the folder

A look can name one file in the folder as its **bed** — the track that plays
under it — and the performer loads it into the Audio panel on the way into that
section, starts it at the top, and stops it when the set stops.

```jsonc
"looks": [{
  "id": "opening",
  "name": "Opening",
  "sound": "set.wav",
  "hold": { "seconds": 96 }
}]
```

Named the same way a clip is, and matched the same way: the filename, the name
without its extension, the path. One file, not a list — there is one analysis
engine and one element behind it, so a second would only be the first one's
silence. A name the folder cannot answer is a warning at the desk.

This is the same transport the Audio panel's own buttons drive, so **it is
exclusive with your live input**: starting a bed stops the microphone, and the
log says so when it happens. A set played to a musician in the room wants no
beds in it at all; a set that arrived with its own — a folder another tool
generated, a fixed piece — wants them, and the sections were written to their
lengths.

A set that names audio signals also keeps the analysis running for as long as
it plays, whether or not the director is on. It used to be kept alive only by
the director or by the Audio panel being open — so a set written against
`level` and `low`, played with the director off, read zero on both and never
moved.

Three ways to turn it off, in descending order of bluntness: leave `sound` out
of the looks, write `"rules": { "allowAudio": false }` in the scenario, or press
stop. The live director is never given the verb at all — a model that decides to
stop the music is a worse night than any parameter it could get wrong.

Whatever happens, it is the performer's own bed that stops: a track you loaded
into the Audio panel yourself is left playing, because you are the one playing
it.

Nothing about a build without a folder changes: no folder open means no clips,
means the prompt, the backend and the installed scenes are exactly what they
were.

### A folder another tool wrote

Not every `manifest.json` is a show. A folder generated somewhere else holds
one that describes something else entirely, and reading it as a set produces a
show with no looks in it — a page of validation errors about a document you
never wrote. So the manifests in a folder are read before anything is opened
from them, and one that is not a show is left where it is and said so plainly.

One foreign format is read rather than ignored:
[`transmissions`](https://github.com/Amirashkan/transmissions), which writes one
project folder per piece.

```
Transmissions/
  2026-09-14-lattice-that-remembers/
    manifest.json           the prompts, the palette, the energy, the files
    media/
      video.mp4             the look's footage
      image.png
      music.mp3             the bed — played under this look
      narration.mp3         named in the notes; the mix is yours
  2026-09-15-salt-clock/
    ...
```

Open the directory — one project, or the whole pool — and the Show tab fills
with the manifest those pieces imply. One project is one look:

| in the project | becomes |
| --- | --- |
| the video and image prompts, and the texture line | the look's **brief** |
| whatever was actually generated | its **media**, so the patch is built on the footage |
| energy 1–5 | its **intensity** |
| the bed's length, and the narration's | its **hold**, in seconds |
| the bed itself | its **sound**, played under it — the same file the hold was measured from |
| every palette in the folder | the show's **palette**, so the looks read as one set |
| the beds that stated a tempo | the show's **bpm** (the median) |

The set is written in seconds and nothing in it is counted in bars: these beds
are ambient, and a tempo detector asked for a BPM on a drone will always find
one and always be wrong. The signals are the four the tool's own exporter
declares — `level`, `low`, `high` and the `push` you send over
`/rhizo/perf/energy` — and there is a cue per piece, so any of them can be
reached by hand mid-set.

What does not cross over is the copy. A transmission's brief is the news and its
vignette is fiction about a person in a room; neither describes an image, and a
patch prompt fed either builds an illustration of a story. The prompts were
written for this and say so: abstract material, no objects, no figures, no text.

It is a manifest like any other once it is there — **edit it before you build**.
The briefs are what each patch will be made of, and twelve looks is twelve
calls.

## The set that does exist, on a rig that does not

The manifest answers "the show is in my head and the editor is empty". The
commoner problem after the first show is the mirror of it: you have the **set**
— written by hand, drafted here, opened from someone else's machine, or carried
over from a rig that is not this one — and every section of it names a scene
that is not loaded. It validates. It loads. It runs. It shows nothing, section
after section, because a look it names is a name and not a patch.

**Scenario → Build the missing looks** is that case. It reads the set in the
editor, works out which sections have nothing to show, and builds one patch per
section. It is the same pipeline as a show build, entered from the other end,
and the differences are all in the word *suitable*:

- **Each look is installed under the name the section already uses.** A section
  that says `{ "scene": "Deep Fog" }` gets a scene called Deep Fog. Nothing is
  renamed, and the set you wrote still reads the way you wrote it.
- **The patch is asked for the nodes your set already reaches for.** Every
  `node`/`param` the section's drives, moves and enter/exit actions address is
  named in the prompt, exactly, as a node that has to exist. This is the whole
  difference between a patch that suits the section and one that fits it: a
  beautiful look whose nodes are called something else is a section with every
  fader wired to nothing.
- **The audio it has to answer comes from the drives that are bound**, not from
  the signal list. A look told it answers everything answers nothing.
- **Your scenario is not rewritten.** No scenario call is made at all — there
  is nothing to write. The drives, moves, cues and rules are the reason you
  wrote the set; a look is not a reason to lose them. Only the looks are bound.
- **A section that plays a preset, or carries its own patch, is left alone.**
  It has a look. And two sections naming the same absent scene get one patch,
  not two.
- **A scene already on the rig costs nothing** and still goes into the plan,
  because every look call is told the whole set in order — a set with holes in
  it describes a different show.

What it costs is one `ai.patch_generator` call per missing look and nothing
else. It says so before it spends anything: the first press names the looks and
the number of calls, the second one builds. Editing the set in between asks
again rather than building the old plan, and while it runs the button is the
**Stop** — which, like every other build here, stops after the look being built
now, because a call in flight is already paid for.

What lands is the same as everywhere else in this panel: the bound set goes
into the editor as a document, unloaded, for you to read before anything plays
it. The scenes, meanwhile, are already installed under the names your sections
use — so a set you were holding that showed nothing is one **Load** from
showing what it says.

A build takes twelve looks at a time. A longer set says which ones it left, and
they are still missing when it finishes, so pressing again picks them up.

If you filled in the brief box above the button, that one line is given to
every look as what the whole set is — the same job `brief` and `palette` do in
a manifest, and the same reason: it is most of what stops separately generated
patches from looking like separate shows.

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

## The timeline, while a set runs

The editor's timeline is the transport at the bottom of the window, and until
a set is playing it is yours. While one is, the performer drives it:

- **Entering a section sets it** to that section's own length — the `hold`,
  counted against the tempo actually being played — and rewinds it.
- **Every frame moves the playhead** to where the section is. A section that
  outlasts its hold wraps rather than parking at the end, the way the bed under
  it loops.
- **Stopping gives it back**: the duration, the loop region and the playhead
  you had before the set borrowed them, and the enable switch as you left it.

So the transport, the bed and the section are one clock rather than three, and
keyframes you wrote on a look play in time with it every time that look is up.
The scenes carry this too: a look built from a manifest is installed with a
timeline set to its hold, so the VJ panel lists the length the set was written
to rather than a default ten seconds, and cutting to a look outside a
performance sets the transport to that look.

Starting a set that has any lengths in it opens the timeline panel, once. It is
never closed for you.

## Safety

- **The musician always wins.** A cue clears anything the director has queued.
  You should never have to fight the software for your own set.
- **PANIC** kills the output and pauses, ignoring `masterFloor` — it is the
  control you reach for when what is on screen *is* the problem.
- **Stop leaves the output where it was.** If the performer faded to 40% for a
  breakdown, stopping does not slam it back to full in front of an audience.
  It does release every standing drive, so your parameters are yours again —
  and it stops the bed it started and gives the timeline back, because neither
  of those is the output and both of them are yours.
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
| `ShowManifest.js` | the manifest: the show as a plan, and the prompts it implies |
| `ShowFolder.js` | the show as a directory: which file is the manifest, which are media, and what a look's `media` and `sound` resolve to |
| `../audio/audioDeck.js` | the Audio panel's transport, addressed by name: how a set plays its own bed |
| `ShowBuilder.js` | manifest in, a set that plays the looks it just built out |
| `ShowBuilder.js` | manifest in, a set that plays the looks it just built out — and `manifestFromScenario()`, the same trip backwards |
| `PerformerOSC.js` | the `/rhizo/perf/*` namespace |
| `../ui/PerformerPanel.js` | the panel |

## The AI, and what it costs

Two grant-gated features, exactly like every other AI feature in the editor
(ARCHITECTURE.md, "Open-core boundary" — setting a tier in devtools buys a
lit-up button and a 401):

- **`ai.performer_scenario`** writes a scenario from a brief. Slow, run once at
  a desk. It is told what scenes, presets, parameters and OSC addresses you
  actually have, and told not to invent any others. Building a show runs it
  last, once the looks exist, which is the whole reason that ordering matters.
- **`ai.patch_generator`** — the editor's own, run once per look by a show
  build. Deliberately not a feature key of its own: a look is a patch, your
  allowance already counts patches, and a separate key would be the same call
  billed under a name that hides what it is.
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
