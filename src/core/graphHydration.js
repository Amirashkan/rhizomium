// graphHydration.js — turn saved node/connection records back into live graph
// objects.
//
// This is the half of loading a project that is pure data: no GPU, no editor,
// no side effects. It was lifted out of SaveLoadManager so the read-only web
// viewer (src/viewer/) can rebuild a published patch's graph without dragging
// autosave timers, backup stores and unload handlers along with it.
//
// SaveLoadManager.importNodes()/importConnections() now call straight through
// here, so the editor and the viewer reconstruct a document identically. That
// is the point of the extraction: a viewer that hydrates a patch its own way
// would drift from the editor silently, and the symptom would be a patch that
// renders differently in the two places.

/**
 * Keys handled explicitly below. Everything else on a saved node is copied
 * verbatim, so a node kind that grows a property does not need this file
 * touched — the same rule exportNodes() follows on the way out.
 */
const STRUCTURAL_KEYS = ['id', 'kind', 'position', 'size', 'inputs', 'outputs'];

/** Parameter metadata copied across when present. */
const PARAMETER_KEYS = ['min', 'max', 'step', 'default', 'label', 'units', 'precision'];

/**
 * Rebuild the node list from saved records.
 *
 * IDs are preserved exactly as saved rather than regenerated: parameter
 * expressions reference nodes by id ("=node_14"), so a renumbering pass would
 * quietly break every such reference in the document.
 *
 * @param {Array<object>} nodeData saved node records
 * @returns {Array<object>} live nodes, with `inputs` sized but not yet wired
 */
export function hydrateNodes(nodeData) {
  return (nodeData || []).map((data) => {
    const node = {
      id: String(data.id),
      type: data.kind || 'Unknown',
      kind: data.kind || 'Unknown',
      x: data.position?.x || data.x || 0,
      y: data.position?.y || data.y || 0,
      w: data.size?.width || data.w || 180,
      h: data.size?.height || data.h || 60,
      inputs: [],
      outputs: [],
    };

    if (data.value !== undefined) node.value = data.value;
    if (data.xv !== undefined) node.xv = data.xv;
    if (data.yv !== undefined) node.yv = data.yv;
    if (data.expr !== undefined) node.expr = data.expr;
    if (data.props !== undefined) node.props = { ...data.props };

    for (const key of PARAMETER_KEYS) {
      if (data[key] !== undefined) node[key] = data[key];
    }

    for (const [key, value] of Object.entries(data)) {
      if (!STRUCTURAL_KEYS.includes(key) && !Object.hasOwn(node, key)) {
        node[key] = value;
      }
    }

    // Input slots are positional: an unconnected pin has to stay a hole, or
    // every connection after it lands on the wrong pin.
    node.inputs = new Array(data.inputs?.length || 0).fill(null);

    return node;
  });
}

/**
 * Rebuild the connection list and wire each target node's input slots.
 *
 * Mutates `nodes` — filling in `node.inputs[pin]` is what makes the graph
 * traversable — and returns the connections.
 *
 * @param {Array<object>} connectionData saved connection records
 * @param {Array<object>} nodes nodes from hydrateNodes()
 * @returns {Array<{from: {nodeId: string, pin: number}, to: {nodeId: string, pin: number}}>}
 */
export function hydrateConnections(connectionData, nodes) {
  const connections = (connectionData || [])
    .filter((conn) => conn?.from?.nodeId !== undefined && conn?.to?.nodeId !== undefined)
    .map((conn) => ({
      from: { nodeId: String(conn.from.nodeId), pin: conn.from.pin || 0 },
      to: { nodeId: String(conn.to.nodeId), pin: conn.to.pin || 0 },
    }));

  const nodeMap = new Map((nodes || []).map((node) => [node.id, node]));

  for (const conn of connections) {
    const toNode = nodeMap.get(conn.to.nodeId);
    if (!toNode) continue;

    const toPin = conn.to.pin || 0;
    while (toNode.inputs.length <= toPin) toNode.inputs.push(null);
    toNode.inputs[toPin] = conn.from.nodeId;
  }

  return connections;
}
