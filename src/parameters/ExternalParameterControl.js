// src/parameters/ExternalParameterControl.js

/**
 * Shared plumbing for external controllers (MIDI, OSC) that drive node
 * parameters in real time.
 *
 * These controllers all want the same three things: turn a normalised 0-1
 * reading into a parameter value, write that value where codegen will find it,
 * and push it to the GPU without recompiling the shader. Keeping that in one
 * module matters more than it looks — `applyControlValue` encodes a rule about
 * ConstVec components that is easy to get wrong and expensive to get wrong
 * twice.
 */

import { refreshTextNodeTexture } from '../core/TextRasterizer.js';

/**
 * Latest reading from each external controller, keyed "nodeId.paramName".
 *
 * A parameter driven by MIDI or OSC used to be nothing but the controller's
 * output: the reading was written straight over node.params, so a parameter
 * could be a formula or it could be MIDI-controlled, never both. Keeping the
 * raw reading here as well is what lets an expression name it — `=midi +
 * sin(time)` reads this value through the `midi` identifier while the formula
 * stays in the field (see utils/paramReferences.js for the CPU scope and the
 * WGSL mapping).
 *
 * Values are per source, because MIDI and OSC can legitimately claim the same
 * parameter at once and each identifier should report its own controller.
 */
const externalReadings = new Map();

/** Sources that can appear as an identifier inside a parameter expression. */
export const EXTERNAL_CONTROL_SOURCES = ['midi', 'osc'];

/** Record the latest reading a controller produced for a parameter. */
export function recordExternalReading(nodeId, paramName, source, value) {
  if (!EXTERNAL_CONTROL_SOURCES.includes(source)) return;
  const key = `${nodeId}.${paramName}`;
  const entry = externalReadings.get(key) || {};
  entry[source] = value;
  externalReadings.set(key, entry);
}

/**
 * Latest reading for a parameter, or undefined when no controller has sent one.
 *
 * @param {string|number} nodeId
 * @param {string} paramName
 * @param {'midi'|'osc'} [source] omit to take whichever source has spoken,
 *                                preferring MIDI when both have
 */
export function getExternalReading(nodeId, paramName, source = null) {
  const entry = externalReadings.get(`${nodeId}.${paramName}`);
  if (!entry) return undefined;
  if (source) return entry[source];
  return entry.midi ?? entry.osc;
}

/** Drop a parameter's readings — used when a binding goes away or a node is deleted. */
export function clearExternalReadings(nodeId, paramName = null) {
  if (paramName !== null) {
    externalReadings.delete(`${nodeId}.${paramName}`);
    return;
  }
  const prefix = `${nodeId}.`;
  for (const key of Array.from(externalReadings.keys())) {
    if (key.startsWith(prefix)) externalReadings.delete(key);
  }
}

/** Does this parameter currently hold an expression rather than a plain value? */
export function parameterHoldsExpression(node, paramName) {
  const raw = node?.params?.[paramName];
  return typeof raw === 'string' && raw.trim().startsWith('=');
}

/**
 * Map a normalised 0-1 reading onto a parameter's range.
 *
 * @param {number} normalized 0-1 reading from the controller
 * @param {{min?: number, max?: number, curve?: string, inverted?: boolean}} options
 * @returns {number} value in [min, max]
 */
export function mapNormalizedValue(normalized, options = {}) {
  const { min = 0, max = 1, curve = 'linear', inverted = false } = options;

  let value = Number.isFinite(normalized) ? normalized : 0;
  value = Math.min(1, Math.max(0, value));

  if (inverted) value = 1 - value;

  switch (curve) {
    case 'exponential':
      value = value * value;
      break;
    case 'logarithmic':
      value = Math.sqrt(value);
      break;
    case 'linear':
    default:
      break;
  }

  return min + value * (max - min);
}

/**
 * Write a controller-driven value onto a node, bypassing undo tracking.
 *
 * A parameter holding an expression is left alone: the reading is recorded
 * above and reaches the formula as `midi` / `osc` instead of overwriting it.
 * Writing anyway is what made "MIDI or an expression, pick one" the rule —
 * `=midi + sin(time)` was replaced by a bare number on the first CC that
 * arrived.
 *
 * NOTE: ConstVec component params named 'x'/'y'/'z' must NOT be written to
 * node.x/node.y/node.z — those are the node's canvas position, so writing them
 * would drag the node across the graph whenever a mapped component moved. Only
 * 'value' has a legacy top-level field (node.value).
 *
 * @param {object} node
 * @param {string} paramName
 * @param {number} value        mapped value from the controller
 * @param {'midi'|'osc'} [source] controller this reading came from
 * @returns {boolean} true when the value was written onto the parameter, false
 *                    when an expression was preserved instead
 */
export function applyControlValue(node, paramName, value, source = null) {
  if (!node) return false;

  if (source) recordExternalReading(node.id, paramName, source, value);

  if (parameterHoldsExpression(node, paramName)) {
    // The formula owns the parameter; re-rasterise a Text node so a `=midi`
    // inside its content still tracks the controller.
    refreshTextNodeTexture(node);
    return false;
  }

  if (paramName === 'value') {
    node.value = value;
    if (!node.params) node.params = {};
    node.params.value = value;
    refreshTextNodeTexture(node);
    return true;
  }

  // Stored in both params and props for compatibility across node kinds.
  if (!node.params) node.params = {};
  node.params[paramName] = value;
  if (!node.props) node.props = {};
  node.props[paramName] = value;

  // A Text node has no uniform for the controller to write into — its parameters live in the
  // rasterised bitmap — so the equivalent of writeParameterUniform for it is re-rasterising.
  // No-op for every other kind.
  refreshTextNodeTexture(node);
  return true;
}

/**
 * Push a value straight into the GPU uniform buffer.
 *
 * This is what keeps external control smooth: the parameter already has a
 * uniform reserved for it (see ParameterUniformManager), so a new value is a
 * buffer write and a redraw rather than a shader rebuild.
 *
 * The uniform carries the controller's RAW reading. For a plain parameter that
 * is also its value, so nothing changes; for one holding an expression it is
 * what the inlined `midi` / `osc` identifier reads, which is why an expression
 * parameter tracks a controller at 60fps without a recompile either.
 *
 * Drawing the frame is deliberately left to the render loop. A controller
 * message arrives on its own schedule — a knob sweep is a hundred of them a
 * second — and the loop is the only thing that knows what moment of the
 * animation is currently on screen: it renders at its accumulated sim time,
 * which is not wall-clock time (it starts at zero, scales with timeScale, and
 * stops while paused). A frame rendered from here would have to guess that
 * clock, and every wrong guess is a visible jump forwards or backwards in an
 * animated graph — including one whose shader never reads the mapped parameter
 * at all. The loop already re-writes these uniforms and draws every frame, so
 * the value is on screen within a frame anyway.
 */
export function writeParameterUniform(nodeId, paramName, value) {
  const uniformManager = window.nodeCompiler?.uniformManager;
  if (!uniformManager) return;

  // Only into a slot the compiler actually reserved. A parameter that never reaches the shader —
  // the Audio node's thresholds are read on the CPU, and its node emits no code at all — has no
  // uniform, and inserting one here would append a float to a buffer whose size was fixed at
  // compile time: every value after it lands in the wrong field, and the write itself can be
  // rejected outright. The controller still reaches such a parameter, through node.params and the
  // recorded reading.
  const key = `${nodeId}.${paramName}`;
  if (!uniformManager.uniformValues.has(key)) return;

  uniformManager.uniformValues.set(key, value);

  const renderer = window.gpuRenderer;
  if (!renderer) return;

  renderer._updateParameterUniforms?.();

  // A running loop — paused included, it still draws every frame — will present
  // this on its next frame, at the right time.
  if (window.renderLoop?.getState?.()?.running) return;

  // Nothing else is drawing, so draw one frame here. Hold the loop's clock
  // where there is one: a stopped loop keeps the sim time it stopped at, and
  // that is the frame the canvas is showing.
  const simTime = window.renderLoop?.getState?.()?.simTime;
  renderer.render?.(Number.isFinite(simTime) ? { timeSec: simTime } : {});
}

/**
 * Describe every external controller currently driving a parameter.
 *
 * A parameter driven from outside the graph looks exactly like a hand-set one
 * in the parameter panel — the value simply moves on its own — so the UI needs
 * a way to ask "who owns this?". MIDI and OSC keep independent maps and neither
 * clears the other's binding, so a parameter can genuinely be claimed by both;
 * the array keeps that visible instead of hiding one behind the other.
 *
 * @returns {Array<{type: 'midi'|'osc', label: string, source: string,
 *                  enabled: boolean, binding: object}>} empty when unmapped
 */
export function describeExternalControls(nodeId, paramName) {
  if (typeof window === 'undefined') return [];

  const controls = [];

  const midi = window.editor?.midiBinding ?? window.midiBinding;
  const midiBinding = midi?.getBindingForParameter?.(nodeId, paramName);
  if (midiBinding) {
    controls.push({
      type: 'midi',
      label: 'MIDI',
      // Channels are stored 0-based and shown 1-based, as everywhere else.
      source: `CC${midiBinding.cc} (Ch${(midiBinding.channel ?? 0) + 1})`,
      enabled: midiBinding.enabled !== false,
      binding: midiBinding,
    });
  }

  const osc = window.editor?.oscBinding ?? window.oscBinding;
  const oscBinding = osc?.getBindingForParameter?.(nodeId, paramName);
  if (oscBinding) {
    controls.push({
      type: 'osc',
      label: 'OSC',
      // Argument slot only shown when it isn't the usual first one.
      source: oscBinding.argIndex > 0
        ? `${oscBinding.address} [${oscBinding.argIndex}]`
        : oscBinding.address,
      enabled: oscBinding.enabled !== false,
      binding: oscBinding,
    });
  }

  return controls;
}

/**
 * Refresh the canvas so parameter labels track the controller.
 *
 * @param {string} reason passed through to markDirty for invalidation tracing
 */
export function refreshEditorForControlChange(reason) {
  const editor = window.editor;
  if (!editor) return;

  editor.markDirty?.(reason);
  editor.draw?.();
}
