// main.js - Complete version with Undo System and Event System
import { GPURenderer } from "./src/gpu/gpuRenderer.js";
import { RenderLoop } from "./src/core/RenderLoop.js";
import { buildWGSL } from "./src/codegen/glslBuilder.js";
import { Editor } from "./src/core/Editor.js";
import { SaveLoadManager } from "./src/core/SaveLoadManager.js";
import { BackupDialog } from "./src/ui/BackupDialog.js";
import { Graph } from "./src/data/Graph.js";
import { makeNode, NodeDefs } from "./src/data/NodeDefs.js";
import { SeedGraphBuilder } from "./src/utils/SeedGraphBuilder.js";
import { FloatingGPUPreview } from "./src/ui/FloatingGPUPreview.js";
import { TextureManager } from "./src/core/TextureManager.js";
import { UndoManager } from "./src/core/UndoManager.js";
import { ParameterEventSystem } from "./src/utils/ParameterEventSystem.js";
import { ErrorHandler } from './src/core/ErrorHandler.js';

window.makeNode = makeNode;
window.NodeDefs = NodeDefs;

// Prevent default browser drag behavior globally
function setupGlobalDragPrevention() {
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    document.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const dropZone = e.target.closest(".file-drop-zone");
    if (!dropZone) {
      console.log("Drop ignored - not on a valid drop zone");
      return false;
    }
  });

  console.log("Global drag prevention setup complete");
}

async function reinitializeWebGPUAfterLoad() {
  console.log("Reinitializing WebGPU after file load...");

  const allCanvases = document.querySelectorAll("#gpu-canvas");
  console.log(`Found ${allCanvases.length} canvas elements with gpu-canvas id`);

  if (allCanvases.length > 1) {
    console.log("Multiple canvases detected, cleaning up...");
    for (let i = 1; i < allCanvases.length; i++) {
      allCanvases[i].remove();
      console.log(`Removed duplicate canvas ${i}`);
    }
  }

  const canvas = document.getElementById("gpu-canvas");
  
const dpr = window.devicePixelRatio || 1;
canvas.width  = Math.max(1, Math.floor((canvas.clientWidth || window.innerWidth)  * dpr));
canvas.height = Math.max(1, Math.floor((canvas.clientHeight || window.innerHeight) * dpr));
  canvas.width  = canvas.clientWidth  || window.innerWidth;
canvas.height = canvas.clientHeight || window.innerHeight;if (!canvas) {
    console.error("No GPU canvas found after cleanup");
    return false;
  }

  try {
    console.log("Reinitializing WebGPU...");
    __deviceReady = false;
    
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
window.gpuRenderer = new GPURenderer(device, canvas);
    
    if (device) {
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);
      console.log("TextureManager initialized successfully");
      __deviceReady = true;
    }

    if (device) {
      console.log("WebGPU reinitialized successfully");
      console.log("Testing shader update...");
      await updateShaderFromGraph();
      return true;
    } else {
      console.error("Failed to reinitialize WebGPU");
      return false;
    }
  } catch (error) {
    console.error("Error reinitializing WebGPU:", error);
    return false;
  }
}

if (window.__mainLoaded) throw new Error("main.js loaded twice");
window.__mainLoaded = true;

window.__disableRhizomiumLoader = true;

let graph = new Graph();
let editor = null;
let saveLoadManager = null;
let backupDialog = null;
let undoManager = null;
let parameterEventSystem = null;
let __deviceReady = false;
let floatingPreview = null;
let renderLoopController = null;

if (typeof window.render !== "function") {
  window.render = () => {};
}

async function initialize() {
  const errorHandler = new ErrorHandler();
  window.errorHandler = errorHandler;

  const canvas =
    document.getElementById("gpu-canvas") || document.querySelector("canvas");
  if (canvas) {
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
window.gpuRenderer = new GPURenderer(device, canvas);

    if (device) {
      const { TextureManager } = await import("./src/core/TextureManager.js");
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);
      console.log("TextureManager initialized successfully");
    }

    __deviceReady = !!device;
  }

  setupGlobalDragPrevention();

  try {
    if (typeof window.mountPill === "undefined") {
      window.mountPill = () => {
        console.log("RhizomiumLoader mountPill disabled");
      };
    }

    const existingPill = document.getElementById("rz-fallback-pill");
    if (existingPill) {
      existingPill.remove();
      console.log("Removed existing RhizomiumLoader pill");
    }

    // Create and populate graph FIRST
    SeedGraphBuilder.createSeedGraph(graph);

    // Create event system AFTER graph is populated
    parameterEventSystem = new ParameterEventSystem();
    window.parameterEventSystem = parameterEventSystem;
    console.log("ParameterEventSystem created:", parameterEventSystem);

    // Create undo manager with event system
    undoManager = new UndoManager(graph, null, parameterEventSystem);
    console.log("UndoManager created:", undoManager);
    window.undoManager = undoManager;

    // Create editor and pass the undo manager to it
    editor = new Editor(graph, updateShaderFromGraph, undoManager);
    
    // Now set the editor reference in undo manager
    if (typeof undoManager.setEditor === "function") {
      undoManager.setEditor(editor);
    } else {
      undoManager.editor = editor;
      undoManager.onChange = editor?.onChange;
    }

    console.log("Creating SaveLoadManager...");
    saveLoadManager = new SaveLoadManager(editor, graph, updateShaderFromGraph);
    saveLoadManager.setTextureManager(window.textureManager);
    console.log("SaveLoadManager created:", saveLoadManager);

    console.log("Creating BackupDialog...");
    backupDialog = new BackupDialog(saveLoadManager);
    console.log("BackupDialog created:", backupDialog);

    const gpuCanvas = document.getElementById("gpu-canvas");
    if (gpuCanvas) {
      floatingPreview = new FloatingGPUPreview(gpuCanvas);
      setupPreviewButtons();
      floatingPreview.show();
    }

    setupUIEventHandlers();
    setupKeyboardShortcuts();

    window.graph = graph;
    window.editor = editor;
    window.saveLoadManager = saveLoadManager;
    window.backupDialog = backupDialog;
    window.rebuild = updateShaderFromGraph;
    window.buildWGSL = buildWGSL;
    window.floatingPreview = floatingPreview;

    initializeRenderLoopFromSettings();

    await checkAutosaveRecovery();
    await updateShaderFromGraph();

    setInterval(() => {
      const pill = document.getElementById("rz-fallback-pill");
      if (pill && pill.style.display !== "none") {
        pill.remove();
        console.log("Removed late RhizomiumLoader interference");
      }
    }, 2000);

    console.log("GLSL Node Editor initialized successfully");
  } catch (error) {
    errorHandler.handleError(error, { component: 'initialization' });
  }
}

// Undo callback functions
function onConnectionDeleted(connection) {
  console.log("Connection deleted callback:", connection);
  if (undoManager && connection) {
    const connectionData = {
      sourceNode: connection.sourceNode || connection.from,
      targetNode: connection.targetNode || connection.to,
      targetInput: connection.targetInput || connection.inputIndex || 0
    };
    
    undoManager.recordConnectionDeletion(connectionData);
  } else {
    console.warn("UndoManager not available or connection invalid:", { undoManager: !!undoManager, connection });
  }
}

function onNodesMovement(movementData) {
  console.log("Nodes movement callback:", movementData);
  if (undoManager && movementData) {
    undoManager.recordNodeMovement(movementData);
  } else {
    console.warn("UndoManager not available or movement data invalid:", { undoManager: !!undoManager, movementData });
  }
}

function onNodeDeleted(node) {
  console.log("Node deleted callback:", node);
  if (undoManager && node) {
    undoManager.recordNodeDeletion(node);
  } else {
    console.warn("UndoManager not available or node invalid:", { undoManager: !!undoManager, node });
  }
}

function onConnectionCreated(sourceNodeId, targetNodeId, targetInput, sourceOutput = 0) {
  console.log("Connection created callback:", { sourceNodeId, targetNodeId, targetInput });
  if (undoManager) {
    undoManager.recordConnectionCreation(sourceNodeId, targetNodeId, targetInput, sourceOutput);
  }
}

function onNodeCreated(node) {
  console.log("Node created callback:", node);
  if (undoManager && node) {
    undoManager.recordNodeCreation(node);
  }
}

function onGroupDeleted(nodesToDelete) {
  console.log("Group deleted callback:", nodesToDelete);
  if (undoManager && nodesToDelete && nodesToDelete.length > 0) {
    undoManager.recordGroupDeletion(nodesToDelete);
  } else {
    console.warn("UndoManager not available or nodes invalid:", { undoManager: !!undoManager, nodeCount: nodesToDelete?.length });
  }
}

// Expose these functions globally so Editor can call them
window.onGroupDeleted = onGroupDeleted;
window.onConnectionDeleted = onConnectionDeleted;
window.onNodeDeleted = onNodeDeleted;
window.onConnectionCreated = onConnectionCreated;
window.onNodeCreated = onNodeCreated;
window.onNodesMovement = onNodesMovement;

function setupUIEventHandlers() {
  console.log("Setting up UI event handlers...");

  if (!saveLoadManager) {
    console.error("SaveLoadManager not available!");
    return;
  }

  // Prevent double handlers: Remove existing listeners first
  const removeExistingHandlers = (elementId) => {
    const el = document.getElementById(elementId);
    if (el) {
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      return newEl;
    }
    return null;
  };

  // Undo/Redo button handlers
  console.log("Setting up undo/redo button handlers...");

  const undoBtn = removeExistingHandlers("btn-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("UNDO BUTTON CLICKED");
      if (undoManager) {
        const success = undoManager.undo();
        console.log("Undo result:", success);
      } else {
        console.error("UndoManager not available");
      }
    });
    console.log("Undo button handler attached");
  } else {
    console.error("Undo button not found in DOM");
  }

  const redoBtn = removeExistingHandlers("btn-redo");
  if (redoBtn) {
    redoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("REDO BUTTON CLICKED");
      if (undoManager) {
        const success = undoManager.redo();
        console.log("Redo result:", success);
      } else {
        console.error("UndoManager not available");
      }
    });
    console.log("Redo button handler attached");
  } else {
    console.error("Redo button not found in DOM");
  }

  // Save Project button
  const saveBtn = removeExistingHandlers("btn-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("SAVE BUTTON CLICKED");
      saveLoadManager.saveToFile();
    });
    console.log("Save button handler attached");
  }

  // Load Project button
  const loadBtn = removeExistingHandlers("btn-load");
  if (loadBtn) {
    loadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("LOAD BUTTON CLICKED");
      triggerFileLoad();
    });
    console.log("Load button handler attached");
  }

  // File input change handler
  const fileInput = removeExistingHandlers("file-import");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        console.log("FILE SELECTED", file.name);

        try {
          await saveLoadManager.loadFromFile(file);


          // Clear undo history when loading a new project
          if (undoManager) {
            undoManager.clear();
            console.log("Undo history cleared after load");
          }

          console.log("FORCING NODE RECALCULATION");
          if (graph && graph.nodes) {
            graph.nodes.forEach((node) => {
              delete node.cachedValue;
              delete node.cached;
              node.needsUpdate = true;
            });

            console.log("TRIGGERING PREVIEW REFRESH");
            const nodeWithConnection = graph.nodes.find(
              (node) =>
                node.inputs && node.inputs.some((input) => input !== null),
            );

            if (nodeWithConnection) {
              const inputIndex = nodeWithConnection.inputs.findIndex(
                (input) => input !== null,
              );
              const originalInput = nodeWithConnection.inputs[inputIndex];

              nodeWithConnection.inputs[inputIndex] = null;

              setTimeout(() => {
                nodeWithConnection.inputs[inputIndex] = originalInput;
                if (editor.draw) {
                  editor.draw();
                }
              }, 10);
            }

            console.log("REFRESHING NODE PREVIEWS");
            if (editor && editor.nodePreviews) {
              graph.nodes.forEach((node) => {
                if (editor.nodePreviews.has(node.id)) {
                  const preview = editor.nodePreviews.get(node.id);
                  editor.nodePreviews.delete(node.id);
                  editor.nodePreviews.set(node.id, {
                    enabled: preview.enabled,
                    size: preview.size || "small",
                    showVisualInfo: preview.showVisualInfo !== false,
                    needsUpdate: true,
                  });
                } else {
                  editor.nodePreviews.set(node.id, {
                    enabled: true,
                    size: "small",
                    showVisualInfo: true,
                    needsUpdate: true,
                  });
                }
              });

              setTimeout(() => {
                if (editor.draw) {
                  editor.draw();
                }
              }, 100);
            }

            console.log("AUTO-REFRESHING NODE PREVIEWS");
            graph.nodes.forEach((node) => {
              if (node.inputs) {
                node.inputs.forEach((input, index) => {
                  if (input) {
                    const originalInput = input;
                    node.inputs[index] = null;
                    setTimeout(() => {
                      node.inputs[index] = originalInput;
                      if (editor.draw) {
                        editor.draw();
                      }
                    }, 5);
                  }
                });
              }
            });

            setTimeout(() => {
              if (window.updateShaderFromGraph) {
                updateShaderFromGraph();
              }
            }, 50);
          }

          console.log("LOAD COMPLETE");
        } catch (error) {
          console.error("Load failed:", error);
        }

        e.target.value = "";
      }
    });
    console.log("File input handler attached");
  }

  function triggerFileLoad() {
    const fileInput = document.getElementById("file-import");
    if (fileInput) {
      fileInput.value = "";
      setTimeout(() => {
        fileInput.click();
      }, 10);
    }
  }

  // Export JSON button
  const exportJsonBtn = removeExistingHandlers("btn-export-json");
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Export JSON clicked");
      saveLoadManager.saveToFile(null, "json");
    });
    console.log("Export JSON handler attached");
  }

  // Export WGSL button
  const exportWgslBtn = removeExistingHandlers("btn-export-wgsl");
  if (exportWgslBtn) {
    exportWgslBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Export WGSL clicked");
      saveLoadManager.saveToFile(null, "wgsl");
    });
    console.log("Export WGSL handler attached");
  }

  // Import button
  const importBtn = removeExistingHandlers("btn-import");
  if (importBtn) {
    importBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Import button clicked");
      triggerFileLoad();
    });
    console.log("Import button handler attached");
  }

  // Backups button
  const backupsBtn = removeExistingHandlers("btn-backups");
  if (backupsBtn && backupDialog) {
    backupsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Backups button clicked");
      backupDialog.show();
    });
    console.log("Backups button handler attached");
  }

  // Rebuild button
  const rebuildBtn = removeExistingHandlers("btn-rebuild");
  if (rebuildBtn) {
    rebuildBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Rebuild button clicked");
      updateShaderFromGraph();
    });
    console.log("Rebuild button handler attached");
  }

  console.log("ALL HANDLERS SETUP COMPLETE");
}

function setupKeyboardShortcuts() {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const isCommandKey = (event) => (isMac ? event.metaKey : event.ctrlKey);

  window.addEventListener("keydown", (e) => {
    if (shouldIgnoreShortcutTarget(e)) {
      return;
    }

    const cmdKey = isCommandKey(e);

    if (
      cmdKey &&
      !e.shiftKey &&
      !e.altKey &&
      (e.key === " " || e.code === "Space" || e.key === "Spacebar")
    ) {
      e.preventDefault();
      if (!openQuickNodeSearch()) {
        updateStatus("Quick node search unavailable", "warning");
      }
      return;
    }

    if (cmdKey && e.key.toLowerCase() === "z" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (undoManager) {
        const result = undoManager.undo();
        updateStatus(result ? "Undo successful" : "Nothing to undo");
      }
      return;
    }

    if (
      cmdKey &&
      ((e.key.toLowerCase() === "z" && e.shiftKey) ||
        e.key.toLowerCase() === "y")
    ) {
      e.preventDefault();
      if (undoManager) {
        const result = undoManager.redo();
        updateStatus(result ? "Redo successful" : "Nothing to redo");
      }
      return;
    }

    const selected = editor?.selection?.getSelected?.();
    if (e.key.startsWith("Arrow") && selected && selected.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "ArrowLeft":
          editor.selection.moveSelected(-step, 0);
          break;
        case "ArrowRight":
          editor.selection.moveSelected(step, 0);
          break;
        case "ArrowUp":
          editor.selection.moveSelected(0, -step);
          break;
        case "ArrowDown":
          editor.selection.moveSelected(0, step);
          break;
      }
      editor?.draw?.();
      return;
    }

    if (!cmdKey) {
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (!frameSelection()) {
          updateStatus("Select nodes to frame", "warning");
        }
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case "s":
        e.preventDefault();
        if (e.shiftKey) {
          saveLoadManager?.saveToLocal?.();
        } else {
          saveLoadManager?.saveToFile?.();
        }
        break;

      case "o":
        e.preventDefault();
        const fileInput = document.getElementById("file-import");
        if (fileInput) {
          fileInput.value = "";
          fileInput.click();
        }
        break;

      case "l":
        e.preventDefault();
        if (e.shiftKey) {
          saveLoadManager?.loadFromLocal?.();
        } else if (!toggleDebugOverlay()) {
          updateStatus("Debug overlay unavailable", "warning");
        }
        break;

      case "d":
        e.preventDefault();
        if (!duplicateSelection()) {
          updateStatus("Select nodes to duplicate", "warning");
        }
        break;

      case "p":
        e.preventDefault();
        if (!togglePreviewVisibility()) {
          updateStatus("Preview unavailable", "warning");
        }
        break;

      case "n":
        e.preventDefault();
        if (confirm("Create new project? Unsaved changes will be lost.")) {
          createNewProject();
        }
        break;

      case "b":
        e.preventDefault();
        if (backupDialog) {
          backupDialog.show();
        }
        break;

      case "e":
        e.preventDefault();
        if (e.shiftKey) {
          saveLoadManager?.saveToFile?.(null, "wgsl");
        } else if (!focusExpressionEditor()) {
          updateStatus("Open a node parameter to edit expressions", "warning");
        }
        break;

      case "r":
        if (e.shiftKey) {
          e.preventDefault();
          updateShaderFromGraph();
        }
        break;

      default:
        break;
    }
  });

  window.addEventListener("keydown", (e) => {
    if (editor && editor.handleKeyDown) {
      editor.handleKeyDown(e);
    }
  });
}

function shouldIgnoreShortcutTarget(event) {
  const target = event.target;
  if (!target || !target.tagName) {
    return false;
  }

  const tag = target.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return true;
  }

  return Boolean(target.isContentEditable);
}

function duplicateSelection() {
  const selection = editor?.selection;
  const selected = selection?.getSelected?.();
  if (!selection || !selected || selected.size === 0) {
    return false;
  }

  selection.duplicateSelected();
  editor?.draw?.();
  updateStatus("Duplicated selection");
  return true;
}

function frameSelection() {
  if (!editor?.viewport || !editor?.graph) {
    return false;
  }

  const selected = editor.selection?.getSelected?.();
  if (!selected || selected.size === 0) {
    return false;
  }

  const nodes = editor.graph.nodes.filter((node) => selected.has(node.id));
  if (!nodes.length) {
    return false;
  }

  const bounds = nodes.reduce(
    (acc, node) => {
      const width = typeof node.w === "number" ? node.w : 150;
      const height = typeof node.h === "number" ? node.h : 80;
      acc.minX = Math.min(acc.minX, node.x);
      acc.minY = Math.min(acc.minY, node.y);
      acc.maxX = Math.max(acc.maxX, node.x + width);
      acc.maxY = Math.max(acc.maxY, node.y + height);
      return acc;
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    return false;
  }

  const fitted = editor.viewport.fitToContent(bounds, 80);
  if (fitted) {
    editor?.draw?.();
    updateStatus("Framed selection");
  }
  return fitted;
}

function togglePreviewVisibility() {
  if (!floatingPreview || typeof floatingPreview.toggle !== "function") {
    return false;
  }

  floatingPreview.toggle();
  updateStatus(floatingPreview.isVisible ? "Preview shown" : "Preview hidden");
  return true;
}

function toggleDebugOverlay() {
  if (!floatingPreview?.settings) {
    return false;
  }

  const settings = floatingPreview.settings;
  const current = settings.settings?.debugChannel || "none";
  const next = current === "none" ? "alpha" : "none";

  settings.updateSetting("debugChannel", next);
  updateStatus(
    next === "none"
      ? "Debug overlay hidden"
      : `Debug overlay: ${next.toUpperCase()}`,
  );
  return true;
}

function openQuickNodeSearch() {
  if (!editor?.menu?.showCreateMenu || !editor?.viewport || !editor?.canvas) {
    return false;
  }

  const rect = editor.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  const localX = rect.width / 2;
  const localY = rect.height / 2;
  const canvasPos = editor.viewport.screenToCanvas(localX, localY);

  editor.menu.showCreateMenu(
    canvasPos.x,
    canvasPos.y,
    rect.left + localX,
    rect.top + localY,
  );
  return true;
}

function focusExpressionEditor() {
  if (!editor?.paramPanel) {
    return false;
  }

  const panel = editor.paramPanel.panel;
  if (!panel) {
    return false;
  }

  const isHidden =
    panel.style?.display === "none" || panel.offsetParent === null;

  if (isHidden) {
    const selected = editor.selection?.getSelected?.();
    if (!selected || selected.size !== 1) {
      return false;
    }

    const nodeId = selected.values().next().value;
    const node = editor.graph?.nodes?.find((n) => n.id === nodeId);
    if (!node || !editor.paramPanel.showNodeParameters) {
      return false;
    }
    editor.paramPanel.showNodeParameters(node);
  }

  const input =
    panel.querySelector?.(
      ".expression-input-container .param-input.expression-capable",
    ) || panel.querySelector?.(".param-input.expression-capable");

  if (!input) {
    return false;
  }

  setTimeout(() => {
    input.focus();
    if (typeof input.select === "function") {
      input.select();
    }
  }, 0);

  updateStatus("Expression editor focused");
  return true;
}

async function checkAutosaveRecovery() {
  if (!saveLoadManager.hasAutosave()) return;

  const age = saveLoadManager.getAutosaveAge();
  const ageText = saveLoadManager.formatAge(age);

  if (age < 3600000) {
    const shouldRecover = confirm(
      `Found an autosave from ${ageText} ago. Would you like to recover it?`,
    );

    if (shouldRecover) {
      await saveLoadManager.loadFromLocal();
      return;
    }
  }

  saveLoadManager.createBackup("startup");
}

function createNewProject() {
  graph.nodes = [];
  graph.connections = [];
  graph.selection = new Set();

  if (undoManager) {
    undoManager.clear();
    console.log("Undo history cleared for new project");
  }

  if (editor) {
    if (editor.selection && editor.selection.clear) {
      editor.selection.clear();
    }
    if (editor.nodePreviews) {
      editor.nodePreviews.clear();
    }
    if (editor.viewport) {
      editor.viewport.panX = 0;
      editor.viewport.panY = 0;
      editor.viewport.zoom = 1;
    }
  }

  SeedGraphBuilder.createSeedGraph(graph);

  updateShaderFromGraph();
  if (editor && editor.draw) {
    editor.draw();
  }
if (graph && graph.nodes) {
  graph.nodes.forEach(node => {
    if (editor.nodePreviews && editor.nodePreviews.has(node.id)) {
      const preview = editor.nodePreviews.get(node.id);
      preview.needsUpdate = true;
    }
  });
  
  // Redraw after marking for update
  setTimeout(() => {
    if (editor.draw) editor.draw();
  }, 50);
}
  if (saveLoadManager) {
    saveLoadManager.hasUnsavedChanges = false;
    saveLoadManager.updateStatus("New project created");
  }
}

function setupPreviewButtons() {
  if (!floatingPreview) return;

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
let lastUniformUpdate = 0;
function updateShaderFromGraph() {
  try {
    if (!graph || !graph.nodes || graph.nodes.length === 0) {
      console.log('Empty graph - skipping shader update');
      return;
    }
    
    const outputNode = graph.nodes.find(node => 
      node && /OutputFinal/i.test(node.kind || node.type || node.name || '')
    );
    
    if (!outputNode) {
      console.log('No output node found - skipping shader update');
      return;
    }
    
    const hasConnection = Array.isArray(outputNode.inputs) && 
                         outputNode.inputs[0] !== null && 
                         outputNode.inputs[0] !== undefined;
    
    if (!hasConnection) {
      console.log('Output node not connected - skipping shader update');
      return;
    }
    
    console.log('Graph valid - compiling shader');
    
    // CRITICAL: Clear uniform manager owned by NodeCompiler
    // NodeCompiler creates it, then passes it to FieldNodes and others
    
    // Compile the shader
    console.log('🔧 Starting shader generation...');
    const result = buildWGSL(window.editor.graph);  // ✅ This line was missing!





    if (!result || !result.wgsl) {
      console.error('Shader compilation produced no code');
      return;
    }
    
console.log('Shader code generated, length:', result.wgsl.length);

if (window.gpuRenderer) {
  window.gpuRenderer.setShaderSource(result.wgsl, {
    hasTextures: !!result.usesTextures,
    hasUniforms: !!result.usesUniforms,
  });
  console.log('Shader updated successfully');
  lastUniformUpdate = performance.now();
  if (typeof updateStatus === 'function') {
    updateStatus('Shader compiled');
  }
} else {
  console.warn('⚠️ gpuRenderer not initialized');
}


    
console.log('Shader code generated, length:', result.wgsl.length);




    
  } catch (error) {
    console.error('Error in updateShaderFromGraph:', error);
    
    if (window.errorHandler && typeof window.errorHandler.handleError === 'function') {
      window.errorHandler.handleError(error, {
        component: 'shader-update',
        type: 'compilation-error'
      });
    }
    
    if (typeof updateStatus === 'function') {
      updateStatus('Shader compilation failed', 'error');
    }
  }
}
function showShaderError(errorMessage) {
  const errorOverlay = document.getElementById("err-overlay");
  const errorLog = document.getElementById("err-log");

  if (errorOverlay && errorLog) {
    errorLog.textContent = errorMessage;
    errorOverlay.classList.remove("hidden");

    setTimeout(() => {
      errorOverlay.classList.add("hidden");
    }, 5000);

    errorOverlay.onclick = () => {
      errorOverlay.classList.add("hidden");
    };
  }
}

function updateStatus(message, type = "info") {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = type;

    if (type !== "error") {
      setTimeout(() => {
        if (statusEl.textContent === message) {
          statusEl.textContent = "Idle";
          statusEl.className = "";
        }
      }, 3000);
    }
  }

  console.log(`[${type.toUpperCase()}] ${message}`);
}

function handleRenderFrame(frameState) {
  if (window.gpuRenderer) {
    window.gpuRenderer.render({ timeSec: frameState.simTime });
  }

  if (!frameState.manual && floatingPreview?.fpsCounter) {
    floatingPreview.fpsCounter.frame();
  }

  if (undoManager) {
    undoManager.updateUI();
  }
}

function initializeRenderLoopFromSettings() {
  if (!window.gpuRenderer) {
    if (renderLoopController) {
      renderLoopController.stop();
      renderLoopController = null;
    }
    window.renderLoop = null;
    window.render = () => {};
    return;
  }

  const previewConfig = floatingPreview?.settings?.settings || {};
  const mode = previewConfig.timingMode === "fixed" ? "fixed" : "vsync";
  const fixedFps = Number.isFinite(previewConfig.refreshRate)
    ? previewConfig.refreshRate
    : 60;
  const timeScale = Number.isFinite(previewConfig.timeScale)
    ? previewConfig.timeScale
    : 1;
  const paused = !!previewConfig.isPaused;

  if (renderLoopController) {
    renderLoopController.stop();
  }

  renderLoopController = new RenderLoop({
    onFrame: handleRenderFrame,
    mode,
    fixedFps,
    timeScale,
    paused,
  });

  window.renderLoop = renderLoopController;
  window.render = () => renderLoopController?.renderNow({ advance: false });

  renderLoopController.start();
  renderLoopController.renderNow({ advance: false });
}


function showBackupDialog() {
  if (backupDialog) {
    backupDialog.show();
  }
}

// Export functions to global scope
window.showBackupDialog = showBackupDialog;
window.createNewProject = createNewProject;
window.updateStatus = updateStatus;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
