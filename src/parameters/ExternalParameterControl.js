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
import { discreteParamKind, getParamDef, optionValues } from '../utils/discreteParams.js';

/**
 * The range a new binding should span when the parameter itself does not name one.
 *
 * A dropdown has no min/max in its definition, so both controllers used to fall back to 0..1 —
 * which maps a whole knob sweep onto the first two of nine blend modes. A discrete parameter is
 * addressed by option INDEX, so its natural range is 0..n-1 (0..1 for a toggle, which then
 * switches at the middle of the fader's travel).
 *
 * @returns {{min: number, max: number}|null} null when the parameter is not discrete.
 */
export function discreteControlRange(node, paramName) {
  // A node kind that is not in NodeDefs (a test double, a node built at runtime) yields no
  // definition, so this returns null and the caller keeps its existing min/max fallback.
  const def = getParamDef(node, paramName);
  const kind = discreteParamKind(def);
  if (!kind) return null;
  if (kind === 'boolean') return { min: 0, max: 1 };

  return { min: 0, max: Math.max(1, optionValues(def).length - 1) };
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
 * NOTE: ConstVec component params named 'x'/'y'/'z' must NOT be written to
 * node.x/node.y/node.z — those are the node's canvas position, so writing them
 * would drag the node across the graph whenever a mapped component moved. Only
 * 'value' has a legacy top-level field (node.value).
 */
export function applyControlValue(node, paramName, value) {
  if (!node) return;

  if (paramName === 'value') {
    node.value = value;
    if (!node.params) node.params = {};
    node.params.value = value;
    refreshTextNodeTexture(node);
    return;
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
}

/**
 * Push a value straight into the GPU uniform buffer.
 *
 * This is what keeps external control smooth: the parameter already has a
 * uniform reserved for it (see ParameterUniformManager), so a new value is a
 * buffer write and a redraw rather than a shader rebuild.
 */
export function writeParameterUniform(nodeId, paramName, value) {
  const uniformManager = window.nodeCompiler?.uniformManager;
  if (!uniformManager) return;

  uniformManager.uniformValues.set(`${nodeId}.${paramName}`, value);

  const renderer = window.gpuRenderer;
  if (!renderer) return;

  renderer._updateParameterUniforms?.();
  renderer.render?.();
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
