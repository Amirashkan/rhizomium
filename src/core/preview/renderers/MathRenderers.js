// src/core/preview/renderers/MathRenderers.js - Fixed for expression support

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
      'saturate': (ctx, node) => this.renderSaturate(ctx, node)
    });
  }

  // Helper function to safely convert values to numbers (handles expressions)
  toSafeNumber(value, defaultValue = 0) {
    // Handle null/undefined
    if (value == null) return defaultValue;
    
    // If already a number, return it
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    
    // Handle expressions
    if (typeof value === 'string' && value.trim().startsWith('=')) {
      try {
        // Use the parameter value manager if available
        if (window.editor?.paramPanel?.valueManager?.expressionSystem) {
          return window.editor.paramPanel.valueManager.expressionSystem.evaluateExpression(value, {}, {});
        }
        
        // Fallback basic expression evaluation
        const expr = value.slice(1).trim();
        const processed = expr
          .replace(/PI/g, Math.PI)
          .replace(/sin/g, 'Math.sin')
          .replace(/cos/g, 'Math.cos')
          .replace(/tan/g, 'Math.tan')
          .replace(/sqrt/g, 'Math.sqrt')
          .replace(/abs/g, 'Math.abs')
          .replace(/min/g, 'Math.min')
          .replace(/max/g, 'Math.max');
        
        const result = Function(`"use strict"; return (${processed})`)();
        return typeof result === 'number' && !isNaN(result) ? result : defaultValue;
      } catch (error) {
        console.warn('Expression evaluation failed in MathRenderers:', error);
        return defaultValue;
      }
    }
    
    // Try to parse as number
    const parsed = Number(value);
    return !isNaN(parsed) && isFinite(parsed) ? parsed : defaultValue;
  }

  renderMath(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    let a, b;
    switch (node.kind.toLowerCase()) {
      case "divide":
      case "subtract":
        // Convert inputs to safe numbers with proper defaults
        a = this.toSafeNumber(inputs.a, 1);
        b = this.toSafeNumber(inputs.b, 1);
        break;
      default:
        // Convert inputs to safe numbers with proper defaults  
        a = this.toSafeNumber(inputs.a, 1);
        b = this.toSafeNumber(inputs.b, 1);
    }

    // Ensure computedResult is also a safe number
    const safeResult = this.toSafeNumber(computedResult, 0);

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "8px monospace";
    const resultText = Math.abs(safeResult) < 0.01
        ? safeResult.toExponential(1)
        : safeResult.toFixed(2);

    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    // Display input values safely
    ctx.font = "6px monospace";
    ctx.fillText(`A:${a.toFixed(1)}`, 8, 12);
    ctx.fillText(`B:${b.toFixed(1)}`, 8, 22);
  }

  renderSaturate(ctx, node) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);
    
    // Convert input to safe number
    const input = this.toSafeNumber(inputs.input || inputs.a || inputs[0], 0.5);
    const safeResult = this.toSafeNumber(computedResult, 0);

    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SAT", this.size / 2, this.size / 2 - 2);

    ctx.font = "8px monospace";
    const resultText = Math.abs(safeResult) < 0.01
        ? safeResult.toExponential(1)
        : safeResult.toFixed(2);

    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.fillText(`IN:${input.toFixed(1)}`, 8, 12);
  }
}