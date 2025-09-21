// src/data/Graph.js
export class Graph {
  constructor() {
    this.nodes = [];
    this.connections = [];
    this.selection = new Set();
  }

  add(node) {
    this.nodes.push(node);
  }

  toJSON() {
    return {
      version: 1,
      nodes: this.nodes,
      connections: this.connections,
    };
  }

  static fromJSON(obj) {
    const g = new Graph();
    g.nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
    g.connections = Array.isArray(obj.connections) ? obj.connections : [];

    // Ensure defaults for CircleField nodes loaded from JSON
    for (const n of g.nodes) {
      if (n && n.kind === "CircleField") {
        n.props = n.props || {};
        if (typeof n.props.radius !== "number") n.props.radius = 0.25;
        if (typeof n.props.epsilon !== "number") n.props.epsilon = 0.01;
      }
    }
    return g;
  }
}
