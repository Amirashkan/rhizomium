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
    return;
  }

  // Stored in both params and props for compatibility across node kinds.
  if (!node.params) node.params = {};
  node.params[paramName] = value;
  if (!node.props) node.props = {};
  node.props[paramName] = value;
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
