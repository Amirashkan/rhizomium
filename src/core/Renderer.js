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

    // Always render grid background for visual consistency
    this._renderBackgroundGrid();
    
    // Store interaction state for use in node rendering (still used for other optimizations)
    const isInteracting = renderState.isInteracting || false;
    this._isInteracting = isInteracting;

    // Save context and apply viewport transform
    ctx.save();
    ctx.translate(this.viewport.offsetX, this.viewport.offsetY);
    ctx.scale(this.viewport.scale, this.viewport.scale);

    // PERFORMANCE: Create node lookup map for O(1) access instead of O(n) linear search
    // This is critical for performance with many nodes
    const nodeMap = new Map();
    for (const node of graph.nodes) {
      if (node && node.id) {
        nodeMap.set(node.id, node);
      }
    }

    // Render connections/wires
    this._renderConnections(graph.connections, nodeMap);

    // PERFORMANCE: Skip parameter reference lines during interactions (minor visual detail)
    if (!isInteracting) {
      // Render parameter reference lines (subtle lines for =node_X references)
      this._renderParameterReferences(graph.nodes, nodeMap);
    }

    // Render drag wire if active
    if (renderState.dragWire) {
      this._renderDragWire(renderState.dragWire, nodeMap, graph.connections);
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

  _renderConnections(connections, nodeMap) {
    const ctx = this.ctx;
    ctx.lineWidth = 2;

    // PERFORMANCE: Viewport culling during interactions - calculate viewport bounds
    let viewportBounds = null;
    if (this._isInteracting) {
      const canvas = ctx.canvas;
      const scale = this.viewport.scale;
      const offsetX = this.viewport.offsetX;
      const offsetY = this.viewport.offsetY;
      // Calculate world-space bounds of visible area
      const minX = -offsetX / scale;
      const maxX = (canvas.width - offsetX) / scale;
      const minY = -offsetY / scale;
      const maxY = (canvas.height - offsetY) / scale;
      // Add padding for bezier curves that might extend beyond nodes
      const padding = 100;
      viewportBounds = {
        minX: minX - padding,
        maxX: maxX + padding,
        minY: minY - padding,
        maxY: maxY + padding
      };
    }

    for (const c of connections) {
      // PERFORMANCE: Use Map lookup instead of linear search
      const fromNode = nodeMap.get(c.from.nodeId);
      const toNode = nodeMap.get(c.to.nodeId);
      if (!fromNode || !toNode) continue;

      const fromPos = this._getOutputPinPosition(fromNode, c.from.pin);
      const toPos = this._getInputPinPosition(toNode, c.to.pin);
      if (!fromPos || !toPos) continue;

      // PERFORMANCE: Skip connections that are completely off-screen during interactions
      if (viewportBounds) {
        const fromInBounds = fromPos.x >= viewportBounds.minX && fromPos.x <= viewportBounds.maxX &&
                             fromPos.y >= viewportBounds.minY && fromPos.y <= viewportBounds.maxY;
        const toInBounds = toPos.x >= viewportBounds.minX && toPos.x <= viewportBounds.maxX &&
                           toPos.y >= viewportBounds.minY && toPos.y <= viewportBounds.maxY;
        // Skip if both endpoints are outside viewport
        if (!fromInBounds && !toInBounds) {
          continue;
        }
      }

      // Get wire color based on output type
      const srcType =
        NodeDefs[fromNode.kind]?.pinsOut?.[c.from.pin]?.type || "default";
      const color = this._getWireColor(srcType);

      ctx.strokeStyle = color;
      this._drawBezierCurve(fromPos.x, fromPos.y, toPos.x, toPos.y);
    }
  }

  _renderParameterReferences(nodes, nodeMap) {
    const ctx = this.ctx;

    // Extract parameter references from all nodes
    for (const node of nodes) {
      if (!node.params) continue;

      // Check each parameter for node references
      for (const [paramKey, paramValue] of Object.entries(node.params)) {
        if (typeof paramValue !== 'string') continue;

        // Only process expressions that start with '='
        if (!paramValue.startsWith('=')) continue;

        // Extract node references like "=node_14" or "=node_14_x"
        const nodeRefs = this._extractNodeReferences(paramValue);

        for (const refNodeId of nodeRefs) {
          // Use loose comparison to handle both string and numeric IDs
          const refNode = nodes.find(n => n.id == refNodeId);
          if (!refNode) continue;

          // Draw a subtle dashed line from the parameter node to the referenced node
          this._drawParameterReferenceLine(node, refNode);
        }
      }
    }
  }

  _extractNodeReferences(paramValue) {
    const nodeIds = new Set();

    // Match patterns like "=node_14" or "=node_14_x"
    // This regex looks for "node_" followed by digits, with optional component suffixes
    const regex = /node_(\d+)(?:_[xyzw])?/g;
    let match;

    while ((match = regex.exec(paramValue)) !== null) {
      const nodeId = parseInt(match[1], 10);
      nodeIds.add(nodeId);
    }

    return Array.from(nodeIds);
  }

  _drawParameterReferenceLine(fromNode, toNode) {
    const ctx = this.ctx;

    // Calculate center positions of both nodes
    const fromX = fromNode.x + fromNode.w / 2;
    const fromY = fromNode.y + fromNode.h / 2;
    const toX = toNode.x + toNode.w / 2;
    const toY = toNode.y + toNode.h / 2;

    ctx.save();

    // Use a barely visible dashed line style
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(150, 150, 200, 0.3)'; // Subtle purple-blue
    ctx.lineWidth = 1;

    // Draw a straight line (not Bezier) for parameter references
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.restore();
  }

  _renderDragWire(dragWire, nodeMap, connections) {
    const ctx = this.ctx;
    // PERFORMANCE: Use Map lookup instead of linear search
    const fromNode = nodeMap.get(dragWire.from.nodeId);
    if (!fromNode) return;

    let fromPos, srcType;

    if (dragWire.isFromInput) {
      // Dragging from an input pin
      fromPos = this._getInputPinPosition(fromNode, dragWire.from.pin);
      if (!fromPos) return;

      // Try to get the type from the existing connection if there is one
      const existingConnection = connections.find(
        (c) => c.to.nodeId === dragWire.from.nodeId && c.to.pin === dragWire.from.pin
      );

      if (existingConnection) {
        // PERFORMANCE: Use Map lookup instead of linear search
        const sourceNode = nodeMap.get(existingConnection.from.nodeId);
        if (sourceNode) {
          srcType = NodeDefs[sourceNode.kind]?.pinsOut?.[existingConnection.from.pin]?.type || "default";
        } else {
          srcType = "default";
        }
      } else {
        srcType = "default";
      }
    } else {
      // Dragging from an output pin (original behavior)
      fromPos = this._getOutputPinPosition(fromNode, dragWire.from.pin);
      if (!fromPos) return;

      srcType = NodeDefs[fromNode.kind]?.pinsOut?.[dragWire.from.pin]?.type || "default";
    }

    const color = this._getWireColor(srcType);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    this._drawBezierCurve(fromPos.x, fromPos.y, dragWire.pos.x, dragWire.pos.y);
  }

  _renderNodes(nodes, selection) {
    // PERFORMANCE: Viewport culling during interactions - skip nodes off-screen
    let viewportBounds = null;
    if (this._isInteracting) {
      const canvas = this.ctx.canvas;
      const scale = this.viewport.scale;
      const offsetX = this.viewport.offsetX;
      const offsetY = this.viewport.offsetY;
      // Calculate world-space bounds of visible area
      const minX = -offsetX / scale;
      const maxX = (canvas.width - offsetX) / scale;
      const minY = -offsetY / scale;
      const maxY = (canvas.height - offsetY) / scale;
      // Add padding for nodes that might be partially visible
      const padding = 200;
      viewportBounds = {
        minX: minX - padding,
        maxX: maxX + padding,
        minY: minY - padding,
        maxY: maxY + padding
      };
    }

    for (const node of nodes) {
      // PERFORMANCE: Skip nodes that are completely off-screen during interactions
      if (viewportBounds) {
        const nodeRight = (node.x || 0) + (node.w || 120);
        const nodeBottom = (node.y || 0) + (node.h || 80);
        if (nodeRight < viewportBounds.minX || (node.x || 0) > viewportBounds.maxX ||
            nodeBottom < viewportBounds.minY || (node.y || 0) > viewportBounds.maxY) {
          continue; // Node is completely outside viewport
        }
      }
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

    // PERFORMANCE: Skip expensive shadow effects during interactions
    // Add subtle inner glow for selected nodes
    if (isSelected && !this._isInteracting) {
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

    // PERFORMANCE: Skip thumbnail and preview controls during interactions
    // These are expensive operations that can be skipped for smooth panning
    if (!this._isInteracting) {
      // Render enhanced thumbnail (before ID so ID is on top)
      this._renderNodeThumbnail(node);

      // Render preview controls
      this._renderPreviewControls(node);
    }

    // Draw node ID (for referencing in expressions) - AFTER thumbnail so it's visible
    ctx.fillStyle = "#888";
    ctx.font = `${Math.max(8, 9 / this.viewport.scale)}px monospace`;
    ctx.fillText(`#${node.id}`, node.x + node.w - ctx.measureText(`#${node.id}`).width - 6, node.y + 16);

    // Render pins with enhanced styling
    this._renderNodePins(node);

    // PERFORMANCE: Skip expensive drop shadow during interactions
    // Add subtle drop shadow for depth (only for non-selected nodes)
    if (!isSelected && !this._isInteracting) {
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

    // PERFORMANCE: Skip expensive shadow effects during interactions
    const skipShadows = this._isInteracting || false;

    // Render output pins with enhanced styling
    for (const [i, pos] of outputPins.entries()) {
      const pinType = NodeDefs[node.kind]?.pinsOut?.[i]?.type || "default";
      const pinColor = this._getWireColor(pinType);

      // Pin glow effect (skip during interactions for performance)
      if (!skipShadows) {
        ctx.shadowColor = pinColor;
        ctx.shadowBlur = 8;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = pinColor;
      this._drawEnhancedPin(pos.x, pos.y, 5, "output");

      // Reset shadow for label
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      // PERFORMANCE: Skip pin labels during interactions
      if (!skipShadows) {
        this._renderOutputPinLabel(node, i, pos);
      }
    }

    // Render input pins with enhanced styling
    for (const [i, pos] of inputPins.entries()) {
      const connected = node.inputs && node.inputs[i];
      const pinColor = connected ? "#ff7a7a" : "#444";

      if (connected && !skipShadows) {
        ctx.shadowColor = "#ff7a7a";
        ctx.shadowBlur = 6;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = pinColor;
      this._drawEnhancedPin(pos.x, pos.y, 4, "input");

      // PERFORMANCE: Skip input pin labels during interactions
      // Input pin label
      if (!connected && !skipShadows) {
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

    // For simple const nodes, read the ACTUAL parameter value directly for real-time updates
    // This ensures MIDI-bound parameters and dragged sliders show current values immediately
    let previewValue;

    if (node.kind === "ConstFloat") {
      // Read directly from params for real-time display
      const rawValue = node.params?.value ?? node.value;

      // Parse the value - could be number or numeric string
      if (typeof rawValue === 'number') {
        previewValue = rawValue;
      } else if (typeof rawValue === 'string') {
        // Try to parse as number (unless it's an expression starting with =)
        if (!rawValue.trim().startsWith('=')) {
          const parsed = parseFloat(rawValue);
          if (!isNaN(parsed)) {
            previewValue = parsed;
          }
        }
      }
    } else if (node.kind === "ConstVec2") {
      // Read vector components directly for real-time display
      let x = node.params?.x ?? node.x;
      let y = node.params?.y ?? node.y;
      // Parse if strings
      if (typeof x === 'string') x = parseFloat(x);
      if (typeof y === 'string') y = parseFloat(y);
      if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
        previewValue = [x, y];
      }
    } else if (node.kind === "ConstVec3") {
      // Read vector components directly for real-time display
      let x = node.params?.x ?? node.x;
      let y = node.params?.y ?? node.y;
      let z = node.params?.z ?? node.z;
      // Parse if strings
      if (typeof x === 'string') x = parseFloat(x);
      if (typeof y === 'string') y = parseFloat(y);
      if (typeof z === 'string') z = parseFloat(z);
      if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
        previewValue = [x, y, z];
      }
    }

    // If we didn't get a value above (expression or non-ConstFloat node), use computed preview
    if (previewValue === undefined) {
      previewValue = node.__preview;

      // Try to get from PreviewComputer if available (most up-to-date for expressions)
      if (editor.previewComputer && editor.previewComputer.lastComputedValues) {
        const computedValue = editor.previewComputer.lastComputedValues.get(node.id);
        if (computedValue !== undefined) {
          previewValue = computedValue;
        }
      }
    }

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
