// src/core/EventHandler.js - Complete version with undo system integration
export class EventHandler {
  constructor(options) {
    this.canvas = options.canvas;
    this.viewport = options.viewport;
    this.selection = options.selection;
    this.connections = options.connections;
    this.menu = options.menu;
    this.paramPanel = options.paramPanel;
    this.onChange = options.onChange;
    this.onDraw = options.onDraw;
    this.editor = options.editor;
    // Track when we open the parameter panel to prevent immediate closure
    this.paramPanelJustOpened = false;
    // Track CTRL-drag zoom interactions
    this._zoomDragState = null;
    // Track canvas pan and box-select gestures
    this._panCandidate = null;
    this._boxSelectCandidate = null;
    this._pendingContextMenu = null;
    // Track last cursor position for paste/duplicate
    this.lastCanvasPos = { x: 0, y: 0 };
    // Performance optimization: throttle rendering with requestAnimationFrame
    this._pendingFrame = null;
    this._needsRender = false;
    // Performance optimization: throttle pan updates to max 60fps
    this._panUpdateScheduled = false;
    this._pendingPanUpdate = null;
    // Performance optimization: throttle node/wire drag updates to max 60fps
    this._dragUpdateScheduled = false;
    this._pendingDragEvent = null;
    // Track user activity to detect inactivity and warm up GPU
    this._lastInteractionTime = Date.now();
    this._lastMouseMoveTime = Date.now();
    this._inactivityThreshold = 100; // 100ms - warm up after any pause (reduced from 50ms to avoid too frequent warmups)
    this._justWarmedUp = false; // Track if we just warmed up to bypass RAF on first frame
    this._warmupTimer = null; // Timer for continuous background warmup
    this._firstFrameOfInteraction = false; // Track first frame of any interaction
    this._interactionStartTime = 0; // Track when interaction started

    this._setupEvents();
    // Setup focus/visibility handlers to warm up when window regains focus
    this._setupFocusHandlers();
    // Start continuous background warmup to keep things ready
    this._startContinuousWarmup();
  }

  _setupEvents() {
    // Pan handling (canvas drag)
    this._setupPanEvents();

    // Zoom handling (Mouse Wheel)
    this._setupZoomEvents();

    // Zoom handling (Ctrl + Drag)
    this._setupDragZoomEvents();

    // Main interaction events
    this._setupMouseEvents();

    // Keyboard events
    this._setupKeyboardEvents();

    // Global click handling for menu closing
    this._setupGlobalEvents();
  }

  _setupFocusHandlers() {
    // Handle window focus - warm up when window regains focus
    window.addEventListener('focus', () => {
      // Mark as inactive to force warmup on next interaction
      this._lastInteractionTime = 0; // Force warmup
      // Immediately warm up to prepare for user interaction
      this._checkAndWarmupAfterInactivity();
      // Restart continuous warmup
      this._startContinuousWarmup();
    });

    // Handle page visibility - warm up when tab becomes visible
    if (typeof document.hidden !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          // Tab became visible - mark as inactive to force warmup
          this._lastInteractionTime = 0; // Force warmup
          // Immediately warm up to prepare for user interaction
          this._checkAndWarmupAfterInactivity();
          // Restart continuous warmup
          this._startContinuousWarmup();
        } else {
          // Tab hidden - stop continuous warmup to save resources
          this._stopContinuousWarmup();
        }
      });
    }
  }

  // Continuous background warmup to keep GPU/canvas ready
  _startContinuousWarmup() {
    this._stopContinuousWarmup(); // Clear any existing timer
    
    // Warm up VERY frequently when idle to keep things ready
    this._warmupTimer = setInterval(() => {
      const now = Date.now();
      const timeSinceLastInteraction = now - this._lastInteractionTime;
      
      // Only warm up if truly idle (no interaction for 500ms)
      // More aggressive warmup to prevent lag after short pauses
      if (timeSinceLastInteraction > 500) {
        // Do a lighter warmup in the background - more aggressive
        if (this.editor?.renderLoopController) {
          try {
            // Do 3 renders to keep GPU pipeline hot
            this.editor.renderLoopController.renderNow({ advance: false });
            this.editor.renderLoopController.renderNow({ advance: false });
            this.editor.renderLoopController.renderNow({ advance: false });
          } catch (error) {
            // Silently fail - this is background warmup
          }
        }
        
        if (this.editor && this.onDraw) {
          try {
            if (typeof this.editor.markDirty === 'function') {
              this.editor.markDirty('background-warmup');
            }
            // Do 3 draws to keep canvas context active
            this.onDraw();
            this.onDraw();
            this.onDraw();
          } catch (error) {
            // Silently fail - this is background warmup
          }
        }
        
        // Pre-warm expensive operations like getBoundingClientRect
        // This prevents lag when these are called during actual interaction
        if (this.canvas) {
          try {
            // Pre-warm getBoundingClientRect - this can be slow on first use
            this.canvas.getBoundingClientRect();
            // Pre-warm viewport calculations with multiple calls
            if (this.viewport) {
              this.viewport.screenToCanvas(0, 0);
              this.viewport.screenToCanvas(100, 100);
              this.viewport.screenToCanvas(500, 500);
            }
          } catch (error) {
            // Silently fail
          }
        }
      }
    }, 300); // Every 300ms - very frequent to keep things warm and prevent lag
  }

  _stopContinuousWarmup() {
    if (this._warmupTimer) {
      clearInterval(this._warmupTimer);
      this._warmupTimer = null;
    }
  }

  // Mark canvas dirty and request render (optimization for dirty flag system)
  _requestDraw(reason = 'user-interaction') {
    if (this.editor && typeof this.editor.markDirty === 'function') {
      this.editor.markDirty(reason);
    }
    this._requestRender();
  }

  // Throttled render using requestAnimationFrame for better performance
  _requestRender() {
    if (this._pendingFrame !== null) {
      return; // Frame already scheduled
    }

    this._pendingFrame = requestAnimationFrame(() => {
      this._pendingFrame = null;
      this.onDraw();
    });
  }

  // Check for inactivity and warm up GPU if needed
  // Call this at the START of any user interaction to prevent lag
  _checkAndWarmupAfterInactivity() {
    const now = Date.now();
    const timeSinceLastInteraction = now - this._lastInteractionTime;

    // If inactive for more than threshold, warm up GPU and canvas synchronously
    if (timeSinceLastInteraction > this._inactivityThreshold) {
      this._justWarmedUp = true; // Mark that we just warmed up
      // CRITICAL: Set interaction start time NOW so immediate updates work for first movement
      if (!this._interactionStartTime || timeSinceLastInteraction > 100) {
        this._interactionStartTime = now;
      }
      
      // ULTRA-AGGRESSIVE warmup: Many synchronous renders to fully wake up GPU pipeline
      // The longer the inactivity, the more aggressive the warmup needed
      // For 2+ seconds, do at least 10 renders to fully wake up the pipeline
      const warmupIntensity = Math.min(15, Math.floor(timeSinceLastInteraction / 500) + 8);
      
      if (this.editor?.renderLoopController) {
        try {
          // Many renders to fully warm up GPU pipeline - more if inactive longer
          // Do them synchronously to ensure they complete before first interaction
          for (let i = 0; i < warmupIntensity; i++) {
            this.editor.renderLoopController.renderNow({ advance: false });
          }
        } catch (error) {
          console.warn('[EventHandler] GPU warmup after inactivity failed:', error);
        }
      }
      
      // AGGRESSIVE canvas warmup: Force multiple draws to wake up 2D context
      if (this.editor) {
        try {
          // Pre-warm expensive DOM operations that might be slow on first use
          if (this.canvas) {
            // Pre-warm getBoundingClientRect - this can be slow on first use
            this.canvas.getBoundingClientRect();
            // Pre-warm viewport calculations
            if (this.viewport) {
              this.viewport.screenToCanvas(0, 0);
              this.viewport.screenToCanvas(100, 100);
            }
          }
          
          // Mark canvas as dirty to force draws
          if (typeof this.editor.markDirty === 'function') {
            this.editor.markDirty('warmup');
          }
          
          // Force many immediate draws to wake up canvas context
          // More draws if inactive longer - ULTRA AGGRESSIVE for node dragging
          const drawWarmupCount = Math.min(10, Math.floor(timeSinceLastInteraction / 500) + 5);
          if (this.onDraw && typeof this.onDraw === 'function') {
            // Many draws to ensure context is fully ready
            // Do them synchronously to ensure they complete before first interaction
            for (let i = 0; i < drawWarmupCount; i++) {
              this.onDraw();
            }
          }
          
          // Also directly touch the canvas context with actual operations
          if (this.editor.ctx && this.canvas) {
            const ctx = this.editor.ctx;
            // Do actual canvas operations to wake up the context
            ctx.save();
            // Touch common operations that might be slow on first use
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(1, 1);
            ctx.stroke();
            ctx.fillRect(0, 0, 1, 1);
            ctx.clearRect(0, 0, 1, 1);
            // Touch transform operations
            ctx.translate(0, 0);
            ctx.scale(1, 1);
            ctx.restore();
          }
        } catch (error) {
          console.warn('[EventHandler] Canvas warmup after inactivity failed:', error);
        }
      }
      
      // Keep the flag active longer to ensure first few interactions bypass RAF
      // Longer inactivity = longer immediate update window needed
      // For 2+ seconds of inactivity, keep immediate updates for at least 3 seconds
      // This ensures smooth dragging even after longer pauses
      const immediateWindow = Math.max(3000, Math.min(4000, timeSinceLastInteraction + 1500));
      setTimeout(() => {
        this._justWarmedUp = false;
      }, immediateWindow);
    }

    // Update last interaction time
    this._lastInteractionTime = now;
  }

  _setupPanEvents() {
    window.addEventListener(
      "mouseup",
      (e) => {
        this.viewport.stopPan();
        // Clear any pending pan updates
        this._pendingPanUpdate = null;
        this._panUpdateScheduled = false;

        if (this._panCandidate && e.button === 0) {
          if (!this._panCandidate.moved) {
            const currentSelection = this.selection?.graph?.selection;
            if (currentSelection && currentSelection.size > 0) {
              if (typeof this.selection?.clear === "function") {
                this.selection.clear();
              } else {
                currentSelection.clear();
                if (typeof this.onChange === "function") {
                  this.onChange();
                }
              }
              this._requestDraw('selection-clear');
            }
          }
          this._panCandidate = null;
        }
      },
      true,
    );

    window.addEventListener(
      "mousemove",
      (e) => {
        // Check if we're currently panning
        if (this.viewport.isPanning()) {
          // Store the pending pan update position
          this._pendingPanUpdate = { clientX: e.clientX, clientY: e.clientY };

          // Track movement for click vs drag detection
          if (this._panCandidate) {
            const dx = Math.abs(e.clientX - this._panCandidate.startClientX);
            const dy = Math.abs(e.clientY - this._panCandidate.startClientY);
            if (dx > 1 || dy > 1) {
              this._panCandidate.moved = true;
            }
          }

          // Only schedule one update per animation frame for performance
          // BUT: Always do immediate update for first 2 SECONDS of interaction to prevent lag
          // Longer inactivity = longer immediate update window needed
          const now = Date.now();
          // Ensure interaction start time is set (should be set by warmup, but ensure it's set)
          if (!this._interactionStartTime) {
            this._interactionStartTime = now;
          }
          const timeSinceStart = now - this._interactionStartTime;
          // For 2+ seconds of inactivity, use longer immediate window (3 seconds)
          const immediateWindow = this._justWarmedUp ? 3000 : Math.max(1000, Math.min(3000, 2000));
          const isFirstPeriod = !this._panUpdateScheduled || timeSinceStart < immediateWindow;
          
          if ((this._justWarmedUp || isFirstPeriod) && this._pendingPanUpdate) {
            // Immediate update - bypass RAF to prevent lag during first period
            // Do this synchronously to ensure it happens before any other processing
            
            const { clientX, clientY } = this._pendingPanUpdate;
            this._pendingPanUpdate = null;
            this._panUpdateScheduled = false;
            
            // Update pan state immediately
            if (this.viewport.updatePan(clientX, clientY)) {
              // Force immediate synchronous draw - don't use RAF
              if (this.editor && typeof this.editor.markDirty === 'function') {
                this.editor.markDirty('pan-immediate');
              }
              if (this.onDraw && typeof this.onDraw === 'function') {
                this.onDraw(); // Synchronous draw
              }
            }
          } else if (!this._panUpdateScheduled) {
            this._panUpdateScheduled = true;
            requestAnimationFrame(() => {
              this._panUpdateScheduled = false;
              if (this._pendingPanUpdate) {
                const { clientX, clientY } = this._pendingPanUpdate;
                if (this.viewport.updatePan(clientX, clientY)) {
                  this._requestDraw('pan');
                }
                this._pendingPanUpdate = null;
              }
            });
          }

          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }

  _setupZoomEvents() {
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        // Warm up GPU if user has been inactive for >10 seconds
        this._checkAndWarmupAfterInactivity();

        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.viewport.zoom(mx, my, e.deltaY)) {
          this._requestDraw('zoom');
          e.preventDefault();
        }
      },
      { passive: false },
    );
  }

  _setupDragZoomEvents() {
    const clearZoomDrag = () => {
      this._zoomDragState = null;
    };

    this.canvas.addEventListener(
      "mousedown",
      (e) => {
        if (
          e.button !== 0 ||
          e.shiftKey ||
          e.altKey ||
          !(e.ctrlKey || e.metaKey)
        ) {
          return;
        }

        const rect = this.canvas.getBoundingClientRect();
        this._zoomDragState = {
          anchorX: e.clientX - rect.left,
          anchorY: e.clientY - rect.top,
          lastY: e.clientY,
        };

        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );

    window.addEventListener(
      "mousemove",
      (e) => {
        if (!this._zoomDragState) return;

        if (!(e.ctrlKey || e.metaKey) || e.buttons === 0) {
          clearZoomDrag();
          return;
        }

        const deltaY = e.clientY - this._zoomDragState.lastY;
        if (deltaY !== 0) {
          const zoomDelta = deltaY * 5;
          if (
            this.viewport.zoom(
              this._zoomDragState.anchorX,
              this._zoomDragState.anchorY,
              zoomDelta,
            )
          ) {
            this._requestRender();
          }
          this._zoomDragState.lastY = e.clientY;
        }

        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );

    window.addEventListener("mouseup", clearZoomDrag, true);
    window.addEventListener("keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta" || e.key === "AltGraph") {
        clearZoomDrag();
      }
    });
    window.addEventListener("blur", clearZoomDrag);
  }

  _setupMouseEvents() {
    const showContextMenuAt = (canvasX, canvasY, clientX, clientY) => {
      const nodeHit = this._hitNode(canvasX, canvasY);
      if (nodeHit) {
        this.menu.showNodeMenu(nodeHit, clientX, clientY);
      } else {
        this.menu.showRadialMenu(canvasX, canvasY, clientX, clientY);
      }
    };

    const suppressDefaultContext = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        e.preventDefault();
      }
    };

    this.canvas.addEventListener("contextmenu", suppressDefaultContext, true);
    document.addEventListener("contextmenu", suppressDefaultContext, true);

    this.canvas.addEventListener("mousedown", (e) => {
      // Warm up GPU/canvas IMMEDIATELY on mousedown - don't wait for movement
      // This ensures everything is ready before the first mousemove event
      this._checkAndWarmupAfterInactivity();
      
      // Pre-warm getBoundingClientRect before calling _getCanvasPosition
      // This prevents lag on the first call after inactivity
      if (this.canvas) {
        this.canvas.getBoundingClientRect();
      }

      const pos = this._getCanvasPosition(e);

      if (this.checkPreviewControlClick(pos)) {
        return;
      }

      if (e.button === 2) {
        e.preventDefault();
        this.menu.hide();
        this._boxSelectCandidate = {
          startCanvas: { x: pos.x, y: pos.y },
          startClient: { x: e.clientX, y: e.clientY },
          started: false,
        };
        this._pendingContextMenu = {
          canvasX: pos.x,
          canvasY: pos.y,
          clientX: e.clientX,
          clientY: e.clientY,
        };
        return;
      }

      if (e.button !== 0) {
        return;
      }

      this.menu.hide();

      // Check for output pin drag (wire creation)
      const hitOut = this.connections.hitOutputPin(
        pos.x,
        pos.y,
        this.selection.graph.nodes,
      );
      if (hitOut) {
        this.connections.startWireDrag(hitOut.nodeId, hitOut.pin, pos, false);
        return;
      }

      // Check for input pin - can either start drag or remove connection
      const hitIn = this.connections.hitInputPin(
        pos.x,
        pos.y,
        this.selection.graph.nodes,
      );
      if (hitIn) {
        // Check if this input has an existing connection
        const existingConnection = this.selection.graph.connections.find(
          (c) => c.to.nodeId === hitIn.nodeId && c.to.pin === hitIn.pin
        );

        if (existingConnection) {
          // Has connection: remove it and start dragging from this input
          this.connections.removeConnection(hitIn.nodeId, hitIn.pin);
          this.connections.startWireDrag(hitIn.nodeId, hitIn.pin, pos, true);
          this._requestDraw('wire-drag');
        } else {
          // No connection: start dragging from this input
          this.connections.startWireDrag(hitIn.nodeId, hitIn.pin, pos, true);
        }
        return;
      }

      // Check for node click
      const clicked = this._hitNode(pos.x, pos.y);
      if (!clicked) {
        this._panCandidate = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          moved: false,
        };
        this.viewport.startPan(e.clientX, e.clientY);
        // Mark interaction start time for first-frame immediate updates
        this._interactionStartTime = Date.now();
        return;
      }

      // Handle double-click for parameter panel
      if (e.detail === 2) {
        this.paramPanelJustOpened = true;
        setTimeout(() => {
          this.paramPanelJustOpened = false;
        }, 100);

        if (this.paramPanel.showNodeParameters) {
          this.paramPanel.showNodeParameters(clicked);
        } else if (this.paramPanel.show) {
          this.paramPanel.show(clicked, e.clientX, e.clientY);
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Start node drag
      this.selection.startDrag(clicked.id, pos.x, pos.y);
      
      // CRITICAL: Set interaction start time NOW so immediate updates work for first drag movement
      // This ensures the first few drag updates bypass RAF and are synchronous
      const dragStartTime = Date.now();
      if (!this._interactionStartTime || (dragStartTime - this._lastInteractionTime) > 100) {
        this._interactionStartTime = dragStartTime;
      }
      
      // CRITICAL: Pre-warm snap calculations that happen during drag
      // This prevents lag on first drag update
      if (this.selection && typeof this.selection.applySnap === 'function') {
        // Pre-warm snap with a few test values
        this.selection.applySnap(pos.x, pos.y);
        this.selection.applySnap(pos.x + 10, pos.y + 10);
        this.selection.applySnap(pos.x + 20, pos.y + 20);
      }

      // Notify shader preview manager of drag start (for throttling)
      if (this.editor?.shaderPreviewManager) {
        this.editor.shaderPreviewManager.beginInteraction('drag');
      }

      this._requestDraw('node-drag-start');
    });

    // Click handler to prevent double-click from bubbling
    this.canvas.addEventListener("click", (e) => {
      if (this.paramPanelJustOpened) {
        e.stopPropagation();
        e.preventDefault();
      }
    });

    // Mouse move - handle dragging
    window.addEventListener("mousemove", (e) => {
      // Warm up GPU/canvas on ANY mousemove after any pause
      // This must happen BEFORE any other processing to prevent lag
      const now = Date.now();
      const timeSinceLastMove = now - this._lastMouseMoveTime;
      this._lastMouseMoveTime = now;
      
      // If there's been any pause at all, warm up proactively
      // Also pre-warm getBoundingClientRect which is called in _getCanvasPosition
      if (timeSinceLastMove > this._inactivityThreshold) {
        // Pre-warm getBoundingClientRect BEFORE warmup to prevent lag
        if (this.canvas) {
          this.canvas.getBoundingClientRect();
        }
        this._checkAndWarmupAfterInactivity();
      }

      if (this._zoomDragState) {
        return;
      }

      // PERFORMANCE: Skip ALL processing during parameter drag
      // This avoids expensive _getCanvasPosition calls (getBoundingClientRect + transforms)
      if (this.editor?._parameterDragging) {
        return;
      }

      if (
        this._boxSelectCandidate &&
        !this._boxSelectCandidate.started &&
        (e.buttons & 2) === 2
      ) {
        const dx =
          Math.abs(e.clientX - this._boxSelectCandidate.startClient.x);
        const dy =
          Math.abs(e.clientY - this._boxSelectCandidate.startClient.y);
        if (dx > 2 || dy > 2) {
          const { x, y } = this._boxSelectCandidate.startCanvas;
          this.selection.startBoxSelect(x, y);
          this._boxSelectCandidate.started = true;
          this._pendingContextMenu = null;
          this._requestDraw('box-select-start');
        }
      }

      // Check if we're in any drag state that needs throttling
      const isDraggingWire = this.connections.getDragWire();
      const isDraggingNodes = this.selection.getDragging();
      const isBoxSelecting = this.selection.getBoxSelect();

      if (isDraggingWire || isDraggingNodes || isBoxSelecting) {
        // Store the pending event for throttled processing
        this._pendingDragEvent = e;

        // Only schedule one update per animation frame for performance
        // BUT: Always do immediate update for first 2 SECONDS of interaction to prevent lag
        // Longer inactivity = longer immediate update window needed
        const now = Date.now();
        // Ensure interaction start time is set (should be set by warmup, but ensure it's set)
        if (!this._interactionStartTime) {
          this._interactionStartTime = now;
        }
        const timeSinceStart = now - this._interactionStartTime;
        // For 2+ seconds of inactivity, use longer immediate window (3 seconds)
        // ALWAYS use immediate updates for first 3 seconds after any warmup or interaction start
        const immediateWindow = this._justWarmedUp ? 3000 : Math.max(2000, Math.min(3000, 2500));
        const isFirstPeriod = !this._dragUpdateScheduled || timeSinceStart < immediateWindow;
        
        // CRITICAL: Always do immediate update if we just warmed up OR if it's the first period
        // This ensures no lag on first drag movement after inactivity
        if ((this._justWarmedUp || isFirstPeriod) && this._pendingDragEvent) {
          // Immediate update - bypass RAF to prevent lag during first period
          // Do this synchronously to ensure it happens before any other processing
          
          // Pre-warm getBoundingClientRect before first drag update to prevent lag
          if (this.canvas && this._justWarmedUp) {
            this.canvas.getBoundingClientRect();
            if (this.viewport) {
              this.viewport.screenToCanvas(0, 0);
            }
          }
          
          const pendingEvent = this._pendingDragEvent;
          this._pendingDragEvent = null;
          this._dragUpdateScheduled = false;

          // Calculate canvas position once per frame
          const pos = this._getCanvasPosition(pendingEvent);

          // Track cursor position for paste/duplicate operations
          this.lastCanvasPos = { x: pos.x, y: pos.y };

          // Handle wire dragging
          if (this.connections.getDragWire()) {
            this.connections.updateWireDrag(pos);
            // Force immediate synchronous draw - don't use RAF
            if (this.editor && typeof this.editor.markDirty === 'function') {
              this.editor.markDirty('wire-drag-immediate');
            }
            if (this.onDraw && typeof this.onDraw === 'function') {
              this.onDraw(); // Synchronous draw
            }
            return;
          }

          // Handle box selection
          if (this.selection.getBoxSelect()) {
            this.selection.updateBoxSelect(pos.x, pos.y);
            // Force immediate synchronous draw - don't use RAF
            if (this.editor && typeof this.editor.markDirty === 'function') {
              this.editor.markDirty('box-select-immediate');
            }
            if (this.onDraw && typeof this.onDraw === 'function') {
              this.onDraw(); // Synchronous draw
            }
            return;
          }

          // Handle node dragging
          if (this.selection.getDragging()) {
            // CRITICAL: Ensure interaction start time is set (should be set in mousedown, but ensure it)
            if (!this._interactionStartTime) {
              this._interactionStartTime = now;
            }
            
            this.selection.updateDrag(pos.x, pos.y);
            // Force immediate synchronous draw - don't use RAF
            if (this.editor && typeof this.editor.markDirty === 'function') {
              this.editor.markDirty('node-drag-immediate');
            }
            if (this.onDraw && typeof this.onDraw === 'function') {
              this.onDraw(); // Synchronous draw
            }
          }
        } else if (!this._dragUpdateScheduled) {
          this._dragUpdateScheduled = true;
          requestAnimationFrame(() => {
            this._dragUpdateScheduled = false;
            if (this._pendingDragEvent) {
              const pendingEvent = this._pendingDragEvent;
              this._pendingDragEvent = null;

              // Calculate canvas position once per frame
              const pos = this._getCanvasPosition(pendingEvent);

              // Track cursor position for paste/duplicate operations
              this.lastCanvasPos = { x: pos.x, y: pos.y };

              // Handle wire dragging
              if (this.connections.getDragWire()) {
                this.connections.updateWireDrag(pos);
                this._requestDraw('wire-drag-update');
                return;
              }

              // Handle box selection
              if (this.selection.getBoxSelect()) {
                this.selection.updateBoxSelect(pos.x, pos.y);
                this._requestDraw('box-select-update');
                return;
              }

              // Handle node dragging
              if (this.selection.getDragging()) {
                this.selection.updateDrag(pos.x, pos.y);
                this._requestDraw('node-drag-update');
              }
            }
          });
        }
      } else {
        // Not dragging anything - still need to track cursor for paste/duplicate
        const pos = this._getCanvasPosition(e);
        this.lastCanvasPos = { x: pos.x, y: pos.y };
      }
    });

    // Mouse up - end interactions
    window.addEventListener("mouseup", (e) => {
      this._zoomDragState = null;
      // Clear any pending drag updates
      this._pendingDragEvent = null;
      this._dragUpdateScheduled = false;
      // Reset interaction tracking
      this._interactionStartTime = 0;
      this._firstFrameOfInteraction = false;

      const pos = this._getCanvasPosition(e);

      // End wire drag - support bidirectional connections
      if (this.connections.getDragWire()) {
        const dragWire = this.connections.getDragWire();
        let target = null;

        if (dragWire.isFromInput) {
          // Dragging from input: look for output pin
          target = this.connections.hitOutputPin(
            pos.x,
            pos.y,
            this.selection.graph.nodes,
          );
        } else {
          // Dragging from output: look for input pin
          target = this.connections.hitInputPin(
            pos.x,
            pos.y,
            this.selection.graph.nodes,
          );
        }

        this.connections.endWireDrag(pos, target);
        this._requestDraw('wire-drag-end');
      }

      // End box selection
      if (this.selection.getBoxSelect()) {
        this.selection.endBoxSelect();
        this._requestDraw('box-select-end');
      } else if (
        this._boxSelectCandidate &&
        !this._boxSelectCandidate.started &&
        e.button === 2 &&
        this._pendingContextMenu
      ) {
        const ctx = this._pendingContextMenu;
        showContextMenuAt(ctx.canvasX, ctx.canvasY, ctx.clientX, ctx.clientY);
      }

      // End node dragging
      this.selection.endDrag();

      // Notify shader preview manager of drag end (for throttling)
      if (this.editor?.shaderPreviewManager) {
        this.editor.shaderPreviewManager.endInteraction('drag');
      }

      this._boxSelectCandidate = null;
      this._pendingContextMenu = null;
    });
  }

  _setupKeyboardEvents() {
    window.addEventListener("keydown", (e) => {
      // Warm up GPU if user has been inactive for >10 seconds
      this._checkAndWarmupAfterInactivity();

      if (e.key === "Escape") {
        this.menu.hide();
        this.paramPanel.hide();
      }

      // SIMPLIFIED: Use SelectionManager's undo-aware deleteSelected directly
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        document.activeElement === document.body
      ) {
        // SelectionManager now handles undo recording automatically
        this.selection.deleteSelected();
        this._requestDraw('delete-selected');
        e.preventDefault();
      }
    });
  }

  _setupGlobalEvents() {
    document.addEventListener("click", (e) => {
      // Don't close panel if it was just opened
      if (this.paramPanelJustOpened) {
        return;
      }

      if (this.menu && !this.menu.contains(e.target)) {
        this.menu.hide();
      }

      if (!this.paramPanel?.panel) {
        return;
      }

      if (this.paramPanel.panel.contains(e.target)) {
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && this.paramPanel.panel.contains(activeElement)) {
        return;
      }

      // Don't close parameter panel when clicking on timeline panel
      if (e.target.closest('.timeline-panel')) {
        return;
      }

      // Only close if the selected node is no longer in the selection
      // This prevents closing when clicking on menus or other UI elements
      if (this.paramPanel.selectedNode && this.paramPanel.graph?.selection?.has(this.paramPanel.selectedNode.id)) {
        return; // Node is still selected, keep panel open
      }

      this.paramPanel.hide();
    });
  }

  checkPreviewControlClick(pos) {
    if (!this.editor) return false;

    for (const node of this.editor.graph.nodes) {
      // Always show controls if preview system is available
      if (
        !this.editor.shouldShowPreview ||
        !this.editor.shouldShowPreview(node)
      )
        continue;

      const controlY = node.y + 50;
      const buttonHeight = 10;
      const buttonWidth = 12;

      // Button 1: Hide visual info (X)
      const hideX = node.x + node.w - 65;
      if (
        pos.x >= hideX - 1 &&
        pos.x <= hideX - 1 + buttonWidth &&
        pos.y >= controlY - 8 &&
        pos.y <= controlY - 8 + buttonHeight
      ) {
        this.editor.toggleNodeVisualInfo(node.id);
        this._requestDraw('toggle-visual-info');
        return true;
      }

      // Button 2: Preview toggle (• / ○) - MAIN BUTTON
      const eyeX = node.x + node.w - 45;
      if (
        pos.x >= eyeX - 1 &&
        pos.x <= eyeX - 1 + buttonWidth &&
        pos.y >= controlY - 8 &&
        pos.y <= controlY - 8 + buttonHeight
      ) {

        // This toggles the GLOBAL preview state
        this.editor.toggleNodePreview(node.id);
        this._requestDraw('toggle-preview');
        return true;
      }

      // Button 3: Size cycle (S/M/L) - only works when preview is enabled
      const sizeX = node.x + node.w - 25;
      if (
        pos.x >= sizeX - 1 &&
        pos.x <= sizeX - 1 + buttonWidth &&
        pos.y >= controlY - 8 &&
        pos.y <= controlY - 8 + buttonHeight
      ) {
        if (this.editor.isPreviewEnabled) {
          this.editor.cyclePreviewSize(node.id);
          this._requestDraw('cycle-preview-size');
        }
        return true; // Still consume click even if disabled
      }
    }

    return false;
  }

  // Helper methods
  _getCanvasPosition(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px =
      e.target === this.canvas && typeof e.offsetX === "number"
        ? e.offsetX
        : e.clientX - rect.left;
    const py =
      e.target === this.canvas && typeof e.offsetY === "number"
        ? e.offsetY
        : e.clientY - rect.top;

    return this.viewport.screenToCanvas(px, py);
  }

  _hitNode(x, y) {
    for (let i = this.selection.graph.nodes.length - 1; i >= 0; i--) {
      const n = this.selection.graph.nodes[i];
      if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) {
        return n;
      }
    }
    return null;
  }
}
