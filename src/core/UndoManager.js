// src/core/UndoManager.js - Complete working version with proper scoping

export class UndoManager {
  constructor(graph, editor) {
    this.graph = graph;
    this.editor = editor;
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndoSteps = 50;
    this.onChange = editor ? editor.onChange : null;
    
    console.log('UndoManager initialized with graph:', !!graph, 'editor:', !!editor);
  }

  // Record a connection deletion for undo
  recordConnectionDeletion(connectionData) {
    console.log('Recording connection deletion:', connectionData);
    
    // Handle your connection format (sourceNode, targetNode, targetInput)
    let sourceNodeId, targetNodeId, targetInput;
    
    if (connectionData.sourceNode && connectionData.targetNode) {
      sourceNodeId = typeof connectionData.sourceNode === 'object' 
        ? connectionData.sourceNode.id 
        : connectionData.sourceNode;
      targetNodeId = typeof connectionData.targetNode === 'object' 
        ? connectionData.targetNode.id 
        : connectionData.targetNode;
      targetInput = connectionData.targetInput || 0;
    } else {
      console.error('Invalid connection data format:', connectionData);
      return;
    }

    const action = {
      type: 'DELETE_CONNECTION',
      timestamp: Date.now(),
      sourceNodeId: sourceNodeId,
      targetNodeId: targetNodeId,
      targetInput: targetInput
    };

    this.pushAction(action);
    console.log('Connection deletion recorded:', action);
  }

  // Record generic actions for custom undo operations
  recordAction(action) {
    // Validate action object
    if (!action || typeof action !== 'object' || !action.type) {
      console.warn('Invalid action passed to recordAction:', action);
      return;
    }

    // Add timestamp if not present
    if (!action.timestamp) {
      action.timestamp = Date.now();
    }

    this.undoStack.push(action);
    this.redoStack = []; // Clear redo stack when new action is recorded
    
    // Limit stack size
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }

    console.log('Recorded action:', action.type, action);
    this.updateUI();
  }

  // Record node deletion with enhanced connection tracking
  recordNodeDeletion(node) {
    console.log('Recording node deletion:', node.kind, node.id);
    
    let incomingConnections = [];
    let outgoingConnections = [];
    
    // Check if node has enhanced connection snapshot
    if (node._connectionSnapshot) {
      console.log('Using enhanced connection snapshot for node', node.id);
      incomingConnections = node._connectionSnapshot.incoming;
      outgoingConnections = node._connectionSnapshot.outgoing;
    } else {
      // Fallback to old method
      console.log('Using fallback connection detection for node', node.id);
      
      // Find connections TO this node (incoming)
      this.graph.nodes.forEach(otherNode => {
        if (otherNode.inputs && Array.isArray(otherNode.inputs)) {
          otherNode.inputs.forEach((input, inputIndex) => {
            if (input === node.id || input == node.id) {
              incomingConnections.push({
                sourceNodeId: node.id,
                targetNodeId: otherNode.id,
                targetInput: inputIndex
              });
            }
          });
        }
      });

      // Find connections FROM this node (outgoing)
      if (node.inputs && Array.isArray(node.inputs)) {
        node.inputs.forEach((input, inputIndex) => {
          if (input !== null && input !== undefined) {
            outgoingConnections.push({
              sourceNodeId: input,
              targetNodeId: node.id,
              targetInput: inputIndex
            });
          }
        });
      }
    }

    // Create a complete snapshot of the node (without the connection snapshot)
    const nodeSnapshot = {
      id: node.id,
      kind: node.kind,
      type: node.type,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      inputs: node.inputs ? [...node.inputs] : [],
      parameters: node.parameters ? { ...node.parameters } : {},
      params: node.params ? { ...node.params } : {},
      nodeIndex: this.graph.nodes.indexOf(node)
    };

    // Copy any other custom properties (excluding the connection snapshot)
    Object.keys(node).forEach(key => {
      if (!['id', 'kind', 'type', 'x', 'y', 'w', 'h', 'inputs', 'parameters', 'params', 'nodeIndex', '_connectionSnapshot'].includes(key)) {
        if (typeof node[key] !== 'function') {
          nodeSnapshot[key] = node[key];
        }
      }
    });

    const action = {
      type: 'DELETE_NODE',
      timestamp: Date.now(),
      node: nodeSnapshot,
      incomingConnections: incomingConnections,
      outgoingConnections: outgoingConnections
    };

    this.pushAction(action);
    console.log('Node deletion recorded with', 
               incomingConnections.length, 'incoming and', 
               outgoingConnections.length, 'outgoing connections');
  }

  // Record node movement
  recordNodeMovement(nodeMovements) {
    // Don't record if no movements or movements array is empty
    if (!nodeMovements || nodeMovements.length === 0) {
      return;
    }

    // Check if any nodes actually moved
    const actualMovements = nodeMovements.filter(movement => {
      const deltaX = Math.abs(movement.newX - movement.oldX);
      const deltaY = Math.abs(movement.newY - movement.oldY);
      return deltaX > 0.01 || deltaY > 0.01; // Only record if moved more than 0.01 pixels
    });

    if (actualMovements.length === 0) {
      return; // No actual movement occurred
    }

    const action = {
      type: 'MOVE_NODES',
      timestamp: Date.now(),
      movements: actualMovements.map(movement => ({
        nodeId: movement.nodeId,
        oldX: movement.oldX,
        oldY: movement.oldY,
        newX: movement.newX,
        newY: movement.newY
      }))
    };

    this.undoStack.push(action);
    this.redoStack = []; // Clear redo stack when new action is recorded
    
    // Limit stack size
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }

    console.log('Recorded node movement:', action);
    this.updateUI();
  }

  // Record parameter changes
  recordParameterChange(nodeId, parameterName, oldValue, newValue) {
    // Don't record if values are the same
    if (oldValue === newValue) {
      return;
    }

    const action = {
      type: 'PARAMETER_CHANGE',
      timestamp: Date.now(),
      nodeId: nodeId,
      parameterName: parameterName,
      oldValue: oldValue,
      newValue: newValue
    };

    this.undoStack.push(action);
    this.redoStack = []; // Clear redo stack when new action is recorded
    
    // Limit stack size
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }

    console.log('Recorded parameter change:', action);
    this.updateUI();
  }

  // Record connection creation (for when user creates a connection)
  recordConnectionCreation(sourceNodeId, targetNodeId, targetInput) {
    const action = {
      type: 'CREATE_CONNECTION',
      timestamp: Date.now(),
      sourceNodeId: sourceNodeId,
      targetNodeId: targetNodeId,
      targetInput: targetInput
    };

    this.pushAction(action);
    console.log('Connection creation recorded:', action);
  }

  // Record node creation (for when user creates a node)
  recordNodeCreation(node) {
    const action = {
      type: 'CREATE_NODE',
      timestamp: Date.now(),
      nodeId: node.id
    };

    this.pushAction(action);
    console.log('Node creation recorded:', action);
  }

  // Push action to undo stack
  pushAction(action) {
    this.undoStack.push(action);
    this.redoStack = []; // Clear redo stack
    
    // Limit history size
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    
    this.updateUI();
  }

  // Perform undo
  undo() {
    if (this.undoStack.length === 0) {
      console.log('Nothing to undo');
      return false;
    }

    const action = this.undoStack.pop();
    console.log('Undoing action:', action.type);

    try {
      let success = false;
      
      switch (action.type) {
        case 'DELETE_CONNECTION':
          success = this.undoConnectionDeletion(action);
          break;
          
        case 'DELETE_NODE':
          success = this.undoNodeDeletion(action);
          break;
          
        case 'CREATE_CONNECTION':
          success = this.undoConnectionCreation(action);
          break;
          
        case 'CREATE_NODE':
          success = this.undoNodeCreation(action);
          break;
          
        case 'CREATE_BINDING': {
          // Undo parameter binding creation
          const targetNode = this.graph.nodes.find(n => n.id === action.targetNodeId);
          const sourceNode = this.graph.nodes.find(n => n.id === action.sourceNodeId);
          
          if (targetNode && sourceNode) {
            // Remove the binding by restoring the old value
            if (!targetNode.params) targetNode.params = {};
            targetNode.params[action.targetParameter] = action.oldValue;
            
            // Update parameter panel if this node is selected
            if (window.editor && window.editor.paramPanel && window.editor.selection.isSelected(targetNode)) {
              window.editor.paramPanel.updateParameterDisplay(targetNode, action.targetParameter, action.oldValue);
            }
            
            // Trigger preview update
            if (window.editor && window.editor.previewIntegration) {
              window.editor.previewIntegration.generateNodePreview(targetNode);
            }
            
            if (this.onChange) {
              this.onChange(`Undo parameter binding: ${action.targetParameter}`);
            }
          }
          success = true;
          break;
        }

        case 'REMOVE_BINDING': {
          // Undo parameter binding removal
          const targetNode = this.graph.nodes.find(n => n.id === action.targetNodeId);
          const sourceNode = this.graph.nodes.find(n => n.id === action.sourceNodeId);
          
          if (targetNode && sourceNode) {
            // Restore the binding reference
            if (!targetNode.params) targetNode.params = {};
            targetNode.params[action.targetParameter] = action.bindingReference;
            
            // Update parameter panel if this node is selected
            if (window.editor && window.editor.paramPanel && window.editor.selection.isSelected(targetNode)) {
              window.editor.paramPanel.updateParameterDisplay(targetNode, action.targetParameter, action.bindingReference);
            }
            
            // Trigger preview update
            if (window.editor && window.editor.previewIntegration) {
              window.editor.previewIntegration.generateNodePreview(targetNode);
            }
            
            if (this.onChange) {
              this.onChange(`Restore parameter binding: ${action.targetParameter}`);
            }
          }
          success = true;
          break;
        }
        
        case 'PARAMETER_CHANGE': {
          const node = this.graph.nodes.find(n => n.id === action.nodeId);
          if (node) {
            // Restore old value
            if (!node.params) node.params = {};
            node.params[action.parameterName] = action.oldValue;
            
            // Update parameter panel if this node is selected
            if (window.editor && window.editor.paramPanel && window.editor.selection.isSelected(node)) {
              window.editor.paramPanel.updateParameterDisplay(node, action.parameterName, action.oldValue);
            }
            
            // Trigger preview update
            if (window.editor && window.editor.previewIntegration) {
              window.editor.previewIntegration.generateNodePreview(node);
            }
            
            if (this.onChange) {
              this.onChange(`Undo parameter change: ${action.parameterName}`);
            }
          }
          success = true;
          break;
        }
        
        case 'MOVE_NODES': {
          action.movements.forEach(movement => {
            const node = this.graph.nodes.find(n => n.id === movement.nodeId);
            if (node) {
              node.x = movement.oldX;
              node.y = movement.oldY;
            }
          });
          
          if (this.onChange) {
            this.onChange(`Undo move ${action.movements.length} node(s)`);
          }
          success = true;
          break;
        }
        
        default:
          console.error('Unknown action type:', action.type);
          return false;
      }

      if (success) {
        this.redoStack.push(action);
        this.refreshEditor();
        console.log('Undo successful');
        return true;
      } else {
        // Put action back if failed
        this.undoStack.push(action);
        console.error('Undo failed');
        return false;
      }

    } catch (error) {
      console.error('Undo error:', error);
      this.undoStack.push(action);
      return false;
    }
  }

  // Perform redo
  redo() {
    if (this.redoStack.length === 0) {
      console.log('Nothing to redo');
      return false;
    }

    const action = this.redoStack.pop();
    console.log('Redoing action:', action.type);

    try {
      let success = false;
      
      switch (action.type) {
        case 'DELETE_CONNECTION':
          success = this.redoConnectionDeletion(action);
          break;
          
        case 'DELETE_NODE':
          success = this.redoNodeDeletion(action);
          break;
          
        case 'CREATE_CONNECTION':
          success = this.redoConnectionCreation(action);
          break;
          
        case 'CREATE_NODE':
          success = this.redoNodeCreation(action);
          break;
          
        case 'CREATE_BINDING': {
          // Redo parameter binding creation
          const targetNode = this.graph.nodes.find(n => n.id === action.targetNodeId);
          const sourceNode = this.graph.nodes.find(n => n.id === action.sourceNodeId);
          
          if (targetNode && sourceNode) {
            // Restore the binding reference
            if (!targetNode.params) targetNode.params = {};
            targetNode.params[action.targetParameter] = action.bindingReference;
            
            // Update parameter panel if this node is selected
            if (window.editor && window.editor.paramPanel && window.editor.selection.isSelected(targetNode)) {
              window.editor.paramPanel.updateParameterDisplay(targetNode, action.targetParameter, action.bindingReference);
            }
            
            // Trigger preview update
            if (window.editor && window.editor.previewIntegration) {
              window.editor.previewIntegration.generateNodePreview(targetNode);
            }
            
            if (this.onChange) {
              this.onChange(`Redo parameter binding: ${action.targetParameter}`);
            }
          }
          success = true;
          break;
        }

        case 'REMOVE_BINDING': {
          // Redo parameter binding removal
          const targetNode = this.graph.nodes.find(n => n.id === action.targetNodeId);
          const sourceNode = this.graph.nodes.find(n => n.id === action.sourceNodeId);
          
          if (targetNode && sourceNode) {
            // Remove the binding by restoring the old value
            if (!targetNode.params) targetNode.params = {};
            targetNode.params[action.targetParameter] = action.oldValue;
            
            // Update parameter panel if this node is selected
            if (window.editor && window.editor.paramPanel && window.editor.selection.isSelected(targetNode)) {
              window.editor.paramPanel.updateParameterDisplay(targetNode, action.targetParameter, action.oldValue);
            }
            
            // Trigger preview update
            if (window.editor && window.editor.previewIntegration) {
              window.editor.previewIntegration.generateNodePreview(targetNode);
            }
            
            if (this.onChange) {
              this.onChange(`Remove parameter binding: ${action.targetParameter}`);
            }
          }
          success = true;
          break;
        }
        
        case 'PARAMETER_CHANGE': {
          const node = this.graph.nodes.find(n => n.id === action.nodeId);
          if (node) {
            // Restore new value
            if (!node.params) node.params = {};
            node.params[action.parameterName] = action.newValue;
            
            // Update parameter panel if this node is selected
            if (window.editor && window.editor.paramPanel && window.editor.selection.isSelected(node)) {
              window.editor.paramPanel.updateParameterDisplay(node, action.parameterName, action.newValue);
            }
            
            // Trigger preview update
            if (window.editor && window.editor.previewIntegration) {
              window.editor.previewIntegration.generateNodePreview(node);
            }
            
            if (this.onChange) {
              this.onChange(`Redo parameter change: ${action.parameterName}`);
            }
          }
          success = true;
          break;
        }
        
        case 'MOVE_NODES': {
          action.movements.forEach(movement => {
            const node = this.graph.nodes.find(n => n.id === movement.nodeId);
            if (node) {
              node.x = movement.newX;
              node.y = movement.newY;
            }
          });
          
          if (this.onChange) {
            this.onChange(`Redo move ${action.movements.length} node(s)`);
          }
          success = true;
          break;
        }
        
        default:
          console.error('Unknown redo action type:', action.type);
          return false;
      }

      if (success) {
        this.undoStack.push(action);
        this.refreshEditor();
        console.log('Redo successful');
        return true;
      } else {
        this.redoStack.push(action);
        console.error('Redo failed');
        return false;
      }

    } catch (error) {
      console.error('Redo error:', error);
      this.redoStack.push(action);
      return false;
    }
  }

  // Undo connection deletion (restore connection)
  undoConnectionDeletion(action) {
    const sourceNode = this.graph.nodes.find(n => n.id == action.sourceNodeId);
    const targetNode = this.graph.nodes.find(n => n.id == action.targetNodeId);

    if (!sourceNode || !targetNode) {
      console.error('Cannot restore connection: nodes not found');
      return false;
    }

    console.log(`Restoring connection: ${sourceNode.kind}(${sourceNode.id}) -> ${targetNode.kind}(${targetNode.id})[${action.targetInput}]`);

    // Restore to node.inputs array
    if (!targetNode.inputs) targetNode.inputs = [];
    while (targetNode.inputs.length <= action.targetInput) {
      targetNode.inputs.push(null);
    }
    targetNode.inputs[action.targetInput] = action.sourceNodeId;

    // Restore to graph.connections array
    if (!this.graph.connections) this.graph.connections = [];
    
    // Remove any existing connection first
    this.graph.connections = this.graph.connections.filter(
      c => !(c.to && c.to.nodeId == targetNode.id && c.to.pin == action.targetInput)
    );
    
    // Add restored connection
    this.graph.connections.push({
      from: { nodeId: sourceNode.id, pin: 0 },
      to: { nodeId: targetNode.id, pin: action.targetInput }
    });

    console.log('Connection restored successfully');
    return true;
  }

  // Undo node deletion (restore node) - ENHANCED VERSION
  undoNodeDeletion(action) {
    console.log('Restoring node:', action.node.kind, action.node.id);
    console.log('With connections - Incoming:', action.incomingConnections?.length, 'Outgoing:', action.outgoingConnections?.length);

    // Check if node already exists
    if (this.graph.nodes.find(n => n.id === action.node.id)) {
      console.warn('Node already exists, cannot restore');
      return false;
    }

    try {
      // Recreate the node from stored data
      const restoredNode = {
        id: action.node.id,
        kind: action.node.kind,
        type: action.node.type,
        x: action.node.x,
        y: action.node.y,
        w: action.node.w || 120,
        h: action.node.h || 60,
        inputs: action.node.inputs ? [...action.node.inputs] : [],
        parameters: action.node.parameters ? { ...action.node.parameters } : {},
        params: action.node.params ? { ...action.node.params } : {},
      };

      // Copy any additional custom properties
      Object.keys(action.node).forEach(key => {
        if (!['id', 'kind', 'type', 'x', 'y', 'w', 'h', 'inputs', 'parameters', 'params', 'nodeIndex'].includes(key)) {
          restoredNode[key] = action.node[key];
        }
      });

      console.log('Recreated node object:', restoredNode);

      // Add node to graph at original position
      if (action.node.nodeIndex >= 0 && action.node.nodeIndex <= this.graph.nodes.length) {
        this.graph.nodes.splice(action.node.nodeIndex, 0, restoredNode);
      } else {
        this.graph.nodes.push(restoredNode);
      }

      // Restore ALL connections involving this node
      console.log('Restoring connections...');

      // 1. Restore incoming connections (connections TO this node)
      if (action.incomingConnections) {
        action.incomingConnections.forEach(conn => {
          const targetNode = this.graph.nodes.find(n => n.id == conn.targetNodeId);
          if (targetNode) {
            // Restore to node.inputs
            if (!targetNode.inputs) targetNode.inputs = [];
            while (targetNode.inputs.length <= conn.targetInput) {
              targetNode.inputs.push(null);
            }
            targetNode.inputs[conn.targetInput] = conn.sourceNodeId;
            
            // Also restore to graph.connections for visual rendering
            if (!this.graph.connections) this.graph.connections = [];
            
            // Remove any existing connection to this input
            this.graph.connections = this.graph.connections.filter(
              c => !(c.to && c.to.nodeId == conn.targetNodeId && c.to.pin == conn.targetInput)
            );
            
            // Add the connection
            this.graph.connections.push({
              from: { nodeId: conn.sourceNodeId, pin: 0 },
              to: { nodeId: conn.targetNodeId, pin: conn.targetInput }
            });
            
            console.log('Restored incoming connection:', conn);
          }
        });
      }

      // 2. Restore outgoing connections (connections FROM this node)
      if (action.outgoingConnections) {
        action.outgoingConnections.forEach(conn => {
          // Restore to this node's inputs
          if (!restoredNode.inputs) restoredNode.inputs = [];
          while (restoredNode.inputs.length <= conn.targetInput) {
            restoredNode.inputs.push(null);
          }
          restoredNode.inputs[conn.targetInput] = conn.sourceNodeId;
          
          // Also restore to graph.connections for visual rendering
          if (!this.graph.connections) this.graph.connections = [];
          
          // Remove any existing connection to this input
          this.graph.connections = this.graph.connections.filter(
            c => !(c.to && c.to.nodeId == conn.targetNodeId && c.to.pin == conn.targetInput)
          );
          
          // Add the connection
          this.graph.connections.push({
            from: { nodeId: conn.sourceNodeId, pin: 0 },
            to: { nodeId: conn.targetNodeId, pin: conn.targetInput }
          });
          
          console.log('Restored outgoing connection:', conn);
        });
      }

      console.log('Node and all connections restored successfully');
      return true;

    } catch (error) {
      console.error('Error restoring node:', error);
      return false;
    }
  }

  // Undo connection creation (delete connection)
  undoConnectionCreation(action) {
    const targetNode = this.graph.nodes.find(n => n.id == action.targetNodeId);
    
    if (!targetNode || !targetNode.inputs || targetNode.inputs.length <= action.targetInput) {
      console.error('Cannot undo connection creation: target not found');
      return false;
    }

    console.log(`Undoing connection creation: ${action.sourceNodeId} -> ${action.targetNodeId}[${action.targetInput}]`);

    // Remove from node.inputs array
    targetNode.inputs[action.targetInput] = null;

    // Remove from graph.connections array  
    if (this.graph.connections) {
      this.graph.connections = this.graph.connections.filter(
        c => !(c.to && c.to.nodeId == action.targetNodeId && c.to.pin == action.targetInput)
      );
    }

    console.log('Connection creation undone');
    return true;
  }

  // Undo node creation (delete node)
  undoNodeCreation(action) {
    const nodeIndex = this.graph.nodes.findIndex(n => n.id === action.nodeId);
    
    if (nodeIndex === -1) {
      console.error('Cannot undo node creation: node not found');
      return false;
    }

    // Remove all connections to this node first
    this.graph.nodes.forEach(node => {
      if (node.inputs) {
        node.inputs.forEach((input, index) => {
          if (input === action.nodeId) {
            node.inputs[index] = null;
          }
        });
      }
    });

    // Remove the node
    this.graph.nodes.splice(nodeIndex, 1);
    console.log('Node creation undone');
    return true;
  }

  // Redo connection deletion (delete connection again)
  redoConnectionDeletion(action) {
    const targetNode = this.graph.nodes.find(n => n.id == action.targetNodeId);
    
    if (!targetNode || !targetNode.inputs || targetNode.inputs.length <= action.targetInput) {
      console.error('Cannot redo connection deletion');
      return false;
    }

    targetNode.inputs[action.targetInput] = null;
    
    // Also remove from graph.connections
    if (this.graph.connections) {
      this.graph.connections = this.graph.connections.filter(
        c => !(c.to && c.to.nodeId == action.targetNodeId && c.to.pin == action.targetInput)
      );
    }
    
    console.log('Connection re-deleted');
    return true;
  }

  // Redo node deletion (delete node again)
  redoNodeDeletion(action) {
    const nodeIndex = this.graph.nodes.findIndex(n => n.id === action.node.id);
    
    if (nodeIndex === -1) {
      console.error('Cannot redo node deletion: node not found');
      return false;
    }

    // Remove connections first
    action.incomingConnections?.forEach(conn => {
      const targetNode = this.graph.nodes.find(n => n.id == conn.targetNodeId);
      if (targetNode && targetNode.inputs) {
        targetNode.inputs[conn.targetInput] = null;
      }
    });

    // Remove from graph.connections
    if (this.graph.connections) {
      this.graph.connections = this.graph.connections.filter(
        c => !(c.from.nodeId == action.node.id || c.to.nodeId == action.node.id)
      );
    }

    // Remove the node
    this.graph.nodes.splice(nodeIndex, 1);
    console.log('Node re-deleted');
    return true;
  }

  // Redo connection creation (create connection again)
  redoConnectionCreation(action) {
    const sourceNode = this.graph.nodes.find(n => n.id == action.sourceNodeId);
    const targetNode = this.graph.nodes.find(n => n.id == action.targetNodeId);
    
    if (!sourceNode || !targetNode) {
      console.error('Cannot redo connection creation: nodes not found');
      return false;
    }

    // Restore to node.inputs
    if (!targetNode.inputs) targetNode.inputs = [];
    while (targetNode.inputs.length <= action.targetInput) {
      targetNode.inputs.push(null);
    }
    targetNode.inputs[action.targetInput] = action.sourceNodeId;

    // Restore to graph.connections
    if (!this.graph.connections) this.graph.connections = [];
    this.graph.connections.push({
      from: { nodeId: action.sourceNodeId, pin: 0 },
      to: { nodeId: action.targetNodeId, pin: action.targetInput }
    });

    console.log('Connection re-created');
    return true;
  }

  // Redo node creation (create node again)
  redoNodeCreation(action) {
    console.warn('Node creation redo not implemented');
    return false;
  }

  // Force editor refresh
  refreshEditor() {
    // Clear any caches
    if (this.graph.nodes) {
      this.graph.nodes.forEach(node => {
        delete node.cachedValue;
        delete node.cached;
        node.needsUpdate = true;
      });
    }

    // Trigger editor redraw
    if (this.editor && this.editor.draw) {
      this.editor.draw();
    }

    // Update shader
    if (window.updateShaderFromGraph) {
      window.updateShaderFromGraph();
    }

    // Force another draw after a short delay
    setTimeout(() => {
      if (this.editor && this.editor.draw) {
        this.editor.draw();
      }
    }, 10);
  }

  // Update UI button states
  updateUI() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');

    if (undoBtn) {
      undoBtn.disabled = this.undoStack.length === 0;
      const lastUndo = this.undoStack[this.undoStack.length - 1];
      if (lastUndo) {
        let actionDesc = lastUndo.type;
        if (lastUndo.type === 'PARAMETER_CHANGE') {
          actionDesc += ` (${lastUndo.parameterName})`;
        }
        undoBtn.title = `Undo ${actionDesc}`;
      } else {
        undoBtn.title = 'Nothing to undo';
      }
    }

    if (redoBtn) {
      redoBtn.disabled = this.redoStack.length === 0;
      const lastRedo = this.redoStack[this.redoStack.length - 1];
      if (lastRedo) {
        let actionDesc = lastRedo.type;
        if (lastRedo.type === 'PARAMETER_CHANGE') {
          actionDesc += ` (${lastRedo.parameterName})`;
        }
        redoBtn.title = `Redo ${actionDesc}`;
      } else {
        redoBtn.title = 'Nothing to redo';
      }
    }
  }

  // Clear history
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.updateUI();
    console.log('Undo history cleared');
  }

  // Get status for debugging
  getStatus() {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      lastUndo: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null,
      lastRedo: this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null
    };
  }
}