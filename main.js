// main.js - Complete version with Undo System
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

    SeedGraphBuilder.createSeedGraph(graph);

    editor = new Editor(graph, updateShaderFromGraph);

    // Initialize undo manager after editor
    undoManager = new UndoManager(graph, editor);
    console.log("UndoManager created:", undoManager);
    window.undoManager = undoManager;

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

// Expose these functions globally so Editor can call them
window.onConnectionDeleted = onConnectionDeleted;
window.onNodeDeleted = onNodeDeleted;

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
          // Ctrl+Shift+Z: Redo
          console.log("Ctrl+Shift+Z pressed - REDO");
          if (undoManager) {
            const result = undoManager.redo();
            console.log("Redo result:", result);
            updateStatus(result ? "Redo successful" : "Nothing to redo");
          } else {
            console.error("UndoManager not available for redo");
            updateStatus("Redo not available", "error");
          }
        } else {
          // Ctrl+Z: Undo
          console.log("Ctrl+Z pressed - UNDO");
          if (undoManager) {
            const result = undoManager.undo();
            console.log("Undo result:", result);
            updateStatus(result ? "Undo successful" : "Nothing to undo");
          } else {
            console.error("UndoManager not available for undo");
            updateStatus("Undo not available", "error");
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
// Add this debug function to your main.js to trace what's happening:

window.traceDeleteActions = function() {
  console.log("=== TRACING DELETE ACTIONS ===");
  
  // Override selection manager to trace calls
  if (window.editor && window.editor.selection && window.editor.selection.deleteSelected) {
    const originalDelete = window.editor.selection.deleteSelected.bind(window.editor.selection);
    
    window.editor.selection.deleteSelected = function() {
      console.log("SelectionManager.deleteSelected() called - this should trigger undo callbacks!");
      console.log("Selected nodes:", Array.from(this.getSelected()));
      
      // Get selected nodes before deletion
      const nodesToDelete = Array.from(this.getSelected());
      
      // Record each node for undo BEFORE deleting
      nodesToDelete.forEach(node => {
        if (window.onNodeDeleted) {
          console.log("Recording node deletion for undo:", node.kind, node.id);
          window.onNodeDeleted(node);
        } else {
          console.error("onNodeDeleted callback not available!");
        }
      });
      
      // Call original delete method
      return originalDelete();
    };
    
    console.log("SelectionManager.deleteSelected() has been wrapped with undo recording");
  } else {
    console.error("SelectionManager.deleteSelected() not found - this is the problem!");
  }
  
  // Also trace connection manager
  if (window.editor && window.editor.connections && window.editor.connections.removeConnection) {
    const originalRemove = window.editor.connections.removeConnection.bind(window.editor.connections);
    
    window.editor.connections.removeConnection = function(nodeId, inputPin) {
      console.log("ConnectionManager.removeConnection() called - should trigger undo callback!");
      console.log("Removing connection:", nodeId, inputPin);
      
      // Get connection details BEFORE deletion
      const targetNode = this.graph.nodes.find(n => n.id === nodeId);
      if (targetNode && targetNode.inputs && targetNode.inputs[inputPin]) {
        const sourceNodeId = targetNode.inputs[inputPin];
        const sourceNode = this.graph.nodes.find(n => n.id == sourceNodeId);
        
        if (sourceNode) {
          const connectionData = {
            sourceNode: sourceNode,
            targetNode: targetNode,
            targetInput: inputPin
          };
          
          if (window.onConnectionDeleted) {
            console.log("Recording connection deletion for undo:", connectionData);
            window.onConnectionDeleted(connectionData);
          } else {
            console.error("onConnectionDeleted callback not available!");
          }
        }
      }
      
      // Call original remove method
      return originalRemove(nodeId, inputPin);
    };
    
    console.log("ConnectionManager.removeConnection() has been wrapped with undo recording");
  }
  
  console.log("=== TRACE SETUP COMPLETE ===");
  console.log("Now try deleting a node or connection - you should see trace output");
};

// Run the trace setup
window.traceDeleteActions();

// Alternative: Quick fix by directly modifying the methods
// Add this to your main.js after initialization:

window.quickFixUndo = function() {
  console.log("=== APPLYING QUICK UNDO FIX ===");
  
  // Fix SelectionManager deletion
  if (window.editor && window.editor.selection) {
    const selection = window.editor.selection;
    
    // Store original method
    const originalDeleteSelected = selection.deleteSelected ? 
      selection.deleteSelected.bind(selection) : null;
    
    // Create undo-aware replacement
    selection.deleteSelected = function() {
      const selected = this.getSelected ? Array.from(this.getSelected()) : [];
      console.log("Quick fix: deleting", selected.length, "nodes with undo support");
      
      // Record each for undo before deletion
      selected.forEach(node => {
        if (window.onNodeDeleted) {
          window.onNodeDeleted(node);
        }
      });
      
      // Perform deletion
      if (originalDeleteSelected) {
        return originalDeleteSelected();
      } else {
        // Manual deletion if no original method
        selected.forEach(node => {
          const nodeIndex = this.graph.nodes.indexOf(node);
          if (nodeIndex !== -1) {
            // Remove connections first
            this.graph.nodes.forEach(otherNode => {
              if (otherNode.inputs) {
                otherNode.inputs.forEach((input, index) => {
                  if (input === node.id) {
                    otherNode.inputs[index] = null;
                  }
                });
              }
            });
            
            // Remove node
            this.graph.nodes.splice(nodeIndex, 1);
          }
        });
        
        // Clear selection
        if (this.clear) this.clear();
        
        // Trigger updates
        if (window.editor.onChange) window.editor.onChange();
        if (window.updateShaderFromGraph) window.updateShaderFromGraph();
      }
    };
    
    console.log("SelectionManager.deleteSelected() fixed");
  }
  
  // Fix ConnectionManager removal
  if (window.editor && window.editor.connections) {
    const connections = window.editor.connections;
    
    const originalRemove = connections.removeConnection ? 
      connections.removeConnection.bind(connections) : null;
    
    connections.removeConnection = function(nodeId, inputPin) {
      console.log("Quick fix: removing connection with undo support");
      
      // Record for undo before deletion
      const targetNode = this.graph.nodes.find(n => n.id === nodeId);
      if (targetNode && targetNode.inputs && targetNode.inputs[inputPin]) {
        const sourceNodeId = targetNode.inputs[inputPin];
        const sourceNode = this.graph.nodes.find(n => n.id == sourceNodeId);
        
        if (sourceNode && window.onConnectionDeleted) {
          window.onConnectionDeleted({
            sourceNode: sourceNode,
            targetNode: targetNode,
            targetInput: inputPin
          });
        }
      }
      
      // Perform deletion
      if (originalRemove) {
        return originalRemove(nodeId, inputPin);
      } else {
        // Manual deletion
        if (targetNode && targetNode.inputs) {
          targetNode.inputs[inputPin] = null;
          if (this.onChange) this.onChange();
        }
      }
    };
    
    console.log("ConnectionManager.removeConnection() fixed");
  }
  
  console.log("=== QUICK FIX APPLIED ===");
  console.log("Now try deleting nodes/connections - undo should work!");
};

// Apply the quick fix
window.quickFixUndo();

// Test function to verify the fix works
window.testRealDeletion = function() {
  console.log("=== TESTING REAL DELETION WITH UNDO ===");
  
  // Select a node
  if (window.graph && window.graph.nodes && window.graph.nodes.length > 0) {
    const testNode = window.graph.nodes.find(n => n.kind !== 'OutputFinal');
    if (testNode && window.editor && window.editor.selection) {
      
      // Select the node
      if (window.editor.selection.clear) window.editor.selection.clear();
      if (window.editor.selection.add) window.editor.selection.add(testNode);
      
      console.log("Selected node for testing:", testNode.kind, testNode.id);
      console.log("Now calling deleteSelected() - should trigger undo recording...");
      
      // Delete using the real method
      if (window.editor.selection.deleteSelected) {
        window.editor.selection.deleteSelected();
        
        // Check undo state
        if (window.undoManager) {
          const status = window.undoManager.getStatus();
          console.log("After deletion, undo status:", status);
          
          if (status.undoCount > 0) {
            console.log("SUCCESS! Undo is now available - try Ctrl+Z");
          } else {
            console.log("FAILED! No undo recorded");
          }
        }
      }
    }
  }
};
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

// Test function to manually create a fake connection deletion

// REPLACE the testConnectionDeletion function in your main.js with this corrected version

// Fixed testConnectionDeletion function for main.js
// Replace the broken testConnectionDeletion function with this:

window.testConnectionDeletion = function() {
  console.log("Testing manual connection deletion...");
  
  const graph = window.graph;
  if (!graph || !graph.nodes || graph.nodes.length < 2) {
    console.error("Need at least 2 nodes to test connection deletion");
    return;
  }
  
  // Find a node with an input connection
  let targetNode = null;
  let inputIndex = -1;
  let sourceNodeId = null;
  
  for (const node of graph.nodes) {
    if (node.inputs && node.inputs.length > 0) {
      for (let i = 0; i < node.inputs.length; i++) {
        if (node.inputs[i] !== null && node.inputs[i] !== undefined) {
          sourceNodeId = node.inputs[i];
          targetNode = node;
          inputIndex = i;
          break;
        }
      }
      if (sourceNodeId !== null) break;
    }
  }
  
  if (sourceNodeId === null || !targetNode) {
    console.error("No connections found to test with");
    return;
  }
  
  const sourceNode = graph.nodes.find(node => node.id == sourceNodeId);
  if (!sourceNode) {
    console.error("Source node not found for ID:", sourceNodeId);
    return;
  }
  
  console.log("Found test connection:", {
    sourceId: sourceNodeId,
    sourceType: sourceNode.kind,
    targetId: targetNode.id,
    targetType: targetNode.kind,
    inputIndex: inputIndex
  });
  
  // Create proper connection data for the callback
  const connectionData = {
    sourceNode: sourceNode,
    targetNode: targetNode,
    targetInput: inputIndex
  };
  
  // Record for undo BEFORE deleting
  console.log("Recording connection for undo...");
  if (window.onConnectionDeleted) {
    window.onConnectionDeleted(connectionData);
  } else {
    console.error("onConnectionDeleted callback not available");
  }
  
  // Delete the connection
  const originalConnection = targetNode.inputs[inputIndex];
  targetNode.inputs[inputIndex] = null;
  console.log("Connection deleted (was:", originalConnection, ")");
  
  // Force UI updates
  if (window.editor && window.editor.draw) {
    window.editor.draw();
  }
  if (window.updateShaderFromGraph) {
    window.updateShaderFromGraph();
  }
  
  console.log("Test deletion complete. Try Ctrl+Z to undo!");
  
  // Show undo manager status
  if (window.undoManager) {
    console.log("UndoManager status:", window.undoManager.getStatus());
  }
};

// Fixed testNodeDeletion function
window.testNodeDeletion = function() {
  console.log("Testing manual node deletion...");
  
  const graph = window.graph;
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    console.error("No nodes found to test deletion");
    return;
  }
  
  // Find a non-critical node to delete
  let testNode = null;
  for (const node of graph.nodes) {
    if (node.kind !== 'OutputFinal' && node.kind !== 'Output') {
      testNode = node;
      break;
    }
  }
  
  if (!testNode) {
    testNode = graph.nodes[graph.nodes.length - 1];
  }
  
  console.log("Found test node:", testNode.kind, testNode.id);
  
  // Record for undo BEFORE deleting
  console.log("Recording node for undo...");
  if (window.onNodeDeleted) {
    window.onNodeDeleted(testNode);
  } else {
    console.error("onNodeDeleted callback not available");
  }
  
  // Delete the node
  const nodeIndex = graph.nodes.indexOf(testNode);
  if (nodeIndex !== -1) {
    graph.nodes.splice(nodeIndex, 1);
    console.log("Node deleted from graph at index:", nodeIndex);
  }
  
  // Remove connections to this node
  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach((input, index) => {
        if (input === testNode.id || input == testNode.id) {
          node.inputs[index] = null;
          console.log(`Removed connection from ${node.kind}[${index}]`);
        }
      });
    }
  });
  
  // Force UI updates
  if (window.editor && window.editor.draw) {
    window.editor.draw();
  }
  if (window.updateShaderFromGraph) {
    window.updateShaderFromGraph();
  }
  
  console.log("Test node deletion complete. Try Ctrl+Z to undo!");
  
  // Show undo manager status
  if (window.undoManager) {
    console.log("UndoManager status:", window.undoManager.getStatus());
  }
};
// Enhanced debugging function
window.debugUndoSystem = function() {
  console.log("=== UNDO SYSTEM DEBUG ===");
  
  // Check components
  console.log("1. Components Check:");
  console.log("   - undoManager:", !!window.undoManager);
  console.log("   - graph:", !!window.graph);
  console.log("   - editor:", !!window.editor);
  
  // Check callbacks
  console.log("2. Callbacks Check:");
  console.log("   - onConnectionDeleted:", typeof window.onConnectionDeleted);
  console.log("   - onNodeDeleted:", typeof window.onNodeDeleted);
  console.log("   - onConnectionCreated:", typeof window.onConnectionCreated);
  console.log("   - onNodeCreated:", typeof window.onNodeCreated);
  
  // Check UI elements
  console.log("3. UI Elements Check:");
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  console.log("   - Undo button:", !!undoBtn, undoBtn?.disabled);
  console.log("   - Redo button:", !!redoBtn, redoBtn?.disabled);
  
  // Check undo manager status
  if (window.undoManager) {
    console.log("4. UndoManager Status:");
    const status = window.undoManager.getStatus();
    console.log("   - Undo stack:", status.undoCount);
    console.log("   - Redo stack:", status.redoCount);
    console.log("   - Last action:", status.lastUndo?.type);
  }
  
  // Check graph state
  if (window.graph) {
    console.log("5. Graph State:");
    console.log("   - Nodes:", window.graph.nodes?.length || 0);
    
    // Show connections
    let connectionCount = 0;
    if (window.graph.nodes) {
      window.graph.nodes.forEach(node => {
        if (node.inputs) {
          node.inputs.forEach(input => {
            if (input !== null && input !== undefined) {
              connectionCount++;
            }
          });
        }
      });
    }
    console.log("   - Connections:", connectionCount);
  }
  
  console.log("========================");
  console.log("Available test functions:");
  console.log("- testConnectionDeletion()");
  console.log("- testNodeDeletion()");
  console.log("- debugUndoSystem() (this function)");
  
  return {
    undoManager: !!window.undoManager,
    callbacks: {
      connectionDeleted: typeof window.onConnectionDeleted === 'function',
      nodeDeleted: typeof window.onNodeDeleted === 'function'
    },
    ui: {
      undoButton: !!undoBtn,
      redoButton: !!redoBtn
    }
  };
};

// Manual undo/redo test functions for debugging
window.manualUndo = function() {
  console.log("=== MANUAL UNDO TEST ===");
  if (window.undoManager) {
    console.log("Before undo:", window.undoManager.getStatus());
    const result = window.undoManager.undo();
    console.log("Undo result:", result);
    console.log("After undo:", window.undoManager.getStatus());
    return result;
  } else {
    console.error("UndoManager not available");
    return false;
  }
};

window.manualRedo = function() {
  console.log("=== MANUAL REDO TEST ===");
  if (window.undoManager) {
    console.log("Before redo:", window.undoManager.getStatus());
    const result = window.undoManager.redo();
    console.log("Redo result:", result);
    console.log("After redo:", window.undoManager.getStatus());
    return result;
  } else {
    console.error("UndoManager not available");
    return false;
  }
};
  console.log("Looking for connections...");
  
  graph.nodes.forEach((node, nodeIndex) => {
    if (node.inputs && node.inputs.length > 0) {
      console.log(`Node ${nodeIndex} (${node.kind}, id: ${node.id}):`);
      node.inputs.forEach((input, inputIndex) => {
        if (input !== null && input !== undefined) {
          const sourceNode = graph.nodes.find(n => n.id == input);
          console.log(`  Input ${inputIndex}: ${input} -> ${sourceNode ? sourceNode.kind : 'NOT_FOUND'}`);
        }
      });
    }
});


console.log("Updated connection test loaded. Try 'examineConnections()' first, then 'testConnectionDeletion()'");

// Fixed test function to manually create a fake node deletion
window.testNodeDeletion = function() {
  console.log("Testing manual node deletion...");
  
  const graph = window.graph;
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    console.error("No nodes found to test deletion");
    return;
  }
  
  // Find a node that's not critical (avoid deleting output nodes)
  let testNode = null;
  for (const node of graph.nodes) {
    const nodeType = node.type || node.kind || 'unknown';
    if (nodeType !== 'output' && nodeType !== 'Output') {
      testNode = node;
      break;
    }
  }
  
  if (!testNode) {
    testNode = graph.nodes[graph.nodes.length - 1]; // Just take the last one
  }
  
  const nodeType = testNode.type || testNode.kind || 'unknown';
  console.log("Found test node:", nodeType, testNode.id);
  
  // Record the node for undo BEFORE deleting it
  if (window.onNodeDeleted) {
    window.onNodeDeleted(testNode);
    console.log("Node recorded for undo");
  }
  
  // Delete the node (simplified version)
  const nodeIndex = graph.nodes.indexOf(testNode);
  if (nodeIndex !== -1) {
    graph.nodes.splice(nodeIndex, 1);
    console.log("Node deleted from graph");
  }
  
  // Remove connections to this node
  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach((input, index) => {
        if (input && (input.sourceNode === testNode || input.from === testNode || input.node === testNode)) {
          node.inputs[index] = null;
        }
      });
    }
  });
  
  // Trigger UI update
  if (window.editor && window.editor.draw) {
    window.editor.draw();
  }
  if (window.updateShaderFromGraph) {
    window.updateShaderFromGraph();
  }
  
  console.log("Test node deletion complete. Try pressing Ctrl+Z or click Undo button!");
};

// Debug function to examine your node and connection structure
window.debugNodeStructure = function() {
  console.log("DEBUGGING NODE STRUCTURE");
  console.log("========================");
  
  const graph = window.graph;
  if (!graph || !graph.nodes) {
    console.error("No graph or nodes found");
    return;
  }
  
  console.log("Total nodes:", graph.nodes.length);
  
  // Show first few nodes
  const sampleNodes = graph.nodes.slice(0, 3);
  sampleNodes.forEach((node, index) => {
    console.log(`Node ${index}:`, {
      id: node.id,
      type: node.type,
      kind: node.kind,
      inputs: node.inputs ? node.inputs.length : 'none',
      hasInputs: !!node.inputs
    });
    
    if (node.inputs && node.inputs.length > 0) {
      node.inputs.forEach((input, inputIndex) => {
        if (input) {
          console.log(`  Input ${inputIndex}:`, {
            sourceNode: input.sourceNode ? (input.sourceNode.type || input.sourceNode.kind || input.sourceNode.id) : 'missing',
            sourceOutput: input.sourceOutput,
            structure: Object.keys(input)
          });
        }
      });
    }
  });
  
  // Find nodes with connections
  const connectedNodes = graph.nodes.filter(node => 
    node.inputs && node.inputs.some(input => input !== null)
  );
  
  console.log("Nodes with connections:", connectedNodes.length);
  
  if (connectedNodes.length > 0) {
    const firstConnected = connectedNodes[0];
    const firstInput = firstConnected.inputs.find(input => input !== null);
    console.log("Sample connection structure:", firstInput);
  }
};

console.log("Fixed test functions loaded. Run 'debugNodeStructure()' first to understand your node structure.");

// Add this debug function to your main.js to check connection restoration

window.debugConnectionAfterUndo = function() {
  console.log("DEBUGGING CONNECTION AFTER UNDO");
  console.log("================================");
  
  const graph = window.graph;
  if (!graph || !graph.nodes) {
    console.error("No graph found");
    return;
  }
  
  // Look for the specific nodes mentioned in the undo log
  const sourceNode = graph.nodes.find(n => n.id == '6');
  const targetNode = graph.nodes.find(n => n.id == '5');
  
  console.log("Source node (id: 6):", sourceNode ? {
    id: sourceNode.id,
    kind: sourceNode.kind,
    exists: true
  } : "NOT_FOUND");
  
  console.log("Target node (id: 5):", targetNode ? {
    id: targetNode.id,
    kind: targetNode.kind,
    inputs: targetNode.inputs,
    inputAtIndex0: targetNode.inputs ? targetNode.inputs[0] : "NO_INPUTS"
  } : "NOT_FOUND");
  
  // Check all current connections
  console.log("\nAll current connections:");
  graph.nodes.forEach(node => {
    if (node.inputs && node.inputs.length > 0) {
      node.inputs.forEach((input, index) => {
        if (input !== null && input !== undefined) {
          console.log(`  ${node.kind}(${node.id}).input[${index}] = ${input}`);
        }
      });
    }
  });
  
  // Force a manual draw to see if that helps
  console.log("\nForcing manual redraw...");
  if (window.editor && window.editor.draw) {
    window.editor.draw();
  }
  
  // Force shader update
  if (window.updateShaderFromGraph) {
    console.log("Forcing shader update...");
    window.updateShaderFromGraph();
  }
};

// Also add a function to manually test wire drawing
window.testWireDrawing = function() {
  console.log("TESTING WIRE DRAWING");
  console.log("====================");
  
  const graph = window.graph;
  
  // Find two unconnected nodes and manually connect them
  const unconnectedNodes = graph.nodes.filter(node => 
    !node.inputs || node.inputs.every(input => input === null || input === undefined)
  );
  
  if (unconnectedNodes.length < 2) {
    console.log("Not enough unconnected nodes for test");
    return;
  }
  
  const targetNode = unconnectedNodes[0];
  const sourceNode = graph.nodes.find(n => n.id !== targetNode.id);
  
  console.log(`Manually connecting ${sourceNode.kind}(${sourceNode.id}) -> ${targetNode.kind}(${targetNode.id})`);
  
  // Ensure inputs array exists
  if (!targetNode.inputs) {
    targetNode.inputs = [];
  }
  
  // Make sure array is long enough
  while (targetNode.inputs.length === 0) {
    targetNode.inputs.push(null);
  }
  
  // Create connection
  targetNode.inputs[0] = sourceNode.id;
  
  console.log("Connection created:", targetNode.inputs[0]);
  
  // Force redraw
  if (window.editor && window.editor.draw) {
    window.editor.draw();
  }
  
  console.log("Check if wire is visible now!");
};
// Add this function to force a complete refresh of the editor

window.forceCompleteRefresh = function() {
  console.log("FORCING COMPLETE REFRESH");
  console.log("=========================");
  
  // Clear any node caches
  if (window.graph && window.graph.nodes) {
    window.graph.nodes.forEach(node => {
      // Clear common cache properties
      delete node.cachedValue;
      delete node.cached;
      delete node.__thumb;
      node.needsUpdate = true;
    });
  }
  
  // Force editor redraw
  if (window.editor) {
    if (window.editor.draw) {
      console.log("Calling editor.draw()");
      window.editor.draw();
    }
    
    // Try to invalidate any renderer caches
    if (window.editor.renderer) {
      console.log("Refreshing renderer");
      if (window.editor.renderer.invalidate) {
        window.editor.renderer.invalidate();
      }
    }
    
    // Force preview updates
    if (window.editor.nodePreviews) {
      console.log("Refreshing node previews");
      window.editor.nodePreviews.forEach((preview, nodeId) => {
        preview.needsUpdate = true;
      });
    }
  }
  
  // Force shader update
  if (window.updateShaderFromGraph) {
    console.log("Forcing shader update");
    window.updateShaderFromGraph();
  }
  
  // Force canvas refresh
  const canvas = document.getElementById("ui-canvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      console.log("Clearing canvas");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  
  // Force another draw after clearing
  setTimeout(() => {
    if (window.editor && window.editor.draw) {
      console.log("Second draw call");
      window.editor.draw();
    }
  }, 10);
  
  console.log("Refresh complete - check if wires are now visible!");
};

// Also let's update the UndoManager to force a more aggressive refresh
window.enhanceUndoRefresh = function() {
  if (window.undoManager) {
    // Store original undo method
    const originalUndo = window.undoManager.undo.bind(window.undoManager);
    
    // Replace with enhanced version
    window.undoManager.undo = function() {
      const result = originalUndo();
      
      if (result) {
        console.log("Enhanced refresh after undo...");
        
        // Force complete refresh
        setTimeout(() => {
          window.forceCompleteRefresh();
        }, 50);
      }
      
      return result;
    };
    
    console.log("Enhanced undo refresh installed");
  }
};

console.log("Force refresh functions loaded:");
console.log("- forceCompleteRefresh() - Force complete editor refresh");
console.log("- enhanceUndoRefresh() - Make undo do aggressive refresh");
console.log("Debug functions loaded:");
console.log("- debugConnectionAfterUndo() - Check connection after undo");
console.log("- testWireDrawing() - Test manual wire creation");
// Test function to manually create a fake node deletion
window.testNodeDeletion = function() {
  console.log("Testing manual node deletion...");
  
  const graph = window.graph;
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    console.error("No nodes found to test deletion");
    return;
  }
  
  // Find a node that's not critical (avoid deleting output nodes)
  let testNode = null;
  for (const node of graph.nodes) {
    if (node.type !== 'output' && node.type !== 'Output') {
      testNode = node;
      break;
    }
  }
  
  if (!testNode) {
    testNode = graph.nodes[graph.nodes.length - 1]; // Just take the last one
  }
  
  console.log("Found test node:", testNode.type, testNode.id);
  
  // Record the node for undo BEFORE deleting it
  if (window.onNodeDeleted) {
    window.onNodeDeleted(testNode);
    console.log("Node recorded for undo");
  }
  
  // Delete the node (simplified version)
  const nodeIndex = graph.nodes.indexOf(testNode);
  if (nodeIndex !== -1) {
    graph.nodes.splice(nodeIndex, 1);
    console.log("Node deleted from graph");
  }
  
  // Remove connections to this node
  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach((input, index) => {
        if (input && input.sourceNode === testNode) {
          node.inputs[index] = null;
        }
      });
    }
  });
  
  // Trigger UI update
  if (window.editor && window.editor.draw) {
    window.editor.draw();
  }
  if (window.updateShaderFromGraph) {
    window.updateShaderFromGraph();
  }
  
  console.log("Test node deletion complete. Try pressing Ctrl+Z or click Undo button!");
};

// Comprehensive test function
window.testUndoSystem = function() {
  console.log("COMPREHENSIVE UNDO SYSTEM TEST");
  console.log("================================");
  
  // Check HTML elements
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  console.log("1. HTML Elements:");
  console.log("   Undo button:", undoBtn ? "Found" : "Missing");
  console.log("   Redo button:", redoBtn ? "Found" : "Missing");
  
  // Check UndoManager
  console.log("2. UndoManager:");
  console.log("   window.undoManager:", window.undoManager ? "Found" : "Missing");
  if (window.undoManager) {
    try {
      const status = window.undoManager.getStatus();
      console.log("   Status:", status);
    } catch (e) {
      console.log("   Error getting status:", e.message);
    }
  }
  
  // Check callback functions
  console.log("3. Callback Functions:");
  console.log("   onConnectionDeleted:", window.onConnectionDeleted ? "Found" : "Missing");
  console.log("   onNodeDeleted:", window.onNodeDeleted ? "Found" : "Missing");
  
  // Check graph
  console.log("4. Graph:");
  console.log("   window.graph:", window.graph ? "Found" : "Missing");
  if (window.graph) {
    console.log("   Nodes count:", window.graph.nodes ? window.graph.nodes.length : "No nodes array");
  }
  
  // Check editor
  console.log("5. Editor:");
  console.log("   window.editor:", window.editor ? "Found" : "Missing");
  
  console.log("================================");
  console.log("Test functions available:");
  console.log("   testConnectionDeletion() - Test connection undo");
  console.log("   testNodeDeletion() - Test node undo");
  console.log("   testUndo() - Basic system check");
  
  return {
    htmlElements: { undo: !!undoBtn, redo: !!redoBtn },
    undoManager: !!window.undoManager,
    callbacks: { 
      connection: !!window.onConnectionDeleted, 
      node: !!window.onNodeDeleted 
    },
    graph: !!window.graph,
    editor: !!window.editor
  };
};

console.log("Undo test functions loaded. Run 'testUndoSystem()' in console to debug.");

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}