// src/utils/ParameterExpressionSystem.js - Complete implementation with preview updates

import { getAudioEnvelope } from '../audio/BrowserAudioCapture.js';
import { unifiedExpressionSystem } from './UnifiedExpressionSystem.js';

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
   * Get the effective parameter value, checking timeline first if enabled
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {*} defaultValue - Default value from node.params
   * @returns {*} The effective parameter value (timeline or default)
   */
  getEffectiveParameterValue(nodeId, paramName, defaultValue) {
    // Check if timeline is enabled and has a value for this parameter
    if (window.timelineManager && window.timelineManager.isEnabled()) {
      const timelineValue = window.timelineManager.getEvaluatedValue(nodeId, paramName);
      if (timelineValue !== null) {
        return timelineValue;
      }
    }

    // Fall back to default value (which may be an expression or static value)
    return defaultValue;
  }

  /**
   * Evaluates a parameter expression with comprehensive error handling
   */
  evaluateExpression(expression, context = {}, node = null) {
    try {
      if (!this.isExpression(expression)) {
        return this.parseValue(expression);
      }
  if ((expression.includes('time') || expression.includes('audioEnvelope')) && node) {
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

      // Skip caching for time-dependent expressions (they change every frame)
      const isTimeDep = cleanExpression.includes('time') || cleanExpression.includes('audioEnvelope') || cleanExpression.includes('frame');

      // Check cache first (only for non-time-dependent expressions)
      if (!isTimeDep) {
        const cacheKey = this.getCacheKey(cleanExpression, context, node);
        if (this.expressionCache.has(cacheKey)) {
          const cached = this.expressionCache.get(cacheKey);
          if (this.isContextValid(cached.context, context)) {
            return cached.result;
          }
        }
      }

      // Build evaluation context
      const evalContext = this.buildEvaluationContext(context, node);

      // Evaluate the expression
      const result = this.safeEvaluate(cleanExpression, evalContext);

      // Cache the result (only for non-time-dependent expressions)
      if (!isTimeDep) {
        const cacheKey = this.getCacheKey(cleanExpression, context, node);
        this.expressionCache.set(cacheKey, {
          result,
          context: { ...context },
          timestamp: Date.now()
        });
      }

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
  return cacheKey.includes('time') || cacheKey.includes('frame') || cacheKey.includes('audioEnvelope');
}

updateTimeBasedPreviews() {
  // DISABLED: This was causing infinite preview generation spam
  // TODO: Implement proper time-based preview updates without spam
  return;

  // if (!window.editor?.graph?.nodes) return;

  // window.editor.graph.nodes.forEach(node => {
  //   if (node.params) {
  //     const hasTimeExpression = Object.values(node.params).some(value =>
  //       typeof value === 'string' && (value.includes('time') || value.includes('audioEnvelope'))
  //     );

  //     if (hasTimeExpression && window.editor.previewIntegration) {
  //       window.editor.previewIntegration.generateNodePreview(node);
  //     }
  //   }
  // });
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
    get time() { return performance.now() / 1000; },
    get frame() { return 0; }, // Can be updated by animation system
    get audioEnvelope() {
      const value = getAudioEnvelope();
      console.log('[ExpressionSystem] audioEnvelope getter called, value:', value);
      return value;
    }, // Real-time audio envelope value

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

  // Add node output values from the graph
  this._addNodeOutputReferences(evalContext, node);

  console.log('[ExpressionSystem] Built evalContext, audioEnvelope available:', 'audioEnvelope' in evalContext);
  return evalContext;
}

  /**
   * Adds node output values to the evaluation context
   * Supports syntax like: =node_1, =node_1_x, =node_1_y, etc.
   */
  _addNodeOutputReferences(evalContext, currentNode) {
    // Get the graph from the editor
    const graph = window.editor?.graph;
    if (!graph || !graph.nodes) return;

    // Get computed values from PreviewComputer if available
    const previewComputer = window.editor?.previewComputer;

    // For each node in the graph, add its output value
    graph.nodes.forEach(node => {
      // Don't reference the current node to avoid circular dependencies
      if (node.id === currentNode?.id) return;

      // Get the node's computed value
      let nodeValue = node.__preview;

      // Try to get from PreviewComputer if available
      if (previewComputer && previewComputer.lastComputedValues) {
        const computedValue = previewComputer.lastComputedValues.get(node.id);
        if (computedValue !== undefined) {
          nodeValue = computedValue;
        }
      }

      if (nodeValue === undefined || nodeValue === null) return;

      // Add the full node output value as node_X
      const nodeVarName = `node_${node.id}`;

      // If it's a number or array, add it directly
      if (typeof nodeValue === 'number') {
        evalContext[nodeVarName] = nodeValue;
      } else if (Array.isArray(nodeValue)) {
        // Add the full array
        evalContext[nodeVarName] = nodeValue;

        // Also add component accessors for vectors
        if (nodeValue.length >= 1) evalContext[`${nodeVarName}_x`] = nodeValue[0];
        if (nodeValue.length >= 2) evalContext[`${nodeVarName}_y`] = nodeValue[1];
        if (nodeValue.length >= 3) evalContext[`${nodeVarName}_z`] = nodeValue[2];
        if (nodeValue.length >= 4) evalContext[`${nodeVarName}_w`] = nodeValue[3];
      } else if (typeof nodeValue === 'object' && nodeValue.type === 'split') {
        // Handle split node outputs
        evalContext[nodeVarName] = nodeValue.values;
        nodeValue.values.forEach((val, idx) => {
          const component = ['x', 'y', 'z', 'w'][idx];
          if (component) evalContext[`${nodeVarName}_${component}`] = val;
        });
      }
    });
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

    // Validate expression for basic safety
    if (this.containsUnsafeCode(expression)) {
      throw new Error('Unsafe code detected in expression');
    }

    // USE UNIFIED AST SYSTEM - Single source of truth for expression evaluation
    // This ensures CPU evaluation matches shader generation exactly
    const result = unifiedExpressionSystem.evaluateCPU(expression, context);

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
    return [...new Set(matches)].filter(match => {
      // Allow node references (node_X pattern)
      if (match.startsWith('node_')) return true;

      // Filter out built-in functions and constants
      return !this.builtInFunctions.hasOwnProperty(match) &&
        !['PI', 'E', 'true', 'false', 'time', 'frame', 'audioEnvelope'].includes(match);
    });
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

    // MIDI value display throttling
    this.midiUpdatePending = false;
    this.pendingMidiUpdates = new Map();
    this.lastMidiUpdateTime = 0;
    this.midiUpdateThrottle = 50; // ms - max 20 updates/sec
  }

create(param, node, div, label, valueManager, onChange) {
  try {
    const container = this.createContainer();
    const input = this.createInput(param, node, valueManager);
    // REMOVE THIS LINE:
    // const helperButton = this.createExpressionHelper(input, param, node, valueManager, onChange);
    const resultDisplay = this.createResultDisplay();

    const key = `${node.id}_${param.name}`;
    const tabState = this._ensureTabState(node, param.name, input.value);
    input.dataset.expressionTab = tabState.active;
    if (tabState.active !== 'main') {
      input.value = tabState.values[tabState.active] ?? '';
      this._autoResizeTextArea(input);
    }

    const entry = {
      input,
      resultDisplay,
      param,
      node,
      valueManager,
      onChange,
      lastValue: String(input.value).trim(),
      tabState,
    };
    this.activeInputs.set(key, entry);

    // Setup event handlers
    this.setupEventHandlers(
      input,
      param,
      node,
      valueManager,
      onChange,
      resultDisplay,
      entry,
    );
    this.setupNumericDragSupport(input, param, node, valueManager, onChange, entry);

    // Initial validation and display update
    this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);

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
    const input = document.createElement('textarea');
    input.className = 'param-input expression-capable';
    input.setAttribute('data-param', param.name);
    input.setAttribute('data-param-type', param.type);
    input.setAttribute('rows', '1');
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    
    const currentValue = node.params?.[param.name] ?? param.default ?? '';
    input.value = String(currentValue);

    input.style.cssText = `
      width: 100%;
      min-height: 28px;
      max-height: 200px;
      padding: 6px;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.4;
      box-sizing: border-box;
      resize: vertical;
      overflow-y: auto;
    `;

    input.style.fontFamily = this.expressionSystem.isExpression(currentValue)
      ? 'monospace'
      : 'inherit';

    input.placeholder =
      param.type === 'float'
        ? 'Number or =expression (e.g., =audioEnvelope)'
        : param.type === 'int'
        ? 'Integer or =expression'
        : 'Value or =expression';

    this._autoResizeTextArea(input);
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

  _autoResizeTextArea(input) {
    if (!input) return;

    input.style.height = 'auto';
    const minHeight = 28;
    const maxHeight = 200;
    const newHeight = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight || minHeight));
    input.style.height = `${newHeight}px`;
  }

  _ensureTabState(node, paramName, initialValue = '') {
    if (!node) {
      return {
        active: 'main',
        values: { main: initialValue ?? '', custom: '' },
      };
    }

    if (!Object.prototype.hasOwnProperty.call(node, '_expressionTabs')) {
      Object.defineProperty(node, '_expressionTabs', {
        value: {},
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }

    const store = node._expressionTabs;
    if (!store[paramName]) {
      store[paramName] = {
        active: 'main',
        values: {
          main: typeof initialValue === 'string' ? initialValue : String(initialValue ?? ''),
          custom: '',
        },
      };
    } else if (typeof initialValue === 'string') {
      const tabState = store[paramName];
      if (!tabState.values) {
        tabState.values = { main: '', custom: '' };
      }
      const activeTab = tabState.active || 'main';
      tabState.values[activeTab] = initialValue;
    }

    return store[paramName];
  }

  _storeTabValue(entry, tab, value) {
    if (!entry?.tabState?.values) return;
    entry.tabState.values[tab] = value;
  }

  _commitValue(entry, rawValue, param, node, valueManager, onChange, inputElement = null) {
    if (!entry) return false;

    const activeTab = entry.tabState?.active || 'main';
    let value = typeof rawValue === 'string' ? rawValue.trim() : '';

    if (this.isIncomplete(value)) {
      return false;
    }

    // Auto-add = prefix for expressions
    let wasModified = false;
    if (value && !value.startsWith('=') && this._looksLikeExpression(value)) {
      value = '=' + value;
      wasModified = true;
      console.log(`[ExpressionInput] Auto-added = prefix: "${rawValue.trim()}" → "${value}"`);

      // Update the input element to show the = prefix
      if (inputElement) {
        inputElement.value = value;
      }
    }

    if (entry.lastValue === value) {
      return false;
    }

    valueManager.setValue(node, param.name, value);
    this.expressionSystem.updateDependencies(node.id, param.name, value);
    this._storeTabValue(entry, activeTab, value);
    entry.lastValue = value;

    if (typeof onChange === 'function') {
      onChange(`Parameter Change: ${param.name}`);
    }

    return true;
  }

  _looksLikeExpression(value) {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();

    // Already has = prefix
    if (trimmed.startsWith('=')) return false;

    // Contains function calls like sin(, cos(, etc.
    if (/[a-zA-Z_]\w*\s*\(/.test(trimmed)) return true;

    // Contains common expression keywords
    const keywords = ['time', 'frame', 'node_', 'audioEnvelope', 'PI', 'E'];
    if (keywords.some(kw => trimmed.includes(kw))) return true;

    // Contains operators (but not just a negative number or incomplete number being typed)
    // Allow "-", "-2", "-2.5", etc. by making digits optional with \d* instead of \d+
    if (/[+\-*/]/.test(trimmed) && !/^-?\d*\.?\d*$/.test(trimmed)) return true;

    return false;
  }

  _toggleExpressionTab(entry, input, param, node, valueManager, onChange, resultDisplay) {
    if (!entry) return;

    if (!entry.tabState) {
      entry.tabState = this._ensureTabState(node, param.name, input.value);
    }

    const currentTab = entry.tabState.active || 'main';
    const nextTab = currentTab === 'main' ? 'custom' : 'main';

    this._storeTabValue(entry, currentTab, input.value);
    entry.tabState.active = nextTab;
    input.dataset.expressionTab = nextTab;

    const nextValue = entry.tabState.values?.[nextTab] ?? '';
    if (input.value !== nextValue) {
      input.value = nextValue;
      this._autoResizeTextArea(input);
    }

    if (this._commitValue(entry, input.value, param, node, valueManager, onChange, input)) {
      this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
    } else {
      this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
    }
  }

  _insertNewLine(input) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const value = input.value;
    input.value = `${value.slice(0, start)}\n${value.slice(end)}`;
    const caret = start + 1;
    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(caret, caret);
    }
    this._autoResizeTextArea(input);
  }

  setupEventHandlers(input, param, node, valueManager, onChange, resultDisplay, entry) {
    let inputTimer = null;
    const state =
      entry ||
      {
        lastValue: String(input.value),
        tabState: this._ensureTabState(node, param.name, input.value),
      };

    if (!state.tabState) {
      state.tabState = this._ensureTabState(node, param.name, input.value);
    }

    // Prevent keyboard events from bubbling to editor
    input.addEventListener('keydown', (e) => {
      if (['Delete', 'Backspace', 'Enter', 'Tab'].includes(e.key)) {
        e.stopPropagation();
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this._insertNewLine(input);
          this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
        } else {
          if (inputTimer) {
            clearTimeout(inputTimer);
            inputTimer = null;
          }

          if (this._commitValue(state, input.value, param, node, valueManager, onChange, input)) {
            this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (inputTimer) {
          clearTimeout(inputTimer);
          inputTimer = null;
        }
        this._toggleExpressionTab(state, input, param, node, valueManager, onChange, resultDisplay);
      }
    });

    // Focus handling
    input.addEventListener('focus', () => {
      state.lastValue = String(input.value);
      this._autoResizeTextArea(input);
    });

    // Real-time input handling with debouncing
    input.addEventListener('input', (e) => {
      e.stopPropagation();

      // Auto-complete: if user types "node_", add "=" prefix
      const value = input.value;
      if (value && !value.startsWith('=') && value.trim().startsWith('node_')) {
        const cursorPos = input.selectionStart;
        input.value = '=' + value;
        // Adjust cursor position
        input.setSelectionRange(cursorPos + 1, cursorPos + 1);
      }

      this._autoResizeTextArea(input);

      this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);

      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }

      inputTimer = setTimeout(() => {
        if (
          !this.isIncomplete(input.value) &&
          this._commitValue(state, input.value, param, node, valueManager, onChange, input)
        ) {
          this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
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

      if (
        !this.isIncomplete(input.value) &&
        this._commitValue(state, input.value, param, node, valueManager, onChange, input)
      ) {
        this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
      }
    });

    // Prevent click propagation
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  setupNumericDragSupport(input, param, node, valueManager, onChange, entry) {
    if (param.type !== 'float' && param.type !== 'int') return;

    let isDragging = false;
    let startValue = 0;
    let startY = 0;
    let dragStartValue = null;
    const resultDisplay = entry?.resultDisplay;

    input.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.shiftKey && !this.expressionSystem.isExpression(input.value)) {
        isDragging = true;
        startValue = parseFloat(input.value) || 0;
        dragStartValue = startValue;
        startY = e.clientY;

        // PERFORMANCE: Signal that parameter drag is active
        if (window.editor) {
          window.editor._parameterDragging = true;
        }

        e.preventDefault();
        e.stopPropagation();

        // Throttle shader rebuilds during drag to avoid performance issues
        let lastRebuildTime = 0;
        const REBUILD_THROTTLE_MS = 33; // ~30fps max rebuild rate

        const onMouseMove = (e) => {
          if (!isDragging) return;

          const deltaY = startY - e.clientY;
          const sensitivity = e.ctrlKey ? 0.001 : e.altKey ? 0.1 : 0.01;
          const newValue = startValue + deltaY * sensitivity;

          input.value = param.type === 'int' ? Math.round(newValue).toString() : newValue.toFixed(3);
          // PERFORMANCE: Skip _autoResizeTextArea during drag (causes DOM reflows)
          // this._autoResizeTextArea(input);

          // PERFORMANCE: Update uniforms directly without shader rebuild
          // This updates the uniform manager values which GPU reads each frame
          // NO rebuild during drag = 60fps smooth dragging + real-time visual updates
          if (!node.params) node.params = {};
          node.params[param.name] = input.value;

          // Update GPU uniforms immediately
          if (typeof window.updateUniformsOnly === 'function') {
            window.updateUniformsOnly(node.id, param.name, input.value);
          }

          e.preventDefault();
        };

        const onMouseUp = () => {
          // PERFORMANCE: Clear drag flag to resume normal rendering
          if (window.editor) {
            window.editor._parameterDragging = false;
          }

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

          // PERFORMANCE: Apply full update on mouseup with all expensive operations
          // This triggers expression dependencies, preview updates, and events
          if (entry) {
            this._commitValue(entry, input.value, param, node, valueManager, onChange, input);
            if (resultDisplay) {
              this.updateExpressionDisplay(input, resultDisplay, param, node, valueManager);
            }
          }

          // Final shader rebuild after drag ends to ensure final value is compiled
          if (typeof window.rebuild === 'function') {
            window.rebuild();
          }
          if (typeof window.render === 'function') {
            window.render();
          }
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

  /**
   * Update input display for MIDI-controlled parameter
   * Shows the changing value in real-time without disrupting user input
   */
  updateMIDIValueDisplay(nodeId, paramName, newValue) {
    const key = `${nodeId}_${paramName}`;

    // Store the latest value
    this.pendingMidiUpdates.set(key, { nodeId, paramName, newValue });

    // Throttle updates to avoid excessive DOM operations
    const now = performance.now();
    if (now - this.lastMidiUpdateTime < this.midiUpdateThrottle) {
      // Schedule update if not already scheduled
      if (!this.midiUpdatePending) {
        this.midiUpdatePending = true;
        requestAnimationFrame(() => {
          this._performPendingMidiUpdates();
        });
      }
      return;
    }

    // Update immediately if enough time has passed
    this._performPendingMidiUpdates();
  }

  _performPendingMidiUpdates() {
    // Process all pending MIDI value updates
    for (const [key, { nodeId, paramName, newValue }] of this.pendingMidiUpdates.entries()) {
      const inputData = this.activeInputs.get(key);
      if (!inputData) continue; // Input not currently visible

      const { input, resultDisplay } = inputData;

      // Don't update if user is currently editing the input
      if (document.activeElement === input) {
        continue;
      }

      // Format the value nicely
      let displayValue = newValue;
      if (typeof newValue === 'number') {
        // Round to 4 decimal places for display
        displayValue = Math.round(newValue * 10000) / 10000;
      }

      // Update the input value
      const newValueStr = String(displayValue);
      if (input.value !== newValueStr) {
        input.value = newValueStr;
        this._autoResizeTextArea(input);
      }

      // Update the result display to show real-time MIDI feedback
      if (resultDisplay) {
        resultDisplay.textContent = `🎹 ${displayValue}`;
        resultDisplay.style.color = '#FFD700'; // Gold color for MIDI

        // Clear the MIDI indicator after a short delay
        clearTimeout(inputData.midiIndicatorTimeout);
        inputData.midiIndicatorTimeout = setTimeout(() => {
          if (resultDisplay.textContent.startsWith('🎹')) {
            resultDisplay.textContent = '';
          }
        }, 1000);
      }

      // Update styling to indicate normal value (not expression)
      input.style.fontFamily = 'inherit';
      input.style.backgroundColor = '#333';
      input.style.color = '#fff';
      input.style.borderColor = '#555';
      input.classList.remove('has-expression');
    }

    // Clear pending updates and reset state
    this.pendingMidiUpdates.clear();
    this.lastMidiUpdateTime = performance.now();
    this.midiUpdatePending = false;
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
  console.log("[ParameterExpressionSystem.setValue] CALLED:", node.kind, node.id, paramName, "value:", value, "type:", typeof value);
  try {
    if (!node.params) node.params = {};

    const oldValue = node.params[paramName];
    console.log("[ParameterExpressionSystem.setValue] oldValue:", oldValue, "newValue:", value);

    // STORE THE ORIGINAL VALUE/EXPRESSION (don't evaluate here)
    node.params[paramName] = value;  // Store "=sin(time)", not 0.123
    console.log("[ParameterExpressionSystem.setValue] STORED on node.params[" + paramName + "]:", node.params[paramName]);
    
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
    console.log(`📊 Current node.params.value:`, node.params?.value, `node.value:`, node.value);

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
        if (window.editor.markDirty) window.editor.markDirty('expression-preview-update');
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
