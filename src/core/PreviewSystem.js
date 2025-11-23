// src/core/PreviewSystem.js - Enhanced with ErrorHandler integration

import { CanvasManager } from './preview/CanvasManager.js';
import { NodeValueComputer } from './preview/NodeValueComputer.js';
import { RendererRegistry } from './preview/RendererRegistry.js';
import { PreviewIntegration } from './preview/PreviewIntegration.js';

// Import all renderers
import { BasicRenderers } from './preview/renderers/BasicRenderers.js';
import { MathRenderers } from './preview/renderers/MathRenderers.js';
import { VectorRenderers } from './preview/renderers/VectorRenderers.js';
import { NoiseRenderers } from './preview/renderers/NoiseRenderers.js';
import { TextureRenderers } from './preview/renderers/TextureRenderers.js';
import { UtilityRenderers } from './preview/renderers/UtilityRenderers.js';
import { TransformRenderers } from './preview/renderers/TransformRenderers.js';
import { GradientRenderers } from './preview/renderers/GradientRenderers.js';

export class PreviewSystem {
constructor(editor) {
    this.renderingNodes = new Set();
    try {
      if (!editor) {
        throw new Error('Editor is required for PreviewSystem initialization');
      }

      this.editor = editor;  // Should be on or near line 26
      this.size = 48;

      // Topological sort caching
      this._sortCache = null;
      this._sortCacheKey = null;

      // Initialize subsystems with error handling
      this._initializeSubsystems();

      // Register all renderers
      this._registerRenderers();

      // Don't create integration here - let it be created externally
      this.integration = null;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-system-constructor'

      });
      throw error;
    }
  }

  _initializeSubsystems() {
    try {
      this.canvasManager = new CanvasManager(this.size);
      this.nodeValueComputer = new NodeValueComputer(this.editor);
      this.rendererRegistry = new RendererRegistry();
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-subsystem-init',
        size: this.size
      });
      throw error;
    }
  }

  // Method to set the integration after construction
  setIntegration(integration) {
    try {
      if (!integration) {
        return;
      }
      this.integration = integration;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-integration-set'
      });
    }
  }

  // Static factory method for proper initialization
  static create(editor) {
    try {
      if (!editor) {
        throw new Error('Editor is required for PreviewSystem creation');
      }

      const previewSystem = new PreviewSystem(editor);
      const integration = new PreviewIntegration(editor, previewSystem);
      previewSystem.setIntegration(integration);
      return previewSystem;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-system-factory'
      });
      throw error;
    }
  }

  _registerRenderers() {

    try {
      const rendererGroups = [
        BasicRenderers,
        MathRenderers, 
        VectorRenderers,
        NoiseRenderers,
        TextureRenderers,
        UtilityRenderers,
        GradientRenderers, 
        TransformRenderers,
      ];


    let registeredCount = 0;
    let failedCount = 0;

    rendererGroups.forEach((RendererGroup, index) => {
      try {
        if (!RendererGroup) {
          failedCount++;
          return;
        }

        const renderers = new RendererGroup(this);
        if (renderers && typeof renderers.register === 'function') {
          renderers.register(this.rendererRegistry);
          registeredCount++;
        } else {

          failedCount++;
        }
      } catch (rendererError) {
        window.errorHandler?.handleError(rendererError, {
          component: 'renderer-group-registration',
          rendererGroupIndex: index,
          rendererGroupName: RendererGroup?.name || 'Unknown'
        });
        failedCount++;
      }
    });
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'renderer-registration'
    });
  }
}
  showNeutralFallback() {
    try {
      const canvas = document.getElementById('gpu-canvas');
      if (canvas) {
        canvas.style.backgroundColor = '#7f7f7f';
      }

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-fallback'
      });
    }
  }
generateNodePreview(node) {
  // Skip visual thumbnail generation for input-only nodes
  // (Their values are computed in updateAllPreviews before this is called)
  const INPUT_ONLY_NODES = ['time', 'uv', 'constfloat', 'constint', 'constvec2', 'constvec3'];
  if (INPUT_ONLY_NODES.includes(node.kind.toLowerCase())) {
    return; // Don't generate visual thumbnails for nodes that only provide values
  }
  try {
    if (!node) {

      return;
    }

    if (!node.id) {

      return;
    }

    if (!node.kind) {

      return;
    }

    // Duplicate log removed - already logged at line 163
  if (node.kind.toLowerCase() === 'time') {
    // Don't trigger shader recompilation for Time nodes
    // They're input-only and have no visual output to preview
    return;
  }
    if (!this.editor.isPreviewEnabled) {
      node.__thumb = null;
      return;
    }

    const canvas = this.canvasManager.getCanvas(node.id);
    if (!canvas) {
      throw new Error(`Failed to get canvas for node ${node.id}`);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error(`Failed to get 2D context for node ${node.id}`);
    }

    // Clear canvas
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, this.size, this.size);

    // Get and execute renderer
    const rendererKey = node.kind.toLowerCase();
    const renderer = this.rendererRegistry.getRenderer(rendererKey);
    if (renderer && typeof renderer === 'function') {
      try {
        renderer(ctx, node);
      } catch (rendererError) {

        this._renderError(ctx, node, `Renderer: ${rendererError.message}`);
      }
    } else {
      this._renderGeneric(ctx, node);
    }

    node.__thumb = canvas;return;
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'node-preview-generation',
      nodeId: node?.id,
      nodeKind: node?.kind
    });

    // Ensure we still set a thumb even on error
    try {
      const canvas = this.canvasManager?.getCanvas(node?.id || 'error');
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          this._renderError(ctx, node, error.message);
          node.__thumb = canvas;
        }
      }
    } catch (recoveryError) {

    }
  }
}
updateAllPreviews(nodes) {
  try {
    // Safety check
    if (!nodes || !Array.isArray(nodes)) {
      return;
    }

    // CRITICAL: Compute all node output values FIRST before generating visual previews
    // This ensures values are available for display on output pins
    // Use async worker-based computation to avoid blocking
    if (this.editor?.previewComputer && this.editor?.graph) {
      // Use async requestPreviewComputation instead of synchronous computePreviews
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, continue with preview generation
          this._doUpdateAllPreviews(nodes);
        }
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if no preview computer
    this._doUpdateAllPreviews(nodes);
  }

  _doUpdateAllPreviews(nodes) {
    // Sort nodes in topological order so dependencies are rendered first
    const sortedNodes = this.topologicalSort(nodes);

    sortedNodes.forEach((node) => {
      try {
        this.generateNodePreview(node);
      } catch (error) {
        window.errorHandler?.handleError(error, {
          component: 'preview-generation',
          nodeId: node.id,
          nodeKind: node.kind
        });
      }
    });
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'update-all-previews'
    });
  }
}

// Generate a cache key for topological sort based on graph structure
_generateSortCacheKey(nodes) {
  if (!nodes || !Array.isArray(nodes)) return '';

  // Create a key based on node IDs and their input connections
  const parts = [];
  for (const node of nodes) {
    if (node && node.id) {
      const inputs = (node.inputs || []).filter(id => id).join(',');
      parts.push(`${node.id}:${inputs}`);
    }
  }
  return parts.sort().join('|');
}

// Invalidate topological sort cache (call when graph structure changes)
invalidateSortCache() {
  this._sortCache = null;
  this._sortCacheKey = null;
}

// Add this helper method to PreviewSystem
topologicalSort(nodes) {
  if (!nodes || !Array.isArray(nodes)) return [];

  // Check cache first
  const cacheKey = this._generateSortCacheKey(nodes);
  if (this._sortCache && this._sortCacheKey === cacheKey) {
    // Cache hit - return cached result
    return this._sortCache;
  }

  // Cache miss - compute sort
  const byId = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set();
  const result = [];

  const visit = (nodeId) => {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = byId.get(nodeId);
    if (!node) return;

    // Visit dependencies first
    if (node.inputs && Array.isArray(node.inputs)) {
      for (const inputId of node.inputs) {
        if (inputId) visit(inputId);
      }
    }

    result.push(node);
  };

  nodes.forEach(node => {
    if (node && node.id) visit(node.id);
  });

  // Cache the result
  this._sortCache = result;
  this._sortCacheKey = cacheKey;

  return result;
}

  // Texture2D renderer method for backward compatibility
  renderTexture2D(node, size) {
    try {
      if (!node) {
        throw new Error('Node is required for texture rendering');
      }

      if (!node.id) {
        throw new Error('Node ID is required for texture rendering');
      }

      if (typeof size !== 'number' || size <= 0) {

        size = this.size;
      }

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      
      if (!ctx) {
        throw new Error('Failed to get 2D context for texture canvas');
      }

      // Check if texture is loaded
      const textureInfo = window.textureManager?.getTexture(node.id);

      if (textureInfo && textureInfo.file) {
        // Try to create image from file
        const img = new Image();
        
        img.onload = () => {
          try {
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);

            // Add indicator
            ctx.fillStyle = "rgba(74, 144, 226, 0.9)";
            ctx.fillRect(0, 0, 14, 10);
            ctx.fillStyle = "white";
            ctx.font = "bold 8px Arial";
            ctx.fillText("2D", 2, 8);
          } catch (drawError) {

            this._renderTextureError(ctx, size, 'Draw failed');
          }
        };

        img.onerror = () => {

          this._renderTextureError(ctx, size, 'Load failed');
        };

        try {
          img.src = URL.createObjectURL(textureInfo.file);
        } catch (urlError) {

          this._renderTextureError(ctx, size, 'URL failed');
        }

        // Show loading state
        this._renderTextureLoading(ctx, size);
      } else {
        // No texture - show clear placeholder
        this._renderTexturePlaceholder(ctx, size);
      }

      return canvas;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'texture2d-rendering',
        nodeId: node?.id,
        size
      });

      // Return error canvas
      const canvas = document.createElement("canvas");
      canvas.width = size || this.size;
      canvas.height = size || this.size;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        this._renderTextureError(ctx, canvas.width, error.message);
      }
      return canvas;
    }
  }

  _renderTextureLoading(ctx, size) {
    try {
      ctx.fillStyle = "#555";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#4a90e2";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Loading...", size / 2, size / 2);
    } catch (error) {

    }
  }

  _renderTexturePlaceholder(ctx, size) {
    try {
      // No texture - show clear placeholder
      ctx.fillStyle = "#444";
      ctx.fillRect(0, 0, size, size);

      // Bright border
      ctx.strokeStyle = "#4a90e2";
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, size - 4, size - 4);

      // Clear text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("2D", size / 2, size / 2 - 4);
      ctx.fillText("TEX", size / 2, size / 2 + 10);
    } catch (error) {

    }
  }

  _renderTextureError(ctx, size, message) {
    try {
      ctx.fillStyle = "#2d1b1b";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#ff4444";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ERR", size / 2, size / 2 - 4);
      if (message && message.length < 10) {
        ctx.font = "6px monospace";
        ctx.fillText(message, size / 2, size / 2 + 4);
      }
    } catch (error) {

    }
  }

  _renderGeneric(ctx, node) {
    try {
      if (!ctx) {

        return;
      }

      if (!node || !node.kind) {

        return;
      }

      const hash = this._hashString(node.kind);
      const hue = hash % 360;

      ctx.fillStyle = `hsl(${hue}, 60%, 25%)`;
      ctx.fillRect(0, 0, this.size, this.size);

      ctx.fillStyle = `hsl(${hue}, 80%, 70%)`;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const label = node.kind.substring(0, 4).toUpperCase();
      ctx.fillText(label, this.size / 2, this.size / 2);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'generic-preview-render',
        nodeKind: node?.kind
      });
    }
  }

  _renderError(ctx, node, message = 'Error') {
    try {
      if (!ctx) {

        return;
      }

      ctx.fillStyle = "#2d1b1b";
      ctx.fillRect(0, 0, this.size, this.size);

      ctx.fillStyle = "#ff4444";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ERR", this.size / 2, this.size / 2 - 4);

      // Add error message if short enough
      if (message && typeof message === 'string' && message.length < 8) {
        ctx.font = "6px monospace";
        ctx.fillText(message.substring(0, 6), this.size / 2, this.size / 2 + 4);
      }
    } catch (error) {

      // Ultimate fallback - just fill with red
      try {
        ctx.fillStyle = "#ff4444";
        ctx.fillRect(0, 0, this.size, this.size);
      } catch (finalError) {

      }
    }
  }

  _hashString(str) {
    try {
      if (typeof str !== 'string') {
        return 0;
      }

      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
      }
      return Math.abs(hash);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'string-hash',
        string: str
      });
      return 0;
    }
  }

  clearCache() {
    try {
      if (this.canvasManager && typeof this.canvasManager.clearCache === 'function') {
        this.canvasManager.clearCache();

      } else {

      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-cache-clear'
      });
    }
  }
// Replace the entire getParameterValue method (lines 72-85) with this:
getParameterValue(node, paramName, defaultValue = 0) {
  const rawValue = node.params?.[paramName] ?? defaultValue;

  // Check if it's an expression (starts with '=')
  if (typeof rawValue === 'string' && rawValue.startsWith('=')) {
    try {
      // Try to use the full expression system if available
      if (this.editor?.paramPanel?.expressionSystem?.evaluateExpression) {
        return this.editor.paramPanel.expressionSystem.evaluateExpression(rawValue, {}, node);
      }

      // Fallback: handle time expressions with preview-specific evaluation
      if (/\btime\b/i.test(rawValue)) {
        // Use a fixed preview time (π/2 shows sin at peak, cos at zero)
        const previewTime = Math.PI / 2;

        // Simple expression evaluation for preview
        const expression = rawValue.substring(1) // Remove '=' prefix
          .replace(/\bsin\(/g, 'Math.sin(')
          .replace(/\bcos\(/g, 'Math.cos(')
          .replace(/\btan\(/g, 'Math.tan(')
          .replace(/\btime\b/g, previewTime.toString());

        const result = eval(expression);
        return isNaN(result) ? defaultValue : result;
      }

      // If expression system not available and not a time expression, use default

      return defaultValue;
    } catch (error) {

      return defaultValue;
    }
  }

  // For non-expressions, return the raw value or parse it
  return typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || defaultValue);
}

  // Expose subsystem APIs for backward compatibility
getParameter(node, name) {
  return this.getParameterValue(node, name, 0);
}

  computeNodeValue(node, visited = new Set()) {
    try {
      if (!this.nodeValueComputer) {

        return 0;
      }

      if (!node) {

        return 0;
      }

      return this.nodeValueComputer.computeNodeValue(node, visited);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-value-compute',
        nodeId: node?.id,
        nodeKind: node?.kind
      });
      return 0;
    }
  }

  getConnectedInputs(node, visited = new Set()) {
    try {
      if (!this.nodeValueComputer) {

        return [];
      }

      if (!node) {

        return [];
      }

      return this.nodeValueComputer.getConnectedInputs(node, visited);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connected-inputs-get',
        nodeId: node?.id,
        nodeKind: node?.kind
      });
      return [];
    }
  }

  // Diagnostic methods
  getSystemStatus() {
    try {
      return {
        initialized: !!(this.canvasManager && this.nodeValueComputer && this.rendererRegistry),
        hasIntegration: !!this.integration,
        canvasManagerStatus: this.canvasManager ? 'available' : 'missing',
        nodeValueComputerStatus: this.nodeValueComputer ? 'available' : 'missing',
        rendererRegistryStatus: this.rendererRegistry ? 'available' : 'missing',
        registeredRenderers: this.rendererRegistry ? this.rendererRegistry.getRegisteredCount() : 0,
        previewSize: this.size
      };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'system-status'
      });
      return { error: error.message };
    }
  }

  dispose() {
    try {

      // Clear cache
      this.clearCache();
      
      // Clear references
      this.integration = null;
      this.canvasManager = null;
      this.nodeValueComputer = null;
      this.rendererRegistry = null;
      this.editor = null;

    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-system-dispose'
      });
    }
  }
}

// Export the integration class for compatibility
export { PreviewIntegration };
