// src/core/Editor.js - Clean version with proper undo integration
import { EventHandler } from "./EventHandler.js";
import { Renderer } from "./Renderer.js";
import { MenuManager } from "../ui/MenuManager.js";
import { ParameterPanel } from "../ui/ParameterPanel.js";
import { SelectionManager } from "./SelectionManager.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { ViewportManager } from "./ViewportManager.js";
import { PreviewSystem } from "./PreviewSystem.js";

export class Editor {
  constructor(graph, onChange) {
    // Initialize preview state EARLY
    this.isPreviewEnabled = true;
    this.nodePreviews = new Map();

    // Set basic properties FIRST
    this.graph = graph;
    this.onChange = typeof onChange === "function" ? onChange : () => {};

    // Get canvas and context
    this.canvas = document.getElementById("ui-canvas");
    this.ctx = this.canvas.getContext("2d");

    // Initialize managers
    this.viewport = new ViewportManager();
    this.selection = new SelectionManager(this.graph, this.onChange);
    this.connections = new ConnectionManager(this.graph, this.onChange);
    this.renderer = new Renderer(this.ctx, this.viewport);
    this.menu = new MenuManager(this.graph, this.onChange);
    this.paramPanel = new ParameterPanel(this.graph, this.onChange);

    // Preview system settings
    this.previewSizes = { small: 32, medium: 64, large: 96 };

    // Initialize NEW preview system
    this.initializePreviewSystem();

    // Initialize event handling
    this.eventHandler = new EventHandler({
      canvas: this.canvas,
      viewport: this.viewport,
      selection: this.selection,
      connections: this.connections,
      menu: this.menu,
      paramPanel: this.paramPanel,
      onChange: this.onChange,
      onDraw: () => this.draw(),
      editor: this,
    });

    // Setup and initial render
    this.resize();
    window.addEventListener("resize", () => {
      this.resize();
      this.draw();
    });
  }

  // ---- Public API ----
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    this.renderer.render(this.graph, {
      selection: this.selection.getSelected(),
      dragWire: this.connections.getDragWire(),
      boxSelect: this.selection.getBoxSelect(),
      editor: this,
    });
  }

  // ---- NEW Preview System ----
  initializePreviewSystem() {
    console.log("Initializing NEW Preview System");

    if (!this.graph || !this.graph.nodes) {
      console.error("No graph or nodes available");
      return;
    }

    // Initialize the NEW preview system using factory method
    this.previewSystem = PreviewSystem.create(this);
    this.previewIntegration = this.previewSystem.integration;
  }

  // ---- UNDO SYSTEM INTEGRATION ----
  
  // Main deletion methods that integrate with undo system
  deleteConnection(sourceNode, targetNode, inputIndex) {
    if (!targetNode || !targetNode.inputs || targetNode.inputs.length <= inputIndex) {
      return false;
    }

    const currentConnection = targetNode.inputs[inputIndex];
    if (currentConnection === null || currentConnection === undefined) {
      return false; // No connection to delete
    }

    // Create connection data for undo callback
    const connectionData = {
      sourceNode: sourceNode || this.graph.nodes.find(n => n.id == currentConnection),
      targetNode: targetNode,
      targetInput: inputIndex
    };

    // Record for undo BEFORE deleting
    if (window.onConnectionDeleted && typeof window.onConnectionDeleted === 'function') {
      console.log('Editor: Recording connection deletion for undo:', connectionData);
      window.onConnectionDeleted(connectionData);
    }

    // Perform the actual deletion
    targetNode.inputs[inputIndex] = null;
    console.log(`Connection deleted: input[${inputIndex}] of node ${targetNode.id}`);

    // Trigger updates
    if (this.onChange) {
      this.onChange();
    }
    this.draw();

    return true;
  }

  deleteNode(nodeToDelete) {
    if (!nodeToDelete) return false;

    const nodeIndex = this.graph.nodes.indexOf(nodeToDelete);
    if (nodeIndex === -1) {
      console.error('Node not found in graph:', nodeToDelete.id);
      return false;
    }

    // Record for undo BEFORE deleting
    if (window.onNodeDeleted && typeof window.onNodeDeleted === 'function') {
      console.log('Editor: Recording node deletion for undo:', nodeToDelete.kind, nodeToDelete.id);
      window.onNodeDeleted(nodeToDelete);
    }

    // Remove from selection first
    if (this.selection && this.selection.has && this.selection.has(nodeToDelete)) {
      this.selection.delete(nodeToDelete);
    }

    // Remove all connections to this node
    this.graph.nodes.forEach(node => {
      if (node.inputs) {
        node.inputs.forEach((input, index) => {
          if (input === nodeToDelete.id || input == nodeToDelete.id) {
            node.inputs[index] = null;
            console.log(`Removed connection to deleted node from ${node.kind}[${index}]`);
          }
        });
      }
    });

    // Remove the node from graph
    this.graph.nodes.splice(nodeIndex, 1);
    console.log(`Node ${nodeToDelete.kind}(${nodeToDelete.id}) deleted from graph`);

    // Trigger updates
    if (this.onChange) {
      this.onChange();
    }
    this.draw();

    return true;
  }

  createConnection(sourceNodeId, targetNodeId, targetInput) {
    const sourceNode = this.graph.nodes.find(n => n.id == sourceNodeId);
    const targetNode = this.graph.nodes.find(n => n.id == targetNodeId);

    if (!sourceNode || !targetNode) {
      console.error('Cannot create connection: nodes not found');
      return false;
    }

    // Ensure target node has inputs array
    if (!targetNode.inputs) {
      targetNode.inputs = [];
    }

    // Extend inputs array if needed
    while (targetNode.inputs.length <= targetInput) {
      targetNode.inputs.push(null);
    }

    // Create the connection
    targetNode.inputs[targetInput] = sourceNodeId;
    console.log(`Connection created: ${sourceNode.kind}(${sourceNodeId}) -> ${targetNode.kind}(${targetNodeId})[${targetInput}]`);

    // Record for undo AFTER successful creation
    if (window.onConnectionCreated && typeof window.onConnectionCreated === 'function') {
      console.log('Editor: Recording connection creation for undo:', { sourceNodeId, targetNodeId, targetInput });
      window.onConnectionCreated(sourceNodeId, targetNodeId, targetInput);
    }

    // Trigger updates
    if (this.onChange) {
      this.onChange();
    }
    this.draw();

    return true;
  }

  createNode(nodeType, x, y) {
    const { makeNode } = window.NodeDefs || {};
    if (!makeNode) {
      console.error('makeNode function not available');
      return null;
    }

    try {
      const newNode = makeNode(nodeType, x, y);
      this.graph.nodes.push(newNode);
      console.log(`Node ${nodeType}(${newNode.id}) created at (${x}, ${y})`);

      // Record for undo AFTER successful creation
      if (window.onNodeCreated && typeof window.onNodeCreated === 'function') {
        console.log('Editor: Recording node creation for undo:', newNode.kind, newNode.id);
        window.onNodeCreated(newNode);
      }

      // Trigger updates
      if (this.onChange) {
        this.onChange();
      }
      this.draw();

      return newNode;
    } catch (error) {
      console.error('Error creating node:', error);
      return null;
    }
  }

  // Simplified keyboard handler - let SelectionManager handle deletion with undo
  handleKeyDown(event) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      
      // Use SelectionManager's undo-aware deleteSelected method
      if (this.selection && this.selection.deleteSelected) {
        this.selection.deleteSelected();
        this.draw(); // Refresh UI
      }
      
      return true;
    }
    
    return false;
  }

  // Mouse event handlers
  handleRightClick(mouseX, mouseY) {
    // Convert screen coordinates to canvas coordinates
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = mouseX - rect.left;
    const canvasY = mouseY - rect.top;
    
    // Check if clicking on a connection
    const connectionInfo = this.getConnectionAt(canvasX, canvasY);
    if (connectionInfo) {
      this.deleteConnection(connectionInfo.sourceNode, connectionInfo.targetNode, connectionInfo.targetInput);
      return true;
    }

    // Check if clicking on a node
    const node = this.getNodeAt(canvasX, canvasY);
    if (node) {
      if (confirm(`Delete node "${node.kind}"?`)) {
        this.deleteNode(node);
      }
      return true;
    }

    return false;
  }

  handleRightClickOld(mouseX, mouseY) {
    // Check if clicking on a connection
    const connectionInfo = this.getConnectionAt(mouseX, mouseY);
    if (connectionInfo) {
      this.deleteConnection(connectionInfo.sourceNode, connectionInfo.targetNode, connectionInfo.targetInput);
      return true;
    }

    // Check if clicking on a node
    const node = this.getNodeAt(mouseX, mouseY);
    if (node) {
      if (confirm(`Delete node "${node.kind}"?`)) {
        this.deleteNode(node);
      }
      return true;
    }

    return false;
  }

  // Helper methods to find elements at mouse position
  getConnectionAt(mouseX, mouseY) {
    // Convert screen coordinates to world coordinates
    const worldX = (mouseX - this.viewport.panX) / this.viewport.zoom;
    const worldY = (mouseY - this.viewport.panY) / this.viewport.zoom;

    // Check all connections
    for (const node of this.graph.nodes) {
      if (!node.inputs) continue;

      for (let inputIndex = 0; inputIndex < node.inputs.length; inputIndex++) {
        const input = node.inputs[inputIndex];
        if (!input) continue;

        const sourceNode = this.graph.nodes.find(n => n.id == input);
        if (!sourceNode) continue;

        // Calculate connection line (adjust based on your rendering)
        const startX = sourceNode.x + 120; // Assuming output on right side
        const startY = sourceNode.y + 25;
        const endX = node.x;
        const endY = node.y + 25 + (inputIndex * 25);

        // Check if mouse is near the connection line
        const distance = this.distanceToLine(worldX, worldY, startX, startY, endX, endY);
        if (distance < 10) { // 10 pixel tolerance
          return {
            sourceNode: sourceNode,
            targetNode: node,
            targetInput: inputIndex
          };
        }
      }
    }

    return null;
  }

  getNodeAt(mouseX, mouseY) {
    // Convert screen coordinates to world coordinates
    const worldX = (mouseX - this.viewport.panX) / this.viewport.zoom;
    const worldY = (mouseY - this.viewport.panY) / this.viewport.zoom;

    // Check all nodes (in reverse order to get topmost)
    for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
      const node = this.graph.nodes[i];

      // Basic bounding box check (adjust based on your node rendering)
      const nodeWidth = 120; // Adjust based on your node width
      const nodeHeight = 60; // Adjust based on your node height

      if (worldX >= node.x && worldX <= node.x + nodeWidth &&
          worldY >= node.y && worldY <= node.y + nodeHeight) {
        return node;
      }
    }

    return null;
  }

  // Helper method to calculate distance from point to line
  distanceToLine(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) {
      return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
    const projection = {
      x: x1 + t * dx,
      y: y1 + t * dy
    };

    return Math.sqrt((px - projection.x) * (px - projection.x) + (py - projection.y) * (py - projection.y));
  }

  // ---- Node Preview Methods (unchanged) ----
  toggleNodePreview(nodeId) {
    if (!this.nodePreviews.has(nodeId)) {
      this.nodePreviews.set(nodeId, {
        enabled: true,
        size: "small",
        showVisualInfo: true,
      });
    }

    const preview = this.nodePreviews.get(nodeId);
    preview.enabled = !preview.enabled;

    console.log(
      `Preview toggled for node ${nodeId}: ${preview.enabled ? "ON" : "OFF"}`,
    );

    if (preview.enabled) {
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.previewIntegration.generateNodePreview(node);
      }
    } else {
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) node.__thumb = null;
    }

    this.draw();
  }

  cyclePreviewSize(nodeId) {
    if (!this.nodePreviews.has(nodeId)) {
      this.nodePreviews.set(nodeId, {
        enabled: true,
        size: "small",
        showVisualInfo: true,
      });
    }

    const preview = this.nodePreviews.get(nodeId);
    const sizes = ["small", "medium", "large"];
    const currentIndex = sizes.indexOf(preview.size);
    preview.size = sizes[(currentIndex + 1) % sizes.length];

    console.log(`Size changed to ${preview.size} for node ${nodeId}`);

    // Update preview with new size
    if (this.isPreviewEnabled && preview.enabled) {
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.previewIntegration.generateNodePreview(node);
      }
    }

    this.draw();
  }

  toggleNodeVisualInfo(nodeId) {
    if (!this.nodePreviews.has(nodeId)) {
      this.nodePreviews.set(nodeId, {
        enabled: true,
        size: "small",
        showVisualInfo: true,
      });
    }
    const preview = this.nodePreviews.get(nodeId);
    preview.showVisualInfo = !preview.showVisualInfo;
    this.draw();
  }

  // Helper methods
  shouldShowPreview(node) {
    return this.isPreviewEnabled || !!node.__thumb;
  }

  isPreviewEnabled(nodeId) {
    const preview = this.nodePreviews.get(nodeId);
    return preview ? preview.enabled : true;
  }

  isVisualInfoEnabled(nodeId) {
    const preview = this.nodePreviews.get(nodeId);
    return preview ? preview.showVisualInfo : true;
  }

  getPreviewSize(nodeId) {
    const preview = this.nodePreviews.get(nodeId);
    return this.previewSizes[preview?.size || "small"];
  }

  // ---- Selection API ----
  selectAll() {
    this.selection.selectAll();
  }

  moveSelection(dx, dy) {
    this.selection.moveSelected(dx, dy);
  }

  duplicateSelected() {
    this.selection.duplicateSelected();
  }

  // ---- Legacy compatibility methods ----
  copySelected() {}
  pasteAtCursor() {}
}