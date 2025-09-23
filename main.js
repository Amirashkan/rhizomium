// main.js - Complete version with Undo System and Event System
import { initWebGPU, updateShader, drawFrame } from "./src/gpu/gpuRenderer.js";
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
  if (!canvas) {
    console.error("No GPU canvas found after cleanup");
    return false;
  }

  try {
    console.log("Reinitializing WebGPU...");
    __deviceReady = false;
    const device = await initWebGPU(canvas);

    if (device) {
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);
      console.log("TextureManager initialized successfully");
    }

    __deviceReady = !!device;

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

async function initialize() {
  const canvas =
    document.getElementById("gpu-canvas") || document.querySelector("canvas");
  if (canvas) {
    const device = await initWebGPU(canvas);

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

    const canvas =
      document.getElementById("gpu-canvas") || document.querySelector("canvas");
    if (canvas) {
      const device = await initWebGPU(canvas);

      if (device) {
        window.textureManager = new TextureManager();
        await window.textureManager.initialize(device);
        console.log("TextureManager initialized successfully");
      }

      __deviceReady = !!device;
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
    undoManager.editor = editor;

    console.log("Creating SaveLoadManager...");
    saveLoadManager = new SaveLoadManager(editor, graph, updateShaderFromGraph);
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

    await checkAutosaveRecovery();
    await updateShaderFromGraph();

    renderLoop();

    setInterval(() => {
      const pill = document.getElementById("rz-fallback-pill");
      if (pill && pill.style.display !== "none") {
        pill.remove();
        console.log("Removed late RhizomiumLoader interference");
      }
    }, 2000);

    console.log("GLSL Node Editor initialized successfully");
  } catch (error) {
    console.error("Initialization failed:", error);
    updateStatus("Initialization failed: " + error.message, "error");
  }
}

// Undo callback functions
function onConnectionDeleted(connection) {
  console.log("Connection deleted callback:", connection);
  if (undoManager && connection) {
    // Ensure we have the right format for the UndoManager
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

function onNodeDeleted(node) {
  console.log("Node deleted callback:", node);
  if (undoManager && node) {
    undoManager.recordNodeDeletion(node);
  } else {
    console.warn("UndoManager not available or node invalid:", { undoManager: !!undoManager, node });
  }
}

function onConnectionCreated(sourceNodeId, targetNodeId, targetInput) {
  console.log("Connection created callback:", { sourceNodeId, targetNodeId, targetInput });
  if (undoManager) {
    undoManager.recordConnectionCreation(sourceNodeId, targetNodeId, targetInput);
  }
}

function onNodeCreated(node) {
  console.log("Node created callback:", node);
  if (undoManager && node) {
    undoManager.recordNodeCreation(node);
  }
}

// Expose these functions globally so Editor can call them
window.onConnectionDeleted = onConnectionDeleted;
window.onNodeDeleted = onNodeDeleted;
window.onConnectionCreated = onConnectionCreated;
window.onNodeCreated = onNodeCreated;

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

          console.log("REINITIALIZING WEBGPU");
          const webgpuSuccess = await reinitializeWebGPUAfterLoad();

          if (webgpuSuccess) {
            console.log("WebGPU reinitialized successfully after load");
          } else {
            console.error("Failed to reinitialize WebGPU after load");
          }

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
  window.addEventListener("keydown", (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) {
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;

    if (!cmdKey) return;

    switch (e.key.toLowerCase()) {
      // Undo/Redo shortcuts
      case "z":
        e.preventDefault();
        if (e.shiftKey) {
          console.log("Ctrl+Shift+Z pressed - REDO");
          if (undoManager) {
            const result = undoManager.redo();
            console.log("Redo result:", result);
            updateStatus(result ? "Redo successful" : "Nothing to redo");
          }
        } else {
          console.log("Ctrl+Z pressed - UNDO");
          if (undoManager) {
            const result = undoManager.undo();
            console.log("Undo result:", result);
            updateStatus(result ? "Undo successful" : "Nothing to undo");
          }
        }
        break;
      case "y":
        if (!e.shiftKey) {
          e.preventDefault();
          // Ctrl+Y: Redo
          console.log("Ctrl+Y pressed - REDO");
          if (undoManager) {
            undoManager.redo();
          }
        }
        break;

      case "s":
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+S: Save to local storage
          saveLoadManager.saveToLocal();
        } else {
          // Ctrl+S: Save to file
          saveLoadManager.saveToFile();
        }
        break;

      case "o":
        e.preventDefault();
        // Ctrl+O: Open file
        const fileInput = document.getElementById("file-import");
        if (fileInput) {
          fileInput.value = "";
          fileInput.click();
        }
        break;

      case "l":
        e.preventDefault();
        // Ctrl+L: Load from local storage
        saveLoadManager.loadFromLocal();
        break;

      case "e":
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+E: Export WGSL
          saveLoadManager.saveToFile(null, "wgsl");
        } else {
          // Ctrl+E: Export JSON
          saveLoadManager.saveToFile(null, "json");
        }
        break;

      case "n":
        e.preventDefault();
        // Ctrl+N: New project
        if (confirm("Create new project? Unsaved changes will be lost.")) {
          createNewProject();
        }
        break;

      case "b":
        e.preventDefault();
        // Ctrl+B: Show backup dialog
        if (backupDialog) {
          backupDialog.show();
        }
        break;

      case "r":
        // Don't preventDefault for Ctrl+R - let browser refresh
        if (!e.shiftKey) {
          // Ctrl+R: Let browser handle page refresh
          return;
        } else {
          // Ctrl+Shift+R: Rebuild shader
          e.preventDefault();
          updateShaderFromGraph();
        }
        break;
    }
  });

  // Add keyboard handler for Delete key
  window.addEventListener("keydown", (e) => {
    if (editor && editor.handleKeyDown) {
      editor.handleKeyDown(e);
    }
  });
}

async function checkAutosaveRecovery() {
  if (!saveLoadManager.hasAutosave()) return;

  const age = saveLoadManager.getAutosaveAge();
  const ageText = saveLoadManager.formatAge(age);

  // Show recovery dialog if autosave is recent (less than 1 hour old)
  if (age < 3600000) {
    // 1 hour in milliseconds
    const shouldRecover = confirm(
      `Found an autosave from ${ageText} ago. Would you like to recover it?`,
    );

    if (shouldRecover) {
      await saveLoadManager.loadFromLocal();
      return;
    }
  }

  // If not recovering, create a backup of current state
  saveLoadManager.createBackup("startup");
}

function createNewProject() {
  // Clear current graph
  graph.nodes = [];
  graph.connections = [];
  graph.selection = new Set();

  // Clear undo history
  if (undoManager) {
    undoManager.clear();
    console.log("Undo history cleared for new project");
  }

  // Reset editor state
  if (editor) {
    if (editor.selection && editor.selection.clear) {
      editor.selection.clear();
    }
    if (editor.nodePreviews) {
      editor.nodePreviews.clear();
    }
    // Reset viewport
    if (editor.viewport) {
      editor.viewport.panX = 0;
      editor.viewport.panY = 0;
      editor.viewport.zoom = 1;
    }
  }

  // Create new seed graph
  SeedGraphBuilder.createSeedGraph(graph);

  // Update shader and UI
  updateShaderFromGraph();
  if (editor && editor.draw) {
    editor.draw();
  }

  // Mark as clean project
  if (saveLoadManager) {
    saveLoadManager.hasUnsavedChanges = false;
    saveLoadManager.updateStatus("New project created");
  }
}

function setupPreviewButtons() {
  if (!floatingPreview) return;

  // Connect to HTML buttons instead of creating new ones
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

async function updateShaderFromGraph() {
  if (!__deviceReady) {
    updateStatus("WebGPU not ready", "warning");
    return;
  }

  try {
    updateStatus("Building shader...");
    const wgsl = buildWGSL(graph);

    updateStatus("Updating GPU shader...");
    await updateShader(wgsl);

    // Update code display
    const codeEl = document.getElementById("code");
    if (codeEl) {
      codeEl.textContent = wgsl;
    }

    updateStatus("Shader updated successfully");

    // Trigger preview updates if needed
    if (
      editor &&
      editor.previewIntegration &&
      typeof editor.previewIntegration.onShaderUpdate === "function"
    ) {
      editor.previewIntegration.onShaderUpdate();
    }

    // Update floating preview
    if (window.floatingPreview) {
      setTimeout(() => {
        const mainCanvas = document.getElementById("gpu-canvas");
        const previewCanvas =
          window.floatingPreview.canvas || window.floatingPreview.previewCanvas;

        if (mainCanvas && previewCanvas) {
          const ctx = previewCanvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            ctx.drawImage(
              mainCanvas,
              0,
              0,
              previewCanvas.width,
              previewCanvas.height,
            );
          }
        }
      }, 100); // Small delay to ensure GPU render is complete
    }
  } catch (error) {
    console.error("Shader update failed:", error);
    updateStatus(`Shader error: ${error.message}`, "error");

    // Show error overlay
    showShaderError(error.message);
  }
}

function showShaderError(errorMessage) {
  const errorOverlay = document.getElementById("err-overlay");
  const errorLog = document.getElementById("err-log");

  if (errorOverlay && errorLog) {
    errorLog.textContent = errorMessage;
    errorOverlay.classList.remove("hidden");

    // Auto-hide after 5 seconds
    setTimeout(() => {
      errorOverlay.classList.add("hidden");
    }, 5000);

    // Click to dismiss
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

    // Clear status after 3 seconds for non-error messages
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

function renderLoop() {
  // Render GPU frame
  if (__deviceReady) {
    try {
      drawFrame();
    } catch (error) {
      console.error("GPU render failed:", error);
    }
  }

  // Render editor UI
  if (editor) {
    try {
      editor.draw();
    } catch (error) {
      console.error("Editor render failed:", error);
    }
  }

  // Update FPS counter
  if (floatingPreview && floatingPreview.fpsCounter) {
    floatingPreview.fpsCounter.frame();
  }

  // Update undo/redo button states
  if (undoManager) {
    undoManager.updateUI();
  }

  requestAnimationFrame(renderLoop);
}

// Enhanced backup management
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