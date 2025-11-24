// src/core/PreviewSystem.js - Enhanced with ErrorHandler integration

import { CanvasManager } from './preview/CanvasManager.js';
import { NodeValueComputer } from './preview/NodeValueComputer.js';
import { RendererRegistry } from './preview/RendererRegistry.js';
import { PreviewIntegration } from './preview/PreviewIntegration.js';

import { BasicRenderers } from './preview/renderers/BasicRenderers.js';
import { MathRenderers } from './preview/renderers/MathRenderers.js';
import { VectorRenderers } from './preview/renderers/VectorRenderers.js';
import { NoiseRenderers } from './preview/renderers/NoiseRenderers.js';
import { TextureRenderers } from './preview/renderers/TextureRenderers.js';
import { UtilityRenderers } from './preview/renderers/UtilityRenderers.js';
import { TransformRenderers } from './preview/renderers/TransformRenderers.js';
import { GradientRenderers } from './preview/renderers/GradientRenderers.js';

const INPUT_ONLY_NODES = ['time', 'uv', 'constfloat', 'constint', 'constvec2', 'constvec3'];

export class PreviewSystem {
  constructor(editor) {
    this.renderingNodes = new Set();

    if (!editor) {
      throw new Error('Editor is required for PreviewSystem initialization');
    }

    this.editor = editor;
    this.size = 48;
    this._sortCache = null;
    this._sortCacheKey = null;

    this._initializeSubsystems();
    this._registerRenderers();

    // Integration is created externally via PreviewIntegration
    this.integration = null;
  }

  _initializeSubsystems() {
    try {
      this.canvasManager = new CanvasManager(this.size);
      this.nodeValueComputer = new NodeValueComputer(this.editor);
      this.rendererRegistry = new RendererRegistry();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-subsystem-init',
        size: this.size,
      });
      throw error;
    }
  }

  setIntegration(integration) {
    if (!integration) {
      return;
    }
    this.integration = integration;
  }

  static create(editor) {
    if (!editor) {
      throw new Error('Editor is required for PreviewSystem creation');
    }

    const previewSystem = new PreviewSystem(editor);
    const integration = new PreviewIntegration(editor, previewSystem);
    previewSystem.setIntegration(integration);
    return previewSystem;
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

      rendererGroups.forEach((RendererGroup, index) => {
        try {
          if (!RendererGroup) {
            throw new Error(`Renderer group ${index} is undefined`);
          }

          const renderers = new RendererGroup(this);
          if (renderers && typeof renderers.register === 'function') {
            renderers.register(this.rendererRegistry);
          }
        } catch (rendererError) {
          window.errorHandler?.handleError(rendererError, {
            component: 'renderer-group-registration',
            rendererGroupIndex: index,
            rendererGroupName: RendererGroup?.name || 'Unknown',
          });
        }
      });
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'renderer-registration',
      });
      throw error;
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
        component: 'preview-fallback',
      });
    }
  }

  generateNodePreview(node) {
    if (!node || !node.id || !node.kind) {
      return;
    }

    if (INPUT_ONLY_NODES.includes(node.kind.toLowerCase()) || node.kind.toLowerCase() === 'time') {
      return;
    }

    if (!this.editor.isPreviewEnabled) {
      node.__thumb = null;
      return;
    }

    try {
      const canvas = this.canvasManager.getCanvas(node.id);
      if (!canvas) {
        throw new Error(`Failed to get canvas for node ${node.id}`);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error(`Failed to get 2D context for node ${node.id}`);
      }

      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, this.size, this.size);

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

      node.__thumb = canvas;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'node-preview-generation',
        nodeId: node?.id,
        nodeKind: node?.kind,
      });

      try {
        const canvas = this.canvasManager?.getCanvas(node?.id || 'error');
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) {
          this._renderError(ctx, node, error.message);
          node.__thumb = canvas;
        }
      } catch {
        // swallow secondary failures
      }
    }
  }

  updateAllPreviews(nodes) {
    if (!nodes || !Array.isArray(nodes)) {
      return;
    }

    try {
      if (this.editor?.previewComputer && this.editor?.graph) {
        this.editor.previewComputer.requestPreviewComputation(
          this.editor.graph,
          { time: performance.now() / 1000 },
          {},
          () => this._doUpdateAllPreviews(nodes),
        );
        return;
      }

      this._doUpdateAllPreviews(nodes);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'update-all-previews',
      });
    }
  }

  _doUpdateAllPreviews(nodes) {
    const sortedNodes = this.topologicalSort(nodes);

    sortedNodes.forEach((node) => {
      try {
        this.generateNodePreview(node);
      } catch (error) {
        window.errorHandler?.handleError(error, {
          component: 'preview-generation',
          nodeId: node?.id,
          nodeKind: node?.kind,
        });
      }
    });
  }

  _generateSortCacheKey(nodes) {
    if (!nodes || !Array.isArray(nodes)) {
      return '';
    }

    const parts = [];
    nodes.forEach((node) => {
      if (node?.id) {
        const inputs = (node.inputs || []).filter(Boolean).join(',');
        parts.push(`${node.id}:${inputs}`);
      }
    });
    return parts.sort().join('|');
  }

  invalidateSortCache() {
    this._sortCache = null;
    this._sortCacheKey = null;
  }

  topologicalSort(nodes) {
    if (!nodes || !Array.isArray(nodes)) {
      return [];
    }

    const cacheKey = this._generateSortCacheKey(nodes);
    if (this._sortCache && this._sortCacheKey === cacheKey) {
      return this._sortCache;
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const visited = new Set();
    const result = [];

    const visit = (nodeId) => {
      if (!nodeId || visited.has(nodeId)) {
        return;
      }
      visited.add(nodeId);

      const node = byId.get(nodeId);
      if (!node) {
        return;
      }

      if (Array.isArray(node.inputs)) {
        node.inputs.forEach((inputId) => {
          if (inputId) {
            visit(inputId);
          }
        });
      }

      result.push(node);
    };

    nodes.forEach((node) => {
      if (node?.id) {
        visit(node.id);
      }
    });

    this._sortCache = result;
    this._sortCacheKey = cacheKey;
    return result;
  }

  renderTexture2D(node, size) {
    try {
      if (!node?.id) {
        throw new Error('Node with id is required for texture rendering');
      }

      const renderSize = typeof size === 'number' && size > 0 ? size : this.size;
      const canvas = document.createElement('canvas');
      canvas.width = renderSize;
      canvas.height = renderSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get 2D context for texture canvas');
      }

      const textureInfo = window.textureManager?.getTexture(node.id);

      if (textureInfo?.file) {
        const img = new Image();

        img.onload = () => {
          try {
            ctx.clearRect(0, 0, renderSize, renderSize);
            ctx.drawImage(img, 0, 0, renderSize, renderSize);
            ctx.fillStyle = 'rgba(74, 144, 226, 0.9)';
            ctx.fillRect(0, 0, 14, 10);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 8px Arial';
            ctx.fillText('2D', 2, 8);
          } catch {
            this._renderTextureError(ctx, renderSize, 'Draw failed');
          }
        };

        img.onerror = () => {
          this._renderTextureError(ctx, renderSize, 'Load failed');
        };

        try {
          img.src = URL.createObjectURL(textureInfo.file);
        } catch {
          this._renderTextureError(ctx, renderSize, 'URL failed');
        }

        this._renderTextureLoading(ctx, renderSize);
      } else {
        this._renderTexturePlaceholder(ctx, renderSize);
      }

      return canvas;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'texture2d-rendering',
        nodeId: node?.id,
        size,
      });

      const canvas = document.createElement('canvas');
      const safeSize = typeof size === 'number' && size > 0 ? size : this.size;
      canvas.width = safeSize;
      canvas.height = safeSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        this._renderTextureError(ctx, safeSize, error.message);
      }
      return canvas;
    }
  }

  _renderTextureLoading(ctx, size) {
    try {
      ctx.fillStyle = '#555';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#4a90e2';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', size / 2, size / 2);
    } catch {
      // noop
    }
  }

  _renderTexturePlaceholder(ctx, size) {
    try {
      ctx.fillStyle = '#444';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#4a90e2';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, size - 4, size - 4);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('2D', size / 2, size / 2 - 4);
      ctx.fillText('TEX', size / 2, size / 2 + 10);
    } catch {
      // noop
    }
  }

  _renderTextureError(ctx, size, message) {
    try {
      ctx.fillStyle = '#2d1b1b';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#ff4444';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ERR', size / 2, size / 2 - 4);
      if (message && message.length < 10) {
        ctx.font = '6px monospace';
        ctx.fillText(message, size / 2, size / 2 + 4);
      }
    } catch {
      // noop
    }
  }

  _renderGeneric(ctx, node) {
    if (!ctx || !node?.kind) {
      return;
    }

    const hash = this._hashString(node.kind);
    const hue = hash % 360;

    ctx.fillStyle = `hsl(${hue}, 60%, 25%)`;
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.fillStyle = `hsl(${hue}, 80%, 70%)`;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = node.kind.substring(0, 4).toUpperCase();
    ctx.fillText(label, this.size / 2, this.size / 2);
  }

  _renderError(ctx, node, message = 'Error') {
    if (!ctx) {
      return;
    }

    try {
      ctx.fillStyle = '#2d1b1b';
      ctx.fillRect(0, 0, this.size, this.size);
      ctx.fillStyle = '#ff4444';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ERR', this.size / 2, this.size / 2 - 4);

      if (message && typeof message === 'string' && message.length < 8) {
        ctx.font = '6px monospace';
        ctx.fillText(message.substring(0, 6), this.size / 2, this.size / 2 + 4);
      }
    } catch {
      try {
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(0, 0, this.size, this.size);
      } catch {
        // noop
      }
    }
  }

  _hashString(str) {
    if (typeof str !== 'string') {
      return 0;
    }

    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }

  clearCache() {
    try {
      if (this.canvasManager && typeof this.canvasManager.clearCache === 'function') {
        this.canvasManager.clearCache();
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-cache-clear',
      });
    }
  }

  getParameterValue(node, paramName, defaultValue = 0) {
    const rawValue = node?.params?.[paramName] ?? defaultValue;

    if (typeof rawValue === 'string' && rawValue.startsWith('=')) {
      try {
        if (this.editor?.paramPanel?.expressionSystem?.evaluateExpression) {
          return this.editor.paramPanel.expressionSystem.evaluateExpression(rawValue, {}, node);
        }

        if (/\btime\b/i.test(rawValue)) {
          const previewTime = Math.PI / 2;
          const expression = rawValue
            .substring(1)
            .replace(/\bsin\(/g, 'Math.sin(')
            .replace(/\bcos\(/g, 'Math.cos(')
            .replace(/\btan\(/g, 'Math.tan(')
            .replace(/\btime\b/g, previewTime.toString());
          const result = eval(expression); // eslint-disable-line no-eval
          return Number.isNaN(result) ? defaultValue : result;
        }
      } catch {
        return defaultValue;
      }

      return defaultValue;
    }

    return typeof rawValue === 'number' ? rawValue : parseFloat(rawValue) || defaultValue;
  }

  getParameter(node, name) {
    return this.getParameterValue(node, name, 0);
  }

  computeNodeValue(node, visited = new Set()) {
    try {
      if (!this.nodeValueComputer || !node) {
        return 0;
      }
      return this.nodeValueComputer.computeNodeValue(node, visited);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'node-value-compute',
        nodeId: node?.id,
        nodeKind: node?.kind,
      });
      return 0;
    }
  }

  getConnectedInputs(node, visited = new Set()) {
    try {
      if (!this.nodeValueComputer || !node) {
        return [];
      }
      return this.nodeValueComputer.getConnectedInputs(node, visited);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'connected-inputs-get',
        nodeId: node?.id,
        nodeKind: node?.kind,
      });
      return [];
    }
  }

  getSystemStatus() {
    try {
      return {
        initialized: Boolean(this.canvasManager && this.nodeValueComputer && this.rendererRegistry),
        hasIntegration: Boolean(this.integration),
        canvasManagerStatus: this.canvasManager ? 'available' : 'missing',
        nodeValueComputerStatus: this.nodeValueComputer ? 'available' : 'missing',
        rendererRegistryStatus: this.rendererRegistry ? 'available' : 'missing',
        registeredRenderers: this.rendererRegistry?.getRegisteredCount?.() ?? 0,
        previewSize: this.size,
      };
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'system-status',
      });
      return { error: error.message };
    }
  }

  dispose() {
    try {
      this.clearCache();
      this.integration = null;
      this.canvasManager = null;
      this.nodeValueComputer = null;
      this.rendererRegistry = null;
      this.editor = null;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-system-dispose',
      });
    }
  }
}

export { PreviewIntegration };
