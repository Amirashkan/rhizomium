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
import { getAudioSettingsPanel } from './src/ui/AudioSettingsPanel.js';
import { TimelineManager } from './src/core/TimelineManager.js';
import { TimelinePanel } from './src/ui/TimelinePanel.js';
import { VJControlPanel } from './src/vj/VJControlPanel.js';

// Verify timeline imports loaded
console.log('[IMPORT CHECK] TimelineManager:', typeof TimelineManager);
console.log('[IMPORT CHECK] TimelinePanel:', typeof TimelinePanel);

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
let timelineManager = null;
let timelinePanel = null;
let vjControlPanel = null;

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

    // Create timeline manager and panel
    try {
      console.log("Creating TimelineManager...");
      timelineManager = new TimelineManager(editor);
      editor.timelineManager = timelineManager;
      window.timelineManager = timelineManager;
      console.log("TimelineManager created:", timelineManager);

      console.log("Creating TimelinePanel...");
      timelinePanel = new TimelinePanel(editor);
      window.timelinePanel = timelinePanel;
      console.log("TimelinePanel created:", timelinePanel);
    } catch (error) {
      console.error("ERROR creating timeline components:", error);
      console.error("Error stack:", error.stack);
    }

    // Create VJ Control Panel
    try {
      console.log("Creating VJControlPanel...");
      vjControlPanel = new VJControlPanel(editor);
      window.vjControlPanel = vjControlPanel;
      console.log("VJControlPanel created:", vjControlPanel);
    } catch (error) {
      console.error("ERROR creating VJ control panel:", error);
      console.error("Error stack:", error.stack);
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

  // HUD collapse toggle
  const hud = document.getElementById("hud");
  const hudToggle = removeExistingHandlers("btn-toggle-hud");
  const HUD_STORAGE_KEY = "hudCollapsed";

  const setHudCollapsed = (collapsed, notify = false) => {
    if (!hud) return;

    hud.classList.toggle("collapsed", collapsed);

    if (hudToggle) {
      hudToggle.setAttribute("aria-expanded", (!collapsed).toString());
      hudToggle.textContent = collapsed ? "Show Menu" : "Hide Menu";
    }

    if (notify && typeof updateStatus === "function") {
      updateStatus(collapsed ? "Menu hidden" : "Menu shown");
    }

    try {
      window.localStorage?.setItem(HUD_STORAGE_KEY, collapsed ? "true" : "false");
    } catch (error) {
      console.warn("Unable to persist HUD state:", error);
    }
  };

  let initialHudState = false;
  try {
    const stored = window.localStorage?.getItem(HUD_STORAGE_KEY);
    initialHudState = stored === "true";
  } catch (error) {
    console.warn("Unable to read HUD state:", error);
  }

  if (hud) {
    setHudCollapsed(initialHudState);
  }

  if (hudToggle) {
    hudToggle.addEventListener("click", () => {
      if (!hud) return;
      const nextState = !hud.classList.contains("collapsed");
      setHudCollapsed(nextState, true);
    });
  }

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

  const snapToggle = removeExistingHandlers("snap-toggle");
  const snapSizeInput = removeExistingHandlers("snap-size");

  const ensureSnapCss = (size) => {
    if (!document?.documentElement?.style) return;
    const finalSize = Number.isFinite(size) && size > 0 ? size : 20;
    document.documentElement.style.setProperty(
      "--snap-grid-size",
      `${finalSize}px`,
    );
  };

  const getEditorSnapSize = () => {
    if (typeof editor?.getSnapGridSize === "function") {
      const value = editor.getSnapGridSize();
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return 20;
  };

  let currentSnapSize = getEditorSnapSize();
  ensureSnapCss(currentSnapSize);

  if (snapSizeInput) {
    snapSizeInput.min = "2";
    snapSizeInput.max = "512";
    snapSizeInput.step = "1";
    snapSizeInput.value = currentSnapSize;
  }

  const applySnapSize = (rawValue) => {
    const parsed = Math.round(Number(rawValue));
    const fallbackSize = Number.isFinite(currentSnapSize) && currentSnapSize > 0
      ? currentSnapSize
      : 20;

    const sanitized = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSize;
    const clamped = Math.max(2, Math.min(512, sanitized));

    let appliedSize = clamped;
    if (typeof editor?.setSnapGridSize === "function") {
      appliedSize = editor.setSnapGridSize(clamped);
    }

    currentSnapSize = Number.isFinite(appliedSize) && appliedSize > 0
      ? appliedSize
      : clamped;

    ensureSnapCss(currentSnapSize);
    if (snapSizeInput) {
      snapSizeInput.value = currentSnapSize;
    }

    console.log(`Snap grid size set to ${currentSnapSize}px`);
    return currentSnapSize;
  };

  const syncSnapInputState = (enabled) => {
    if (!snapSizeInput) return;
    snapSizeInput.disabled = !enabled;
  };

  const initialSnapEnabled =
    (typeof editor?.isSnapEnabled === "function" && editor.isSnapEnabled()) ||
    false;

  if (typeof editor?.setSnapEnabled === "function") {
    editor.setSnapEnabled(initialSnapEnabled);
  }

  if (snapToggle) {
    snapToggle.checked = initialSnapEnabled;
    snapToggle.addEventListener("change", (e) => {
      const enabled = !!e.target.checked;
      if (typeof editor?.setSnapEnabled === "function") {
        editor.setSnapEnabled(enabled);
      }
      syncSnapInputState(enabled);
      if (enabled) {
        applySnapSize(snapSizeInput?.value ?? currentSnapSize);
      }
    });

    console.log(
      `Snap toggle handler attached (initial state: ${initialSnapEnabled})`,
    );
  } else {
    console.warn("Snap toggle checkbox not found in DOM");
  }

  if (snapSizeInput) {
    syncSnapInputState(initialSnapEnabled);
    snapSizeInput.addEventListener("change", (e) =>
      applySnapSize(e.target.value),
    );
    snapSizeInput.addEventListener("blur", (e) =>
      applySnapSize(e.target.value),
    );
    snapSizeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applySnapSize(snapSizeInput.value);
      }
    });
    console.log("Snap size input handler attached");
  } else {
    console.warn("Snap size input not found in DOM");
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

  // Code console helpers
  const consoleContainer = document.getElementById("code-console");
  let consoleVisible = !consoleContainer?.classList?.contains("closed");

  const toggleConsoleBtn = removeExistingHandlers("btn-toggle-console");
  const closeConsoleBtn = removeExistingHandlers("btn-close-console");

  const setConsoleVisibility = (visible, notify = true) => {
    if (!consoleContainer) return;
    consoleVisible = visible;
    consoleContainer.classList.toggle("closed", !visible);
    if (toggleConsoleBtn) {
      toggleConsoleBtn.textContent = visible ? "Hide Console" : "Show Console";
    }
    if (notify && typeof updateStatus === "function") {
      updateStatus(visible ? "Console shown" : "Console hidden");
    }
  };

  if (toggleConsoleBtn) {
    toggleConsoleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setConsoleVisibility(!consoleVisible);
    });
    console.log("Console toggle handler attached");
  }

  if (closeConsoleBtn) {
    closeConsoleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setConsoleVisibility(false);
    });
    console.log("Console close handler attached");
  }

  // Audio Settings Panel - with robust error handling
  const audioSettingsBtn = removeExistingHandlers("btn-audio-settings");
  console.log('[main.js] Setting up audio settings button, element found:', !!audioSettingsBtn);

  if (audioSettingsBtn) {
    audioSettingsBtn.addEventListener("click", (e) => {
      console.log('[main.js] Audio settings button clicked!');
      e.preventDefault();

      try {
        const audioPanel = getAudioSettingsPanel();
        console.log('[main.js] Audio panel instance:', audioPanel);

        if (audioPanel && typeof audioPanel.toggle === 'function') {
          audioPanel.toggle();
          if (typeof updateStatus === "function") {
            updateStatus(audioPanel.visible ? "Audio settings opened" : "Audio settings closed");
          }
        } else {
          console.error('[main.js] Audio panel is invalid:', audioPanel);
          if (typeof updateStatus === "function") {
            updateStatus("Audio settings panel failed to load", "error");
          }
        }
      } catch (error) {
        console.error('[main.js] Error opening audio settings:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Error opening audio settings: " + error.message, "error");
        }
      }
    });
    console.log("Audio settings handler attached");
  } else {
    console.error('[main.js] Audio settings button NOT found in DOM! Available buttons:',
      Array.from(document.querySelectorAll('button')).map(b => b.id).filter(Boolean));
  }

  // Timeline Panel
  const timelineBtn = removeExistingHandlers("btn-toggle-timeline");
  console.log('[main.js] Setting up timeline button, element found:', !!timelineBtn);

  if (timelineBtn) {
    timelineBtn.addEventListener("click", (e) => {
      console.log('[main.js] Timeline button clicked!');
      e.preventDefault();

      try {
        if (timelinePanel && typeof timelinePanel.toggle === 'function') {
          timelinePanel.toggle();
          if (typeof updateStatus === "function") {
            updateStatus(timelinePanel.visible ? "Timeline opened" : "Timeline closed");
          }
        } else {
          console.error('[main.js] Timeline panel is invalid:', timelinePanel);
          if (typeof updateStatus === "function") {
            updateStatus("Timeline panel failed to load", "error");
          }
        }
      } catch (error) {
        console.error('[main.js] Error toggling timeline:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Error toggling timeline: " + error.message, "error");
        }
      }
    });
    console.log("Timeline handler attached");
  } else {
    console.error('[main.js] Timeline button NOT found in DOM!');
  }

  // VJ Control Panel
  const vjBtn = removeExistingHandlers("btn-toggle-vj");
  console.log('[main.js] Setting up VJ control button, element found:', !!vjBtn);

  if (vjBtn) {
    vjBtn.addEventListener("click", (e) => {
      console.log('[main.js] VJ control button clicked!');
      e.preventDefault();

      try {
        if (vjControlPanel && typeof vjControlPanel.toggle === 'function') {
          vjControlPanel.toggle();
          if (typeof updateStatus === "function") {
            updateStatus(vjControlPanel.visible ? "VJ Control opened" : "VJ Control closed");
          }
        } else {
          console.error('[main.js] VJ control panel is invalid:', vjControlPanel);
          if (typeof updateStatus === "function") {
            updateStatus("VJ Control panel failed to load", "error");
          }
        }
      } catch (error) {
        console.error('[main.js] Error toggling VJ control:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Error toggling VJ Control: " + error.message, "error");
        }
      }
    });
    console.log("VJ Control handler attached");
  } else {
    console.error('[main.js] VJ Control button NOT found in DOM!');
  }

  const selectCodeBtn = removeExistingHandlers("btn-select-code");
  if (selectCodeBtn) {
    selectCodeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const codeEl = document.getElementById("code");
      if (!codeEl) {
        console.warn("Code console element not found");
        return;
      }

      const selection = window.getSelection();
      if (!selection) return;

      const range = document.createRange();
      range.selectNodeContents(codeEl);
      selection.removeAllRanges();
      selection.addRange(range);
      codeEl.focus();

      if (typeof updateStatus === "function") {
        updateStatus("WGSL selected");
      }
    });
    console.log("Select-all handler attached");
  }

  const copyCodeBtn = removeExistingHandlers("btn-copy-code");
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const codeEl = document.getElementById("code");
      const text =
        window.latestGeneratedWGSLClean ||
        window.latestGeneratedWGSL ||
        codeEl?.textContent ||
        "";

      if (!text) {
        console.warn("No WGSL code available to copy");
        if (typeof updateStatus === "function") {
          updateStatus("No WGSL to copy", "error");
        }
        return;
      }

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const temp = document.createElement("textarea");
          temp.value = text;
          temp.setAttribute("readonly", "");
          temp.style.position = "absolute";
          temp.style.left = "-9999px";
          document.body.appendChild(temp);
          temp.select();
          document.execCommand("copy");
          document.body.removeChild(temp);
        }

        if (typeof updateStatus === "function") {
          updateStatus("WGSL copied to clipboard");
        }
      } catch (err) {
        console.error("Failed to copy WGSL:", err);
        if (typeof updateStatus === "function") {
          updateStatus("Copy failed", "error");
        }
      }
    });
    console.log("Copy handler attached");
  }
  setConsoleVisibility(consoleVisible, false);

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
      let step = e.shiftKey ? 10 : 1;
      if (
        typeof editor?.isSnapEnabled === "function" &&
        editor.isSnapEnabled()
      ) {
        const gridSize =
          typeof editor?.getSnapGridSize === "function"
            ? editor.getSnapGridSize()
            : 20;
        if (Number.isFinite(gridSize) && gridSize > 0) {
          step = gridSize * (e.shiftKey ? 5 : 1);
        }
      }
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

      case "v":
        e.preventDefault();
        if (vjControlPanel && typeof vjControlPanel.toggle === 'function') {
          vjControlPanel.toggle();
          updateStatus(vjControlPanel.visible ? "VJ Control opened" : "VJ Control closed");
        } else {
          updateStatus("VJ Control panel unavailable", "warning");
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
      console.log("Empty graph - skipping shader update");
      return;
    }

    const outputNode = graph.nodes.find(
      (node) => node && /OutputFinal/i.test(node.kind || node.type || node.name || "")
    );

    if (!outputNode) {
      console.log("No output node found - skipping shader update");
      return;
    }

    const hasConnection =
      Array.isArray(outputNode.inputs) &&
      outputNode.inputs[0] !== null &&
      outputNode.inputs[0] !== undefined;

    if (!hasConnection) {
      console.log("Output node not connected - skipping shader update");
      return;
    }

    console.log("Graph valid - compiling shader");

    const result = buildWGSL(window.editor.graph);
    if (!result || !result.wgsl) {
      console.error("Shader compilation produced no code");
      return;
    }

    const rawWGSL = typeof result.wgsl === "string" ? result.wgsl : String(result.wgsl ?? "");
    const sanitizedWGSL = rawWGSL.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
    const shaderLength = sanitizedWGSL.length;
    window.latestGeneratedWGSL = rawWGSL;
    window.latestGeneratedWGSLClean = sanitizedWGSL;

    const codeElement = document.getElementById("code");
    if (codeElement) {
      codeElement.textContent = sanitizedWGSL;
      codeElement.scrollTop = codeElement.scrollHeight;
    }

    if (window.gpuRenderer) {
      window.gpuRenderer.setShaderSource(rawWGSL, {
        hasTextures: !!result.usesTextures,
        hasUniforms: !!result.usesUniforms,
      });
      console.log(`Shader updated successfully (${shaderLength} chars)`);
      lastUniformUpdate = performance.now();
      if (typeof updateStatus === "function") {
        updateStatus("Shader compiled");
      }
    } else {
      console.warn("GPU renderer not initialized");
    }
  } catch (error) {
    console.error("Error in updateShaderFromGraph:", error);

    if (window.errorHandler && typeof window.errorHandler.handleError === "function") {
      window.errorHandler.handleError(error, {
        component: "shader-update",
        type: "compilation-error",
      });
    }

    if (typeof updateStatus === "function") {
      updateStatus("Shader compilation failed", "error");
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
  // Update timeline manager
  if (timelineManager && timelineManager.isEnabled()) {
    timelineManager.update(frameState.deltaTime);
  }

  // Update timeline panel visualization
  if (timelinePanel) {
    timelinePanel.update();
  }

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
