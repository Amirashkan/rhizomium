// src/ui/components/ParameterValueManager.js
import { ParameterEvents } from '../../utils/ParameterEventSystem.js';

export class ParameterValueManager {
  constructor(graph, undoManager = null, eventSystem = null) {
    this.graph = graph;
    this.undoManager = undoManager;
    this.eventSystem = eventSystem;
  }

  // Get node parameter value with connected input support
  getNodeParameterValue(node, paramName, defaultValue) {
    // First check if there's a connected input for this parameter
    const connectedValue = this._getConnectedInputValue(node, paramName);
    if (connectedValue !== undefined) {
      return connectedValue; // Show the connected input value in the panel
    }

    // Otherwise use the stored parameter value
    if (paramName === "value" && typeof node.value !== "undefined") return node.value;
    if (paramName === "x" && typeof node.x !== "undefined") return node.x;
    if (paramName === "y" && typeof node.y !== "undefined") return node.y;
    if (paramName === "expr" && typeof node.expr !== "undefined") return node.expr;
    if (node.props && typeof node.props[paramName] !== "undefined") return node.props[paramName];
    
    return defaultValue;
  }

  // Update node parameter with connected input support and undo tracking
  updateNodeParameter(node, paramName, value, onChange) {
    console.log("Parameter update:", node.kind, paramName, value);

    // Get the old value for undo tracking
    const oldValue = this.getNodeParameterValue(node, paramName, null);
    
    // Don't record undo if value hasn't actually changed
    if (oldValue === value) {
      return;
    }

    const connectedSourceNode = this._findConnectedSourceNode(node, paramName);

    if (connectedSourceNode) {
      this._updateConnectedSourceNode(connectedSourceNode, value, onChange, oldValue);
    } else {
      this._updateNodeDirectly(node, paramName, value, onChange, oldValue);
    }

    // Emit parameter change event
    if (this.eventSystem) {
      this.eventSystem.emit(ParameterEvents.PARAMETER_CHANGED, {
        node: node,
        parameterName: paramName,
        oldValue: oldValue,
        newValue: value,
        source: 'user'
      });
    }
  }

  // Apply parameter change from undo/redo system
  applyParameterChange(node, paramName, value, source = 'undo') {
    const oldValue = this.getNodeParameterValue(node, paramName, null);
    
    if (paramName === "value") {
      node.value = isNaN(Number(value)) ? value : Number(value);
    } else if (paramName === "x") {
      node.x = isNaN(Number(value)) ? value : Number(value);
    } else if (paramName === "y") {
      node.y = isNaN(Number(value)) ? value : Number(value);
    } else if (paramName === "expr") {
      node.expr = value;
    } else {
      // For CircleField props and others
      if (!node.props) node.props = {};
      node.props[paramName] = isNaN(Number(value)) ? value : Number(value);
    }

    // Emit parameter change event
    if (this.eventSystem) {
      this.eventSystem.emit(
        source === 'undo' ? ParameterEvents.PARAMETER_UNDONE : ParameterEvents.PARAMETER_REDONE,
        {
          node: node,
          parameterName: paramName,
          oldValue: oldValue,
          newValue: value,
          source: source
        }
      );
    }

    this._triggerUpdates(node, null);
  }

  // Batch update multiple parameters (useful for preventing too many undo steps)
  batchUpdateParameters(updates, onChange) {
    if (updates.length === 0) return;
    
    // For now, just process each update individually
    // Could be enhanced to create a single compound undo action
    updates.forEach(({ node, paramName, value }) => {
      this.updateNodeParameter(node, paramName, value, onChange);
    });
  }

  // Check if parameter has connected input
  hasConnectedInput(node, paramName) {
    return this._getConnectedInputValue(node, paramName) !== undefined;
  }

  // Find connected source node for parameter
  findConnectedSourceNode(node, paramName) {
    return this._findConnectedSourceNode(node, paramName);
  }

  // Private methods
  _getConnectedInputValue(node, paramName) {
    if (!this.graph?.connections) return undefined;

    const paramToPinMap = {
      radius: 0,
      epsilon: 1,
      value: 0,
      x: 0,
      y: 1,
      z: 2,
    };

    const pinIndex = paramToPinMap[paramName];
    if (pinIndex === undefined) return undefined;

    // Find connection to this node's input pin
    for (const conn of this.graph.connections) {
      if (conn.to.nodeId === node.id && conn.to.pin === pinIndex) {
        const sourceNode = this.graph.nodes.find(n => n.id === conn.from.nodeId);
        if (sourceNode) {
          return this._getSourceNodeValue(sourceNode);
        }
      }
    }

    return undefined;
  }

  _getSourceNodeValue(node) {
    switch (node.kind.toLowerCase()) {
      case "constfloat":
      case "float":
        return node.props?.value || node.value || 0;
      case "time":
        return (Date.now() / 1000) % 1;
      case "uv":
        return 0.5;
      default:
        return 0;
    }
  }

  _findConnectedSourceNode(node, paramName) {
    if (!this.graph?.connections) return null;

    const paramToPinMap = {
      radius: 0,
      epsilon: 1,
      value: 0,
      x: 0,
      y: 1,
      z: 2,
    };

    const pinIndex = paramToPinMap[paramName];
    if (pinIndex === undefined) return null;

    // Find connection to this node's input pin
    for (const conn of this.graph.connections) {
      if (conn.to.nodeId === node.id && conn.to.pin === pinIndex) {
        const sourceNode = this.graph.nodes.find(n => n.id === conn.from.nodeId);
        return sourceNode || null;
      }
    }

    return null;
  }

  _updateConnectedSourceNode(connectedSourceNode, value, onChange, oldValue) {
    console.log("Updating connected source node:", connectedSourceNode.kind, connectedSourceNode.id);

    if (connectedSourceNode.kind === "ConstFloat" || connectedSourceNode.kind === "Float") {
      const numValue = isNaN(Number(value)) ? 0 : Number(value);

      // Record undo for the connected source node
      if (this.undoManager) {
        const sourceOldValue = connectedSourceNode.props?.value || connectedSourceNode.value || 0;
        this.undoManager.recordParameterChange(connectedSourceNode.id, 'value', sourceOldValue, numValue);
      }

      // Store in both places for compatibility
      connectedSourceNode.value = numValue;
      if (!connectedSourceNode.props) connectedSourceNode.props = {};
      connectedSourceNode.props.value = numValue;

      console.log("Updated source Float node value to:", numValue);

      this._triggerUpdates(connectedSourceNode, onChange);
    }
  }

  _updateNodeDirectly(node, paramName, value, onChange, oldValue) {
    console.log("No connected input - updating node parameter directly");

    // Record undo action before making the change
    if (this.undoManager && oldValue !== undefined) {
      this.undoManager.recordParameterChange(node.id, paramName, oldValue, value);
    }

    if (paramName === "value") {
      node.value = isNaN(Number(value)) ? value : Number(value);
    } else if (paramName === "x") {
      node.x = isNaN(Number(value)) ? value : Number(value);
    } else if (paramName === "y") {
      node.y = isNaN(Number(value)) ? value : Number(value);
    } else if (paramName === "expr") {
      node.expr = value;
    } else {
      // For CircleField props and others
      if (!node.props) node.props = {};
      node.props[paramName] = isNaN(Number(value)) ? value : Number(value);
    }

    this._triggerUpdates(node, onChange);
  }

  _triggerUpdates(node, onChange) {
    // Immediate updates
    if (onChange) onChange(); // Trigger shader recompilation

    if (window.editor?.previewIntegration) {
      console.log("Calling onParameterChange for:", node.kind);
      window.editor.previewIntegration.onParameterChange(node);
    }
  }
}