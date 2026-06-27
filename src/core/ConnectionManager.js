// src/core/ConnectionManager.js - Fixed preview updates
import { NodeDefs } from "../data/NodeDefs.js";
import { nodePinPositions, nodePreviewHeight } from "./pinLayout.js";

export class ConnectionManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.dragWire = null;
  }

  getDragWire() {
    return this.dragWire;
  }

  startWireDrag(fromNodeId, fromPin, startPos, isFromInput = false) {
    try {
      if (!fromNodeId || fromPin === undefined || !startPos) {
        throw new Error('Invalid wire drag parameters');
      }

      this.dragWire = {
        from: { nodeId: fromNodeId, pin: fromPin },
        pos: startPos,
        isFromInput: isFromInput, // Track whether drag started from input or output
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

  // FIXED: endWireDrag with proper preview regeneration and bidirectional support
  endWireDrag(targetPos, hitPin) {
    // Warm up GPU/canvas before connection creation to prevent lag
    if (window.eventHandler && typeof window.eventHandler._checkAndWarmupAfterInactivity === 'function') {
      window.eventHandler._checkAndWarmupAfterInactivity();
    }
    
    try {
      if (!this.dragWire) return false;

      if (hitPin) {
        // Validate connection parameters
        if (!hitPin.nodeId || hitPin.pin === undefined) {
          throw new Error('Invalid target pin for connection');
        }

        // Determine the actual output and input based on drag direction
        let outputNode, outputPin, inputNode, inputPin;

        if (this.dragWire.isFromInput) {
          // Dragging from input to output: reverse the connection
          // hitPin is the output, dragWire.from is the input
          outputNode = this.graph.nodes.find(n => n.id === hitPin.nodeId);
          outputPin = hitPin.pin;
          inputNode = this.graph.nodes.find(n => n.id === this.dragWire.from.nodeId);
          inputPin = this.dragWire.from.pin;
        } else {
          // Normal: dragging from output to input
          // dragWire.from is the output, hitPin is the input
          outputNode = this.graph.nodes.find(n => n.id === this.dragWire.from.nodeId);
          outputPin = this.dragWire.from.pin;
          inputNode = this.graph.nodes.find(n => n.id === hitPin.nodeId);
          inputPin = hitPin.pin;
        }

        // Validate nodes exist
        if (!outputNode) {
          throw new Error('Output node not found for connection');
        }
        if (!inputNode) {
          throw new Error('Input node not found for connection');
        }

        // Remove any existing connection to this input
        const existingConnection = this.graph.connections.find(
          (c) =>
            c.to.nodeId === inputNode.id && c.to.pin === inputPin,
        );

        if (existingConnection) {
          const existingSource = this.graph.nodes.find(
            (n) => n.id == existingConnection.from.nodeId,
          );

          if (
            existingSource &&
            window.onConnectionDeleted &&
            typeof window.onConnectionDeleted === "function"
          ) {
            const connectionData = {
              sourceNode: existingSource,
              targetNode: inputNode,
              targetInput: inputPin,
              sourceOutput:
                typeof existingConnection.from.pin === "number"
                  ? existingConnection.from.pin
                  : 0,
            };

            window.onConnectionDeleted(connectionData);
          }

          if (inputNode.inputs) {
            inputNode.inputs[inputPin] = null;
          }
        }

        this.graph.connections = this.graph.connections.filter(
          (c) =>
            !(c.to.nodeId === inputNode.id && c.to.pin === inputPin),
        );

        // Add new connection (always stored as from: output, to: input)
        const newConnection = {
          from: { nodeId: outputNode.id, pin: outputPin },
          to: { nodeId: inputNode.id, pin: inputPin },
        };
        this.graph.connections.push(newConnection);

        // Update node inputs array
        if (inputNode) {
          if (!inputNode.inputs) {
            inputNode.inputs = [];
          }
          inputNode.inputs[inputPin] = outputNode.id;
        }

        // Record for undo AFTER successful creation
        if (window.onConnectionCreated && typeof window.onConnectionCreated === 'function') {

          window.onConnectionCreated(
            outputNode.id,
            inputNode.id,
            inputPin,
            outputPin,
          );
        }

        // Invalidate connection region for precise redraw
        if (window.editor?.invalidateConnection) {
          window.editor.invalidateConnection(newConnection, outputNode, inputNode, 'connection-created');
        }

        if (this.onChange) this.onChange();

        // Regenerate preview for the target node (the one receiving input)
        // The target node needs to redraw with its new input connection
        if (window.editor?.previewIntegration) {
          try {

            // Regenerate the target node's preview
            // Don't delete canvas cache - preserve existing canvas
            window.editor.previewIntegration.generateNodePreview(inputNode);

            // Force a redraw of the editor
            if (window.editor.draw) {
              if (window.editor.markDirty) window.editor.markDirty('connection-added');
              window.editor.draw();
            }
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, {
              component: 'preview-update-after-connection',
              targetNodeId: inputNode.id,
              sourceNodeId: outputNode.id
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
        toNodeId: hitPin?.nodeId,
        targetPin: hitPin?.pin
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

          window.onConnectionDeleted(connectionData);
        }
      }

      // Perform the actual removal
      const initialLength = this.graph.connections.length;
      const removedConnection = this.graph.connections.find(
        (c) => c.to.nodeId === nodeId && c.to.pin === inputPin
      );

      this.graph.connections = this.graph.connections.filter(
        (c) => !(c.to.nodeId === nodeId && c.to.pin === inputPin),
      );

      // Also remove from node inputs array
      if (targetNode.inputs) {
        targetNode.inputs[inputPin] = null;
      }

      // Invalidate connection region for precise redraw
      if (removedConnection && window.editor?.invalidateConnection) {
        const sourceNode = this.graph.nodes.find(
          (n) => n.id === removedConnection.from?.nodeId
        );
        if (sourceNode && targetNode) {
          window.editor.invalidateConnection(removedConnection, sourceNode, targetNode, 'connection-removed');
        }
      }

      if (this.graph.connections.length !== initialLength) {
        if (this.onChange) this.onChange();

        // FIXED: Regenerate preview for the disconnected node
        if (window.editor?.previewIntegration) {
          try {

            // Clear the canvas cache for this node to force regeneration
            if (window.editor.previewSystem?.canvasManager?.canvasCache) {
              window.editor.previewSystem.canvasManager.canvasCache.delete(targetNode.id);
            }
            
            // Regenerate the specific node's preview
            window.editor.previewIntegration.generateNodePreview(targetNode);
            
            // Force a redraw of the editor
            if (window.editor.draw) {
              if (window.editor.markDirty) window.editor.markDirty('connection-added');
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

      // Geometry comes from the shared socket-row layout so hit-testing always matches the
      // renderer: header → optional preview band → fixed-height rows (see pinLayout.js).
      const inputCount = nodeDef.inputs || 0;
      const outCount = (nodeDef.pinsOut || []).length || 1;
      const previewH = nodePreviewHeight(n);
      const { inputs, outputs } = nodePinPositions(n, inputCount, outCount, previewH);

      return { ins: inputs, outs: outputs };
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
