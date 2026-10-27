// src/accessibility/graphDescription.js
//
// The patch as a structured graph, in words.
//
// A screen reader cannot see wires. What it can do is walk a structure: a list of nodes in the
// order the signal flows through them, each with its inputs (and where each one is fed from), its
// outputs (and everything each one feeds), and its parameters. That structure is built here, as
// plain data with no DOM, so the outline in the canvas (GraphNavigator.js), the Describe Patch
// dialog and the tests all read the same thing.
//
// Wiring is read from graph.connections — what the canvas draws — and topped up from each node's
// `inputs` array for any connection the list does not carry, because that array is what the shader
// compiler actually reads. A wire the compiler honours is a wire, whether or not it is drawn.

import { NodeDefs } from "../data/NodeDefs.js";
import { getInputCount, getInputLabel } from "../data/nodeInputs.js";
import { nodeDisplayName, hasCustomNodeName, defaultNodeName } from "../core/nodeName.js";

// ---- pins ------------------------------------------------------------------

/** A pin type as speech: "number" for f32, "colour" for vec4, … — "" for untyped/dynamic pins. */
export function spokenType(type) {
  switch (type) {
    case "f32":
    case "float":
    case "int":
      return "number";
    case "vec2":
    case "uv":
      return "2D vector";
    case "vec3":
    case "vec":
      return "3D vector";
    case "vec4":
    case "color":
    case "rgba":
      return "colour";
    case "texture":
    case "texture2d":
    case "tex":
      return "texture";
    case "texture3d":
      return "3D texture";
    case "field":
      return "field";
    default:
      return "";
  }
}

/** Every input pin of a node: index, label and declared type. */
export function inputPins(node) {
  const def = NodeDefs[node?.kind];
  const count = node ? getInputCount(node) : 0;
  const pins = [];
  for (let i = 0; i < count; i++) {
    const entry = def?.pinsIn?.[i];
    const type = entry && typeof entry === "object" && entry.type ? entry.type : "default";
    pins.push({ index: i, label: getInputLabel(node, i) || `input ${i + 1}`, type });
  }
  return pins;
}

/**
 * Every output pin, matching what the canvas draws: a node with no declared outputs still gets the
 * one port the renderer gives it — except an Output node, whose port leads nowhere.
 */
export function outputPins(node) {
  const def = NodeDefs[node?.kind];
  const declared = def?.pinsOut || [];
  if (declared.length === 0 && def?.cat === "Output") return [];
  const count = declared.length || 1;
  const pins = [];
  for (let i = 0; i < count; i++) {
    const entry = declared[i];
    let label = "";
    let type = "default";
    if (typeof entry === "string") {
      label = entry;
      if (/tex/i.test(entry)) type = "texture";
    } else if (entry && typeof entry === "object") {
      label = entry.label || "";
      type = entry.type || "default";
    }
    pins.push({ index: i, label: label || "out", type });
  }
  return pins;
}

// ---- wiring ----------------------------------------------------------------

/**
 * Every connection in the patch as `{ from: { nodeId, pin }, to: { nodeId, pin } }` — the drawn
 * list, plus any input the node itself says is fed that the list does not carry.
 */
export function patchConnections(graph) {
  const nodes = graph?.nodes || [];
  const known = new Set(nodes.map((n) => n?.id).filter((id) => id !== undefined && id !== null));
  const out = [];
  const fedInputs = new Set();

  for (const c of graph?.connections || []) {
    const fromId = c?.from?.nodeId;
    const toId = c?.to?.nodeId;
    if (!known.has(fromId) || !known.has(toId)) continue;
    const toPin = Number.isFinite(c.to.pin) ? c.to.pin : 0;
    const key = `${toId}:${toPin}`;
    if (fedInputs.has(key)) continue; // an input takes one wire
    fedInputs.add(key);
    out.push({
      from: { nodeId: fromId, pin: Number.isFinite(c.from.pin) ? c.from.pin : 0 },
      to: { nodeId: toId, pin: toPin },
    });
  }

  for (const node of nodes) {
    if (!Array.isArray(node?.inputs)) continue;
    node.inputs.forEach((sourceId, pin) => {
      if (sourceId === null || sourceId === undefined) return;
      // Loose match: ids have arrived as numbers and as numeric strings over the patch format's life.
      const source = nodes.find((n) => n.id == sourceId);
      if (!source || source === node) return;
      const key = `${node.id}:${pin}`;
      if (fedInputs.has(key)) return;
      fedInputs.add(key);
      out.push({ from: { nodeId: source.id, pin: 0 }, to: { nodeId: node.id, pin } });
    });
  }

  return out;
}

// ---- parameters ------------------------------------------------------------

function round(value) {
  if (!Number.isFinite(value)) return String(value);
  const r = Math.round(value * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

function toHex(channel) {
  const n = Math.max(0, Math.min(255, Math.round(channel * 255)));
  return n.toString(16).padStart(2, "0");
}

/**
 * A parameter value as something worth reading aloud: numbers to three places, colours as hex,
 * booleans as on/off, an expression as the expression, a gradient as its stop count.
 */
export function formatParamValue(value, spec = {}) {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string") {
    if (value.trim().startsWith("=")) return `expression ${value.trim()}`;
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  }
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return round(value);
  if (Array.isArray(value)) {
    if (spec.type === "colorstops") return `gradient, ${value.length} stops`;
    const numeric = value.every((v) => typeof v === "number");
    if (numeric && spec.type === "color" && (value.length === 3 || value.length === 4)) {
      const hex = `#${toHex(value[0])}${toHex(value[1])}${toHex(value[2])}`;
      return value.length === 4 && value[3] < 1 ? `${hex}, alpha ${round(value[3])}` : hex;
    }
    if (numeric) return value.map(round).join(", ");
    return `${value.length} items`;
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    return "set";
  }
  return String(value);
}

/** The parameters worth describing: visible ones, in definition order, buttons left out. */
export function describedParams(node) {
  const def = NodeDefs[node?.kind];
  const params = [];
  for (const spec of def?.params || []) {
    if (!spec || spec.hidden || spec.type === "button") continue;
    const stored = node.params && spec.name in node.params ? node.params[spec.name] : spec.default;
    params.push({
      name: spec.name,
      label: spec.displayName || spec.label || spec.name,
      value: stored,
      display: formatParamValue(stored, spec),
      isExpression: typeof stored === "string" && stored.trim().startsWith("="),
    });
  }
  return params;
}

// ---- nodes -----------------------------------------------------------------

/** "Noise #3", or "beat gate (Remap) #3" for a renamed node. */
export function nodeLabel(node) {
  if (!node) return "";
  if (hasCustomNodeName(node)) return `${nodeDisplayName(node)} (${defaultNodeName(node)}) #${node.id}`;
  return `${nodeDisplayName(node)} #${node.id}`;
}

/**
 * One node as structured data: identity, inputs with their sources, outputs with their targets,
 * parameters with display values.
 */
export function describeNode(graph, node, connections = patchConnections(graph)) {
  const byId = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  const def = NodeDefs[node.kind];
  const outs = outputPins(node);

  const inputs = inputPins(node).map((pin) => {
    const wire = connections.find((c) => c.to.nodeId === node.id && c.to.pin === pin.index);
    const source = wire ? byId.get(wire.from.nodeId) : null;
    return {
      ...pin,
      from: source
        ? {
            nodeId: source.id,
            label: nodeLabel(source),
            pin: wire.from.pin,
            pinLabel: outputPins(source)[wire.from.pin]?.label || "out",
          }
        : null,
    };
  });

  const outputs = outs.map((pin) => ({
    ...pin,
    to: connections
      .filter((c) => c.from.nodeId === node.id && c.from.pin === pin.index)
      .map((c) => {
        const target = byId.get(c.to.nodeId);
        return target
          ? {
              nodeId: target.id,
              label: nodeLabel(target),
              pin: c.to.pin,
              pinLabel: getInputLabel(target, c.to.pin) || `input ${c.to.pin + 1}`,
            }
          : null;
      })
      .filter(Boolean),
  }));

  return {
    id: node.id,
    label: nodeLabel(node),
    title: nodeDisplayName(node),
    kind: node.kind,
    kindLabel: def?.label || node.kind,
    category: def?.cat || "",
    bypassed: !!node.bypassed,
    inputs,
    outputs,
    params: describedParams(node),
  };
}

// ---- order -----------------------------------------------------------------

function byPosition(a, b) {
  return (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0) || String(a.id).localeCompare(String(b.id));
}

/**
 * The nodes in reading order.
 *
 *   "flow"     — the way the signal travels: every node after everything that feeds it, sources
 *                first and the output last. Nodes the signal does not order against each other
 *                fall back to canvas position, so the list still reads left to right.
 *   "position" — left to right, then top to bottom, as laid out.
 *
 * A cycle cannot be put in flow order; whatever is caught in one is appended by position.
 */
export function orderNodes(graph, order = "flow", connections = patchConnections(graph)) {
  const nodes = [...(graph?.nodes || [])].filter(Boolean);
  if (order === "position") return nodes.sort(byPosition);

  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const downstream = new Map(nodes.map((n) => [n.id, []]));
  for (const c of connections) {
    if (!indegree.has(c.to.nodeId) || !downstream.has(c.from.nodeId)) continue;
    indegree.set(c.to.nodeId, indegree.get(c.to.nodeId) + 1);
    downstream.get(c.from.nodeId).push(c.to.nodeId);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ready = nodes.filter((n) => indegree.get(n.id) === 0).sort(byPosition);
  const ordered = [];
  while (ready.length) {
    const node = ready.shift();
    ordered.push(node);
    for (const nextId of downstream.get(node.id)) {
      indegree.set(nextId, indegree.get(nextId) - 1);
      if (indegree.get(nextId) === 0) {
        ready.push(byId.get(nextId));
        ready.sort(byPosition);
      }
    }
  }

  if (ordered.length < nodes.length) {
    const placed = new Set(ordered);
    ordered.push(...nodes.filter((n) => !placed.has(n)).sort(byPosition));
  }
  return ordered;
}

// ---- sentences ---------------------------------------------------------------

function list(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function typed(label, type) {
  const spoken = spokenType(type);
  return spoken ? `${label} (${spoken})` : label;
}

/** "input A (number), from Time #1 output t" / "input B, not connected". */
export function inputSentence(pin) {
  const head = `input ${typed(pin.label, pin.type)}`;
  if (!pin.from) return `${head}, not connected`;
  return `${head}, from ${pin.from.label} output ${pin.from.pinLabel}`;
}

/** "output out (colour), feeds Blend #5 input A and Output #9 input color" / "…, not connected". */
export function outputSentence(pin) {
  const head = `output ${typed(pin.label, pin.type)}`;
  if (!pin.to.length) return `${head}, not connected`;
  return `${head}, feeds ${list(pin.to.map((t) => `${t.label} input ${t.pinLabel}`))}`;
}

/** "Scale: 4" / "Speed: expression =sin(time)". */
export function paramSentence(param) {
  return `${param.label}: ${param.display}`;
}

/**
 * A node's wiring in one breath — the description a screen reader gives after the node's name.
 * "Bypassed. 2 inputs, 1 connected: from UV #2. Feeds Blend #5."
 */
export function nodeConnectionSummary(desc) {
  const parts = [];
  if (desc.bypassed) parts.push("Bypassed.");

  const fed = desc.inputs.filter((p) => p.from);
  if (desc.inputs.length === 0) {
    parts.push("No inputs.");
  } else if (fed.length === 0) {
    parts.push(`${desc.inputs.length} ${desc.inputs.length === 1 ? "input" : "inputs"}, none connected.`);
  } else {
    const sources = [...new Set(fed.map((p) => p.from.label))];
    parts.push(
      `${desc.inputs.length} ${desc.inputs.length === 1 ? "input" : "inputs"}, ${fed.length} connected: from ${list(sources)}.`,
    );
  }

  const targets = [...new Set(desc.outputs.flatMap((p) => p.to.map((t) => t.label)))];
  if (desc.outputs.length === 0) {
    parts.push("Final output.");
  } else if (targets.length === 0) {
    parts.push("Output not connected.");
  } else {
    parts.push(`Feeds ${list(targets)}.`);
  }
  return parts.join(" ");
}

/**
 * Everything about one node, for "describe this" (I in the outline, and the dialog): identity,
 * every input and output, and the parameters.
 */
export function nodeFullDescription(desc) {
  const lines = [`${desc.label}, ${desc.kindLabel}${desc.category ? `, ${desc.category}` : ""}.`];
  if (desc.bypassed) lines.push("Bypassed: its input passes straight through.");
  for (const pin of desc.inputs) lines.push(`${capitalize(inputSentence(pin))}.`);
  for (const pin of desc.outputs) lines.push(`${capitalize(outputSentence(pin))}.`);
  if (desc.params.length) {
    lines.push(`Parameters: ${desc.params.map(paramSentence).join("; ")}.`);
  }
  return lines.join(" ");
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * The patch at a glance: size, what reaches the output, where the signal starts, and what is left
 * unconnected. The first thing to hear on opening a patch you cannot see.
 */
export function summarizePatch(graph, order = "flow") {
  const connections = patchConnections(graph);
  const nodes = orderNodes(graph, order, connections);
  const descs = nodes.map((n) => describeNode(graph, n, connections));

  if (descs.length === 0) {
    return { text: "The patch is empty.", nodes: [], connections };
  }

  const sentences = [
    `${descs.length} ${descs.length === 1 ? "node" : "nodes"}, ${connections.length} ${connections.length === 1 ? "wire" : "wires"}.`,
  ];

  const outputs = descs.filter((d) => d.category === "Output");
  for (const out of outputs) {
    const fed = out.inputs.filter((p) => p.from).map((p) => p.from.label);
    sentences.push(fed.length ? `${out.label} is fed by ${list(fed)}.` : `${out.label} has nothing connected.`);
  }
  if (outputs.length === 0) sentences.push("There is no Output node, so nothing reaches the preview.");

  const sources = descs.filter(
    (d) => d.inputs.every((p) => !p.from) && d.outputs.some((p) => p.to.length),
  );
  if (sources.length) sentences.push(`The signal starts at ${list(sources.map((d) => d.label))}.`);

  const isolated = descs.filter(
    (d) => d.inputs.every((p) => !p.from) && d.outputs.every((p) => p.to.length === 0) && d.category !== "Output",
  );
  if (isolated.length) {
    sentences.push(
      `${isolated.length === 1 ? "1 node is" : `${isolated.length} nodes are`} not connected: ${list(isolated.map((d) => d.label))}.`,
    );
  }

  const bypassed = descs.filter((d) => d.bypassed);
  if (bypassed.length) sentences.push(`Bypassed: ${list(bypassed.map((d) => d.label))}.`);

  return { text: sentences.join(" "), nodes: descs, connections };
}

/**
 * A signature of everything the outline shows, cheap enough to compute on every repaint: nodes,
 * names, wiring, bypass, pin counts, selection and — coarsely, since position decides reading order
 * between nodes the signal does not order — where each node sits. Parameter VALUES are left out on
 * purpose: they animate, and the outline reads them fresh when a parameter list is opened.
 */
export function outlineSignature(graph) {
  const parts = [];
  for (const node of graph?.nodes || []) {
    if (!node) continue;
    parts.push(
      `${node.id}:${node.kind}:${node.name || ""}:${node.bypassed ? 1 : 0}:${getInputCount(node)}:${
        Array.isArray(node.inputs) ? node.inputs.join(",") : ""
      }:${Math.round((node.x || 0) / 100)},${Math.round((node.y || 0) / 100)}`,
    );
  }
  for (const c of graph?.connections || []) {
    parts.push(`${c?.from?.nodeId}.${c?.from?.pin}>${c?.to?.nodeId}.${c?.to?.pin}`);
  }
  if (graph?.selection) parts.push(`sel:${[...graph.selection].join(",")}`);
  return parts.join("|");
}
