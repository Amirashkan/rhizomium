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

Hoisting them into the panel also puts a threshold next to the meter it is compared against, which
is the only way a threshold is actually found:

1. Play the track.
2. Watch the drum's **Meter** row — the marker on the bar is where the threshold currently sits.
3. Drag the threshold above where the meter idles between hits and below where it peaks on one.
4. Press `+` on the **Trigger** row to deploy it.

A threshold set under the idle level leaves the trigger permanently held open, which produces
*fewer* triggers, not more. The meter is what makes that visible.

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

A trigger row's bar follows the matching envelope rather than the trigger itself: a one-frame pulse
would almost never be caught by the panel's 20 Hz refresh. The number beside it is the trigger.

## The Audio Value node

One channel of the shared analysis, as a single `f32` output. Deployed nodes are named after their
channel ("Kick Trigger", "Low") so a rack of taps stays readable on the canvas; the **Channel**
parameter can be changed afterwards from the parameter panel.

Two things follow from it being a *tap* rather than its own detector:

- Two taps on `kickTrig` fire on the same frame, and read the same number the panel is showing.
- The channel is resolved on the CPU each frame into one uniform whose name does not depend on the
  channel, so **switching channels costs no shader rebuild** — it is a different number in the same
  slot.

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
| `src/audio/audioAnalysisSettings.js` | The shared shaping and thresholds (localStorage-backed) |
| `src/audio/audioAnalysisTaps.js` | This frame's channel values, and the labels the UI uses |
| `src/core/AudioAnalysisProcessor.js` | Meters → thresholds → triggers, once per frame, on the CPU |
| `src/core/audioAnalysisPins.js` | The channel list every consumer agrees on |

The settings are persisted to `localStorage`, not into the patch: they are dialled in against
whatever track is playing, which is a property of the set rather than of the composition.
