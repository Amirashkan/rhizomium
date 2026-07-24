// src/data/nodes/InputNodes.js

/**
 * Input node definitions for constants, data sources, and textures
 */
export const InputNodes = {
  // === CONSTANT VALUES ===
  ConstFloat: {
    label: "Float",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "f32" }],
    params: [
      { name: "value", type: "float", default: 0.0, label: "Value" }
    ],
  },

  ConstVec2: {
    label: "Vec2",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec2" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
    ],
  },

  ConstVec3: {
    label: "Vec3",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec3" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
      { name: "z", type: "float", default: 0.0, label: "Z" },
    ],
  },

  ConstVec4: {
    label: "Vec4",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "vec4" }],
    params: [
      { name: "x", type: "float", default: 0.0, label: "X" },
      { name: "y", type: "float", default: 0.0, label: "Y" },
      { name: "z", type: "float", default: 0.0, label: "Z" },
      { name: "w", type: "float", default: 1.0, label: "W" },
    ],
  },

  // === RUNTIME INPUTS ===
  UV: {
    label: "UV",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "uv", type: "vec2" }],
    params: [],
  },

  Time: {
    label: "Time",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "t", type: "f32" }],
    params: [],
  },

  Mouse: {
    label: "Mouse",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    // Single output, following ShaderToy's iMouse (vec4):
    //   .xy = normalized cursor position (0..1)
    //   .z  = 1.0 while a mouse button is held over the preview, else 0.0
    //   .w  = 1.0 on the frame a press begins (click), else 0.0
    pinsOut: [
      { label: "mouse", type: "vec4" },
    ],
    params: [],
  },

  Resolution: {
    label: "Resolution",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [
      { label: "res", type: "vec2" },
      { label: "width", type: "f32" },
      { label: "height", type: "f32" },
      { label: "aspect", type: "f32" },
    ],
    // Preview: the render canvas size (live g.resolution, as before).
    // Display: the monitor's actual native resolution, baked at compile time.
    params: [
      { name: "mode", type: "select", options: ["Preview", "Display"], default: "Preview", label: "Mode" }
    ],
  },

  Pi: {
    label: "Pi",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "pi", type: "f32" }],
    params: [],
  },

  Trigger: {
    label: "Trigger",
    cat: "Input",
    inputs: 1,
    pinsIn: [{ label: "value", type: "f32" }],
    pinsOut: [{ label: "pulse", type: "f32" }],
    params: [
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" }
    ],
  },

  Hold: {
    label: "Hold",
    cat: "Input",
    inputs: 2,
    pinsIn: [
      { label: "value", type: "f32" },
      { label: "pulse", type: "f32" }
    ],
    pinsOut: [{ label: "out", type: "f32" }],
    // Sample-and-hold: latch the value input while the pulse crosses the threshold, then
    // keep holding it after the pulse falls back to 0 (it no longer drops to 0). Mode picks
    // when to sample: "Continuous" re-samples every frame the pulse is high; "Once per
    // trigger" samples a single time on the rising edge of each pulse and holds until the next.
    params: [
      { name: "mode", type: "select", options: ["Continuous", "Once per trigger"], default: "Continuous", label: "Update" },
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" }
    ],
  },

  Count: {
    label: "Count",
    cat: "Input",
    inputs: 1,
    pinsIn: [{ label: "pulse", type: "f32" }],
    pinsOut: [{ label: "count", type: "f32" }],
    // A counter that advances by `step` on each rising edge of the pulse input (when it crosses
    // `threshold`). Like Hold it has no shader-expressible memory, so the running count lives on
    // the CPU in CountNodeProcessor and is streamed in as a per-frame uniform. With "Loop" on,
    // the count wraps around the [min, max] range instead of growing without bound.
    params: [
      { name: "step", type: "float", default: 1.0, label: "Step" },
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
      { name: "loop", type: "bool", default: false, label: "Loop" },
      { name: "min", type: "float", default: 0.0, label: "Min" },
      { name: "max", type: "float", default: 10.0, label: "Max" },
      // Momentary action: resets the running counter to its initial value (Min when Loop is on,
      // otherwise 0). Handled by CountNodeProcessor via ParameterPanel.runParameterAction.
      { name: "reset", type: "button", displayName: "Reset Count", action: "resetCount", description: "Reset the counter to its start value" }
    ],
  },

  AudioAnalysis: {
    label: "Audio Analysis",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    // Live audio analysis + kick/onset detection. The node configures the shared audio-envelope
    // engine (the Band + Follower + ADSR + Shaping controls that used to live in the Audio panel)
    // and reads back the resulting envelope; on top of that it runs a precise kick detector on the
    // band's spectral flux (frame-to-frame spectral change — ~0 for sustained sound, a spike on a
    // hit), self-normalized and gated by an adaptive median+MAD threshold plus a refractory
    // debounce, so the same settings work across tracks. It has no fragment-shader memory,
    // so all of this runs on the CPU in AudioAnalysisProcessor, which streams three uniforms:
    //   level - the live shaped envelope in [0,1] (a continuous value that moves while audio plays)
    //   kick  - a [0,1] envelope that snaps to 1 on a detected hit and decays over Kick Release ms
    //   trig  - a single-frame 1.0 pulse on the detection frame (feeds Trigger/Count/Hold cleanly)
    // Pin 0 is `level` on purpose, so `=node_<id>` (or `=node_<id>_0`) gives the live analysis value.
    // Reference the others with `=node_<id>_1` (kick) and `=node_<id>_2` (trig).
    pinsOut: [
      { label: "level", type: "f32" },
      { label: "kick", type: "f32" },
      { label: "trig", type: "f32" },
      // The raw onset signal the detector compares against Kick Threshold. Wire it to something
      // visible (a Number readout, a brightness) to see what a kick actually measures on your
      // track — Kick Threshold needs to sit below that and above whatever the other hits read.
      { label: "strength", type: "f32" },
    ],
    // Parameters are grouped by WHICH OUTPUT they affect, because that was the confusing part:
    // the follower/ADSR/shaping controls shape the continuous `level` output and have no bearing
    // on kick detection, while threshold/sensitivity/gap only affect `kick` and `trig`. The two
    // sets sat side by side with nothing to say so. Detection comes first (the common use), and
    // the level-shaping groups start collapsed.
    params: [
      // ——— Source: which part of the spectrum everything below looks at ———
      { name: "band", type: "select", options: ["Bass", "Mids", "Highs", "Full", "Custom"], default: "Bass", label: "Band", group: "Source" },
      // Only used when Band is set to Custom. For a kick, roughly 30-120 Hz.
      { name: "customMin", type: "float", default: 40.0, label: "Custom Min (Hz)", group: "Source" },
      { name: "customMax", type: "float", default: 120.0, label: "Custom Max (Hz)", group: "Source" },

      // ——— Kick detection: drives the `kick` and `trig` outputs ———
      // Listens for a few seconds and sets Kick Threshold from what the audio actually contains,
      // so the value is measured instead of guessed. Play the main groove while it runs.
      { name: "calibrate", type: "button", displayName: "Auto-Calibrate", action: "calibrateKick",
        description: "Listen for ~6s and set Kick Threshold from the audio", group: "Kick Detection" },
      // threshold: minimum onset strength, absolute (not relative to recent hits, which would let
      //   a band of pure noise normalize itself into a stream of "strong" onsets). 1.0 means every
      //   bin in the band jumps by the full 30 dB cap in one frame, so raising this always fires
      //   less and 1.0 fires essentially never. Real kicks land around 0.15-0.95; hats and snare
      //   bleed sit near 0.03. Watch the `strength` output to see where yours land.
      { name: "threshold", type: "float", default: 0.12, label: "Kick Threshold", group: "Kick Detection" },
      // sensitivity: how far above the recent-noise baseline (median + sensitivity*MAD) a peak must
      //   stand. Raise it if busy passages produce stray hits, lower it if kicks are missed in
      //   dense material.
      { name: "sensitivity", type: "float", default: 2.5, label: "Sensitivity", group: "Kick Detection" },
      // Reject onsets that fire across the whole spectrum at once (snares, claps, hats), keeping
      // the ones concentrated in the selected band. This is what separates a kick from a backbeat,
      // and it applies to Custom too. Turn it off when the broadband hits ARE the target.
      { name: "isolate", type: "bool", default: true, label: "Isolate (reject broadband)", group: "Kick Detection" },
      // Min gap after a hit before another can fire. 200ms is deliberately longer than a kick's own
      // decay tail (~250ms of audio, whose late ripples used to re-trigger at the old 90ms) and
      // long enough to skip over an intervening hat or snare, while still clearing quarter-note
      // kicks up to ~300 BPM. Lower it for 8th/16th-note kick patterns.
      { name: "refractory", type: "float", default: 200.0, label: "Min Gap (ms)", group: "Kick Detection" },
      // How long the `kick` envelope takes to fall back to 0 after a hit. Purely cosmetic — it
      // shapes the output, it does not affect what gets detected.
      { name: "kickRelease", type: "float", default: 140.0, label: "Kick Release (ms)", group: "Kick Detection" },

      // ——— Level shaping: drives the `level` output only, never detection ———
      { name: "attack", type: "float", default: 50.0, label: "Attack (ms)", group: "Level: Follower", groupCollapsed: true },
      { name: "envRelease", type: "float", default: 200.0, label: "Release (ms)", group: "Level: Follower" },
      { name: "gate", type: "float", default: 0.1, label: "Gate", group: "Level: Follower" },

      { name: "adsrAttack", type: "float", default: 120.0, label: "Attack (ms)", group: "Level: ADSR", groupCollapsed: true },
      { name: "adsrDecay", type: "float", default: 180.0, label: "Decay (ms)", group: "Level: ADSR" },
      { name: "sustain", type: "float", default: 0.7, label: "Sustain", group: "Level: ADSR" },
      { name: "adsrRelease", type: "float", default: 600.0, label: "Release (ms)", group: "Level: ADSR" },

      { name: "curve", type: "select", options: ["Linear", "Exponential", "Sigmoid"], default: "Exponential", label: "Curve", group: "Level: Shaping", groupCollapsed: true },
      // Off by default: auto-normalize divides by a running peak, which pins a steady track near 1.0
      // and makes the value look "stuck". Off gives a dynamic level that visibly reacts to the audio.
      { name: "normalize", type: "bool", default: false, label: "Auto-normalize", group: "Level: Shaping" },
    ],
  },

  RandomValue: {
    label: "Random Value",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "value", type: "f32" }],
    // A clock-driven pseudo-random noise value in [0, 1] (fract(sin(...)) hash on g.time).
    // `speed` controls how fast it churns — higher speed = a new-looking value every frame.
    // (Named RandomValue, not Random, to avoid colliding with the Generators "Random" field node.)
    params: [
      { name: "speed", type: "float", default: 1.0, label: "Speed" }
    ],
  },
};