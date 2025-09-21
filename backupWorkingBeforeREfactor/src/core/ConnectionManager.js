// src/core/ConnectionManager.js
import { NodeDefs } from "../data/NodeDefs.js";

export class ConnectionManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.dragWire = null;
  }

  getDragWire() {
    return this.dragWire;
  }

  startWireDrag(fromNodeId, fromPin, startPos) {
    this.dragWire = {
      from: { nodeId: fromNodeId, pin: fromPin },
      pos: startPos,
    };
  }

  updateWireDrag(pos) {
    if (this.dragWire) {
      this.dragWire.pos = pos;
    }
  }

  endWireDrag(targetPos, hitInputPin) {
    if (!this.dragWire) return false;

    if (hitInputPin) {
      // Remove any existing connection to this input
      this.graph.connections = this.graph.connections.filter(
        (c) =>
          !(c.to.nodeId === hitInputPin.nodeId && c.to.pin === hitInputPin.pin),
      );

      // Add new connection
      this.graph.connections.push({
        from: this.dragWire.from,
        to: hitInputPin,
      });

      // Update node inputs array
      const toNode = this.graph.nodes.find((n) => n.id === hitInputPin.nodeId);
      if (toNode) {
        toNode.inputs[hitInputPin.pin] = this.dragWire.from.nodeId;
      }

      if (this.onChange) this.onChange();

      // UPDATE PREVIEWS WHEN CONNECTION ADDED
      if (window.editor?.previewIntegration) {
        window.editor.previewIntegration.updateAllPreviews();
      }

      this.dragWire = null;
      return true;
    }

    this.dragWire = null;
    return false;
  }

  removeConnection(nodeId, inputPin) {
    const initialLength = this.graph.connections.length;
    this.graph.connections = this.graph.connections.filter(
      (c) => !(c.to.nodeId === nodeId && c.to.pin === inputPin),
    );

    if (this.graph.connections.length !== initialLength) {
      if (this.onChange) this.onChange();

      // UPDATE PREVIEWS WHEN CONNECTION REMOVED
      if (window.editor?.previewIntegration) {
        window.editor.previewIntegration.updateAllPreviews();
      }

      return true;
    }
    return false;
  }

  // Hit testing for pins
  hitOutputPin(x, y, nodes) {
    for (const n of nodes) {
      const { outs } = this._pinPositions(n);
      for (let i = 0; i < outs.length; i++) {
        const p = outs[i];
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < 6 * 6) {
          return { nodeId: n.id, pin: i };
        }
      }
    }
    return null;
  }

  hitInputPin(x, y, nodes) {
    for (const n of nodes) {
      const { ins } = this._pinPositions(n);
      for (let i = 0; i < ins.length; i++) {
        const p = ins[i];
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < 6 * 6) {
          return { nodeId: n.id, pin: i };
        }
      }
    }
    return null;
  }

  _pinPositions(n) {
    const ins = [];
    for (let i = 0; i < (NodeDefs[n.kind]?.inputs || 0); i++) {
      ins.push({ x: n.x + 8, y: n.y + 32 + i * 18 });
    }

    const outs = [];
    const outCount = (NodeDefs[n.kind]?.pinsOut || []).length || 1;
    for (let i = 0; i < outCount; i++) {
      outs.push({ x: n.x + n.w - 8, y: n.y + 32 + i * 18 });
    }

    return { ins, outs };
  }
}
