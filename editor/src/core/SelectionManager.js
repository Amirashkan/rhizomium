// src/core/SelectionManager.js - Updated with permanent undo integration and error handling
import { NodeDefs, makeNode } from "../data/NodeDefs.js";

let _nextId = 1; // TODO: Move this to a proper ID generator utility

export class SelectionManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.boxSelect = null;
    this.dragging = null;
    this.undoManager = null;
    this.snapSettings = {
      enabled: false,
      gridSize: 20,
    };
    // Performance optimization: throttle selection box updates
    this._boxSelectUpdateScheduled = false;
    this._pendingBoxUpdate = null;
  }

  // Setter for undoManager (called from Editor)
  setUndoManager(undoManager) {
    this.undoManager = undoManager;
  }

  setSnapEnabled(enabled) {
    this.snapSettings.enabled = !!enabled;
  }

  setSnapGridSize(size) {
    if (Number.isFinite(size) && size > 0) {
      this.snapSettings.gridSize = size;
    }
  }

  getSnapSettings() {
    return {
      enabled: !!this.snapSettings.enabled,
      gridSize: this.snapSettings.gridSize,
    };
  }

  isSnapEnabled() {
    return !!this.snapSettings.enabled;
  }

  applySnap(x, y) {
    if (!this.snapSettings.enabled) {
      return { x, y };
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x, y };
    }

    const size = this.snapSettings.gridSize;
    if (!Number.isFinite(size) || size <= 0) {
      return { x, y };
    }

    const snappedX = Math.round(x / size) * size;
    const snappedY = Math.round(y / size) * size;

    return {
      x: Number.isFinite(snappedX) ? snappedX : x,
      y: Number.isFinite(snappedY) ? snappedY : y,
    };
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

  isSelected(node) {
    const id = typeof node === "object" ? node.id : node;
    return this.graph.selection?.has?.(id) || false;
  }

  startBoxSelect(x, y) {
    try {
      this.graph.selection.clear();
      this.boxSelect = { x0: x, y0: y, x1: x, y1: y };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'box-selection-start',
        position: { x, y }
      });
    }
  }

  updateBoxSelect(x, y) {
    try {
      if (!this.boxSelect) return;

      this.boxSelect.x1 = x;
      this.boxSelect.y1 = y;

      // Store the pending update position
      this._pendingBoxUpdate = { x, y };

      // Only schedule one update per animation frame for performance
      if (!this._boxSelectUpdateScheduled) {
        this._boxSelectUpdateScheduled = true;
        requestAnimationFrame(() => {
          this._boxSelectUpdateScheduled = false;
          if (this._pendingBoxUpdate) {
            this._updateBoxSelection();
            this._pendingBoxUpdate = null;
          }
        });
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'box-selection-update',
        position: { x, y }
      });
    }
  }

  endBoxSelect() {
    try {
      if (this.boxSelect) {
        // Force final update immediately (bypass throttling)
        this._updateBoxSelection();
        this.boxSelect = null;
        // Clear any pending updates
        this._pendingBoxUpdate = null;
        this._boxSelectUpdateScheduled = false;
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'box-selection-end'
      });
    }
  }

  _updateBoxSelection() {
    try {
      if (!this.boxSelect) return;

      const x0 = Math.min(this.boxSelect.x0, this.boxSelect.x1);
      const y0 = Math.min(this.boxSelect.y0, this.boxSelect.y1);
      const x1 = Math.max(this.boxSelect.x0, this.boxSelect.x1);
      const y1 = Math.max(this.boxSelect.y0, this.boxSelect.y1);

      // Early exit for very small selection boxes (likely accidental clicks)
      const width = x1 - x0;
      const height = y1 - y0;
      if (width < 5 && height < 5) {
        this.graph.selection.clear();
        if (this.onChange) this.onChange();
        return;
      }

      // Build new selection set without clearing first (reduces Set operations)
      const newSelection = new Set();

      // Optimized overlap check - only iterate through nodes once
      for (const n of this.graph.nodes) {
        // Check if node's bounding box intersects with selection box
        // Using separate comparisons is faster than complex boolean expressions
        if (n.x + n.w < x0) continue; // Node is entirely to the left
        if (n.x > x1) continue;        // Node is entirely to the right
        if (n.y + n.h < y0) continue; // Node is entirely above
        if (n.y > y1) continue;        // Node is entirely below

        // If we reach here, there's an overlap
        newSelection.add(n.id);
      }

      // Only update and trigger onChange if selection actually changed
      if (newSelection.size !== this.graph.selection.size ||
          ![...newSelection].every(id => this.graph.selection.has(id))) {
        this.graph.selection = newSelection;
        if (this.onChange) this.onChange();
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'box-selection-calculation'
      });
    }
  }

  startDrag(nodeId, startX, startY) {
    try {
      if (!nodeId) {
        throw new Error('Invalid node ID for drag operation');
      }

      let dragIds;

      if (this.graph.selection.has(nodeId)) {
        dragIds = new Set(this.graph.selection);
      } else {
        dragIds = new Set([nodeId]);
        this.graph.selection = new Set([nodeId]);
        if (this.onChange) this.onChange();
      }

      // PERFORMANCE: Cache node references instead of storing just IDs
      // This avoids O(n) lookups on every mousemove event
      const nodes = [];
      const orig = {};
      for (const id of dragIds) {
        const n = this.graph.nodes.find((m) => m.id === id);
        if (n) {
          nodes.push(n);
          orig[id] = { x: n.x, y: n.y };
        }
      }

      this.dragging = {
        ids: dragIds,
        nodes, // Cache node references for fast access
        start: { x: startX, y: startY },
        orig,
        hasMoved: false // Track if any movement has occurred
      };
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'drag-start',
        nodeId,
        position: { x: startX, y: startY }
      });
    }
  }

  updateDrag(currentX, currentY) {
    try {
      if (!this.dragging) return;

      const dx = currentX - this.dragging.start.x;
      const dy = currentY - this.dragging.start.y;

      // Track if there's been any movement
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.dragging.hasMoved = true;
      }

      // PERFORMANCE: Use cached node references instead of repeated find() calls
      // This eliminates O(n) lookups on every mousemove event
      for (const n of this.dragging.nodes) {
        const o = this.dragging.orig[n.id];
        if (!o) continue;

        const baseX = Number.isFinite(o.x) ? o.x : 0;
        const baseY = Number.isFinite(o.y) ? o.y : 0;
        const snapped = this.applySnap(baseX + dx, baseY + dy);

        n.x = snapped.x;
        n.y = snapped.y;
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'drag-update',
        position: { x: currentX, y: currentY }
      });
    }
  }

// Replace the endDrag() method in your SelectionManager with this fixed version:

endDrag() {
  try {
    if (!this.dragging) return;

    // Only record for undo if there was actual movement
    if (this.dragging.hasMoved && this.undoManager) {
      const nodeMovements = []; // Array format expected by UndoManager

      // PERFORMANCE: Use cached node references instead of repeated find() calls
      for (const node of this.dragging.nodes) {
        const originalPos = this.dragging.orig[node.id];
        const currentPos = { x: node.x, y: node.y };

        // Only record if position actually changed
        if (originalPos.x !== currentPos.x || originalPos.y !== currentPos.y) {
          nodeMovements.push({
            nodeId: node.id,
            oldX: originalPos.x,
            oldY: originalPos.y,
            newX: currentPos.x,
            newY: currentPos.y
          });
        }
      }

      // Record for undo if any nodes actually moved
      if (nodeMovements.length > 0) {
        console.log('Recording node movement for undo:', nodeMovements.length, 'nodes');
        this.undoManager.recordNodeMovement(nodeMovements);
      }
    }

    this.dragging = null;
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'drag-end'
    });
    // Reset dragging state even if error occurs
    this.dragging = null;
  }
}

  selectAll() {
    try {
      this.graph.selection = new Set(this.graph.nodes.map((n) => n.id));
      if (this.onChange) this.onChange();
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'select-all' 
      });
    }
  }

  clear() {
    try {
      if (!this.graph?.selection || this.graph.selection.size === 0) {
        return;
      }

      this.graph.selection.clear();
      if (this.onChange) this.onChange();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'selection-clear',
        selectedCount: this.graph?.selection?.size || 0,
      });
    }
  }

deleteSelected() {
  try {
    const ids = new Set(this.graph.selection);
    if (ids.size === 0) return;

    // Get nodes to delete before removing them
    const nodesToDelete = this.graph.nodes.filter((n) => ids.has(n.id));

    console.log('SelectionManager.deleteSelected called with', nodesToDelete.length, 'nodes');

    // USE GROUP DELETION for multiple nodes
    if (nodesToDelete.length > 1 && window.onGroupDeleted && typeof window.onGroupDeleted === 'function') {
      console.log("SelectionManager: Using group deletion for", nodesToDelete.length, "nodes");
      window.onGroupDeleted(nodesToDelete);
    } else if (nodesToDelete.length === 1) {
      // Single node - use individual deletion with connection tracking
      if (window.onNodeDeleted && typeof window.onNodeDeleted === 'function') {
        console.log("SelectionManager: Recording single node deletion with connections for undo:", nodesToDelete[0].kind, nodesToDelete[0].id);
        
        // Find all connections involving this node BEFORE deletion
        const nodeConnections = this._findAllNodeConnections(nodesToDelete[0]);
        console.log("Found connections for node", nodesToDelete[0].id, ":", nodeConnections);
        
        // Create enhanced node record with connections
        const enhancedNode = {
          ...nodesToDelete[0],
          _connectionSnapshot: nodeConnections
        };
        
        window.onNodeDeleted(enhancedNode);
      }
    }

    // Find connections to remove BEFORE filtering
    const connectionsToRemove = this.graph.connections.filter(
      (c) => ids.has(c.from.nodeId) || ids.has(c.to.nodeId)
    );

    // Auto-reconnect wires when nodes are deleted
    // For each deleted node, reconnect incoming connections to outgoing connections
    for (const nodeToDelete of nodesToDelete) {
      this._autoReconnectWires(nodeToDelete, ids);
    }

    // Clean up input references for connections being removed
    for (const conn of connectionsToRemove) {
      // Find the target node and clear its input
      const targetNode = this.graph.nodes.find(n => n.id === conn.to.nodeId);
      if (targetNode && targetNode.inputs) {
        const inputIndex = conn.to.pin || 0;
        if (targetNode.inputs[inputIndex] === conn.from.nodeId) {
          targetNode.inputs[inputIndex] = null; // Set to null, not undefined
        }
      }
    }

    // Remove connections involving selected nodes
    this.graph.connections = this.graph.connections.filter(
      (c) => !(ids.has(c.from.nodeId) || ids.has(c.to.nodeId))
    );

    // Remove nodes
    this.graph.nodes = this.graph.nodes.filter((n) => !ids.has(n.id));
    this.graph.selection.clear();

    if (this.onChange) this.onChange();
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'node-deletion',
      selectedCount: this.graph.selection?.size || 0
    });
  }
}

  // Helper method to automatically reconnect wires when a node is deleted
  // Connects incoming connections to outgoing connections, bypassing the deleted node
  _autoReconnectWires(nodeToDelete, deletedNodeIds) {
    try {
      if (!nodeToDelete || !nodeToDelete.id) {
        return;
      }

      // Find all incoming connections (connections TO the node being deleted)
      const incomingConnections = this.graph.connections.filter(
        (c) => c.to.nodeId === nodeToDelete.id && !deletedNodeIds.has(c.from.nodeId)
      );

      // Find all outgoing connections (connections FROM the node being deleted)
      const outgoingConnections = this.graph.connections.filter(
        (c) => c.from.nodeId === nodeToDelete.id && !deletedNodeIds.has(c.to.nodeId)
      );

      // If no incoming or outgoing connections, nothing to reconnect
      if (incomingConnections.length === 0 || outgoingConnections.length === 0) {
        return;
      }

      // For each incoming connection, try to connect it to each outgoing connection's target
      for (const incomingConn of incomingConnections) {
        const sourceNodeId = incomingConn.from.nodeId;
        const sourcePin = incomingConn.from.pin || 0;

        // Skip if source node is also being deleted
        if (deletedNodeIds.has(sourceNodeId)) {
          continue;
        }

        for (const outgoingConn of outgoingConnections) {
          const targetNodeId = outgoingConn.to.nodeId;
          const targetPin = outgoingConn.to.pin || 0;

          // Skip if target node is also being deleted
          if (deletedNodeIds.has(targetNodeId)) {
            continue;
          }

          // Skip self-connections
          if (sourceNodeId === targetNodeId) {
            continue;
          }

          // Validate the connection is possible
          if (!this._isReconnectionValid(sourceNodeId, sourcePin, targetNodeId, targetPin)) {
            continue;
          }

          // Check if connection already exists
          const existingConnection = this.graph.connections.find(
            (c) => c.from.nodeId === sourceNodeId &&
                   c.from.pin === sourcePin &&
                   c.to.nodeId === targetNodeId &&
                   c.to.pin === targetPin
          );

          if (existingConnection) {
            continue; // Connection already exists, skip
          }

          // Create the new connection
          const newConnection = {
            from: { nodeId: sourceNodeId, pin: sourcePin },
            to: { nodeId: targetNodeId, pin: targetPin },
          };

          this.graph.connections.push(newConnection);

          // Update target node's inputs array
          const targetNode = this.graph.nodes.find((n) => n.id === targetNodeId);
          if (targetNode) {
            if (!targetNode.inputs) {
              targetNode.inputs = [];
            }
            // Update the input to point to the new source
            // This should be safe because we found an outgoing connection from deleted node to this target
            targetNode.inputs[targetPin] = sourceNodeId;
          }

          // Record for undo if available
          if (window.onConnectionCreated && typeof window.onConnectionCreated === 'function') {
            window.onConnectionCreated(
              sourceNodeId,
              targetNodeId,
              targetPin,
              sourcePin
            );
          }
        }
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'auto-reconnect-wires',
        nodeId: nodeToDelete?.id
      });
    }
  }

  // Helper method to validate if a reconnection is valid
  _isReconnectionValid(fromNodeId, fromPin, toNodeId, toPin) {
    try {
      const fromNode = this.graph.nodes.find((n) => n.id === fromNodeId);
      const toNode = this.graph.nodes.find((n) => n.id === toNodeId);

      if (!fromNode || !toNode) {
        return false;
      }

      // Prevent self-connections
      if (fromNodeId === toNodeId) {
        return false;
      }

      // Check if pins exist
      const fromDef = NodeDefs[fromNode.kind];
      const toDef = NodeDefs[toNode.kind];

      if (!fromDef || !toDef) {
        return false;
      }

      const fromOutPins = fromDef.pinsOut || [];
      const toInPins = toDef.pinsIn || [];

      if (fromPin >= fromOutPins.length || toPin >= toInPins.length) {
        return false;
      }

      // Basic type compatibility check (can be enhanced later)
      // For now, allow all connections that pass the above checks
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'reconnection-validation',
        fromNodeId,
        toNodeId
      });
      return false;
    }
  }

  // Helper method to find all connections involving a node
  _findAllNodeConnections(node) {
    try {
      const connections = {
        incoming: [], // Connections TO this node
        outgoing: [], // Connections FROM this node
        nodeInputs: node.inputs ? [...node.inputs] : [] // Copy of node's input array
      };

      // Find incoming connections (this node as target)
      this.graph.nodes.forEach(otherNode => {
        if (otherNode.inputs && Array.isArray(otherNode.inputs)) {
          otherNode.inputs.forEach((input, inputIndex) => {
            if (input === node.id || input == node.id) {
              connections.incoming.push({
                sourceNodeId: node.id,
                targetNodeId: otherNode.id,
                targetInput: inputIndex
              });
            }
          });
        }
      });

      // Find outgoing connections (this node as source) - from node.inputs
      if (node.inputs && Array.isArray(node.inputs)) {
        node.inputs.forEach((input, inputIndex) => {
          if (input !== null && input !== undefined) {
            connections.outgoing.push({
              sourceNodeId: input,
              targetNodeId: node.id,
              targetInput: inputIndex
            });
          }
        });
      }

      // Also check graph.connections array for completeness
      this.graph.connections.forEach(conn => {
        if (conn.from.nodeId == node.id) {
          // This node is source - add to outgoing if not already there
          const exists = connections.outgoing.some(c => 
            c.sourceNodeId == conn.from.nodeId && 
            c.targetNodeId == conn.to.nodeId && 
            c.targetInput == conn.to.pin
          );
          if (!exists) {
            connections.outgoing.push({
              sourceNodeId: conn.from.nodeId,
              targetNodeId: conn.to.nodeId,
              targetInput: conn.to.pin
            });
          }
        }
        if (conn.to.nodeId == node.id) {
          // This node is target - add to incoming if not already there
          const exists = connections.incoming.some(c => 
            c.sourceNodeId == conn.from.nodeId && 
            c.targetNodeId == conn.to.nodeId && 
            c.targetInput == conn.to.pin
          );
          if (!exists) {
            connections.incoming.push({
              sourceNodeId: conn.from.nodeId,
              targetNodeId: conn.to.nodeId,
              targetInput: conn.to.pin
            });
          }
        }
      });

      return connections;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connection-tracking',
        nodeId: node?.id
      });
      return { incoming: [], outgoing: [], nodeInputs: [] };
    }
  }

  moveSelected(dx, dy) {
    try {
      const ids = this.graph.selection || new Set();
      if (!ids.size) return;

      // Validate movement values
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new Error('Invalid movement values');
      }

      // Store original positions
      const movements = [];

      for (const n of this.graph.nodes) {
        if (ids.has(n.id)) {
          const originalPos = { 
            x: Number.isFinite(n.x) ? n.x : 0, 
            y: Number.isFinite(n.y) ? n.y : 0 
          };

          const snapped = this.applySnap(originalPos.x + dx, originalPos.y + dy);

          n.x = snapped.x;
          n.y = snapped.y;

          if (originalPos.x !== n.x || originalPos.y !== n.y) {
            movements.push({
              nodeId: n.id,
              oldX: originalPos.x,
              oldY: originalPos.y,
              newX: n.x,
              newY: n.y,
            });
          }
        }
      }

      // Record for undo if we have an undoManager and nodes were moved
      if (this.undoManager && movements.length > 0) {
        console.log('Recording keyboard movement for undo:', movements.length, 'nodes');
        this.undoManager.recordNodeMovement(movements);
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'move-selected',
        delta: { dx, dy },
        selectedCount: this.graph.selection?.size || 0
      });
    }
  }

  duplicateSelected() {
    try {
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
        const snapped = this.applySnap(
          (Number.isFinite(n.x) ? n.x : 0) + 20,
          (Number.isFinite(n.y) ? n.y : 0) + 20
        );
        c.x = snapped.x;
        c.y = snapped.y;
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
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-duplication',
        selectedCount: this.graph.selection?.size || 0
      });
    }
  }
}
