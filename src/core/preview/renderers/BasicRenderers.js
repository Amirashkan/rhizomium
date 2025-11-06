// src/core/preview/renderers/BasicRenderers.js
// Updated to support expression system integration

export class BasicRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'constfloat': (ctx, node) => this.renderFloat(ctx, node),
      'float': (ctx, node) => this.renderFloat(ctx, node),
      'constvec3': (ctx, node) => this.renderVec3(ctx, node),
      'vec3': (ctx, node) => this.renderVec3(ctx, node),
      'uv': (ctx, node) => this.renderUV(ctx, node),
      'time': (ctx, node) => this.renderTime(ctx, node),
      'expr': (ctx, node) => this.renderExpression(ctx, node),
      'output': (ctx, node) => this.renderOutput(ctx, node),
      'outputfinal': (ctx, node) => this.renderOutput(ctx, node)
    });
  }

  // Helper method to get parameter values with expression support
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

  renderFloat(ctx, node) {
    const size = ctx.canvas.width;
    const value = this.getParameterValue(node, "value", 0);
    const numValue = typeof value === "number" ? value : parseFloat(value) || 0;

    const intensity = Math.min(0.8, Math.abs(numValue) / 10);
    const hue = numValue >= 0 ? 120 : 0;

    ctx.fillStyle = `hsl(${hue}, 60%, ${10 + intensity * 30}%)`;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = `hsl(${hue}, 80%, 80%)`;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text =
      Math.abs(numValue) < 0.01
        ? numValue.toExponential(1)
        : numValue.toFixed(2);

    ctx.fillText(text, size / 2, size / 2);

    // Grid pattern
    ctx.strokeStyle = `hsl(${hue}, 40%, 40%)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < size; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    // Add expression indicator if this is an expression
    if (this.isExpression(node, "value")) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderVec3(ctx, node) {
    const size = ctx.canvas.width;
    // Use expression-aware parameter access with type conversion and fallbacks
    let x = this.getParameterValue(node, "x", 0);
    let y = this.getParameterValue(node, "y", 0);
    let z = this.getParameterValue(node, "z", 0);

    // Convert to numbers and provide fallbacks
    x = typeof x === "number" ? x : parseFloat(x) || 0;
    y = typeof y === "number" ? y : parseFloat(y) || 0;
    z = typeof z === "number" ? z : parseFloat(z) || 0;

    // Clamp values to reasonable ranges
    x = Math.max(-10, Math.min(10, x));
    y = Math.max(-10, Math.min(10, y));
    z = Math.max(-10, Math.min(10, z));

    // Use RGB components
    const r = Math.abs(x) * 127 + 128;
    const g = Math.abs(y) * 127 + 128;
    const b = Math.abs(z) * 127 + 128;

    ctx.fillStyle = `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 6px monospace";
    ctx.textAlign = "center";

    // Safe toFixed calls
    ctx.fillText(`X:${x.toFixed(2)}`, size / 2, 10);
    ctx.fillText(`Y:${y.toFixed(2)}`, size / 2, 20);
    ctx.fillText(`Z:${z.toFixed(2)}`, size / 2, 30);

    // Add expression indicators for any parameter that's an expression
    if (this.isExpression(node, "x") || this.isExpression(node, "y") || this.isExpression(node, "z")) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderUV(ctx, node) {
    const size = ctx.canvas.width;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const r = Math.floor(u * 255);
        const g = Math.floor(v * 255);
        ctx.fillStyle = `rgb(${r}, ${g}, 128)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Grid lines
    ctx.strokeStyle = "#ffffff80";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
  }

renderTime(ctx, node) {
    const size = ctx.canvas.width;
  // NEVER access dynamic values in preview renderers
  // Use a simple static time value or visual representation
  const time = (Date.now() / 1000) % (Math.PI * 2);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, size, size);

  // Sine wave
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x < size; x++) {
    const t = (x / size) * Math.PI * 2;
    const y = size / 2 + Math.sin(t + time) * size * 0.3;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Time indicator
  const indicatorX = (time / (Math.PI * 2)) * size;
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(indicatorX, size / 2, 2, 0, Math.PI * 2);
  ctx.fill();

  // DON'T call isExpression or getParameterValue here
  // Just render a static preview
}

  renderExpression(ctx, node) {
    const size = ctx.canvas.width;
    const expr = this.getParameterValue(node, "expr", node.expr || "x");

    ctx.fillStyle = "#0c1821";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let hasValidPlot = false;
    let firstPoint = true;

    for (let x = 0; x < size; x++) {
      try {
        const mathX = (x / size) * 4 - 2;
        const inputs = this.previewSystem.getConnectedInputs(node);
        const a = inputs.a !== undefined ? inputs.a : mathX;
        const b = inputs.b !== undefined ? inputs.b : 0;

        const variables = {
          x: mathX,
          a: a,
          b: b,
          t: (Date.now() / 1000) % (Math.PI * 2),
          u_time: mathX * 10 + Date.now() / 1000,
          pi: Math.PI,
          PI: Math.PI,
        };

        const result = this._evaluateExpression(expr, variables);

        if (typeof result === "number" && isFinite(result)) {
          const variationFromBase = result - a;
          const amplifiedY = size / 2 - variationFromBase * 1000;
          const clampedY = Math.max(0, Math.min(size - 1, amplifiedY));

          if (firstPoint) {
            ctx.moveTo(x, clampedY);
            firstPoint = false;
          } else {
            ctx.lineTo(x, clampedY);
          }
          hasValidPlot = true;
        }
      } catch (e) {
        console.warn("Expression evaluation failed at x=", x, ":", e);
      }
    }

    if (hasValidPlot) {
      ctx.stroke();
    } else {
      ctx.fillStyle = "#ff4444";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ERR", size / 2, size / 2);
    }

    // Expression label
    ctx.fillStyle = "#10b981";
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    const displayExpr = expr.length > 10 ? expr.substring(0, 10) + "..." : expr;
    ctx.fillText(displayExpr, 2, size - 2);

    // Always show expression indicator for expression nodes
    this.drawExpressionIndicator(ctx);
  }

renderOutput(ctx, node) {
    const size = ctx.canvas.width;
  // Get the connected input node ID
  const inputNodeId = node.inputs?.[0];
  
  if (inputNodeId) {
    // Find the input node
    const graph = window.editor?.graph;
    const inputNode = graph?.nodes?.find(n => n.id === inputNodeId);
    
    if (inputNode) {
      // Try to get the already-rendered canvas for this node
      const canvasManager = this.previewSystem.canvasManager;
      
      if (canvasManager) {
        const inputCanvas = canvasManager.getCanvas(inputNodeId);
        
        if (inputCanvas) {
          // Draw the input node's canvas
          ctx.drawImage(inputCanvas, 0, 0, size, size);
          
          // Add a border to indicate this is an output
          ctx.strokeStyle = "rgba(76, 175, 80, 0.5)";
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, size - 2, size - 2);
          
          if (this.hasExpressions(node)) {
            this.drawExpressionIndicator(ctx);
          }
          return;
        }
      }
    }
  }

  // Fallback rendering
  const inputs = this.previewSystem.getConnectedInputs(node);
  const value = inputs.input || inputs.color || inputs.value || this.getParameterValue(node, "value", 0);

  if (typeof value === "number") {
    const intensity = Math.max(0, Math.min(1, value));
    const color = Math.floor(intensity * 255);
    ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
    ctx.fillRect(0, 0, size, size);
  } else if (typeof value === "object" && value !== null) {
    const r = Math.floor((value.x || value.r || 0) * 255);
    const g = Math.floor((value.y || value.g || 0) * 255);
    const b = Math.floor((value.z || value.b || 0) * 255);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, size, size);
  } else {
    const hash = this._hashString(node.kind);
    const hue = hash % 360;
    ctx.fillStyle = `hsl(${hue}, 60%, 25%)`;
    ctx.fillRect(0, 0, size, size);
  }

  if (this.hasExpressions(node)) {
    this.drawExpressionIndicator(ctx);
  }
}
  // Helper methods for expression system integration

  isExpression(node, paramName) {
    try {
      const rawValue = node.params?.[paramName];
      return typeof rawValue === 'string' && rawValue.trim().startsWith('=');
    } catch (error) {
      return false;
    }
  }

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

  drawExpressionIndicator(ctx) {
    // Draw a small "fx" indicator in the top-right corner
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

  // Existing helper methods (preserved)

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

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }
}