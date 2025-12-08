// src/core/Renderer.js
import { NodeDefs } from "../data/NodeDefs.js";
import { RedrawScheduler } from "./RedrawScheduler.js";

export class Renderer {
  constructor(ctx, viewport, schedulerConfig = null) {
    this.ctx = ctx;
    this.viewport = viewport;
    
    // Initialize redraw scheduler
    this.scheduler = new RedrawScheduler(schedulerConfig);
    this.scheduler.setRedrawCallback((triggerType, options) => {
      // This will be set by the Editor when it calls setRedrawCallback
      if (this._redrawCallback) {
        this._redrawCallback(triggerType, options);
      }
    });
    this._redrawCallback = null;
    // Cache for temporary canvases used in thumbnail rendering
    // This avoids recreating canvases every frame, which is expensive
    // Format: Map<nodeId, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, imageDataHash: string }>
    this._tempCanvasCache = new Map();
    
    // PERFORMANCE: Grid rendering optimization
    // Offscreen canvas for grid rendering
    this._gridCanvas = null;
    this._gridCtx = null;
    this._gridCacheKey = null; // Cache key based on grid size, scale, and canvas dimensions
    this._lastGridOffsetX = null;
    this._lastGridOffsetY = null;
    this._skipGridRendering = false; // Skip grid during fast panning
    
    // PERFORMANCE: Cache node pin positions during panning
    // Format: Map<nodeId, { inputPins: Array, outputPins: Array, version: number }>
    this._nodePinCache = new Map();
    this._nodePinCacheVersion = 0;
    
    // PERFORMANCE: Cache gradients to avoid recreating them every frame
    this._gradientCache = new Map(); // Cache key: "x_y_w_h" -> CanvasGradient
    this._lastGradientCacheClear = 0;
    
    // PERFORMANCE: Cache font strings to avoid string concatenation
    this._cachedFonts = {
      nodeLabel: null,
      nodeId: null,
      pinLabel: null,
      lastScale: null
    };
    
    // PERFORMANCE: Cache wire colors to avoid repeated NodeDefs lookups
    this._wireColorCache = new Map();
  }

  render(graph, renderState) {
    const perfToken = window.previewPerfMonitor?.timeSection("canvas");
    const ctx = this.ctx;
    if (renderState.editor) {
      window.editor = renderState.editor; // Make editor accessible
    }
    
    // PERFORMANCE: Clear caches at start of each frame
    // This ensures we recalculate when node positions change, but cache within the same frame
    this._nodePinCache.clear();
    // Clear wire color cache to prevent unbounded growth (though it's unlikely to grow much)
    if (this._wireColorCache) {
      this._wireColorCache.clear();
    }
    
    // PERFORMANCE: Clear node pin cache when panning stops
    const isPanning = this.viewport.isPanning && typeof this.viewport.isPanning === 'function' 
      ? this.viewport.isPanning() 
      : (this.viewport._isPanning || false);
    if (!isPanning && this._nodePinCache.size > 0) {
      this._clearNodePinCache();
    }
    
    // Handle precise invalidation regions
    const preciseDirtyRegions = renderState.preciseDirtyRegions;
    const needsFullRedraw = renderState.needsFullRedraw;
    
    if (needsFullRedraw || !preciseDirtyRegions || preciseDirtyRegions.length === 0) {
      // Full canvas clear
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      // Partial clear - only clear dirty regions
      this._clearDirtyRegions(ctx, preciseDirtyRegions);
    }

    // Store interaction state for optimizations that don't affect visual appearance
    const isInteracting = renderState.isInteracting || false;
    this._isInteracting = isInteracting;
    
    // Save context and apply viewport transform FIRST
    // Grid must be drawn in world space (after transform) so it moves correctly with pan
    ctx.save();
    ctx.translate(this.viewport.offsetX, this.viewport.offsetY);
    ctx.scale(this.viewport.scale, this.viewport.scale);
    
    // Render grid background in world space (moves with viewport)
    this._renderBackgroundGrid();

    // PERFORMANCE: Create node lookup map for O(1) access instead of O(n) linear search
    // This is critical for performance with many nodes
    const nodeMap = new Map();
    for (const node of graph.nodes) {
      if (node && node.id) {
        nodeMap.set(node.id, node);
      }
    }

    // Determine which nodes/connections to render based on dirty regions
    const nodesToRender = needsFullRedraw || !preciseDirtyRegions || preciseDirtyRegions.length === 0
      ? graph.nodes
      : this._filterNodesByRegions(graph.nodes, preciseDirtyRegions);
    
    const connectionsToRender = needsFullRedraw || !preciseDirtyRegions || preciseDirtyRegions.length === 0
      ? graph.connections
      : this._filterConnectionsByRegions(graph.connections, nodeMap, preciseDirtyRegions);

    // Render connections/wires
    this._renderConnections(connectionsToRender, nodeMap);

    // Render parameter reference lines (subtle lines for =node_X references)
    // Only render if full redraw or if nodes are in dirty regions
    if (needsFullRedraw || !preciseDirtyRegions || preciseDirtyRegions.length === 0) {
      this._renderParameterReferences(graph.nodes, nodeMap);
    } else {
      this._renderParameterReferences(nodesToRender, nodeMap);
    }

    // Render drag wire if active
    if (renderState.dragWire) {
      this._renderDragWire(renderState.dragWire, nodeMap, graph.connections);
    }

    // Render nodes
    this._renderNodes(nodesToRender, renderState.selection);

    // Render selection box if active
    if (renderState.boxSelect) {
      this._renderSelectionBox(renderState.boxSelect);
    }

    ctx.restore();
    
    // PERFORMANCE: Mark viewport as clean after rendering
    // This allows transform cache to be used within the same frame
    if (this.viewport.markViewportClean && typeof this.viewport.markViewportClean === 'function') {
      this.viewport.markViewportClean();
    }
    
    window.previewPerfMonitor?.endSection(perfToken, {
      canvasNodeCount: graph?.nodes?.length || 0,
      canvasConnectionCount: graph?.connections?.length || 0,
    });
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

    // Grid is now drawn in world space (after viewport transform)
    // So spacing is in world units, not screen pixels
    const scale = this.viewport.scale || 1;
    const width = ctx.canvas.width / scale;
    const height = ctx.canvas.height / scale;
    
    // PERFORMANCE: Skip grid rendering during fast panning
    const isFastPanning = this.viewport.isFastPanning && typeof this.viewport.isFastPanning === 'function'
      ? this.viewport.isFastPanning()
      : false;
    if (isFastPanning) {
      this._skipGridRendering = true;
      return;
    }
    this._skipGridRendering = false;

    // Grid spacing in world space (gridSize is already in world units)
    // The grid tile is rendered in screen space, so spacing needs to account for scale
    const minorSpacing = gridSize * scale; // Screen pixels per grid unit
    const majorSpacing = minorSpacing * 5;
    
    // Cache key based on grid size and scale (scale affects visual appearance)
    const cacheKey = `${gridSize}_${scale.toFixed(2)}`;
    const needsRegenerate = !this._gridCanvas || 
                           this._gridCacheKey !== cacheKey;

    if (needsRegenerate) {
      this._regenerateGrid(gridSize, scale, width, height);
      this._gridCacheKey = cacheKey;
    }

    // Draw grid tiles - grid is fixed in world space, tiles from (0,0)
    // The viewport transform is already applied, so we're in world space
    // After transform: screen (0,0) -> world (-offsetX/scale, -offsetY/scale)
    //                  screen (width,height) -> world ((width-offsetX)/scale, (height-offsetY)/scale)
    if (this._gridCanvas && this._gridTileSizeWorld) {
      const tileSizeWorld = this._gridTileSizeWorld;
      const canvasWidth = ctx.canvas.width;
      const canvasHeight = ctx.canvas.height;
      
      // Calculate visible world bounds from screen bounds
      // After viewport transform, screen coordinates map to world coordinates
      const worldLeft = -this.viewport.offsetX / scale;
      const worldTop = -this.viewport.offsetY / scale;
      const worldRight = (canvasWidth - this.viewport.offsetX) / scale;
      const worldBottom = (canvasHeight - this.viewport.offsetY) / scale;
      
      // Calculate which tiles are visible in world space
      const startTileX = Math.floor(worldLeft / tileSizeWorld) - 1;
      const endTileX = Math.ceil(worldRight / tileSizeWorld) + 1;
      const startTileY = Math.floor(worldTop / tileSizeWorld) - 1;
      const endTileY = Math.ceil(worldBottom / tileSizeWorld) + 1;
      
      // Draw grid tiles - grid is fixed in world space at origin (0,0)
      // Tiles are positioned at integer multiples of tileSizeWorld
      for (let ty = startTileY; ty <= endTileY; ty++) {
        for (let tx = startTileX; tx <= endTileX; tx++) {
          const x = tx * tileSizeWorld;
          const y = ty * tileSizeWorld;
          // Draw with explicit size to ensure correct scaling in world space
          ctx.drawImage(this._gridCanvas, x, y, tileSizeWorld, tileSizeWorld);
        }
      }
    }
  }
  
  /**
   * Regenerate the grid on an offscreen canvas
   * This is only called when scale or grid size changes
   * Grid is rendered in screen space (pixels) for the offscreen canvas
   */
  _regenerateGrid(gridSize, scale, width, height) {
    // Grid spacing in screen pixels (for offscreen canvas rendering)
    const minorSpacing = gridSize * scale;
    const majorSpacing = minorSpacing * 5;
    
    // Create or resize offscreen canvas
    // Use a tile size that's a multiple of major spacing for efficient repetition
    // Make it large enough to cover most viewports but not too large
    // Tile size is in screen pixels
    const tileSizePixels = Math.max(Math.ceil(majorSpacing) * 10, 500);
    
    if (!this._gridCanvas || 
        this._gridCanvas.width !== tileSizePixels || 
        this._gridCanvas.height !== tileSizePixels) {
      this._gridCanvas = document.createElement('canvas');
      this._gridCanvas.width = tileSizePixels;
      this._gridCanvas.height = tileSizePixels;
      this._gridCtx = this._gridCanvas.getContext('2d');
    }
    
    const gridCtx = this._gridCtx;
    gridCtx.clearRect(0, 0, tileSizePixels, tileSizePixels);
    
    // Draw grid lines on the tile (in screen pixels)
    const drawLines = (spacing, alpha) => {
      if (!Number.isFinite(spacing) || spacing < 4) {
        return;
      }

      gridCtx.beginPath();
      gridCtx.lineWidth = 1;
      gridCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;

      // Vertical lines
      for (let x = 0; x <= tileSizePixels; x += spacing) {
        const px = Math.round(x) + 0.5;
        gridCtx.moveTo(px, 0);
        gridCtx.lineTo(px, tileSizePixels);
      }

      // Horizontal lines
      for (let y = 0; y <= tileSizePixels; y += spacing) {
        const py = Math.round(y) + 0.5;
        gridCtx.moveTo(0, py);
        gridCtx.lineTo(tileSizePixels, py);
      }

      gridCtx.stroke();
    };

    // Draw both minor and major grid lines
    drawLines(minorSpacing, 0.025);
    drawLines(majorSpacing, 0.07);
    
    // Store tile size in world space for drawing
    this._gridTileSizeWorld = tileSizePixels / scale;
  }

  _renderConnections(connections, nodeMap) {
    const ctx = this.ctx;
    ctx.lineWidth = 2;

    // PERFORMANCE: Always enable viewport culling - it's a real optimization
    // Only skips connections that are completely off-screen, improving performance significantly
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
    const viewportBounds = {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding
    };

    for (const c of connections) {
      // PERFORMANCE: Use Map lookup instead of linear search
      const fromNode = nodeMap.get(c.from.nodeId);
      const toNode = nodeMap.get(c.to.nodeId);
      if (!fromNode || !toNode) continue;

      const fromPos = this._getOutputPinPosition(fromNode, c.from.pin);
      const toPos = this._getInputPinPosition(toNode, c.to.pin);
      if (!fromPos || !toPos) continue;

      // PERFORMANCE: Skip connections that are completely off-screen
      const fromInBounds = fromPos.x >= viewportBounds.minX && fromPos.x <= viewportBounds.maxX &&
                           fromPos.y >= viewportBounds.minY && fromPos.y <= viewportBounds.maxY;
      const toInBounds = toPos.x >= viewportBounds.minX && toPos.x <= viewportBounds.maxX &&
                         toPos.y >= viewportBounds.minY && toPos.y <= viewportBounds.maxY;
      // Skip if both endpoints are outside viewport
      if (!fromInBounds && !toInBounds) {
        continue;
      }

      // PERFORMANCE: Cache wire color lookup - NodeDefs access is expensive
      // Create cache key from node kind and pin index
      const wireColorKey = `${fromNode.kind}_${c.from.pin}`;
      let color = this._wireColorCache?.get(wireColorKey);
      if (!color) {
        const srcType = NodeDefs[fromNode.kind]?.pinsOut?.[c.from.pin]?.type || "default";
        color = this._getWireColor(srcType);
        // Initialize cache if needed
        if (!this._wireColorCache) {
          this._wireColorCache = new Map();
        }
        this._wireColorCache.set(wireColorKey, color);
      }

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
    // PERFORMANCE: Always enable viewport culling - it's a real optimization, not a visual change
    // Only skips nodes that are completely off-screen, improving performance significantly
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
    const viewportBounds = {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding
    };

    // PERFORMANCE: Pre-calculate font strings once for all nodes
    const currentScale = this.viewport.scale;
    if (this._cachedFonts.lastScale !== currentScale) {
      this._cachedFonts.nodeLabel = `${Math.max(10, 12 / currentScale)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
      this._cachedFonts.nodeId = `${Math.max(8, 9 / currentScale)}px monospace`;
      this._cachedFonts.pinLabel = `${Math.max(8, 9 / currentScale)}px ui-monospace, Consolas, monospace`;
      this._cachedFonts.lastScale = currentScale;
    }
    
    for (const node of nodes) {
      // PERFORMANCE: Skip nodes that are completely off-screen
      const nodeRight = (node.x || 0) + (node.w || 120);
      const nodeBottom = (node.y || 0) + (node.h || 80);
      if (nodeRight < viewportBounds.minX || (node.x || 0) > viewportBounds.maxX ||
          nodeBottom < viewportBounds.minY || (node.y || 0) > viewportBounds.maxY) {
        continue; // Node is completely outside viewport
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

    // PERFORMANCE: Use solid color instead of gradient for better performance
    // Gradients are expensive to create and render. Solid color looks almost identical.
    ctx.fillStyle = "#252525"; // Use middle gradient color
    ctx.strokeStyle = isSelected ? "#66aaff" : "#404040";
    ctx.lineWidth = isSelected ? 2 : 1;

    // Draw the main node rectangle
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, 8);
    ctx.fill();
    ctx.stroke();

    // PERFORMANCE: Simplified selected node highlight - no expensive shadow operations
    if (isSelected) {
      ctx.strokeStyle = "rgba(102, 170, 255, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(node.x + 1, node.y + 1, node.w - 2, node.h - 2, 7);
      ctx.stroke();
    }

    // Draw node category indicator (small colored bar on the left)
    const categoryColor = this._getCategoryColor(
      NodeDefs[node.kind]?.cat || "default",
    );
    ctx.fillStyle = categoryColor;
    ctx.fillRect(node.x, node.y + 8, 3, node.h - 16);

    // Draw node label with better typography
    // PERFORMANCE: Use cached font string
    ctx.fillStyle = "#e8e8e8";
    ctx.font = this._cachedFonts.nodeLabel;
    const label = NodeDefs[node.kind]?.label || node.kind;
    ctx.fillText(label, node.x + 10, node.y + 18);

    // Render enhanced thumbnail (before ID so ID is on top)
    this._renderNodeThumbnail(node);

    // Render preview controls
    this._renderPreviewControls(node);

    // Draw node ID (for referencing in expressions) - AFTER thumbnail so it's visible
    // PERFORMANCE: Use cached font string
    ctx.fillStyle = "#888";
    ctx.font = this._cachedFonts.nodeId;
    ctx.fillText(`#${node.id}`, node.x + node.w - ctx.measureText(`#${node.id}`).width - 6, node.y + 16);

    // Render pins with enhanced styling
    this._renderNodePins(node);

    // PERFORMANCE: Removed expensive drop shadow - it requires creating a whole extra shape
    // The visual difference is minimal and the performance cost is significant
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
    // PERFORMANCE: Use cached font string
    ctx.font = this._cachedFonts.pinLabel;

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

    if (thumbSize <= 96) {
      // Small/Medium: Traditional positioning
      thumbX = node.x + node.w - thumbSize - padding;
      thumbY = node.y + padding;
    } else {
      // Large: Position below node title to avoid overlap
      thumbX = node.x + padding;
      thumbY = node.y + 25; // Below title
    }

    ctx.save();

    // Enhanced thumbnail background with better contrast
    ctx.fillStyle = "#000000"; // Darker background for better contrast
    ctx.strokeStyle = "#555"; // Brighter border for visibility
    ctx.lineWidth = 2; // Thicker border for clarity
    ctx.beginPath();
    ctx.roundRect(thumbX - 2, thumbY - 2, thumbSize + 4, thumbSize + 4, 5);
    ctx.fill();
    ctx.stroke();

    // Enable smooth scaling for high-quality thumbnails
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Handle both ImageData and Canvas thumbnails
    if (node.__thumb instanceof HTMLCanvasElement) {
      // Draw thumbnail with better quality
      ctx.drawImage(node.__thumb, thumbX, thumbY, thumbSize, thumbSize);
    } else if (node.__thumb instanceof ImageData) {
      // PERFORMANCE: Cache temporary canvases per node to avoid recreating every frame
      // putImageData is blocking, but we cache the canvas to at least avoid canvas creation overhead
      const cacheKey = `${node.id}-${node.__thumb.width}x${node.__thumb.height}`;
      let tempCanvas = this._tempCanvasCache.get(cacheKey);
      
      if (!tempCanvas || tempCanvas.width !== node.__thumb.width || tempCanvas.height !== node.__thumb.height) {
        tempCanvas = document.createElement("canvas");
        tempCanvas.width = node.__thumb.width;
        tempCanvas.height = node.__thumb.height;
        this._tempCanvasCache.set(cacheKey, tempCanvas);
      }
      
      // putImageData is blocking but necessary - the real fix needs to happen where thumbnails are created
      // Thumbnails should be converted to canvas elements, not ImageData
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = "high";
      tempCtx.putImageData(node.__thumb, 0, 0);
      ctx.drawImage(tempCanvas, thumbX, thumbY, thumbSize, thumbSize);
    }

    // Enhanced inner border for better visibility
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(thumbX, thumbY, thumbSize, thumbSize, 3);
    ctx.stroke();

    // Add subtle glow effect for better visibility
    ctx.shadowColor = "rgba(102, 170, 255, 0.3)";
    ctx.shadowBlur = 4;
    ctx.strokeStyle = "rgba(102, 170, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(thumbX + 1, thumbY + 1, thumbSize - 2, thumbSize - 2, 2);
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset shadow

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

      // PERFORMANCE: Simplified pin rendering - removed expensive shadow operations
      ctx.fillStyle = pinColor;
      this._drawEnhancedPin(pos.x, pos.y, 5, "output");

      this._renderOutputPinLabel(node, i, pos);
    }

    // Render input pins with enhanced styling
    for (const [i, pos] of inputPins.entries()) {
      const connected = node.inputs && node.inputs[i];
      // PERFORMANCE: Simplified pin rendering - removed expensive shadow operations
      const pinColor = connected ? "#ff7a7a" : "#444";
      ctx.fillStyle = pinColor;
      this._drawEnhancedPin(pos.x, pos.y, 4, "input");

      // Input pin label
      // PERFORMANCE: Use cached font string
      if (!connected) {
        const inputLabel = NodeDefs[node.kind]?.pinsIn?.[i] || `In${i}`;
        ctx.fillStyle = "#666";
        ctx.font = this._cachedFonts.pinLabel;
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
    // PERFORMANCE: Use cached font string
    ctx.font = this._cachedFonts.pinLabel;
    const textWidth = ctx.measureText(labelText).width + 8;

    // PERFORMANCE: Use solid color instead of gradient for better performance
    ctx.fillStyle = "rgba(20, 20, 25, 0.95)";
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
    // PERFORMANCE: Cache pin positions per frame - they only change when node position changes
    // This prevents recalculating pin positions multiple times per frame for the same node
    // (e.g., when rendering multiple connections from/to the same node)
    
    // Check if we have a cached result for this node in the current frame
    const cacheKey = `${node.id}_${node.x}_${node.y}`;
    const cached = this._nodePinCache.get(cacheKey);
    if (cached) {
      return { inputPins: cached.inputPins, outputPins: cached.outputPins };
    }
    
    // Calculate pin positions
    const inputPins = [];
    for (let i = 0; i < (NodeDefs[node.kind]?.inputs || 0); i++) {
      inputPins.push({ x: node.x + 8, y: node.y + 32 + i * 18 });
    }

    const outputPins = [];
    const outCount = (NodeDefs[node.kind]?.pinsOut || []).length || 1;
    for (let i = 0; i < outCount; i++) {
      outputPins.push({ x: node.x + node.w - 8, y: node.y + 32 + i * 18 });
    }
    
    // Cache the result (will be cleared at start of next frame)
    this._nodePinCache.set(cacheKey, { inputPins, outputPins });

    return { inputPins, outputPins };
  }
  
  /**
   * Clear node pin position cache
   * Called when panning stops or nodes move
   */
  _clearNodePinCache() {
    this._nodePinCache.clear();
    this._nodePinCacheVersion++;
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

    // PERFORMANCE: Removed expensive shadow operations
    // Shadows require GPU compositing and are very expensive
    // The visual difference is minimal but the performance cost is significant

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
    ctx.stroke();
  }

  _drawPin(x, y, radius) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  
  /**
   * Request a redraw with throttling/debouncing
   * @param {string} triggerType - Type of trigger (e.g., 'mouse-move', 'pan', 'parameter-change')
   * @param {object} options - Additional options
   * @param {boolean} options.immediate - Bypass throttling (for critical updates)
   * @param {string} options.reason - Human-readable reason for debugging
   * @param {function} options.callback - Callback to execute when redraw is approved
   */
  requestRedraw(triggerType = 'unknown', options = {}) {
    // If callback provided, set it temporarily
    if (options.callback) {
      const originalCallback = this._redrawCallback;
      this._redrawCallback = options.callback;
      
      // Request redraw through scheduler
      this.scheduler.requestRedraw(triggerType, options);
      
      // Restore original callback
      this._redrawCallback = originalCallback;
    } else {
      // Use existing callback
      this.scheduler.requestRedraw(triggerType, options);
    }
  }
  
  /**
   * Set the callback function to execute when redraw is approved
   * @param {function} callback - Function(triggerType, options) to call
   */
  setRedrawCallback(callback) {
    this._redrawCallback = callback;
  }
  
  /**
   * Get the redraw scheduler instance (for configuration)
   * @returns {RedrawScheduler}
   */
  getScheduler() {
    return this.scheduler;
  }
  
  /**
   * Update scheduler configuration
   * @param {object} config - New configuration
   */
  updateSchedulerConfig(config) {
    this.scheduler.updateConfig(config);
  }
  
  /**
   * Cleanup - destroy scheduler
   */
  destroy() {
    if (this.scheduler) {
      this.scheduler.destroy();
    }
  }

  /**
   * Clear dirty regions on canvas
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Array} regions - Array of region objects {x, y, w, h}
   */
  _clearDirtyRegions(ctx, regions) {
    if (!regions || regions.length === 0) {
      return;
    }

    // Transform regions from world space to screen space
    const scale = this.viewport.scale || 1;
    const offsetX = this.viewport.offsetX || 0;
    const offsetY = this.viewport.offsetY || 0;

    for (const region of regions) {
      if (!region || !Number.isFinite(region.x) || !Number.isFinite(region.y) ||
          !Number.isFinite(region.w) || !Number.isFinite(region.h)) {
        continue;
      }

      // Transform to screen coordinates
      const screenX = region.x * scale + offsetX;
      const screenY = region.y * scale + offsetY;
      const screenW = region.w * scale;
      const screenH = region.h * scale;

      // Clear the region (add padding to ensure we clear everything)
      const padding = 2;
      ctx.clearRect(
        screenX - padding,
        screenY - padding,
        screenW + padding * 2,
        screenH + padding * 2
      );
    }
  }

  /**
   * Filter nodes that intersect with dirty regions
   * @private
   * @param {Array} nodes - Array of node objects
   * @param {Array} regions - Array of region objects {x, y, w, h}
   * @returns {Array} Filtered nodes
   */
  _filterNodesByRegions(nodes, regions) {
    if (!nodes || nodes.length === 0 || !regions || regions.length === 0) {
      return nodes;
    }

    const filtered = [];
    for (const node of nodes) {
      const nodeRegion = {
        x: node.x || 0,
        y: node.y || 0,
        w: node.w || 120,
        h: node.h || 80
      };

      // Check if node intersects with any dirty region
      for (const region of regions) {
        if (this._regionsIntersect(nodeRegion, region)) {
          filtered.push(node);
          break;
        }
      }
    }

    return filtered;
  }

  /**
   * Filter connections that intersect with dirty regions
   * @private
   * @param {Array} connections - Array of connection objects
   * @param {Map} nodeMap - Map of node ID to node object
   * @param {Array} regions - Array of region objects {x, y, w, h}
   * @returns {Array} Filtered connections
   */
  _filterConnectionsByRegions(connections, nodeMap, regions) {
    if (!connections || connections.length === 0 || !regions || regions.length === 0) {
      return connections;
    }

    const filtered = [];
    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from?.nodeId);
      const toNode = nodeMap.get(conn.to?.nodeId);

      if (!fromNode || !toNode) {
        // Include connections with missing nodes (will be handled by renderer)
        filtered.push(conn);
        continue;
      }

      // Calculate bounding box for connection
      const minX = Math.min(fromNode.x || 0, toNode.x || 0);
      const minY = Math.min(fromNode.y || 0, toNode.y || 0);
      const maxX = Math.max(
        (fromNode.x || 0) + (fromNode.w || 120),
        (toNode.x || 0) + (toNode.w || 120)
      );
      const maxY = Math.max(
        (fromNode.y || 0) + (fromNode.h || 80),
        (toNode.y || 0) + (toNode.h || 80)
      );

      const connRegion = {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
      };

      // Check if connection region intersects with any dirty region
      for (const region of regions) {
        if (this._regionsIntersect(connRegion, region)) {
          filtered.push(conn);
          break;
        }
      }
    }

    return filtered;
  }

  /**
   * Check if two regions intersect
   * @private
   * @param {Object} a - First region {x, y, w, h}
   * @param {Object} b - Second region {x, y, w, h}
   * @returns {boolean}
   */
  _regionsIntersect(a, b) {
    return !(
      a.x + a.w < b.x ||
      b.x + b.w < a.x ||
      a.y + a.h < b.y ||
      b.y + b.h < a.y
    );
  }
}
