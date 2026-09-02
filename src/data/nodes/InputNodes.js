// src/data/nodes/InputNodes.js
import {
  TRIGGER_MODES,
  TRIGGER_MODE_THRESHOLD,
  TRIGGER_DEFAULT_MIN_CHANGE,
} from '../../core/triggerMode.js';
import { WAVE_SHAPES, DEFAULT_WAVE_SHAPE } from '../../core/waveform.js';
import {
  AUDIO_TAP_CHANNELS,
  AUDIO_TAP_LABELS,
  AUDIO_THRESHOLD_CHANNELS,
  DEFAULT_AUDIO_TAP_CHANNEL,
} from '../../audio/audioAnalysisTaps.js';

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
    // Two ways to turn a continuous signal into a pulse (see core/triggerMode.js):
    //   "Threshold"       - 1 while the input sits at or above `threshold`, else 0. Stateless, so
    //                       it compiles straight to WGSL.
    //   "On value change" - 1 on any frame the input DIFFERS from the previous frame by more than
    //                       `minChange`, whatever its level — useful for reacting to a stepped
    //                       source (a Count, a held value, a MIDI/OSC-bound param) rather than to
    //                       it crossing a level. A fragment shader has no memory of the previous
    //                       frame, so this mode runs on the CPU in TriggerNodeProcessor and is
    //                       streamed in as a per-frame uniform, like Hold and Count.
    params: [
      { name: "mode", type: "select", options: TRIGGER_MODES, default: TRIGGER_MODE_THRESHOLD, label: "Mode" },
      { name: "threshold", type: "float", default: 0.5, label: "Threshold" },
      { name: "minChange", type: "float", default: TRIGGER_DEFAULT_MIN_CHANGE, label: "Min Change" }
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

  Audio: {
    label: "Audio",
    cat: "Input",
    inputs: 0,
    pinsIn: [],
    pinsOut: [{ label: "out", type: "f32" }],
    // One channel of the live audio analysis, as a single float. THE audio node: the one the Audio
    // panel deploys when you press ＋ next to a meter, and the one you add by hand.
    //
    // It replaced an all-in-one node carrying fifteen output pins and every setting the analysis
    // has. That node was the wrong shape twice over: a patch using two of its pins still dragged
    // the other thirteen across the canvas, and its copies of the shaping settings fought over the
    // one engine that actually exists (see audio/audioAnalysisSettings.js). One node, one channel,
    // one number — and the panel to find them in. Patches saved with the old node are converted on
    // load, one of these per pin they actually used (see core/graphHydration.js).
    //
    // The analysis has memory across frames (the meters' followers, each trigger's armed state),
    // which a fragment shader has none of, so the value is computed on the CPU in
    // AudioAnalysisProcessor and arrives as a per-frame uniform. The uniform's name does not depend
    // on the channel, so switching channels is a different number in the same slot rather than a
    // shader rebuild.
    params: [
      {
        name: "channel",
        type: "select",
        options: AUDIO_TAP_CHANNELS.map((name) => ({ value: name, label: AUDIO_TAP_LABELS[name] })),
        default: DEFAULT_AUDIO_TAP_CHANNEL,
        label: "Channel",
      },
      // Where this tap decides a hit has landed, on its own drum's 0..1 meter. It is a parameter on
      // the NODE rather than a panel setting so it is a first-class control like any other: MIDI-
      // mappable, expression-capable (`=midi`, `=midi * 0.6 + 0.2`), undoable, and saved with the
      // patch. The panel's slider sets what a freshly deployed tap starts at; from then on the tap
      // owns it, and the panel draws it as a marker on that drum's meter so a knob sweep is visible
      // against the signal it is being set against.
      //
      // Meaningless on the continuous channels and on a `*Meter` — a meter is what a threshold is
      // compared TO — so it dims itself there rather than sitting live and doing nothing.
      {
        name: "threshold",
        type: "float",
        default: 0.5,
        min: 0,
        max: 1,
        label: "Threshold",
        activeWhen: { channel: AUDIO_THRESHOLD_CHANNELS },
      },
      // The meters live in the panel, and a threshold is only findable by watching one, so the node
      // carries the way back to it rather than leaving you to hunt through the Tools menu with the
      // node selected.
      {
        name: "panel",
        type: "button",
        displayName: "Open Audio Panel",
        action: "openAudioPanel",
        description: "Show the live meters, the source, and the meter shaping",
      },
    ],
  },

  Wave: {
    label: "Wave",
    cat: "Input",
    inputs: 1,
    pinsIn: [{ label: "sync", type: "f32" }],
    pinsOut: [{ label: "out", type: "f32" }],
    // An LFO: one animated float, shaped by `shape`, driven by the GPU clock. Free-running with
    // nothing wired in; a pulse on `sync` restarts the cycle from Phase, which is what locks it to
    // a beat (an Audio Analysis kickTrig), a Trigger, or anything else that pulses. Restarting on a
    // rising edge needs memory of the previous frame, so — like Hold and Count — that part runs on
    // the CPU in WaveSyncProcessor and arrives as a per-frame uniform.
    //
    // The maths lives in core/waveform.js so the shader, the node's own readout and any CPU
    // consumer (Hold/Count/Trigger) all follow the same curve.
    //
    // Every shape is bipolar (-1..1) and phase-aligned with the sine, so changing shape keeps the
    // motion in step. Most things a wave drives — a radius, a mix amount, a brightness — want a
    // positive value instead, which is what Unipolar is for: it remaps to 0..1 BEFORE amplitude and
    // offset, so Amplitude stays the peak-to-... reading you'd expect in either mode.
    params: [
      { name: "shape", type: "select", options: WAVE_SHAPES, default: DEFAULT_WAVE_SHAPE, label: "Shape" },
      { name: "frequency", type: "float", default: 1.0, min: 0.0, max: 20.0, label: "Frequency (Hz)" },
      { name: "amplitude", type: "float", default: 1.0, label: "Amplitude" },
      { name: "offset", type: "float", default: 0.0, label: "Offset" },
      // In cycles, not radians: 0.25 is a quarter turn, 1.0 is a whole one. Two Waves at the same
      // frequency and 0.25 apart give the quadrature pair that drives circular motion.
      { name: "phase", type: "float", default: 0.0, min: 0.0, max: 1.0, label: "Phase (cycles)" },
      { name: "unipolar", type: "bool", default: false, label: "Unipolar (0..1)" },
      // Square only: the fraction of each cycle spent high.
      { name: "pulseWidth", type: "float", default: 0.5, min: 0.0, max: 1.0, label: "Pulse Width", activeWhen: { shape: "Square" } },
      // Level the sync input has to cross for the cycle to restart. Nothing wired to sync means
      // nothing to threshold, so the panel dims it until the pin is connected.
      { name: "syncThreshold", type: "float", default: 0.5, min: 0.0, max: 1.0, label: "Sync Threshold", activeWhenConnected: 0 },
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