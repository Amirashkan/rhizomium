// src/core/preview/renderers/MathRenderers.js

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

  renderMath(ctx, node, symbol, color) {
    const computedResult = this.previewSystem.computeNodeValue(node);
    const inputs = this.previewSystem.getConnectedInputs(node);

    let a, b;
    switch (node.kind.toLowerCase()) {
      case "divide":
      case "subtract":
        a = inputs.a !== undefined ? inputs.a : 1;
        b = inputs.b !== undefined ? inputs.b : 1;
        break;
      default:
        a = inputs.a !== undefined ? inputs.a : 1;
        b = inputs.b !== undefined ? inputs.b : 1;
    }

    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(symbol, this.size / 2, this.size / 2 - 4);

    ctx.font = "8px monospace";
    const resultText =
      Math.abs(computedResult) < 0.01
        ? computedResult.toExponential(1)
        : computedResult.toFixed(2);
    ctx.fillText(resultText, this.size / 2, this.size / 2 + 12);

    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    const aText = Math.abs(a) < 0.01 ? a.toExponential(1) : a.toFixed(2);
    const bText = Math.abs(b) < 0.01 ? b.toExponential(1) : b.toFixed(2);
    ctx.fillText(`A:${aText}`, 2, 10);
    ctx.fillText(`B:${bText}`, 2, 18);
  }

  renderSaturate(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = inputs.input || 0.5;
    const result = Math.max(0, Math.min(1, input));

    // Render gradient showing saturation effect
    for (let x = 0; x < this.size; x++) {
      const testValue = (x / this.size) * 2 - 0.5;
      const saturated = Math.max(0, Math.min(1, testValue));
      const color = Math.floor(saturated * 255);
      ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
      ctx.fillRect(x, 0, 1, this.size);
    }

    // Input indicator
    const inputX = Math.floor(((input + 0.5) * this.size) / 2);
    const outputX = Math.floor(result * this.size);

    ctx.fillStyle = "#ff4444";
    ctx.fillRect(inputX, this.size - 4, 1, 4);

    ctx.fillStyle = "#44ff44";
    ctx.fillRect(outputX, 0, 1, 4);
  }
}