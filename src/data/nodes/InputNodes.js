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
      { name: "max", type: "float", default: 10.0, label: "Max" }
    ],
  },

  AudioAnalysis: {
    label: "Audio Analysis",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    // Live audio analysis + kick/onset detection. The node configures the shared audio-envelope
    // engine (the Band + Follower + ADSR + Shaping controls that used to live in the Audio panel)
    // and reads back the resulting envelope; on top of that it runs a precise kick detector
    // (absolute floor + adaptive baseline + refractory debounce). It has no fragment-shader memory,
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
    ],
    params: [
      // — Source band (drives the envelope engine's frequency selection) —
      { name: "band", type: "select", options: ["Bass", "Mids", "Highs", "Full", "Custom"], default: "Bass", label: "Band" },
      { name: "customMin", type: "float", default: 60.0, label: "Custom Min (Hz)" },
      { name: "customMax", type: "float", default: 250.0, label: "Custom Max (Hz)" },
      // — Follower (envelope attack/release + noise gate) —
      { name: "attack", type: "float", default: 50.0, label: "Attack (ms)" },
      { name: "envRelease", type: "float", default: 200.0, label: "Release (ms)" },
      { name: "gate", type: "float", default: 0.1, label: "Gate" },
      // — ADSR —
      { name: "adsrAttack", type: "float", default: 120.0, label: "ADSR Attack (ms)" },
      { name: "adsrDecay", type: "float", default: 180.0, label: "ADSR Decay (ms)" },
      { name: "sustain", type: "float", default: 0.7, label: "ADSR Sustain" },
      { name: "adsrRelease", type: "float", default: 600.0, label: "ADSR Release (ms)" },
      // — Shaping —
      { name: "curve", type: "select", options: ["Linear", "Exponential", "Sigmoid"], default: "Exponential", label: "Curve" },
      // Off by default: auto-normalize divides by a running peak, which pins a steady track near 1.0
      // and makes the value look "stuck". Off gives a dynamic level that visibly reacts to the audio.
      { name: "normalize", type: "bool", default: false, label: "Auto-normalize" },
      // — Kick detection (runs on top of the shaped envelope) —
      { name: "threshold", type: "float", default: 0.15, label: "Kick Threshold" },
      { name: "sensitivity", type: "float", default: 1.6, label: "Sensitivity" },
      { name: "refractory", type: "float", default: 90.0, label: "Min Gap (ms)" },
      { name: "kickRelease", type: "float", default: 140.0, label: "Kick Release (ms)" },
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