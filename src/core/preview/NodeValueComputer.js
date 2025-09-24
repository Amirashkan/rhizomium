// src/core/preview/NodeValueComputer.js

export class NodeValueComputer {
  constructor(editor) {
    this.editor = editor;
    this.maxRecursionDepth = 50; // Prevent stack overflow
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

      visited.add(node.id);

      let result;

      switch (node.kind.toLowerCase()) {
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

        case "uv":
          result = 0.5;
          break;

        case "circle":
        case "circlefield":
          result = this._getParameter(node, "radius") || 0.5;
          break;

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

        case "expr": {
          const inputs = this.getConnectedInputs(node, visited);
          const expr = this._getParameter(node, "expr") || node.expr || "a";
          const a = inputs.a || 0;
          const b = inputs.b || 0;
          const variables = {
            a: a,
            b: b,
            t: (Date.now() / 1000) % (Math.PI * 2),
            u_time: Date.now() / 1000,
            pi: Math.PI,
            PI: Math.PI,
          };
          result = this._evaluateExpression(expr, variables, node.id);
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
          console.warn('Error processing connection:', connError);
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
      return node[name] || node.props?.[name] || 0;
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
}