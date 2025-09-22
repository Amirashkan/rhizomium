// src/core/Editor.js - CORRECTED VERSION
import { EventHandler } from "./EventHandler.js";
import { Renderer } from "./Renderer.js";
import { MenuManager } from "../ui/MenuManager.js";
import { ParameterPanel } from "../ui/ParameterPanel.js";
import { SelectionManager } from "./SelectionManager.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { ViewportManager } from "./ViewportManager.js";
import { PreviewSystem } from "./PreviewSystem.js";

export class Editor {
  constructor(graph, onChange) {
    // Initialize preview state EARLY
    this.isPreviewEnabled = true;
    this.nodePreviews = new Map();

    // Set basic properties FIRST
    this.graph = graph;
    this.onChange = typeof onChange === "function" ? onChange : () => {};

    // Get canvas and context
    this.canvas = document.getElementById("ui-canvas");
    this.ctx = this.canvas.getContext("2d");

    // Initialize managers
    this.viewport = new ViewportManager();
    this.selection = new SelectionManager(this.graph, this.onChange);
    this.connections = new ConnectionManager(this.graph, this.onChange);
    this.renderer = new Renderer(this.ctx, this.viewport);
    this.menu = new MenuManager(this.graph, this.onChange);
    this.paramPanel = new ParameterPanel(this.graph, this.onChange);

    // Preview system settings
    this.previewSizes = { small: 32, medium: 64, large: 96 };

    // Initialize NEW preview system
    this.initializePreviewSystem();

    // Initialize event handling
    this.eventHandler = new EventHandler({
      canvas: this.canvas,
      viewport: this.viewport,
      selection: this.selection,
      connections: this.connections,
      menu: this.menu,
      paramPanel: this.paramPanel,
      onChange: this.onChange,
      onDraw: () => this.draw(),
      editor: this,
    });

    // Setup and initial render
    this.resize();
    window.addEventListener("resize", () => {
      this.resize();
      this.draw();
    });
  }

  // ---- Public API ----
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    this.renderer.render(this.graph, {
      selection: this.selection.getSelected(),
      dragWire: this.connections.getDragWire(),
      boxSelect: this.selection.getBoxSelect(),
      editor: this,
    });
  }

  // ---- NEW Preview System ----
initializePreviewSystem() {
  console.log("Initializing NEW Preview System");

  if (!this.graph || !this.graph.nodes) {
    console.error("No graph or nodes available");
    return;
  }

  // Initialize the NEW preview system using factory method
  this.previewSystem = PreviewSystem.create(this);
  this.previewIntegration = this.previewSystem.integration;
}

  // Node preview control methods
  toggleNodePreview(nodeId) {
    if (!this.nodePreviews.has(nodeId)) {
      this.nodePreviews.set(nodeId, {
        enabled: true,
        size: "small",
        showVisualInfo: true,
      });
    }

    const preview = this.nodePreviews.get(nodeId);
    preview.enabled = !preview.enabled;

    console.log(
      `Preview toggled for node ${nodeId}: ${preview.enabled ? "ON" : "OFF"}`,
    );

    if (preview.enabled) {
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.previewIntegration.generateNodePreview(node);
      }
    } else {
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) node.__thumb = null;
    }

    this.draw();
  }

  cyclePreviewSize(nodeId) {
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

    console.log(`Size changed to ${preview.size} for node ${nodeId}`);

    // Update preview with new size
    if (this.isPreviewEnabled && preview.enabled) {
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.previewIntegration.generateNodePreview(node);
      }
    }

    this.draw();
  }

  toggleNodeVisualInfo(nodeId) {
    if (!this.nodePreviews.has(nodeId)) {
      this.nodePreviews.set(nodeId, {
        enabled: true,
        size: "small",
        showVisualInfo: true,
      });
    }
    const preview = this.nodePreviews.get(nodeId);
    preview.showVisualInfo = !preview.showVisualInfo;
    this.draw();
  }

  // Helper methods
  shouldShowPreview(node) {
    return this.isPreviewEnabled || !!node.__thumb;
  }

  isPreviewEnabled(nodeId) {
    const preview = this.nodePreviews.get(nodeId);
    return preview ? preview.enabled : true;
  }

  isVisualInfoEnabled(nodeId) {
    const preview = this.nodePreviews.get(nodeId);
    return preview ? preview.showVisualInfo : true;
  }

  getPreviewSize(nodeId) {
    const preview = this.nodePreviews.get(nodeId);
    return this.previewSizes[preview?.size || "small"];
  }

  // ---- Selection API ----
  selectAll() {
    this.selection.selectAll();
  }

  moveSelection(dx, dy) {
    this.selection.moveSelected(dx, dy);
  }

  duplicateSelected() {
    this.selection.duplicateSelected();
  }

  // ---- Legacy compatibility methods ----

  copySelected() {}
  pasteAtCursor() {}
}
