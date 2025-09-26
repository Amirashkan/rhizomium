// src/core/preview/renderers/MathRenderers.js - Improved expression support

export class MathRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'multiply': (ctx, node) => this.renderMath(ctx, node, "×", "#f59e0b"),
      'add': (ctx, node) => this.renderMath(ctx, node, "+", "#60a5fa"),
      'subtract': (ctx, node) => this.renderMath(ctx, node, "−", "#f87171"),
      'divide': (ctx, node) => this.renderMath(ctx, node, "÷", "#a78bfa"),
      'saturate': (ctx, node) => this.renderSaturate(ctx, node),
      'clamp': (ctx, node) => this.renderClamp(ctx, node),
      'lerp': (ctx, node) => this.renderLerp(ctx, node),
      'smoothstep': (ctx, node) => this.renderSmoothstep(ctx, node)
    });
  }

  // Consistent helper method to get parameter values with expression support
  getParameterValue(node, paramName, defaultValue = 0) {
    try {
      // Try the expression-aware method first
      if (this.previewSystem.getParameterValue) {
        return this.previewSystem.getParameterValue(node, paramName, defaultValue);
      }
      
      // Fallback to the old method if expression system isn't integrated yet
      if (this.previewSystem.getParameter) {
        return this.previewSystem.getParameter(node, paramName) ?? defaultValue;
      }
      
      // Direct fallback to node parameters
      return node.params?.[paramName] ?? defaultValue;
    } catch (error) {
      console.warn(`Error getting parameter ${paramName}:`, error);
      return defaultValue;
    }
  }

  // Helper to safely convert values to numbers
  toSafeNumber(value, defaultValue = 0) {
    if (value == null) return defaultValue;
    
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    
    const parsed = Number(value);
    return !isNaN(parsed) && isFinite(parsed) ? parsed : defaultValue;
  }

  // Helper to check if any parameter is an expression
  hasExpressions(node) {
    try {
      if (!node.params) return false;
      return Object.values(node.params).some(value => 
        typeof value === 'string' && value.trim().startsWith('=')
      );
    } catch (error) {
      return false;
    }
  }

  // Draw expression indicator
  drawExpressionIndicator(ctx) {
    ctx.save();
    ctx.fillStyle = "#4CAF50";
    ctx.fillRect(this.size - 12, 2, 10, 8);
    ctx.fillStyle = "#ffffff";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("fx", this.size - 7, 6);
    ctx.restore();
  }

  renderMath(ctx, node, symbol, color) {
    // Get computed result
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    // Get input values with proper defaults based on operation
    let defaultA = 1, defaultB = 1;
    if (node.kind.toLowerCase() === "add" || node.kind.toLowerCase() === "subtract") {
      defaultA = 0;
      defaultB = 0;
    }

    const a = this.toSafeNumber(inputs.a, defaultA);
    const b = this.toSafeNumber(inputs.b, defaultB);
    const result = this.toSafeNumber(computedResult, 0);

    // Background with operation color
    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    // Operation symbol
    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    // Result value
    ctx.font = "8px monospace";
    const resultText = Math.abs(result) < 0.01 && result !== 0
      ? result.toExponential(1)
      : result.toFixed(2);
    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    // Input values
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`A:${a.toFixed(1)}`, 2, 12);
    ctx.fillText(`B:${b.toFixed(1)}`, 2, 22);

    // Show expression indicator if any parameter uses expressions
    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }

    // Visual representation of the operation
    this.drawOperationVisualization(ctx, node.kind.toLowerCase(), a, b, result);
  }

  drawOperationVisualization(ctx, operation, a, b, result) {
    ctx.save();
    
    // Simple bar visualization in bottom section
    const barY = this.size - 12;
    const barHeight = 8;
    const barWidth = this.size - 4;

    ctx.fillStyle = "#00000020";
    ctx.fillRect(2, barY, barWidth, barHeight);

    // Visualize based on operation type
    switch (operation) {
      case 'add':
        this.drawAddVisualization(ctx, a, b, result, 2, barY, barWidth, barHeight);
        break;
      case 'multiply':
        this.drawMultiplyVisualization(ctx, a, b, result, 2, barY, barWidth, barHeight);
        break;
      case 'subtract':
        this.drawSubtractVisualization(ctx, a, b, result, 2, barY, barWidth, barHeight);
        break;
      case 'divide':
        this.drawDivideVisualization(ctx, a, b, result, 2, barY, barWidth, barHeight);
        break;
    }

    ctx.restore();
  }

  drawAddVisualization(ctx, a, b, result, x, y, w, h) {
    const maxVal = Math.max(Math.abs(a), Math.abs(b), Math.abs(result), 1);
    const aWidth = Math.abs(a) / maxVal * w * 0.3;
    const bWidth = Math.abs(b) / maxVal * w * 0.3;
    
    ctx.fillStyle = "#60a5fa80";
    ctx.fillRect(x, y, aWidth, h);
    ctx.fillRect(x + aWidth + 2, y, bWidth, h);
  }

  drawMultiplyVisualization(ctx, a, b, result, x, y, w, h) {
    const intensity = Math.min(1, Math.abs(result) / 10);
    ctx.fillStyle = `rgba(245, 158, 11, ${intensity})`;
    ctx.fillRect(x, y, w, h);
  }

  drawSubtractVisualization(ctx, a, b, result, x, y, w, h) {
    const maxVal = Math.max(Math.abs(a), Math.abs(b), 1);
    const aWidth = Math.abs(a) / maxVal * w * 0.4;
    const bWidth = Math.abs(b) / maxVal * w * 0.3;
    
    ctx.fillStyle = "#f8717180";
    ctx.fillRect(x, y, aWidth, h);
    ctx.fillStyle = "#00000040";
    ctx.fillRect(x + aWidth - bWidth, y, bWidth, h);
  }

  drawDivideVisualization(ctx, a, b, result, x, y, w, h) {
    if (b !== 0) {
      const segments = Math.min(Math.abs(b), 8);
      const segmentWidth = w / segments;
      
      for (let i = 0; i < segments; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#a78bfa80" : "#a78bfa40";
        ctx.fillRect(x + i * segmentWidth, y, segmentWidth - 1, h);
      }
    }
  }

  renderSaturate(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const input = this.toSafeNumber(inputs.input || inputs.a || inputs[0], 0.5);
    const result = this.toSafeNumber(computedResult, 0);

    // Background
    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, this.size, this.size);

    // Label
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SAT", this.size / 2, this.size / 2 - 2);

    // Result
    ctx.font = "8px monospace";
    const resultText = Math.abs(result) < 0.01 && result !== 0
      ? result.toExponential(1)
      : result.toFixed(2);
    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    // Input value
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`IN:${input.toFixed(2)}`, 2, 12);

    // Saturation visualization
    const clampedInput = Math.max(0, Math.min(1, input));
    const barWidth = (this.size - 4) * clampedInput;
    ctx.fillStyle = "#10b981";
    ctx.fillRect(2, this.size - 10, barWidth, 6);
    
    // Show clamping boundaries
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(2, this.size - 12);
    ctx.lineTo(2, this.size - 4);
    ctx.moveTo(this.size - 2, this.size - 12);
    ctx.lineTo(this.size - 2, this.size - 4);
    ctx.stroke();

    // Expression indicator
    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderClamp(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const input = this.toSafeNumber(inputs.input || inputs.value, 0.5);
    const min = this.toSafeNumber(inputs.min || this.getParameterValue(node, "min", 0), 0);
    const max = this.toSafeNumber(inputs.max || this.getParameterValue(node, "max", 1), 1);
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

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderLerp(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const a = this.toSafeNumber(inputs.a || this.getParameterValue(node, "a", 0), 0);
    const b = this.toSafeNumber(inputs.b || this.getParameterValue(node, "b", 1), 1);
    const t = this.toSafeNumber(inputs.t || this.getParameterValue(node, "t", 0.5), 0.5);
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

    // Lerp visualization
    const lerpPos = Math.max(0, Math.min(1, t)) * (this.size - 4);
    ctx.fillStyle = "#06b6d4";
    ctx.fillRect(2, this.size - 8, this.size - 4, 2);
    ctx.fillRect(lerpPos, this.size - 12, 4, 8);

    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(result.toFixed(2), this.size / 2, this.size / 2 + 12);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderSmoothstep(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    const edge0 = this.toSafeNumber(inputs.edge0 || this.getParameterValue(node, "edge0", 0), 0);
    const edge1 = this.toSafeNumber(inputs.edge1 || this.getParameterValue(node, "edge1", 1), 1);
    const x = this.toSafeNumber(inputs.x || this.getParameterValue(node, "x", 0.5), 0.5);
    const result = this.toSafeNumber(computedResult, 0);

    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SMOOTH", this.size / 2, this.size / 2 - 4);

    // Draw smoothstep curve
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < this.size; i++) {
      const t = i / this.size;
      const smoothT = t * t * (3 - 2 * t); // smoothstep formula
      const y = this.size - smoothT * this.size;
      
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();

    ctx.font = "8px monospace";
    ctx.fillText(result.toFixed(2), this.size / 2, this.size / 2 + 12);

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }
}