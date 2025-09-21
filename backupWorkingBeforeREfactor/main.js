// main.js - Updated with Save/Load Integration and Texture Support
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

window.makeNode = makeNode;
window.NodeDefs = NodeDefs;

// Prevent default browser drag behavior globally
function setupGlobalDragPrevention() {
  // Prevent default drag behavior on the entire document
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    document.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Only allow drops on designated drop zones
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if drop target is a valid drop zone
    const dropZone = e.target.closest(".file-drop-zone");
    if (!dropZone) {
      console.log("Drop ignored - not on a valid drop zone");
      return false;
    }
  });

  console.log("Global drag prevention setup complete");
}

async function reinitializeWebGPUAfterLoad() {
  console.log("🔧 Reinitializing WebGPU after file load...");

  // Clean up any duplicate canvases
  const allCanvases = document.querySelectorAll("#gpu-canvas");
  console.log(`Found ${allCanvases.length} canvas elements with gpu-canvas id`);

  if (allCanvases.length > 1) {
    console.log("⚠️ Multiple canvases detected, cleaning up...");
    // Remove all but the first one
    for (let i = 1; i < allCanvases.length; i++) {
      allCanvases[i].remove();
      console.log(`Removed duplicate canvas ${i}`);
    }
  }

  // Get the remaining canvas
  const canvas = document.getElementById("gpu-canvas");
  if (!canvas) {
    console.error("❌ No GPU canvas found after cleanup");
    return false;
  }

  // Force WebGPU reinitialization
  try {
    console.log("🔄 Reinitializing WebGPU...");

    // Reset device ready flag
    __deviceReady = false;

    // Reinitialize WebGPU with the canvas
    const device = await initWebGPU(canvas);

    if (device) {
      // Initialize texture manager
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);
      console.log("✅ TextureManager initialized successfully");
    }

    __deviceReady = !!device;

    if (device) {
      console.log("✅ WebGPU reinitialized successfully");

      // Force a shader update to test
      console.log("🔄 Testing shader update...");
      await updateShaderFromGraph();

      return true;
    } else {
      console.error("❌ Failed to reinitialize WebGPU");
      return false;
    }
  } catch (error) {
    console.error("❌ Error reinitializing WebGPU:", error);
    return false;
  }
}

if (window.__mainLoaded) throw new Error("main.js loaded twice");
window.__mainLoaded = true;

// DISABLE RhizomiumLoader completely
window.__disableRhizomiumLoader = true;

let graph = new Graph();
let editor = null;
let saveLoadManager = null;
let backupDialog = null;
let __deviceReady = false;
let floatingPreview = null;

async function initialize() {
  const canvas =
    document.getElementById("gpu-canvas") || document.querySelector("canvas");
  if (canvas) {
    const device = await initWebGPU(canvas);

    // ADD THIS BLOCK RIGHT HERE:
    if (device) {
      // Initialize texture manager
      const { TextureManager } = await import("./src/core/TextureManager.js");
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);
      console.log("✅ TextureManager initialized successfully");
    }

    __deviceReady = !!device;
  }

  setupGlobalDragPrevention();

  try {
    // COMPLETELY DISABLE RhizomiumLoader
    // Override its functions before they can create duplicates
    if (typeof window.mountPill === "undefined") {
      window.mountPill = () => {
        console.log("RhizomiumLoader mountPill disabled");
      };
    }

    // Remove any existing RhizomiumLoader elements
    const existingPill = document.getElementById("rz-fallback-pill");
    if (existingPill) {
      existingPill.remove();
      console.log("Removed existing RhizomiumLoader pill");
    }

    // Initialize WebGPU
    const canvas =
      document.getElementById("gpu-canvas") || document.querySelector("canvas");
    if (canvas) {
      const device = await initWebGPU(canvas);

      if (device) {
        // Initialize texture manager
        window.textureManager = new TextureManager();
        await window.textureManager.initialize(device);
        console.log("✅ TextureManager initialized successfully");
      }

      __deviceReady = !!device;
    }

    // Create seed graph
    SeedGraphBuilder.createSeedGraph(graph);

    // Initialize editor
    editor = new Editor(graph, updateShaderFromGraph);

    // Initialize save/load system
    console.log("Creating SaveLoadManager...");
    saveLoadManager = new SaveLoadManager(editor, graph, updateShaderFromGraph);
    console.log("SaveLoadManager created:", saveLoadManager);

    // Initialize backup dialog
    console.log("Creating BackupDialog...");
    backupDialog = new BackupDialog(saveLoadManager);
    console.log("BackupDialog created:", backupDialog);

    // Initialize floating preview and connect to HTML buttons
    const gpuCanvas = document.getElementById("gpu-canvas");
    if (gpuCanvas) {
      floatingPreview = new FloatingGPUPreview(gpuCanvas);
      setupPreviewButtons(); // Connect to HTML buttons instead of creating new ones
      floatingPreview.show();
    }

    // Setup UI event handlers
    setupUIEventHandlers();

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Expose globals BEFORE setting up UI handlers
    window.graph = graph;
    window.editor = editor;
    window.saveLoadManager = saveLoadManager;
    window.backupDialog = backupDialog;
    window.rebuild = updateShaderFromGraph;
    window.buildWGSL = buildWGSL; // For SaveLoadManager WGSL export
    window.floatingPreview = floatingPreview;

    // Check for autosave recovery
    await checkAutosaveRecovery();

    // Initial shader update and render
    await updateShaderFromGraph();

    renderLoop();

    // Periodic cleanup of RhizomiumLoader interference
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

function setupUIEventHandlers() {
  console.log("Setting up UI event handlers...");

  if (!saveLoadManager) {
    console.error("SaveLoadManager not available!");
    return;
  }

  // PREVENT DOUBLE HANDLERS: Remove existing listeners first
  const removeExistingHandlers = (elementId) => {
    const el = document.getElementById(elementId);
    if (el) {
      // Clone and replace to remove all listeners
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      return newEl;
    }
    return null;
  };

  // Save Project button - prevent double handlers
  const saveBtn = removeExistingHandlers("btn-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("=== SAVE BUTTON CLICKED ===");
      saveLoadManager.saveToFile();
    });
    console.log("Save button handler attached (clean)");
  }

  // Load Project button
  const loadBtn = removeExistingHandlers("btn-load");
  if (loadBtn) {
    loadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("=== LOAD BUTTON CLICKED ===");
      triggerFileLoad();
    });
    console.log("Load button handler attached (clean)");
  }

  // File input change handler with WebGPU reinitialization
  const fileInput = removeExistingHandlers("file-import");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        console.log("=== FILE SELECTED ===", file.name);

        try {
          await saveLoadManager.loadFromFile(file);

          // CRITICAL: Reinitialize WebGPU after loading
          console.log("=== REINITIALIZING WEBGPU ===");
          const webgpuSuccess = await reinitializeWebGPUAfterLoad();

          if (webgpuSuccess) {
            console.log("✅ WebGPU reinitialized successfully after load");
          } else {
            console.error("❌ Failed to reinitialize WebGPU after load");
          }

          // Force node recalculation
          console.log("=== FORCING NODE RECALCULATION ===");
          if (graph && graph.nodes) {
            graph.nodes.forEach((node) => {
              delete node.cachedValue;
              delete node.cached;
              node.needsUpdate = true;
            });

            // Trigger preview refresh
            console.log("=== TRIGGERING PREVIEW REFRESH ===");
            // Find any node with a connection and briefly disconnect it to unlock previews
            const nodeWithConnection = graph.nodes.find(
              (node) =>
                node.inputs && node.inputs.some((input) => input !== null),
            );

            if (nodeWithConnection) {
              const inputIndex = nodeWithConnection.inputs.findIndex(
                (input) => input !== null,
              );
              const originalInput = nodeWithConnection.inputs[inputIndex];

              // Disconnect briefly to trigger global preview unlock
              nodeWithConnection.inputs[inputIndex] = null;

              setTimeout(() => {
                // Reconnect
                nodeWithConnection.inputs[inputIndex] = originalInput;
                if (editor.draw) {
                  editor.draw();
                }
              }, 10);
            }

            // Refresh node previews
            console.log("=== REFRESHING NODE PREVIEWS ===");
            if (editor && editor.nodePreviews) {
              // Force refresh all node previews
              graph.nodes.forEach((node) => {
                if (editor.nodePreviews.has(node.id)) {
                  // Get existing preview settings
                  const preview = editor.nodePreviews.get(node.id);
                  // Force refresh by removing and re-adding
                  editor.nodePreviews.delete(node.id);
                  editor.nodePreviews.set(node.id, {
                    enabled: preview.enabled,
                    size: preview.size || "small",
                    showVisualInfo: preview.showVisualInfo !== false,
                    needsUpdate: true,
                  });
                } else {
                  // Create preview for nodes that don't have one
                  editor.nodePreviews.set(node.id, {
                    enabled: true,
                    size: "small",
                    showVisualInfo: true,
                    needsUpdate: true,
                  });
                }
              });

              // Force editor redraw to update previews
              setTimeout(() => {
                if (editor.draw) {
                  editor.draw();
                }
              }, 100);
            }

            // Auto-refresh node previews with connection simulation
            console.log("=== AUTO-REFRESHING NODE PREVIEWS ===");
            graph.nodes.forEach((node) => {
              if (node.inputs) {
                node.inputs.forEach((input, index) => {
                  if (input) {
                    const originalInput = input;
                    // Disconnect
                    node.inputs[index] = null;
                    // Reconnect immediately
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

            // Final update after all connections are restored
            setTimeout(() => {
              if (window.updateShaderFromGraph) {
                updateShaderFromGraph();
              }
            }, 50);
          }

          console.log("=== LOAD COMPLETE ===");
        } catch (error) {
          console.error("Load failed:", error);
        }

        // Clear the input after processing
        e.target.value = "";
      }
    });
    console.log("File input handler attached (clean)");
  }

  // Helper function to reliably trigger file selection
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
    console.log("Export JSON handler attached (clean)");
  }

  // Export WGSL button
  const exportWgslBtn = removeExistingHandlers("btn-export-wgsl");
  if (exportWgslBtn) {
    exportWgslBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Export WGSL clicked");
      saveLoadManager.saveToFile(null, "wgsl");
    });
    console.log("Export WGSL handler attached (clean)");
  }

  // Import button
  const importBtn = removeExistingHandlers("btn-import");
  if (importBtn) {
    importBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Import button clicked");
      triggerFileLoad();
    });
    console.log("Import button handler attached (clean)");
  }

  // Backups button
  const backupsBtn = removeExistingHandlers("btn-backups");
  if (backupsBtn && backupDialog) {
    backupsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Backups button clicked");
      backupDialog.show();
    });
    console.log("Backups button handler attached (clean)");
  }

  // Rebuild button
  const rebuildBtn = removeExistingHandlers("btn-rebuild");
  if (rebuildBtn) {
    rebuildBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Rebuild button clicked");
      updateShaderFromGraph();
    });
    console.log("Rebuild button handler attached (clean)");
  }

  console.log("=== ALL HANDLERS SETUP COMPLETE ===");
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

  requestAnimationFrame(renderLoop);
}

// Enhanced backup management
function showBackupDialog() {
  if (backupDialog) {
    backupDialog.show();
  }
}

// Export backup dialog function to global scope for debugging/manual use
window.showBackupDialog = showBackupDialog;
window.createNewProject = createNewProject;
window.updateStatus = updateStatus;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
