# The Audio panel

`Tools → Audio…` (`Mod+Alt+A`) opens the patch's single surface for the live audio analysis: the
source, the shape of the meters, the per-drum thresholds, and a live readout of every channel the
analysis produces. Next to each channel is a `+` that drops an **Audio Value** node on the canvas
reading that channel — a plain float you can wire into anything.

## Why a panel

There is one analysis engine behind all of this (`BrowserAudioCapture` →
`RealtimeAudioAnalysis`), producing one set of meters. The meter shaping and the drum thresholds
used to be parameters on the **Audio Analysis** node, which meant two of those nodes in one patch
fought over the engine: the last one written won and the other node's sliders silently did nothing.

Hoisting the meter shaping into the panel also puts a threshold next to the meter it is compared
against, which is the only way a threshold is actually found:

1. Play the track.
2. Watch the drum's **Meter** row — the markers on the bar are where its thresholds sit.
3. Drag the threshold above where the meter idles between hits and below where it peaks on one.
4. Press `+` on the **Trigger** row to deploy it. The node is handed that threshold and owns it
   from then on.

A threshold set under the idle level leaves the trigger permanently held open, which produces
*fewer* triggers, not more. The meter is what makes that visible.

## Where a threshold lives

The panel's **Threshold** slider is where a threshold is *found*: it is what the preview rows below
it read, and what a newly deployed node starts with. The number then *lives* on the deployed node,
as an ordinary `threshold` parameter — which is what makes it:

- **MIDI-mappable.** Select the node, MIDI-learn its Threshold, and the knob moves the decision the
  trigger is actually made on. The marker on that drum's meter row follows the knob, so you can see
  whether the mapping is aimed anywhere useful.
- **Expression-capable.** `=midi`, `=midi * 0.6 + 0.2` (a knob over a floor), or anything else the
  expression system resolves. As everywhere else, a CC arriving on a parameter that holds an
  expression feeds the `midi` identifier rather than overwriting the formula.
- **Undoable, and saved with the patch**, unlike the panel's own settings.

With nodes deployed, the meter row shows one marker per distinct threshold among them. With none,
it shows a single dim marker: where the next one would start.

## Channels

The same fifteen channels the Audio Analysis node exposes as pins, in the order defined by
`src/core/audioAnalysisPins.js`:

| Group | Channels | What they read |
| --- | --- | --- |
| Signal | `level`, `low`, `mid`, `high` | Absolute loudness overall and per band, for modulation |
| Signal | `centroid` (Brightness), `density` (Noisiness) | Spectral descriptors, 0..1 |
| Kick / Snare / Hat | `<drum>Meter` | How far the band has jumped above its OWN recent background — what the threshold is compared to |
| Kick / Snare / Hat | `<drum>` | An envelope that snaps to 1 on a hit and decays |
| Kick / Snare / Hat | `<drum>Trig` | A single-frame pulse on a hit |

The last two are the only channels a threshold applies to — a `*Meter` is what a threshold is
compared *to*, and the continuous meters involve no decision at all — so a tap's Threshold dims
itself on the others rather than sitting there doing nothing.

A trigger row's bar follows the matching envelope rather than the trigger itself: a one-frame pulse
would almost never be caught by the panel's 20 Hz refresh. The number beside it is the trigger.

## The Audio Value node

One channel of the shared analysis, as a single `f32` output. Deployed nodes are named after their
channel ("Kick Trigger", "Low") so a rack of taps stays readable on the canvas; the **Channel**
parameter can be changed afterwards from the parameter panel.

What a tap reads depends on whether its channel involves a decision:

- **No decision** (`level`, `low`, the `*Meter`s, …): one shared number for the whole patch. Two
  taps reading `low` agree, and the panel is showing that same number.
- **A decision** (`kick`, `kickTrig`, …): the tap runs its own detector against its own
  **Threshold**, so one `kickTrig` at 0.3 and another at 0.8 are two instruments off one drum. Two
  taps left at the same threshold still fire on the same frame — they see the same meter.

Either way the channel is resolved on the CPU each frame into one uniform whose name does not depend
on the channel, so **switching channels costs no shader rebuild** — it is a different number in the
same slot.

Like Hold, Count and Audio Analysis, everything it reads has memory across frames (the meters'
followers, each trigger's armed state), which a fragment shader has none of. The values are computed
in `AudioAnalysisProcessor` and streamed in as per-frame uniforms.

## The Audio Analysis node

Still present and unchanged: patches built on it keep behaving exactly as they did, including its
own copies of the meter shaping and thresholds — while such a node is in the graph, its shaping
drives the engine and the panel's does not. New patches should use the panel and the taps.

## Where things live

| File | Role |
| --- | --- |
| `src/ui/AudioSettingsPanel.js` | The panel: source, meter shape, thresholds, channel rows, deploy |
| `src/audio/audioAnalysisSettings.js` | The shared shaping, and the per-drum deploy defaults (localStorage-backed) |
| `src/core/numericParam.js` | Resolves an `=expr` parameter a CPU processor needs as a number, `midi` / `osc` included |
| `src/audio/audioAnalysisTaps.js` | This frame's channel values, and the labels the UI uses |
| `src/core/AudioAnalysisProcessor.js` | Meters → thresholds → triggers, once per frame, on the CPU |
| `src/core/audioAnalysisPins.js` | The channel list every consumer agrees on |

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
