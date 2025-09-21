// src/core/AppState.js - Centralized application state
import { EventEmitter } from "../utils/EventEmitter.js";
import { Graph } from "../data/Graph.js";

export class AppState extends EventEmitter {
  constructor() {
    super();

    // Core state
    this.graph = new Graph();
    this.selection = new Set();
    this.viewport = { x: 0, y: 0, zoom: 1 };
    this.ui = {
      previewsEnabled: true,
      parameterPanelOpen: false,
      currentParameterNode: null,
    };

    // System state
    this.isInitialized = false;
    this.hasUnsavedChanges = false;
    this.lastSaveTime = null;

    // GPU state
    this.webgpu = {
      device: null,
      ready: false,
      textureManager: null,
    };
  }

  // Graph operations
  addNode(node) {
    this.graph.nodes.push(node);
    this.hasUnsavedChanges = true;
    this.emit("node-added", { node });
    this.emit("graph-changed", { type: "node-added", node });
  }

  removeNode(nodeId) {
    const nodeIndex = this.graph.nodes.findIndex((n) => n.id === nodeId);
    if (nodeIndex === -1) return false;

    const node = this.graph.nodes[nodeIndex];

    // Remove connections
    this.graph.connections = this.graph.connections.filter(
      (conn) => conn.from.nodeId !== nodeId && conn.to.nodeId !== nodeId,
    );

    // Remove from nodes
    this.graph.nodes.splice(nodeIndex, 1);

    // Remove from selection
    this.selection.delete(nodeId);

    this.hasUnsavedChanges = true;
    this.emit("node-removed", { nodeId, node });
    this.emit("graph-changed", { type: "node-removed", nodeId, node });

    return true;
  }

  updateNode(nodeId, changes) {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return false;

    const oldState = { ...node };
    Object.assign(node, changes);

    this.hasUnsavedChanges = true;
    this.emit("node-updated", { nodeId, node, changes, oldState });
    this.emit("graph-changed", { type: "node-updated", nodeId, node, changes });

    return true;
  }

  addConnection(fromNodeId, fromPin, toNodeId, toPin) {
    // Remove existing connection to the target input
    this.graph.connections = this.graph.connections.filter(
      (conn) => !(conn.to.nodeId === toNodeId && conn.to.pin === toPin),
    );

    // Add new connection
    const connection = {
      from: { nodeId: fromNodeId, pin: fromPin },
      to: { nodeId: toNodeId, pin: toPin },
    };

    this.graph.connections.push(connection);

    // Update target node's inputs array
    const targetNode = this.graph.nodes.find((n) => n.id === toNodeId);
    if (targetNode) {
      if (!targetNode.inputs) targetNode.inputs = [];
      targetNode.inputs[toPin] = fromNodeId;
    }

    this.hasUnsavedChanges = true;
    this.emit("connection-added", { connection });
    this.emit("graph-changed", { type: "connection-added", connection });

    return connection;
  }

  removeConnection(fromNodeId, fromPin, toNodeId, toPin) {
    const connectionIndex = this.graph.connections.findIndex(
      (conn) =>
        conn.from.nodeId === fromNodeId &&
        conn.from.pin === fromPin &&
        conn.to.nodeId === toNodeId &&
        conn.to.pin === toPin,
    );

    if (connectionIndex === -1) return false;

    const connection = this.graph.connections[connectionIndex];
    this.graph.connections.splice(connectionIndex, 1);

    // Update target node's inputs array
    const targetNode = this.graph.nodes.find((n) => n.id === toNodeId);
    if (targetNode && targetNode.inputs) {
      targetNode.inputs[toPin] = null;
    }

    this.hasUnsavedChanges = true;
    this.emit("connection-removed", { connection });
    this.emit("graph-changed", { type: "connection-removed", connection });

    return true;
  }

  // Selection operations
  selectNode(nodeId, addToSelection = false) {
    if (!addToSelection) {
      this.selection.clear();
    }

    this.selection.add(nodeId);
    this.emit("selection-changed", { selection: new Set(this.selection) });
  }

  deselectNode(nodeId) {
    this.selection.delete(nodeId);
    this.emit("selection-changed", { selection: new Set(this.selection) });
  }

  clearSelection() {
    this.selection.clear();
    this.emit("selection-changed", { selection: new Set(this.selection) });
  }

  getSelectedNodes() {
    return this.graph.nodes.filter((node) => this.selection.has(node.id));
  }

  // Viewport operations
  setViewport(viewport) {
    const oldViewport = { ...this.viewport };
    this.viewport = { ...this.viewport, ...viewport };
    this.emit("viewport-changed", { viewport: this.viewport, oldViewport });
  }

  panViewport(deltaX, deltaY) {
    this.setViewport({
      x: this.viewport.x + deltaX,
      y: this.viewport.y + deltaY,
    });
  }

  zoomViewport(factor, centerX = 0, centerY = 0) {
    const newZoom = Math.max(0.1, Math.min(5, this.viewport.zoom * factor));

    // Adjust pan to zoom around the specified center point
    const deltaZoom = newZoom / this.viewport.zoom;
    const newX = centerX - (centerX - this.viewport.x) * deltaZoom;
    const newY = centerY - (centerY - this.viewport.y) * deltaZoom;

    this.setViewport({
      x: newX,
      y: newY,
      zoom: newZoom,
    });
  }

  // UI state operations
  setPreviewsEnabled(enabled) {
    this.ui.previewsEnabled = enabled;
    this.emit("ui-changed", { type: "previews-enabled", enabled });
  }

  openParameterPanel(node) {
    this.ui.parameterPanelOpen = true;
    this.ui.currentParameterNode = node;
    this.emit("ui-changed", { type: "parameter-panel-opened", node });
  }

  closeParameterPanel() {
    this.ui.parameterPanelOpen = false;
    this.ui.currentParameterNode = null;
    this.emit("ui-changed", { type: "parameter-panel-closed" });
  }

  // Project operations
  loadGraph(graphData) {
    // Clear current state
    this.graph = new Graph();
    this.selection.clear();

    // Load new data
    if (graphData.nodes) this.graph.nodes = graphData.nodes;
    if (graphData.connections) this.graph.connections = graphData.connections;

    // Reset other state
    this.hasUnsavedChanges = false;
    this.lastSaveTime = Date.now();

    this.emit("graph-loaded", { graph: this.graph });
    this.emit("selection-changed", { selection: new Set() });
  }

  clearGraph() {
    this.graph = new Graph();
    this.selection.clear();
    this.hasUnsavedChanges = false;
    this.lastSaveTime = null;

    this.emit("graph-cleared");
    this.emit("selection-changed", { selection: new Set() });
  }

  markSaved() {
    this.hasUnsavedChanges = false;
    this.lastSaveTime = Date.now();
    this.emit("project-saved", { timestamp: this.lastSaveTime });
  }

  // GPU state operations
  setWebGPUReady(device, textureManager = null) {
    this.webgpu.device = device;
    this.webgpu.ready = !!device;
    this.webgpu.textureManager = textureManager;

    this.emit("webgpu-ready", {
      device,
      textureManager,
      ready: this.webgpu.ready,
    });
  }

  // Utility methods
  getNode(nodeId) {
    return this.graph.nodes.find((n) => n.id === nodeId);
  }

  getConnectedInputs(nodeId) {
    return this.graph.connections.filter((conn) => conn.to.nodeId === nodeId);
  }

  getConnectedOutputs(nodeId) {
    return this.graph.connections.filter((conn) => conn.from.nodeId === nodeId);
  }

  isNodeSelected(nodeId) {
    return this.selection.has(nodeId);
  }

  hasUnsavedWork() {
    return this.hasUnsavedChanges;
  }

  // Serialization
  serialize() {
    return {
      graph: {
        nodes: this.graph.nodes,
        connections: this.graph.connections,
      },
      viewport: this.viewport,
      metadata: {
        version: "1.0",
        timestamp: Date.now(),
        nodeCount: this.graph.nodes.length,
        connectionCount: this.graph.connections.length,
      },
    };
  }

  deserialize(data) {
    if (data.graph) {
      this.loadGraph(data.graph);
    }

    if (data.viewport) {
      this.setViewport(data.viewport);
    }

    this.emit("state-deserialized", { data });
  }
}
