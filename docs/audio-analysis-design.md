# Audio Analysis: how the drum meters work, and why

Reference for the Audio Analysis node's internals. If you are trying to *use* the node, start with
[Working with Audio](audio-web.md) — this page is for anyone changing the detector, and exists
mainly so the next person does not re-introduce a class of bug that has now been fixed twice.

Code: [`src/audio/RealtimeAudioAnalysis.js`](../src/audio/RealtimeAudioAnalysis.js) (analysis),
[`src/core/AudioAnalysisProcessor.js`](../src/core/AudioAnalysisProcessor.js) (triggering),
[`src/audio/BrowserAudioCapture.js`](../src/audio/BrowserAudioCapture.js) (capture and frame clock).

## The shape

Two lines, deliberately separated:

```
audio -> band split -> RMS -> attack/release -> normalise -> METER (0..1)
METER -> threshold -> rising edge -> TRIGGER
```

Everything adaptive lives on the first line, where its only job is to land the meter in a
predictable 0..1 range. The second line is a plain comparison on this frame's number. That split is
what makes a threshold findable by hand: put the `*Meter` output on screen, watch where it peaks
when the drum hits, and set the threshold under that.

## The two kinds of meter

They are normalised differently because they answer different questions. Getting this wrong is the
bug described below, so it is worth being explicit.

| | `low` / `mid` / `high` | `kick` / `snare` / `hat` |
|---|---|---|
| Question | how much energy is in this band? | is a drum hitting? |
| Used for | modulation | thresholds and triggers |
| Normalised by | shared auto-gain, then a fixed per-band scale | that band's **own** slow average |
| Steady loud material | reads high | reads ~0 |

A tonal meter must read loudness, so a reference that converged on the signal would be wrong — a
quiet unchanging band would report full scale. An instrument meter is the opposite case: reading
zero on a steady band is exactly right, because a band that is merely loud is not an event. The
same mechanism is a trap in one place and the correct tool in the other.

## The bug this replaced

**Symptom.** Kick detection held for a few seconds, fell apart for a few seconds — missed hits and
spurious ones — then recovered. The same musical phrase detected cleanly one bar and not the next.

**Cause.** The instrument meters were scaled by the shared auto-gain, which is computed from the
mean magnitude of the *entire spectrum*. So anything anywhere in the spectrum moved the kick meter.

Measured, adding a hat/synth layer with no energy at all below 2 kHz:

| layer added | effect on the kick meter |
|---|---|
| bass note, 45–95 Hz | 0.94x |
| hat/synth layer, 2k–16k Hz | **0.03x** |

Over eight bars of an identical kick pattern, with that layer entering halfway:

```
bar   kick-meter peak      triggers/bar (2 expected)
 3    0.569  0.574         2
 4    0.573  0.304         1
 5    0.165  0.094         0
 7    0.029  0.024         0
```

Because the auto-gain moves on a 1.5 s time constant, the transition took seconds in each
direction — hence "right for seconds, wrong for seconds". The threshold was not mis-set; it was
being asked to sit on a quantity that meant something different in every bar.

**Fix.** `kick`/`snare`/`hat` now measure their band against a slow (1 s) running average of that
band's own level, mapped logarithmically:

```
contrast = fast_envelope / slow_reference        (1 = nothing happening)
meter    = clamp01( log2(contrast) / log2(8) )   (8 = +18 dB above background = full scale)
```

Same eight bars after the fix: the peak holds at 0.861–0.868 throughout, and detection is 15/16
with zero spurious triggers at thresholds of 0.4, 0.5 **and** 0.6 alike. The threshold stopped
being critical, which is the real test.

## Three failures that fell out of the same change

**A held bass note used to block the kicks over it.** Sharing the kick's 40–110 Hz band, it parked
the meter partway up, eating the detector's hysteresis so the meter never fell far enough to
re-arm. A contrast meter reads it as the non-event it is. 13/16 → 15/16, meter returning to 0
between hits in every bar.

**The meter could latch and stop triggering entirely.** `meter` was clamped to 1.0 but the envelope
behind it was not, so a wound-up gain could pin it at the clamp for seconds. Re-arming needs the
meter to fall back below the threshold, so the instrument went *permanently silent* — 0 triggers
for a whole bar after a quiet intro, with the kick playing loudly. A ratio against a converging
reference cannot stay pinned, and the detector also gained a fall-from-peak re-arm as a structural
guarantee: an instrument can never latch shut whatever the meter does or wherever the threshold
sits. 9/12 → 12/12.

**The first several seconds of every track under-read.** The auto-gain ramped from 1, which is five
time constants — about eight seconds — before the meters meant anything, and playback almost always
starts on a downbeat. It now seeds from the first frame. The per-band reference has the matching
problem and the matching fix: it runs as a plain running mean (`1/frames`) until it has its full
window, so it does not carry whatever the first frame happened to contain. Seeding it to that frame
instead would begin the reference at the height of a kick and suppress the whole first phrase.

## The frame clock

The analysis is driven from `requestAnimationFrame`, so a stalled frame means audio played that was
never sampled. The frame that arrives afterwards describes one instant, and advancing the filters
by the whole elapsed time treats that instant as if it had been true for the entire gap.

For the background reference that is destructive rather than merely late. Stall for five seconds,
resume on a kick transient, and the reference is handed the loudest the band ever gets as its new
idea of normal:

```
stall 5s, ending on a kick onset    first peaks after the stall     detected
  unclamped dt                      0.003  0.318  0.589  0.746      14/16
  dt clamped to 0.1 s               0.711  0.778  0.833  0.854      15/16
```

`BrowserAudioCapture._frameDelta()` bounds the step at 0.1 s, matching the clamp
`AudioAnalysisProcessor` already applied to its own trigger clock. Under-advancing is the safe
direction for a background estimator: it lags briefly rather than being poisoned.

## Known limits

- **Frame-rate sensitivity.** The AnalyserNode is polled at RAF rate, so the meter peak for one
  kick spans about 8% across 30–120 fps, degrading below that (0.701 at 12 fps vs 0.910 at 60).
  Removing this entirely means moving the analysis into an AudioWorklet at a fixed rate, which
  needs an FFT implementation in the worklet — a real piece of work, not yet done.
- **The tonal meters are still whole-spectrum coupled.** `low`/`mid`/`high` go through the shared
  auto-gain, so a bright layer still moves them. This is deliberate for now: they are modulation
  values rather than trigger sources, so the coupling degrades them rather than breaking them, and
  changing it would change what every existing patch's `low` output does.
- **A kick on the very first analysed frame is invisible.** The reference has no history to measure
  against yet. Inherent to the approach and harmless at playback start.
- **A bass note's onset is genuinely ambiguous** with a kick in 40–110 Hz. The contrast meter
  rejects *sustained* bass, but a plucked bass note starting where no kick is playing is a real
  onset in the kick band, and no band-limited detector can rule it out with certainty.

## Behaviour changes for existing patches

`kickMeter`/`snareMeter`/`hatMeter`, and the `audioKick`/`audioSnare`/`audioHat` expression
variables, now mean **contrast**, not level. A steady band reads ~0 instead of parking mid-scale.
If you were using `hat` as a continuous brightness modulator, use `high` instead. Existing
thresholds near 0.5 should land better than before, but they are worth a fresh look.

## Tests

- [`tests/realtimeAudioAnalysis.test.js`](../tests/realtimeAudioAnalysis.test.js) — the meters,
  including the cross-band independence that was the original bug, and the no-latch invariant.
- [`tests/audioAnalysisProcessor.test.js`](../tests/audioAnalysisProcessor.test.js) — the trigger
  decision, including that an instrument can never latch shut.
- [`tests/browserAudioCaptureFrameDelta.test.js`](../tests/browserAudioCaptureFrameDelta.test.js) —
  the frame clock's bounds.
