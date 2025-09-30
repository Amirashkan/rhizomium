// src/core/preview/renderers/MathRenderers.js

export class MathRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      // Arithmetic
      'Add': (ctx, node) => this.renderMath(ctx, node, "+", "#60a5fa"),
      'Subtract': (ctx, node) => this.renderMath(ctx, node, "−", "#f87171"),
      'Multiply': (ctx, node) => this.renderMath(ctx, node, "×", "#f59e0b"),
      'Divide': (ctx, node) => this.renderMath(ctx, node, "÷", "#a78bfa"),
      'Power': (ctx, node) => this.renderMath(ctx, node, "^", "#ec4899"),
      
      // Trigonometry
      'Sin': (ctx, node) => this.renderUnaryMath(ctx, node, "sin", "#3b82f6"),
      'Cos': (ctx, node) => this.renderUnaryMath(ctx, node, "cos", "#3b82f6"),
      'Tan': (ctx, node) => this.renderUnaryMath(ctx, node, "tan", "#3b82f6"),
      'Asin': (ctx, node) => this.renderUnaryMath(ctx, node, "asin", "#6366f1"),
      'Acos': (ctx, node) => this.renderUnaryMath(ctx, node, "acos", "#6366f1"),
      'Atan': (ctx, node) => this.renderUnaryMath(ctx, node, "atan", "#6366f1"),
      'Atan2': (ctx, node) => this.renderMath(ctx, node, "atan2", "#6366f1"),
      
      // Math functions
      'Floor': (ctx, node) => this.renderUnaryMath(ctx, node, "⌊⌋", "#8b5cf6"),
      'Ceil': (ctx, node) => this.renderUnaryMath(ctx, node, "⌈⌉", "#8b5cf6"),
      'Round': (ctx, node) => this.renderUnaryMath(ctx, node, "≈", "#8b5cf6"),
      'Fract': (ctx, node) => this.renderUnaryMath(ctx, node, "frac", "#a855f7"),
      'Abs': (ctx, node) => this.renderUnaryMath(ctx, node, "|x|", "#d946ef"),
      'Sqrt': (ctx, node) => this.renderUnaryMath(ctx, node, "√", "#e879f9"),
      'Sign': (ctx, node) => this.renderUnaryMath(ctx, node, "sgn", "#f0abfc"),
      'Exp': (ctx, node) => this.renderUnaryMath(ctx, node, "exp", "#c084fc"),
      'Exp2': (ctx, node) => this.renderUnaryMath(ctx, node, "2^x", "#c084fc"),
      'Log': (ctx, node) => this.renderUnaryMath(ctx, node, "ln", "#a78bfa"),
      'Log2': (ctx, node) => this.renderUnaryMath(ctx, node, "log2", "#a78bfa"),
      
      // Range/Comparison
      'Min': (ctx, node) => this.renderMath(ctx, node, "min", "#14b8a6"),
      'Max': (ctx, node) => this.renderMath(ctx, node, "max", "#06b6d4"),
      'Clamp': (ctx, node) => this.renderClamp(ctx, node),
      'Mod': (ctx, node) => this.renderMath(ctx, node, "%", "#0ea5e9"),
      
      // Interpolation
      'Smoothstep': (ctx, node) => this.renderSmoothstep(ctx, node),
      'Step': (ctx, node) => this.renderUnaryMath(ctx, node, "step", "#f59e0b"),
      'Mix': (ctx, node) => this.renderLerp(ctx, node),
      'Lerp': (ctx, node) => this.renderLerp(ctx, node),
      'InverseLerp': (ctx, node) => this.renderUnaryMath(ctx, node, "invLrp", "#0891b2"),
      'Saturate': (ctx, node) => this.renderSaturate(ctx, node),
      
      // Utilities
      'OneMinus': (ctx, node) => this.renderUnaryMath(ctx, node, "1-x", "#10b981"),
      'Negate': (ctx, node) => this.renderUnaryMath(ctx, node, "-x", "#ef4444"),
      'Reciprocal': (ctx, node) => this.renderUnaryMath(ctx, node, "1/x", "#f97316"),
      
      // Vector operations
      'Dot': (ctx, node) => this.renderVectorOp(ctx, node, "dot", "#14b8a6"),
      'Cross': (ctx, node) => this.renderVectorOp(ctx, node, "×", "#06b6d4"),
      'Normalize': (ctx, node) => this.renderUnaryMath(ctx, node, "norm", "#0ea5e9"),
      'Length': (ctx, node) => this.renderVectorOp(ctx, node, "|v|", "#0891b2"),
      'Distance': (ctx, node) => this.renderVectorOp(ctx, node, "dist", "#0e7490"),
      'Reflect': (ctx, node) => this.renderVectorOp(ctx, node, "refl", "#155e75"),
      'Refract': (ctx, node) => this.renderVectorOp(ctx, node, "refr", "#164e63"),
    });
  }

  getParameterValue(node, paramName, defaultValue = 0) {
    try {
      if (this.previewSystem.getParameterValue) {
        return this.previewSystem.getParameterValue(node, paramName, defaultValue);
      }
      if (this.previewSystem.getParameter) {
        return this.previewSystem.getParameter(node, paramName) ?? defaultValue;
      }
      return node.params?.[paramName] ?? defaultValue;
    } catch (error) {
      return defaultValue;
    }
  }

  toSafeNumber(value, defaultValue = 0) {
    if (value == null) return defaultValue;
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    const parsed = Number(value);
    return !isNaN(parsed) && isFinite(parsed) ? parsed : defaultValue;
  }

  /**
   * Extract a displayable value from various types (scalar, vec2, vec3, vec4)
   */
  extractDisplayValue(value) {
    if (value == null) return 0;
    
    // If it's already a number
    if (typeof value === 'number' && isFinite(value)) {
      return value;
    }
    
    // If it's a vector-like object or array
    if (typeof value === 'object') {
      if (Array.isArray(value) && value.length > 0) {
        // Return average of components for display
        return value.reduce((sum, v) => sum + (this.toSafeNumber(v, 0)), 0) / value.length;
      }
      if (value.x !== undefined) return this.toSafeNumber(value.x, 0);
      if (value[0] !== undefined) return this.toSafeNumber(value[0], 0);
    }
    
    return this.toSafeNumber(value, 0);
  }

  /**
   * Format value for display (handles vectors and scalars)
   */
  formatValue(value, decimals = 2) {
    if (value == null) return "0.00";
    
    // Handle vector types
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        // Show as vector notation
        if (value.length === 2) {
          return `(${value[0].toFixed(1)},${value[1].toFixed(1)})`;
        } else if (value.length === 3) {
          return `(${value[0].toFixed(1)},${value[1].toFixed(1)},${value[2].toFixed(1)})`;
        } else if (value.length === 4) {
          return `(${value[0].toFixed(1)},${value[1].toFixed(1)},${value[2].toFixed(1)},${value[3].toFixed(1)})`;
        }
      }
      if (value.x !== undefined && value.y !== undefined) {
        if (value.z !== undefined) {
          if (value.w !== undefined) {
            return `(${value.x.toFixed(1)},${value.y.toFixed(1)},${value.z.toFixed(1)},${value.w.toFixed(1)})`;
          }
          return `(${value.x.toFixed(1)},${value.y.toFixed(1)},${value.z.toFixed(1)})`;
        }
        return `(${value.x.toFixed(1)},${value.y.toFixed(1)})`;
      }
    }
    
    // Handle scalar
    const num = this.toSafeNumber(value, 0);
    if (Math.abs(num) < 0.01 && num !== 0) {
      return num.toExponential(1);
    }
    return num.toFixed(decimals);
  }

  renderMath(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    const a = inputs.a || inputs[0];
    const b = inputs.b || inputs[1];
    const result = computedResult;

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    // Display result
    ctx.font = "7px monospace";
    ctx.fillText(this.formatValue(result, 2), this.size / 2, this.size / 2 + 12);

    // Display inputs
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`A:${this.formatValue(a, 1)}`, 2, 12);
    ctx.fillText(`B:${this.formatValue(b, 1)}`, 2, 22);
  }

  renderUnaryMath(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    const input = inputs.x || inputs[0];
    const result = computedResult;

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "7px monospace";
    ctx.fillText(this.formatValue(result, 2), this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${this.formatValue(input, 2)}`, 2, 12);
  }

  renderVectorOp(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "7px monospace";
    ctx.fillText(this.formatValue(computedResult, 2), this.size / 2, this.size / 2 + 12);

    // Show input info
    ctx.font = "5px monospace";
    ctx.textAlign = "left";
    const inputKeys = Object.keys(inputs);
    inputKeys.slice(0, 3).forEach((key, idx) => {
      ctx.fillText(`${key}:${this.formatValue(inputs[key], 1)}`, 2, 10 + idx * 8);
    });
  }

  renderSaturate(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const input = inputs.x || inputs[0];
    const result = computedResult;

    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SAT", this.size / 2, this.size / 2 - 2);

    ctx.font = "7px monospace";
    ctx.fillText(this.formatValue(result, 2), this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${this.formatValue(input, 2)}`, 2, 12);

    // Bar visualization (use extracted value)
    const displayVal = this.extractDisplayValue(input);
    const clampedInput = Math.max(0, Math.min(1, displayVal));
    const barWidth = (this.size - 4) * clampedInput;
    ctx.fillStyle = "#10b981";
    ctx.fillRect(2, this.size - 10, barWidth, 6);
  }

  renderClamp(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const input = inputs.value || inputs[0];
    const min = inputs.min || inputs[1];
    const max = inputs.max || inputs[2];
    const result = computedResult;

    ctx.fillStyle = "#8b5cf620";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CLAMP", this.size / 2, this.size / 2 - 4);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${this.formatValue(input, 2)}`, 2, 10);
    ctx.fillText(`MIN:${this.formatValue(min, 1)}`, 2, 18);
    ctx.fillText(`MAX:${this.formatValue(max, 1)}`, 2, 26);

    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText(this.formatValue(result, 2), this.size / 2, this.size / 2 + 12);
  }

  renderLerp(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const a = inputs.a || inputs[0];
    const b = inputs.b || inputs[1];
    const t = inputs.t || inputs[2];
    const result = computedResult;

    ctx.fillStyle = "#06b6d420";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#06b6d4";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("LERP", this.size / 2, this.size / 2 - 4);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`A:${this.formatValue(a, 2)}`, 2, 10);
    ctx.fillText(`B:${this.formatValue(b, 2)}`, 2, 18);
    ctx.fillText(`T:${this.formatValue(t, 2)}`, 2, 26);

    const tVal = this.extractDisplayValue(t);
    const lerpPos = Math.max(0, Math.min(1, tVal)) * (this.size - 4);
    ctx.fillStyle = "#06b6d4";
    ctx.fillRect(2, this.size - 8, this.size - 4, 2);
    ctx.fillRect(lerpPos, this.size - 12, 4, 8);

    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText(this.formatValue(result, 2), this.size / 2, this.size / 2 + 12);
  }

  renderSmoothstep(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const result = computedResult;

    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SMOOTH", this.size / 2, this.size / 2 - 4);

    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < this.size; i++) {
      const t = i / this.size;
      const smoothT = t * t * (3 - 2 * t);
      const y = this.size - smoothT * this.size;
      
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();

    ctx.font = "7px monospace";
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(this.formatValue(result, 2), this.size / 2, this.size / 2 + 12);
  }
}