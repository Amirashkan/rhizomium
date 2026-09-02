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

The transport reads its state back off the player rather than from the last button pressed, so what
is on screen is what is actually happening: a chip naming the state (**No file** / **Ready** /
**Playing** / **Paused**, or the reason a load or a play failed), one button showing the action that
would change it (Play ⇄ Pause), a Stop that dims when there is nothing to stop, and a **Loop**
toggle — the player has always looped by default, and now says so. The bar seeks on click or drag.

## Why a panel

There is one analysis engine behind all of this (`BrowserAudioCapture` →
`RealtimeAudioAnalysis`), producing one set of meters, so there is one set of settings for it. They
used to be copied onto every **Audio Analysis** node, which meant two of those in one patch fought
over the engine: the last one written won and the other node's sliders silently did nothing. One
setup node, and a panel that edits it, is the same settings with one owner.

The panel is where a threshold is found, because a threshold is only findable next to the meter it
is compared against:

1. Play the track.
2. Watch the drum's **Meter** row — the marker on the bar is where its threshold sits.
3. Drag the threshold above where the meter idles between hits and below where it peaks on one.
4. Press `+` on the **Trigger** row to add a node reading it.

A threshold set under the idle level leaves the trigger permanently held open, which produces
*fewer* triggers, not more. The meter is what makes that visible.

## Where a threshold lives, and how a knob reaches it

The panel's **Threshold** slider is where a threshold is *found* — against the meter it is compared
to, which is the only way. Where it *lives* is the **Audio** node, as an ordinary parameter, which
is what makes it:

- **MIDI-mappable.** Select the node, MIDI-learn its Kick Thresh, and the knob moves the decision
  every reader of that drum is made on. The panel's slider and the marker on the drum's meter follow
  the knob, so you can see whether the mapping is aimed anywhere useful.
- **Expression-capable.** `=midi`, `=midi * 0.6 + 0.2` (a knob over a floor), or anything else the
  expression system resolves. As everywhere else, a CC arriving on a parameter that holds an
  expression feeds the `midi` identifier rather than overwriting the formula.
- **Undoable, and saved with the patch**, unlike the panel's own stored defaults.

The panel edits that node rather than a second copy of the same numbers — two sources for one engine
is the bug this whole arrangement replaced. With no Audio node in the patch it edits the stored
defaults instead, and offers the node: **＋ Audio node — to MIDI-map these**, seeded with the values
as they stand. A patch that never needs to automate its thresholds never needs the node.

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
| `src/ui/AudioSettingsPanel.js` | The panel: source, transport, meter shape, thresholds, channel rows, deploy |
| `src/audio/audioAnalysisSettings.js` | The stored defaults, for a patch with no Audio node (localStorage-backed) |
| `src/core/numericParam.js` | Resolves an `=expr` parameter a CPU processor needs as a number, `midi` / `osc` included |
| `src/audio/audioAnalysisTaps.js` | This frame's channel values, the channel list, and the labels the UI uses |
| `src/core/AudioAnalysisProcessor.js` | Meters → thresholds → triggers, once per frame, on the CPU |
| `src/core/projectMigrations.js` | Converting a patch saved with the old all-in-one node |

The panel's settings are persisted to `localStorage`, not into the patch: they are dialled in
against whatever track is playing, which is a property of the set rather than of the composition. A
deployed node's Threshold is a node parameter and travels with the patch like any other.

## A note on `=midi` in CPU-evaluated parameters

`midi` and `osc` are per-parameter identifiers — `externalControlScope` keys off the node id *and*
the parameter name — so they could never live in the frame-wide context the CPU processors build,
and a threshold written as `=midi` silently fell back to its default in all six of them (Audio
Analysis, Count, Hold, Wave sync, Trigger, Feedback reset), each of which carried a byte-identical
copy of the same evaluator. That evaluator now lives once in `src/core/numericParam.js` and puts
both scopes (plus sibling parameters) in reach, so a knob mapped to any of those thresholds moves
the CPU-side decision and not just the shader-side number.
