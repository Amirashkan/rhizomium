// src/accessibility/GraphNavigator.js
//
// The patch canvas, for the keyboard and for screen readers.
//
// The node graph is pixels on a <canvas>: nothing in it can take focus, and nothing in it means
// anything to assistive technology. This puts a real structure behind it — an ARIA tree, one item
// per node in signal-flow order, each opening onto its inputs, outputs and parameters — and lets
// that tree drive the canvas: wherever keyboard focus is in the tree, the matching node or port is
// selected, scrolled into view and ringed on the canvas.
//
// The tree lives INSIDE the canvas element, as its fallback content. That is the platform's own
// place for "what this canvas contains": the browser keeps it out of the rendering but in the
// accessibility tree, it can take focus, and the renderer's drawFocusIfNeeded() call then tells
// the browser where on screen the focused item is, which is what a screen magnifier follows.
//
// Everything an edit needs goes through the editor's existing paths — ConnectionManager for wires,
// SelectionManager for deletes, the undo manager for moves, the add-node palette for new nodes —
// so a change made from the keyboard records, previews and undoes exactly like the same change made
// with the mouse.
//
// Keys (while the outline has focus):
//   ↑ ↓            previous / next item            → ←       open / close a node, or into / out
//   Alt+arrows     nearest node in that direction  Home End  first / last node
//   Enter          node: parameters · port: follow its wire (or connect a free one)
//   Space          select only this node           Shift+Space  add to / remove from the selection
//   C              connect: start from this port, then press C again on the other end
//   X / Delete     disconnect a port · Delete on a node deletes the selection
//   M              move the selection with the arrows (Enter drops, Esc cancels)
//   N              add a node next to this one — wired to the port in focus, if on one
//   B  S  + −      bypass · preview size · add / remove an input pin
//   I              describe this item in full     Shift+I  describe the whole patch
//   G              go to a node by name           Shift+F10 / Menu key  the node's menu
//   Ctrl+A         select every node

import { getA11ySettings } from "./a11ySettings.js";
import { announce as defaultAnnounce } from "./announcer.js";
import {
  describeNode,
  orderNodes,
  patchConnections,
  inputSentence,
  outputSentence,
  paramSentence,
  nodeConnectionSummary,
  nodeFullDescription,
  summarizePatch,
  outlineSignature,
  nodeLabel,
} from "./graphDescription.js";
import { connectPorts, disconnectInput, disconnectInputs } from "./graphEdits.js";
import { canAddInput, canRemoveInput, getInputCount } from "../data/nodeInputs.js";

/** How often a repaint may re-read the graph to see whether the outline is stale. */
const SIGNATURE_THROTTLE_MS = 300;
/** Popups opened from the outline are watched this often to hand focus back when they close. */
const POPUP_POLL_MS = 120;
/** …and given up on after this long. */
const POPUP_WATCH_LIMIT_MS = 10 * 60 * 1000;

export function itemKey(part, nodeId, extra) {
  return extra === undefined ? `${part}:${nodeId}` : `${part}:${nodeId}:${extra}`;
}

/** "in:12:0" → { part: "in", nodeId: "12", extra: "0" }. Param names may contain colons. */
export function parseItemKey(key) {
  const first = key.indexOf(":");
  const part = key.slice(0, first);
  const rest = key.slice(first + 1);
  const second = rest.indexOf(":");
  if (second === -1) return { part, nodeId: rest, extra: undefined };
  return { part, nodeId: rest.slice(0, second), extra: rest.slice(second + 1) };
}

function domId(key) {
  return `rz-go-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** The letter a keydown stands for, as typed — falling back to the physical key off-Latin layouts. */
function letterOf(event) {
  const key = event.key || "";
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toLowerCase();
  const code = event.code || "";
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : "";
}

export class GraphNavigator {
  /**
   * @param {object} options
   * @param {object} options.editor     the Editor (graph, selection, connections, viewport, …)
   * @param {HTMLCanvasElement} [options.canvas]  where the outline lives (the graph canvas)
   * @param {Document} [options.doc]
   * @param {object} [options.settings] accessibility settings store
   * @param {Function} [options.announce] (message, options) => void
   * @param {object} [options.dialogs]  { connect, disconnect, goTo, describePatch } — the keyboard
   *        dialogs, injected so this module does not depend on the modal system
   */
  constructor({
    editor,
    canvas = editor?.canvas,
    doc = typeof document !== "undefined" ? document : null,
    settings = getA11ySettings(),
    announce = defaultAnnounce,
    dialogs = {},
  } = {}) {
    this.editor = editor;
    this.canvas = canvas;
    this.doc = doc;
    this.settings = settings;
    this._say = announce;
    this.dialogs = dialogs;

    this.root = null;
    this.hintEl = null;
    this._items = [];
    this._elements = new Map();
    this._expanded = new Set();
    this._activeKey = null;
    this._focused = false;
    this._rendering = false;
    this._mode = null; // { type: "connect", from } | { type: "move", original, nodes }
    this._followIndex = new Map();
    this._lastSignature = null;
    this._lastSignatureCheck = 0;
    this._rebuildTimer = null;
    this._popupWatch = null;
    this._unsubscribeSettings = null;
  }

  // ---- lifecycle -----------------------------------------------------------

  install() {
    if (!this.canvas || !this.doc || this.root) return this;

    const root = this.doc.createElement("div");
    root.className = "rz-graph-outline";
    root.setAttribute("role", "tree");
    root.setAttribute("aria-label", "Patch graph");
    root.setAttribute("aria-multiselectable", "true");
    root.setAttribute(
      "aria-description",
      "Nodes in signal order. Up and down arrows move between nodes, right arrow opens a node's " +
        "inputs, outputs and parameters, Enter opens parameters or follows a wire, C connects, " +
        "N adds a node, M moves. Shift plus question mark lists every key.",
    );
    root.addEventListener("keydown", (e) => this._onKeyDown(e));
    root.addEventListener("focusin", (e) => this._onFocusIn(e));
    root.addEventListener("focusout", (e) => this._onFocusOut(e));
    this.canvas.appendChild(root);
    this.root = root;

    const hint = this.doc.createElement("div");
    hint.className = "rz-graph-kbd-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.hidden = true;
    this.doc.body.appendChild(hint);
    this.hintEl = hint;

    this._unsubscribeSettings = this.settings?.subscribe?.(({ key }) => {
      if (key === "outlineOrder" || key === "*") this.refresh();
    });

    this.refresh();
    return this;
  }

  dispose() {
    clearTimeout(this._rebuildTimer);
    this._stopPopupWatch();
    this._unsubscribeSettings?.();
    this.root?.remove();
    this.hintEl?.remove();
    this.root = null;
    this.hintEl = null;
    this._elements.clear();
  }

  /** Put keyboard focus on the outline: the active item, or the outline itself when it is empty. */
  focus() {
    if (!this.root) return false;
    this.refresh();
    const target = this._elements.get(this._activeKey) || this.root;
    target.focus?.({ preventScroll: true });
    return true;
  }

  /** Whether the outline currently has keyboard focus. */
  hasFocus() {
    return this._focused;
  }

  /**
   * What the renderer should ring on the canvas, or null. Only while the outline has focus: a
   * mouse user never sees a ring, and a keyboard user who tabs away stops seeing one.
   */
  renderFocus() {
    if (!this._focused) return null;
    const item = this._activeItem();
    if (!item) return null;
    const part = item.part === "input" || item.part === "output" ? item.part : "node";
    return {
      nodeId: item.nodeId,
      part,
      pin: item.pin,
      element: this._elements.get(item.key) || null,
      connectFrom: this._mode?.type === "connect" ? this._mode.from : null,
    };
  }

  /**
   * Called by the editor after every repaint. Re-reads the graph at most every few hundred
   * milliseconds, and rebuilds the outline only when what it shows has changed — so an edit made
   * with the mouse, an undo, a load or a collaborator's change all reach it without each of them
   * having to know it exists.
   */
  afterDraw(now = Date.now()) {
    if (!this.root || now - this._lastSignatureCheck < SIGNATURE_THROTTLE_MS) return;
    this._lastSignatureCheck = now;
    const signature = outlineSignature(this.editor?.graph);
    if (signature === this._lastSignature) return;
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => this.refresh(), 120);
  }

  /** Rebuild the outline from the graph now. */
  refresh() {
    if (!this.root) return;
    clearTimeout(this._rebuildTimer);
    this._lastSignature = outlineSignature(this.editor?.graph);
    this._render(this._buildItems());
  }

  // ---- the model -----------------------------------------------------------

  _graph() {
    return this.editor?.graph || { nodes: [], connections: [], selection: new Set() };
  }

  _node(nodeId) {
    return this._graph().nodes.find((n) => n?.id === nodeId) || null;
  }

  _activeItem() {
    return this._items.find((i) => i.key === this._activeKey) || null;
  }

  _buildItems() {
    const graph = this._graph();
    const connections = patchConnections(graph);
    const nodes = orderNodes(graph, this.settings?.get?.("outlineOrder") || "flow", connections);
    const selection = graph.selection || new Set();
    const items = [];

    nodes.forEach((node, index) => {
      const desc = describeNode(graph, node, connections);
      const key = itemKey("node", node.id);
      const expanded = this._expanded.has(key);
      items.push({
        key,
        part: "node",
        nodeId: node.id,
        level: 1,
        setsize: nodes.length,
        posinset: index + 1,
        expanded,
        selected: selection.has(node.id),
        name: `${desc.label}, ${desc.category ? `${desc.category} ` : ""}node`,
        description: nodeConnectionSummary(desc),
        desc,
      });
      if (!expanded) return;

      const children = [];
      for (const pin of desc.inputs) {
        children.push({
          key: itemKey("in", node.id, pin.index),
          part: "input",
          nodeId: node.id,
          pin: pin.index,
          name: capitalize(inputSentence(pin)),
          connected: !!pin.from,
          desc,
        });
      }
      for (const pin of desc.outputs) {
        children.push({
          key: itemKey("out", node.id, pin.index),
          part: "output",
          nodeId: node.id,
          pin: pin.index,
          name: capitalize(outputSentence(pin)),
          connected: pin.to.length > 0,
          desc,
        });
      }
      if (desc.params.length) {
        const paramsKey = itemKey("params", node.id);
        children.push({
          key: paramsKey,
          part: "params",
          nodeId: node.id,
          name: `Parameters, ${desc.params.length}`,
          expanded: this._expanded.has(paramsKey),
          desc,
        });
      }

      children.forEach((child, i) => {
        child.level = 2;
        child.setsize = children.length;
        child.posinset = i + 1;
        child.parentKey = key;
        items.push(child);
        if (child.part !== "params" || !child.expanded) return;
        desc.params.forEach((param, k) => {
          items.push({
            key: itemKey("param", node.id, param.name),
            part: "param",
            nodeId: node.id,
            param: param.name,
            level: 3,
            setsize: desc.params.length,
            posinset: k + 1,
            parentKey: child.key,
            name: paramSentence(param),
            desc,
          });
        });
      });
    });

    return items;
  }

  // ---- the DOM -------------------------------------------------------------

  _render(items) {
    const previous = this._items;
    this._items = items;

    if (!items.some((i) => i.key === this._activeKey)) {
      this._activeKey = this._fallbackActiveKey(previous, items);
    }

    const sameShape =
      previous.length === items.length && previous.every((item, i) => item.key === items[i].key);

    if (!sameShape) {
      const hadFocus = this._focused;
      this._rendering = true;
      const fresh = new Map();
      const elements = items.map((item) => {
        const el = this._elements.get(item.key) || this._createItemElement(item);
        fresh.set(item.key, el);
        return el;
      });
      this._elements = fresh;
      this.root.replaceChildren(...elements);
      this._rendering = false;
      if (hadFocus) this._focusActive();
    }

    for (const item of items) this._updateItemElement(this._elements.get(item.key), item);

    this.root.tabIndex = items.length ? -1 : 0;
    this.root.setAttribute(
      "aria-label",
      items.length ? "Patch graph" : "Patch graph, empty. Press N to add a node.",
    );
  }

  _fallbackActiveKey(previous, items) {
    if (!items.length) return null;
    const old = previous.find((i) => i.key === this._activeKey);
    if (old) {
      // A port or parameter whose node is still there goes back to its node…
      const nodeKey = itemKey("node", old.nodeId);
      if (items.some((i) => i.key === nodeKey)) return nodeKey;
      // …and a node that went away hands over to whatever now sits where it was.
      const nodes = items.filter((i) => i.level === 1);
      const oldIndex = previous.filter((i) => i.level === 1).findIndex((i) => i.nodeId === old.nodeId);
      if (oldIndex >= 0 && nodes.length) return nodes[Math.min(oldIndex, nodes.length - 1)].key;
    }
    // Arriving fresh: start on the selected node if there is exactly one, else the first.
    const selection = this._graph().selection;
    if (selection?.size === 1) {
      const [id] = selection;
      const key = itemKey("node", id);
      if (items.some((i) => i.key === key)) return key;
    }
    return items[0].key;
  }

  _createItemElement(item) {
    const el = this.doc.createElement("div");
    el.setAttribute("role", "treeitem");
    el.id = domId(item.key);
    el.dataset.key = item.key;
    el.tabIndex = -1;
    return el;
  }

  _updateItemElement(el, item) {
    if (!el) return;
    if (el.textContent !== item.name) el.textContent = item.name;
    el.setAttribute("aria-level", String(item.level));
    el.setAttribute("aria-setsize", String(item.setsize));
    el.setAttribute("aria-posinset", String(item.posinset));
    if (item.part === "node" || item.part === "params") {
      el.setAttribute("aria-expanded", String(!!item.expanded));
    } else {
      el.removeAttribute("aria-expanded");
    }
    if (item.part === "node") {
      el.setAttribute("aria-selected", String(!!item.selected));
    } else {
      el.removeAttribute("aria-selected");
    }
    if (item.description) {
      el.setAttribute("aria-description", item.description);
    } else {
      el.removeAttribute("aria-description");
    }
    el.tabIndex = item.key === this._activeKey ? 0 : -1;
  }

  _focusActive() {
    const el = this._elements.get(this._activeKey);
    if (el && this.doc.activeElement !== el) el.focus({ preventScroll: true });
  }

  // ---- focus ---------------------------------------------------------------

  _onFocusIn(event) {
    const arriving = !this.root.contains(event.relatedTarget);
    this._focused = true;
    if (arriving) {
      // Someone may have edited with the mouse since the outline was last looked at, or selected
      // a different node: start from the canvas's current state.
      this._syncActiveToSelection();
      this.refresh();
      if (this._mode?.type === "connect") {
        const from = this._node(this._mode.from.nodeId);
        if (from) {
          this._say(`Still connecting from ${nodeLabel(from)}. Press C on the other end, or Escape to cancel.`);
        } else {
          this._mode = null; // its node went away in the meantime
        }
      }
    }
    if (event.target === this.root && this._items.length) {
      this._focusActive();
    } else if (event.target?.dataset?.key && event.target.dataset.key !== this._activeKey) {
      // Focus moved by something other than the keys below (a screen reader's own navigation).
      this._setActive(event.target.dataset.key, { focus: false });
    }
    this._updateHint();
    this._redraw("a11y-focus");
  }

  _onFocusOut(event) {
    if (this._rendering) return;
    if (this.root.contains(event.relatedTarget)) return;
    this._focused = false;
    // A move ends where focus leaves. A connection in progress does not: finding its other end can
    // take a trip through Go to Node (G), and coming back resumes it.
    if (this._mode?.type === "move") this._commitMove();
    this._updateHint();
    this._redraw("a11y-blur");
  }

  _syncActiveToSelection() {
    const selection = this._graph().selection;
    if (!selection || selection.size !== 1) return;
    const [id] = selection;
    const active = this._activeItem();
    if (active && active.nodeId === id) return;
    this._activeKey = itemKey("node", id);
  }

  /**
   * Make `key` the active item: roving tabindex, focus, selection follows (unless `select` is
   * false), and the node is scrolled into view.
   */
  _setActive(key, { focus = true, select = true, reveal = true } = {}) {
    if (!this._items.some((i) => i.key === key)) return false;
    const previous = this._elements.get(this._activeKey);
    if (previous) previous.tabIndex = -1;
    this._activeKey = key;
    const el = this._elements.get(key);
    if (el) {
      el.tabIndex = 0;
      if (focus && this._focused) el.focus({ preventScroll: true });
    }
    const item = this._activeItem();
    if (item && select && this._mode?.type !== "move") this._selectOnly(item.nodeId);
    if (item && reveal) this._reveal(item);
    this._updateHint();
    this._redraw("a11y-focus");
    return true;
  }

  _moveBy(delta, { select = true } = {}) {
    if (!this._items.length) return;
    const index = this._items.findIndex((i) => i.key === this._activeKey);
    const next = Math.min(this._items.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
    this._setActive(this._items[next].key, { select });
  }

  _moveToEdge(last, { select = true } = {}) {
    const nodes = this._items.filter((i) => i.level === 1);
    if (!nodes.length) return;
    this._setActive((last ? nodes.at(-1) : nodes[0]).key, { select });
  }

  _expand(item) {
    if (!item || (item.part !== "node" && item.part !== "params")) return false;
    if (item.expanded) {
      const child = this._items.find((i) => i.parentKey === item.key);
      if (child) this._setActive(child.key);
      return true;
    }
    this._expanded.add(item.key);
    this.refresh();
    return true;
  }

  _collapse(item) {
    if (!item) return;
    if ((item.part === "node" || item.part === "params") && item.expanded) {
      this._expanded.delete(item.key);
      this.refresh();
      return;
    }
    if (item.parentKey) this._setActive(item.parentKey);
  }

  /** Expand a node (and optionally its parameter list) and focus one of its items. */
  focusItem(key) {
    const { part, nodeId } = parseItemKey(key);
    if (part !== "node") this._expanded.add(itemKey("node", nodeId));
    if (part === "param") this._expanded.add(itemKey("params", nodeId));
    this.refresh();
    if (!this._items.some((i) => i.key === key)) return false;
    if (!this._focused) {
      // Select first: arriving focus syncs the outline to the selection, and must find it here.
      this._selectOnly(nodeId);
      this._activeKey = key;
      this.focus();
      return this._activeKey === key;
    }
    return this._setActive(key);
  }

  /** Focus a node by id (used after a dialog or the palette picks one). */
  focusNode(nodeId) {
    return this.focusItem(itemKey("node", nodeId));
  }

  /** Alt+arrows: the nearest node whose centre lies in that direction. */
  _moveSpatially(direction) {
    const item = this._activeItem();
    const from = item ? this._node(item.nodeId) : null;
    if (!from) return;
    const cx = (n) => (n.x || 0) + (n.w || 0) / 2;
    const cy = (n) => (n.y || 0) + (n.h || 0) / 2;
    let best = null;
    let bestScore = Infinity;
    for (const node of this._graph().nodes) {
      if (!node || node === from) continue;
      const dx = cx(node) - cx(from);
      const dy = cy(node) - cy(from);
      const along = { right: dx, left: -dx, down: dy, up: -dy }[direction];
      const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      if (along <= 0) continue;
      // Straight ahead beats diagonal: sideways distance counts double.
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = node;
      }
    }
    if (best) {
      this._setActive(itemKey("node", best.id));
    } else {
      this._say(`No node ${direction === "up" || direction === "down" ? direction : `to the ${direction}`}.`);
    }
  }

  // ---- selection and view ----------------------------------------------------

  _selectOnly(nodeId) {
    const graph = this._graph();
    if (graph.selection?.size === 1 && graph.selection.has(nodeId)) return;
    // Selection does not change what the shader compiles, so this writes the set directly rather
    // than going through onChange, which would rebuild the shader on every arrow press.
    graph.selection = new Set([nodeId]);
    this._syncSelectionAttributes();
    this._followParameterPanel(nodeId);
  }

  _toggleSelected(nodeId) {
    const graph = this._graph();
    const next = new Set(graph.selection || []);
    const node = this._node(nodeId);
    if (next.has(nodeId)) {
      next.delete(nodeId);
      this._say(`${nodeLabel(node)} removed from selection, ${next.size} selected.`);
    } else {
      next.add(nodeId);
      this._say(`${nodeLabel(node)} added to selection, ${next.size} selected.`);
    }
    graph.selection = next;
    this._syncSelectionAttributes();
    this._redraw("a11y-select");
  }

  _syncSelectionAttributes() {
    const selection = this._graph().selection || new Set();
    for (const item of this._items) {
      if (item.part !== "node") continue;
      item.selected = selection.has(item.nodeId);
      this._elements.get(item.key)?.setAttribute("aria-selected", String(item.selected));
    }
  }

  /** An open parameter panel follows the outline, so it never shows a node you have left. */
  _followParameterPanel(nodeId) {
    const panel = this.editor?.paramPanel;
    if (!panel?.selectedNode || panel.selectedNode.id === nodeId) return;
    if (panel.panel?.style?.display === "none") return;
    const node = this._node(nodeId);
    if (node) panel.showNodeParameters?.(node);
  }

  /**
   * Pan the canvas so the focused node can be SEEN — inside the canvas, and not under a panel that
   * floats over it (the preview window, the parameter panel, the timeline). Leaves the view alone
   * when the node is already in the clear, so walking a row of visible nodes never scrolls.
   *
   * Panels are found by asking the page what is on top at a few points of the node's on-screen
   * box, rather than by listing them: whatever covers the canvas, this sees it. Readouts that let
   * clicks through (the status bar, the key hint) do not count — they are see-through by design.
   */
  _reveal(item) {
    const node = this._node(item.nodeId);
    const viewport = this.editor?.viewport;
    const canvas = this.editor?.canvas || this.canvas;
    if (!node || !viewport || !canvas?.getBoundingClientRect) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || 0;
    const height = rect.height || canvas.clientHeight || 0;
    if (!width || !height) return;

    const scale = viewport.scale || 1;
    const nodeW = (node.w || 0) * scale;
    const nodeH = (node.h || 0) * scale;
    const margin = 40;
    // The status bar sits over the bottom of the canvas.
    const bottomInset = 48;

    const fits = (left, top) =>
      left >= margin && top >= margin && left + nodeW <= width - margin && top + nodeH <= height - bottomInset;
    const clear = (left, top) => !this._covered(canvas, rect, left, top, nodeW, nodeH);

    const left = node.x * scale + viewport.offsetX;
    const top = node.y * scale + viewport.offsetY;
    if (fits(left, top) && clear(left, top)) return;

    // Somewhere it can be seen: the middle of the canvas first, then the middle of each third.
    const spots = [
      [0.5, 0.5],
      [0.75, 0.5],
      [0.5, 0.75],
      [0.75, 0.75],
      [0.25, 0.5],
      [0.5, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.25, 0.25],
    ];
    let target = null;
    for (const [fx, fy] of spots) {
      const l = width * fx - nodeW / 2;
      const t = height * fy - nodeH / 2;
      if (fits(l, t) && clear(l, t)) {
        target = [l, t];
        break;
      }
    }
    const [toLeft, toTop] = target || [width / 2 - nodeW / 2, height / 2 - nodeH / 2];
    viewport.setViewport?.(scale, toLeft - node.x * scale, toTop - node.y * scale);
  }

  /** Whether something other than the canvas is on top anywhere in this on-canvas box. */
  _covered(canvas, rect, left, top, w, h) {
    const doc = this.doc;
    if (typeof doc?.elementFromPoint !== "function") return false;
    const inset = Math.min(8, w / 4, h / 4);
    const points = [
      [left + w / 2, top + h / 2],
      [left + inset, top + inset],
      [left + w - inset, top + inset],
      [left + inset, top + h - inset],
      [left + w - inset, top + h - inset],
    ];
    return points.some(([x, y]) => {
      const hit = doc.elementFromPoint(rect.left + x, rect.top + y);
      return !!hit && hit !== canvas && !canvas.contains(hit);
    });
  }

  _redraw(reason) {
    const editor = this.editor;
    if (!editor) return;
    editor.markDirty?.(reason, "full", { full: true, useThrottling: false });
    editor.draw?.();
  }

  // ---- keys ----------------------------------------------------------------

  _onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing) return;
    const handled =
      this._mode?.type === "move" ? this._handleMoveKey(event) : this._handleKey(event);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  _handleKey(event) {
    const item = this._activeItem();
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;

    switch (key) {
      case "ArrowDown":
      case "ArrowUp":
        if (event.altKey) this._moveSpatially(key === "ArrowDown" ? "down" : "up");
        else this._moveBy(key === "ArrowDown" ? 1 : -1, { select: !mod });
        return true;
      case "ArrowRight":
        if (event.altKey) this._moveSpatially("right");
        else this._expand(item);
        return true;
      case "ArrowLeft":
        if (event.altKey) this._moveSpatially("left");
        else this._collapse(item);
        return true;
      case "Home":
      case "End":
        this._moveToEdge(key === "End", { select: !mod });
        return true;
      case "Enter":
        if (mod || event.altKey) return false;
        this._activate(item);
        return true;
      case " ":
      case "Spacebar":
        // Ctrl+Space is the global quick node search; leave it to that.
        if (mod) return false;
        if (!item) return true;
        if (event.shiftKey) this._toggleSelected(item.nodeId);
        else {
          this._selectOnly(item.nodeId);
          this._redraw("a11y-select");
          this._say(`Selected ${nodeLabel(this._node(item.nodeId))}.`);
        }
        return true;
      case "Delete":
      case "Backspace":
        if (mod) return false;
        this._delete(item);
        return true;
      case "Escape":
        if (this._mode?.type === "connect") {
          this._mode = null;
          this._say("Connection cancelled.");
          this._updateHint();
          this._redraw("a11y-connect-cancel");
          return true;
        }
        return false;
      case "ContextMenu":
        this._openNodeMenu(item);
        return true;
      case "F2":
        if (mod || event.altKey || event.shiftKey) return false;
        this._rename(item);
        return true;
      case "F10":
        if (!event.shiftKey) return false;
        this._openNodeMenu(item);
        return true;
      case "+":
        // Ctrl++ is zoom in.
        if (mod) return false;
        this._changeInputs(item, +1);
        return true;
      case "-":
        if (mod) return false;
        this._changeInputs(item, -1);
        return true;
      default:
        break;
    }

    if (event.code === "NumpadAdd" && !mod) {
      this._changeInputs(item, +1);
      return true;
    }
    if (event.code === "NumpadSubtract" && !mod) {
      this._changeInputs(item, -1);
      return true;
    }

    const letter = letterOf(event);
    if (mod) {
      if (letter === "a" && !event.shiftKey && !event.altKey) {
        this.editor?.selectAll?.();
        this._syncSelectionAttributes();
        this._redraw("a11y-select-all");
        const count = this._graph().selection?.size || 0;
        this._say(`Selected all ${count} ${count === 1 ? "node" : "nodes"}.`);
        return true;
      }
      return false;
    }
    if (event.altKey) return false;

    switch (letter) {
      case "c":
        this._connectKey(item);
        return true;
      case "x":
        this._disconnect(item);
        return true;
      case "m":
        this._startMove(item);
        return true;
      case "n":
        this._addNode(item);
        return true;
      case "b":
        this._toggleBypass(item);
        return true;
      case "s":
        this._cyclePreview(item);
        return true;
      case "i":
        this._describe(item, event.shiftKey);
        return true;
      case "g":
        this._goTo();
        return true;
      default:
        return false;
    }
  }

  // ---- actions -------------------------------------------------------------

  _activate(item) {
    if (!item) return;
    switch (item.part) {
      case "node":
        this._openParameters(item.nodeId);
        return;
      case "params":
        if (item.expanded) this._collapse(item);
        else this._expand(item);
        return;
      case "param":
        this._openParameters(item.nodeId, item.param);
        return;
      case "input": {
        const pin = item.desc.inputs[item.pin];
        if (pin?.from) {
          this.focusItem(itemKey("out", pin.from.nodeId, pin.from.pin));
          this._say(`Followed wire back to ${pin.from.label}, output ${pin.from.pinLabel}.`, { verbose: true });
        } else {
          this._openConnectDialog({ to: { nodeId: item.nodeId, pin: item.pin } });
        }
        return;
      }
      case "output": {
        const pin = item.desc.outputs[item.pin];
        if (pin?.to.length) {
          // Repeated Enter on the same output walks through everything it feeds.
          const at = (this._followIndex.get(item.key) ?? -1) + 1;
          const target = pin.to[at % pin.to.length];
          this._followIndex.set(item.key, at % pin.to.length);
          this.focusItem(itemKey("in", target.nodeId, target.pin));
          if (pin.to.length > 1) {
            this._say(`Wire ${(at % pin.to.length) + 1} of ${pin.to.length}: ${target.label}, input ${target.pinLabel}.`, { verbose: true });
          }
        } else {
          this._openConnectDialog({ from: { nodeId: item.nodeId, pin: item.pin } });
        }
        return;
      }
      default:
        return;
    }
  }

  _openParameters(nodeId, paramName = null) {
    const node = this._node(nodeId);
    const panel = this.editor?.paramPanel;
    if (!node || !panel?.showNodeParameters) return;
    this._selectOnly(nodeId);
    panel.showNodeParameters(node);
    const container = panel.panelContent || panel.panel;
    const selector = paramName
      ? `[data-param="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(paramName) : paramName.replace(/["\\]/g, "\\$&")}"]`
      : null;
    const scope = (selector && container?.querySelector?.(selector)) || container;
    // The first parameter's own field — not the panel header's buttons, which come first in the
    // DOM — and a button only when the node has nothing else to edit.
    const fieldSelector = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";
    const field =
      scope?.querySelector?.(
        paramName ? fieldSelector : `.parameter-container :is(${fieldSelector})`,
      ) ||
      scope?.querySelector?.(fieldSelector) ||
      scope?.querySelector?.("button:not([disabled])");
    if (field) {
      field.focus();
      this._say(`Parameters for ${nodeLabel(node)}. Escape returns to the patch.`);
      this._returnFocusAfter(() => panel.panel?.style?.display !== "none" && panel.selectedNode, () => this.focusNode(nodeId));
    } else {
      this._say(`${nodeLabel(node)} has no parameters.`);
    }
  }

  _delete(item) {
    if (!item) return;
    if (item.part === "input" || item.part === "output") {
      this._disconnect(item);
      return;
    }
    const graph = this._graph();
    if (!graph.selection?.size) this._selectOnly(item.nodeId);
    const doomed = graph.nodes.filter((n) => graph.selection.has(n.id));
    if (!doomed.length) return;
    const label = doomed.length === 1 ? nodeLabel(doomed[0]) : `${doomed.length} nodes`;
    this.editor?.selection?.deleteSelected?.();
    this._redraw("a11y-delete");
    this.refresh();
    this._focusActive();
    this._say(`Deleted ${label}.`);
  }

  // Connecting: C on a port starts, C on the other end finishes. C on a node starts from its first
  // output, or — mid-connection — finishes on its first free input.
  _connectKey(item) {
    if (!item) return;
    const mode = this._mode;

    if (mode?.type !== "connect") {
      const from = this._portFor(item, null);
      if (!from) {
        this._say(`${nodeLabel(this._node(item.nodeId))} has no ports to connect.`);
        return;
      }
      this._mode = { type: "connect", from };
      const node = this._node(from.nodeId);
      const pinName =
        from.part === "output"
          ? describeNode(this._graph(), node).outputs[from.pin]?.label
          : describeNode(this._graph(), node).inputs[from.pin]?.label;
      this._say(
        `Connecting from ${nodeLabel(node)}, ${from.part} ${pinName}. Go to ${
          from.part === "output" ? "an input" : "an output"
        } and press C. Escape cancels.`,
      );
      this._updateHint();
      this._redraw("a11y-connect-start");
      return;
    }

    const to = this._portFor(item, mode.from);
    if (!to) {
      this._say(
        `Choose ${mode.from.part === "output" ? "an input" : "an output"} on another node.`,
      );
      return;
    }
    this._mode = null;
    this._updateHint();
    this._connect(mode.from, to);
  }

  /**
   * The port an item stands for. A port is itself; a node is its first output — or, when
   * completing a connection, the matching side: its first free input (or first input) for a wire
   * coming from an output, its first output for one coming from an input.
   */
  _portFor(item, completing) {
    if (item.part === "input" || item.part === "output") {
      const port = { nodeId: item.nodeId, part: item.part, pin: item.pin };
      if (completing && (port.part === completing.part || port.nodeId === completing.nodeId)) return null;
      return port;
    }
    const node = this._node(item.nodeId);
    if (!node) return null;
    const desc = describeNode(this._graph(), node);
    if (completing) {
      if (completing.nodeId === node.id) return null;
      if (completing.part === "output") {
        if (!desc.inputs.length) return null;
        const free = desc.inputs.find((p) => !p.from) || desc.inputs[0];
        return { nodeId: node.id, part: "input", pin: free.index };
      }
      return desc.outputs.length ? { nodeId: node.id, part: "output", pin: 0 } : null;
    }
    if (desc.outputs.length) return { nodeId: node.id, part: "output", pin: 0 };
    if (desc.inputs.length) return { nodeId: node.id, part: "input", pin: 0 };
    return null;
  }

  /** Wire an output to an input through the same path a mouse drag takes. */
  _connect(a, b) {
    const output = a.part === "output" ? a : b;
    const input = a.part === "input" ? a : b;
    const result = connectPorts(this.editor, output, input);
    if (result.ok) {
      this.refresh();
      this.focusItem(itemKey("in", input.nodeId, input.pin));
    }
    this._say(result.message);
    return result.ok;
  }

  _disconnect(item) {
    if (!item) return;
    if (item.part === "input") {
      const result = disconnectInput(this.editor, item.nodeId, item.pin);
      if (result.ok) {
        this.refresh();
        this._focusActive();
      }
      this._say(result.message);
      return;
    }
    if (item.part === "output") {
      const pin = item.desc.outputs[item.pin];
      if (!pin?.to.length) {
        this._say("That output is not connected.");
        return;
      }
      const removed = disconnectInputs(
        this.editor,
        pin.to.map((target) => ({ nodeId: target.nodeId, pin: target.pin })),
      );
      this.refresh();
      this._focusActive();
      this._say(
        `Disconnected ${removed} ${removed === 1 ? "wire" : "wires"} from ${nodeLabel(this._node(item.nodeId))} output ${pin.label}.`,
      );
      return;
    }
    // On a node: pick from its wires in the dialog.
    if (this.dialogs.disconnect) {
      this.dialogs.disconnect({ nodeId: item.nodeId, onDone: () => this.focusNode(item.nodeId) });
    } else {
      this._say("Go to one of the node's ports to disconnect it.");
    }
  }

  _openConnectDialog(seed) {
    if (!this.dialogs.connect) {
      this._say("Press C on a port to start a connection.");
      return;
    }
    this.dialogs.connect({
      ...seed,
      onDone: (result) => {
        this.refresh();
        if (result?.to) this.focusItem(itemKey("in", result.to.nodeId, result.to.pin));
        else this.focus();
      },
    });
  }

  // Moving: M enters a mode where the arrows move the selection. One undo step for the whole
  // move, however many presses it took.
  _startMove(item) {
    if (!item) return;
    const graph = this._graph();
    if (!graph.selection?.has(item.nodeId)) this._selectOnly(item.nodeId);
    const nodes = graph.nodes.filter((n) => graph.selection.has(n.id));
    if (!nodes.length) return;
    this._mode = {
      type: "move",
      nodes,
      original: new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
    };
    const step = this._moveStep(false);
    this._say(
      `Moving ${nodes.length === 1 ? nodeLabel(nodes[0]) : `${nodes.length} nodes`}. Arrow keys move ${step} pixels, ` +
        `with Shift ${this._moveStep(true)}. Enter drops, Escape cancels.`,
    );
    this._updateHint();
  }

  _moveStep(large) {
    const editor = this.editor;
    if (editor?.isSnapEnabled?.()) {
      const grid = editor.getSnapGridSize?.() || 20;
      return grid * (large ? 5 : 1);
    }
    return large ? 50 : 10;
  }

  _handleMoveKey(event) {
    const mode = this._mode;
    const step = this._moveStep(event.shiftKey);
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];

    if (delta) {
      const selection = this.editor?.selection;
      for (const node of mode.nodes) {
        const next = selection?.applySnap
          ? selection.applySnap(node.x + delta[0], node.y + delta[1])
          : { x: node.x + delta[0], y: node.y + delta[1] };
        node.x = next.x;
        node.y = next.y;
      }
      this.editor?.invalidateNodes?.(mode.nodes, "node-drag");
      this._reveal(this._activeItem() || { nodeId: mode.nodes[0].id });
      this._redraw("a11y-move");
      const lead = mode.nodes[0];
      this._say(`x ${Math.round(lead.x)}, y ${Math.round(lead.y)}`, { verbose: true });
      return true;
    }

    if (event.key === "Enter" || letterOf(event) === "m") {
      this._commitMove();
      return true;
    }
    if (event.key === "Escape") {
      for (const node of mode.nodes) {
        const at = mode.original.get(node.id);
        node.x = at.x;
        node.y = at.y;
      }
      this._mode = null;
      this.editor?.invalidateNodes?.(mode.nodes, "node-drag");
      this._redraw("a11y-move-cancel");
      this._updateHint();
      this._say("Move cancelled.");
      return true;
    }
    // Everything else is swallowed while moving, so a stray letter cannot start something else
    // halfway through — except Tab, which drops the move and leaves (see _onFocusOut).
    return event.key !== "Tab";
  }

  _commitMove() {
    const mode = this._mode;
    if (mode?.type !== "move") return;
    this._mode = null;
    const movements = [];
    for (const node of mode.nodes) {
      const at = mode.original.get(node.id);
      if (at.x !== node.x || at.y !== node.y) {
        movements.push({ nodeId: node.id, oldX: at.x, oldY: at.y, newX: node.x, newY: node.y });
      }
    }
    if (movements.length) {
      this.editor?.undoManager?.recordNodeMovement?.(movements);
      const lead = mode.nodes[0];
      this._say(
        `Moved ${mode.nodes.length === 1 ? nodeLabel(lead) : `${mode.nodes.length} nodes`} to x ${Math.round(lead.x)}, y ${Math.round(lead.y)}.`,
      );
    } else {
      this._say("Nothing moved.");
    }
    this._updateHint();
    this.refresh();
  }

  /** N: open the add-node palette beside the focused node, carrying a wire from a focused port. */
  _addNode(item) {
    const editor = this.editor;
    const menu = editor?.menu;
    const canvas = editor?.canvas || this.canvas;
    if (!menu?.showCreateMenu || !editor?.viewport || !canvas) return;

    const anchor = item ? this._node(item.nodeId) : null;
    let x;
    let y;
    if (anchor) {
      x = anchor.x + (anchor.w || 180) + 80;
      y = anchor.y;
      if (item.part === "input") x = anchor.x - 260;
    } else {
      const rect = canvas.getBoundingClientRect();
      const center = editor.viewport.screenToCanvas(rect.width / 2, rect.height / 2);
      x = center.x;
      y = center.y;
    }

    const connections = editor.connections;
    if (item?.part === "output") connections?.startWireDrag(item.nodeId, item.pin, { x, y }, false);
    if (item?.part === "input") connections?.startWireDrag(item.nodeId, item.pin, { x, y }, true);

    const before = new Set(this._graph().nodes.map((n) => n.id));
    const rect = canvas.getBoundingClientRect();
    const screen = editor.viewport.canvasToScreen(x, y);
    menu.showCreateMenu(x, y, rect.left + screen.x, rect.top + screen.y);

    this._returnFocusAfter(
      () => menu.isAddMenuOpen?.(),
      () => {
        const created = this._graph().nodes.find((n) => !before.has(n.id));
        this.refresh();
        if (created) {
          const wired = item && (item.part === "output" || item.part === "input");
          this.focusNode(created.id);
          this._say(`Added ${nodeLabel(created)}${wired ? ", connected" : ""}.`);
        } else {
          this.focus();
        }
      },
    );
  }

  /** F2: the same inline title field a double-click opens, with focus brought back after. */
  _rename(item) {
    const editor = this.editor;
    if (!item || !editor?.beginNodeRename) return;
    const nodeId = item.nodeId;
    this._selectOnly(nodeId);
    editor.beginNodeRename(nodeId);
    this._returnFocusAfter(
      () => editor.nodeNameEditor?.isOpen,
      () => {
        this.refresh();
        this.focusNode(nodeId);
        this._say(`Renamed to ${nodeLabel(this._node(nodeId))}.`, { verbose: true });
      },
    );
  }

  _toggleBypass(item) {
    if (!item || !this.editor?.toggleNodeBypass) return;
    const node = this._node(item.nodeId);
    const before = !!node?.bypassed;
    this.editor.toggleNodeBypass(item.nodeId);
    if (!!node?.bypassed === before) {
      // The Output node refuses: bypassing the sink would drop the image.
      this._say(`${nodeLabel(node)} cannot be bypassed.`);
      return;
    }
    this._redraw("a11y-bypass");
    this.refresh();
    this._say(node.bypassed ? `Bypassed ${nodeLabel(node)}.` : `${nodeLabel(node)} is active again.`);
  }

  _cyclePreview(item) {
    const editor = this.editor;
    if (!item || !editor?.cyclePreviewSize) return;
    const node = this._node(item.nodeId);
    if (editor.isNodePreviewEnabled && !editor.isNodePreviewEnabled(node)) {
      this._say("This node's preview is hidden. Press H to show it.");
      return;
    }
    editor.cyclePreviewSize(item.nodeId);
    this._redraw("a11y-preview-size");
    const size = editor.nodePreviews?.get?.(item.nodeId)?.size;
    this._say(size ? `Preview ${size}.` : "Preview size changed.");
  }

  _changeInputs(item, delta) {
    const editor = this.editor;
    const node = item ? this._node(item.nodeId) : null;
    if (!node) return;
    const allowed = delta > 0 ? canAddInput(node) : canRemoveInput(node);
    if (!allowed) {
      this._say(
        delta > 0
          ? `${nodeLabel(node)} cannot take more inputs.`
          : `${nodeLabel(node)} cannot drop an input.`,
      );
      return;
    }
    if (delta > 0) editor?.addNodeInput?.(node.id);
    else editor?.removeNodeInput?.(node.id);
    this.refresh();
    const count = getInputCount(node);
    this._say(`${nodeLabel(node)} now has ${count} ${count === 1 ? "input" : "inputs"}.`);
  }

  _describe(item, wholePatch) {
    if (wholePatch || !item) {
      const { text } = summarizePatch(this._graph(), this.settings?.get?.("outlineOrder") || "flow");
      this._say(text);
      return;
    }
    const desc = item.desc;
    switch (item.part) {
      case "input":
        this._say(`${desc.label}. ${capitalize(inputSentence(desc.inputs[item.pin]))}.`);
        return;
      case "output":
        this._say(`${desc.label}. ${capitalize(outputSentence(desc.outputs[item.pin]))}.`);
        return;
      default:
        this._say(nodeFullDescription(describeNode(this._graph(), this._node(item.nodeId))));
    }
  }

  _goTo() {
    if (!this.dialogs.goTo) return;
    this.dialogs.goTo({
      onPick: (nodeId) => this.focusNode(nodeId),
      onCancel: () => this.focus(),
    });
  }

  _openNodeMenu(item) {
    const editor = this.editor;
    const node = item ? this._node(item.nodeId) : null;
    const canvas = editor?.canvas || this.canvas;
    if (!node || !editor?.menu?.showNodeMenu || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screen = editor.viewport.canvasToScreen(node.x + (node.w || 0), node.y);
    editor.menu.showNodeMenu(node, rect.left + screen.x, rect.top + screen.y);
    const first = editor.menu.menuEl?.querySelector?.(".ctx-item");
    first?.focus?.();
    this._returnFocusAfter(() => !!editor.menu.menuEl, () => {
      this.refresh();
      if (this._node(node.id)) this.focusNode(node.id);
      else this.focus();
    });
  }

  /**
   * Hand focus back to the outline once a popup it opened (palette, parameter panel, node menu)
   * has gone — but only if focus was left stranded on the page, not if the user moved it on.
   */
  _returnFocusAfter(isOpen, onClosed) {
    this._stopPopupWatch();
    const started = Date.now();
    this._popupWatch = setInterval(() => {
      let open = false;
      try {
        open = !!isOpen();
      } catch {
        open = false;
      }
      if (open && Date.now() - started < POPUP_WATCH_LIMIT_MS) return;
      this._stopPopupWatch();
      const active = this.doc?.activeElement;
      const stranded = !active || active === this.doc.body;
      if (stranded && !open) onClosed?.();
    }, POPUP_POLL_MS);
  }

  _stopPopupWatch() {
    if (this._popupWatch) {
      clearInterval(this._popupWatch);
      this._popupWatch = null;
    }
  }

  // ---- the on-screen hint ----------------------------------------------------

  _updateHint() {
    const hint = this.hintEl;
    if (!hint) return;
    if (!this._focused) {
      hint.hidden = true;
      return;
    }
    const kbd = (k) => `<kbd>${k}</kbd>`;
    const mode = this._mode;
    let html;
    if (mode?.type === "move") {
      html = `<span class="rz-graph-kbd-mode">Moving</span>${kbd("←↑→↓")} move · ${kbd("Shift")} bigger steps · ${kbd("Enter")} drop · ${kbd("Esc")} cancel`;
    } else if (mode?.type === "connect") {
      html = `<span class="rz-graph-kbd-mode">Connecting</span>go to ${
        mode.from.part === "output" ? "an input" : "an output"
      } and press ${kbd("C")} · ${kbd("Esc")} cancel`;
    } else {
      const item = this._activeItem();
      if (!item) {
        html = `Empty patch — ${kbd("N")} add a node`;
      } else if (item.part === "input" || item.part === "output") {
        html = `${kbd("Enter")} follow wire · ${kbd("C")} connect · ${kbd("X")} disconnect · ${kbd("N")} add &amp; wire · ${kbd("←")} back to node`;
      } else {
        html = `${kbd("↑↓")} nodes · ${kbd("→")} ports · ${kbd("Enter")} parameters · ${kbd("C")} connect · ${kbd("M")} move · ${kbd("N")} add · ${kbd("Del")} delete · ${kbd("?")} all keys`;
      }
    }
    hint.innerHTML = html;
    hint.hidden = false;
  }
}
