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

  renderMath(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    const a = this.toSafeNumber(inputs.a || inputs[0], 0);
    const b = this.toSafeNumber(inputs.b || inputs[1], 0);
    const result = this.toSafeNumber(computedResult, 0);

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "8px monospace";
    const resultText = Math.abs(result) < 0.01 && result !== 0
      ? result.toExponential(1)
      : result.toFixed(2);
    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`A:${a.toFixed(1)}`, 2, 12);
    ctx.fillText(`B:${b.toFixed(1)}`, 2, 22);
  }

  renderUnaryMath(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    const input = this.toSafeNumber(inputs.x || inputs[0], 0);
    const result = this.toSafeNumber(computedResult, 0);

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "8px monospace";
    const resultText = Math.abs(result) < 0.01 && result !== 0
      ? result.toExponential(1)
      : result.toFixed(2);
    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${input.toFixed(2)}`, 2, 12);
  }

  renderSaturate(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const input = this.toSafeNumber(inputs.x || inputs[0], 0.5);
    const result = this.toSafeNumber(computedResult, 0);

    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SAT", this.size / 2, this.size / 2 - 2);

    ctx.font = "8px monospace";
    ctx.fillText(result.toFixed(2), this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${input.toFixed(2)}`, 2, 12);

    const clampedInput = Math.max(0, Math.min(1, input));
    const barWidth = (this.size - 4) * clampedInput;
    ctx.fillStyle = "#10b981";
    ctx.fillRect(2, this.size - 10, barWidth, 6);
  }

  renderClamp(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const input = this.toSafeNumber(inputs.value || inputs[0], 0.5);
    const min = this.toSafeNumber(inputs.min || inputs[1], 0);
    const max = this.toSafeNumber(inputs.max || inputs[2], 1);
    const result = this.toSafeNumber(computedResult, input);

    ctx.fillStyle = "#8b5cf620";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CLAMP", this.size / 2, this.size / 2 - 4);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${input.toFixed(2)}`, 2, 10);
    ctx.fillText(`MIN:${min.toFixed(1)}`, 2, 18);
    ctx.fillText(`MAX:${max.toFixed(1)}`, 2, 26);

    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(result.toFixed(2), this.size / 2, this.size / 2 + 12);
  }

  renderLerp(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const a = this.toSafeNumber(inputs.a || inputs[0], 0);
    const b = this.toSafeNumber(inputs.b || inputs[1], 1);
    const t = this.toSafeNumber(inputs.t || inputs[2], 0.5);
    const result = this.toSafeNumber(computedResult, a);

    ctx.fillStyle = "#06b6d420";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#06b6d4";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("LERP", this.size / 2, this.size / 2 - 4);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`A:${a.toFixed(2)}`, 2, 10);
    ctx.fillText(`B:${b.toFixed(2)}`, 2, 18);
    ctx.fillText(`T:${t.toFixed(2)}`, 2, 26);

    const lerpPos = Math.max(0, Math.min(1, t)) * (this.size - 4);
    ctx.fillStyle = "#06b6d4";
    ctx.fillRect(2, this.size - 8, this.size - 4, 2);
    ctx.fillRect(lerpPos, this.size - 12, 4, 8);

    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(result.toFixed(2), this.size / 2, this.size / 2 + 12);
  }

  renderSmoothstep(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const result = this.toSafeNumber(computedResult, 0);

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

    ctx.font = "8px monospace";
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(result.toFixed(2), this.size / 2, this.size / 2 + 12);
  }
}