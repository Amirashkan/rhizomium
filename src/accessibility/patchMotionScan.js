// src/accessibility/patchMotionScan.js
//
// Reading a patch for fast motion without running it.
//
// The motion check's main evidence is measured: frames of the shader rendered ahead of time
// (motionSafety.js). That measurement can only see what the fragment shader does with its clock,
// though — not values the CPU animates (expressions over `time`, a synced Wave), not compute
// simulations (their textures stand still while the frames are sampled), not audio, not video.
// This fills those gaps from the patch itself, and gives the warning its reasons: it is far more
// useful to read "Wave #4 runs at 8 cycles a second" than "this patch may flash".
//
// Every finding is phrased as what a node does, never as a diagnosis — a fast Wave is only a
// strobe if it ends up driving brightness, and the scan cannot know where it ends up.

import { NodeDefs } from "../data/NodeDefs.js";
import { nodeLabel } from "./graphDescription.js";

/** Oscillation above this many cycles a second is fast enough to warn about. */
export const FAST_RATE_HZ = 3;

const TAU = Math.PI * 2;

function paramValue(node, name) {
  if (node.params && name in node.params) return node.params[name];
  return NodeDefs[node.kind]?.params?.find((p) => p.name === name)?.default;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !value.trim().startsWith("=")) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rate(value) {
  return Math.round(value * 10) / 10;
}

/**
 * The fastest repetition an expression (or a piece of shader code) asks of its clock, in cycles
 * per second — or null when it does not use the clock in a way this can read.
 *
 * Recognises the forms that set a rate: `sin(time * k)` / `cos(k * time)` repeat every 2π/k
 * seconds; `fract(time * k)`, `floor`, `mod`, `step` and `round` jump k times a second. A bare
 * `time * k` inside anything else is read as k/2π — the gentlest interpretation.
 */
export function expressionClockRate(text) {
  if (typeof text !== "string" || !/\btime\b/.test(text)) return null;
  const source = text.replace(/\s+/g, "");
  let fastest = null;
  const consider = (hz) => {
    if (Number.isFinite(hz) && hz > 0 && (fastest === null || hz > fastest)) fastest = hz;
  };

  const product = /(?:\btime\*(-?\d*\.?\d+(?:e-?\d+)?))|(?:(-?\d*\.?\d+(?:e-?\d+)?)\*time\b)/gi;
  const steppy = /\b(?:fract|floor|mod|step|round|ceil|sign)\(([^()]*\btime\b[^()]*)\)/gi;
  const smooth = /\b(?:sin|cos)\(([^()]*\btime\b[^()]*)\)/gi;

  const factors = (text) => [...text.matchAll(product)].map((m) => Math.abs(Number(m[1] ?? m[2])));

  for (const match of source.matchAll(steppy)) {
    const ks = factors(match[1]);
    // fract(time) on its own still steps once a second.
    if (ks.length) ks.forEach(consider);
    else consider(1);
  }
  for (const match of source.matchAll(smooth)) {
    factors(match[1]).forEach((k) => consider(k / TAU));
  }
  if (fastest === null) factors(source).forEach((k) => consider(k / TAU));
  return fastest;
}

/**
 * Scan a patch.
 *
 * @param {object} graph
 * @param {object} [options]
 * @param {number} [options.timeScale=1]  the preview's time scale, which multiplies every rate
 * @returns {Array<{severity: "medium"|"info", nodeId: string|null, message: string, rateHz?: number}>}
 *   "medium" findings are reason enough to warn; "info" ones are only listed alongside a warning
 */
export function scanPatchForMotion(graph, { timeScale = 1 } = {}) {
  const findings = [];
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  let audioReactive = null;

  for (const node of graph?.nodes || []) {
    if (!node || node.bypassed) continue;
    const label = nodeLabel(node);

    switch (node.kind) {
      case "Wave": {
        const hz = numeric(paramValue(node, "frequency"));
        if (hz !== null && hz * scale > FAST_RATE_HZ) {
          const shape = paramValue(node, "shape");
          const hard = shape === "Square" || shape === "Saw" || shape === "Ramp Down";
          findings.push({
            severity: "medium",
            nodeId: node.id,
            rateHz: rate(hz * scale),
            message: `${label} cycles ${rate(hz * scale)} times a second${
              hard ? `, with hard ${shape === "Square" ? "on/off" : "jump"} edges` : ""
            } — a strobe wherever it drives brightness or colour.`,
          });
        }
        break;
      }
      case "RandomValue": {
        const speed = numeric(paramValue(node, "speed"));
        if (speed === null || speed > 0) {
          findings.push({
            severity: "medium",
            nodeId: node.id,
            message: `${label} jumps to a new random value every frame — flicker wherever it drives brightness or colour.`,
          });
        }
        break;
      }
      case "ComputeCellular": {
        const speed = numeric(paramValue(node, "speed"));
        if (speed !== null && speed * scale > FAST_RATE_HZ) {
          findings.push({
            severity: "medium",
            nodeId: node.id,
            rateHz: rate(speed * scale),
            message: `${label} redraws its whole field ${rate(speed * scale)} times a second.`,
          });
        }
        break;
      }
      case "ComputeGlitch": {
        const intensity = numeric(paramValue(node, "intensity")) ?? 0;
        const frequency = numeric(paramValue(node, "frequency")) ?? 0;
        if (intensity >= 0.3 && frequency >= 0.3) {
          findings.push({
            severity: "info",
            nodeId: node.id,
            message: `${label} breaks the image up at random moments.`,
          });
        }
        break;
      }
      case "ComputeParticles": {
        const twinkle = numeric(paramValue(node, "twinkle")) ?? 0;
        if (twinkle >= 0.5) {
          findings.push({
            severity: "info",
            nodeId: node.id,
            message: `${label} makes each particle flicker in brightness.`,
          });
        }
        break;
      }
      case "Audio":
      case "AudioValue":
      case "AudioSampler":
        audioReactive = audioReactive || node;
        break;
      case "Texture2D":
        if (paramValue(node, "sourceType") === "video") {
          findings.push({
            severity: "info",
            nodeId: node.id,
            message: `${label} plays a video, which cannot be checked ahead of time.`,
          });
        }
        break;
      default:
        break;
    }

    // Any text parameter — expressions, and the code of a Custom GLSL/WGSL node — that runs
    // something off the clock faster than the limit.
    for (const [name, value] of Object.entries(node.params || {})) {
      if (typeof value !== "string") continue;
      if (/\baudio(Envelope\w*)?\b/i.test(value)) audioReactive = audioReactive || node;
      const hz = expressionClockRate(value);
      if (hz !== null && hz * scale > FAST_RATE_HZ) {
        const spec = NodeDefs[node.kind]?.params?.find((p) => p.name === name);
        findings.push({
          severity: "medium",
          nodeId: node.id,
          rateHz: rate(hz * scale),
          message: `${label} · ${spec?.displayName || spec?.label || name} changes about ${rate(hz * scale)} times a second.`,
        });
      }
    }
  }

  if (audioReactive) {
    findings.push({
      severity: "info",
      nodeId: audioReactive.id,
      message: "Parts of the patch follow the audio, so they can flash in time with whatever is playing.",
    });
  }
  if (scale > 1) {
    findings.push({
      severity: "info",
      nodeId: null,
      message: `The preview runs at ${rate(scale)}× speed, which speeds every movement up.`,
    });
  }
  return findings;
}
