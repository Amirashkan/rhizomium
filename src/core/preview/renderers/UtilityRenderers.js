// src/core/preview/renderers/UtilityRenderers.js - Complete implementation with expression support

export class UtilityRenderers {
  constructor(previewSystem) {
    this.previewSystem = previewSystem;
    this.size = previewSystem.size;
  }

  register(registry) {
    registry.registerMultiple({
      'combine': (ctx, node) => this.renderCombine(ctx, node),
      'switch': (ctx, node) => this.renderSwitch(ctx, node),
      'remap': (ctx, node) => this.renderRemap(ctx, node),
      'invert': (ctx, node) => this.renderInvert(ctx, node),
      'threshold': (ctx, node) => this.renderThreshold(ctx, node),
      'posterize': (ctx, node) => this.renderPosterize(ctx, node),
      'gamma': (ctx, node) => this.renderGamma(ctx, node),
      'contrast': (ctx, node) => this.renderContrast(ctx, node),
      'brightness': (ctx, node) => this.renderBrightness(ctx, node),
      'conditional': (ctx, node) => this.renderConditional(ctx, node),
      'step': (ctx, node) => this.renderStep(ctx, node),
      'pulse': (ctx, node) => this.renderPulse(ctx, node)
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

  // Draw parameter info overlay
  drawParameterInfo(ctx, params) {
    ctx.save();
    ctx.fillStyle = "#00000080";
    ctx.fillRect(0, this.size - 20, this.size, 20);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    
    let y = this.size - 14;
    Object.entries(params).forEach(([key, value], index) => {
      if (index < 3) { // Show up to 3 parameters
        const displayValue = typeof value === 'number' ? value.toFixed(2) : value;
        ctx.fillText(`${key}:${displayValue}`, 2, y + index * 6);
      }
    });
    
    ctx.restore();
  }

  renderCombine(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const mode = this.getParameterValue(node, "mode", "add");
    const factor = this.toSafeNumber(this.getParameterValue(node, "factor", 0.5), 0.5);

    const a = this.toSafeNumber(inputs.a, 0.5);
    const b = this.toSafeNumber(inputs.b, 0.5);

    let result;
    switch (mode) {
      case "multiply":
        result = a * b;
        break;
      case "screen":
        result = 1 - (1 - a) * (1 - b);
        break;
      case "overlay":
        result = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
        break;
      case "mix":
        result = a * (1 - factor) + b * factor;
        break;
      default: // add
        result = a + b;
    }

    result = Math.max(0, Math.min(1, result));

    // Background
    const hue = result * 60; // Orange to yellow spectrum
    ctx.fillStyle = `hsl(${hue}, 70%, 40%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    // Visual representation
    this.drawCombineVisualization(ctx, mode, a, b, result, factor);

    this.drawParameterInfo(ctx, { mode, factor, result: result.toFixed(2) });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  drawCombineVisualization(ctx, mode, a, b, result, factor) {
    const centerX = this.size / 2;
    const centerY = this.size / 2;

    // Input A bar
    ctx.fillStyle = "#ff444480";
    ctx.fillRect(4, 4, (this.size - 8) * a, 6);

    // Input B bar
    ctx.fillStyle = "#44ff4480";
    ctx.fillRect(4, 12, (this.size - 8) * b, 6);

    // Result bar
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(4, 20, (this.size - 8) * result, 6);

    // Mode symbol
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    let symbol = "+";
    switch (mode) {
      case "multiply": symbol = "×"; break;
      case "screen": symbol = "S"; break;
      case "overlay": symbol = "O"; break;
      case "mix": symbol = "M"; break;
    }
    ctx.fillText(symbol, centerX, centerY + 4);
  }

  renderSwitch(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const selector = this.toSafeNumber(inputs.selector || this.getParameterValue(node, "selector", 0), 0);
    const inputA = this.toSafeNumber(inputs.a, 0.2);
    const inputB = this.toSafeNumber(inputs.b, 0.8);
    const threshold = this.toSafeNumber(this.getParameterValue(node, "threshold", 0.5), 0.5);

    const result = selector > threshold ? inputB : inputA;

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, this.size, 0);
    gradient.addColorStop(0, `hsl(${inputA * 60}, 70%, 40%)`);
    gradient.addColorStop(threshold, `hsl(${inputA * 60}, 70%, 40%)`);
    gradient.addColorStop(threshold, `hsl(${inputB * 60}, 70%, 40%)`);
    gradient.addColorStop(1, `hsl(${inputB * 60}, 70%, 40%)`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.size, this.size);

    // Switch indicator
    const switchX = selector * this.size;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(switchX - 2, 0, 4, this.size);

    // Threshold line
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(threshold * this.size, 0);
    ctx.lineTo(threshold * this.size, this.size);
    ctx.stroke();

    this.drawParameterInfo(ctx, { 
      sel: selector.toFixed(2), 
      thresh: threshold.toFixed(2), 
      result: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderRemap(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const inMin = this.toSafeNumber(this.getParameterValue(node, "inMin", 0.0), 0.0);
    const inMax = this.toSafeNumber(this.getParameterValue(node, "inMax", 1.0), 1.0);
    const outMin = this.toSafeNumber(this.getParameterValue(node, "outMin", 0.0), 0.0);
    const outMax = this.toSafeNumber(this.getParameterValue(node, "outMax", 1.0), 1.0);

    // Remap calculation
    const normalized = (input - inMin) / Math.max(0.0001, inMax - inMin);
    const result = outMin + normalized * (outMax - outMin);

    ctx.fillStyle = "#2a4a4a";
    ctx.fillRect(0, 0, this.size, this.size);

    // Draw mapping curve
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x < this.size; x++) {
      const t = x / this.size;
      const mappedT = (t - inMin / (inMax - inMin)) / Math.max(0.0001, 1 / (inMax - inMin));
      const outputT = outMin + mappedT * (outMax - outMin);
      const y = this.size - Math.max(0, Math.min(1, outputT)) * this.size;
      
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Input/output indicators
    const inputX = Math.max(0, Math.min(1, (input - inMin) / (inMax - inMin))) * this.size;
    const outputY = this.size - Math.max(0, Math.min(1, result)) * this.size;

    ctx.fillStyle = "#ff4444";
    ctx.fillRect(inputX - 2, this.size - 4, 4, 4);
    
    ctx.fillStyle = "#44ff44";
    ctx.fillRect(this.size - 4, outputY - 2, 4, 4);

    this.drawParameterInfo(ctx, { 
      in: input.toFixed(2), 
      out: result.toFixed(2),
      range: `${inMin.toFixed(1)}-${inMax.toFixed(1)}`
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderInvert(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const result = 1.0 - input;

    // Gradient from input to result
    const gradient = ctx.createLinearGradient(0, 0, this.size, 0);
    gradient.addColorStop(0, `hsl(${input * 60}, 70%, 40%)`);
    gradient.addColorStop(1, `hsl(${result * 60}, 70%, 40%)`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.size, this.size);

    // Invert symbol
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("~", this.size / 2, this.size / 2 + 6);

    this.drawParameterInfo(ctx, { 
      in: input.toFixed(2), 
      out: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderThreshold(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const threshold = this.toSafeNumber(this.getParameterValue(node, "threshold", 0.5), 0.5);
    const result = input > threshold ? 1.0 : 0.0;

    // Background
    ctx.fillStyle = result > 0.5 ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, this.size, this.size);

    // Threshold visualization
    const barHeight = 8;
    const barY = this.size - 20;
    
    // Input bar
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(0, barY, input * this.size, barHeight);
    
    // Threshold line
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(threshold * this.size, barY - 4);
    ctx.lineTo(threshold * this.size, barY + barHeight + 4);
    ctx.stroke();

    // Label
    ctx.fillStyle = result > 0.5 ? "#000000" : "#ffffff";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("THRESH", this.size / 2, this.size / 2);

    this.drawParameterInfo(ctx, { 
      in: input.toFixed(2), 
      thresh: threshold.toFixed(2), 
      out: result.toFixed(0) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderPosterize(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const levels = Math.max(2, Math.round(this.toSafeNumber(this.getParameterValue(node, "levels", 4), 4)));
    
    const result = Math.floor(input * levels) / (levels - 1);

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, this.size, this.size);

    // Draw posterization steps
    const stepWidth = this.size / levels;
    for (let i = 0; i < levels; i++) {
      const value = i / (levels - 1);
      const color = Math.floor(value * 255);
      ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
      ctx.fillRect(i * stepWidth, 0, stepWidth, this.size);
    }

    // Input indicator
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(input * this.size, 0);
    ctx.lineTo(input * this.size, this.size);
    ctx.stroke();

    this.drawParameterInfo(ctx, { 
      levels, 
      in: input.toFixed(2), 
      out: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderGamma(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const gamma = this.toSafeNumber(this.getParameterValue(node, "gamma", 2.2), 2.2);
    
    const result = Math.pow(input, gamma);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, this.size, this.size);

    // Draw gamma curve
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x < this.size; x++) {
      const t = x / this.size;
      const gammaT = Math.pow(t, gamma);
      const y = this.size - gammaT * this.size;
      
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Input/output point
    const inputX = input * this.size;
    const outputY = this.size - result * this.size;
    
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(inputX, outputY, 3, 0, Math.PI * 2);
    ctx.fill();

    this.drawParameterInfo(ctx, { 
      gamma: gamma.toFixed(1), 
      in: input.toFixed(2), 
      out: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderContrast(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const contrast = this.toSafeNumber(this.getParameterValue(node, "contrast", 1.0), 1.0);
    
    // Contrast formula: (input - 0.5) * contrast + 0.5
    const result = Math.max(0, Math.min(1, (input - 0.5) * contrast + 0.5));

    const intensity = Math.abs(contrast - 1.0);
    const hue = contrast > 1.0 ? 0 : 240; // Red for increase, blue for decrease
    
    ctx.fillStyle = `hsl(${hue}, ${intensity * 100}%, 30%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    // Contrast visualization
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CONT", this.size / 2, this.size / 2);

    this.drawParameterInfo(ctx, { 
      contrast: contrast.toFixed(1), 
      in: input.toFixed(2), 
      out: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderBrightness(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const brightness = this.toSafeNumber(this.getParameterValue(node, "brightness", 0.0), 0.0);
    
    const result = Math.max(0, Math.min(1, input + brightness));

    const baseIntensity = Math.floor((input + 0.5) * 127);
    const resultIntensity = Math.floor((result + 0.5) * 127);
    
    ctx.fillStyle = `rgb(${resultIntensity}, ${resultIntensity}, ${resultIntensity})`;
    ctx.fillRect(0, 0, this.size, this.size);

    // Brightness indicator
    ctx.fillStyle = brightness > 0 ? "#ffff00" : "#4444ff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("BRIT", this.size / 2, this.size / 2);

    this.drawParameterInfo(ctx, { 
      bright: brightness.toFixed(2), 
      in: input.toFixed(2), 
      out: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderConditional(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const condition = this.toSafeNumber(inputs.condition || this.getParameterValue(node, "condition", 0), 0);
    const trueValue = this.toSafeNumber(inputs.trueValue || this.getParameterValue(node, "trueValue", 1.0), 1.0);
    const falseValue = this.toSafeNumber(inputs.falseValue || this.getParameterValue(node, "falseValue", 0.0), 0.0);
    const threshold = this.toSafeNumber(this.getParameterValue(node, "threshold", 0.5), 0.5);

    const result = condition > threshold ? trueValue : falseValue;

    // Split screen visualization
    const splitX = condition * this.size;
    
    // False side
    const falseColor = Math.floor(falseValue * 255);
    ctx.fillStyle = `rgb(${falseColor}, ${falseColor}, ${falseColor})`;
    ctx.fillRect(0, 0, splitX, this.size);
    
    // True side
    const trueColor = Math.floor(trueValue * 255);
    ctx.fillStyle = `rgb(${trueColor}, ${trueColor}, ${trueColor})`;
    ctx.fillRect(splitX, 0, this.size - splitX, this.size);

    // Threshold line
    ctx.strokeStyle = "#ff00ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(threshold * this.size, 0);
    ctx.lineTo(threshold * this.size, this.size);
    ctx.stroke();

    this.drawParameterInfo(ctx, { 
      cond: condition.toFixed(2), 
      result: result.toFixed(2) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderStep(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const edge = this.toSafeNumber(this.getParameterValue(node, "edge", 0.5), 0.5);
    
    const result = input < edge ? 0.0 : 1.0;

    // Background
    ctx.fillStyle = result > 0.5 ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, this.size, this.size);

    // Step visualization
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, this.size);
    ctx.lineTo(edge * this.size, this.size);
    ctx.lineTo(edge * this.size, 0);
    ctx.lineTo(this.size, 0);
    ctx.stroke();

    // Input indicator
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(input * this.size - 2, this.size - 6, 4, 6);

    this.drawParameterInfo(ctx, { 
      in: input.toFixed(2), 
      edge: edge.toFixed(2), 
      out: result.toFixed(0) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }

  renderPulse(ctx, node) {
    const inputs = this.previewSystem.getConnectedInputs(node);
    const input = this.toSafeNumber(inputs.input || inputs.a, 0.5);
    const width = this.toSafeNumber(this.getParameterValue(node, "width", 0.1), 0.1);
    const center = this.toSafeNumber(this.getParameterValue(node, "center", 0.5), 0.5);
    
    const distance = Math.abs(input - center);
    const result = distance < width / 2 ? 1.0 : 0.0;

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, this.size, this.size);

    // Pulse visualization
    const pulseStart = (center - width / 2) * this.size;
    const pulseEnd = (center + width / 2) * this.size;
    
    ctx.fillStyle = "#00ff88";
    ctx.fillRect(Math.max(0, pulseStart), 0, Math.min(this.size, pulseEnd - pulseStart), this.size);

    // Input indicator
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(input * this.size - 1, 0, 2, this.size);

    this.drawParameterInfo(ctx, { 
      in: input.toFixed(2), 
      width: width.toFixed(2), 
      out: result.toFixed(0) 
    });

    if (this.hasExpressions(node)) {
      this.drawExpressionIndicator(ctx);
    }
  }
}