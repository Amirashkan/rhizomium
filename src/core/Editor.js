// src/core/Editor.js - Complete corrected version with performance optimizations
import { EventHandler } from "./EventHandler.js";
import { Renderer } from "./Renderer.js";
import { MenuManager } from "../ui/MenuManager.js";
import { ParameterPanel } from "../ui/ParameterPanel.js";
import { SelectionManager } from "./SelectionManager.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { ViewportManager } from "./ViewportManager.js";
import { PreviewSystem } from "./PreviewSystem.js";
import { PreviewComputer } from "./PreviewComputer.js";
import { expressionSystem } from '../utils/ParameterExpressionSystem.js';
import { ParameterBindingSystem } from '../utils/ParameterBindingSystem.js';
import { ParameterBindingMenu, BindingVisualizer } from '../ui/ParameterBindingMenu.js';
import { ShaderPreviewManager } from '../preview/ShaderPreviewManager.js';
export class Editor {
  constructor(graph, onChange, undoManager = null) {
    try {
      // Validate required dependencies
      this.validateConstructorInputs(graph, onChange);
      
      // Initialize preview state EARLY
      this.isPreviewEnabled = true;
      this.nodePreviews = new Map();

      // Dirty flag optimization
      this._isDirty = true; // Start as dirty for initial render
      this._dirtyReasons = new Set();

      // MIDI dependency update throttling
      this.midiDependencyUpdatePending = false;
      this.pendingMidiDependencyUpdates = new Map();
      this.midiPreviewUpdateTimer = null;
      this.midiPreviewUpdateDelay = 500; // ms - delay before updating previews after MIDI stops

      // Set basic properties FIRST
      this.graph = graph;
      this.onChange = this.createSafeOnChange(onChange);

      // Get canvas and context with error handling
      this.initializeCanvas();

      // Initialize expression system EARLY
      this.expressionSystem = expressionSystem;
      
      // Initialize event system for expressions
      this.initializeEventSystem();

      // Snap-to-grid defaults
      this.snapEnabled = false;
      this.snapGridSize = 20;
      
      // Initialize managers with error handling
      this.initializeManagers(undoManager);

      // Initialize preview system
      this.initializePreviewSystem();

      // Setup expression integrations AFTER all systems are initialized
      this.setupExpressionIntegrations();

      // Track movement state for undo
      this.movementState = {
        isMoving: false,
        originalPositions: new Map(),
        movedNodes: new Set()
      };

      // Initialize event handling
      this.initializeEventHandling();

      // Setup and initial render
      this.setupResizeHandling();
      this.performInitialRender();
      
      // Make systems globally available for debugging
      window.expressionSystem = this.expressionSystem;
      window.editor = this;

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'editor-construction'
      });
      throw error;
    }
  }

  // ---- INITIALIZATION METHODS WITH ERROR HANDLING ----
  
  validateConstructorInputs(graph, onChange) {
    try {
      if (!graph) {
        throw new Error('Graph is required for Editor initialization');
      }
      
      if (!graph.nodes || !Array.isArray(graph.nodes)) {
        throw new Error('Graph must have a nodes array');
      }
      
      if (onChange && typeof onChange !== 'function') {
        throw new Error('onChange must be a function if provided');
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'constructor-validation'
      });
      throw error;
    }
  }

  createSafeOnChange(onChange) {
    return (context = 'Unknown') => {
      // PERFORMANCE: Skip shader recompilation during parameter drag
      if (this._parameterDragging) {
        return;
      }

      try {
        if (typeof onChange === 'function') {
          onChange();
        }
      } catch (error) {
        window.errorHandler?.handleError(error, {
          component: 'onchange-callback',
          context
        });
      }
    };
  }

  initializeCanvas() {
    try {
      this.canvas = document.getElementById("ui-canvas");
      if (!this.canvas) {
        throw new Error('Canvas element with id "ui-canvas" not found');
      }
      
      // PERFORMANCE: Use optimized canvas context settings
      // willReadFrequently: false - we don't read pixels, only draw
      // This allows browser to optimize for drawing performance
      this.ctx = this.canvas.getContext("2d", {
        willReadFrequently: false,
        desynchronized: true, // Allow async rendering, reduces blocking
        alpha: true // We need transparency for node rendering
      });
      if (!this.ctx) {
        throw new Error('Failed to get 2D rendering context from canvas');
      }
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'canvas-initialization'
      });
      throw error;
    }
  }

  initializeEventSystem() {
    // Create simple event system for internal use
    this.eventSystem = {
      listeners: new Map(),
      
      on(event, callback) {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
      },
      
      off(event, callback) {
        if (this.listeners.has(event)) {
          this.listeners.get(event).delete(callback);
        }
      },
      
      emit(event, data) {
        if (this.listeners.has(event)) {
          this.listeners.get(event).forEach(callback => {
            try {
              callback(data);
            } catch (error) {

            }
          });
        }
      }
    };

    // Also make it available globally if not already set
    if (!window.parameterEventSystem) {
      window.parameterEventSystem = this.eventSystem;
    }
  }

  initializeManagers(undoManager) {
    try {
      // Initialize viewport manager first (needed by others)
      this.viewport = new ViewportManager();
      
      // Initialize core managers
      this.selection = new SelectionManager(this.graph, this.onChange);
      this.connections = new ConnectionManager(this.graph, this.onChange);
      this.renderer = new Renderer(this.ctx, this.viewport);
      this.menu = new MenuManager(this.graph, this.onChange);

      // Ensure snap defaults are synced with selection manager
      if (!Number.isFinite(this.snapGridSize) || this.snapGridSize <= 0) {
        this.snapGridSize = 20;
      }
      if (typeof this.snapEnabled !== 'boolean') {
        this.snapEnabled = false;
      }
      if (this.selection?.setSnapGridSize) {
        this.selection.setSnapGridSize(this.snapGridSize);
      }
      if (this.selection?.setSnapEnabled) {
        this.selection.setSnapEnabled(this.snapEnabled);
      }
      
      // Use the provided UndoManager
      this.undoManager = undoManager;

      // Set undo manager on selection manager for movement tracking
      if (this.undoManager && this.selection.setUndoManager) {
        this.selection.setUndoManager(this.undoManager);
      }

      // Set undo manager on menu manager for duplication tracking
      if (this.undoManager && this.menu.setUndoManager) {
        this.menu.setUndoManager(this.undoManager);
      }

      // Preview system settings
      this.previewSizes = { small: 32, medium: 64, large: 96 };
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'manager-initialization'
      });
      throw error;
    }
  }

  setupExpressionIntegrations() {
    try {
      // Create enhanced ParameterPanel with expression support
      this.paramPanel = new ParameterPanel(
        this.eventSystem,
        this.undoManager,
        this.graph
      );

      // Set parameter panel on selection manager for panel closure on deselection
      if (this.selection.setParamPanel) {
        this.selection.setParamPanel(this.paramPanel);
      }

      this.bindingSystem = new ParameterBindingSystem(this.graph, this.eventSystem, this.undoManager);
      this.bindingMenu = new ParameterBindingMenu(this.bindingSystem, this.paramPanel);

      // Update parameter evaluation in preview system
      if (this.previewSystem) {
        this.integrateExpressionWithPreview();
      }

      // Update parameter evaluation in node value computer
      if (this.nodeValueComputer) {
        this.integrateExpressionWithNodeComputer();
      }

      // Setup event listeners for expression updates
      this.setupExpressionEventListeners();
      this.setupOptimizedGPUAnimationLoop();

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'expression-integration-setup'
      });
    }
  }

setupOptimizedGPUAnimationLoop() {
  const animate = (timestamp) => {
    this.updateAnimationContext(timestamp / 1000, this.animationFrame);
    this.animationFrame++;
    
    // Safety check - only render if function exists
    if (window.render && typeof window.render === 'function') {
      try {
        window.render();
      } catch (error) {

      }
    }
    
    this.gpuAnimationRequestId = requestAnimationFrame(animate);
  };
  
  this.gpuAnimationRequestId = requestAnimationFrame(animate);
}

// ADDITIONAL FIX: Add method to manually connect GPU renderer
connectGPURenderer(renderFunction) {
  if (typeof renderFunction === 'function') {
    this.gpuRenderFunction = renderFunction;
  } else {

  }
}

  // PERFORMANCE OPTIMIZATION: Cache time expression detection
  hasTimeBasedExpressions() {
    // Cache the result for a short time to avoid repeated traversal
    const now = performance.now();
    if (this.timeExpressionCache && (now - this.timeExpressionCache.timestamp) < 100) {
      return this.timeExpressionCache.hasTime;
    }

    const hasTime = this.graph?.nodes?.some(node => {
      if (!node.params) return false;
      return Object.values(node.params).some(value => 
        typeof value === 'string' && 
        value.includes('time') && 
        value.startsWith('=')
      );
    });

    this.timeExpressionCache = {
      hasTime,
      timestamp: now
    };

    return hasTime;
  }

  // PERFORMANCE OPTIMIZATION: Debounced shader rebuild
  triggerShaderRebuild(reason = 'Unknown') {
    // Debounce rebuild calls to prevent spam
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }

    this.rebuildTimeout = setTimeout(() => {
      if (window.rebuild && typeof window.rebuild === 'function') {
        try {
          window.rebuild();

          // Clear time expression cache after rebuild
          this.timeExpressionCache = null;
        } catch (error) {

        }
      }
      this.rebuildTimeout = null;
    }, 16); // Debounce for ~60fps max rebuild rate
  }

  setupExpressionEventListeners() {
    // Listen for parameter changes to update expressions
    this.eventSystem.on('PARAMETER_CHANGED', (data) => {
      this.handleParameterChangeForExpressions(data);
    });

    this.eventSystem.on('GRAPH_CHANGED', (data) => {
      this.handleGraphChangeForExpressions(data);
    });

    // Listen for expression dependency changes
    this.expressionSystem.addDependencyListener((change) => {
      this.handleExpressionDependencyChange(change);
    });
  }

  integrateExpressionWithPreview() {
    try {
      // Enhance preview system to evaluate expressions
      if (this.previewSystem && this.previewSystem.getParameterValue) {
        const originalGetParameterValue = this.previewSystem.getParameterValue.bind(this.previewSystem);
        
        this.previewSystem.getParameterValue = (node, paramName, defaultValue) => {
          try {
            return this.getNodeParameterValue(node, paramName, defaultValue);
          } catch (error) {

            return originalGetParameterValue(node, paramName, defaultValue);
          }
        };
      }
    } catch (error) {

    }
  }

  integrateExpressionWithNodeComputer() {
    try {
      // Enhance node value computer to handle expressions
      if (this.nodeValueComputer && this.nodeValueComputer.getParameterValue) {
        const originalGetParameterValue = this.nodeValueComputer.getParameterValue.bind(this.nodeValueComputer);
        
        this.nodeValueComputer.getParameterValue = (node, paramName, defaultValue) => {
          try {
            return this.getNodeParameterValue(node, paramName, defaultValue);
          } catch (error) {

            return originalGetParameterValue(node, paramName, defaultValue);
          }
        };
      }
    } catch (error) {

    }
  }

  // ---- EXPRESSION SYSTEM INTEGRATION METHODS ----

  getNodeParameterValue(node, paramName, defaultValue) {
    try {
      const rawValue = node.params?.[paramName] ?? defaultValue;
      
      if (this.expressionSystem.isExpression(rawValue)) {
        const context = this.buildNodeContext(node);
        return this.expressionSystem.evaluateExpression(rawValue, context, node);
      }
      
      return this.expressionSystem.parseValue(rawValue);
    } catch (error) {

      return defaultValue;
    }
  }

  setNodeParameterValue(node, paramName, value) {
    try {
      if (this.paramPanel && this.paramPanel.valueManager) {
        this.paramPanel.valueManager.setValue(node, paramName, value);
      } else {
        // Fallback
        if (!node.params) node.params = {};
        
        const oldValue = node.params[paramName];
        
        // Record for undo
        if (this.undoManager && oldValue !== value) {
          this.undoManager.recordParameterChange(node.id, paramName, oldValue, value);
        }
        
        node.params[paramName] = value;
        
        this.expressionSystem.updateDependencies(node.id, paramName, value);
        this.updateNodePreview(node);
        this.onChange(`Parameter Change: ${paramName}`);
        
        // Emit event
        this.eventSystem.emit('PARAMETER_CHANGED', {
          node,
          parameterName: paramName,
          oldValue,
          newValue: value,
          source: 'fallback'
        });
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'set-node-parameter-value',
        nodeId: node?.id,
        paramName
      });
    }
  }

  buildNodeContext(node) {
    const context = {};
    
    try {
      // Add connected input values
      if (node.inputs && this.graph) {
        node.inputs.forEach((inputNodeId, index) => {
          if (inputNodeId) {
            const inputNode = this.graph.nodes.find(n => n.id === inputNodeId);
            if (inputNode) {
              context[`input${index}`] = this.getNodeOutputValue(inputNode);
              context[`input${index}_x`] = inputNode.x || 0;
              context[`input${index}_y`] = inputNode.y || 0;
            }
          }
        });
      }

      // Add global context
      context.time = this.getAnimationTime();
      context.frame = this.getAnimationFrame();
      
      return context;
    } catch (error) {

      return {};
    }
  }

  getNodeOutputValue(node) {
    try {
      if (this.nodeValueComputer) {
        return this.nodeValueComputer.computeNodeValue(node);
      }
      
      // Fallback for simple constant nodes
      if (node.kind === 'ConstFloat') {
        return parseFloat(node.params?.value || node.value || 0);
      }
      
      return 0;
    } catch (error) {

      return 0;
    }
  }

  getAnimationTime() {
    return this.animationTime || (performance.now() / 1000);
  }

  getAnimationFrame() {
    return this.animationFrame || 0;
  }

  handleParameterChangeForExpressions(data) {
    try {
      const { node, parameterName, newValue, source } = data;

      // For MIDI sources, defer ALL expensive operations until MIDI stops
      if (source === 'midi') {
        // Store this update to be processed later
        const key = `${node.id}:${parameterName}`;
        this.pendingMidiDependencyUpdates.set(key, { node, parameterName, newValue });

        // Clear any existing timer
        if (this.midiPreviewUpdateTimer) {
          clearTimeout(this.midiPreviewUpdateTimer);
        }

        // Schedule updates after MIDI activity stops (debounced)
        this.midiPreviewUpdateTimer = setTimeout(() => {
          this.processPendingMidiDependencyUpdates();
        }, this.midiPreviewUpdateDelay);

        return;
      }

      // For non-MIDI sources, update immediately
      this.expressionSystem.updateDependencies(node.id, parameterName, newValue);

      // Update preview for the changed node itself (so labels show correct values)
      this.updateNodePreview(node);

      // Update previews for dependent nodes
      this.updateDependentNodePreviews(node, parameterName);
    } catch (error) {

    }
  }

  processPendingMidiDependencyUpdates() {
    try {
      // Process all pending MIDI dependency updates in a single batch
      for (const { node, parameterName, newValue } of this.pendingMidiDependencyUpdates.values()) {
        // Update expression dependencies (cache clearing)
        this.expressionSystem.updateDependencies(node.id, parameterName, newValue);

        // Update preview for the changed node itself (so labels show correct values)
        this.updateNodePreview(node);

        // Update previews for dependent nodes
        this.updateDependentNodePreviews(node, parameterName);
      }

      // Clear pending updates
      this.pendingMidiDependencyUpdates.clear();
      this.midiPreviewUpdateTimer = null;
    } catch (error) {

      this.midiPreviewUpdateTimer = null;
    }
  }

  // Public method to flush pending MIDI updates immediately (e.g., on node deselect)
  flushPendingMidiUpdates() {
    if (this.midiPreviewUpdateTimer) {
      clearTimeout(this.midiPreviewUpdateTimer);
      this.midiPreviewUpdateTimer = null;
      this.processPendingMidiDependencyUpdates();
    }
  }

  handleGraphChangeForExpressions(data) {
    try {
      // Clear expression cache when graph structure changes
      if (data.action && (
        data.action.includes('Node Added') || 
        data.action.includes('Node Removed') ||
        data.action.includes('Connection')
      )) {
        this.expressionSystem.clearCache();
        this.timeExpressionCache = null; // Clear time expression cache too
      }

      // Update previews for nodes with expressions
      this.updateNodesWithExpressions();
    } catch (error) {

    }
  }

  handleExpressionDependencyChange(change) {
    try {
      // Update dependent node previews when expressions change
      const node = this.graph.nodes.find(n => n.id === change.nodeId);
      if (node) {
        this.updateDependentNodePreviews(node, change.paramName);
      }
    } catch (error) {

    }
  }

  updateNodesWithExpressions() {
    if (!this.graph) return;
    
    try {
      // Find all nodes with expression parameters
      const nodesWithExpressions = this.graph.nodes.filter(node => {
        if (!node.params) return false;
        
        return Object.values(node.params).some(value => 
          this.expressionSystem.isExpression(value)
        );
      });

      // Update their previews
      nodesWithExpressions.forEach(node => {
        this.updateNodePreview(node);
      });
    } catch (error) {

    }
  }

  updateDependentNodePreviews(changedNode, parameterName) {
    if (!this.graph) return;
    
    try {
      // Find nodes that might depend on the changed parameter
      const dependentNodes = this.graph.nodes.filter(node => {
        if (!node.params || node.id === changedNode.id) return false;
        
        return Object.values(node.params).some(value => {
          if (!this.expressionSystem.isExpression(value)) return false;
          
          // Simple dependency check - could be enhanced
          return value.includes(parameterName) || 
                 value.includes(changedNode.id) ||
                 value.includes('input');
        });
      });

      // Update previews for dependent nodes
      dependentNodes.forEach(node => {
        this.updateNodePreview(node);
      });
    } catch (error) {

    }
  }

  updateNodePreview(node) {
    try {
      if (this.previewSystem?.canvasManager) {
        this.previewSystem.canvasManager.canvasCache.delete(node.id);
      }
      
      if (this.previewIntegration) {
        this.previewIntegration.generateNodePreview(node);
      }
    } catch (error) {

    }
  }

  // ---- ANIMATION SYSTEM INTEGRATION ----
  
  updateAnimationContext(time, frame) {
    try {
      this.animationTime = time;
      this.animationFrame = frame;
      
      // Update expression system's built-in functions
      this.expressionSystem.builtInFunctions.time = () => time;
      this.expressionSystem.builtInFunctions.frame = () => frame;
      
      // Clear cache to force re-evaluation with new time
      this.expressionSystem.clearCache();
      
    } catch (error) {

    }
  }

  // ---- EXPRESSION API METHODS ----
  
  evaluateExpression(expression, context = {}, node = null) {
    return this.expressionSystem.evaluateExpression(expression, context, node);
  }

  validateExpression(expression, context = {}, node = null) {
    return this.expressionSystem.validateExpression(expression, context, node);
  }

  debugExpressions() {

    
  }

  // ---- ALL EXISTING EDITOR METHODS (PRESERVED) ----

  initializeEventHandling() {
    try {
      this.eventHandler = new EventHandler({
        // Make eventHandler globally available for warmup calls
        // This allows other components to trigger warmup when needed
        canvas: this.canvas,
        viewport: this.viewport,
        selection: this.selection,
        connections: this.connections,
        menu: this.menu,
        paramPanel: this.paramPanel,
        onChange: this.onChange,
        onDraw: () => this.safeDraw(),
        editor: this,
      });

      // Set event handler on selection manager for cursor position access
      if (this.selection.setEventHandler) {
        this.selection.setEventHandler(this.eventHandler);
      }
      
      // Make eventHandler globally available for warmup calls from other components
      window.eventHandler = this.eventHandler;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'event-handler-initialization'
      });
      throw error;
    }
  }

  setupResizeHandling() {
    try {
      this.resize();
      
      this.resizeHandler = () => {
        try {
          this.resize();
          this.safeDraw();
        } catch (error) {
          window.errorHandler?.handleError(error, {
            component: 'window-resize'
          });
        }
      };
      
      window.addEventListener("resize", this.resizeHandler);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'resize-handler-setup'
      });
    }
  }

  performInitialRender() {
    try {
      this.safeDraw();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'initial-render'
      });
    }
  }

  resize() {
    try {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;

      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'canvas-resize'
      });
    }
  }

  safeDraw() {
    try {
      this.draw();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'render'
      });
      
      try {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#ff0000';
        this.ctx.fillText('Render Error - See notifications', 10, 30);
      } catch (recoveryError) {

      }
    }
  }

  markDirty(reason = 'unknown') {
    this._isDirty = true;
    if (reason) {
      this._dirtyReasons.add(reason);
    }
  }

  clearDirty() {
    this._isDirty = false;
    this._dirtyReasons.clear();
  }

  isDirty() {
    return this._isDirty;
  }

  draw() {
    if (!this.renderer) {
      throw new Error('Renderer not initialized');
    }

    // Only render if dirty (optimization)
    if (!this._isDirty) {
      return;
    }

    // Check if canvas is currently being interacted with (pan, drag, etc.)
    const isInteracting = this.eventHandler?.isCanvasInteracting?.() || false;
    
    // CRITICAL: Render canvas synchronously - cannot be deferred without visual changes
    // However, the renderer itself uses viewport culling to skip off-screen elements
    // This reduces work without changing visuals (elements outside viewport aren't visible anyway)
    this.renderer.render(this.graph, {
      selection: this.selection.getSelected(),
      dragWire: this.connections.getDragWire(),
      boxSelect: this.selection.getBoxSelect(),
      editor: this,
      isInteracting: isInteracting, // Pass interaction state to optimize rendering
    });

    // Clear dirty flag after rendering
    this.clearDirty();
  }

  initializePreviewSystem() {
    try {
      if (!this.graph || !this.graph.nodes) {
        throw new Error("No graph or nodes available for preview system");
      }

      // Create PreviewComputer for computing node output values
      this.previewComputer = new PreviewComputer();

      this.previewSystem = PreviewSystem.create(this);
      window.previewSystem = this.previewSystem;
      this.previewIntegration = this.previewSystem.integration;

      // Initialize ShaderPreviewManager for GPU-based previews
      this.initializeShaderPreviewManager();

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-system-initialization'
      });
      this.previewComputer = null;
      this.previewSystem = null;
      this.previewIntegration = null;
      window.previewSystem = null;
    }
  }

  initializeShaderPreviewManager() {
    try {
      // Wait for GPU device to be available
      if (typeof window !== 'undefined' && window.gpuRenderer?.device) {
        const device = window.gpuRenderer.device;
        const format = window.gpuRenderer.format || 'bgra8unorm';

        this.shaderPreviewManager = new ShaderPreviewManager(this, device, format);
        window.shaderPreviewManager = this.shaderPreviewManager;
      } else {

        // Retry initialization when GPU device becomes available
        const checkDevice = setInterval(() => {
          if (window.gpuRenderer?.device) {
            clearInterval(checkDevice);
            this.initializeShaderPreviewManager();
          }
        }, 100);

        // Give up after 5 seconds
        setTimeout(() => clearInterval(checkDevice), 5000);
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'shader-preview-manager-initialization'
      });
      this.shaderPreviewManager = null;

    }
  }

  // ---- NODE MOVEMENT UNDO INTEGRATION ----
  
  startNodeMovement(nodesToMove) {
    try {
      if (this.movementState.isMoving) {
        return;
      }

      if (!nodesToMove || nodesToMove.length === 0) {

        return;
      }

      this.movementState.isMoving = true;
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();

      nodesToMove.forEach(node => {
        if (!node || typeof node.id === 'undefined') {

          return;
        }
        
        this.movementState.originalPositions.set(node.id, {
          x: typeof node.x === 'number' ? node.x : 0,
          y: typeof node.y === 'number' ? node.y : 0
        });
        this.movementState.movedNodes.add(node);
      });
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'start-node-movement',
        nodeCount: nodesToMove?.length || 0
      });
      this.cancelNodeMovement();
    }
  }

  finishNodeMovement() {
    try {
      if (!this.movementState.isMoving || this.movementState.movedNodes.size === 0) {
        return;
      }

      let hasMovement = false;
      const movementData = [];

      this.movementState.movedNodes.forEach(node => {
        if (!node || typeof node.id === 'undefined') {

          return;
        }
        
        const originalPos = this.movementState.originalPositions.get(node.id);
        if (originalPos && (originalPos.x !== node.x || originalPos.y !== node.y)) {
          hasMovement = true;
          movementData.push({
            nodeId: node.id,
            oldX: originalPos.x,
            oldY: originalPos.y,
            newX: node.x,
            newY: node.y
          });
        }
      });

      if (hasMovement && window.onNodesMovement && typeof window.onNodesMovement === 'function') {
        try {
          window.onNodesMovement(movementData);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-node-movement'
          });
        }
      }

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'finish-node-movement'
      });
    } finally {
      this.movementState.isMoving = false;
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();
    }
  }

  cancelNodeMovement() {
    try {
      this.movementState.isMoving = false;
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'cancel-node-movement'
      });
    }
  }

  // ---- SNAP SETTINGS ----
  
  setSnapEnabled(enabled) {
    const normalized = !!enabled;
    const previous = this.snapEnabled;
    this.snapEnabled = normalized;

    if (this.selection?.setSnapEnabled) {
      this.selection.setSnapEnabled(normalized);
    }

    if (previous !== normalized) {
      // Redraw so grid-aligned visuals update immediately
      this.safeDraw();
    }

    return this.snapEnabled;
  }

  isSnapEnabled() {
    if (typeof this.snapEnabled === 'boolean') {
      return this.snapEnabled;
    }

    if (this.selection?.isSnapEnabled) {
      return !!this.selection.isSnapEnabled();
    }

    return false;
  }

  setSnapGridSize(size) {
    if (!Number.isFinite(size) || size <= 0) {
      return this.getSnapGridSize();
    }

    const previous = this.snapGridSize;
    this.snapGridSize = size;

    if (this.selection?.setSnapGridSize) {
      this.selection.setSnapGridSize(size);
    }

    if (previous !== size) {
      this.safeDraw();
    }

    return this.snapGridSize;
  }

  getSnapGridSize() {
    if (Number.isFinite(this.snapGridSize) && this.snapGridSize > 0) {
      return this.snapGridSize;
    }

    const selectionSettings = this.selection?.getSnapSettings?.();
    if (Number.isFinite(selectionSettings?.gridSize) && selectionSettings.gridSize > 0) {
      return selectionSettings.gridSize;
    }

    return 20;
  }

  applySnapToPoint(x, y) {
    if (this.selection?.applySnap) {
      const snapped = this.selection.applySnap(x, y);
      if (
        snapped &&
        typeof snapped === 'object' &&
        Number.isFinite(snapped.x) &&
        Number.isFinite(snapped.y)
      ) {
        return snapped;
      }
    }

    return { x, y };
  }

  moveNodesToPositions(movementData) {
    try {
      if (!movementData || !Array.isArray(movementData)) {
        throw new Error('Invalid movement data provided');
      }

      let movedCount = 0;
      movementData.forEach(({ nodeId, newX, newY }) => {
        const node = this.graph.nodes.find(n => n.id === nodeId);
        if (node) {
          if (typeof newX === 'number' && typeof newY === 'number') {
            node.x = newX;
            node.y = newY;
            movedCount++;
          } else {

          }
        } else {

        }
      });

      if (movedCount > 0) {
        this.onChange('Node Movement Undo/Redo');
        this.safeDraw();
      }
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'move-nodes-to-positions',
        dataCount: movementData?.length || 0
      });
    }
  }

  deleteConnection(sourceNode, targetNode, inputIndex) {
    try {
      if (!targetNode) {

        return false;
      }
      
      if (!targetNode.inputs || !Array.isArray(targetNode.inputs)) {

        return false;
      }
      
      if (inputIndex < 0 || inputIndex >= targetNode.inputs.length) {

        return false;
      }

      const currentConnection = targetNode.inputs[inputIndex];
      if (currentConnection === null || currentConnection === undefined) {
        return false;
      }

      if (!sourceNode) {
        sourceNode = this.graph.nodes.find(n => n.id == currentConnection);
        if (!sourceNode) {

        }
      }

      const connectionData = {
        sourceNode: sourceNode,
        targetNode: targetNode,
        targetInput: inputIndex
      };

      if (window.onConnectionDeleted && typeof window.onConnectionDeleted === 'function') {
        try {
          window.onConnectionDeleted(connectionData);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-connection-deletion'
          });
        }
      }

      targetNode.inputs[inputIndex] = null;

      this.onChange('Connection Deletion');
      this.eventSystem.emit('GRAPH_CHANGED', { action: 'Connection Deletion' });
      this.safeDraw();

      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'delete-connection',
        targetNodeId: targetNode?.id,
        inputIndex
      });
      return false;
    }
  }

  deleteNode(nodeToDelete) {
    try {
      if (!nodeToDelete) {

        return false;
      }

      const nodeIndex = this.graph.nodes.indexOf(nodeToDelete);
      if (nodeIndex === -1) {

        return false;
      }

      if (window.onNodeDeleted && typeof window.onNodeDeleted === 'function') {
        try {
          window.onNodeDeleted(nodeToDelete);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-node-deletion'
          });
        }
      }

      if (this.selection && this.selection.has && this.selection.has(nodeToDelete)) {
        try {
          this.selection.delete(nodeToDelete);
        } catch (selectionError) {
          window.errorHandler?.handleError(selectionError, {
            component: 'remove-from-selection'
          });
        }
      }

      let connectionsRemoved = 0;
      this.graph.nodes.forEach(node => {
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, index) => {
            if (input === nodeToDelete.id || input == nodeToDelete.id) {
              node.inputs[index] = null;
              connectionsRemoved++;
            }
          });
        }
      });

      this.graph.nodes.splice(nodeIndex, 1);

      // Clean up GPU resources for this node
      this.cleanupNodeResources(nodeToDelete);

      this.onChange('Node Deletion');
      this.eventSystem.emit('GRAPH_CHANGED', { action: 'Node Deletion' });

      // PERFORMANCE FIX: Use debounced rebuild
      this.triggerShaderRebuild('Node Deletion');

      this.safeDraw();

      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'delete-node',
        nodeId: nodeToDelete?.id,
        nodeKind: nodeToDelete?.kind
      });
      return false;
    }
  }

  deleteNodesAsGroup(nodesToDelete) {
    try {
      if (!nodesToDelete || nodesToDelete.length === 0) {

        return false;
      }

      const validNodes = nodesToDelete.filter(node => {
        if (!node) return false;
        const exists = this.graph.nodes.includes(node);
        if (!exists) {

        }
        return exists;
      });
      
      if (validNodes.length === 0) {

        return false;
      }

      if (window.onGroupDeleted && typeof window.onGroupDeleted === 'function') {
        try {
          window.onGroupDeleted(validNodes);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-group-deletion'
          });
        }
      }
      
      validNodes.forEach(nodeToDelete => {
        if (this.selection && this.selection.has && this.selection.has(nodeToDelete)) {
          try {
            this.selection.delete(nodeToDelete);
          } catch (selectionError) {

          }
        }
      });
      
      const nodeIdsToDelete = new Set(validNodes.map(n => n.id));
      
      let connectionsRemoved = 0;
      this.graph.nodes.forEach(node => {
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, index) => {
            if (input !== null && input !== undefined && nodeIdsToDelete.has(input)) {
              node.inputs[index] = null;
              connectionsRemoved++;
            }
          });
        }
      });
      
      const sortedNodesToDelete = validNodes
        .map(node => ({ node, index: this.graph.nodes.indexOf(node) }))
        .filter(item => item.index !== -1)
        .sort((a, b) => b.index - a.index);
      
      sortedNodesToDelete.forEach(({ node, index }) => {
        this.graph.nodes.splice(index, 1);
      });

      // Clean up GPU resources for all deleted nodes
      validNodes.forEach(node => {
        this.cleanupNodeResources(node);
      });

      this.onChange('Group Deletion');
      this.eventSystem.emit('GRAPH_CHANGED', { action: 'Group Deletion' });
      
      // PERFORMANCE FIX: Use debounced rebuild
      this.triggerShaderRebuild('Group Deletion');
      
      this.safeDraw();
      
      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'delete-nodes-group',
        nodeCount: nodesToDelete?.length || 0
      });
      return false;
    }
  }

  createConnection(sourceNodeId, targetNodeId, targetInput) {
    // Warm up GPU/canvas before connection creation to prevent lag
    if (window.eventHandler && typeof window.eventHandler._checkAndWarmupAfterInactivity === 'function') {
      window.eventHandler._checkAndWarmupAfterInactivity();
    }
    
    try {
      if (typeof sourceNodeId === 'undefined' || typeof targetNodeId === 'undefined') {
        throw new Error('Source and target node IDs are required');
      }
      
      if (typeof targetInput !== 'number' || targetInput < 0) {
        throw new Error('Valid target input index is required');
      }

      const sourceNode = this.graph.nodes.find(n => n.id == sourceNodeId);
      const targetNode = this.graph.nodes.find(n => n.id == targetNodeId);

      if (!sourceNode) {
        throw new Error(`Source node not found: ${sourceNodeId}`);
      }
      
      if (!targetNode) {
        throw new Error(`Target node not found: ${targetNodeId}`);
      }

      if (sourceNodeId == targetNodeId) {

        return false;
      }

      if (!targetNode.inputs) {
        targetNode.inputs = [];
      }

      while (targetNode.inputs.length <= targetInput) {
        targetNode.inputs.push(null);
      }

      if (targetNode.inputs[targetInput] == sourceNodeId) {
        return true;
      }

      targetNode.inputs[targetInput] = sourceNodeId;

      if (window.onConnectionCreated && typeof window.onConnectionCreated === 'function') {
        try {
          window.onConnectionCreated(sourceNodeId, targetNodeId, targetInput);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-connection-creation'
          });
        }
      }

      this.onChange('Connection Creation');
      this.eventSystem.emit('GRAPH_CHANGED', { action: 'Connection Creation' });
      
      // PERFORMANCE FIX: Use debounced rebuild
      this.triggerShaderRebuild('Connection Creation');
      
      this.safeDraw();

      return true;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'create-connection',
        sourceNodeId,
        targetNodeId,
        targetInput
      });
      return false;
    }
  }

  createNode(nodeType, x, y) {
    try {
      // Warm up GPU/canvas before node creation to prevent lag
      if (window.eventHandler && typeof window.eventHandler._checkAndWarmupAfterInactivity === 'function') {
        window.eventHandler._checkAndWarmupAfterInactivity();
      }
      
      if (!nodeType || typeof nodeType !== 'string') {
        throw new Error('Valid node type string is required');
      }
      
      if (typeof x !== 'number' || typeof y !== 'number') {
        throw new Error('Valid x and y coordinates are required');
      }

      const { makeNode } = window.NodeDefs || {};
      if (!makeNode || typeof makeNode !== 'function') {
        throw new Error('makeNode function not available in NodeDefs');
      }

      const snappedPosition = this.applySnapToPoint(x, y);
      const finalX = Number.isFinite(snappedPosition?.x) ? snappedPosition.x : x;
      const finalY = Number.isFinite(snappedPosition?.y) ? snappedPosition.y : y;

      const newNode = makeNode(nodeType, finalX, finalY);
      
      if (!newNode) {
        throw new Error(`Failed to create node of type: ${nodeType}`);
      }
      
      if (!newNode.id) {
        throw new Error('Created node missing required ID');
      }

      this.graph.nodes.push(newNode);

      if (window.onNodeCreated && typeof window.onNodeCreated === 'function') {
        try {
          window.onNodeCreated(newNode);
        } catch (undoError) {
          window.errorHandler?.handleError(undoError, {
            component: 'record-node-creation'
          });
        }
      }

      this.onChange('Node Creation');
      this.eventSystem.emit('GRAPH_CHANGED', { action: 'Node Creation' });

      // PERFORMANCE FIX: Use debounced rebuild
      this.triggerShaderRebuild('Node Creation');

      this.safeDraw();
      
      // Mark interaction start for immediate updates after node creation
      if (window.eventHandler) {
        window.eventHandler._interactionStartTime = Date.now();
        window.eventHandler._justWarmedUp = true;
        // Keep immediate updates active for 1 second after node creation
        setTimeout(() => {
          if (window.eventHandler) {
            window.eventHandler._justWarmedUp = false;
          }
        }, 1000);
      }

      // Generate preview for the newly created node
      // This ensures the node has a preview before any connections are made
      if (this.previewIntegration && this.isPreviewEnabled) {
        try {
          this.previewIntegration.generateNodePreview(newNode);
        } catch (previewError) {
          window.errorHandler?.handleError(previewError, {
            component: 'node-creation-preview',
            nodeId: newNode.id,
            nodeKind: newNode.kind
          });
        }
      }

      return newNode;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'create-node',
        nodeType,
        coordinates: { x, y }
      });
      return null;
    }
  }

  // ---- KEYBOARD HANDLING ----
  
  handleKeyDown(event) {
    try {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        
        if (this.selection && this.selection.getSelected && this.selection.getSelected().size > 0) {
          const selectedNodeIds = Array.from(this.selection.getSelected());
          
          const nodesToDelete = selectedNodeIds
            .map(nodeId => this.graph.nodes.find(n => n.id === nodeId))
            .filter(node => node !== undefined);

          if (nodesToDelete.length === 0) {

            return true;
          }
          
          let deletionSuccess = false;
          if (nodesToDelete.length > 1) {
            deletionSuccess = this.deleteNodesAsGroup(nodesToDelete);
          } else {
            deletionSuccess = this.deleteNode(nodesToDelete[0]);
          }
          
          if (this.selection.clear) {
            try {
              this.selection.clear();
            } catch (clearError) {

            }
          }

        }
        
        return true;
      }
      
      if (event.key === 'Escape') {
        this.cancelNodeMovement();
        return true;
      }
      
      return false;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'keyboard-handler',
        key: event?.key
      });
      return false;
    }
  }

  // ---- MOUSE EVENT HANDLING ----
  
  handleRightClick(mouseX, mouseY) {
    try {
      const rect = this.canvas.getBoundingClientRect();
      const canvasX = mouseX - rect.left;
      const canvasY = mouseY - rect.top;
      
      const connectionInfo = this.getConnectionAt(canvasX, canvasY);
      if (connectionInfo) {
        this.deleteConnection(connectionInfo.sourceNode, connectionInfo.targetNode, connectionInfo.targetInput);
        return true;
      }

      const node = this.getNodeAt(canvasX, canvasY);
      if (node) {
        const confirmMessage = `Delete node "${node.kind}"?`;
        if (confirm(confirmMessage)) {
          this.deleteNode(node);
        }
        return true;
      }

      return false;
      
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'right-click-handler',
        mousePosition: { x: mouseX, y: mouseY }
      });
      return false;
    }
  }

  // ---- HELPER METHODS ----
  
  getConnectionAt(mouseX, mouseY) {
    try {
      const worldX = (mouseX - this.viewport.offsetX) / this.viewport.scale;
      const worldY = (mouseY - this.viewport.offsetY) / this.viewport.scale;

      for (const node of this.graph.nodes) {
        if (!node.inputs || !Array.isArray(node.inputs)) continue;

        for (let inputIndex = 0; inputIndex < node.inputs.length; inputIndex++) {
          const input = node.inputs[inputIndex];
          if (!input) continue;

          const sourceNode = this.graph.nodes.find(n => n.id == input);
          if (!sourceNode) continue;

          const startX = sourceNode.x + 120;
          const startY = sourceNode.y + 25;
          const endX = node.x;
          const endY = node.y + 25 + (inputIndex * 25);

          const distance = this.distanceToLine(worldX, worldY, startX, startY, endX, endY);
          if (distance < 10) {
            return {
              sourceNode: sourceNode,
              targetNode: node,
              targetInput: inputIndex
            };
          }
        }
      }

      return null;
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Get Connection At Position', 'warning');
      return null;
    }
  }

  getNodeAt(mouseX, mouseY) {
    try {
      const worldX = (mouseX - this.viewport.offsetX) / this.viewport.scale;
      const worldY = (mouseY - this.viewport.offsetY) / this.viewport.scale;

      for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
        const node = this.graph.nodes[i];

        const nodeWidth = 120;
        const nodeHeight = 60;

        if (worldX >= node.x && worldX <= node.x + nodeWidth &&
            worldY >= node.y && worldY <= node.y + nodeHeight) {
          return node;
        }
      }

      return null;
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Get Node At Position', 'warning');
      return null;
    }
  }

  distanceToLine(px, py, x1, y1, x2, y2) {
    try {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length === 0) {
        return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
      }

      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
      const projection = {
        x: x1 + t * dx,
        y: y1 + t * dy
      };

      return Math.sqrt((px - projection.x) * (px - projection.x) + (py - projection.y) * (py - projection.y));
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Distance to Line Calculation', 'warning');
      return Infinity;
    }
  }

  // ---- NODE PREVIEW METHODS ----
  
  toggleNodePreview(nodeId) {
    try {
      if (typeof nodeId === 'undefined') {
        throw new Error('Node ID is required for preview toggle');
      }

      if (!this.nodePreviews.has(nodeId)) {
        this.nodePreviews.set(nodeId, {
          enabled: true,
          size: "small",
          showVisualInfo: true,
        });
      }

      const preview = this.nodePreviews.get(nodeId);
      preview.enabled = !preview.enabled;

      if (preview.enabled) {
        const node = this.graph.nodes.find((n) => n.id === nodeId);
        if (node && this.previewIntegration) {
          try {
            this.previewIntegration.generateNodePreview(node);
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, 'Generate Node Preview', 'warning');
          }
        } else if (!node) {

        }
      } else {
        const node = this.graph.nodes.find((n) => n.id === nodeId);
        if (node) node.__thumb = null;
      }

      this.safeDraw();
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Toggle Node Preview', 'warning');
    }
  }

  cyclePreviewSize(nodeId) {
    try {
      if (typeof nodeId === 'undefined') {
        throw new Error('Node ID is required for preview size cycling');
      }

      if (!this.nodePreviews.has(nodeId)) {
        this.nodePreviews.set(nodeId, {
          enabled: true,
          size: "small",
          showVisualInfo: true,
        });
      }

      const preview = this.nodePreviews.get(nodeId);
      const sizes = ["small", "medium", "large"];
      const currentIndex = sizes.indexOf(preview.size);
      preview.size = sizes[(currentIndex + 1) % sizes.length];

      if (this.isPreviewEnabled && preview.enabled) {
        const node = this.graph.nodes.find((n) => n.id === nodeId);
        if (node && this.previewIntegration) {
          try {
            this.previewIntegration.generateNodePreview(node);
          } catch (previewError) {
            window.errorHandler?.handleError(previewError, 'Update Node Preview Size', 'warning');
          }
        } else if (!node) {

        }
      }

      this.safeDraw();
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Cycle Preview Size', 'warning');
    }
  }

  toggleNodeVisualInfo(nodeId) {
    try {
      if (typeof nodeId === 'undefined') {
        throw new Error('Node ID is required for visual info toggle');
      }

      if (!this.nodePreviews.has(nodeId)) {
        this.nodePreviews.set(nodeId, {
          enabled: true,
          size: "small",
          showVisualInfo: true,
        });
      }

      const preview = this.nodePreviews.get(nodeId);
      preview.showVisualInfo = !preview.showVisualInfo;

      this.safeDraw();
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Toggle Visual Info', 'warning');
    }
  }

  // ---- PREVIEW HELPER METHODS ----
  
  shouldShowPreview(node) {
    try {
      if (!node) return false;
      return this.isPreviewEnabled || !!node.__thumb;
    } catch (error) {

      return false;
    }
  }

  isPreviewEnabled(nodeId) {
    try {
      if (typeof nodeId === 'undefined') return true;
      const preview = this.nodePreviews.get(nodeId);
      return preview ? preview.enabled : true;
    } catch (error) {

      return true;
    }
  }

  isVisualInfoEnabled(nodeId) {
    try {
      if (typeof nodeId === 'undefined') return true;
      const preview = this.nodePreviews.get(nodeId);
      return preview ? preview.showVisualInfo : true;
    } catch (error) {

      return true;
    }
  }

  getPreviewSize(nodeId) {
    try {
      if (typeof nodeId === 'undefined') return this.previewSizes.small;
      const preview = this.nodePreviews.get(nodeId);
      const sizeKey = preview?.size || "small";
      return this.previewSizes[sizeKey] || this.previewSizes.small;
    } catch (error) {

      return this.previewSizes.small;
    }
  }

  // ---- SELECTION API ----
  
  selectAll() {
    try {
      if (this.selection && this.selection.selectAll) {
        this.selection.selectAll();
      } else {

      }
    } catch (error) {
      window.errorHandler?.handleError(error, 'Select All', 'warning');
    }
  }

  moveSelection(dx, dy) {
    try {
      if (typeof dx !== 'number' || typeof dy !== 'number') {
        throw new Error('Valid dx and dy values are required for move selection');
      }

      if (this.selection && this.selection.moveSelected) {
        this.selection.moveSelected(dx, dy);
        this.safeDraw();
      } else {

      }
    } catch (error) {
      window.errorHandler?.handleError(error, 'Move Selection', 'warning');
    }
  }

  duplicateSelected() {
    try {
      if (this.selection && this.selection.duplicateSelected) {
        const result = this.selection.duplicateSelected();
        if (result) {
          this.onChange('Duplicate Selection');
          this.triggerShaderRebuild('Duplicate Selection');
          this.safeDraw();
        }
      } else {

      }
    } catch (error) {
      window.errorHandler?.handleError(error, 'Duplicate Selection', 'warning');
    }
  }

  // ---- CLEANUP AND DISPOSAL ----

  /**
   * Clean up all GPU resources associated with a node
   * @param {Object} node - The node being deleted
   */
  cleanupNodeResources(node) {
    if (!node || !node.id) {

      return;
    }

    const nodeId = node.id;

    try {
      // 1. Clean up compute executor resources
      if (window.computeExecutor && typeof window.computeExecutor.removeComputeNode === 'function') {
        window.computeExecutor.removeComputeNode(nodeId);
      }

      // 2. Clean up texture manager resources (for texture nodes)
      if (window.textureManager && typeof window.textureManager.removeTexture === 'function') {
        window.textureManager.removeTexture(nodeId);
      }

      // 3. Clean up preview textures
      if (this.shaderPreviewManager && typeof this.shaderPreviewManager.destroyPreviewTexture === 'function') {
        this.shaderPreviewManager.destroyPreviewTexture(nodeId);
      }

      // 4. Clean up GPU preview renderer cache
      if (window.gpuPreviewRenderer && typeof window.gpuPreviewRenderer.destroyPreviewTexture === 'function') {
        window.gpuPreviewRenderer.destroyPreviewTexture(nodeId);
      }

      // 5. Clean up from resource tracker registry (if not already cleaned by compute executor)
      if (typeof window.globalResourceRegistry !== 'undefined' && window.globalResourceRegistry) {
        window.globalResourceRegistry.destroy(nodeId);
      }

      // 6. Remove any preview from the editor's cache
      if (this.nodePreviews && this.nodePreviews.has(nodeId)) {
        this.nodePreviews.delete(nodeId);
      }

    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'cleanup-node-resources',
        nodeId,
        nodeKind: node.kind
      });
    }
  }

  dispose() {
    try {
      // Clean up GPU animation loop
      if (this.gpuAnimationLoop) {
        clearInterval(this.gpuAnimationLoop);
        this.gpuAnimationLoop = null;
      }
      
      if (this.gpuAnimationRequestId) {
        cancelAnimationFrame(this.gpuAnimationRequestId);
        this.gpuAnimationRequestId = null;
      }
      
      if (this.rebuildTimeout) {
        clearTimeout(this.rebuildTimeout);
        this.rebuildTimeout = null;
      }
      
      if (this.resizeHandler) {
        window.removeEventListener("resize", this.resizeHandler);
        this.resizeHandler = null;
      }
      
      if (this.eventHandler && this.eventHandler.dispose) {
        this.eventHandler.dispose();
      }
      
      if (this.previewSystem && this.previewSystem.dispose) {
        this.previewSystem.dispose();
      }
      
      if (this.paramPanel && this.paramPanel.destroy) {
        this.paramPanel.destroy();
      }
      
      // Clear references
      this.canvas = null;
      this.ctx = null;
      this.graph = null;
      this.onChange = null;
      this.viewport = null;
      this.selection = null;
      this.connections = null;
      this.renderer = null;
      this.menu = null;
      this.paramPanel = null;
      this.previewComputer = null;
      this.previewSystem = null;
      this.previewIntegration = null;
      this.undoManager = null;
      this.eventSystem = null;
      this.expressionSystem = null;
      this.timeExpressionCache = null;
      
      // Clear maps
      this.nodePreviews.clear();
      this.movementState.originalPositions.clear();
      this.movementState.movedNodes.clear();

    } catch (error) {

    }
  }

  // ---- DEBUG METHODS ----
  
  getDebugInfo() {
    try {
      return {
        nodeCount: this.graph?.nodes?.length || 0,
        previewCount: this.nodePreviews.size,
        isMoving: this.movementState.isMoving,
        hasSelection: this.selection?.getSelected?.().size > 0,
        expressionCacheSize: this.expressionSystem?.getCacheStats?.()?.size || 0,
        timeExpressionCache: this.timeExpressionCache,
        animationFrame: this.animationFrame,
        canvasSize: {
          width: this.canvas?.width || 0,
          height: this.canvas?.height || 0
        },
        viewport: {
          scale: this.viewport?.scale || 1,
          offsetX: this.viewport?.offsetX || 0,
          offsetY: this.viewport?.offsetY || 0
        }
      };
    } catch (error) {

      return { error: error.message };
    }
  }

  validateGraphIntegrity() {
    try {
      const issues = [];
      
      if (!this.graph || !Array.isArray(this.graph.nodes)) {
        issues.push('Graph or nodes array missing');
        return issues;
      }
      
      const ids = new Set();
      this.graph.nodes.forEach((node, index) => {
        if (!node) {
          issues.push(`Null node at index ${index}`);
          return;
        }
        
        if (typeof node.id === 'undefined') {
          issues.push(`Node missing ID at index ${index}`);
          return;
        }
        
        if (ids.has(node.id)) {
          issues.push(`Duplicate node ID: ${node.id}`);
        } else {
          ids.add(node.id);
        }
        
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, inputIndex) => {
            if (input !== null && input !== undefined && !ids.has(input)) {
              issues.push(`Node ${node.id} input[${inputIndex}] references non-existent node: ${input}`);
            }
          });
        }
      });
      
      if (issues.length > 0) {

      }
      
      return issues;
      
    } catch (error) {
      window.errorHandler?.handleError(error, 'Graph Validation', 'warning');
      return ['Validation failed: ' + error.message];
    }
  }
}
