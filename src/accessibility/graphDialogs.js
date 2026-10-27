// src/accessibility/graphDialogs.js
//
// The patch, operated through ordinary form controls.
//
//   Node → Pins → Connect Pins…      pick an output and an input from two lists
//   Node → Pins → Disconnect Pins…   pick wires to remove from a list
//   Go to node… (G in the outline)   jump to a node by name
//   Help → Describe Patch…           the whole patch as headings and lists
//
// Each is built from native <select>, <input> and headings on purpose: those are the controls
// every screen reader and every switch or voice-control setup already knows how to drive, which a
// custom widget would have to earn. They are also a quicker route than dragging a wire for anyone
// who knows the name of what they want to connect.

import { modalManager } from "../ui/ModalManager.js";
import {
  describeNode,
  orderNodes,
  patchConnections,
  summarizePatch,
  nodeLabel,
  inputSentence,
  outputSentence,
  paramSentence,
  spokenType,
} from "./graphDescription.js";
import { connectPorts, disconnectInputs } from "./graphEdits.js";
import { announce } from "./announcer.js";
import { getA11ySettings } from "./a11ySettings.js";

let fieldIds = 0;

function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "className") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function portValue(nodeId, pin) {
  return `${nodeId}::${pin}`;
}

function parsePortValue(value) {
  const at = String(value || "").lastIndexOf("::");
  if (at < 0) return null;
  return { nodeId: value.slice(0, at), pin: Number(value.slice(at + 2)) };
}

function typeSuffix(type) {
  const spoken = spokenType(type);
  return spoken ? ` (${spoken})` : "";
}

/**
 * A labelled, filterable list: a search field above a native listbox. Typing narrows the options
 * (by node name, pin name or type) without losing the current choice when it still matches.
 *
 * `groups` is [{ label, options: [{ value, text, search }] }].
 */
function filterableList({ label, filterLabel, groups, size = 8, multiple = false }) {
  const id = `rz-gd-${++fieldIds}`;
  const wrap = el("div", { className: "rz-gd-field" });
  const heading = el("label", { className: "rz-gd-label", for: id }, label);
  const filter = el("input", {
    type: "search",
    className: "rz-gd-filter",
    placeholder: "Filter…",
    "aria-label": filterLabel,
    "aria-controls": id,
    autocomplete: "off",
    spellcheck: "false",
  });
  const select = el("select", { id, className: "rz-gd-list", size, multiple });

  const render = () => {
    const query = filter.value.trim().toLowerCase();
    const kept = new Set([...select.selectedOptions].map((o) => o.value));
    select.replaceChildren();
    let shown = 0;
    for (const group of groups) {
      const options = group.options.filter((o) => !query || o.search.includes(query));
      if (!options.length) continue;
      const parent = group.label ? el("optgroup", { label: group.label }) : select;
      for (const option of options) {
        const opt = el("option", { value: option.value }, option.text);
        if (kept.has(option.value)) opt.selected = true;
        parent.appendChild(opt);
        shown += 1;
      }
      if (parent !== select) select.appendChild(parent);
    }
    if (!shown) {
      select.appendChild(el("option", { disabled: true, value: "" }, "Nothing matches"));
    } else if (!multiple && select.selectedIndex < 0) {
      const first = [...select.options].find((o) => !o.disabled);
      if (first) first.selected = true;
    }
  };

  filter.addEventListener("input", render);
  // Down from the filter goes straight into the list it filters.
  filter.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      select.focus();
    }
  });
  render();

  wrap.append(heading, filter, select);
  return { wrap, select, filter, render };
}

function selectValue(select, value) {
  if (value === null || value === undefined) return;
  const option = [...select.options].find((o) => o.value === value);
  if (option) option.selected = true;
}

// ---- Connect Pins ---------------------------------------------------------------

/**
 * Connect any output to any input.
 *
 * @param {object} options
 * @param {object} options.editor
 * @param {{nodeId, pin}} [options.from]   output to start with
 * @param {{nodeId, pin}} [options.to]     input to start with
 * @param {(result) => void} [options.onDone]  after closing; result.to is set when a wire was made
 */
export function openConnectDialog({ editor, from = null, to = null, onDone = null } = {}) {
  const graph = editor?.graph;
  if (!graph?.nodes?.length) {
    announce("The patch is empty — there is nothing to connect.");
    modalManager.toast?.("The patch is empty — add nodes first.", "info");
    return null;
  }
  const order = getA11ySettings().get("outlineOrder");
  const connections = patchConnections(graph);
  const descs = orderNodes(graph, order, connections).map((n) => describeNode(graph, n, connections));

  const outputGroups = descs
    .filter((d) => d.outputs.length)
    .map((d) => ({
      label: d.label,
      options: d.outputs.map((pin) => {
        const fed = pin.to.length;
        const text = `${d.label} · ${pin.label}${typeSuffix(pin.type)}${fed ? ` — feeds ${fed} ${fed === 1 ? "input" : "inputs"}` : ""}`;
        return { value: portValue(d.id, pin.index), text, search: `${text} ${d.category}`.toLowerCase() };
      }),
    }));
  const inputGroups = descs
    .filter((d) => d.inputs.length)
    .map((d) => ({
      label: d.label,
      options: d.inputs.map((pin) => {
        const text = `${d.label} · ${pin.label}${typeSuffix(pin.type)}${pin.from ? ` — now from ${pin.from.label}` : ""}`;
        return { value: portValue(d.id, pin.index), text, search: `${text} ${d.category}`.toLowerCase() };
      }),
    }));

  const body = el("div", { className: "rz-gd" });
  body.appendChild(
    el("p", { className: "rz-gd-intro" }, "Choose the output the wire starts from and the input it lands on."),
  );
  const fromList = filterableList({ label: "From output", filterLabel: "Filter outputs", groups: outputGroups });
  const toList = filterableList({ label: "To input", filterLabel: "Filter inputs", groups: inputGroups });
  const status = el("p", { className: "rz-gd-status", role: "status", "aria-live": "polite" });
  body.append(fromList.wrap, toList.wrap, status);

  if (from) selectValue(fromList.select, portValue(from.nodeId, from.pin));
  if (to) selectValue(toList.select, portValue(to.nodeId, to.pin));

  // Say what the chosen input already has, so replacing a wire is never a surprise.
  const describeChoice = () => {
    const target = parsePortValue(toList.select.value);
    const source = parsePortValue(fromList.select.value);
    const pin = target && descs.find((d) => d.id === target.nodeId)?.inputs[target.pin];
    if (source && target && source.nodeId === target.nodeId) {
      status.textContent = "That is the same node — pick an input on another node.";
    } else if (pin?.from) {
      status.textContent = `${pin.label} is fed by ${pin.from.label} now; connecting replaces that wire.`;
    } else {
      status.textContent = "";
    }
  };
  fromList.select.addEventListener("change", describeChoice);
  toList.select.addEventListener("change", describeChoice);
  describeChoice();

  let result = null;
  const promise = modalManager.custom({
    title: "Connect Pins",
    body,
    initialFocus: from && !to ? toList.select : fromList.select,
    buttons: [
      { label: "Cancel", onClick: () => {} },
      {
        label: "Connect",
        primary: true,
        onClick: () => {
          const output = parsePortValue(fromList.select.value);
          const input = parsePortValue(toList.select.value);
          if (!output || !input) {
            status.textContent = "Choose both an output and an input.";
            return false;
          }
          const outcome = connectPorts(editor, output, input);
          if (!outcome.ok) {
            status.textContent = outcome.message;
            return false;
          }
          result = { from: output, to: input };
          announce(outcome.message);
          return true;
        },
      },
    ],
  });
  promise.then(() => onDone?.(result));
  return promise;
}

// ---- Disconnect Pins ---------------------------------------------------------------

/**
 * Remove wires. With `nodeId`, starts out showing only that node's wires.
 */
export function openDisconnectDialog({ editor, nodeId = null, onDone = null } = {}) {
  const graph = editor?.graph;
  const connections = patchConnections(graph || {});
  if (!connections.length) {
    announce("The patch has no wires to disconnect.");
    modalManager.toast?.("There are no wires to disconnect.", "info");
    return null;
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id) => nodeLabel(byId.get(id));

  const wireOption = (c) => {
    const fromDesc = describeNode(graph, byId.get(c.from.nodeId), connections);
    const toDesc = describeNode(graph, byId.get(c.to.nodeId), connections);
    const text = `${label(c.from.nodeId)} · ${fromDesc.outputs[c.from.pin]?.label || "out"} → ${label(c.to.nodeId)} · ${toDesc.inputs[c.to.pin]?.label || c.to.pin + 1}`;
    return { value: portValue(c.to.nodeId, c.to.pin), text, search: text.toLowerCase() };
  };

  const body = el("div", { className: "rz-gd" });
  body.appendChild(
    el(
      "p",
      { className: "rz-gd-intro" },
      "Select the wires to remove. Hold Shift or Ctrl to select more than one.",
    ),
  );
  const list = filterableList({
    label: "Wires",
    filterLabel: "Filter wires",
    groups: [{ label: null, options: connections.map(wireOption) }],
    size: 10,
    multiple: true,
  });
  if (nodeId) {
    list.filter.value = label(nodeId).toLowerCase();
    list.render();
  }
  const status = el("p", { className: "rz-gd-status", role: "status", "aria-live": "polite" });
  body.append(list.wrap, status);

  const promise = modalManager.custom({
    title: "Disconnect Pins",
    body,
    initialFocus: list.select,
    buttons: [
      { label: "Cancel", onClick: () => {} },
      {
        label: "Disconnect",
        primary: true,
        onClick: () => {
          const chosen = [...list.select.selectedOptions].map((o) => parsePortValue(o.value)).filter(Boolean);
          if (!chosen.length) {
            status.textContent = "Select at least one wire.";
            return false;
          }
          const removed = disconnectInputs(editor, chosen);
          announce(`Disconnected ${removed} ${removed === 1 ? "wire" : "wires"}.`);
          return true;
        },
      },
    ],
  });
  promise.then(() => onDone?.());
  return promise;
}

// ---- Go to node -------------------------------------------------------------------

export function openGoToNodeDialog({ editor, onPick = null, onCancel = null } = {}) {
  const graph = editor?.graph;
  if (!graph?.nodes?.length) {
    announce("The patch is empty.");
    return null;
  }
  const order = getA11ySettings().get("outlineOrder");
  const connections = patchConnections(graph);
  const descs = orderNodes(graph, order, connections).map((n) => describeNode(graph, n, connections));

  const body = el("div", { className: "rz-gd" });
  const list = filterableList({
    label: "Nodes",
    filterLabel: "Filter nodes by name or category",
    groups: [
      {
        label: null,
        options: descs.map((d) => {
          const text = `${d.label}, ${d.category}`;
          return { value: d.id, text, search: `${text} ${d.kindLabel}`.toLowerCase() };
        }),
      },
    ],
    size: 10,
  });
  body.appendChild(list.wrap);

  let picked = null;
  const promise = modalManager.custom({
    title: "Go to Node",
    body,
    initialFocus: list.filter,
    buttons: [
      { label: "Cancel", onClick: () => {} },
      {
        label: "Go",
        primary: true,
        onClick: () => {
          if (!list.select.value) return false;
          picked = list.select.value;
          return true;
        },
      },
    ],
    // The outline takes focus itself once a node is picked.
    returnFocus: () => null,
  });
  promise.then(() => {
    if (picked) onPick?.(picked);
    else onCancel?.();
  });
  return promise;
}

// ---- Describe Patch ------------------------------------------------------------------

/**
 * The structure as plain text — what "Copy as text" puts on the clipboard, for pasting into a
 * message or reading in another tool.
 */
export function patchDescriptionText(graph, order = "flow") {
  const summary = summarizePatch(graph, order);
  const lines = [summary.text, ""];
  summary.nodes.forEach((d, i) => {
    lines.push(`${i + 1}. ${d.label}, ${d.category}${d.bypassed ? " (bypassed)" : ""}`);
    for (const pin of d.inputs) lines.push(`   - ${inputSentence(pin)}`);
    for (const pin of d.outputs) lines.push(`   - ${outputSentence(pin)}`);
    if (d.params.length) lines.push(`   - parameters: ${d.params.map(paramSentence).join("; ")}`);
  });
  return lines.join("\n");
}

export function openDescribePatchDialog({ editor } = {}) {
  const graph = editor?.graph || { nodes: [], connections: [] };
  const order = getA11ySettings().get("outlineOrder");
  const summary = summarizePatch(graph, order);

  const body = el("div", { className: "rz-gd rz-gd-describe" });
  const region = el("div", {
    className: "rz-gd-scroll",
    tabindex: "0",
    role: "region",
    "aria-label": "Patch structure",
  });
  region.appendChild(el("h4", {}, "Summary"));
  region.appendChild(el("p", {}, summary.text));

  if (summary.nodes.length) {
    region.appendChild(el("h4", {}, order === "position" ? "Nodes, left to right" : "Nodes, in signal order"));
    const list = el("ol", { className: "rz-gd-nodes" });
    for (const d of summary.nodes) {
      const item = el("li");
      const title = el("p", { className: "rz-gd-node-title" });
      title.appendChild(el("strong", {}, d.label));
      title.appendChild(document.createTextNode(`, ${d.category}${d.bypassed ? " — bypassed" : ""}`));
      item.appendChild(title);
      const details = el("ul");
      for (const pin of d.inputs) details.appendChild(el("li", {}, inputSentence(pin)));
      for (const pin of d.outputs) details.appendChild(el("li", {}, outputSentence(pin)));
      if (d.params.length) {
        details.appendChild(el("li", {}, `parameters: ${d.params.map(paramSentence).join("; ")}`));
      }
      item.appendChild(details);
      list.appendChild(item);
    }
    region.appendChild(list);
  }
  body.appendChild(region);

  return modalManager.custom({
    title: "Describe Patch",
    body,
    initialFocus: region,
    buttons: [
      {
        label: "Copy as Text",
        onClick: () => {
          const text = patchDescriptionText(graph, order);
          Promise.resolve(navigator.clipboard?.writeText?.(text))
            .then(() => announce("Patch description copied."))
            .catch(() => announce("Copying was blocked by the browser."));
          return false;
        },
      },
      { label: "Close", primary: true, onClick: () => {} },
    ],
  });
}
