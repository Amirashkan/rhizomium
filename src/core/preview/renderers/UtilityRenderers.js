// src/core/preview/renderers/UtilityRenderers.js
export class UtilityRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

register(registry) {
  registry.registerMultiple({
    'expr': (ctx, node) => this.renderExpr(ctx, node),
    'remap': (ctx, node) => this.renderRemap(ctx, node),
    'posterize': (ctx, node) => this.renderPosterize(ctx, node),
    'colortograyscale': (ctx, node) => this.renderColorToGrayscale(ctx, node),
    'colorinvert': (ctx, node) => this.renderColorInvert(ctx, node),
    'colorsaturate': (ctx, node) => this.renderColorSaturate(ctx, node),
    'colorcontrast': (ctx, node) => this.renderColorContrast(ctx, node),
    'colorbrightness': (ctx, node) => this.renderColorBrightness(ctx, node),
    'hsvtorgb': (ctx, node) => this.renderColorConversion(ctx, node, "HSV→RGB"),
    'rgbtohsv': (ctx, node) => this.renderColorConversion(ctx, node, "RGB→HSV"),
    'select': (ctx, node) => this.renderSelect(ctx, node),
    'compare': (ctx, node) => this.renderCompare(ctx, node),
  });
}

  renderExpr(ctx, node) {
    const size = ctx.canvas.width;
    const expr = (node.expr || "a").substring(0, 10);
    
    ctx.fillStyle = "#4CAF5020";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#4CAF50";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("fx", size / 2, size / 2 - 6);
    
    ctx.font = "7px monospace";
    ctx.fillText(expr, size / 2, size / 2 + 8);
  }

  renderRemap(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#8b5cf620";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("REMAP", size / 2, size / 2);
    
    // Draw remap visualization
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(5, size - 5);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(size - 5, 5);
    ctx.stroke();
  }

  renderPosterize(ctx, node) {
    const size = ctx.canvas.width;
    const steps = node.params?.steps || 8;
    
    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("POST", size / 2, size / 2 - 6);
    
    ctx.font = "8px monospace";
    ctx.fillText(`${steps}`, size / 2, size / 2 + 8);
    
    // Draw steps
    const stepHeight = size / steps;
    for (let i = 0; i < steps; i++) {
      const brightness = i / steps;
      ctx.fillStyle = `rgba(245, 158, 11, ${brightness})`;
      ctx.fillRect(2, i * stepHeight, size - 4, stepHeight);
    }
  }

  renderColorToGrayscale(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#6b728020";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#6b7280";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GRAY", size / 2, size / 2);
    
    // Draw gradient
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, "#000000");
    gradient.addColorStop(1, "#ffffff");
    ctx.fillStyle = gradient;
    ctx.fillRect(2, size - 10, size - 4, 6);
  }

  renderColorInvert(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#ec489920";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#ec4899";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("INV", size / 2, size / 2);
  }

  renderColorSaturate(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SAT", size / 2, size / 2);
  }

  renderColorContrast(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#3b82f620";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#3b82f6";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CONT", size / 2, size / 2);
  }

  renderColorBrightness(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("BRIT", size / 2, size / 2);
  }

  renderColorConversion(ctx, node, label) {
    ctx.fillStyle = "#a855f720";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#a855f7";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, this.size / 2, this.size / 2);
  }

  renderSelect(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#06b6d420";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#06b6d4";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SEL", size / 2, size / 2);
    
    // Draw selection visualization
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(size / 2, size / 2);
    ctx.moveTo(10, size - 10);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(size - 10, size / 2);
    ctx.stroke();
  }

  renderCompare(ctx, node) {
    const size = ctx.canvas.width;
    const operator = node.params?.operator || "greater";
    const symbols = {
      equal: "=",
      notEqual: "≠",
      greater: ">",
      greaterEqual: "≥",
      less: "<",
      lessEqual: "≤"
    };
    
    ctx.fillStyle = "#14b8a620";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#14b8a6";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(symbols[operator] || ">", size / 2, size / 2);
  }
}