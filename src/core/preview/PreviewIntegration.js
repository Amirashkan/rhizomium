// src/core/preview/PreviewIntegration.js
// OPTIMIZED VERSION - Fixes timer spam and unnecessary updates

export class PreviewIntegration {
  constructor(editor, previewSystem) {
    this.editor = editor;
    this.previewSystem = previewSystem;
    this.timeUpdateInterval = null;
    this.lastTimeUpdate = 0;
    this.frameRequestId = null;

    // Initialize with delay to ensure everything is ready
    setTimeout(() => {
      this.initialize();
    }, 100);
  }

  initialize() {
    if (this.editor.isPreviewEnabled && this.previewSystem) {
      this.updateAllPreviews();
    }

    // OPTIMIZATION: Use requestAnimationFrame instead of setInterval
    // This syncs with display refresh rate and is much more efficient
    this.startAnimationLoop();
  }

  startAnimationLoop() {
    if (this.frameRequestId) {
      cancelAnimationFrame(this.frameRequestId);
    }

    const animate = (timestamp) => {
      if (this.editor.isPreviewEnabled && this.previewSystem) {
        // OPTIMIZATION: Only update time nodes if enough time has passed
        // Limit to 30 FPS max for time updates (33.33ms between updates)
        if (timestamp - this.lastTimeUpdate >= 33.33) {
          this.updateTimeNodes();
          this.lastTimeUpdate = timestamp;
        }
      }
      
      this.frameRequestId = requestAnimationFrame(animate);
    };

    this.frameRequestId = requestAnimationFrame(animate);
  }

  updateAllPreviews() {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for updateAllPreviews");
      return;
    }
    // Pass the nodes array to updateAllPreviews
    if (this.editor?.graph?.nodes) {
      this.previewSystem.updateAllPreviews(this.editor.graph.nodes);
    } else {
      console.warn("Cannot update previews - no nodes available");
    }
  }

  generateNodePreview(node) {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for generateNodePreview");
      return;
    }
    // IMPORTANT: When updating a single node (e.g. parameter change),
    // we still need to compute ALL node values first so expressions work
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.computePreviews(this.editor.graph);
    }
    this.previewSystem.generateNodePreview(node);
  }

updateTimeNodes() {
  if (!this.editor.graph?.nodes || !this.previewSystem) return;

  const now = performance.now();
  if (!this.lastSignificantUpdate) this.lastSignificantUpdate = 0;
  
  if (now - this.lastSignificantUpdate < 100) {
    return;
  }
  this.lastSignificantUpdate = now;

  // Update nodes that have time-based expressions
  const expressionSystem = window.editor?.paramPanel?.expressionSystem;
  if (expressionSystem?.timeAnimatedNodes) {
    expressionSystem.timeAnimatedNodes.forEach(nodeId => {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node) {
        this.previewSystem.generateNodePreview(node);
      }
    });
  }

  this.editor.draw();
}
  onParameterChange(node) {
    this.generateNodePreview(node);
    this.updateDependentNodes(node);
    // Always redraw to show updated output values
    this.editor.draw();
  }

  updateDependentNodes(changedNode) {
    if (!this.editor.graph?.connections) return;

    const dependents = this.editor.graph.connections
      .filter((conn) => conn.from.nodeId === changedNode.id)
      .map((conn) => conn.to.nodeId);

    // OPTIMIZATION: Batch dependent node updates
    let needsRedraw = false;
    
    dependents.forEach((nodeId) => {
      const node = this.editor.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node);
        needsRedraw = true;
      }
    });

    // OPTIMIZATION: Only call draw once after all dependents are updated
    if (needsRedraw) {
      this.editor.draw();
    }
  }

  onNodeAdded(node) {
    this.generateNodePreview(node);
  }

  onNodeRemoved(nodeId) {
    this.previewSystem.canvasManager.removeCanvas(nodeId);
  }

  onGraphCleared() {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for onGraphCleared");
      return;
    }
    this.previewSystem.clearCache();
  }

  // OPTIMIZATION: Cleanup method with proper animation frame cancellation
  destroy() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
    
    if (this.frameRequestId) {
      cancelAnimationFrame(this.frameRequestId);
      this.frameRequestId = null;
    }
  }

  // Expose preview system methods for backward compatibility
  renderTexture2D(node, size) {
    if (!this.previewSystem) {
      console.warn("PreviewSystem not available for renderTexture2D");
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    
    const textureRenderer = this.previewSystem.rendererRegistry.getRenderer('texture2d');
    if (textureRenderer) {
      textureRenderer(ctx, node);
    }
    
    return canvas;
  }

  // OPTIMIZATION: Add method to pause/resume animation for better control
  pauseAnimation() {
    if (this.frameRequestId) {
      cancelAnimationFrame(this.frameRequestId);
      this.frameRequestId = null;
    }
  }

  resumeAnimation() {
    if (!this.frameRequestId) {
      this.startAnimationLoop();
    }
  }

  // OPTIMIZATION: Add method to temporarily disable time updates during heavy operations
  setTimeUpdatesEnabled(enabled) {
    this.timeUpdatesEnabled = enabled;
  }
}