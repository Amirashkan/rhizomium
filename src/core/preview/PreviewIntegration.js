// src/core/preview/PreviewIntegration.js
// OPTIMIZED VERSION - Fixes timer spam and unnecessary updates

export class PreviewIntegration {
  constructor(editor, previewSystem) {
    this.editor = editor;
    this.previewSystem = previewSystem;
    this.timeUpdateInterval = null;
    this.lastTimeUpdate = 0;
    this.frameRequestId = null;

    // Debouncing for parameter changes
    this.parameterChangeTimeout = null;
    this.pendingParameterChanges = new Map(); // nodeId -> node

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
      // PERFORMANCE: Skip during parameter drag
      if (!this.editor._parameterDragging) {
        if (this.editor.isPreviewEnabled && this.previewSystem) {
          // OPTIMIZATION: Only update time nodes if enough time has passed
          // Limit to 30 FPS max for time updates (33.33ms between updates)
          if (timestamp - this.lastTimeUpdate >= 33.33) {
            this.updateTimeNodes();
            this.lastTimeUpdate = timestamp;
          }
        }
      }

      this.frameRequestId = requestAnimationFrame(animate);
    };

    this.frameRequestId = requestAnimationFrame(animate);
  }

  updateAllPreviews() {
    if (!this.previewSystem) {

      return;
    }
    // Pass the nodes array to updateAllPreviews
    if (this.editor?.graph?.nodes) {
      this.previewSystem.updateAllPreviews(this.editor.graph.nodes);
    } else {

    }
  }

  generateNodePreview(node, skipCompute = false) {
    if (!this.previewSystem) {

      return;
    }
    // OPTIMIZATION: Allow caller to skip compute if they already computed all values
    if (!skipCompute && this.editor?.previewComputer && this.editor?.graph) {
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
  if (expressionSystem?.timeAnimatedNodes && expressionSystem.timeAnimatedNodes.size > 0) {
    expressionSystem.timeAnimatedNodes.forEach(nodeId => {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node) {
        this.previewSystem.generateNodePreview(node);
      }
    });

    // Mark dirty since we updated time-animated node previews
    if (this.editor.markDirty) {
      this.editor.markDirty('time-node-update');
    }
  }

  this.editor.draw();
}
  onParameterChange(node, immediate = false) {
    // OPTIMIZATION: Debounce rapid parameter changes (e.g., slider drag)
    // Unless immediate flag is set (e.g., discrete value changes)
    if (!immediate && !this.editor._parameterDragging) {
      // For rapid changes, collect affected nodes and process in batch
      this.pendingParameterChanges.set(node.id, node);

      // Clear existing timeout
      if (this.parameterChangeTimeout) {
        clearTimeout(this.parameterChangeTimeout);
      }

      // Set new timeout to process batch
      this.parameterChangeTimeout = setTimeout(() => {
        this.processPendingParameterChanges();
      }, 16); // ~60fps debounce (one frame)

      return;
    }

    // Immediate update (no debounce)
    this.processParameterChange(node);
  }

  processPendingParameterChanges() {
    if (this.pendingParameterChanges.size === 0) return;

    // Get all affected nodes
    const changedNodes = Array.from(this.pendingParameterChanges.values());
    this.pendingParameterChanges.clear();

    // OPTIMIZATION: Compute all node values ONCE
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.computePreviews(this.editor.graph);
    }

    // Process all changed nodes
    changedNodes.forEach(node => {
      // Generate preview for changed node (skip compute since we just did it)
      this.generateNodePreview(node, true);

      // Update dependent nodes (skip compute since we just did it)
      this.updateDependentNodes(node, true);
    });

    // Mark dirty and redraw once for all changes
    if (this.editor.markDirty) {
      this.editor.markDirty('parameter-change-batch');
    }
    this.editor.draw();
  }

  processParameterChange(node) {
    // OPTIMIZATION: Compute all node values ONCE before generating any previews
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.computePreviews(this.editor.graph);
    }

    // Generate preview for changed node (skip compute since we just did it)
    this.generateNodePreview(node, true);

    // Update dependent nodes (skip compute since we just did it)
    this.updateDependentNodes(node, true);

    // Mark dirty and redraw to show updated output values
    if (this.editor.markDirty) {
      this.editor.markDirty('parameter-change');
    }
    this.editor.draw();
  }

  updateDependentNodes(changedNode, skipCompute = false) {
    if (!this.editor.graph?.connections) return;

    const dependents = this.editor.graph.connections
      .filter((conn) => conn.from.nodeId === changedNode.id)
      .map((conn) => conn.to.nodeId);

    if (dependents.length === 0) return;

    // OPTIMIZATION: Compute once if needed, then generate all previews
    if (!skipCompute && this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.computePreviews(this.editor.graph);
    }

    // OPTIMIZATION: Batch dependent node updates
    dependents.forEach((nodeId) => {
      const node = this.editor.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node, true); // Skip compute since we already did it
      }
    });

    // Mark dirty and draw once after all dependents are updated
    if (this.editor.markDirty) {
      this.editor.markDirty('dependent-update');
    }
    this.editor.draw();
  }

  onNodeAdded(node) {
    this.generateNodePreview(node);
    // Invalidate topological sort cache since graph structure changed
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('node-added');
    }
  }

  onNodeRemoved(nodeId) {
    this.previewSystem.canvasManager.removeCanvas(nodeId);
    // Invalidate topological sort cache since graph structure changed
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('node-removed');
    }
  }

  onConnectionChanged() {
    // Invalidate topological sort cache since graph structure changed
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('connection-changed');
    }
  }

  onGraphCleared() {
    if (!this.previewSystem) {

      return;
    }
    this.previewSystem.clearCache();
    // Invalidate topological sort cache since graph was cleared
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('graph-cleared');
    }
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

    if (this.parameterChangeTimeout) {
      clearTimeout(this.parameterChangeTimeout);
      this.parameterChangeTimeout = null;
    }

    this.pendingParameterChanges.clear();
  }

  // Expose preview system methods for backward compatibility
  renderTexture2D(node, size) {
    if (!this.previewSystem) {

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