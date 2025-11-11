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

    this._setupEvents();
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

  _setupPanEvents() {
    window.addEventListener(
      "mouseup",
      (e) => {
        this.viewport.stopPan();
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
        if (this.viewport.updatePan(e.clientX, e.clientY)) {
          if (this._panCandidate) {
            const dx = Math.abs(e.clientX - this._panCandidate.startClientX);
            const dy = Math.abs(e.clientY - this._panCandidate.startClientY);
            if (dx > 1 || dy > 1) {
              this._panCandidate.moved = true;
            }
          }
          this._requestDraw('pan');
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

      const pos = this._getCanvasPosition(e);

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
    });

    // Mouse up - end interactions 
    window.addEventListener("mouseup", (e) => {
      this._zoomDragState = null;
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
