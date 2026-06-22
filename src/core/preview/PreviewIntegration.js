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
            // Re-render real GPU thumbnails for time-animated visual nodes (self-throttled).
            this.updateAnimatedFragmentPreviews();
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

    // GPU-vs-CPU routing now lives in PreviewSystem.generateNodePreview (the single funnel that
    // every path reaches, including bulk updateAllPreviews on load). Here we only make sure the
    // numeric preview values are computed first, then delegate to that funnel.

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
          
          // ENHANCEMENT: Force redraw after preview generation for real-time visibility
          if (this.editor.markDirty) {
            this.editor.markDirty('preview-update');
          }
        }
      );
      return; // Exit early, preview will be generated in callback
    }
    this.previewSystem.generateNodePreview(node);
    
    // ENHANCEMENT: Force redraw after preview generation for real-time visibility
    if (this.editor.markDirty) {
      this.editor.markDirty('preview-update');
    }
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
  if (!expressionSystem?.timeAnimatedNodes || expressionSystem.timeAnimatedNodes.size === 0) {
    return;
  }

  // Collect all nodes that need updates: time-animated nodes + their dependents
  const nodesToUpdate = new Set();
  const timeAnimatedNodeIds = Array.from(expressionSystem.timeAnimatedNodes);
  
  // Add time-animated nodes themselves
  timeAnimatedNodeIds.forEach(nodeId => {
    nodesToUpdate.add(nodeId);
  });

  // Find all downstream nodes that depend on time-animated nodes
  if (this.editor.graph.connections) {
    const findDependents = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      this.editor.graph.connections
        .filter(conn => conn.from.nodeId === nodeId)
        .forEach(conn => {
          nodesToUpdate.add(conn.to.nodeId);
          findDependents(conn.to.nodeId, visited);
        });
    };

    timeAnimatedNodeIds.forEach(nodeId => {
      findDependents(nodeId);
    });
  }

  if (nodesToUpdate.size === 0) {
    return;
  }

  // CRITICAL: Mark all time-dependent nodes and their downstream nodes as dirty
  // This ensures computePreviews() will recompute them with the new time value
  if (this.editor?.previewComputer) {
    nodesToUpdate.forEach(nodeId => {
      this.editor.previewComputer.markNodeDirty(nodeId, 'time-update');
    });
  }

  // CRITICAL: Actually recompute preview values, not just regenerate thumbnails
  // This ensures node.__preview gets updated with new numeric values for time-based expressions
  if (this.editor?.previewComputer && this.editor?.graph) {
    this.editor.previewComputer.requestPreviewComputation(
      this.editor.graph,
      { time: performance.now() / 1000 },
      {},
      () => {
        // CRITICAL: computePreviews() already called _generateEnhancedThumbnails()
        // which regenerated all thumbnails with updated numeric values.
        // DO NOT call generateNodePreview() here as it would overwrite the correctly
        // generated thumbnails with ones that don't handle scalar numeric outputs properly.

        // Refresh parameter panel displays to show updated values
        if (this.editor.paramPanel?.refreshParameterDisplays) {
          this.editor.paramPanel.refreshParameterDisplays();
        }

        // Mark dirty and redraw to show updated thumbnails with numeric values
        // The thumbnails (node.__thumb) were already regenerated by _generateEnhancedThumbnails()
        // and contain the updated numeric values from node.__preview
        if (this.editor.markDirty) {
          this.editor.markDirty('time-node-update');
        }
        this.editor.draw();
      }
    );
  } else {
    // Fallback: if no preview computer, at least try to regenerate thumbnails
    timeAnimatedNodeIds.forEach(nodeId => {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node);
      }
    });

    if (this.editor.markDirty) {
      this.editor.markDirty('time-node-update');
    }
    this.editor.draw();
  }
}
  // Re-render real GPU thumbnails for time-animated visual nodes and everything downstream of
  // them (a downstream node's output also changes when an upstream animated value changes).
  // Self-throttled to keep per-frame GPU readback cheap. Scalar/animated numeric nodes are
  // handled by updateTimeNodes() on the CPU path.
  updateAnimatedFragmentPreviews() {
    const spm = window.shaderPreviewManager;
    if (!spm || !spm.enableGPUPreview || !this.editor.graph?.nodes) return;

    const now = performance.now();
    if (!this._lastAnimPreview) this._lastAnimPreview = 0;
    if (now - this._lastAnimPreview < 80) return; // ~12.5 fps cap for animated thumbnails
    this._lastAnimPreview = now;

    const expressionSystem = window.editor?.paramPanel?.expressionSystem;
    const animated = expressionSystem?.timeAnimatedNodes;
    if (!animated || animated.size === 0) return;

    // Animated nodes + all transitive dependents.
    const toUpdate = new Set();
    const connections = this.editor.graph.connections || [];
    const addDownstream = (nodeId, visited) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      toUpdate.add(nodeId);
      for (const c of connections) {
        if (c.from?.nodeId === nodeId) addDownstream(c.to.nodeId, visited);
      }
    };
    const visited = new Set();
    animated.forEach(id => addDownstream(id, visited));

    for (const nodeId of toUpdate) {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (!node || !spm.isVisualNode(node)) continue; // scalars stay on the CPU path
      const pv = this.editor.nodePreviews?.get(nodeId);
      if (pv && pv.enabled === false) continue; // respect explicit per-node disable
      spm.updateFragmentNodePreview(node).catch(() => {});
    }
  }

  onParameterChange(node, immediate = false) {
    // PERFORMANCE FIX: Skip ALL preview updates during parameter drag
    // Preview updates are expensive and cause frame drops. Only update uniforms during drag.
    // Preview updates will happen on mouseup via the normal parameter change flow.
    if (this.editor._parameterDragging) {
      // During drag, only mark node as dirty for later processing
      // Don't trigger expensive preview computations
      if (node?.id && this.editor?.previewComputer?.markNodeDirty) {
        this.editor.previewComputer.markNodeDirty(node.id, 'parameter-change');
      }
      return; // Skip all preview updates during drag
    }

    if (node?.id && this.editor?.previewComputer?.markNodeDirty) {
      this.editor.previewComputer.markNodeDirty(node.id, 'parameter-change');
    }

    // OPTIMIZATION: Debounce rapid parameter changes (e.g., slider drag)
    // Unless immediate flag is set (e.g., discrete value changes)
    if (!immediate) {
      // For rapid changes, collect affected nodes and process in batch
      this.pendingParameterChanges.set(node.id, node);

      // Clear existing timeout
      if (this.parameterChangeTimeout) {
        clearTimeout(this.parameterChangeTimeout);
      }

      // Set new timeout to process batch - Reduced for more responsive updates
      this.parameterChangeTimeout = setTimeout(() => {
        this.processPendingParameterChanges();
      }, 8); // ~120fps debounce for smoother real-time updates

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
    // Free the node's GPU preview texture so it doesn't linger after deletion.
    window.shaderPreviewManager?.destroyPreviewTexture(nodeId);
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
    // Free all GPU preview textures so cleared nodes don't leak GPU memory.
    window.shaderPreviewManager?.clearCache();
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