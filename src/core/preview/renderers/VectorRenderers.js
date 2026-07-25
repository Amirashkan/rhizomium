// src/core/preview/renderers/VectorRenderers.js
export class VectorRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      // Vector Math
      'Dot': (ctx, node) => this.renderDot(ctx, node),
      'Cross': (ctx, node) => this.renderCross(ctx, node),
      'Normalize': (ctx, node) => this.renderNormalize(ctx, node),
      'Length': (ctx, node) => this.renderLength(ctx, node),
      'Distance': (ctx, node) => this.renderDistance(ctx, node),
      'Reflect': (ctx, node) => this.renderReflect(ctx, node),
      'Refract': (ctx, node) => this.renderRefract(ctx, node),
      
      // Component Operations
      'Split2': (ctx, node) => this.renderSplit(ctx, node, 2),
      'Split3': (ctx, node) => this.renderSplit(ctx, node, 3),
      'Split4': (ctx, node) => this.renderSplit(ctx, node, 4),
      'Combine2': (ctx, node) => this.renderCombine(ctx, node, 2),
      'Combine3': (ctx, node) => this.renderCombine(ctx, node, 3),
      'Combine4': (ctx, node) => this.renderCombine(ctx, node, 4),
      
      // Vector Arithmetic
      'VectorAdd': (ctx, node) => this.renderVectorOp(ctx, node, '+', '#60a5fa'),
      'VectorSubtract': (ctx, node) => this.renderVectorOp(ctx, node, '-', '#f87171'),
      'VectorMultiply': (ctx, node) => this.renderVectorOp(ctx, node, '×', '#f59e0b'),
      'VectorDivide': (ctx, node) => this.renderVectorOp(ctx, node, '÷', '#a78bfa'),
      'VectorScale': (ctx, node) => this.renderVectorScale(ctx, node),
      
      // Swizzle
      'Swizzle': (ctx, node) => this.renderSwizzle(ctx, node),
    });
  }

  toSafeNumber(value, defaultValue = 0) {
    if (value == null) return defaultValue;
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) return value;
    const parsed = Number(value);
    return !isNaN(parsed) && isFinite(parsed) ? parsed : defaultValue;
  }

  renderDot(ctx, node) {
    const size = ctx.canvas.width;
    const result = this.previewSystem.computeNodeValue(node);
    
    ctx.fillStyle = "#3b82f620";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#3b82f6";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("DOT", size / 2, size / 2 - 4);
    
    ctx.font = "10px monospace";
    ctx.fillText(this.toSafeNumber(result, 0).toFixed(2), size / 2, size / 2 + 12);
  }

  renderCross(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#8b5cf620";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CROSS", size / 2, size / 2);
    
    // Draw cross product visualization
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, 10);
    ctx.lineTo(size / 2, size - 10);
    ctx.moveTo(10, size / 2);
    ctx.lineTo(size - 10, size / 2);
    ctx.stroke();
  }

  renderNormalize(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#10b98120";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("NORM", size / 2, size / 2);
    
    // Draw unit circle
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 15, 0, Math.PI * 2);
    ctx.stroke();
  }

  renderLength(ctx, node) {
    const size = ctx.canvas.width;
    const result = this.previewSystem.computeNodeValue(node);
    
    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("LEN", size / 2, size / 2 - 4);
    
    ctx.font = "10px monospace";
    ctx.fillText(this.toSafeNumber(result, 0).toFixed(2), size / 2, size / 2 + 12);
  }

  renderDistance(ctx, node) {
    const size = ctx.canvas.width;
    const result = this.previewSystem.computeNodeValue(node);
    
    ctx.fillStyle = "#06b6d420";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#06b6d4";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("DIST", size / 2, size / 2 - 4);
    
    ctx.font = "10px monospace";
    ctx.fillText(this.toSafeNumber(result, 0).toFixed(2), size / 2, size / 2 + 12);
  }

  renderReflect(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#ec489920";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#ec4899";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("REFL", size / 2, size / 2);
    
    // Draw reflection visualization
    ctx.strokeStyle = "#ec4899";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, size - 10);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(size - 10, size - 10);
    ctx.stroke();
  }

  renderRefract(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#8b5cf620";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("REFR", size / 2, size / 2);
  }

  renderSplit(ctx, node, components) {
    ctx.fillStyle = "#14b8a620";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#14b8a6";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`SPLIT${components}`, this.size / 2, this.size / 2 - 4);
    
    // Draw split arrows
    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 2;
    const spacing = this.size / (components + 1);
    for (let i = 1; i <= components; i++) {
      const y = spacing * i;
      ctx.beginPath();
      ctx.moveTo(this.size / 2 - 10, y);
      ctx.lineTo(this.size / 2 + 10, y);
      ctx.stroke();
    }
  }

  renderCombine(ctx, node, components) {
    ctx.fillStyle = "#0ea5e920";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = "#0ea5e9";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`COMB${components}`, this.size / 2, this.size / 2 - 4);
    
    // Draw combine arrows
    ctx.strokeStyle = "#0ea5e9";
    ctx.lineWidth = 2;
    const spacing = this.size / (components + 1);
    for (let i = 1; i <= components; i++) {
      const y = spacing * i;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(this.size / 2, this.size / 2);
      ctx.stroke();
    }
  }

  renderVectorOp(ctx, node, symbol, color) {
    ctx.fillStyle = color + "20";
    ctx.fillRect(0, 0, this.size, this.size);
    
    ctx.fillStyle = color;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("V" + symbol, this.size / 2, this.size / 2);
  }

  renderVectorScale(ctx, _node) {
    const size = ctx.canvas.width;
    ctx.fillStyle = "#f59e0b20";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SCALE", size / 2, size / 2);
  }

  renderSwizzle(ctx, node) {
    const size = ctx.canvas.width;
    const pattern = node.params?.pattern || "xyz";
    
    ctx.fillStyle = "#a855f720";
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = "#a855f7";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SWIZ", size / 2, size / 2 - 6);
    
    ctx.font = "10px monospace";
    ctx.fillText(pattern, size / 2, size / 2 + 8);
  }
}