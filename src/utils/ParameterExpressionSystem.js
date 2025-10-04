// src/utils/ParameterExpressionSystem.js - Complete implementation with preview updates

console.log('=== TRACING PARAMETER CHANGES ===');

// Override ALL possible setValue methods
['setValue', 'updateNodeParameter', 'setParameter'].forEach(methodName => {
  if (window.editor?.paramPanel?.valueManager?.[methodName]) {
    const original = window.editor.paramPanel.valueManager[methodName];
    window.editor.paramPanel.valueManager[methodName] = function(...args) {
      console.log(`${methodName} called with:`, args);
      return original.apply(this, args);
    };
  }
});

export class ParameterExpressionSystem {
  constructor() {
    this.expressionCache = new Map();
    this.dependencyGraph = new Map();
    this.evaluationContext = new Map();
    this.listeners = new Set();
    
    // Built-in functions available in expressions
    this.builtInFunctions = {
      // Math functions
      abs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      sqrt: Math.sqrt,
      pow: Math.pow,
      min: Math.min,
      max: Math.max,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      random: Math.random,
      
      // Utility functions
      clamp: (value, min, max) => Math.min(Math.max(value, min), max),
      lerp: (a, b, t) => a + (b - a) * t,
      map: (value, inMin, inMax, outMin, outMax) => 
        outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin),
      smoothstep: (edge0, edge1, x) => {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
      },
      step: (edge, x) => x < edge ? 0 : 1,
      
      // Vector-like operations
      length: (...args) => Math.sqrt(args.reduce((sum, val) => sum + val * val, 0)),
      distance: (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),
      
      // Time-based functions (can be overridden with actual time)
      time: () => Date.now() / 1000,
      frame: () => 0, // Can be updated by animation system
    };
  }
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
  /**
   * Checks if a value is an expression (starts with =)
   */
  isExpression(value) {
    return typeof value === 'string' && value.trim().startsWith('=');
  }

  /**
   * Evaluates a parameter expression with comprehensive error handling
   */
  evaluateExpression(expression, context = {}, node = null) {
    try {
      if (!this.isExpression(expression)) {
        return this.parseValue(expression);
      }
  if (expression.includes('time') && node) {
    // Mark this node as needing continuous updates
    if (!this.timeAnimatedNodes) {
      this.timeAnimatedNodes = new Set();
    }
    this.timeAnimatedNodes.add(node.id);
  }
      const cleanExpression = expression.slice(1).trim();
      if (!cleanExpression) {
        return 0; // Empty expression defaults to 0
      }

      // Check cache first
      const cacheKey = this.getCacheKey(cleanExpression, context, node);
      if (this.expressionCache.has(cacheKey)) {
        const cached = this.expressionCache.get(cacheKey);
        if (this.isContextValid(cached.context, context)) {
          return cached.result;
        }
      }

      // Build evaluation context
      const evalContext = this.buildEvaluationContext(context, node);
      
      // Evaluate the expression
      const result = this.safeEvaluate(cleanExpression, evalContext);
      
      // Cache the result
      this.expressionCache.set(cacheKey, {
        result,
        context: { ...context },
        timestamp: Date.now()
      });

      // Update dependencies
      this.updateDependencyGraph(node?.id, cleanExpression, evalContext);

      return result;

    } catch (error) {
      console.warn(`Expression evaluation failed: ${error.message}`, {
        expression,
        nodeId: node?.id,
        context
      });
      return this.parseValue(expression.slice(1)); // Return expression without = on error
    }
  }

  /**
   * Parses a non-expression value to appropriate type
   */
  parseValue(value) {
    if (typeof value !== 'string') return value;
    
    const trimmed = value.trim();
    
    // Boolean values
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    
    // Numeric values
    if (!isNaN(trimmed) && trimmed !== '' && !isNaN(parseFloat(trimmed))) {
      return parseFloat(trimmed);
    }
    
    return value;
  }
// Add to the ParameterExpressionSystem class
startAnimationLoop() {
  if (this.animationLoop) return; // Already running
  
  this.animationLoop = setInterval(() => {
    // Clear cache for time-dependent expressions
    for (const [key, cached] of this.expressionCache.entries()) {
      if (this.isTimeDependentExpression(key)) {
        this.expressionCache.delete(key);
      }
    }
    
    // Trigger preview updates for nodes with time expressions
    this.updateTimeBasedPreviews();
  }, 50); // 20 FPS
}

isTimeDependentExpression(cacheKey) {
  return cacheKey.includes('time') || cacheKey.includes('frame');
}

updateTimeBasedPreviews() {
  if (!window.editor?.graph?.nodes) return;
  
  window.editor.graph.nodes.forEach(node => {
    if (node.params) {
      const hasTimeExpression = Object.values(node.params).some(value => 
        typeof value === 'string' && value.includes('time')
      );
      
      if (hasTimeExpression && window.editor.previewIntegration) {
        window.editor.previewIntegration.generateNodePreview(node);
      }
    }
  });
}

stopAnimationLoop() {
  if (this.animationLoop) {
    clearInterval(this.animationLoop);
    this.animationLoop = null;
  }
}
  /**
   * Builds comprehensive evaluation context
   */
buildEvaluationContext(context, node) {
  const evalContext = {
    // Math constants
    PI: Math.PI,
    E: Math.E,
    
    // Real-time computed values
get time() { return performance.now() / 1000; },    get frame() { return 0; }, // Can be updated by animation system
    
    // Math functions
    sin: Math.sin,
    cos: Math.cos,
    sqrt: Math.sqrt,
    // ... other math functions
    
    // Node context
    nodeId: node?.id,
    nodeType: node?.kind,
    nodeX: node?.x || 0,
    nodeY: node?.y || 0,
    
    // Custom context variables
    ...context
  };

  // Add node parameters as variables
  if (node?.params) {
    Object.entries(node.params).forEach(([key, value]) => {
      if (!this.isExpression(value)) {
        evalContext[key] = this.parseValue(value);
      }
    });
  }

  return evalContext;
}
  /**
   * Safely evaluates an expression using Function constructor with sandboxing
   */
safeEvaluate(expression, context) {
  try {
    // Check for incomplete expressions
    if (this.isIncompleteExpression(expression)) {
      throw new Error('Incomplete expression');
    }
    
    // Create parameter list and values from context
    const params = Object.keys(context);
    const values = Object.values(context);
    
    // Validate expression for basic safety
    if (this.containsUnsafeCode(expression)) {
      throw new Error('Unsafe code detected in expression');
    }
    
    // Create and execute function
    const func = new Function(...params, `return (${expression})`);
    const result = func(...values);
    
    // Validate result
    if (typeof result === 'number' && (isNaN(result) || !isFinite(result))) {
      throw new Error('Expression resulted in invalid number');
    }
    
    return result;
  } catch (error) {
    throw new Error(`Expression evaluation failed: ${error.message}`);
  }
}

// Add this helper method
isIncompleteExpression(expression) {
  const incompletePatterns = [
        /[+\-*/]$/, // Ends with operator ← This catches "time*"
    /\($/, 
    /,\s*$/,
    /[+\-*/]$/, // Ends with operator
    /\($/, // Ends with opening parenthesis
    /,\s*$/, // Ends with comma
    /\bsin$/, /\bcos$/, /\btan$/, // Incomplete function names
    /\bsine$/, /\bcosine$/, // Common typos
    /vec2\s*\($/, // Incomplete vec2 call
    /vec3\s*\($/, // Incomplete vec3 call
    /[a-zA-Z_][a-zA-Z0-9_]*\s*\($/, // Any incomplete function call
  ];
  
  return incompletePatterns.some(pattern => pattern.test(expression.trim()));
}
  /**
   * Basic safety check for expressions
   */
  containsUnsafeCode(expression) {
    const unsafe = [
      'eval', 'Function', 'constructor', 'prototype',
      'window', 'document', 'global', 'process',
      '__proto__', 'import', 'require'
    ];
    
    return unsafe.some(keyword => expression.includes(keyword));
  }

  /**
   * Generates cache key for expression results
   */
  getCacheKey(expression, context, node) {
    const nodeId = node?.id || 'global';
    const contextHash = this.hashContext(context);
    return `${nodeId}_${expression}_${contextHash}`;
  }

  /**
   * Simple context hashing for cache keys
   */
  hashContext(context) {
    return JSON.stringify(Object.keys(context).sort().map(key => 
      [key, typeof context[key] === 'function' ? 'function' : context[key]]
    ));
  }

  /**
   * Checks if cached context is still valid
   */
  isContextValid(cachedContext, currentContext) {
    const relevantKeys = Object.keys(currentContext);
    return relevantKeys.every(key => cachedContext[key] === currentContext[key]);
  }

  /**
   * Updates dependency graph for expression invalidation
   */
  updateDependencyGraph(nodeId, expression, context) {
    if (!nodeId) return;
    
    // Simple dependency tracking - could be enhanced
    const dependencies = this.extractVariables(expression);
    this.dependencyGraph.set(nodeId, dependencies);
  }

  /**
   * Extracts variable names from expression (basic implementation)
   */
  extractVariables(expression) {
    const varPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const matches = expression.match(varPattern) || [];
    return [...new Set(matches)].filter(match => 
      !this.builtInFunctions.hasOwnProperty(match) && 
      !['PI', 'E', 'true', 'false'].includes(match)
    );
  }

  /**
   * Updates dependencies when a parameter changes
   */
  updateDependencies(nodeId, paramName, newValue) {
    try {
      // Clear cache entries that might depend on this parameter
      for (const [key, cached] of this.expressionCache.entries()) {
        if (key.includes(nodeId) || 
            cached.context.hasOwnProperty(paramName) ||
            key.includes(paramName)) {
          this.expressionCache.delete(key);
        }
      }

      // Notify listeners of dependency changes
      this.notifyDependencyChange(nodeId, paramName, newValue);
    } catch (error) {
      console.warn('Error updating dependencies:', error);
    }
  }

  /**
   * Notifies listeners of dependency changes
   */
  notifyDependencyChange(nodeId, paramName, newValue) {
    this.listeners.forEach(listener => {
      try {
        listener({ nodeId, paramName, newValue });
      } catch (error) {
        console.warn('Error in dependency change listener:', error);
      }
    });
  }

  /**
   * Adds a dependency change listener
   */
  addDependencyListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Validates an expression and returns detailed info
   */
  validateExpression(expression, context = {}, node = null) {
    try {
      if (!this.isExpression(expression)) {
        const parsed = this.parseValue(expression);
        return { 
          valid: true, 
          result: parsed,
          type: typeof parsed
        };
      }

      const result = this.evaluateExpression(expression, context, node);
      return { 
        valid: true, 
        result,
        type: typeof result,
        dependencies: this.extractVariables(expression.slice(1))
      };
    } catch (error) {
      return { 
        valid: false, 
        error: error.message,
        result: expression,
        type: 'error'
      };
    }
  }

  /**
   * Clears all cached expressions
   */
  clearCache() {
    this.expressionCache.clear();
  }

  /**
   * Gets cache statistics
   */
  getCacheStats() {
    return {
      size: this.expressionCache.size,
      entries: Array.from(this.expressionCache.keys())
    };
  }
}

// Enhanced Text Input Handler with Expression Support
export class ExpressionTextInputHandler {
  constructor(undoManager, expressionSystem) {
    this.undoManager = undoManager;
    this.expressionSystem = expressionSystem;
    this.activeInputs = new Map(); // Track active inputs for real-time updates
  }

create(param, node, div, label, valueManager, onChange) {
  try {
    const container = this.createContainer();
    const input = this.createInput(param, node, valueManager);
    // REMOVE THIS LINE:
    // const helperButton = this.createExpressionHelper(input, param, node, valueManager, onChange);
    const resultDisplay = this.createResultDisplay();

    // Setup event handlers
    this.setupEventHandlers(input, param, node, valueManager, onChange, resultDisplay);
    this.setupNumericDragSupport(input, param, node, valueManager, onChange);

    // Initial validation and display update
    this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);

    // Track this input for updates
    this.activeInputs.set(`${node.id}_${param.name}`, {
      input, resultDisplay, param, node, valueManager, onChange
    });

    container.appendChild(input);
    // REMOVE THIS LINE:
    // container.appendChild(helperButton);
    container.appendChild(resultDisplay);
    div.appendChild(container);

    return div;
  } catch (error) {
    console.error('Error creating expression input:', error);
    return div;
  }
}
isIncomplete(value) {
  if (!value || typeof value !== 'string') return false;
  
  const trimmed = value.trim();
  
  // Incomplete operators
  if (/[+\-*/]$/.test(trimmed)) return true;
  
  // Incomplete function calls
  if (/\w+\($/.test(trimmed)) return true;
  
  // Incomplete parentheses
  const openCount = (trimmed.match(/\(/g) || []).length;
  const closeCount = (trimmed.match(/\)/g) || []).length;
  if (openCount !== closeCount) return true;
  
  return false;
}
  createContainer() {
    const container = document.createElement('div');
    container.className = 'expression-input-container';
    container.style.cssText = `
      position: relative;
      margin-bottom: 4px;
    `;
    return container;
  }

  createInput(param, node, valueManager) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'param-input expression-capable';
    input.setAttribute('data-param', param.name);
    input.setAttribute('data-param-type', param.type);
    
    const currentValue = node.params?.[param.name] ?? param.default ?? '';
    input.value = String(currentValue);

input.style.cssText = `
  width: 100%;  /* Change from calc(100% - 25px) */
  padding: 6px;
  background: #333;
  color: #fff;
  border: 1px solid #555;
  border-radius: 4px;  /* Change from 4px 0 0 4px */
  font-size: 11px;
  box-sizing: border-box;
  font-family: ${this.expressionSystem.isExpression(currentValue) ? 'monospace' : 'inherit'};
`;
    // Set placeholder based on parameter type
    input.placeholder = param.type === 'float' ? 'Number or =expression' : 
                      param.type === 'int' ? 'Integer or =expression' :
                      'Value or =expression';

    return input;
  }



  createResultDisplay() {
    const display = document.createElement('div');
    display.className = 'expression-result';
    display.style.cssText = `
      font-size: 10px;
      color: #888;
      margin-top: 2px;
      font-style: italic;
      min-height: 12px;
      padding-left: 2px;
    `;
    return display;
  }

  setupEventHandlers(input, param, node, valueManager, onChange, resultDisplay) {
    let inputTimer = null;
    let lastValue = input.value;

    // Prevent keyboard events from bubbling to editor
    input.addEventListener('keydown', (e) => {
      if (['Delete', 'Backspace', 'Enter', 'Tab'].includes(e.key)) {
        e.stopPropagation();
      }
      
      if (e.key === 'Enter') {
        input.blur();
      }
    });

    // Focus handling
    input.addEventListener('focus', () => {
      lastValue = input.value;
    });

    // Real-time input handling with debouncing
// Real-time input handling with debouncing
input.addEventListener('input', (e) => {
  e.stopPropagation();
  
  // Clear previous timer
  if (inputTimer) {
    clearTimeout(inputTimer);
  }

  // Update display immediately
  this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);

  // Debounce actual parameter updates
  inputTimer = setTimeout(() => {
    const newValue = input.value.trim();
    
    // ADD THIS: Don't update if incomplete
    if (this.isIncomplete(newValue)) {
      return; // Wait for complete expression
    }
    
    if (newValue !== lastValue) {
      valueManager.setValue(node, param.name, newValue);
      this.expressionSystem.updateDependencies(node.id, param.name, newValue);
      onChange(`Parameter Change: ${param.name}`);
      lastValue = newValue;
    }
    inputTimer = null;
  }, 300);
});
    // Final update on blur
    input.addEventListener('blur', () => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }
      
      const newValue = input.value.trim();
      if (newValue !== lastValue) {
        valueManager.setValue(node, param.name, newValue);
        this.expressionSystem.updateDependencies(node.id, param.name, newValue);
        onChange(`Parameter Change: ${param.name}`);
      }
    });

    // Prevent click propagation
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  setupNumericDragSupport(input, param, node, valueManager, onChange) {
    if (param.type !== 'float' && param.type !== 'int') return;

    let isDragging = false;
    let startValue = 0;
    let startY = 0;
    let dragStartValue = null;

    input.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.shiftKey && !this.expressionSystem.isExpression(input.value)) {
        isDragging = true;
        startValue = parseFloat(input.value) || 0;
        dragStartValue = startValue;
        startY = e.clientY;
        
        e.preventDefault();
        e.stopPropagation();

        const onMouseMove = (e) => {
          if (!isDragging) return;
          
          const deltaY = startY - e.clientY;
          const sensitivity = e.ctrlKey ? 0.001 : e.altKey ? 0.1 : 0.01;
          const newValue = startValue + deltaY * sensitivity;
          
          input.value = param.type === 'int' ? Math.round(newValue).toString() : newValue.toFixed(3);
          
          // Update immediately without undo recording
          const oldUndoManager = valueManager.undoManager;
          valueManager.undoManager = null;
          valueManager.setValue(node, param.name, input.value);
          onChange(`Drag Parameter: ${param.name}`);
          valueManager.undoManager = oldUndoManager;
          
          e.preventDefault();
        };

        const onMouseUp = () => {
          if (isDragging && dragStartValue !== null) {
            const finalValue = parseFloat(input.value) || 0;
            if (this.undoManager && Math.abs(dragStartValue - finalValue) > 0.001) {
              this.undoManager.recordParameterChange(node.id, param.name, dragStartValue, finalValue);
            }
          }
          
          isDragging = false;
          dragStartValue = null;
          document.body.style.cursor = '';
          
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        document.body.style.cursor = 'ns-resize';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    });

    // Add drag hint to tooltip
    const currentTitle = input.title || '';
    input.title = currentTitle + (currentTitle ? '\n' : '') + 
                 'Shift+drag to adjust value (Ctrl: fine, Alt: coarse)';
  }



  updateExpressionDisplay(input, resultDisplay, param, node, valueManager) {
    const value = input.value;
    
    if (this.expressionSystem.isExpression(value)) {
      // Update input styling for expression
      input.style.fontFamily = 'monospace';
      input.style.backgroundColor = '#2a2a3e';
      input.style.color = '#a8e6cf';
      input.classList.add('has-expression');
      
      // Validate and show result
      const validation = this.expressionSystem.validateExpression(value, {}, node);
      
      if (validation.valid) {
        input.style.borderColor = '#4CAF50';
        resultDisplay.textContent = `→ ${validation.result}`;
        resultDisplay.style.color = '#4CAF50';
      } else {
        input.style.borderColor = '#f44336';
        resultDisplay.textContent = `Error: ${validation.error}`;
        resultDisplay.style.color = '#f44336';
      }
    } else {
      // Reset styling for normal value
      input.style.fontFamily = 'inherit';
      input.style.backgroundColor = '#333';
      input.style.color = '#fff';
      input.style.borderColor = '#555';
      input.classList.remove('has-expression');
      
      // Show parsed value
      const parsed = this.expressionSystem.parseValue(value);
      if (parsed !== value) {
        resultDisplay.textContent = `→ ${parsed}`;
        resultDisplay.style.color = '#888';
      } else {
        resultDisplay.textContent = '';
      }
    }
  }

  // Update all active inputs when dependencies change
  updateDependentInputs(nodeId, paramName) {
    this.activeInputs.forEach((inputData, key) => {
      const { input, resultDisplay, param, node, valueManager } = inputData;
      
      // Update if this input might be affected
      if (this.expressionSystem.isExpression(input.value)) {
        this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
      }
    });
  }

  destroy() {
    this.activeInputs.clear();
  }
}

// Enhanced Parameter Value Manager
export class ExpressionParameterValueManager {
  constructor(graph, undoManager, eventSystem, expressionSystem) {
    this.graph = graph;
    this.undoManager = undoManager;
    this.eventSystem = eventSystem;
    this.expressionSystem = expressionSystem;
    
    // Listen for dependency changes
    this.expressionSystem.addDependencyListener((change) => {
      this.handleDependencyChange(change);
    });
  }

// Replace your existing getValue method with this:

getValue(node, paramName) {
  try {
    const rawValue = node.params?.[paramName];
    
    // CRITICAL: Always evaluate expressions when getValue is called
    if (this.expressionSystem.isExpression(rawValue)) {
      console.log(`🔄 Evaluating expression for ${node.id}.${paramName}: ${rawValue}`);
      const result = this.expressionSystem.evaluateExpression(rawValue, {}, node);
      console.log(`✅ Expression result: ${result}`);
      return result;
    }
    
    return this.expressionSystem.parseValue(rawValue);
  } catch (error) {
    console.warn(`Error getting parameter value for ${paramName}:`, error);
    // Return the raw value as fallback
    return node.params?.[paramName];
  }
}

// Fix for ExpressionParameterValueManager.setValue method
// Replace the existing setValue method with this corrected version:

setValue(node, paramName, value) {
  try {
    if (!node.params) node.params = {};
    
    const oldValue = node.params[paramName];
    
    // STORE THE ORIGINAL VALUE/EXPRESSION (don't evaluate here)
    node.params[paramName] = value;  // Store "=sin(time)", not 0.123
    
    // Record for undo
    if (this.undoManager && oldValue !== value) {
      this.undoManager.recordParameterChange(node.id, paramName, oldValue, value);
    }
    
    // Handle special cases for bound parameters
    this.handleBoundParameters(node, paramName, value);
    
    // Clear expression cache for this parameter change
    this.expressionSystem.updateDependencies(node.id, paramName, value);
    
    // UPDATE PREVIEW IMMEDIATELY
    this.updateNodePreview(node);
    
    // Emit event
    if (this.eventSystem) {
      this.eventSystem.emit('PARAMETER_CHANGED', {
        node,
        parameterName: paramName,
        oldValue,
        newValue: value,
        source: 'user'
      });
    }
    
  } catch (error) {
    console.error(`Error setting parameter ${paramName}:`, error);
  }
}




// Replace your updateNodePreview method with this enhanced version:

updateNodePreview(node) {
  try {
    console.log(`🎯 Updating preview for node: ${node.id} (${node.kind})`);
    
    // CRITICAL: Force evaluation of all expressions in this node BEFORE preview
    if (node.params) {
      Object.entries(node.params).forEach(([paramName, value]) => {
        if (this.expressionSystem.isExpression(value)) {
          console.log(`🔄 Pre-evaluating expression: ${paramName} = ${value}`);
          try {
            const result = this.expressionSystem.evaluateExpression(value, {}, node);
            console.log(`✅ Expression ${paramName} evaluated to: ${result}`);
          } catch (error) {
            console.warn(`❌ Expression evaluation failed for ${paramName}:`, error);
          }
        }
      });
    }
    
    // Clear preview cache for this specific node
    if (window.editor?.previewSystem?.canvasManager) {
      window.editor.previewSystem.canvasManager.canvasCache.delete(node.id);
      console.log(`🗑️ Cleared canvas cache for node: ${node.id}`);
    }
    
    // Force immediate preview regeneration
    if (window.editor?.previewIntegration) {
      console.log(`🚀 Generating preview for node: ${node.id}`);
      window.editor.previewIntegration.generateNodePreview(node);
    }
    
    // DEBOUNCE editor.draw() - prevent spam during drag
    if (this._drawDebounceTimeout) {
      clearTimeout(this._drawDebounceTimeout);
    }
    
    this._drawDebounceTimeout = setTimeout(() => {
      if (window.editor?.draw) {
        window.editor.draw();
        console.log(`🎨 Editor redrawn after preview update for: ${node.id}`);
      }
    }, 50); // Batch draws that happen within 50ms
    
  } catch (error) {
    console.warn(`Error updating preview for node ${node.id}:`, error);
  }
}
  handleBoundParameters(node, paramName, value) {
    // Handle specific node type bindings
    if (node.kind === 'CircleField' && paramName === 'radius') {
      const radiusInputId = node.inputs?.[0];
      if (radiusInputId) {
        const radiusNode = this.graph.nodes.find(n => n.id === radiusInputId);
        if (radiusNode && radiusNode.kind === 'ConstFloat') {
          const numericValue = parseFloat(value);
          const safeValue = isNaN(numericValue) ? 0 : numericValue;
          
          radiusNode.value = safeValue;
          if (!radiusNode.params) radiusNode.params = {};
          radiusNode.params.value = safeValue;
          
          // Update previews for both nodes
          this.updateNodePreview(radiusNode);
          this.updateNodePreview(node);
        }
      }
    }
  }

  handleDependencyChange(change) {
    // Invalidate cache and update dependent nodes
    const { nodeId, paramName, newValue } = change;
    
    // Find nodes that might depend on this change
    this.graph.nodes.forEach(node => {
      if (node.params) {
        Object.entries(node.params).forEach(([key, value]) => {
          if (this.expressionSystem.isExpression(value)) {
            // This is a simple check - could be enhanced with proper dependency tracking
            if (value.includes(paramName) || value.includes(nodeId)) {
              this.updateNodePreview(node);
            }
          }
        });
      }
    });
  }

  getNodeParameterValue(node, paramName, defaultValue) {
    return this.getValue(node, paramName) ?? defaultValue;
  }

  updateNodeParameter(node, paramName, value, onChange) {
    this.setValue(node, paramName, value);
    if (onChange) onChange(`Update ${paramName}`);
  }

  hasConnectedInput(node, paramName) {
    // Check if parameter has a connected input
    const inputSlots = node.inputs || [];
    const paramDef = node.parameterDefinitions?.find(p => p.name === paramName);
    
    if (paramDef && paramDef.inputSlot !== undefined) {
      return inputSlots[paramDef.inputSlot] !== null;
    }
    
    return false;
  }
}

// Create global instances
export const expressionSystem = new ParameterExpressionSystem();

// Start animation loop immediately when the module loads
expressionSystem.startAnimationLoop();
// CSS styles for expression support
export const expressionStyles = `
.expression-input-container {
  position: relative;
  margin-bottom: 4px;
}

.expression-capable.has-expression {
  border-color: #4CAF50 !important;
  box-shadow: 0 0 3px rgba(76, 175, 80, 0.3);
}

.expression-capable.has-expression:invalid {
  border-color: #f44336 !important;
  box-shadow: 0 0 3px rgba(244, 67, 54, 0.3);
}

.expression-helper-btn {
  background: #4CAF50;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 9px;
  font-weight: bold;
  transition: background-color 0.2s;
}

.expression-helper-btn:hover {
  background: #45a049;
}

.expression-result {
  font-size: 10px;
  color: #888;
  margin-top: 2px;
  font-style: italic;
  min-height: 12px;
  padding-left: 2px;
}

.param-input {
  transition: all 0.2s ease;
}

.param-input:focus {
  outline: none;
  box-shadow: 0 0 5px rgba(74, 144, 226, 0.3);
}

/* Drag cursor for numeric inputs */
.param-input[data-param-type="float"]:hover,
.param-input[data-param-type="int"]:hover {
  cursor: grab;
}

.param-input[data-param-type="float"]:active,
.param-input[data-param-type="int"]:active {
  cursor: grabbing;
}
`;