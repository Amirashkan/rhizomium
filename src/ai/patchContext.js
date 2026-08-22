/**
 * patchContext.js - the patch, trimmed down to what a model needs to read it.
 *
 * A saved project carries a lot that is meaningless to a language model and
 * expensive to send: embedded texture data URLs, cached previews, MIDI and OSC
 * bindings, viewport state. What is left after taking those out is the graph
 * itself — which nodes, which parameters, which wires — and that is the whole
 * of what a review or a refactor reasons about.
 *
 * This is also a privacy boundary in a small way: whatever this function keeps
 * is what leaves the artist's machine.
 */

/**
 * Past this many nodes a patch stops fitting comfortably in one call, and the
 * answer gets worse rather than more thorough. Refuse rather than truncate:
 * a review of two-thirds of a patch, presented as a review, is misleading.
 */
export const MAX_NODES = 400;

export class PatchTooLargeError extends Error {
  constructor(count) {
    super(
      `This patch has ${count} nodes, more than the ${MAX_NODES} an AI call can read at once. ` +
        'Try it on a smaller patch.'
    );
    this.name = 'PatchTooLargeError';
    this.nodeCount = count;
  }
}

export class EmptyPatchError extends Error {
  constructor() {
    super('There is nothing on the canvas yet.');
    this.name = 'EmptyPatchError';
  }
}

/**
 * Build the model-facing view of the current project.
 *
 * @param {Object} projectData - what SaveLoadManager.exportProject() returns.
 * @returns {{nodes: Array, connections: Array, nodeCount: number}}
 */
export function buildPatchContext(projectData) {
  const nodes = Array.isArray(projectData?.nodes) ? projectData.nodes : [];
  const connections = Array.isArray(projectData?.connections) ? projectData.connections : [];

  if (!nodes.length) throw new EmptyPatchError();
  if (nodes.length > MAX_NODES) throw new PatchTooLargeError(nodes.length);

  return {
    nodes: nodes.map(trimNode),
    connections: connections.map((conn) => ({
      from: { nodeId: String(conn?.from?.nodeId ?? ''), pin: conn?.from?.pin ?? 0 },
      to: { nodeId: String(conn?.to?.nodeId ?? ''), pin: conn?.to?.pin ?? 0 },
    })),
    nodeCount: nodes.length,
  };
}

function trimNode(node) {
  const trimmed = {
    id: String(node.id),
    kind: node.kind,
    x: Math.round(node.position?.x ?? node.x ?? 0),
    y: Math.round(node.position?.y ?? node.y ?? 0),
  };

  // The artist's own name for a node says more about intent than anything
  // else in the document — worth every token it costs.
  if (node.name) trimmed.name = node.name;
  if (Number.isFinite(node.inputCount)) trimmed.inputCount = node.inputCount;

  const params = trimParams(node.params);
  if (params) trimmed.params = params;

  return trimmed;
}

/**
 * Keep parameter values, drop parameter payloads.
 *
 * A texture's data URL or a rasterized font can be megabytes and tells a model
 * nothing it can act on; the fact that the parameter is set does.
 */
function trimParams(params) {
  if (!params || typeof params !== 'object') return null;

  const trimmed = {};
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      if (value.startsWith('data:')) {
        trimmed[name] = '<embedded data>';
      } else if (value.length > 2000) {
        // Custom GLSL bodies are worth sending; a novel is not.
        trimmed[name] = `${value.slice(0, 2000)}\n/* … truncated */`;
      } else {
        trimmed[name] = value;
      }
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      trimmed[name] = value;
      continue;
    }

    if (Array.isArray(value)) {
      // Colours and vectors are short; anything long is sample data.
      trimmed[name] = value.length <= 16 ? value : `<${value.length} values>`;
      continue;
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length <= 8) trimmed[name] = value;
      else trimmed[name] = `<${keys.length} fields>`;
    }
  }

  return Object.keys(trimmed).length ? trimmed : null;
}
