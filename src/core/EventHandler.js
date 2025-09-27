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

    this._setupEvents();
  }

  _setupEvents() {
    // Pan handling (Alt + Left Mouse)
    this._setupPanEvents();

    // Zoom handling (Mouse Wheel)
    this._setupZoomEvents();

    // Main interaction events
    this._setupMouseEvents();

    // Keyboard events
    this._setupKeyboardEvents();

    // Global click handling for menu closing
    this._setupGlobalEvents();
  }

  _setupPanEvents() {
    this.canvas.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 0 && e.altKey) {
          this.viewport.startPan(e.clientX, e.clientY);
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );

    window.addEventListener(
      "mouseup",
      () => {
        this.viewport.stopPan();
      },
      true,
    );

    window.addEventListener(
      "mousemove",
      (e) => {
        if (this.viewport.updatePan(e.clientX, e.clientY)) {
          this.onDraw();
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
          this.onDraw();
          e.preventDefault();
        }
      },
      { passive: false },
    );
  }

  _setupMouseEvents() {
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.viewport.isPanning()) {
        e.preventDefault();
        return;
      }

      if (e.button === 2) return; // Let context menu handle right-click

      this.menu.hide();
      const pos = this._getCanvasPosition(e);

      if (this.checkPreviewControlClick(pos)) {
        return;
      }
      
      // Check for output pin drag (wire creation)
      const hitOut = this.connections.hitOutputPin(
        pos.x,
        pos.y,
        this.selection.graph.nodes,
      );
      if (hitOut) {
        this.connections.startWireDrag(hitOut.nodeId, hitOut.pin, pos);
        return;
      }

      // Check for input pin click (connection removal) - MINIMAL CHANGE
      const hitIn = this.connections.hitInputPin(
        pos.x,
        pos.y,
        this.selection.graph.nodes,
      );
      if (hitIn) {
        this.connections.removeConnection(hitIn.nodeId, hitIn.pin);
        this.onDraw();
        return;
      }

      // Check for node click
      const clicked = this._hitNode(pos.x, pos.y);
      if (!clicked) {
        // Start box selection
        this.selection.startBoxSelect(pos.x, pos.y);
        this.onDraw();
        return;
      }

      // Handle double-click for parameter panel
      if (e.detail === 2) {
        // Set flag to prevent immediate closure
        this.paramPanelJustOpened = true;

        // Clear the flag after a short delay
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
      this.onDraw();
    });

    // Click handler to prevent double-click from bubbling
    this.canvas.addEventListener("click", (e) => {
      if (this.paramPanelJustOpened) {
        e.stopPropagation();
        e.preventDefault();
      }
    });

    // Context menu - RESTORED ORIGINAL
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const pos = this._getCanvasPosition(e);
      const nodeHit = this._hitNode(pos.x, pos.y);

      if (nodeHit) {
        this.menu.showNodeMenu(nodeHit, e.clientX, e.clientY);
      } else {
        this.menu.showRadialMenu(pos.x, pos.y, e.clientX, e.clientY);
      }
    });

    // Mouse move - handle dragging
    window.addEventListener("mousemove", (e) => {
      const pos = this._getCanvasPosition(e);

      // Handle wire dragging
      if (this.connections.getDragWire()) {
        this.connections.updateWireDrag(pos);
        this.onDraw();
        return;
      }

      // Handle box selection
      if (this.selection.getBoxSelect()) {
        this.selection.updateBoxSelect(pos.x, pos.y);
        this.onDraw();
        return;
      }

      // Handle node dragging
      if (this.selection.getDragging()) {
        this.selection.updateDrag(pos.x, pos.y);
        this.onDraw();
      }
    });

    // Mouse up - end interactions 
    window.addEventListener("mouseup", (e) => {
      const pos = this._getCanvasPosition(e);

      // End wire drag - PRESERVE ORIGINAL LOGIC
      if (this.connections.getDragWire()) {
        const target = this.connections.hitInputPin(
          pos.x,
          pos.y,
          this.selection.graph.nodes,
        );
        
        // Use original connection system but add undo recording
        this.connections.endWireDrag(pos, target);
        this.onDraw();
      }

      // End box selection
      if (this.selection.getBoxSelect()) {
        this.selection.endBoxSelect();
        this.onDraw();
      }

      // End node dragging
      this.selection.endDrag();
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
        this.onDraw();
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

      if (!this.menu.contains(e.target)) {
        this.menu.hide();
      }

      // FIXED: Use this.paramPanel.panel.contains instead of this.paramPanel.contains
      if (this.paramPanel.panel && !this.paramPanel.panel.contains(e.target)) {
        this.paramPanel.hide();
      }
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
        this.onDraw();
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
        console.log(`Clicked preview toggle button for node ${node.id}`);

        // This toggles the GLOBAL preview state
        this.editor.toggleNodePreview(node.id);
        this.onDraw();
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
          this.onDraw();
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