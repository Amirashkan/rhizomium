// src/core/ApplicationBootstrap.js - Complete initialization system
import { initWebGPU } from "../gpu/gpuRenderer.js";
import { TextureManager } from "./TextureManager.js";
import { Editor } from "./Editor.js";
import { SaveLoadManager } from "./SaveLoadManager.js";
import { ParameterPanel } from "../ui/ParameterPanel.js";
import { SeedGraphBuilder } from "../utils/SeedGraphBuilder.js";
import { FloatingGPUPreview } from "../ui/FloatingGPUPreview.js";
import { BackupDialog } from "../ui/BackupDialog.js";
import { PreviewManager } from "../preview/PreviewManager.js";

export class ApplicationBootstrap {
  constructor(serviceLocator) {
    this.services = serviceLocator;
    this.initializationSteps = [];
    this.setupInitializationSteps();
  }

  setupInitializationSteps() {
    this.initializationSteps = [
      { name: "WebGPU", fn: this.initializeWebGPU.bind(this) },
      { name: "Texture Manager", fn: this.initializeTextureManager.bind(this) },
      { name: "Preview System", fn: this.initializePreviewSystem.bind(this) },
      { name: "UI Components", fn: this.initializeUIComponents.bind(this) },
      { name: "Editor", fn: this.initializeEditor.bind(this) },
      { name: "File System", fn: this.initializeFileSystem.bind(this) },
      { name: "Event Handlers", fn: this.initializeEventHandlers.bind(this) },
      { name: "Global Prevention", fn: this.setupGlobalPrevention.bind(this) },
    ];
  }

  async initialize() {
    for (const step of this.initializationSteps) {
      try {
        console.log(`Initializing ${step.name}...`);
        await step.fn();
        console.log(`✅ ${step.name} initialized`);
      } catch (error) {
        console.error(`❌ Failed to initialize ${step.name}:`, error);
        throw new Error(`Initialization failed at step: ${step.name}`);
      }
    }
  }

  async initializeWebGPU() {
    const canvas = document.getElementById("gpu-canvas");
    if (!canvas) {
      throw new Error("GPU canvas not found in DOM");
    }

    const device = await initWebGPU(canvas);
    if (!device) {
      throw new Error("Failed to initialize WebGPU device");
    }

    const appState = this.services.get("appState");
    appState.setWebGPUReady(device);

    // Register GPU-related services
    this.services.registerInstance("gpuDevice", device);
    this.services.registerInstance("gpuCanvas", canvas);
  }

  async initializeTextureManager() {
    const device = this.services.get("gpuDevice");
    const textureManager = new TextureManager();
    await textureManager.initialize(device);

    this.services.registerInstance("textureManager", textureManager);

    // Update app state
    const appState = this.services.get("appState");
    appState.webgpu.textureManager = textureManager;

    // Make available globally for compatibility
    window.textureManager = textureManager;
  }

  async initializePreviewSystem() {
    const previewManager = new PreviewManager();
    this.services.registerInstance("previewManager", previewManager);
  }

  async initializeUIComponents() {
    // Status Manager
    const statusManager = new StatusManager();
    this.services.registerInstance("statusManager", statusManager);

    // FPS Counter
    const fpsCounter = new FPSCounter();
    this.services.registerInstance("fpsCounter", fpsCounter);

    // Code Display
    const codeDisplay = new CodeDisplay("code");
    this.services.registerInstance("codeDisplay", codeDisplay);

    // Floating Preview
    const canvas = this.services.get("gpuCanvas");
    const floatingPreview = new FloatingGPUPreview(canvas);
    this.services.registerInstance("floatingPreview", floatingPreview);

    // Show floating preview
    floatingPreview.show();
    this.setupPreviewButtons(floatingPreview);
  }

  async initializeEditor() {
    const appState = this.services.get("appState");
    const previewManager = this.services.get("previewManager");

    const editor = new Editor(appState.graph, () => {
      // Shader rebuild callback
      const app = window.app;
      if (app) {
        app.rebuildShader();
      }
    });

    // Integrate preview system
    editor.previewIntegration = previewManager;

    this.services.registerInstance("editor", editor);

    // Make available globally for compatibility
    window.editor = editor;
  }

  async initializeFileSystem() {
    const appState = this.services.get("appState");
    const editor = this.services.get("editor");

    // Save/Load Manager
    const saveLoadManager = new SaveLoadManager(editor, appState.graph, () =>
      window.app?.rebuildShader(),
    );
    this.services.registerInstance("saveLoadManager", saveLoadManager);

    // Parameter Panel
    const parameterPanel = new ParameterPanel(appState.graph, () =>
      window.app?.rebuildShader(),
    );
    this.services.registerInstance("parameterPanel", parameterPanel);

    // Seed Graph Builder
    const seedGraphBuilder = new SeedGraphBuilder();
    this.services.registerInstance("seedGraphBuilder", seedGraphBuilder);

    // Keyboard Handler
    const keyboardHandler = new KeyboardHandler();
    this.services.registerInstance("keyboardHandler", keyboardHandler);

    // Undo Manager
    const undoManager = new UndoManager(appState);
    this.services.registerInstance("undoManager", undoManager);

    // Backup Dialog
    const backupDialog = new BackupDialog(saveLoadManager);
    this.services.registerInstance("backupDialog", backupDialog);

    // Make available globally for compatibility
    window.saveLoadManager = saveLoadManager;
    window.backupDialog = backupDialog;
  }

  async initializeEventHandlers() {
    this.setupUIEventHandlers();
    this.setupFileInputHandlers();
  }

  setupUIEventHandlers() {
    const saveLoadManager = this.services.get("saveLoadManager");
    const backupDialog = this.services.get("backupDialog");

    // Prevent double handlers by removing existing listeners
    const removeExistingHandlers = (elementId) => {
      const el = document.getElementById(elementId);
      if (el) {
        const newEl = el.cloneNode(true);
        el.parentNode.replaceChild(newEl, el);
        return newEl;
      }
      return null;
    };

    // Save Project button
    const saveBtn = removeExistingHandlers("btn-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.app?.saveProject();
      });
    }

    // Load Project button
    const loadBtn = removeExistingHandlers("btn-load");
    if (loadBtn) {
      loadBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.triggerFileLoad();
      });
    }

    // Export buttons
    const exportJsonBtn = removeExistingHandlers("btn-export-json");
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener("click", (e) => {
        e.preventDefault();
        saveLoadManager.saveToFile(null, "json");
      });
    }

    const exportWgslBtn = removeExistingHandlers("btn-export-wgsl");
    if (exportWgslBtn) {
      exportWgslBtn.addEventListener("click", (e) => {
        e.preventDefault();
        saveLoadManager.saveToFile(null, "wgsl");
      });
    }

    // Backups button
    const backupsBtn = removeExistingHandlers("btn-backups");
    if (backupsBtn) {
      backupsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        backupDialog.show();
      });
    }

    // Rebuild button
    const rebuildBtn = removeExistingHandlers("btn-rebuild");
    if (rebuildBtn) {
      rebuildBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.app?.rebuildShader();
      });
    }
  }

  setupFileInputHandlers() {
    const saveLoadManager = this.services.get("saveLoadManager");

    const fileInput = document.getElementById("file-import");
    if (fileInput) {
      // Remove existing handlers
      const newFileInput = fileInput.cloneNode(true);
      fileInput.parentNode.replaceChild(newFileInput, fileInput);

      newFileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (file) {
          try {
            await saveLoadManager.loadFromFile(file);
            await this.reinitializeWebGPUAfterLoad();
          } catch (error) {
            console.error("File load failed:", error);
          }
          e.target.value = "";
        }
      });
    }
  }

  triggerFileLoad() {
    const fileInput = document.getElementById("file-import");
    if (fileInput) {
      fileInput.value = "";
      setTimeout(() => fileInput.click(), 10);
    }
  }

  async reinitializeWebGPUAfterLoad() {
    console.log("Reinitializing WebGPU after file load...");

    try {
      const canvas = this.services.get("gpuCanvas");
      if (!canvas) {
        throw new Error("No GPU canvas found");
      }

      // Force WebGPU reinitialization
      const device = await initWebGPU(canvas);
      if (device) {
        const appState = this.services.get("appState");
        appState.setWebGPUReady(device);

        // Reinitialize texture manager
        const textureManager = this.services.get("textureManager");
        if (textureManager) {
          await textureManager.initialize(device);
        }

        console.log("WebGPU reinitialized successfully");
        return true;
      }

      throw new Error("Failed to reinitialize WebGPU");
    } catch (error) {
      console.error("WebGPU reinitialization failed:", error);
      return false;
    }
  }

  setupPreviewButtons(floatingPreview) {
    const toggleBtn = document.getElementById("btn-toggle-preview");
    const dockBtn = document.getElementById("btn-dock-preview");
    const lockBtn = document.getElementById("btn-lock-preview");
    const fullscreenBtn = document.getElementById("btn-fullscreen-preview");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => floatingPreview.toggle());
    }

    if (dockBtn) {
      dockBtn.addEventListener("click", () => {
        floatingPreview.toggleDocked();
        dockBtn.textContent = floatingPreview.isDocked
          ? "Float Preview"
          : "Dock Preview";
      });
    }

    if (lockBtn) {
      lockBtn.addEventListener("click", () => floatingPreview.toggleLock());
    }

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", () =>
        floatingPreview.toggleFullscreen(),
      );
    }
  }

  setupGlobalPrevention() {
    // Prevent default browser drag behavior globally
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.addEventListener(eventName, this.preventDefaults, false);
    });

    // Only allow drops on designated drop zones
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const dropZone = e.target.closest(".file-drop-zone");
      if (!dropZone) {
        console.log("Drop ignored - not on a valid drop zone");
        return false;
      }
    });
  }

  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// UI Management Classes
export class StatusManager {
  constructor() {
    this.statusElement = document.getElementById("status");
    this.currentStatus = null;
    this.statusTimeout = null;
  }

  updateStatus(message, type = "info", duration = 3000) {
    if (!this.statusElement) return;

    this.statusElement.textContent = message;
    this.statusElement.className = type;
    this.currentStatus = { message, type, timestamp: Date.now() };

    // Clear previous timeout
    if (this.statusTimeout) {
      clearTimeout(this.statusTimeout);
    }

    // Auto-clear for non-error messages
    if (type !== "error" && duration > 0) {
      this.statusTimeout = setTimeout(() => {
        if (this.statusElement.textContent === message) {
          this.statusElement.textContent = "Ready";
          this.statusElement.className = "";
          this.currentStatus = null;
        }
      }, duration);
    }

    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  clearStatus() {
    if (this.statusElement) {
      this.statusElement.textContent = "Ready";
      this.statusElement.className = "";
    }
    this.currentStatus = null;

    if (this.statusTimeout) {
      clearTimeout(this.statusTimeout);
      this.statusTimeout = null;
    }
  }

  getCurrentStatus() {
    return this.currentStatus;
  }
}

export class CodeDisplay {
  constructor(elementId) {
    this.element = document.getElementById(elementId);
    this.currentCode = "";
  }

  update(code) {
    if (!this.element) return;

    this.currentCode = code;
    this.element.textContent = code;

    // Add syntax highlighting if available
    if (window.hljs) {
      window.hljs.highlightElement(this.element);
    }
  }

  getCurrentCode() {
    return this.currentCode;
  }

  clear() {
    if (this.element) {
      this.element.textContent = "";
    }
    this.currentCode = "";
  }
}

export class FPSCounter {
  constructor() {
    this.frames = 0;
    this.lastTime = Date.now();
    this.fps = 0;
    this.element = document.getElementById("fps-counter");
  }

  update() {
    this.frames++;
    const now = Date.now();

    if (now - this.lastTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
      this.frames = 0;
      this.lastTime = now;

      if (this.element) {
        this.element.textContent = `${this.fps} FPS`;
      }
    }
  }

  getFPS() {
    return this.fps;
  }
}

export class KeyboardHandler {
  constructor() {
    this.shortcuts = new Map();
    this.setupGlobalListener();
  }

  setupGlobalListener() {
    window.addEventListener("keydown", (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.isContentEditable
      ) {
        return;
      }

      const key = this.getKeyString(e);
      const handler = this.shortcuts.get(key);

      if (handler) {
        e.preventDefault();
        try {
          handler(e);
        } catch (error) {
          console.error(
            `Error in keyboard shortcut handler for ${key}:`,
            error,
          );
        }
      }
    });
  }

  register(keyString, handler) {
    this.shortcuts.set(keyString.toLowerCase(), handler);
  }

  unregister(keyString) {
    this.shortcuts.delete(keyString.toLowerCase());
  }

  getKeyString(event) {
    const parts = [];

    if (event.ctrlKey || event.metaKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");

    parts.push(event.key.toLowerCase());

    return parts.join("+");
  }

  getRegisteredShortcuts() {
    return Array.from(this.shortcuts.keys());
  }
}

export class UndoManager {
  constructor(appState) {
    this.appState = appState;
    this.undoStack = [];
    this.redoStack = [];
    this.maxStackSize = 50;

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.appState.on("graph-changed", (event) => {
      this.recordChange(event);
    });
  }

  recordChange(event) {
    // Record the current state before the change
    const snapshot = {
      type: event.type,
      timestamp: Date.now(),
      beforeState: this.createSnapshot(),
      afterState: null, // Will be set when the next change occurs
    };

    // Set the afterState of the previous change
    if (this.undoStack.length > 0) {
      this.undoStack[this.undoStack.length - 1].afterState =
        snapshot.beforeState;
    }

    this.undoStack.push(snapshot);

    // Limit stack size
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }

    // Clear redo stack on new change
    this.redoStack = [];
  }

  createSnapshot() {
    return {
      nodes: JSON.parse(JSON.stringify(this.appState.graph.nodes)),
      connections: JSON.parse(JSON.stringify(this.appState.graph.connections)),
      selection: new Set(this.appState.selection),
      viewport: { ...this.appState.viewport },
    };
  }

  restoreSnapshot(snapshot) {
    this.appState.graph.nodes = JSON.parse(JSON.stringify(snapshot.nodes));
    this.appState.graph.connections = JSON.parse(
      JSON.stringify(snapshot.connections),
    );
    this.appState.selection = new Set(snapshot.selection);
    this.appState.viewport = { ...snapshot.viewport };

    this.appState.emit("graph-loaded", { graph: this.appState.graph });
  }

  undo() {
    if (!this.canUndo()) return false;

    const change = this.undoStack.pop();
    this.redoStack.push(change);

    if (change.beforeState) {
      this.restoreSnapshot(change.beforeState);
    }

    return true;
  }

  redo() {
    if (!this.canRedo()) return false;

    const change = this.redoStack.pop();
    this.undoStack.push(change);

    if (change.afterState) {
      this.restoreSnapshot(change.afterState);
    }

    return true;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
