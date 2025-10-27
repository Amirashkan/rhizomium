// src/core/Renderer.js
import { NodeDefs } from "../data/NodeDefs.js";

export class Renderer {
  constructor(ctx, viewport) {
    this.ctx = ctx;
    this.viewport = viewport;
  }

  render(graph, renderState) {
    const ctx = this.ctx;
    if (renderState.editor) {
      window.editor = renderState.editor; // Make editor accessible
    }
    // Clear canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Subtle grid background for alignment
    this._renderBackgroundGrid();

    // Save context and apply viewport transform
    ctx.save();
    ctx.translate(this.viewport.offsetX, this.viewport.offsetY);
    ctx.scale(this.viewport.scale, this.viewport.scale);

    // Render connections/wires
    this._renderConnections(graph.connections, graph.nodes);

    // Render drag wire if active
    if (renderState.dragWire) {
      this._renderDragWire(renderState.dragWire, graph.nodes);
    }

    // Render nodes
    this._renderNodes(graph.nodes, renderState.selection);

    // Render selection box if active
    if (renderState.boxSelect) {
      this._renderSelectionBox(renderState.boxSelect);
    }

    ctx.restore();
  }

  _renderBackgroundGrid() {
    const ctx = this.ctx;
    const editor = window.editor;
    const gridSize =
      typeof editor?.getSnapGridSize === "function"
        ? editor.getSnapGridSize()
        : 20;

    if (!Number.isFinite(gridSize) || gridSize <= 0) {
      return;
    }

    const scale = this.viewport.scale || 1;
    const offsetX = this.viewport.offsetX || 0;
    const offsetY = this.viewport.offsetY || 0;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    const minorSpacing = gridSize * scale;
    const majorSpacing = minorSpacing * 5;

    const drawLines = (spacing, alpha) => {
      if (!Number.isFinite(spacing) || spacing < 4) {
        return;
      }

      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;

      // Vertical lines
      let x = offsetX + Math.floor(-offsetX / spacing) * spacing;
      while (x < 0) {
        x += spacing;
      }
      for (; x <= width; x += spacing) {
        const px = Math.round(x) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }

      // Horizontal lines
      let y = offsetY + Math.floor(-offsetY / spacing) * spacing;
      while (y < 0) {
        y += spacing;
      }
      for (; y <= height; y += spacing) {
        const py = Math.round(y) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }

      ctx.stroke();
    };

    ctx.save();
    drawLines(minorSpacing, 0.025);
    drawLines(majorSpacing, 0.07);
    ctx.restore();
  }

  _renderConnections(connections, nodes) {
    const ctx = this.ctx;
    ctx.lineWidth = 2;

    for (const c of connections) {
      const fromNode = nodes.find((n) => n.id === c.from.nodeId);
      const toNode = nodes.find((n) => n.id === c.to.nodeId);
      if (!fromNode || !toNode) continue;

      const fromPos = this._getOutputPinPosition(fromNode, c.from.pin);
      const toPos = this._getInputPinPosition(toNode, c.to.pin);
      if (!fromPos || !toPos) continue;

      // Get wire color based on output type
      const srcType =
        NodeDefs[fromNode.kind]?.pinsOut?.[c.from.pin]?.type || "default";
      const color = this._getWireColor(srcType);

      ctx.strokeStyle = color;
      this._drawBezierCurve(fromPos.x, fromPos.y, toPos.x, toPos.y);
    }
  }

  _renderDragWire(dragWire, nodes) {
    const ctx = this.ctx;
    const fromNode = nodes.find((n) => n.id === dragWire.from.nodeId);
    if (!fromNode) return;

    const fromPos = this._getOutputPinPosition(fromNode, dragWire.from.pin);
    if (!fromPos) return;

    const srcType =
      NodeDefs[fromNode.kind]?.pinsOut?.[dragWire.from.pin]?.type || "default";
    const color = this._getWireColor(srcType);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    this._drawBezierCurve(fromPos.x, fromPos.y, dragWire.pos.x, dragWire.pos.y);
  }

  _renderNodes(nodes, selection) {
    for (const node of nodes) {
      this._renderNode(node, selection.has(node.id));
    }
  }

  // Replace your _renderNode method in Renderer.js with this:

  _renderNode(node, isSelected) {
    const ctx = this.ctx;

    // Make sure nodes have proper dimensions
    if (!node.w) node.w = 120; // Default width
    if (!node.h) node.h = 80; // Default height

    // Enhanced node background with gradient
    const gradient = ctx.createLinearGradient(
      node.x,
      node.y,
      node.x,
      node.y + node.h,
    );
    gradient.addColorStop(0, "#252525");
    gradient.addColorStop(1, "#1b1b1b");

    ctx.fillStyle = gradient;
    ctx.strokeStyle = isSelected ? "#66aaff" : "#404040";
    ctx.lineWidth = isSelected ? 2 : 1;

    // Draw the main node rectangle
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, 8);
    ctx.fill();
    ctx.stroke();

    // Add subtle inner glow for selected nodes
    if (isSelected) {
      ctx.save();
      ctx.shadowColor = "#66aaff";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "rgba(102, 170, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(node.x + 1, node.y + 1, node.w - 2, node.h - 2, 7);
      ctx.stroke();
      ctx.restore();
    }

    // Draw node category indicator (small colored bar on the left)
    const categoryColor = this._getCategoryColor(
      NodeDefs[node.kind]?.cat || "default",
    );
    ctx.fillStyle = categoryColor;
    ctx.fillRect(node.x, node.y + 8, 3, node.h - 16);

    // Draw node label with better typography
    ctx.fillStyle = "#e8e8e8";
    ctx.font = `${Math.max(10, 12 / this.viewport.scale)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
    ctx.fontWeight = "500";
    const label = NodeDefs[node.kind]?.label || node.kind;
    ctx.fillText(label, node.x + 10, node.y + 18);

    // Draw node ID (for referencing in expressions)
    ctx.fillStyle = "#888";
    ctx.font = `${Math.max(8, 9 / this.viewport.scale)}px monospace`;
    ctx.fillText(`#${node.id}`, node.x + node.w - ctx.measureText(`#${node.id}`).width - 6, node.y + 16);

    // Render enhanced thumbnail
    this._renderNodeThumbnail(node);

    // Render preview controls
    this._renderPreviewControls(node);

    // Render pins with enhanced styling
    this._renderNodePins(node);

    // Add subtle drop shadow for depth (only for non-selected nodes)
    if (!isSelected) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.roundRect(node.x + 2, node.y + 2, node.w, node.h, 8);
      ctx.fill();
      ctx.restore();
    }
  }

  // Also make sure this method exists for category colors:
  _getCategoryColor(category) {
    switch (category) {
      case "Input":
        return "#10b981"; // Emerald
      case "Math":
        return "#f59e0b"; // Amber
      case "Field":
        return "#8b5cf6"; // Violet
      case "Utility":
        return "#06b6d4"; // Cyan
      case "Output":
        return "#ef4444"; // Red
      case "Misc":
        return "#6b7280"; // Gray
      default:
        return "#6b7280"; // Gray
    }
  }

  _renderPreviewControls(node) {
    const editor = window.editor;
    if (!editor || !editor.shouldShowPreview(node)) return;

    const ctx = this.ctx;
    const controlY = node.y + 50;
    const buttonWidth = 12;
    const buttonHeight = 10;

    // FIXED: Use property instead of function call
    const isPreviewEnabled = editor.isPreviewEnabled;

    ctx.save();
    ctx.font = `${Math.max(8, 9 / this.viewport.scale)}px ui-monospace, Consolas, monospace`;

    // Button 1: Hide visual info - "X"
    const hideX = node.x + node.w - 65;
    const showVisualInfo = editor.isVisualInfoEnabled(node.id);

    ctx.fillStyle = showVisualInfo
      ? "rgba(68, 68, 68, 0.3)"
      : "rgba(255, 68, 68, 0.2)";
    ctx.beginPath();
    ctx.roundRect(hideX - 1, controlY - 8, buttonWidth, buttonHeight, 2);
    ctx.fill();

    ctx.fillStyle = showVisualInfo ? "#666" : "#ff4444";
    ctx.fillText("X", hideX + 3, controlY - 1);

    // Button 2: Preview toggle - "•" when on, "○" when off
    const eyeX = node.x + node.w - 45;

    ctx.fillStyle = isPreviewEnabled
      ? "rgba(0, 255, 136, 0.2)"
      : "rgba(68, 68, 68, 0.3)";
    ctx.beginPath();
    ctx.roundRect(eyeX - 1, controlY - 8, buttonWidth, buttonHeight, 2);
    ctx.fill();

    ctx.fillStyle = isPreviewEnabled ? "#00ff88" : "#666";
    ctx.fillText(isPreviewEnabled ? "•" : "○", eyeX + 3, controlY - 1);

    // Button 3: Size cycle - "S/M/L" (disabled when preview off)
    const sizeX = node.x + node.w - 25;
    const currentSize = editor.nodePreviews.get(node.id)?.size || "small";
    const sizeLabel =
      currentSize === "small" ? "S" : currentSize === "medium" ? "M" : "L";
    const sizeDisabled = !isPreviewEnabled;

    ctx.fillStyle = sizeDisabled
      ? "rgba(40, 40, 40, 0.3)"
      : "rgba(68, 68, 68, 0.3)";
    ctx.beginPath();
    ctx.roundRect(sizeX - 1, controlY - 8, buttonWidth, buttonHeight, 2);
    ctx.fill();

    ctx.fillStyle = sizeDisabled ? "#333" : "#888";
    ctx.fillText(sizeLabel, sizeX + 3, controlY - 1);

    ctx.restore();
  }

  // Update for Renderer.js _renderNodeThumbnail method
  // Replace your _renderNodeThumbnail method in Renderer.js with this:

  // Replace your _renderNodeThumbnail method with this:

  _renderNodeThumbnail(node) {
    const editor = window.editor;

    // Only render if this specific node has a thumbnail
    if (!node.__thumb) return;

    // Skip if editor doesn't exist (shouldn't happen, but safety check)
    if (!editor) return;

    const ctx = this.ctx;
    const thumbSize = editor.getPreviewSize(node.id);
    const padding = 6;

    // Smart positioning based on thumbnail size
    let thumbX, thumbY;

    if (thumbSize <= 64) {
      // Small/Medium: Traditional positioning
      thumbX = node.x + node.w - thumbSize - padding;
      thumbY = node.y + padding;
    } else {
      // Large: Position below node title to avoid overlap
      thumbX = node.x + padding;
      thumbY = node.y + 25; // Below title
    }

    ctx.save();

    // Thumbnail background
    ctx.fillStyle = "#0a0a0a";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(thumbX - 1, thumbY - 1, thumbSize + 2, thumbSize + 2, 4);
    ctx.fill();
    ctx.stroke();

    // Enable smooth scaling for high-quality thumbnails
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Handle both ImageData and Canvas thumbnails
    if (node.__thumb instanceof HTMLCanvasElement) {
      ctx.drawImage(node.__thumb, thumbX, thumbY, thumbSize, thumbSize);
    } else if (node.__thumb instanceof ImageData) {
      // Create temporary canvas for ImageData
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = node.__thumb.width;
      tempCanvas.height = node.__thumb.height;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.putImageData(node.__thumb, 0, 0);
      ctx.drawImage(tempCanvas, thumbX, thumbY, thumbSize, thumbSize);
    }

    // Inner border for clarity
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(thumbX, thumbY, thumbSize, thumbSize, 3);
    ctx.stroke();

    ctx.restore();
  }

  _renderNodePins(node) {
    const ctx = this.ctx;
    const { inputPins, outputPins } = this._getNodePinPositions(node);

    // Enhanced pin rendering with glow effects
    ctx.save();

    // Render output pins with enhanced styling
    for (const [i, pos] of outputPins.entries()) {
      const pinType = NodeDefs[node.kind]?.pinsOut?.[i]?.type || "default";
      const pinColor = this._getWireColor(pinType);

      // Pin glow effect
      ctx.shadowColor = pinColor;
      ctx.shadowBlur = 8;
      ctx.fillStyle = pinColor;
      this._drawEnhancedPin(pos.x, pos.y, 5, "output");

      // Reset shadow for label
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      this._renderOutputPinLabel(node, i, pos);
    }

    // Render input pins with enhanced styling
    for (const [i, pos] of inputPins.entries()) {
      const connected = node.inputs && node.inputs[i];
      const pinColor = connected ? "#ff7a7a" : "#444";

      if (connected) {
        ctx.shadowColor = "#ff7a7a";
        ctx.shadowBlur = 6;
      }

      ctx.fillStyle = pinColor;
      this._drawEnhancedPin(pos.x, pos.y, 4, "input");

      // Input pin label
      if (!connected) {
        const inputLabel = NodeDefs[node.kind]?.pinsIn?.[i] || `In${i}`;
        ctx.fillStyle = "#666";
        ctx.font = `${Math.max(8, 9 / this.viewport.scale)}px ui-monospace, Consolas, monospace`;
        ctx.fillText(
          inputLabel,
          pos.x - ctx.measureText(inputLabel).width - 8,
          pos.y + 3,
        );
      }
    }

    ctx.restore();
  }

  _drawEnhancedPin(x, y, radius, type) {
    const ctx = this.ctx;

    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, radius + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Main pin
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Inner highlight
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  _renderOutputPinLabel(node, pinIndex, pinPos) {
    const editor = window.editor;

    // FIXED: Use property instead of function call
    if (!editor || !editor.isPreviewEnabled) return;

    const ctx = this.ctx;
    const pinDef = NodeDefs[node.kind]?.pinsOut?.[pinIndex];
    const pinType = pinDef?.type || "•";

    let labelText = pinType;

    // Use computed preview values from PreviewComputer
    // This correctly handles expressions like =node_1
    let previewValue = node.__preview;

    // Try to get from PreviewComputer if available (most up-to-date)
    if (editor.previewComputer && editor.previewComputer.lastComputedValues) {
      const computedValue = editor.previewComputer.lastComputedValues.get(node.id);
      if (computedValue !== undefined) {
        previewValue = computedValue;
      }
    }

    console.log(`[Renderer] Node ${node.id} (${node.kind}) pin ${pinIndex}: previewValue =`, previewValue);

    // Format the preview value
    if (previewValue !== undefined && previewValue !== null) {
      if (typeof previewValue === 'number') {
        // Single number output
        labelText = previewValue.toFixed(2);
      } else if (Array.isArray(previewValue)) {
        // Vector output
        if (pinIndex > 0 && previewValue.length > pinIndex) {
          // Multi-output node - show specific component
          labelText = previewValue[pinIndex].toFixed(2);
        } else if (previewValue.length === 2) {
          labelText = `(${previewValue[0].toFixed(1)}, ${previewValue[1].toFixed(1)})`;
        } else if (previewValue.length === 3) {
          labelText = `(${previewValue[0].toFixed(1)}, ${previewValue[1].toFixed(1)}, ${previewValue[2].toFixed(1)})`;
        } else if (previewValue.length === 4) {
          labelText = `(${previewValue[0].toFixed(1)}, ${previewValue[1].toFixed(1)}, ${previewValue[2].toFixed(1)}, ${previewValue[3].toFixed(1)})`;
        }
      } else if (typeof previewValue === 'object' && previewValue.type === 'split') {
        // Split node - show component value
        if (previewValue.values && previewValue.values[pinIndex] !== undefined) {
          labelText = previewValue.values[pinIndex].toFixed(2);
        }
      }
    } else {
      // Fallback to old behavior for specific node types
      if (node.kind === "ConstFloat") {
        const value = typeof node.value === "number" ? node.value : (node.params?.value ?? 0);
        if (typeof value === 'number') {
          labelText = `${value.toFixed(2)}`;
        }
      } else if (node.kind === "ConstVec2") {
        const x = node.params?.x ?? node.x ?? 0;
        const y = node.params?.y ?? node.y ?? 0;
        labelText = `(${x.toFixed(1)}, ${y.toFixed(1)})`;
      } else if (node.kind === "ConstVec3") {
        const x = node.params?.x ?? node.x ?? 0;
        const y = node.params?.y ?? node.y ?? 0;
        const z = node.params?.z ?? node.z ?? 0;
        labelText = `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
      } else if (node.kind === "Expr" && node.expr) {
        labelText =
          node.expr.length > 8 ? node.expr.substring(0, 8) + "..." : node.expr;
      } else if (pinDef?.label) {
        labelText = pinDef.label;
      }
    }

    // Skip label if it would be too cramped
    if (this.viewport.scale < 0.7) return;

    ctx.save();
    ctx.font = `${Math.max(8, 9 / this.viewport.scale)}px ui-monospace, Consolas, monospace`;
    const textWidth = ctx.measureText(labelText).width + 8;

    // Enhanced label background with gradient
    const gradient = ctx.createLinearGradient(
      pinPos.x + 8,
      pinPos.y - 8,
      pinPos.x + 8,
      pinPos.y + 4,
    );
    gradient.addColorStop(0, "rgba(20, 20, 25, 0.95)");
    gradient.addColorStop(1, "rgba(15, 15, 20, 0.95)");

    ctx.fillStyle = gradient;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pinPos.x + 8, pinPos.y - 8, textWidth, 12, 3);
    ctx.fill();
    ctx.stroke();

    // Label text with better color based on pin type
    const textColor = this._getWireColor(pinType);
    ctx.fillStyle = textColor;
    ctx.fillText(labelText, pinPos.x + 12, pinPos.y + 2);
    ctx.restore();
  }

  _renderSelectionOutline(node) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([]);
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#66aaff";
    ctx.beginPath();
    ctx.roundRect(node.x - 2, node.y - 2, node.w + 4, node.h + 4, 10);
    ctx.stroke();
    ctx.restore();
  }

  _renderSelectionBox(boxSelect) {
    const ctx = this.ctx;
    const x0 = Math.min(boxSelect.x0, boxSelect.x1);
    const y0 = Math.min(boxSelect.y0, boxSelect.y1);
    const x1 = Math.max(boxSelect.x0, boxSelect.x1);
    const y1 = Math.max(boxSelect.y0, boxSelect.y1);

    ctx.save();
    ctx.setLineDash([8, 4]);
    ctx.strokeStyle = "#66aaff";
    ctx.fillStyle = "rgba(102, 170, 255, 0.08)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  // Helper methods
  _getNodePinPositions(node) {
    const inputPins = [];
    for (let i = 0; i < (NodeDefs[node.kind]?.inputs || 0); i++) {
      inputPins.push({ x: node.x + 8, y: node.y + 32 + i * 18 });
    }

    const outputPins = [];
    const outCount = (NodeDefs[node.kind]?.pinsOut || []).length || 1;
    for (let i = 0; i < outCount; i++) {
      outputPins.push({ x: node.x + node.w - 8, y: node.y + 32 + i * 18 });
    }

    return { inputPins, outputPins };
  }

  _getInputPinPosition(node, pinIndex) {
    const { inputPins } = this._getNodePinPositions(node);
    return inputPins[pinIndex] || null;
  }

  _getOutputPinPosition(node, pinIndex) {
    const { outputPins } = this._getNodePinPositions(node);
    return outputPins[pinIndex] || null;
  }

  _getWireColor(type) {
    switch (type) {
      case "f32":
        return "#ffd166"; // Yellow for floats
      case "vec2":
        return "#40c9b4"; // Teal for vec2
      case "vec3":
        return "#d06bff"; // Purple for vec3
      case "vec4":
        return "#ff6b9d"; // Pink for vec4
      default:
        return "#9aa0a6"; // Gray for default
    }
  }

  _getCategoryColor(category) {
    // Colors that match the menu system categories
    switch (category) {
      case "Input":
        return "#10b981"; // Emerald
      case "Math":
        return "#f59e0b"; // Amber
      case "Field":
        return "#8b5cf6"; // Violet
      case "Utility":
        return "#06b6d4"; // Cyan
      case "Output":
        return "#ef4444"; // Red
      case "Misc":
        return "#6b7280"; // Gray
      default:
        return "#6b7280"; // Gray
    }
  }

  _drawBezierCurve(x1, y1, x2, y2) {
    const ctx = this.ctx;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);

    // Add subtle shadow to wires
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
    ctx.stroke();

    ctx.restore();
  }

  _drawPin(x, y, radius) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
