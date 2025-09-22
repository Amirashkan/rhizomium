// src/core/Editor.js - CORRECTED VERSION
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
  
  // Method to delete a connection with undo support
  deleteConnection(targetNode, inputIndex) {
    if (!targetNode || !targetNode.inputs || !targetNode.inputs[inputIndex]) {
      return false;
    }
    
    const connection = targetNode.inputs[inputIndex];
    
    // Record connection details before deletion for undo
    const connectionData = {
      sourceNode: connection.sourceNode,
      sourceOutput: connection.sourceOutput,
      targetNode: targetNode,
      targetInput: inputIndex
    };
    
    // Delete the connection
    targetNode.inputs[inputIndex] = null;
    
    // Record for undo system
    if (window.onConnectionDeleted) {
      window.onConnectionDeleted(connectionData);
    }
    
    console.log('Connection deleted:', connectionData);
    
    // Trigger updates
    if (this.onChange) {
      this.onChange();
    }
    this.draw();
    
    return true;
  }

  // Method to delete a node with undo support
  deleteNode(nodeToDelete) {
    if (!nodeToDelete) return false;
    
    // Record node for undo before deletion
    if (window.onNodeDeleted) {
      window.onNodeDeleted(nodeToDelete);
    }
    
    // Remove from selection first
    if (this.selection && this.selection.has && this.selection.has(nodeToDelete)) {
      this.selection.delete(nodeToDelete);
    }
    
    // Remove all connections involving this node
    this.graph.nodes.forEach(node => {
      if (node.inputs) {
        node.inputs.forEach((input, index) => {
          if (input && input.sourceNode === nodeToDelete) {
            node.inputs[index] = null;
          }
        });
      }
    });
    
    // Remove node inputs (incoming connections)
    if (nodeToDelete.inputs) {
      nodeToDelete.inputs.forEach((input, index) => {
        if (input) {
          nodeToDelete.inputs[index] = null;
        }
      });
    }
    
    // Remove node from graph
    const nodeIndex = this.graph.nodes.indexOf(nodeToDelete);
    if (nodeIndex !== -1) {
      this.graph.nodes.splice(nodeIndex, 1);
    }
    
    console.log('Node deleted:', nodeToDelete.id);
    
    // Trigger updates
    if (this.onChange) {
      this.onChange();
    }
    this.draw();
    
    return true;
  }

  // Method to handle right-click deletion with undo support
  handleRightClickDeletion(mouseX, mouseY) {
    // Check if clicking on a connection
    const connection = this.getConnectionAt(mouseX, mouseY);
    if (connection) {
      this.deleteConnection(connection.targetNode, connection.targetInput);
      return true;
    }
    
    // Check if clicking on a node
    const node = this.getNodeAt(mouseX, mouseY);
    if (node) {
      if (confirm(`Delete node "${node.type}"?`)) {
        this.deleteNode(node);
      }
      return true;
    }
    
    return false;
  }

  // Helper method to find connection at mouse position
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
        
        // Calculate connection line
        const startX = input.sourceNode.x + 100; // Assuming output on right side
        const startY = input.sourceNode.y + 25 + (input.sourceOutput * 25);
        const endX = node.x;
        const endY = node.y + 25 + (inputIndex * 25);
        
        // Check if mouse is near the connection line
        const distance = this.distanceToLine(worldX, worldY, startX, startY, endX, endY);
        if (distance < 10) { // 10 pixel tolerance
          return {
            targetNode: node,
            targetInput: inputIndex,
            sourceNode: input.sourceNode,
            sourceOutput: input.sourceOutput
          };
        }
      }
    }
    
    return null;
  }

  // Helper method to find node at mouse position
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

  // Method to handle keyboard events with undo support
  handleKeyDown(event) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // Delete selected nodes
      if (this.selection && this.selection.getSelected && this.selection.getSelected().size > 0) {
        const nodesToDelete = Array.from(this.selection.getSelected());
        
        if (confirm(`Delete ${nodesToDelete.length} selected node(s)?`)) {
          nodesToDelete.forEach(node => {
            this.deleteNode(node);
          });
        }
      }
      event.preventDefault();
      return true;
    }
    
    return false;
  }

  // Node preview control methods
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