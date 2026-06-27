// src/core/preview/NodeValueComputer.js

export class NodeValueComputer {
  constructor(editor) {
    this.editor = editor;
    this.maxRecursionDepth = 50; // Prevent stack overflow
    
    // Cache storage: Map<nodeId, { value, inputHash, paramHash }>
    this._valueCache = new Map();
    
    // Track last input hashes per node for invalidation
    this._lastInputHashes = new Map();
    
    // Track last parameter hashes per node for invalidation
    this._lastParamHashes = new Map();
  }

  // Kinds whose value is derived from live external state (the wall clock, cursor, or render
  // size) rather than from inputs or parameters. Their output changes on its own — e.g. on a
  // window resize for Resolution — so caching them would serve a stale value, and they must
  // recompute every call.
  _isTimeDependentKind(node) {
    const kind = node?.kind?.toLowerCase();
    return kind === 'time' ||
           kind === 'randomtime' ||
           kind === 'mouse' ||
           kind === 'resolution' ||
           kind === 'stripe' ||
           kind === 'stripefield' ||
           kind === 'checker' ||
           kind === 'checkerfield';
  }

  computeNodeValue(node, visited = new Set()) {
    try {
      if (!node || !node.id) {
        throw new Error('Invalid node for computation');
      }

      if (visited.has(node.id)) {
        window.errorHandler?.handleError(
          new Error(`Circular dependency detected for node ${node.kind} (${node.id})`),
          { component: 'node-computation', nodeId: node.id, nodeKind: node.kind }
        );
        return 0;
      }

      if (visited.size > this.maxRecursionDepth) {
        throw new Error('Maximum recursion depth exceeded');
      }

      // Clock-driven nodes (Time, RandomTime, animated fields) derive their value from Date.now(),
      // not from their inputs/params. Since the cache is keyed on input/param hashes — which never
      // change for these nodes — a cache hit would freeze them at their first computed value. Skip
      // the cache entirely so they recompute with the current time on every call.
      const timeDependent = this._isTimeDependentKind(node);

      // Check cache before computing
      if (!timeDependent) {
        const cachedValue = this._getCachedValue(node);
        if (cachedValue !== null) {
          return cachedValue;
        }

        // Check PreviewComputer cache if available
        const previewCacheValue = this._getPreviewComputerCacheValue(node);
        if (previewCacheValue !== null) {
          // Store in local cache for future use
          this._setCachedValue(node, previewCacheValue);
          return previewCacheValue;
        }
      }

      visited.add(node.id);

      let result;

      switch (node.kind.toLowerCase()) {
        case "stripe":
case "stripefield": {
  const freq = this._getParameter(node, "frequency") || 5.0;
  const thick = this._getParameter(node, "thickness") || 0.5;
  const val = Math.sin(Date.now() / 200 + freq) > (1.0 - thick) ? 1.0 : 0.0;
  result = val;
  break;
}

case "checker":
case "checkerfield": {
  const sx = this._getParameter(node, "scaleX") || 8.0;
  const sy = this._getParameter(node, "scaleY") || 8.0;
  const u = Math.floor((Date.now()/1000) * sx) % 2;
  const v = Math.floor((Date.now()/1000) * sy) % 2;
  result = (u + v) % 2 === 0 ? 1.0 : 0.0;
  break;
}

        case "constvec3":
        case "vec3": {
          const x = this._getParameter(node, "x") || 0;
          const y = this._getParameter(node, "y") || 0;
          const z = this._getParameter(node, "z") || 0;
          result = [x, y, z];
          break;
        }

        case "constfloat":
        case "float":
          result = this._getParameter(node, "value") || 0;
          break;

        case "time":
          result = (Date.now() / 1000) % 1;
          break;

        case "randomtime": {
          const speed = this._getParameter(node, "speed") || 1.0;
          const t = (Date.now() / 1000) * speed;
          result = Math.abs(Math.sin(t * 12.9898) * 43758.5453) % 1.0;
          break;
        }

        case "uv":
          result = 0.5;
          break;

        case "resolution": {
          // Live render dimensions, mirroring g.resolution written by the GPU
          // renderer each frame (canvas.width/height). Base value is the vec2.
          const rc = (typeof window !== "undefined" && window.gpuRenderer?.canvas) || null;
          const w = Math.max(1, (rc && rc.width) || 1);
          const h = Math.max(1, (rc && rc.height) || 1);
          result = [w, h];
          break;
        }

        case "mouse": {
          // Live cursor state tracked by the GPU renderer (iMouse layout):
          // xy = position (normalized 0..1), z = held, w = click.
          const m = (typeof window !== "undefined" && window._mousePosition) || null;
          result = m ? [m[0], m[1], m[2] || 0, m[3] || 0] : [0.5, 0.5, 0, 0];
          break;
        }


        case "multiply": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = inputs.a !== undefined ? inputs.a : 1;
          const b = inputs.b !== undefined ? inputs.b : 1;
          result = this._safeMath(() => a * b, 0);
          break;
        }

        case "add": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = inputs.a !== undefined ? inputs.a : 0;
          const b = inputs.b !== undefined ? inputs.b : 0;
          result = this._safeMath(() => a + b, 0);
          break;
        }

        case "divide": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = inputs.a !== undefined ? inputs.a : 1;
          const b = inputs.b !== undefined ? inputs.b : 1;
          result = this._safeMath(() => b !== 0 ? a / b : 0, 0);
          break;
        }

        case "subtract": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = inputs.a !== undefined ? inputs.a : 0;
          const b = inputs.b !== undefined ? inputs.b : 0;
          result = this._safeMath(() => a - b, 0);
          break;
        }

case "circle":
case "circlefield": {
  const inputs = this.getConnectedInputs(node, visited);
  
  // Parameters first, inputs can override
  let radius = this._getParameter(node, "radius") || 0.25;
  if (inputs.a !== undefined) radius = inputs.a;
  
  result = this._getParameter(node, "radius") || 0.25;
  break;
}case "rectangle":
case "rectanglefield": {
  const inputs = this.getConnectedInputs(node, visited);
  result = this._getParameter(node, "width") || 0.5;
  break;
}
        case "saturate": {
          const inputs = this.getConnectedInputs(node, visited);
          const input = inputs.input || inputs.a || 0;
          result = this._safeMath(() => Math.max(0, Math.min(1, input)), 0);
          break;
        }

        case "dot": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = this._toVec3(inputs.a || [1, 0, 0]);
          const b = this._toVec3(inputs.b || [0, 1, 0]);
          result = this._safeMath(() => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], 0);
          break;
        }

        case "cross": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = this._toVec3(inputs.a || [1, 0, 0]);
          const b = this._toVec3(inputs.b || [0, 1, 0]);
          result = this._safeMath(() => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ], [0, 0, 0]);
          break;
        }

        case "normalize": {
          const inputs = this.getConnectedInputs(node, visited);
          const vec = this._toVec3(inputs.vec || inputs.a || [1, 0, 0]);
          const length = this._safeMath(() => Math.sqrt(
            vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]
          ), 1);
          
          if (length > 1e-6) {
            result = this._safeMath(() => [vec[0] / length, vec[1] / length, vec[2] / length], [0, 0, 0]);
          } else {
            result = [0, 0, 0];
          }
          break;
        }

        case "length": {
          const inputs = this.getConnectedInputs(node, visited);
          const vec = this._toVec3(inputs.vec || inputs.a || [1, 1, 0]);
          result = this._safeMath(() => Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]), 0);
          break;
        }

        case "distance": {
          const inputs = this.getConnectedInputs(node, visited);
          const a = this._toVec3(inputs.a || [0, 0, 0]);
          const b = this._toVec3(inputs.b || [0, 0, 0]);
          const diff = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          result = this._safeMath(() => Math.sqrt(
            diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]
          ), 0);
          break;
        }

        default:
          result = 0;
      }

      // Store computed value in cache (but never for clock-driven nodes — caching them would
      // serve a stale value next frame since their input/param hashes don't change over time).
      if (!timeDependent) {
        this._setCachedValue(node, result);

        // Also update PreviewComputer cache if available
        this._updatePreviewComputerCache(node, result);
      }

      visited.delete(node.id);
      return result;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-value-computation',
        nodeId: node?.id,
        nodeKind: node?.kind
      });
      
      // Clean up visited set
      if (node?.id) {
        visited.delete(node.id);
      }
      return 0;
    }
  }

  getConnectedInputs(node, visited = new Set()) {
    try {
      const inputs = {};

      if (!this.editor.graph?.connections || !node?.id) return inputs;

      for (const conn of this.editor.graph.connections) {
        try {
          if (conn.to.nodeId === node.id) {
            const sourceNode = this.editor.graph.nodes.find(
              (n) => n.id === conn.from.nodeId
            );
            
            if (sourceNode) {
              const value = this.computeNodeValue(sourceNode, visited);
              const pinIndex = conn.to.pin;

              let inputName;
              if (pinIndex === 0) {
                inputName = "a";
              } else if (pinIndex === 1) {
                inputName = "b";
              } else if (pinIndex === 2) {
                inputName = "c";
              } else {
                inputName = `input${pinIndex}`;
              }

              inputs[inputName] = value;

              // Add common aliases
              if (pinIndex === 0) {
                inputs.input = value;
                inputs.value = value;
                inputs.vec = value;
                inputs.i = value;
              }
              if (pinIndex === 1) {
                inputs.n = value;
              }
              if (pinIndex === 2) {
                inputs.eta = value;
              }
            }
          }
        } catch (connError) {
          // Skip individual connection errors, continue processing others

        }
      }

      return inputs;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connected-inputs-computation',
        nodeId: node?.id
      });
      return {};
    }
  }

_getParameter(node, name) {
  try {
    return node.params?.[name] || node[name] || node.props?.[name] || 0;
  } catch (error) {
    return 0;
  }
}

  _toVec3(input) {
    try {
      if (Array.isArray(input)) {
        if (input.length >= 3) return [input[0] || 0, input[1] || 0, input[2] || 0];
        if (input.length === 2) return [input[0] || 0, input[1] || 0, 0];
        if (input.length === 1) return [input[0] || 0, input[0] || 0, input[0] || 0];
      }
      if (typeof input === "number" && Number.isFinite(input)) {
        return [input, input, input];
      }
      return [0, 0, 0];
    } catch (error) {
      return [0, 0, 0];
    }
  }

  _safeMath(operation, fallback) {
    try {
      const result = operation();
      
      if (Array.isArray(result)) {
        // Check each element in array
        for (let i = 0; i < result.length; i++) {
          if (!Number.isFinite(result[i])) {
            result[i] = 0;
          }
        }
        return result;
      }
      
      return Number.isFinite(result) ? result : fallback;
    } catch (error) {
      return fallback;
    }
  }
// Add this to your NodeValueComputer class:

getNodeParameter(node, paramName, defaultValue = 0) {
  try {
    // Use the editor's value manager if available
    if (this.editor?.paramPanel?.valueManager?.getValue) {
      return this.editor.paramPanel.valueManager.getValue(node, paramName) ?? defaultValue;
    }
    
    // Fallback with expression evaluation
    const rawValue = node.params?.[paramName] ?? defaultValue;
    
    if (typeof rawValue === 'string' && rawValue.trim().startsWith('=')) {
      try {
        const expressionSystem = window.expressionSystem || this.editor?.expressionSystem;
        if (expressionSystem) {
          return expressionSystem.evaluateExpression(rawValue, {}, node);
        }
      } catch (error) {

      }
    }
    
    return typeof rawValue === 'number' ? rawValue : parseFloat(rawValue) || defaultValue;
  } catch (error) {

    return defaultValue;
  }
}

// Update any methods that access node parameters to use this helper:
// Example: Instead of node.params.radius, use this.getNodeParameter(node, 'radius', 1.0)
  _evaluateExpression(expr, vars, nodeId) {
    try {
      if (!expr || typeof expr !== 'string') {
        return 0;
      }

      // Validate expression for dangerous patterns
      if (this._isExpressionDangerous(expr)) {
        throw new Error('Expression contains forbidden patterns');
      }

      let processed = expr;
      
      // Replace variables safely
      for (const [name, value] of Object.entries(vars)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          processed = processed.replace(new RegExp(`\\b${name}\\b`, "g"), value.toString());
        }
      }
      
      // Replace math functions
      processed = processed.replace(/\bsin\b/g, "Math.sin");
      processed = processed.replace(/\bcos\b/g, "Math.cos");
      processed = processed.replace(/\btan\b/g, "Math.tan");
      processed = processed.replace(/\babs\b/g, "Math.abs");
      processed = processed.replace(/\bsqrt\b/g, "Math.sqrt");
      processed = processed.replace(/\bfloor\b/g, "Math.floor");
      processed = processed.replace(/\bceil\b/g, "Math.ceil");
      processed = processed.replace(/\bpow\b/g, "Math.pow");
      processed = processed.replace(/\bmin\b/g, "Math.min");
      processed = processed.replace(/\bmax\b/g, "Math.max");
      processed = processed.replace(/\bpi\b/g, "Math.PI");

      // Use safer evaluation method instead of direct eval
      const result = this._safeEval(processed);
      return Number.isFinite(result) ? result : 0;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'expression-evaluation',
        nodeId,
        expression: expr
      });
      return 0;
    }
  }

  _isExpressionDangerous(expr) {
    const forbidden = [
      'import', 'require', 'eval', 'Function', 'constructor',
      'window', 'document', 'global', 'process', '__proto__',
      'prototype', 'valueOf', 'toString', 'hasOwnProperty',
      'while', 'for', 'do', 'if', 'else', 'switch', 'case',
      'function', '=>', 'return', 'var', 'let', 'const',
      'delete', 'new', 'this', 'alert', 'confirm', 'prompt'
    ];
    
    const lowerExpr = expr.toLowerCase();
    return forbidden.some(keyword => lowerExpr.includes(keyword));
  }

  _safeEval(expression) {
    try {
      // Create a restricted function that only has access to Math
      const func = new Function('Math', `return (${expression});`);
      return func(Math);
    } catch (error) {
      throw new Error(`Expression evaluation failed: ${error.message}`);
    }
  }

  /**
   * Compute hash of node inputs (connected nodes)
   * This includes both direct input connections and parameter references
   */
  _computeInputHash(node) {
    try {
      if (!node || !node.id) {
        return 'no-node';
      }

      const hashParts = [];

      // Add direct input connections
      if (this.editor?.graph?.connections) {
        const inputConnections = this.editor.graph.connections
          .filter(conn => conn.to?.nodeId === node.id)
          .map(conn => `${conn.from?.nodeId || 'null'}:${conn.to?.pin || 0}`)
          .sort();
        hashParts.push(`inputs:${inputConnections.join(',')}`);
      }

      // Add node.inputs array if present
      if (Array.isArray(node.inputs)) {
        hashParts.push(`inputsArray:${node.inputs.map(i => i || 'null').join(',')}`);
      }

      // Add parameter references (for expressions that reference other nodes)
      if (node.params && typeof node.params === 'object') {
        const paramRefs = [];
        for (const [key, value] of Object.entries(node.params)) {
          if (typeof value === 'string' && value.includes('node_')) {
            // Extract node references from parameter expressions
            const nodeRefs = value.match(/node_(\w+)/g) || [];
            if (nodeRefs.length > 0) {
              paramRefs.push(`${key}:${nodeRefs.sort().join(',')}`);
            }
          }
        }
        if (paramRefs.length > 0) {
          hashParts.push(`paramRefs:${paramRefs.sort().join('|')}`);
        }
      }

      return hashParts.length > 0 ? hashParts.join('|') : 'no-inputs';
    } catch (error) {
      return 'hash-error';
    }
  }

  /**
   * Compute hash of node parameters
   */
  _computeParameterHash(node) {
    try {
      if (!node || typeof node.params === 'undefined') {
        return 'no-params';
      }
      return JSON.stringify(node.params);
    } catch (error) {
      return 'param-hash-error';
    }
  }

  /**
   * Get cached value if inputs and parameters haven't changed
   */
  _getCachedValue(node) {
    try {
      if (!node || !node.id) {
        return null;
      }

      const currentInputHash = this._computeInputHash(node);
      const currentParamHash = this._computeParameterHash(node);

      // Check if we have a cached value
      const cached = this._valueCache.get(node.id);
      if (!cached) {
        // No cache entry, store current hashes for next time
        this._lastInputHashes.set(node.id, currentInputHash);
        this._lastParamHashes.set(node.id, currentParamHash);
        return null;
      }

      // Check if inputs or parameters have changed
      const lastInputHash = this._lastInputHashes.get(node.id);
      const lastParamHash = this._lastParamHashes.get(node.id);

      if (currentInputHash !== lastInputHash || currentParamHash !== lastParamHash) {
        // Inputs or parameters changed, invalidate cache
        this._valueCache.delete(node.id);
        this._lastInputHashes.set(node.id, currentInputHash);
        this._lastParamHashes.set(node.id, currentParamHash);
        return null;
      }

      // Cache is valid, return cached value
      return cached.value;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store computed value in cache
   */
  _setCachedValue(node, value) {
    try {
      if (!node || !node.id) {
        return;
      }

      const inputHash = this._computeInputHash(node);
      const paramHash = this._computeParameterHash(node);

      this._valueCache.set(node.id, {
        value: value,
        inputHash: inputHash,
        paramHash: paramHash
      });

      this._lastInputHashes.set(node.id, inputHash);
      this._lastParamHashes.set(node.id, paramHash);
    } catch (error) {
      // Silently fail cache storage
    }
  }

  /**
   * Get value from PreviewComputer cache if available
   */
  _getPreviewComputerCacheValue(node) {
    try {
      if (!node || !node.id) {
        return null;
      }

      // Access PreviewComputer through editor
      const previewComputer = this.editor?.previewComputer;
      if (!previewComputer || !previewComputer.lastComputedValues) {
        return null;
      }

      // Check if PreviewComputer has a cached value
      if (previewComputer.lastComputedValues.has(node.id)) {
        const cachedValue = previewComputer.lastComputedValues.get(node.id);
        
        // Verify the value is still valid by checking if node is dirty
        // If PreviewComputer has marked it dirty, don't use cached value
        if (previewComputer._manualDirtyNodes && previewComputer._manualDirtyNodes.has(node.id)) {
          return null;
        }

        // Check if inputs have changed in PreviewComputer's tracking
        const lastInputs = previewComputer.lastComputedInputs?.get(node.id);
        const currentInputs = this._snapshotNodeInputs(node);
        if (lastInputs && !this._areInputsEqual(lastInputs, currentInputs)) {
          return null;
        }

        // Check if parameters have changed
        const lastParamHash = previewComputer.lastParameterHashes?.get(node.id);
        const currentParamHash = this._computeParameterHash(node);
        if (lastParamHash && lastParamHash !== currentParamHash) {
          return null;
        }

        return cachedValue;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update PreviewComputer cache with computed value
   */
  _updatePreviewComputerCache(node, value) {
    try {
      if (!node || !node.id) {
        return;
      }

      const previewComputer = this.editor?.previewComputer;
      if (!previewComputer) {
        return;
      }

      // Update PreviewComputer's cache
      if (previewComputer.lastComputedValues) {
        previewComputer.lastComputedValues.set(node.id, value);
      }

      // Update input snapshot
      if (previewComputer.lastComputedInputs) {
        const inputSnapshot = this._snapshotNodeInputs(node);
        previewComputer.lastComputedInputs.set(node.id, inputSnapshot);
      }

      // Update parameter hash
      if (previewComputer.lastParameterHashes) {
        const paramHash = this._computeParameterHash(node);
        previewComputer.lastParameterHashes.set(node.id, paramHash);
      }
    } catch (error) {
      // Silently fail cache update
    }
  }

  /**
   * Snapshot node inputs for comparison
   */
  _snapshotNodeInputs(node) {
    try {
      if (!node || !Array.isArray(node.inputs)) {
        return [];
      }
      return node.inputs.map((input) => input ?? null);
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if two input snapshots are equal
   */
  _areInputsEqual(prevInputs, nextInputs) {
    try {
      const a = prevInputs || [];
      const b = nextInputs || [];
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          return false;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Invalidate cache for a specific node or all nodes
   * @param {string|null} nodeId - Node ID to invalidate, or null to invalidate all
   */
  invalidateCache(nodeId = null) {
    try {
      if (nodeId === null) {
        // Invalidate all cache
        this._valueCache.clear();
        this._lastInputHashes.clear();
        this._lastParamHashes.clear();
      } else {
        // Invalidate specific node
        this._valueCache.delete(nodeId);
        this._lastInputHashes.delete(nodeId);
        this._lastParamHashes.delete(nodeId);
      }
    } catch (error) {
      // Silently fail invalidation
    }
  }

  /**
   * Invalidate cache for a node and all nodes that depend on it
   * This should be called when a node's output changes
   */
  invalidateNodeAndDependents(nodeId) {
    try {
      if (!nodeId || !this.editor?.graph) {
        return;
      }

      // Invalidate the node itself
      this.invalidateCache(nodeId);

      // Find all nodes that depend on this node (have it as an input)
      const dependents = new Set();
      if (this.editor.graph.connections) {
        for (const conn of this.editor.graph.connections) {
          if (conn.from?.nodeId === nodeId) {
            dependents.add(conn.to?.nodeId);
          }
        }
      }

      // Also check node.inputs arrays
      if (this.editor.graph.nodes) {
        for (const node of this.editor.graph.nodes) {
          if (node.inputs && Array.isArray(node.inputs)) {
            if (node.inputs.includes(nodeId)) {
              dependents.add(node.id);
            }
          }
        }
      }

      // Invalidate all dependents
      for (const dependentId of dependents) {
        this.invalidateCache(dependentId);
      }
    } catch (error) {
      // Silently fail invalidation
    }
  }
}