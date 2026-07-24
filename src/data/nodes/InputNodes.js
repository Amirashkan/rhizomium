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
    // Kick detection, and a continuous level to modulate with. Two knobs, nothing else.
    //
    // Everything the detector needs beyond those two is fixed, because none of it was a real
    // choice: the frequency range is the kick's (30-120 Hz), the minimum gap between hits and the
    // decay of the kick envelope are set to values measured on real music, and the level envelope
    // uses the same settings it always defaulted to. Exposing those as knobs only ever produced
    // more ways to be wrong.
    //
    // A fragment shader has no memory between frames, so this runs on the CPU in
    // AudioAnalysisProcessor, which streams the four outputs in as per-frame uniforms.
    //   level    - continuous 0..1 envelope, moves with the music (pin 0, so `=node_<id>` works)
    //   kick     - snaps to 1 on a detected kick and decays back down
    //   trig     - a single-frame 1.0 pulse on the detection frame (feeds Trigger/Count/Hold)
    //   strength - what the detector measured this frame; Threshold is compared against THIS
    // Reference the others with `=node_<id>_1` (kick), `=node_<id>_2` (trig), `=node_<id>_3`.
    pinsOut: [
      { label: "level", type: "f32" },
      { label: "kick", type: "f32" },
      { label: "trig", type: "f32" },
      { label: "strength", type: "f32" },
    ],
    params: [
      // How strong a hit has to be. Compare against the `strength` output: wire it to a number
      // readout, watch what your track's kicks reach, and set this a bit under that. Raising it
      // always fires less.
      { name: "threshold", type: "float", default: 1.0, label: "Threshold" },
      // How much a hit has to stand out from the last second or so of audio. Raising it fires
      // MORE (it is sensitivity, not strictness): 1 reacts to almost anything that stands out at
      // all, 0 only to hits that tower over everything around them.
      { name: "sense", type: "float", default: 0.6, label: "Sense" },
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