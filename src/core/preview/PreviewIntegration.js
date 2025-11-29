// src/core/preview/PreviewIntegration.js
// OPTIMIZED VERSION - Fixes timer spam and unnecessary updates

import { PRIORITY } from '../UnifiedRAFManager.js';

export class PreviewIntegration {
  constructor(editor, previewSystem) {
    this.editor = editor;
    this.previewSystem = previewSystem;
    this.timeUpdateInterval = null;
    this.lastTimeUpdate = 0;
    this._handlerName = 'previewIntegration'; // Handler name for UnifiedRAFManager

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

    // Register handler with UnifiedRAFManager to use unified RAF loop
    // This consolidates all RAF-based updates into a single loop for better performance
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.registerHandler(
        this._handlerName,
        (frameInfo) => {
          // Convert realTime from seconds to milliseconds for timestamp comparison
          const timestamp = frameInfo.realTime * 1000;
          // OPTIMIZATION: Only update time nodes if enough time has passed
          // Limit to 60 FPS max for time updates (16.67ms between updates)
          if (timestamp - this.lastTimeUpdate >= 16.67) {
            this.updateTimeNodes();
            this.lastTimeUpdate = timestamp;
          }
        },
        PRIORITY.NORMAL,
        {
          // Condition: only execute if preview is enabled, system exists, and not during parameter drag
          condition: (frameInfo) => {
            return (
              this.editor.isPreviewEnabled &&
              this.previewSystem &&
              !this.editor._parameterDragging &&
              !frameInfo.paused // Skip if render loop is paused
            );
          }
        }
      );
    }
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
    // Use async worker-based computation to avoid blocking canvas interactions
    if (!skipCompute && this.editor?.previewComputer && this.editor?.graph) {
      // Use async requestPreviewComputation instead of synchronous computePreviews
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate the preview
          this.previewSystem.generateNodePreview(node);
        }
      );
      return; // Exit early, preview will be generated in callback
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
    if (node?.id && this.editor?.previewComputer?.markNodeDirty) {
      this.editor.previewComputer.markNodeDirty(node.id, 'parameter-change');
    }

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

    // OPTIMIZATION: Compute all node values ONCE (async, non-blocking)
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate previews
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
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if no preview computer
    changedNodes.forEach(node => {
      this.generateNodePreview(node, true);
      this.updateDependentNodes(node, true);
    });

    if (this.editor.markDirty) {
      this.editor.markDirty('parameter-change-batch');
    }
    this.editor.draw();
  }

  processParameterChange(node) {
    // OPTIMIZATION: Compute all node values ONCE before generating any previews (async, non-blocking)
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate previews
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
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if no preview computer
    this.generateNodePreview(node, true);
    this.updateDependentNodes(node, true);

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

    // OPTIMIZATION: Compute once if needed, then generate all previews (async, non-blocking)
    if (!skipCompute && this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate dependent previews
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
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if skipCompute is true
    dependents.forEach((nodeId) => {
      const node = this.editor.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node, true);
      }
    });

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

  // OPTIMIZATION: Cleanup method with proper handler unregistration
  destroy() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }

    // Unregister handler from UnifiedRAFManager
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.unregisterHandler(this._handlerName);
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
  // Uses UnifiedRAFManager's enable/disable functionality
  pauseAnimation() {
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.setHandlerEnabled(this._handlerName, false);
    }
  }

  resumeAnimation() {
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.setHandlerEnabled(this._handlerName, true);
    }
  }

  // OPTIMIZATION: Add method to temporarily disable time updates during heavy operations
  setTimeUpdatesEnabled(enabled) {
    this.timeUpdatesEnabled = enabled;
  }
}