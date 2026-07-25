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
  isDragPermitted(_node) {
    return true;
  }

  // Off unless the editor was opened with ?debug=params. Five callers build a message for this, so
  // the body has to exist for the switch to mean anything — it had been emptied down to nothing.
  _debugLog(message, data = {}) {
    if (this.debugMode) console.debug('[params]', message, data);
  }

  // Safe number conversion
  _toSafeNumber(value, _paramName = 'unknown', defaultValue = 0) {
    if (value == null) return Number(defaultValue) || 0;
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && isFinite(parsed)) return parsed;
    }
    
    const safeDefault = Number(defaultValue) || 0;
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
      } catch {

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
      } catch {

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
    // NOTE: 'x'/'y' params (e.g. ConstVec2/3/4 components) are read from node.params below,
    // NOT from node.x/node.y — those are the node's canvas position, not parameter values.
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
    // PERFORMANCE: Disable excessive console logging during drag operations
    // console.log("[updateNodeParameter] CALLED:", node.kind, paramName, "newValue:", value, "type:", typeof value);

    // Get the old raw value for undo tracking
    const oldValue = this.getRawParameterValue(node, paramName, null);
    // console.log("[updateNodeParameter] oldValue:", oldValue, "type:", typeof oldValue);

    // Don't record undo if value hasn't actually changed
    if (oldValue === value) {
      // console.log("[updateNodeParameter] SKIPPING - values are equal");
      return;
    }

    // console.log("[updateNodeParameter] PROCEEDING with update");

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
    } else if (paramName === "expr") {
      node.expr = processedValue;
    } else {
      // Store in params first (new preferred location), fall back to props for compatibility.
      // NOTE: 'x'/'y' params (e.g. ConstVec2/3/4 components) are stored here like any other
      // param — they must NOT be written to node.x/node.y, which are the node's canvas position.
      // Writing them there would teleport the node whenever its X/Y value changed.
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

    // Check direct properties. NOTE: 'x'/'y' are intentionally excluded — those are the node's
    // canvas position. Vec component params named 'x'/'y' live in node.params (scanned above).
    ['value', 'expr'].forEach(prop => {
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
    } catch {

      return false;
    }
  }

  // Private methods
  _getConnectedInputValue(_node, _paramName) {
    if (!this.graph?.connections) return undefined;

    // Parameters are not driven by input pins in this architecture.
    // Input pins are for graph connections, parameters are separate settings.
    // Removing the hardcoded paramToPinMap to prevent incorrect parameter disabling.
    // If a specific node type needs parameter-to-pin mapping in the future,
    // it should be defined explicitly in NodeDefs, not hardcoded here.

    return undefined;
  }

  _getSourceNodeValue(node) {
    switch (node.kind.toLowerCase()) {
      case "constfloat":
      case "float": {
        const rawValue = node.props?.value || node.value || 0;
        if (this.expressionSystem.isExpression(rawValue)) {
          try {
            const result = this.expressionSystem.evaluateExpression(rawValue, {}, node);
            return this._toSafeNumber(result, 'sourceNode.value', 0);
          } catch {

            return 0;
          }
        }
        return this._toSafeNumber(rawValue, 'sourceNode.value', 0);
      }
      case "time":
        return (Date.now() / 1000) % 1;
      case "uv":
        return 0.5;
      default:
        return 0;
    }
  }

  _findConnectedSourceNode(_node, _paramName) {
    if (!this.graph?.connections) return null;

    // Parameters are not driven by input pins in this architecture.
    // Input pins are for graph connections, parameters are separate settings.
    // Removing the hardcoded paramToPinMap to prevent incorrect parameter disabling.
    // If a specific node type needs parameter-to-pin mapping in the future,
    // it should be defined explicitly in NodeDefs, not hardcoded here.

    return null;
  }

  _updateConnectedSourceNode(connectedSourceNode, value, onChange, _oldValue) {
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

      if (this.expressionSystem.isExpression(value)) {
        this.expressionSystem.updateDependencies(connectedSourceNode.id, 'value', value);
      }

      this._triggerUpdates(connectedSourceNode, onChange);
    }
  }

  _updateNodeDirectly(node, paramName, value, onChange, oldValue) {
    if (this.undoManager && oldValue !== undefined) {
      this.undoManager.recordParameterChange(node.id, paramName, oldValue, value);
    }

    this._setRawParameterValue(node, paramName, value);
    this._triggerUpdates(node, onChange);
  }

  _triggerUpdates(node, onChange) {
    if (onChange) {
      onChange(); // Trigger shader recompilation
    }

    // ALWAYS trigger preview updates, even during drag
    // PreviewIntegration.onParameterChange handles debouncing and drag optimization
    // This ensures node reference values are updated in real-time
    if (window.editor?.previewIntegration) {
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