// src/core/preview/renderers/BasicRenderers.js

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

  renderFloat(ctx, node) {
    const value = this.previewSystem.getParameter(node, "value") || 0;
    const numValue = typeof value === "number" ? value : parseFloat(value) || 0;

    const intensity = Math.min(0.8, Math.abs(numValue) / 10);
    const hue = numValue >= 0 ? 120 : 0;

    ctx.fillStyle = `hsl(${hue}, 60%, ${10 + intensity * 30}%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = `hsl(${hue}, 80%, 80%)`;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text =
      Math.abs(numValue) < 0.01
        ? numValue.toExponential(1)
        : numValue.toFixed(2);

    ctx.fillText(text, this.size / 2, this.size / 2);

    // Grid pattern
    ctx.strokeStyle = `hsl(${hue}, 40%, 40%)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < this.size; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, this.size);
      ctx.moveTo(0, i);
      ctx.lineTo(this.size, i);
      ctx.stroke();
    }
  }

  renderVec3(ctx, node) {
    // Safe parameter access with type conversion and fallbacks
    let x = this.previewSystem.getParameter(node, "x");
    let y = this.previewSystem.getParameter(node, "y");
    let z = this.previewSystem.getParameter(node, "z");

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
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 6px monospace";
    ctx.textAlign = "center";

    // Safe toFixed calls
    ctx.fillText(`X:${x.toFixed(2)}`, this.size / 2, 10);
    ctx.fillText(`Y:${y.toFixed(2)}`, this.size / 2, 20);
    ctx.fillText(`Z:${z.toFixed(2)}`, this.size / 2, 30);
  }

  renderUV(ctx, node) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const u = x / this.size;
        const v = y / this.size;
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
    ctx.moveTo(this.size / 2, 0);
    ctx.lineTo(this.size / 2, this.size);
    ctx.moveTo(0, this.size / 2);
    ctx.lineTo(this.size, this.size / 2);
    ctx.stroke();
  }

  renderTime(ctx, node) {
    const time = (Date.now() / 1000) % (Math.PI * 2);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, this.size, this.size);

    // Sine wave
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x < this.size; x++) {
      const t = (x / this.size) * Math.PI * 2;
      const y = this.size / 2 + Math.sin(t + time) * this.size * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Time indicator
    const indicatorX = (time / (Math.PI * 2)) * this.size;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(indicatorX, this.size / 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  renderExpression(ctx, node) {
    const expr = this.previewSystem.getParameter(node, "expr") || node.expr || "x";

    ctx.fillStyle = "#0c1821";
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let hasValidPlot = false;
    let firstPoint = true;

    for (let x = 0; x < this.size; x++) {
      try {
        const mathX = (x / this.size) * 4 - 2;
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
          const amplifiedY = this.size / 2 - variationFromBase * 1000;
          const clampedY = Math.max(0, Math.min(this.size - 1, amplifiedY));

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
      ctx.fillText("ERR", this.size / 2, this.size / 2);
    }

    // Expression label
    ctx.fillStyle = "#10b981";
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    const displayExpr = expr.length > 10 ? expr.substring(0, 10) + "..." : expr;
    ctx.fillText(displayExpr, 2, this.size - 2);
  }

  renderOutput(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const value = inputs.input || inputs.color || inputs.value || 0;

    if (typeof value === "number") {
      const intensity = Math.max(0, Math.min(1, value));
      const color = Math.floor(intensity * 255);
      ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
      ctx.fillRect(0, 0, this.size, this.size);
    } else {
      // Fallback to generic rendering
      const hash = this._hashString(node.kind);
      const hue = hash % 360;

      ctx.fillStyle = `hsl(${hue}, 60%, 25%)`;
      ctx.fillRect(0, 0, this.size, this.size);

      ctx.fillStyle = `hsl(${hue}, 80%, 70%)`;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const label = node.kind.substring(0, 4);
      ctx.fillText(label, this.size / 2, this.size / 2);
    }
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

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }
}