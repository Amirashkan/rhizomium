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
    const expr = (node.expr || "a").substring(0, 10);
    
    ctx.fillStyle = "#4CAF5020";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#4CAF50";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("fx", this.size / 2, this.size / 2 - 6);
    
    ctx.font = "7px monospace";
    ctx.fillText(expr, this.size / 2, this.size / 2 + 8);
  }

  renderRemap(ctx, node) {
    ctx.fillStyle = "#8b5cf620";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("REMAP", this.size / 2, this.size / 2);
    
    // Draw remap visualization
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(5, this.size - 5);
    ctx.lineTo(this.size / 2, this.size / 2);
    ctx.lineTo(this.size - 5, 5);
    ctx.stroke();
  }

  renderPosterize(ctx, node) {
    const steps = node.params?.steps || 8;
    
    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("POST", this.size / 2, this.size / 2 - 6);
    
    ctx.font = "8px monospace";
    ctx.fillText(`${steps}`, this.size / 2, this.size / 2 + 8);
    
    // Draw steps
    const stepHeight = this.size / steps;
    for (let i = 0; i < steps; i++) {
      const brightness = i / steps;
      ctx.fillStyle = `rgba(245, 158, 11, ${brightness})`;
      ctx.fillRect(2, i * stepHeight, this.size - 4, stepHeight);
    }
  }

  renderColorToGrayscale(ctx, node) {
    ctx.fillStyle = "#6b728020";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#6b7280";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GRAY", this.size / 2, this.size / 2);
    
    // Draw gradient
    const gradient = ctx.createLinearGradient(0, 0, this.size, 0);
    gradient.addColorStop(0, "#000000");
    gradient.addColorStop(1, "#ffffff");
    ctx.fillStyle = gradient;
    ctx.fillRect(2, this.size - 10, this.size - 4, 6);
  }

  renderColorInvert(ctx, node) {
    ctx.fillStyle = "#ec489920";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#ec4899";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("INV", this.size / 2, this.size / 2);
  }

  renderColorSaturate(ctx, node) {
    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SAT", this.size / 2, this.size / 2);
  }

  renderColorContrast(ctx, node) {
    ctx.fillStyle = "#3b82f620";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#3b82f6";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CONT", this.size / 2, this.size / 2);
  }

  renderColorBrightness(ctx, node) {
    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("BRIT", this.size / 2, this.size / 2);
  }

  renderColorConversion(ctx, node, label) {
    ctx.fillStyle = "#a855f720";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#a855f7";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, this.size / 2, this.size / 2);
  }

  renderSelect(ctx, node) {
    ctx.fillStyle = "#06b6d420";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#06b6d4";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SEL", this.size / 2, this.size / 2);
    
    // Draw selection visualization
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(this.size / 2, this.size / 2);
    ctx.moveTo(10, this.size - 10);
    ctx.lineTo(this.size / 2, this.size / 2);
    ctx.lineTo(this.size - 10, this.size / 2);
    ctx.stroke();
  }

  renderCompare(ctx, node) {
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
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#14b8a6";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(symbols[operator] || ">", this.size / 2, this.size / 2);
  }
}