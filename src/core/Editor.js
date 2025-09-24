// src/core/Editor.js - Corrected with proper ErrorHandler pattern
import { EventHandler } from "./EventHandler.js";
import { Renderer } from "./Renderer.js";
import { MenuManager } from "../ui/MenuManager.js";
import { ParameterPanel } from "../ui/ParameterPanel.js";
import { SelectionManager } from "./SelectionManager.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { ViewportManager } from "./ViewportManager.js";
import { PreviewSystem } from "./PreviewSystem.js";

export class Editor {
  constructor(graph, onChange, undoManager = null) {
    try {
      // Validate required dependencies
      this.validateConstructorInputs(graph, onChange);
      
      // Initialize preview state EARLY
      this.isPreviewEnabled = true;
      this.nodePreviews = new Map();

      // Set basic properties FIRST
      this.graph = graph;
      this.onChange = this.createSafeOnChange(onChange);

      // Get canvas and context with error handling
      this.initializeCanvas();

      // Initialize managers with error handling
      this.initializeManagers(undoManager);

      // Initialize preview system
      this.initializePreviewSystem();

      // Track movement state for undo
      this.movementState = {
        isMoving: false,
        originalPositions: new Map(),
        movedNodes: new Set()
      };

      // Initialize event handling
      this.initializeEventHandling();

      // Setup and initial render
      this.setupResizeHandling();
      this.performInitialRender();
      
      console.log('Editor initialized successfully');
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'editor-construction'
      });
      throw error;
    }
  }

  // ---- INITIALIZATION METHODS WITH ERROR HANDLING ----
  
  validateConstructorInputs(graph, onChange) {
    try {
      if (!graph) {
        throw new Error('Graph is required for Editor initialization');
      }
      
      if (!graph.nodes || !Array.isArray(graph.nodes)) {
        throw new Error('Graph must have a nodes array');
      }
      
      if (onChange && typeof onChange !== 'function') {
        throw new Error('onChange must be a function if provided');
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'constructor-validation'
      });
      throw error;
    }
  }

  createSafeOnChange(onChange) {
    return (context = 'Unknown') => {
      try {
        if (typeof onChange === 'function') {
          onChange();
        }
      } catch (error) {
        window.errorHandler?.handleError(error, {
          component: 'onchange-callback',
          context
        });
      }
    };
  }

  initializeCanvas() {
    try {
      this.canvas = document.getElementById("ui-canvas");
      if (!this.canvas) {
        throw new Error('Canvas element with id "ui-canvas" not found');
      }
      
      this.ctx = this.canvas.getContext("2d");
      if (!this.ctx) {
        throw new Error('Failed to get 2D rendering context from canvas');
      }
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'canvas-initialization'
      });
      throw error;
    }
  }

  initializeManagers(undoManager) {
    try {
      // Initialize viewport manager first (needed by others)
      this.viewport = new ViewportManager();
      
      // Initialize core managers
      this.selection = new SelectionManager(this.graph, this.onChange);
      this.connections = new ConnectionManager(this.graph, this.onChange);
      this.renderer = new Renderer(this.ctx, this.viewport);
      this.menu = new MenuManager(this.graph, this.onChange);
      
      // Use the provided UndoManager instead of creating a new one
      this.undoManager = undoManager;
      
      // Set undo manager on selection manager for movement tracking
      if (this.undoManager && this.selection.setUndoManager) {
        this.selection.setUndoManager(this.undoManager);
      }
      
      // Create ParameterPanel with undo support
      this.paramPanel = new ParameterPanel(
        this.graph, 
        this.onChange, 
        this.undoManager, 
        window.parameterEventSystem
      );

      // Preview system settings
      this.previewSizes = { small: 32, medium: 64, large: 96 };
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'manager-initialization'
      });
      throw error;
    }
  }

  initializeEventHandling() {
    try {
      this.eventHandler = new EventHandler({
        canvas: this.canvas,
        viewport: this.viewport,
        selection: this.selection,
        connections: this.connections,
        menu: this.menu,
        paramPanel: this.paramPanel,
        onChange: this.onChange,
        onDraw: () => this.safeDraw(),
        editor: this,
      });
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'event-handler-initialization'
      });
      throw error;
    }
  }

  setupResizeHandling() {
    try {
      this.resize();
      
      // Safe resize handler
      this.resizeHandler = () => {
        try {
          this.resize();
          this.safeDraw();
        } catch (error) {
          window.errorHandler?.handleError(error, {
            component: 'window-resize'
          });
        }
      };
      
      window.addEventListener("resize", this.resizeHandler);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'resize-handler-setup'
      });
    }
  }

  performInitialRender() {
    try {
      this.safeDraw();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'initial-render'
      });
    }
  }

  // ---- SAFE RENDERING METHODS ----

  resize() {
    try {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;

      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'canvas-resize'
      });
    }
  }

  safeDraw() {
    try {
      this.draw();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'render'
      });
      
      // Try to recover by clearing and showing error state
      try {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#ff0000';
        this.ctx.fillText('Render Error - See notifications', 10, 30);
      } catch (recoveryError) {
        console.error('Failed to recover from render error:', recoveryError);
      }
    }
  }

  draw() {
    if (!this.renderer) {
      throw new Error('Renderer not initialized');
    }
    
    this.renderer.render(this.graph, {
      selection: this.selection.getSelected(),
      dragWire: this.connections.getDragWire(),
      boxSelect: this.selection.getBoxSelect(),
      editor: this,
    });
  }

  // ---- PREVIEW SYSTEM WITH ERROR HANDLING ----
  
  initializePreviewSystem() {
    try {
      console.log("Initializing Preview System");

      if (!this.graph || !this.graph.nodes) {
        throw new Error("No graph or nodes available for preview system");
      }

      // Initialize the preview system using factory method
      this.previewSystem = PreviewSystem.create(this);
      this.previewIntegration = this.previewSystem.integration;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-system-initialization'
      });
      // Continue without preview system
      this.previewSystem = null;
      this.previewIntegration = null;
    }
  }

  // ---- NODE MOVEMENT UNDO INTEGRATION WITH ERROR HANDLING ----
  
  startNodeMovement(nodesToMove) {
    try {
      if (this.movementState.isMoving) {
        return; // Already tracking movement
      }

      if (!nodesToMove || nodesToMove.length === 0) {
        console.warn('No nodes provided for movement tracking');
        return;
      }

      console.log('Editor: Starting node movement tracking for undo');
      this.movementState.isMoving = true;
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();

      // Record original positions with validation
      nodesToMove.forEach(node => {
        if (!node || typeof node.id === 'undefined') {
          console.warn('Invalid node in movement tracking:', node);
          return;
        }
        
        this.movementState.originalPositions.set(node.id, {
          x: typeof node.x === 'number' ? node.x : 0,
          y: typeof node.y === 'number' ? node.y : 0
        });
        this.movementState.movedNodes.add(node);
      });
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'start-node-movement',
        nodeCount: nodesToMove?.length || 0
      });
      this.cancelNodeMovement();
    }
  }

  finishNodeMovement() {
    try {
      if (!this.movementState.isMoving || this.movementState.movedNodes.size === 0) {
        return;
      }

      console.log('Editor: Finishing node movement tracking for undo');

      // Check if any nodes actually moved
      let hasMovement = false;
      const movementData = [];

      this.movementState.movedNodes.forEach(node => {
        if (!node || typeof node.id === 'undefined') {
          console.warn('Invalid node in movement finish:', node);
          return;
        }
        
        const originalPos = this.movementState.originalPositions.get(node.id);
        if (originalPos && (originalPos.x !== node.x || originalPos.y !== node.y)) {
          hasMovement = true;
          movementData.push({
            nodeId: node.id,
            oldX: originalPos.x,
            oldY: originalPos.y,
            newX: node.x,
            newY: node.y
          });
        }
      });

      // Only record undo if there was actual movement
      if (hasMovement && window.onNodesMovement && typeof window.onNodesMovement === 'function') {
        console.log('Editor: Recording node movement for undo:', movementData);
        try {
          window.onNodesMovement(movementData);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-node-movement'
          });
        }
      }

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'finish-node-movement'
      });
    } finally {
      // Always reset movement state
      this.movementState.isMoving = false;
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();
    }
  }

  cancelNodeMovement() {
    try {
      console.log('Editor: Cancelling node movement tracking');
      this.movementState.isMoving = false;
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'cancel-node-movement'
      });
    }
  }

  moveNodesToPositions(movementData) {
    try {
      if (!movementData || !Array.isArray(movementData)) {
        throw new Error('Invalid movement data provided');
      }
      
      console.log('Editor: Moving nodes to positions for undo/redo:', movementData);
      
      let movedCount = 0;
      movementData.forEach(({ nodeId, newX, newY }) => {
        const node = this.graph.nodes.find(n => n.id === nodeId);
        if (node) {
          if (typeof newX === 'number' && typeof newY === 'number') {
            node.x = newX;
            node.y = newY;
            movedCount++;
          } else {
            console.warn(`Invalid coordinates for node ${nodeId}:`, { newX, newY });
          }
        } else {
          console.warn(`Node not found for movement: ${nodeId}`);
        }
      });

      if (movedCount > 0) {
        // Trigger updates
        this.onChange('Node Movement Undo/Redo');
        this.safeDraw();
      }
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'move-nodes-to-positions',
        dataCount: movementData?.length || 0
      });
    }
  }

  // ---- UNDO SYSTEM INTEGRATION WITH ERROR HANDLING ----
  
  deleteConnection(sourceNode, targetNode, inputIndex) {
    try {
      if (!targetNode) {
        console.warn('No target node provided for connection deletion');
        return false;
      }
      
      if (!targetNode.inputs || !Array.isArray(targetNode.inputs)) {
        console.warn('Target node has no inputs array');
        return false;
      }
      
      if (inputIndex < 0 || inputIndex >= targetNode.inputs.length) {
        console.warn(`Invalid input index ${inputIndex} for node with ${targetNode.inputs.length} inputs`);
        return false;
      }

      const currentConnection = targetNode.inputs[inputIndex];
      if (currentConnection === null || currentConnection === undefined) {
        console.log('No connection to delete at specified index');
        return false;
      }

      // Find source node if not provided
      if (!sourceNode) {
        sourceNode = this.graph.nodes.find(n => n.id == currentConnection);
        if (!sourceNode) {
          console.warn(`Source node not found for connection: ${currentConnection}`);
        }
      }

      // Create connection data for undo callback
      const connectionData = {
        sourceNode: sourceNode,
        targetNode: targetNode,
        targetInput: inputIndex
      };

      // Record for undo BEFORE deleting
      if (window.onConnectionDeleted && typeof window.onConnectionDeleted === 'function') {
        console.log('Editor: Recording connection deletion for undo:', connectionData);
        try {
          window.onConnectionDeleted(connectionData);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-connection-deletion'
          });
        }
      }

      // Perform the actual deletion
      targetNode.inputs[inputIndex] = null;
      console.log(`Connection deleted: input[${inputIndex}] of node ${targetNode.id}`);

      // Trigger updates
      this.onChange('Connection Deletion');
      this.safeDraw();

      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'delete-connection',
        targetNodeId: targetNode?.id,
        inputIndex
      });
      return false;
    }
  }

  deleteNode(nodeToDelete) {
    try {
      if (!nodeToDelete) {
        console.warn('No node provided for deletion');
        return false;
      }

      const nodeIndex = this.graph.nodes.indexOf(nodeToDelete);
      if (nodeIndex === -1) {
        console.warn(`Node not found in graph: ${nodeToDelete.id}`);
        return false;
      }

      // Record for undo BEFORE deleting
      if (window.onNodeDeleted && typeof window.onNodeDeleted === 'function') {
        console.log('Editor: Recording node deletion for undo:', nodeToDelete.kind, nodeToDelete.id);
        try {
          window.onNodeDeleted(nodeToDelete);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-node-deletion'
          });
        }
      }

      // Remove from selection first
      if (this.selection && this.selection.has && this.selection.has(nodeToDelete)) {
        try {
          this.selection.delete(nodeToDelete);
        } catch (selectionError) {
          window.errorHandler?.handleError(selectionError, {
            component: 'remove-from-selection'
          });
        }
      }

      // Remove all connections to this node
      let connectionsRemoved = 0;
      this.graph.nodes.forEach(node => {
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, index) => {
            if (input === nodeToDelete.id || input == nodeToDelete.id) {
              node.inputs[index] = null;
              connectionsRemoved++;
              console.log(`Removed connection to deleted node from ${node.kind}[${index}]`);
            }
          });
        }
      });

      // Remove the node from graph
      this.graph.nodes.splice(nodeIndex, 1);
      console.log(`Node ${nodeToDelete.kind}(${nodeToDelete.id}) deleted from graph`);
      
      if (connectionsRemoved > 0) {
        console.log(`Removed ${connectionsRemoved} connections to deleted node`);
      }

      // Trigger updates
      this.onChange('Node Deletion');
      this.safeDraw();

      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'delete-node',
        nodeId: nodeToDelete?.id,
        nodeKind: nodeToDelete?.kind
      });
      return false;
    }
  }

  deleteNodesAsGroup(nodesToDelete) {
    try {
      if (!nodesToDelete || nodesToDelete.length === 0) {
        console.warn('No nodes provided for group deletion');
        return false;
      }
      
      console.log('Editor: Deleting nodes as group:', nodesToDelete.length, 'nodes');
      
      // Validate nodes exist in graph
      const validNodes = nodesToDelete.filter(node => {
        if (!node) return false;
        const exists = this.graph.nodes.includes(node);
        if (!exists) {
          console.warn(`Node not found in graph for group deletion: ${node?.id}`);
        }
        return exists;
      });
      
      if (validNodes.length === 0) {
        console.warn('No valid nodes found for deletion');
        return false;
      }
      
      // Record for undo BEFORE deleting (as a single group operation)
      if (window.onGroupDeleted && typeof window.onGroupDeleted === 'function') {
        console.log('Editor: Recording group deletion for undo');
        try {
          window.onGroupDeleted(validNodes);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-group-deletion'
          });
        }
      }
      
      // Remove from selection first
      validNodes.forEach(nodeToDelete => {
        if (this.selection && this.selection.has && this.selection.has(nodeToDelete)) {
          try {
            this.selection.delete(nodeToDelete);
          } catch (selectionError) {
            console.warn('Error removing node from selection:', selectionError);
          }
        }
      });
      
      // Get all node IDs for efficient cleanup
      const nodeIdsToDelete = new Set(validNodes.map(n => n.id));
      
      // Remove all connections to these nodes
      let connectionsRemoved = 0;
      this.graph.nodes.forEach(node => {
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, index) => {
            if (input !== null && input !== undefined && nodeIdsToDelete.has(input)) {
              node.inputs[index] = null;
              connectionsRemoved++;
              console.log(`Removed connection to deleted node from ${node.kind}[${index}]`);
            }
          });
        }
      });
      
      // Remove nodes from graph (in reverse order to maintain indices)
      const sortedNodesToDelete = validNodes
        .map(node => ({ node, index: this.graph.nodes.indexOf(node) }))
        .filter(item => item.index !== -1)
        .sort((a, b) => b.index - a.index); // Sort by index descending
      
      sortedNodesToDelete.forEach(({ node, index }) => {
        this.graph.nodes.splice(index, 1);
        console.log(`Node ${node.kind}(${node.id}) deleted from graph`);
      });
      
      console.log(`Group deletion completed: ${validNodes.length} nodes, ${connectionsRemoved} connections`);
      
      // Trigger updates
      this.onChange('Group Deletion');
      this.safeDraw();
      
      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'delete-nodes-group',
        nodeCount: nodesToDelete?.length || 0
      });
      return false;
    }
  }

  createConnection(sourceNodeId, targetNodeId, targetInput) {
    try {
      // Validate inputs
      if (typeof sourceNodeId === 'undefined' || typeof targetNodeId === 'undefined') {
        throw new Error('Source and target node IDs are required');
      }
      
      if (typeof targetInput !== 'number' || targetInput < 0) {
        throw new Error('Valid target input index is required');
      }

      const sourceNode = this.graph.nodes.find(n => n.id == sourceNodeId);
      const targetNode = this.graph.nodes.find(n => n.id == targetNodeId);

      if (!sourceNode) {
        throw new Error(`Source node not found: ${sourceNodeId}`);
      }
      
      if (!targetNode) {
        throw new Error(`Target node not found: ${targetNodeId}`);
      }

      // Prevent self-connection
      if (sourceNodeId == targetNodeId) {
        console.warn('Cannot connect node to itself');
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

      // Check if connection already exists
      if (targetNode.inputs[targetInput] == sourceNodeId) {
        console.log('Connection already exists, skipping creation');
        return true;
      }

      // Create the connection
      targetNode.inputs[targetInput] = sourceNodeId;
      console.log(`Connection created: ${sourceNode.kind}(${sourceNodeId}) -> ${targetNode.kind}(${targetNodeId})[${targetInput}]`);

      // Record for undo AFTER successful creation
      if (window.onConnectionCreated && typeof window.onConnectionCreated === 'function') {
        console.log('Editor: Recording connection creation for undo:', { sourceNodeId, targetNodeId, targetInput });
        try {
          window.onConnectionCreated(sourceNodeId, targetNodeId, targetInput);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-connection-creation'
          });
        }
      }

      // Trigger updates
      this.onChange('Connection Creation');
      this.safeDraw();

      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'create-connection',
        sourceNodeId,
        targetNodeId,
        targetInput
      });
      return false;
    }
  }

  createNode(nodeType, x, y) {
    try {
      // Validate inputs
      if (!nodeType || typeof nodeType !== 'string') {
        throw new Error('Valid node type string is required');
      }
      
      if (typeof x !== 'number' || typeof y !== 'number') {
        throw new Error('Valid x and y coordinates are required');
      }

      const { makeNode } = window.NodeDefs || {};
      if (!makeNode || typeof makeNode !== 'function') {
        throw new Error('makeNode function not available in NodeDefs');
      }

      const newNode = makeNode(nodeType, x, y);
      
      if (!newNode) {
        throw new Error(`Failed to create node of type: ${nodeType}`);
      }
      
      if (!newNode.id) {
        throw new Error('Created node missing required ID');
      }

      this.graph.nodes.push(newNode);
      console.log(`Node ${nodeType}(${newNode.id}) created at (${x}, ${y})`);

      // Record for undo AFTER successful creation
      if (window.onNodeCreated && typeof window.onNodeCreated === 'function') {
        console.log('Editor: Recording node creation for undo:', newNode.kind, newNode.id);
        try {
          window.onNodeCreated(newNode);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-node-creation'
          });
        }
      }

      // Trigger updates
      this.onChange('Node Creation');
      this.safeDraw();

      return newNode;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'create-node',
        nodeType,
        coordinates: { x, y }
      });
      return null;
    }
  }

  // ---- KEYBOARD HANDLING WITH ERROR HANDLING ----
  
  handleKeyDown(event) {
    try {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        
        if (this.selection && this.selection.getSelected && this.selection.getSelected().size > 0) {
          // Get selected node IDs
          const selectedNodeIds = Array.from(this.selection.getSelected());
          
          // Convert IDs to actual node objects
          const nodesToDelete = selectedNodeIds
            .map(nodeId => this.graph.nodes.find(n => n.id === nodeId))
            .filter(node => node !== undefined);
          
          console.log('Deleting selected nodes:', nodesToDelete.length, 'nodes:', nodesToDelete.map(n => n.kind));
          
          if (nodesToDelete.length === 0) {
            console.warn('No valid nodes selected for deletion');
            return true;
          }
          
          // Handle group deletion as a single operation
          let deletionSuccess = false;
          if (nodesToDelete.length > 1) {
            deletionSuccess = this.deleteNodesAsGroup(nodesToDelete);
          } else {
            deletionSuccess = this.deleteNode(nodesToDelete[0]);
          }
          
          // Clear selection after deletion
          if (this.selection.clear) {
            try {
              this.selection.clear();
            } catch (clearError) {
              console.warn('Error clearing selection after deletion:', clearError);
            }
          }
          
          if (deletionSuccess) {
            console.log(`Successfully deleted ${nodesToDelete.length} nodes`);
          }
          
        } else {
          console.log('No nodes selected for deletion');
        }
        
        return true;
      }
      
      // Cancel movement on ESC
      if (event.key === 'Escape') {
        this.cancelNodeMovement();
        return true;
      }
      
      return false;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'keyboard-handler',
        key: event?.key
      });
      return false;
    }
  }

  // ---- MOUSE EVENT HANDLING WITH ERROR HANDLING ----
  
  handleRightClick(mouseX, mouseY) {
    try {
      // Convert screen coordinates to canvas coordinates
      const rect = this.canvas.getBoundingClientRect();
      const canvasX = mouseX - rect.left;
      const canvasY = mouseY - rect.top;
      
      // Check if clicking on a connection
      const connectionInfo = this.getConnectionAt(canvasX, canvasY);
      if (connectionInfo) {
        if (this.deleteConnection(connectionInfo.sourceNode, connectionInfo.targetNode, connectionInfo.targetInput)) {
          console.log('Connection deleted via right click');
        }
        return true;
      }

      // Check if clicking on a node
      const node = this.getNodeAt(canvasX, canvasY);
      if (node) {
        const confirmMessage = `Delete node "${node.kind}"?`;
        if (confirm(confirmMessage)) {
          if (this.deleteNode(node)) {
            console.log(`Node "${node.kind}" deleted via right click`);
          }
        }
        return true;
      }

      return false;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'right-click-handler',
        mousePosition: { x: mouseX, y: mouseY }
      });
      return false;
    }
  }

  // ---- HELPER METHODS WITH ERROR HANDLING ----
  
  getConnectionAt(mouseX, mouseY) {
    try {
      // Convert screen coordinates to world coordinates
      const worldX = (mouseX - this.viewport.panX) / this.viewport.zoom;
      const worldY = (mouseY - this.viewport.panY) / this.viewport.zoom;

      // Check all connections
      for (const node of this.graph.nodes) {
        if (!node.inputs || !Array.isArray(node.inputs)) continue;

        for (let inputIndex = 0; inputIndex < node.inputs.length; inputIndex++) {
          const input = node.inputs[inputIndex];
          if (!input) continue;

          const sourceNode = this.graph.nodes.find(n => n.id == input);
          if (!sourceNode) continue;

          // Calculate connection line (adjust based on your rendering)
          const startX = sourceNode.x + 120;
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
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Get Connection At Position', 'warning');
      return null;
    }
  }

  getNodeAt(mouseX, mouseY) {
    try {
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
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Get Node At Position', 'warning');
      return null;
    }
  }

  distanceToLine(px, py, x1, y1, x2, y2) {
    try {
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
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Distance to Line Calculation', 'warning');
      return Infinity; // Safe fallback
    }
  }

  // ---- NODE PREVIEW METHODS WITH ERROR HANDLING ----
  
  toggleNodePreview(nodeId) {
    try {
      if (typeof nodeId === 'undefined') {
        throw new Error('Node ID is required for preview toggle');
      }

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
        if (node && this.previewIntegration) {
          try {
            this.previewIntegration.generateNodePreview(node);
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, 'Generate Node Preview', 'warning');
          }
        } else if (!node) {
          console.warn(`Node not found for preview: ${nodeId}`);
        }
      } else {
        const node = this.graph.nodes.find((n) => n.id === nodeId);
        if (node) node.__thumb = null;
      }

      this.safeDraw();
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Toggle Node Preview', 'warning');
    }
  }

  cyclePreviewSize(nodeId) {
    try {
      if (typeof nodeId === 'undefined') {
        throw new Error('Node ID is required for preview size cycling');
      }

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
        if (node && this.previewIntegration) {
          try {
            this.previewIntegration.generateNodePreview(node);
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, 'Update Node Preview Size', 'warning');
          }
        } else if (!node) {
          console.warn(`Node not found for preview size update: ${nodeId}`);
        }
      }

      this.safeDraw();
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Cycle Preview Size', 'warning');
    }
  }

  toggleNodeVisualInfo(nodeId) {
    try {
      if (typeof nodeId === 'undefined') {
        throw new Error('Node ID is required for visual info toggle');
      }

      if (!this.nodePreviews.has(nodeId)) {
        this.nodePreviews.set(nodeId, {
          enabled: true,
          size: "small",
          showVisualInfo: true,
        });
      }
      
      const preview = this.nodePreviews.get(nodeId);
      preview.showVisualInfo = !preview.showVisualInfo;
      console.log(`Visual info toggled for node ${nodeId}: ${preview.showVisualInfo ? 'ON' : 'OFF'}`);
      
      this.safeDraw();
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Toggle Visual Info', 'warning');
    }
  }

  // ---- PREVIEW HELPER METHODS WITH ERROR HANDLING ----
  
  shouldShowPreview(node) {
    try {
      if (!node) return false;
      return this.isPreviewEnabled || !!node.__thumb;
    } catch (error) {
      console.warn('Error checking preview visibility:', error);
      return false;
    }
  }

  isPreviewEnabled(nodeId) {
    try {
      if (typeof nodeId === 'undefined') return true;
      const preview = this.nodePreviews.get(nodeId);
      return preview ? preview.enabled : true;
    } catch (error) {
      console.warn('Error checking preview enabled state:', error);
      return true;
    }
  }

  isVisualInfoEnabled(nodeId) {
    try {
      if (typeof nodeId === 'undefined') return true;
      const preview = this.nodePreviews.get(nodeId);
      return preview ? preview.showVisualInfo : true;
    } catch (error) {
      console.warn('Error checking visual info enabled state:', error);
      return true;
    }
  }

  getPreviewSize(nodeId) {
    try {
      if (typeof nodeId === 'undefined') return this.previewSizes.small;
      const preview = this.nodePreviews.get(nodeId);
      const sizeKey = preview?.size || "small";
      return this.previewSizes[sizeKey] || this.previewSizes.small;
    } catch (error) {
      console.warn('Error getting preview size:', error);
      return this.previewSizes.small;
    }
  }

  // ---- SELECTION API WITH ERROR HANDLING ----
  
  selectAll() {
    try {
      if (this.selection && this.selection.selectAll) {
        this.selection.selectAll();
        this.errorHandler.showInfo(`Selected ${this.graph.nodes.length} nodes`, 'Select All');
      } else {
        console.warn('Selection manager not available for selectAll');
      }
    } catch (error) {
      window.errorHandler?.handleError(error, 'Select All', 'warning');
    }
  }

  moveSelection(dx, dy) {
    try {
      if (typeof dx !== 'number' || typeof dy !== 'number') {
        throw new Error('Valid dx and dy values are required for move selection');
      }

      if (this.selection && this.selection.moveSelected) {
        this.selection.moveSelected(dx, dy);
        this.onChange('Move Selection');
        this.safeDraw();
      } else {
        console.warn('Selection manager not available for moveSelection');
      }
    } catch (error) {
      window.errorHandler?.handleError(error, 'Move Selection', 'warning');
    }
  }

  duplicateSelected() {
    try {
      if (this.selection && this.selection.duplicateSelected) {
        const result = this.selection.duplicateSelected();
        if (result) {
          this.errorHandler.showSuccess('Selected nodes duplicated', 'Duplicate');
          this.onChange('Duplicate Selection');
          this.safeDraw();
        }
      } else {
        console.warn('Selection manager not available for duplicateSelected');
      }
    } catch (error) {
      window.errorHandler?.handleError(error, 'Duplicate Selection', 'warning');
    }
  }

  // ---- ERROR HANDLING UTILITIES ----
  
  handleCriticalError(error, context) {
    console.error(`CRITICAL ERROR in ${context}:`, error);
    
    if (this.errorHandler) {
      window.errorHandler?.handleError(error, `Critical: ${context}`, 'error', 0);
    } else {
      // Fallback if error handler not available
      alert(`Critical Error: ${error.message || error}\n\nContext: ${context}\n\nCheck console for details.`);
    }
  }

  // ---- CLEANUP AND DISPOSAL ----
  
  dispose() {
    try {
      console.log('Disposing Editor...');
      
      // Remove event listeners
      if (this.resizeHandler) {
        window.removeEventListener("resize", this.resizeHandler);
        this.resizeHandler = null;
      }
      
      // Dispose of managers
      if (this.eventHandler && this.eventHandler.dispose) {
        this.eventHandler.dispose();
      }
      
      if (this.previewSystem && this.previewSystem.dispose) {
        this.previewSystem.dispose();
      }
      
      // Clear references
      this.canvas = null;
      this.ctx = null;
      this.graph = null;
      this.onChange = null;
      this.viewport = null;
      this.selection = null;
      this.connections = null;
      this.renderer = null;
      this.menu = null;
      this.paramPanel = null;
      this.previewSystem = null;
      this.previewIntegration = null;
      this.undoManager = null;
      this.errorHandler = null;
      
      // Clear maps
      this.nodePreviews.clear();
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();
      
      console.log('Editor disposed successfully');
      
    } catch (error) {
      console.error('Error during Editor disposal:', error);
    }
  }

  // ---- LEGACY COMPATIBILITY METHODS ----
  
  copySelected() {
    // Legacy method - could be enhanced with actual clipboard functionality
    console.log('copySelected called - legacy method');
  }

  pasteAtCursor() {
    // Legacy method - could be enhanced with actual paste functionality
    console.log('pasteAtCursor called - legacy method');
  }

  // ---- DEBUG AND DIAGNOSTIC METHODS ----
  
  getDebugInfo() {
    try {
      return {
        nodeCount: this.graph?.nodes?.length || 0,
        previewCount: this.nodePreviews.size,
        isMoving: this.movementState.isMoving,
        hasSelection: this.selection?.getSelected?.().size > 0,
        canvasSize: {
          width: this.canvas?.width || 0,
          height: this.canvas?.height || 0
        },
        viewport: {
          zoom: this.viewport?.zoom || 1,
          panX: this.viewport?.panX || 0,
          panY: this.viewport?.panY || 0
        }
      };
    } catch (error) {
      console.warn('Error getting debug info:', error);
      return { error: error.message };
    }
  }

  validateGraphIntegrity() {
    try {
      const issues = [];
      
      if (!this.graph || !Array.isArray(this.graph.nodes)) {
        issues.push('Graph or nodes array missing');
        return issues;
      }
      
      // Check for duplicate node IDs
      const ids = new Set();
      this.graph.nodes.forEach((node, index) => {
        if (!node) {
          issues.push(`Null node at index ${index}`);
          return;
        }
        
        if (typeof node.id === 'undefined') {
          issues.push(`Node missing ID at index ${index}`);
          return;
        }
        
        if (ids.has(node.id)) {
          issues.push(`Duplicate node ID: ${node.id}`);
        } else {
          ids.add(node.id);
        }
        
        // Check connections reference valid nodes
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, inputIndex) => {
            if (input !== null && input !== undefined && !ids.has(input)) {
              issues.push(`Node ${node.id} input[${inputIndex}] references non-existent node: ${input}`);
            }
          });
        }
      });
      
      if (issues.length > 0) {
        console.warn('Graph integrity issues found:', issues);
        this.errorHandler.showWarning(`Found ${issues.length} graph integrity issues`, 'Validation');
      }
      
      return issues;
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Graph Validation', 'warning');
      return ['Validation failed: ' + error.message];
    }
  }
}