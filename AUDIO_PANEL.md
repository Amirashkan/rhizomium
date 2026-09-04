# The Audio panel

`Tools → Audio…` (`Mod+Alt+A`) opens the patch's single surface for the live audio analysis: the
source, the shape of the meters, the per-drum thresholds, and a live readout of every channel the
analysis produces. Next to each channel is a `+` that drops an **Audio Value** node on the canvas
reading that channel — a plain float you can wire into anything.

Two nodes, with one job each:

| | | |
| --- | --- | --- |
| **Audio** | the setup | The analysis's settings — three drum thresholds, attack/release/gain — as node parameters, which is what puts them within reach of a MIDI knob. No outputs; it is not a signal. Added from the node palette, or from this panel. |
| **Audio Value** | one channel | A single `f32` reading one channel. Added from the `+` beside that channel's meter here, and nowhere else — a channel is chosen by watching it move, so it comes from the place where you can. |

Both carry an **Open Audio Setup…** button back to this panel.

## When nothing happens

An audio node with no track playing reads **0** on every channel, and so does everything downstream
— which looks exactly like a broken node. Three things now say so instead of leaving you to guess:

- Adding an Audio node with nothing loaded **opens this panel**, because choosing a source is the
  only thing that can make that node do anything. It stays out of the way when a track is loaded.
- The node's own parameter panel carries a live strip: *"No audio loaded — every channel reads 0.
  Open Audio Setup…"*, which is also the button to fix it. Once a track is playing it turns quiet
  and names it.
- The panel warns above the channel list while nothing is playing.

All three read the same `describeAudioSource()` (`src/ui/AudioSettingsPanel.js`), so they cannot
drift apart.

## Source

Three of them, one at a time — the tabs at the top of the section pick which, and switching stops
whatever the last one was doing. There is one analysis engine, so two sources feeding it would read
as their sum with no way to tell which drum came from where.

**File.** The transport reads its state back off the player rather than from the last button
pressed, so what is on screen is what is actually happening: a chip naming the state (**No file** /
**Ready** / **Playing** / **Paused**, or the reason a load or a play failed), one button showing
the action that would change it (Play ⇄ Pause), a Stop that dims when there is nothing to stop, and
a **Loop** toggle — the player has always looped by default, and now says so. The bar seeks on
click or drag.

**Mic / line-in.** A microphone or an audio interface, picked from the input list. The browser's
speech processing — echo cancellation, noise suppression, automatic gain — is turned off: AGC in
particular flattens exactly the loud/quiet difference a threshold discriminates on. Device *names*
stay blank until the page has been granted microphone access once, so the list fills in properly
after the first Listen.

**System.** Whatever a tab, window or screen is playing, through the browser's screen-share picker
— the only route a page is given to system audio. **Tick "Share audio" in that picker**; without it
the stream arrives with no audio track at all, which the panel reports rather than sitting silently
at zero. Video has to be requested for the checkbox to be offered, and is dropped the moment the
stream arrives.

Neither live source is monitored back out to the speakers. For a microphone that would be a
feedback loop, and shared audio is already audible where it came from. They are measurement taps:
the analysers are branches off the source, and only a file reaches the output.

A recording or export made while a live input is running now carries that audio, the same as one
made while a file is playing.

## Who sets what

**The Audio node sets. The panel shows.** One rule, no exceptions:

| | Audio node | Audio panel |
| --- | --- | --- |
| Thresholds, attack, release, gain | **set here** | shown, next to the meters they are judged against |
| MIDI learn, `=midi` expressions, undo, saved with the patch | yes | — |
| Live meters, the source, deploying a reader | — | here |

There is one analysis engine behind all of this (`BrowserAudioCapture` →
`RealtimeAudioAnalysis`), producing one set of meters, so there is one set of settings for it —
and one place they can be written. A control has to be MIDI-learnable, expression-driveable,
undoable and saved with the patch, and a node parameter is all four; a panel slider was none of
them.

The panel used to carry sliders that wrote to a `localStorage` store beside the node. That store
was a second home for the same numbers: a patch could hold both, the node saying 0.8 and the store
saying 0.3, with which one the engine used depending on whether the patch happened to contain an
Audio node — invisible from either surface. It is gone. With no Audio node the analysis runs on
built-in defaults, the panel says `defaults — no Audio node`, and the button under the readouts
offers one.

Finding a threshold still happens at the panel, because a threshold is only findable next to the
meter it is compared against:

1. Play the track.
2. Watch the drum's **Meter** row — the marker on the bar is where its threshold sits.
3. Press **Edit on Audio #n** and move the threshold until the marker sits above where the meter
   idles between hits and below where it peaks on one.
4. Press `+` on the **Trigger** row to add a node reading it.

A threshold set under the idle level leaves the trigger permanently held open, which produces
*fewer* triggers, not more. The meter is what makes that visible.

For a threshold to mean anything, hits have to land *inside* the meter's range. They did not: full
scale was contrast 8 (a band 8× above its own recent background), and a measured kick idled at ~2
and peaked between 8.4 and 12.8 — so every hit hit the clamp, every hit read exactly 1.0, and the
threshold was inert (the same six triggers at 0.05 as at 0.95). Full scale is 24 now, with a soft
knee above it so nothing ever flattens onto the ceiling: those same peaks land between 0.67 and
0.80, and a threshold at 0.6 passes the loud kicks while rejecting the soft ones.

## How a knob reaches a threshold

Every setting is an ordinary parameter of the **Audio** node, which is what makes it:

- **MIDI-mappable.** Select the node, MIDI-learn its Kick Thresh, and the knob moves the decision
  every reader of that drum is made on. The panel's readout and the marker on the drum's meter
  follow the knob, so you can see whether the mapping is aimed anywhere useful.
- **Expression-capable.** `=midi`, `=midi * 0.6 + 0.2` (a knob over a floor), or anything else the
  expression system resolves. As everywhere else, a CC arriving on a parameter that holds an
  expression feeds the `midi` identifier rather than overwriting the formula. The panel shows the
  formula and, in its tooltip, what it evaluated to this frame — because the formula alone does not
  say where the threshold actually is.
- **Undoable, and saved with the patch.**

Whatever the value comes from, it is clamped to the setting's declared range on the way out of the
node. An expression can produce anything, and a release of −5 ms or a threshold of 40 does not
merely misbehave — it leaves an instrument that can never fire.

One decision per drum, for the whole patch: two Audio Values reading `kickTrig` are two views of one
kick and fire on the same frame.

## Channels

The fifteen channels the analysis produces, in the order defined by
`src/audio/audioAnalysisTaps.js`:

| Group | Channels | What they read |
| --- | --- | --- |
| Signal | `level`, `low`, `mid`, `high` | Absolute loudness overall and per band, for modulation |
| Signal | `centroid` (Brightness), `density` (Noisiness) | Spectral descriptors, 0..1 |
| Kick / Snare / Hat | `<drum>Meter` | How far the band has jumped above its OWN recent background — what the threshold is compared to |
| Kick / Snare / Hat | `<drum>` | An envelope that snaps to 1 on a hit and decays |
| Kick / Snare / Hat | `<drum>Trig` | A single-frame pulse on a hit |

The last two are the only channels a threshold applies to — a `*Meter` is what a threshold is
compared *to*, and the continuous meters involve no decision at all — so a node's Threshold dims
itself on the others rather than sitting there doing nothing.

A trigger row's bar follows the matching envelope rather than the trigger itself: a one-frame pulse
would almost never be caught by the panel's 20 Hz refresh. The number beside it is the trigger.

## The Audio Value node

One channel of the shared analysis, as a single `f32` output. Deployed nodes are named after their
channel ("Kick Trigger", "Low") so a rack of them stays readable on the canvas; the **Channel**
parameter can be changed afterwards from the parameter panel.

It carries no threshold of its own: every channel is decided once, for the whole patch, on the
Audio node — so the number it reads is the number the panel is showing, and two nodes on one channel
always agree.

The channel is resolved on the CPU each frame into one uniform whose name does not depend on the
channel, so **switching channels costs no shader rebuild** — it is a different number in the same
slot.

Like Hold and Count, everything it reads has memory across frames (the meters' followers, each
trigger's armed state), which a fragment shader has none of. The values are computed in
`AudioAnalysisProcessor` and streamed in as per-frame uniforms.

## Loading an older patch

Two conversions run in `src/core/projectMigrations.js`, in both the editor and the web viewer.

**v8 → v9** splits the node that briefly did both jobs: a channel reader named `Audio` becomes an
`AudioValue`, and the per-node thresholds they carried are gathered onto one new `Audio` setup node
(per drum, the tightest one wins — it is the one that was dialled in). Bindings on those thresholds
follow. Nothing dialled in means no node: the stored defaults still hold.

**v7 → v8** converts the old all-in-one Audio Analysis node:

- One channel reader per pin the patch actually **read** — wired, or named by a `=node_<id>_N`
  reference — so a patch that only used `level` comes back as one node rather than fifteen. The
  first keeps the original id, which is what lets the common single-pin case migrate without
  touching a single wire.
- Wiring, expression references (`node_<id>_5` → `node_<newId>`), the per-drum thresholds, and any
  MIDI or OSC binding aimed at one of those thresholds all follow.
- Attack / release / gain do **not**: they are one shared editor setting now rather than a property
  of the document, and writing them from a loaded file would silently re-shape every other patch.

## Where things live

| File | Role |
| --- | --- |
| `src/ui/AudioSettingsPanel.js` | The panel: source, transport, setting readouts, channel rows, deploy |
| `src/audio/audioAnalysisDefaults.js` | What the settings are, their ranges, and their defaults — declarations only |
| `src/data/nodes/InputNodes.js` | The Audio node, whose parameters ARE the settings, built from that declaration |
| `src/core/numericParam.js` | Resolves an `=expr` parameter a CPU processor needs as a number, `midi` / `osc` included |
| `src/audio/audioAnalysisTaps.js` | This frame's channel values, the channel list, and the labels the UI uses |
| `src/core/AudioAnalysisProcessor.js` | Meters → thresholds → triggers, on the analysis clock, on the CPU |
| `src/audio/BrowserAudioCapture.js` | The sources (file, mic, system audio), the analysis clock, the envelope globals |
| `src/core/projectMigrations.js` | Converting a patch saved with the old all-in-one node |

The settings travel with the patch, on the Audio node, like any other node parameter. Nothing about
the analysis is stored outside it.

## The analysis clock

The analysis does not run on the render frame. It has its own ~8 ms timer, and the trigger
decisions — meter → threshold → rising edge — are taken on every one of its steps.

This used to be frame-driven, which quietly tied hit detection to the frame rate. At 20 fps a kick
whose meter rose and fell inside 50 ms was never sampled above the threshold at all: the hit was
not late, it was **gone**, and it went missing exactly when the patch was heaviest and most worth
watching. Measured with `requestAnimationFrame` blocked outright, the detector now still finds
every kick in the track; before, it would have found none.

A frame is still where the value reaches the GPU, and that is one number per frame. So the taps
carry a per-drum **fire count** alongside the 0/1 channels: a reader compares it with the count it
last saw, and a hit that landed between two frames still produces exactly one frame of `1` — never
missed, never held on for two. Measured on a track with 12 kicks: 12 pulses, longest run of `1`s
exactly one frame. The panel's trigger rows read the same count, which is the only way a 20 Hz
readout can honestly report an 8 ms event.

The render loop still drives a step as a fallback, and the two de-dupe, so the analysis stays live
in a context where no timer is running (a test, a headless run) or where timers are throttled
harder than frames.

## A note on `=midi` in CPU-evaluated parameters

`midi` and `osc` are per-parameter identifiers — `externalControlScope` keys off the node id *and*
the parameter name — so they could never live in the frame-wide context the CPU processors build,
and a threshold written as `=midi` silently fell back to its default in all six of them (Audio
Analysis, Count, Hold, Wave sync, Trigger, Feedback reset), each of which carried a byte-identical
copy of the same evaluator. That evaluator now lives once in `src/core/numericParam.js` and puts
both scopes (plus sibling parameters) in reach, so a knob mapped to any of those thresholds moves
the CPU-side decision and not just the shader-side number.
