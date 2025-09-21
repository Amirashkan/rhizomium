// src/core/preview/NodeValueComputer.js

export class NodeValueComputer {
  constructor(editor) {
    this.editor = editor;
  }

  computeNodeValue(node, visited = new Set()) {
    if (visited.has(node.id)) {
      console.warn(
        `Circular dependency detected for node ${node.kind} (${node.id})`
      );
      return 0;
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
        result = a * b;
        break;
      }

      case "add": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 0;
        const b = inputs.b !== undefined ? inputs.b : 0;
        result = a + b;
        break;
      }

      case "divide": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 1;
        const b = inputs.b !== undefined ? inputs.b : 1;
        result = b !== 0 ? a / b : 0;
        break;
      }

      case "subtract": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = inputs.a !== undefined ? inputs.a : 0;
        const b = inputs.b !== undefined ? inputs.b : 0;
        result = a - b;
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
        result = this._evaluateExpression(expr, variables);
        break;
      }

      case "saturate": {
        const inputs = this.getConnectedInputs(node, visited);
        const input = inputs.input || inputs.a || 0;
        result = Math.max(0, Math.min(1, input));
        break;
      }

      case "dot": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = this._toVec3(inputs.a || [1, 0, 0]);
        const b = this._toVec3(inputs.b || [0, 1, 0]);
        result = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        break;
      }

      case "cross": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = this._toVec3(inputs.a || [1, 0, 0]);
        const b = this._toVec3(inputs.b || [0, 1, 0]);
        result = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        break;
      }

      case "normalize": {
        const inputs = this.getConnectedInputs(node, visited);
        const vec = this._toVec3(inputs.vec || inputs.a || [1, 0, 0]);
        const length = Math.sqrt(
          vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]
        );
        if (length > 1e-6) {
          result = [vec[0] / length, vec[1] / length, vec[2] / length];
        } else {
          result = [0, 0, 0];
        }
        break;
      }

      case "length": {
        const inputs = this.getConnectedInputs(node, visited);
        const vec = this._toVec3(inputs.vec || inputs.a || [1, 1, 0]);
        result = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
        break;
      }

      case "distance": {
        const inputs = this.getConnectedInputs(node, visited);
        const a = this._toVec3(inputs.a || [0, 0, 0]);
        const b = this._toVec3(inputs.b || [0, 0, 0]);
        const diff = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        result = Math.sqrt(
          diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]
        );
        break;
      }

      // Add more cases as needed...

      default:
        result = 0;
    }

    visited.delete(node.id);
    return result;
  }

  getConnectedInputs(node, visited = new Set()) {
    const inputs = {};

    if (!this.editor.graph?.connections) return inputs;

    for (const conn of this.editor.graph.connections) {
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
    }

    return inputs;
  }

  _getParameter(node, name) {
    return node[name] || node.props?.[name] || 0;
  }

  _toVec3(input) {
    if (Array.isArray(input)) {
      if (input.length >= 3) return [input[0], input[1], input[2]];
      if (input.length === 2) return [input[0], input[1], 0];
      if (input.length === 1) return [input[0], input[0], input[0]];
    }
    if (typeof input === "number") return [input, input, input];
    return [0, 0, 0];
  }

  _evaluateExpression(expr, vars) {
    try {
      let processed = expr;
      for (const [name, value] of Object.entries(vars)) {
        processed = processed.replace(new RegExp(`\\b${name}\\b`, "g"), value);
      }
      processed = processed.replace(/sin/g, "Math.sin");
      processed = processed.replace(/cos/g, "Math.cos");
      processed = processed.replace(/pi/g, "Math.PI");

      return eval(processed);
    } catch (e) {
      return 0;
    }
  }
}