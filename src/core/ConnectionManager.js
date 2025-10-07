// src/core/ConnectionManager.js - Fixed preview updates
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
    try {
      if (!fromNodeId || fromPin === undefined || !startPos) {
        throw new Error('Invalid wire drag parameters');
      }

      this.dragWire = {
        from: { nodeId: fromNodeId, pin: fromPin },
        pos: startPos,
      };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'wire-drag-start',
        fromNodeId,
        fromPin
      });
    }
  }

  updateWireDrag(pos) {
    try {
      if (this.dragWire && pos) {
        this.dragWire.pos = pos;
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'wire-drag-update' 
      });
    }
  }

  // FIXED: endWireDrag with proper preview regeneration
  endWireDrag(targetPos, hitInputPin) {
    try {
      if (!this.dragWire) return false;

      if (hitInputPin) {
        // Validate connection parameters
        if (!hitInputPin.nodeId || hitInputPin.pin === undefined) {
          throw new Error('Invalid target pin for connection');
        }

        // Check if source node exists
        const sourceNode = this.graph.nodes.find(n => n.id === this.dragWire.from.nodeId);
        if (!sourceNode) {
          throw new Error('Source node not found for connection');
        }

        // Check if target node exists
        const targetNode = this.graph.nodes.find(n => n.id === hitInputPin.nodeId);
        if (!targetNode) {
          throw new Error('Target node not found for connection');
        }

        // Remove any existing connection to this input
        this.graph.connections = this.graph.connections.filter(
          (c) =>
            !(c.to.nodeId === hitInputPin.nodeId && c.to.pin === hitInputPin.pin),
        );

        // Add new connection
        const newConnection = {
          from: this.dragWire.from,
          to: hitInputPin,
        };
        this.graph.connections.push(newConnection);

        // Update node inputs array
        if (targetNode) {
          if (!targetNode.inputs) {
            targetNode.inputs = [];
          }
          targetNode.inputs[hitInputPin.pin] = this.dragWire.from.nodeId;
        }

        // Record for undo AFTER successful creation
        if (window.onConnectionCreated && typeof window.onConnectionCreated === 'function') {
          console.log("ConnectionManager: Recording connection creation for undo");
          window.onConnectionCreated(
            this.dragWire.from.nodeId,
            hitInputPin.nodeId,
            hitInputPin.pin,
            this.dragWire.from.pin,
          );
        }

        if (this.onChange) this.onChange();

        // FIXED: Regenerate preview for the target node specifically
if (window.editor?.previewIntegration) {
  const sourceNode = window.editor.graph.nodes.find(n => n.id === this.dragWire.from.nodeId);
  if (sourceNode) {
    console.log('🔄 Connection created: regenerating preview for source node', sourceNode.id);
    window.editor.previewIntegration.generateNodePreview(sourceNode);
  }
  
  console.log('🔄 Connection created: regenerating preview for target node', targetNode.id);
  window.editor.previewIntegration.generateNodePreview(targetNode);
}
        if (window.editor?.previewIntegration) {
          try {
            console.log(`🔄 Connection created: regenerating preview for node ${targetNode.id}`);
            
            // Clear the canvas cache for this node to force regeneration
            if (window.editor.previewSystem?.canvasManager?.canvasCache) {
              window.editor.previewSystem.canvasManager.canvasCache.delete(targetNode.id);
            }
            
            // Regenerate the specific node's preview
            window.editor.previewIntegration.generateNodePreview(targetNode);
            
            // Force a redraw of the editor
            if (window.editor.draw) {
              window.editor.draw();
            }
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, { 
              component: 'preview-update-after-connection' 
            });
          }
        }

        this.dragWire = null;
        return true;
      }

      this.dragWire = null;
      return false;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connection-creation',
        fromNodeId: this.dragWire?.from?.nodeId,
        toNodeId: hitInputPin?.nodeId,
        targetPin: hitInputPin?.pin
      });
      
      // Clean up drag state even if error occurs
      this.dragWire = null;
      return false;
    }
  }

  // FIXED: removeConnection with proper preview regeneration
  removeConnection(nodeId, inputPin) {
    try {
      if (!nodeId || inputPin === undefined) {
        throw new Error('Invalid parameters for connection removal');
      }

      const targetNode = this.graph.nodes.find(n => n.id === nodeId);
      if (!targetNode) {
        throw new Error(`Target node ${nodeId} not found for connection removal`);
      }
      
      // Record connection for undo BEFORE deletion
      if (targetNode.inputs && targetNode.inputs[inputPin]) {
        const sourceNodeId = targetNode.inputs[inputPin];
        const sourceNode = this.graph.nodes.find(n => n.id == sourceNodeId);
        const existingConnection = this.graph.connections.find(
          (c) => c.to.nodeId === nodeId && c.to.pin === inputPin,
        );
        const sourceOutput =
          existingConnection && typeof existingConnection.from?.pin === 'number'
            ? existingConnection.from.pin
            : 0;

        if (
          sourceNode &&
          window.onConnectionDeleted &&
          typeof window.onConnectionDeleted === "function"
        ) {
          const connectionData = {
            sourceNode: sourceNode,
            targetNode: targetNode,
            targetInput: inputPin,
            sourceOutput,
          };
          console.log("ConnectionManager: Recording connection deletion for undo");
          window.onConnectionDeleted(connectionData);
        }
      }

      // Perform the actual removal
      const initialLength = this.graph.connections.length;
      this.graph.connections = this.graph.connections.filter(
        (c) => !(c.to.nodeId === nodeId && c.to.pin === inputPin),
      );

      // Also remove from node inputs array
      if (targetNode.inputs) {
        targetNode.inputs[inputPin] = null;
      }

      if (this.graph.connections.length !== initialLength) {
        if (this.onChange) this.onChange();

        // FIXED: Regenerate preview for the disconnected node
        if (window.editor?.previewIntegration) {
          try {
            console.log(`🔄 Connection removed: regenerating preview for node ${targetNode.id}`);
            
            // Clear the canvas cache for this node to force regeneration
            if (window.editor.previewSystem?.canvasManager?.canvasCache) {
              window.editor.previewSystem.canvasManager.canvasCache.delete(targetNode.id);
            }
            
            // Regenerate the specific node's preview
            window.editor.previewIntegration.generateNodePreview(targetNode);
            
            // Force a redraw of the editor
            if (window.editor.draw) {
              window.editor.draw();
            }
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, { 
              component: 'preview-update-after-disconnection' 
            });
          }
        }

        return true;
      }
      return false;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connection-removal',
        nodeId,
        inputPin
      });
      return false;
    }
  }

  // Hit testing for pins
  hitOutputPin(x, y, nodes) {
    try {
      if (!Array.isArray(nodes) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

      for (const n of nodes) {
        if (!n || !n.id) continue;

        const { outs } = this._pinPositions(n);
        for (let i = 0; i < outs.length; i++) {
          const p = outs[i];
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

          if ((x - p.x) ** 2 + (y - p.y) ** 2 < 6 * 6) {
            return { nodeId: n.id, pin: i };
          }
        }
      }
      return null;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'output-pin-hit-test',
        position: { x, y }
      });
      return null;
    }
  }

  hitInputPin(x, y, nodes) {
    try {
      if (!Array.isArray(nodes) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

      for (const n of nodes) {
        if (!n || !n.id) continue;

        const { ins } = this._pinPositions(n);
        for (let i = 0; i < ins.length; i++) {
          const p = ins[i];
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

          if ((x - p.x) ** 2 + (y - p.y) ** 2 < 6 * 6) {
            return { nodeId: n.id, pin: i };
          }
        }
      }
      return null;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'input-pin-hit-test',
        position: { x, y }
      });
      return null;
    }
  }

  _pinPositions(n) {
    try {
      if (!n || !n.kind) {
        return { ins: [], outs: [] };
      }

      const nodeDef = NodeDefs[n.kind];
      if (!nodeDef) {
        window.errorHandler?.handleError(new Error(`Node definition not found for kind: ${n.kind}`), { 
          component: 'pin-position-calculation',
          nodeKind: n.kind
        });
        return { ins: [], outs: [] };
      }

      const ins = [];
      const inputCount = nodeDef.inputs || 0;
      for (let i = 0; i < inputCount; i++) {
        ins.push({ 
          x: (n.x || 0) + 8, 
          y: (n.y || 0) + 32 + i * 18 
        });
      }

      const outs = [];
      const outCount = (nodeDef.pinsOut || []).length || 1;
      for (let i = 0; i < outCount; i++) {
        outs.push({ 
          x: (n.x || 0) + (n.w || 100) - 8, 
          y: (n.y || 0) + 32 + i * 18 
        });
      }

      return { ins, outs };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'pin-position-calculation',
        nodeId: n?.id,
        nodeKind: n?.kind
      });
      return { ins: [], outs: [] };
    }
  }

  // Utility method to validate connection compatibility
  isConnectionValid(fromNodeId, fromPin, toNodeId, toPin) {
    try {
      const fromNode = this.graph.nodes.find(n => n.id === fromNodeId);
      const toNode = this.graph.nodes.find(n => n.id === toNodeId);

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

      // Add type compatibility checks here if needed
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connection-validation',
        fromNodeId,
        toNodeId
      });
      return false;
    }
  }
}
