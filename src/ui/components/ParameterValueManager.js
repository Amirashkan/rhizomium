// src/ui/components/ParameterValueManager.js - Fixed for shader compilation
import { ParameterEvents } from '../../utils/ParameterEventSystem.js';
import { expressionSystem } from '../../utils/ParameterExpressionSystem.js';

export class ParameterValueManager {
  constructor(graph, undoManager = null, eventSystem = null) {
    this.graph = graph;
    this.undoManager = undoManager;
    this.eventSystem = eventSystem;
    this.expressionSystem = expressionSystem;
    this.debugMode = window.location.search.includes('debug=params');
  }
  // Check if node is allowed to update via drag, even if not selected
  // Always allow drag on any node regardless of selection state
  isDragPermitted(node) {
    return true;
  }

  _debugLog(message, data = {}) {
    if (this.debugMode) {
      console.log(`[ParameterValueManager] ${message}`, data);
    }
  }

  // Safe number conversion
  _toSafeNumber(value, paramName = 'unknown', defaultValue = 0) {
    if (value == null) return Number(defaultValue) || 0;
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && isFinite(parsed)) return parsed;
    }
    
    const safeDefault = Number(defaultValue) || 0;
    if (this.debugMode) {
      console.warn(`Could not convert value to number for ${paramName}:`, { value, type: typeof value, defaultValue: safeDefault });
    }
    return safeDefault;
  }

  // NEW: Get parameter value specifically for UI display (evaluates expressions)
  getNodeParameterValueForUI(node, paramName, defaultValue) {
    this._debugLog(`Getting UI parameter value for ${node?.kind}.${paramName}`);
    
    // First check if there's a connected input for this parameter
    const connectedValue = this._getConnectedInputValue(node, paramName);
    if (connectedValue !== undefined) {
      return this._toSafeNumber(connectedValue, `${paramName}(connected)`, defaultValue);
    }

    // Get the raw parameter value
    const rawValue = this._getRawParameterValue(node, paramName, defaultValue);

    // If it's an expression, evaluate it for UI display
    if (this.expressionSystem.isExpression(rawValue)) {
      try {
        const result = this.expressionSystem.evaluateExpression(rawValue, {}, node);
        return this._toSafeNumber(result, `${paramName}(expression)`, defaultValue);
      } catch (error) {
        console.warn(`Expression evaluation failed for ${paramName}:`, error);
        return this._toSafeNumber(defaultValue, `${paramName}(error)`, 0);
      }
    }

    return this._toSafeNumber(rawValue, paramName, defaultValue);
  }

  // NEW: Get parameter value for shader compilation (NEVER evaluates expressions - returns evaluated numbers)
  getNodeParameterValueForShader(node, paramName, defaultValue) {
    this._debugLog(`Getting shader parameter value for ${node?.kind}.${paramName}`);
    
    // First check if there's a connected input for this parameter
    const connectedValue = this._getConnectedInputValue(node, paramName);
    if (connectedValue !== undefined) {
      return this._toSafeNumber(connectedValue, `${paramName}(connected)`, defaultValue);
    }

    // Get the raw parameter value
    const rawValue = this._getRawParameterValue(node, paramName, defaultValue);

    // If it's an expression, evaluate it and return ONLY the numeric result
    if (this.expressionSystem.isExpression(rawValue)) {
      try {
        const result = this.expressionSystem.evaluateExpression(rawValue, {}, node);
        const numericResult = this._toSafeNumber(result, `${paramName}(expression)`, defaultValue);
        this._debugLog(`Expression ${rawValue} evaluated to ${numericResult} for shader`);
        return numericResult;
      } catch (error) {
        console.warn(`Expression evaluation failed for shader compilation of ${paramName}:`, error);
        return this._toSafeNumber(defaultValue, `${paramName}(error)`, 0);
      }
    }

    return this._toSafeNumber(rawValue, paramName, defaultValue);
  }

  // MAIN: Get parameter value (legacy method - uses shader-safe approach)
  getNodeParameterValue(node, paramName, defaultValue) {
    // For backward compatibility, use the shader-safe version
    return this.getNodeParameterValueForShader(node, paramName, defaultValue);
  }

  // Helper to get raw parameter value without any processing
  _getRawParameterValue(node, paramName, defaultValue) {
    if (paramName === "value" && typeof node.value !== "undefined") return node.value;
    if (paramName === "x" && typeof node.x !== "undefined") return node.x;
    if (paramName === "y" && typeof node.y !== "undefined") return node.y;
    if (paramName === "expr" && typeof node.expr !== "undefined") return node.expr;
    if (node.params && typeof node.params[paramName] !== "undefined") return node.params[paramName];
    if (node.props && typeof node.props[paramName] !== "undefined") return node.props[paramName];
    return defaultValue;
  }

  // Get the raw parameter value (without expression evaluation) - useful for UI display
  getRawParameterValue(node, paramName, defaultValue) {
    return this._getRawParameterValue(node, paramName, defaultValue);
  }

  // Update node parameter with connected input support, undo tracking, and expression support
  updateNodeParameter(node, paramName, value, onChange) {
    console.log("[updateNodeParameter] CALLED:", node.kind, paramName, "newValue:", value, "type:", typeof value);

    // Get the old raw value for undo tracking
    const oldValue = this.getRawParameterValue(node, paramName, null);
    console.log("[updateNodeParameter] oldValue:", oldValue, "type:", typeof oldValue);

    // Don't record undo if value hasn't actually changed
    if (oldValue === value) {
      console.log("[updateNodeParameter] SKIPPING - values are equal");
      return;
    }

    console.log("[updateNodeParameter] PROCEEDING with update");

    const connectedSourceNode = this._findConnectedSourceNode(node, paramName);

    if (connectedSourceNode) {
      this._updateConnectedSourceNode(connectedSourceNode, value, onChange, oldValue);
    } else {
      this._updateNodeDirectly(node, paramName, value, onChange, oldValue);
    }

    // Clear expression cache for this parameter change
    if (this.expressionSystem.isExpression(value) || this.expressionSystem.isExpression(oldValue)) {
      this.expressionSystem.updateDependencies(node.id, paramName, value);
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
    const oldValue = this.getRawParameterValue(node, paramName, null);
    
    // Store the raw value (which could be an expression)
    this._setRawParameterValue(node, paramName, value);

    // Clear expression cache
    if (this.expressionSystem.isExpression(value) || this.expressionSystem.isExpression(oldValue)) {
      this.expressionSystem.updateDependencies(node.id, paramName, value);
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

  // Set raw parameter value (used internally and by undo system)
  _setRawParameterValue(node, paramName, value) {
    // Store expressions as-is, convert non-expressions to appropriate type
    let processedValue = value;
    
    if (!this.expressionSystem.isExpression(value)) {
      // Only convert to number if it's not an expression
      processedValue = isNaN(Number(value)) ? value : Number(value);
    }

    if (paramName === "value") {
      node.value = processedValue;
    } else if (paramName === "x") {
      node.x = processedValue;
    } else if (paramName === "y") {
      node.y = processedValue;
    } else if (paramName === "expr") {
      node.expr = processedValue;
    } else {
      // Store in params first (new preferred location), fall back to props for compatibility
      if (!node.params) node.params = {};
      node.params[paramName] = processedValue;
      
      // Also update props for backward compatibility
      if (!node.props) node.props = {};
      node.props[paramName] = processedValue;
    }
  }

  // Check if parameter has connected input
  hasConnectedInput(node, paramName) {
    return this._getConnectedInputValue(node, paramName) !== undefined;
  }

  // Find connected source node for parameter
  findConnectedSourceNode(node, paramName) {
    return this._findConnectedSourceNode(node, paramName);
  }

  // Validate expression for a parameter
  validateParameterExpression(node, paramName, expression) {
    return this.expressionSystem.validateExpression(expression, {}, node);
  }

  // Get all expressions in a node
  getNodeExpressions(node) {
    const expressions = {};
    
    const checkParams = (params, prefix = '') => {
      if (!params) return;
      Object.entries(params).forEach(([key, value]) => {
        if (this.expressionSystem.isExpression(value)) {
          expressions[prefix + key] = value;
        }
      });
    };

    checkParams(node.params);
    checkParams(node.props);
    
    // Check direct properties
    ['value', 'x', 'y', 'expr'].forEach(prop => {
      if (node[prop] !== undefined && this.expressionSystem.isExpression(node[prop])) {
        expressions[prop] = node[prop];
      }
    });

    return expressions;
  }

  // Re-evaluate all expressions in a node
  reevaluateNodeExpressions(node) {
    try {
      const expressions = this.getNodeExpressions(node);
      if (Object.keys(expressions).length > 0) {
        // Clear cache for all expressions
        Object.keys(expressions).forEach(paramName => {
          this.expressionSystem.updateDependencies(node.id, paramName, expressions[paramName]);
        });
        
        // Trigger updates
        this._triggerUpdates(node, null);
        
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error re-evaluating expressions for node ${node.id}:`, error);
      return false;
    }
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
        const rawValue = node.props?.value || node.value || 0;
        if (this.expressionSystem.isExpression(rawValue)) {
          try {
            const result = this.expressionSystem.evaluateExpression(rawValue, {}, node);
            return this._toSafeNumber(result, 'sourceNode.value', 0);
          } catch (error) {
            console.warn('Expression evaluation failed in source node:', error);
            return 0;
          }
        }
        return this._toSafeNumber(rawValue, 'sourceNode.value', 0);
      case "time":
        return (Date.now() / 1000) % 1;
      case "randomtime":
        return Math.random();
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
      let processedValue;
      
      if (this.expressionSystem.isExpression(value)) {
        processedValue = value; // Store expression as-is
        this._debugLog("Storing expression in connected source node:", value);
      } else {
        processedValue = this._toSafeNumber(value, 'connectedSourceNode.value', 0);
        this._debugLog("Storing number in connected source node:", processedValue);
      }

      // Record undo for the connected source node
      if (this.undoManager) {
        const sourceOldValue = connectedSourceNode.props?.value || connectedSourceNode.value || 0;
        this.undoManager.recordParameterChange(connectedSourceNode.id, 'value', sourceOldValue, processedValue);
      }

      // Store in all locations for compatibility
      connectedSourceNode.value = processedValue;
      if (!connectedSourceNode.props) connectedSourceNode.props = {};
      connectedSourceNode.props.value = processedValue;
      if (!connectedSourceNode.params) connectedSourceNode.params = {};
      connectedSourceNode.params.value = processedValue;

      console.log("Updated source Float node value to:", processedValue);

      if (this.expressionSystem.isExpression(value)) {
        this.expressionSystem.updateDependencies(connectedSourceNode.id, 'value', value);
      }

      this._triggerUpdates(connectedSourceNode, onChange);
    }
  }

  _updateNodeDirectly(node, paramName, value, onChange, oldValue) {
    console.log("No connected input - updating node parameter directly");

    if (this.undoManager && oldValue !== undefined) {
      this.undoManager.recordParameterChange(node.id, paramName, oldValue, value);
    }

    this._setRawParameterValue(node, paramName, value);
    this._triggerUpdates(node, onChange);
  }

  _triggerUpdates(node, onChange) {
    if (onChange) onChange(); // Trigger shader recompilation

    if (window.editor?.previewIntegration) {
      console.log("Calling onParameterChange for:", node.kind);
      window.editor.previewIntegration.onParameterChange(node);
    }
  }

  // Convenience methods for ParameterPanel compatibility
  setValue(node, paramName, value) {
    this.updateNodeParameter(node, paramName, value, window.editor?.onChange);
  }

  getValue(node, paramName, defaultValue) {
    return this.getRawParameterValue(node, paramName, defaultValue);
  }
}