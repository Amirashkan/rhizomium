// src/core/SelectionManager.js
import { NodeDefs, makeNode } from "../data/NodeDefs.js";

let _nextId = 1; // TODO: Move this to a proper ID generator utility

export class SelectionManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.boxSelect = null;
    this.dragging = null;
  }

  getSelected() {
    return this.graph.selection;
  }

  getBoxSelect() {
    return this.boxSelect;
  }

  getDragging() {
    return this.dragging;
  }

  startBoxSelect(x, y) {
    this.graph.selection.clear();
    this.boxSelect = { x0: x, y0: y, x1: x, y1: y };
  }

  updateBoxSelect(x, y) {
    if (!this.boxSelect) return;

    this.boxSelect.x1 = x;
    this.boxSelect.y1 = y;
    this._updateBoxSelection();
  }

  endBoxSelect() {
    if (this.boxSelect) {
      this._updateBoxSelection();
      this.boxSelect = null;
    }
  }

  _updateBoxSelection() {
    if (!this.boxSelect) return;

    const x0 = Math.min(this.boxSelect.x0, this.boxSelect.x1);
    const y0 = Math.min(this.boxSelect.y0, this.boxSelect.y1);
    const x1 = Math.max(this.boxSelect.x0, this.boxSelect.x1);
    const y1 = Math.max(this.boxSelect.y0, this.boxSelect.y1);

    this.graph.selection.clear();
    for (const n of this.graph.nodes) {
      const overlap =
        n.x + n.w >= x0 && n.x <= x1 && n.y + n.h >= y0 && n.y <= y1;
      if (overlap) {
        this.graph.selection.add(n.id);
      }
    }

    if (this.onChange) this.onChange();
  }

  startDrag(nodeId, startX, startY) {
    let dragIds;

    if (this.graph.selection.has(nodeId)) {
      dragIds = new Set(this.graph.selection);
    } else {
      dragIds = new Set([nodeId]);
      this.graph.selection = new Set([nodeId]);
      if (this.onChange) this.onChange();
    }

    const orig = {};
    for (const id of dragIds) {
      const n = this.graph.nodes.find((m) => m.id === id);
      if (n) orig[id] = { x: n.x, y: n.y };
    }

    this.dragging = {
      ids: dragIds,
      start: { x: startX, y: startY },
      orig,
    };
  }

  updateDrag(currentX, currentY) {
    if (!this.dragging) return;

    const dx = currentX - this.dragging.start.x;
    const dy = currentY - this.dragging.start.y;

    for (const id of this.dragging.ids) {
      const n = this.graph.nodes.find((m) => m.id === id);
      if (!n) continue;

      const o = this.dragging.orig[id];
      n.x = o.x + dx;
      n.y = o.y + dy;
    }

    if (this.onChange) this.onChange();
  }

  endDrag() {
    this.dragging = null;
  }

  selectAll() {
    this.graph.selection = new Set(this.graph.nodes.map((n) => n.id));
    if (this.onChange) this.onChange();
  }

  deleteSelected() {
    const ids = new Set(this.graph.selection);
    if (ids.size === 0) return;

    // Remove connections involving selected nodes
    this.graph.connections = this.graph.connections.filter(
      (c) => !(ids.has(c.from.nodeId) || ids.has(c.to.nodeId)),
    );

    // Remove nodes
    this.graph.nodes = this.graph.nodes.filter((n) => !ids.has(n.id));
    this.graph.selection.clear();

    if (this.onChange) this.onChange();
  }

  moveSelected(dx, dy) {
    const ids = this.graph.selection || new Set();
    if (!ids.size) return;

    for (const n of this.graph.nodes) {
      if (ids.has(n.id)) {
        n.x = (n.x || 0) + dx;
        n.y = (n.y || 0) + dy;
      }
    }

    if (this.onChange) this.onChange();
  }

  duplicateSelected() {
    const ids = Array.from(this.graph.selection || []);
    if (!ids.length) return;

    const idSet = new Set(ids);
    const mapOldToNew = new Map();
    const clones = [];

    // Clone nodes
    for (const n of this.graph.nodes) {
      if (!idSet.has(n.id)) continue;

      const c = JSON.parse(JSON.stringify(n));
      c.id = String(++_nextId);
      c.x = (n.x || 0) + 20;
      c.y = (n.y || 0) + 20;
      clones.push(c);
      mapOldToNew.set(n.id, c.id);
    }

    // Add clones to graph
    this.graph.nodes.push(...clones);

    // Clone connections between selected nodes
    const newConns = [];
    for (const c of this.graph.connections) {
      const fromNew = mapOldToNew.get(c.from.nodeId);
      const toNew = mapOldToNew.get(c.to.nodeId);
      if (fromNew && toNew) {
        newConns.push({
          from: { nodeId: fromNew, pin: c.from.pin },
          to: { nodeId: toNew, pin: c.to.pin },
        });
      }
    }

    this.graph.connections.push(...newConns);
    this.graph.selection = new Set(clones.map((n) => n.id));

    if (this.onChange) this.onChange();
  }
}
