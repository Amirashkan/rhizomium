// src/utils/ParameterBindingSystem.js
export class ParameterBindingSystem {
  constructor(graph, eventSystem, undoManager) {
    this.graph = graph;
    this.eventSystem = eventSystem;
    this.undoManager = undoManager;
    
    // Map of parameter bindings: sourceId -> Set of bound parameters
    this.bindings = new Map();
    
    // Reverse map for quick lookup: boundId -> source parameter
    this.boundToSource = new Map();
    
    // Parameter clipboard for copy/paste operations
    this.clipboard = null;
    
    // Binding visualization state
    this.showBindings = false;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for parameter changes to update bound parameters
    this.eventSystem.on('PARAMETER_CHANGED', (data) => {
      this.updateBoundParameters(data.node, data.parameterName, data.newValue);
    });

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c' && e.shiftKey) {
          e.preventDefault();
          this.copyParameterAsReference();
        } else if (e.key === 'v' && e.shiftKey) {
          e.preventDefault();
          this.pasteParameterReference();
        }
      }
    });
  }

  // Copy parameter reference to clipboard
  copyParameterAsReference() {
    const selectedNode = this.getSelectedNode();
    const selectedParam = this.getSelectedParameter();
    
    if (!selectedNode || !selectedParam) {
      console.warn('No parameter selected for copying');
      return false;
    }

    this.clipboard = {
      nodeId: selectedNode.id,
      parameterName: selectedParam.name,
      nodeKind: selectedNode.kind,
      timestamp: Date.now()
    };

    // Visual feedback
    this.showCopyFeedback(selectedNode, selectedParam);
    
    console.log(`Copied parameter reference: ${selectedNode.id}.${selectedParam.name}`);
    return true;
  }

  // Paste parameter reference to create binding
  pasteParameterReference() {
    if (!this.clipboard) {
      console.warn('No parameter reference in clipboard');
      return false;
    }

    const targetNode = this.getSelectedNode();
    const targetParam = this.getSelectedParameter();
    
    if (!targetNode || !targetParam) {
      console.warn('No target parameter selected for pasting');
      return false;
    }

    // Don't bind to self
    if (targetNode.id === this.clipboard.nodeId && 
        targetParam.name === this.clipboard.parameterName) {
      console.warn('Cannot bind parameter to itself');
      return false;
    }

    return this.createBinding(
      this.clipboard.nodeId,
      this.clipboard.parameterName,
      targetNode.id,
      targetParam.name
    );
  }

  // Create a binding between source and target parameters
  createBinding(sourceNodeId, sourceParamName, targetNodeId, targetParamName) {
    const sourceNode = this.graph.nodes.find(n => n.id === sourceNodeId);
    const targetNode = this.graph.nodes.find(n => n.id === targetNodeId);

    if (!sourceNode || !targetNode) {
      console.error('Source or target node not found');
      return false;
    }

    // Check for circular dependencies
    if (this.wouldCreateCircularDependency(sourceNodeId, sourceParamName, targetNodeId, targetParamName)) {
      console.error('Cannot create binding: would create circular dependency');
      return false;
    }

    const sourceKey = `${sourceNodeId}.${sourceParamName}`;
    const targetKey = `${targetNodeId}.${targetParamName}`;

    // Remove existing binding if target is already bound
    this.removeBindingForTarget(targetNodeId, targetParamName);

    // Add to bindings map
    if (!this.bindings.has(sourceKey)) {
      this.bindings.set(sourceKey, new Set());
    }
    
    this.bindings.get(sourceKey).add({
      nodeId: targetNodeId,
      parameterName: targetParamName
    });

    // Add to reverse map
    this.boundToSource.set(targetKey, {
      nodeId: sourceNodeId,
      parameterName: sourceParamName
    });

    // Set initial value
    const sourceValue = this.getParameterValue(sourceNode, sourceParamName);
    this.setParameterValue(targetNode, targetParamName, sourceValue);

    // Record for undo
    if (this.undoManager) {
      this.undoManager.recordAction({
        type: 'CREATE_BINDING',
        sourceNodeId,
        sourceParamName,
        targetNodeId,
        targetParamName,
        undo: () => this.removeBinding(sourceNodeId, sourceParamName, targetNodeId, targetParamName),
        redo: () => this.createBinding(sourceNodeId, sourceParamName, targetNodeId, targetParamName)
      });
    }

    // Visual feedback
    this.showBindingCreatedFeedback(sourceNode, sourceParamName, targetNode, targetParamName);

    // Emit event
    this.eventSystem.emit('BINDING_CREATED', {
      sourceNodeId,
      sourceParamName,
      targetNodeId,
      targetParamName
    });

    console.log(`Created binding: ${sourceKey} → ${targetKey}`);
    return true;
  }

  // Remove a specific binding
  removeBinding(sourceNodeId, sourceParamName, targetNodeId, targetParamName) {
    const sourceKey = `${sourceNodeId}.${sourceParamName}`;
    const targetKey = `${targetNodeId}.${targetParamName}`;

    // Remove from bindings map
    if (this.bindings.has(sourceKey)) {
      const boundParams = this.bindings.get(sourceKey);
      boundParams.forEach(bound => {
        if (bound.nodeId === targetNodeId && bound.parameterName === targetParamName) {
          boundParams.delete(bound);
        }
      });
      
      if (boundParams.size === 0) {
        this.bindings.delete(sourceKey);
      }
    }

    // Remove from reverse map
    this.boundToSource.delete(targetKey);

    // Emit event
    this.eventSystem.emit('BINDING_REMOVED', {
      sourceNodeId,
      sourceParamName,
      targetNodeId,
      targetParamName
    });

    console.log(`Removed binding: ${sourceKey} → ${targetKey}`);
    return true;
  }

  // Remove all bindings for a target parameter
  removeBindingForTarget(targetNodeId, targetParamName) {
    const targetKey = `${targetNodeId}.${targetParamName}`;
    const source = this.boundToSource.get(targetKey);
    
    if (source) {
      this.removeBinding(source.nodeId, source.parameterName, targetNodeId, targetParamName);
    }
  }

  // Remove all bindings for a source parameter
  removeBindingsForSource(sourceNodeId, sourceParamName) {
    const sourceKey = `${sourceNodeId}.${sourceParamName}`;
    const boundParams = this.bindings.get(sourceKey);
    
    if (boundParams) {
      const toRemove = Array.from(boundParams);
      toRemove.forEach(bound => {
        this.removeBinding(sourceNodeId, sourceParamName, bound.nodeId, bound.parameterName);
      });
    }
  }

  // Update all parameters bound to a source parameter
  updateBoundParameters(sourceNode, sourceParamName, newValue) {
    const sourceKey = `${sourceNode.id}.${sourceParamName}`;
    const boundParams = this.bindings.get(sourceKey);
    
    if (!boundParams) return;

    boundParams.forEach(bound => {
      const targetNode = this.graph.nodes.find(n => n.id === bound.nodeId);
      if (targetNode) {
        // Don't trigger cascading updates by using direct assignment
        this.setParameterValueDirect(targetNode, bound.parameterName, newValue);
        
        // Update preview for target node
        this.updateNodePreview(targetNode);
      }
    });
  }

  // Check if creating a binding would create circular dependency
  wouldCreateCircularDependency(sourceNodeId, sourceParamName, targetNodeId, targetParamName) {
    const visited = new Set();
    
    const checkPath = (nodeId, paramName) => {
      const key = `${nodeId}.${paramName}`;
      
      if (visited.has(key)) return true; // Circular dependency found
      if (nodeId === sourceNodeId && paramName === sourceParamName) return true;
      
      visited.add(key);
      
      const boundParams = this.bindings.get(key);
      if (boundParams) {
        for (const bound of boundParams) {
          if (checkPath(bound.nodeId, bound.parameterName)) {
            return true;
          }
        }
      }
      
      visited.delete(key);
      return false;
    };
    
    return checkPath(targetNodeId, targetParamName);
  }

  // Get binding information for a parameter
  getBindingInfo(nodeId, parameterName) {
    const targetKey = `${nodeId}.${parameterName}`;
    const sourceKey = `${nodeId}.${parameterName}`;
    
    const source = this.boundToSource.get(targetKey);
    const targets = this.bindings.get(sourceKey);
    
    return {
      isBound: !!source,
      hasTargets: !!(targets && targets.size > 0),
      source,
      targets: targets ? Array.from(targets) : []
    };
  }

  // Check if a parameter is bound to another
  isParameterBound(nodeId, parameterName) {
    const targetKey = `${nodeId}.${parameterName}`;
    return this.boundToSource.has(targetKey);
  }

  // Get all bindings in the system
  getAllBindings() {
    const result = [];
    
    this.bindings.forEach((targets, sourceKey) => {
      const [sourceNodeId, sourceParamName] = sourceKey.split('.');
      targets.forEach(target => {
        result.push({
          source: { nodeId: sourceNodeId, parameterName: sourceParamName },
          target: { nodeId: target.nodeId, parameterName: target.parameterName }
        });
      });
    });
    
    return result;
  }

  // Utility methods for getting/setting parameter values
  getParameterValue(node, paramName) {
    if (window.editor?.paramPanel?.valueManager) {
      return window.editor.paramPanel.valueManager.getValue(node, paramName);
    }
    return node.params?.[paramName];
  }

  setParameterValue(node, paramName, value) {
    if (window.editor?.paramPanel?.valueManager) {
      window.editor.paramPanel.valueManager.setValue(node, paramName, value);
    } else {
      if (!node.params) node.params = {};
      node.params[paramName] = value;
    }
  }

  setParameterValueDirect(node, paramName, value) {
    // Direct assignment without triggering events
    if (!node.params) node.params = {};
    node.params[paramName] = value;
  }

  updateNodePreview(node) {
    if (window.editor?.paramPanel?.updateNodePreview) {
      window.editor.paramPanel.updateNodePreview(node);
    }
  }

  // UI helper methods (to be implemented based on your UI system)
  getSelectedNode() {
    return window.editor?.selectionManager?.getSelectedNode();
  }

  getSelectedParameter() {
    // This would need to be implemented based on your parameter panel UI
    const paramPanel = window.editor?.paramPanel;
    if (paramPanel?.isVisible() && paramPanel?.selectedNode) {
      // You'd need to track which parameter is currently focused/selected
      const focusedInput = document.querySelector('.param-input:focus');
      if (focusedInput) {
        const paramName = focusedInput.getAttribute('data-param');
        return { name: paramName };
      }
    }
    return null;
  }

  showCopyFeedback(node, param) {
    // Visual feedback when copying - implement based on your UI
    console.log(`Copied ${node.kind}.${param.name} as reference`);
  }

  showBindingCreatedFeedback(sourceNode, sourceParam, targetNode, targetParam) {
    // Visual feedback when binding created - implement based on your UI
    console.log(`Bound ${targetNode.kind}.${targetParam} to ${sourceNode.kind}.${sourceParam}`);
  }

  // Cleanup when node is deleted
  cleanupNodeBindings(nodeId) {
    // Remove all bindings where this node is source
    const toRemoveAsSource = [];
    this.bindings.forEach((targets, sourceKey) => {
      if (sourceKey.startsWith(`${nodeId}.`)) {
        toRemoveAsSource.push(sourceKey);
      }
    });
    
    toRemoveAsSource.forEach(sourceKey => {
      this.bindings.delete(sourceKey);
    });

    // Remove all bindings where this node is target
    const toRemoveAsTarget = [];
    this.boundToSource.forEach((source, targetKey) => {
      if (targetKey.startsWith(`${nodeId}.`)) {
        toRemoveAsTarget.push(targetKey);
      }
    });
    
    toRemoveAsTarget.forEach(targetKey => {
      const source = this.boundToSource.get(targetKey);
      if (source) {
        this.removeBinding(source.nodeId, source.parameterName, nodeId, targetKey.split('.')[1]);
      }
    });
  }

  // Serialize bindings for save/load
  serialize() {
    return {
      bindings: Array.from(this.bindings.entries()).map(([sourceKey, targets]) => ({
        source: sourceKey,
        targets: Array.from(targets)
      }))
    };
  }

  // Load bindings from serialized data
  deserialize(data) {
    this.bindings.clear();
    this.boundToSource.clear();
    
    if (data.bindings) {
      data.bindings.forEach(binding => {
        const sourceKey = binding.source;
        const targets = new Set(binding.targets);
        
        this.bindings.set(sourceKey, targets);
        
        // Rebuild reverse map
        targets.forEach(target => {
          const targetKey = `${target.nodeId}.${target.parameterName}`;
          const [sourceNodeId, sourceParamName] = sourceKey.split('.');
          this.boundToSource.set(targetKey, {
            nodeId: sourceNodeId,
            parameterName: sourceParamName
          });
        });
      });
    }
  }

  // Debug methods
  debugPrintBindings() {
    console.log('=== Parameter Bindings ===');
    this.bindings.forEach((targets, sourceKey) => {
      console.log(`${sourceKey} →`);
      targets.forEach(target => {
        console.log(`  → ${target.nodeId}.${target.parameterName}`);
      });
    });
  }

  destroy() {
    this.bindings.clear();
    this.boundToSource.clear();
    this.clipboard = null;
  }
}