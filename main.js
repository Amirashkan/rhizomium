// main.js - Complete version with Undo System and Event System
import { GPURenderer } from "./src/gpu/gpuRenderer.js";
import { RenderLoop } from "./src/core/RenderLoop.js";
import { buildWGSL } from "./src/codegen/glslBuilder.js";
import { Editor } from "./src/core/Editor.js";
import { SaveLoadManager } from "./src/core/SaveLoadManager.js";
import { BackupDialog } from "./src/ui/BackupDialog.js";
import { WelcomeWindow } from "./src/ui/WelcomeWindow.js";
import { Graph } from "./src/data/Graph.js";
import { makeNode, NodeDefs, updateNodeIdCounter } from "./src/data/NodeDefs.js";
import { SeedGraphBuilder } from "./src/utils/SeedGraphBuilder.js";
import { FloatingGPUPreview } from "./src/ui/FloatingGPUPreview.js";
import { TextureManager } from "./src/core/TextureManager.js";
import { UndoManager } from "./src/core/UndoManager.js";
import { ParameterEventSystem } from "./src/utils/ParameterEventSystem.js";
import { ErrorHandler } from './src/core/ErrorHandler.js';
import { getAudioSettingsPanel } from './src/ui/AudioSettingsPanel.js';
import { MIDIManager } from './src/midi/MIDIManager.js';
import { MIDIParameterBinding } from './src/midi/MIDIParameterBinding.js';
import { getMIDISettingsPanel } from './src/ui/MIDISettingsPanel.js';
import { FrameStreamClient } from './src/framestream/FrameStreamClient.js';
import { BroadcastFrameStream } from './src/framestream/BroadcastFrameStream.js';
import { LiveShaderStream } from './src/framestream/LiveShaderStream.js';
import { TimelineManager } from './src/core/TimelineManager.js';
import { TimelinePanel } from './src/ui/TimelinePanel.js';
import { VJControlPanel } from './src/vj/VJControlPanel.js';
import { ComputeShaderTest } from './src/test/ComputeShaderTest.js';
import { ComputeExecutor } from './src/gpu/ComputeExecutor.js';
import { ComputeProfiler } from './src/gpu/ComputeProfiler.js';
import { ComputeProfilerOverlay } from './src/ui/ComputeProfilerOverlay.js';
import { GPUPerformanceMonitor } from './src/utils/GPUPerformanceMonitor.js';
import { globalResourceRegistry } from './src/gpu/ResourceTracker.js';
import { SystemIntegration } from './src/core/SystemIntegration.js';
import { FieldMapperIntegration } from './src/core/FieldMapperIntegration.js';
import { Viewport3D } from './src/scene/Viewport3D.js';
import { ViewportPanel } from './src/ui/ViewportPanel.js';
import { SceneRenderer3D } from './src/scene/SceneRenderer3D.js';
import { FieldVisualizerManager } from './src/scene/FieldVisualizerManager.js';
import { addTestCubeToScene } from './src/scene/helpers/createTestCube.js';
import { test3DVisualization } from './test-3d-viewport.js';
import { showTestCube } from './show-test-cube.js';
import { Vec3 } from './src/scene/math/Vec3.js';

// Verify timeline imports loaded

window.makeNode = makeNode;
window.NodeDefs = NodeDefs;
window.updateNodeIdCounter = updateNodeIdCounter;

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
      return false;
    }
  });
}

async function reinitializeWebGPUAfterLoad() {
  const allCanvases = document.querySelectorAll("#gpu-canvas");

  if (allCanvases.length > 1) {
    for (let i = 1; i < allCanvases.length; i++) {
      allCanvases[i].remove();
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
    __deviceReady = false;

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
window.gpuRenderer = new GPURenderer(device, canvas);

    if (device) {
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);
      __deviceReady = true;

      // Re-set WebGPU device for WGSL editor after reinitialization
      if (editor?.paramPanel && typeof editor.paramPanel.setDevice === 'function' && window.gpuRenderer?.device) {
        editor.paramPanel.setDevice(window.gpuRenderer.device);
      }

      // Reinitialize profiler if it exists
      if (computeProfiler) {
        computeProfiler.destroy();
      }
      computeProfiler = new ComputeProfiler(device);
      window.computeProfiler = computeProfiler;

      // Recreate profiler overlay
      profilerOverlay = new ComputeProfilerOverlay();
      window.profilerOverlay = profilerOverlay;

      // Set profiler on renderer
      if (window.gpuRenderer) {
        window.gpuRenderer.profiler = computeProfiler;
      }

      // Enable profiler
      computeProfiler.setEnabled(true);

      // Reinitialize GPU Performance Monitor
      gpuPerformanceMonitor = new GPUPerformanceMonitor({
        autoShowOverlay: true,
        enableWarnings: true,
        fpsWarningThreshold: 30,
        frameTimeWarningThreshold: 33.33
      });
      gpuPerformanceMonitor.initialize(device);
      window.gpuPerformanceMonitor = gpuPerformanceMonitor;
    }

    if (device) {
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
let welcomeWindow = null;
let undoManager = null;
let parameterEventSystem = null;
let __deviceReady = false;
let floatingPreview = null;
let renderLoopController = null;
let timelineManager = null;
let timelinePanel = null;
let vjControlPanel = null;
let computeShaderTest = null;
let computeExecutor = null;
let computeProfiler = null;
let profilerOverlay = null;
let gpuPerformanceMonitor = null;
let systemIntegration = null;
let viewport3D = null;
let viewportPanel = null;
let sceneRenderer3D = null;
let fieldVisualizerManager = null;
let fieldMapperIntegration = null;

// Frame streaming client for dual-screen support
let frameStreamClient = null;
let broadcastFrameStream = null;
let liveShaderStream = null;
let frameStreamingEnabled = false;

// Detect deployment environment
const isVercelOrCloud = window.location.hostname.includes('vercel.app') ||
                        window.location.hostname.includes('netlify.app') ||
                        window.location.hostname.includes('github.io');

if (typeof window.render !== "function") {
  window.render = () => {};
}

async function initialize() {
  const errorHandler = new ErrorHandler();
  window.errorHandler = errorHandler;

  const canvas =
    document.getElementById("gpu-canvas") || document.querySelector("canvas");
  if (canvas) {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    const device = await adapter.requestDevice();
    window.gpuRenderer = new GPURenderer(device, canvas);

    // Set up window resize handler to prevent tearing from mid-render resizing
    let resizeTimeout;
    window.addEventListener('resize', () => {
      // Debounce resize to avoid excessive calls
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (window.gpuRenderer) {
          window.gpuRenderer.resizeCanvas();
        }
      }, 100);
    });

    // Initial canvas size
    if (window.gpuRenderer) {
      window.gpuRenderer.resizeCanvas();
    }

    if (device) {
      const { TextureManager } = await import("./src/core/TextureManager.js");
      window.textureManager = new TextureManager();
      await window.textureManager.initialize(device);

      // Initialize compute shader test
      try {
        computeShaderTest = new ComputeShaderTest(device, canvas);
        window.computeShaderTest = computeShaderTest;
      } catch (error) {
        console.error("Failed to create ComputeShaderTest:", error);
      }

      // Initialize compute executor for compute shader nodes
      try {
        computeExecutor = new ComputeExecutor(device);
        window.computeExecutor = computeExecutor;
      } catch (error) {
        console.error("Failed to create ComputeExecutor:", error);
      }

      // Initialize global resource tracker registry
      try {
        window.globalResourceRegistry = globalResourceRegistry;
      } catch (error) {
        console.error("Failed to initialize global resource registry:", error);
      }

      // Initialize compute profiler
      try {
        computeProfiler = new ComputeProfiler(device);
        window.computeProfiler = computeProfiler;

        // Set profiler on renderer and executor
        if (window.gpuRenderer) {
          window.gpuRenderer.profiler = computeProfiler;
        }
        if (computeExecutor) {
          computeExecutor.setProfiler(computeProfiler);
        }

        // Create profiler overlay
        profilerOverlay = new ComputeProfilerOverlay();
        window.profilerOverlay = profilerOverlay;

        // Enable profiler by default
        computeProfiler.setEnabled(true);

        // Initialize GPU Performance Monitor
        gpuPerformanceMonitor = new GPUPerformanceMonitor({
          autoShowOverlay: true, // Show overlay on startup
          enableWarnings: true,
          fpsWarningThreshold: 30,
          frameTimeWarningThreshold: 33.33
        });
        gpuPerformanceMonitor.initialize(device);
        window.gpuPerformanceMonitor = gpuPerformanceMonitor;
      } catch (error) {
        console.error("Failed to initialize ComputeProfiler:", error);
      }

      // Initialize SystemIntegration
      try {
        systemIntegration = new SystemIntegration({
          enableAutoValidation: true,
          enableTypePropagation: true,
          enableAutoExecution: false
        });

        // Connect ComputeExecutor to SystemIntegration
        if (computeExecutor) {
          systemIntegration.setComputeExecutor(computeExecutor);
        }

        window.systemIntegration = systemIntegration;
      } catch (error) {
        console.error("Failed to initialize SystemIntegration:", error);
      }

      // Initialize 3D Viewport
      try {
        // Create a separate canvas for 3D viewport
        const viewport3DCanvas = document.createElement('canvas');
        viewport3DCanvas.id = 'viewport3d-canvas';
        viewport3DCanvas.width = 400;
        viewport3DCanvas.height = 400;

        viewport3D = new Viewport3D(viewport3DCanvas, {
          cameraType: 'perspective',
          fov: 60,
          near: 0.1,
          far: 1000,
          initialPosition: {
            target: new Vec3(0, 0, 0),
            distance: 5,
            azimuth: Math.PI / 4,  // 45 degrees in radians
            elevation: Math.PI / 6  // 30 degrees in radians
          }
        });

        window.viewport3D = viewport3D;

        // Create ViewportPanel
        if (systemIntegration && systemIntegration.scene) {
          viewportPanel = new ViewportPanel(viewport3D, systemIntegration.scene);
          viewportPanel.setCanvas(viewport3DCanvas);
          window.viewportPanel = viewportPanel;
        }

        // Create SceneRenderer3D
        if (systemIntegration && systemIntegration.scene) {
          sceneRenderer3D = new SceneRenderer3D(
            device,
            viewport3DCanvas,
            systemIntegration.scene,
            viewport3D,
            computeExecutor
          );
          await sceneRenderer3D.initialize();
          window.sceneRenderer3D = sceneRenderer3D;
        }

        // Initialize FieldVisualizerManager
        if (device) {
          fieldVisualizerManager = new FieldVisualizerManager(device);
          window.fieldVisualizerManager = fieldVisualizerManager;
        }

        // Initialize FieldMapperIntegration
        if (systemIntegration && systemIntegration.scene && computeExecutor && sceneRenderer3D && viewportPanel) {
          fieldMapperIntegration = new FieldMapperIntegration(
            device,
            systemIntegration.scene,
            computeExecutor,
            sceneRenderer3D,
            viewportPanel
          );
          window.fieldMapperIntegration = fieldMapperIntegration;
        }

        // Expose test functions and helpers globally
        window.test3DVisualization = test3DVisualization;
        window.showTestCube = showTestCube;
        window.addTestCubeToScene = addTestCubeToScene;
      } catch (error) {
        console.error("Failed to initialize 3D viewport:", error);
      }
    }

    __deviceReady = !!device;
  }

  setupGlobalDragPrevention();

  try {
    if (typeof window.mountPill === "undefined") {
      window.mountPill = () => {};
    }

    const existingPill = document.getElementById("rz-fallback-pill");
    if (existingPill) {
      existingPill.remove();
    }

    // Create and populate graph FIRST
    SeedGraphBuilder.createSeedGraph(graph);

    // Create event system AFTER graph is populated
    parameterEventSystem = new ParameterEventSystem();
    window.parameterEventSystem = parameterEventSystem;

    // Create undo manager with event system
    undoManager = new UndoManager(graph, null, parameterEventSystem);
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

    // Set WebGPU device for WGSL editor in ParameterPanel
    if (editor.paramPanel && typeof editor.paramPanel.setDevice === 'function' && window.gpuRenderer && window.gpuRenderer.device) {
      editor.paramPanel.setDevice(window.gpuRenderer.device);
    } else if (editor.paramPanel && typeof editor.paramPanel.setDevice !== 'function') {
      console.warn("ParameterPanel.setDevice method not available - WGSL editor compilation checking will be disabled");
    }

    // Create timeline manager and panel
    try {
      timelineManager = new TimelineManager(editor);
      editor.timelineManager = timelineManager;
      window.timelineManager = timelineManager;

      timelinePanel = new TimelinePanel(editor);
      window.timelinePanel = timelinePanel;
    } catch (error) {
      console.error("ERROR creating timeline components:", error);
      console.error("Error stack:", error.stack);
    }

    saveLoadManager = new SaveLoadManager(editor, graph, updateShaderFromGraph);
    saveLoadManager.setTextureManager(window.textureManager);

    // Set saveLoadManager on editor for VJ panel
    editor.saveLoadManager = saveLoadManager;

    backupDialog = new BackupDialog(saveLoadManager);

    welcomeWindow = new WelcomeWindow({
      saveLoadManager: saveLoadManager,
      onNewProject: () => {
        createNewProject();
      },
      onOpenProject: () => {
        const fileInput = document.getElementById("file-import");
        if (fileInput) {
          fileInput.click();
        }
      },
      onOpenBackups: () => {
        if (backupDialog) {
          backupDialog.show();
        }
      },
      onClose: () => {},
      storageKey: "rhizomium.welcome.dismissed"
    });

    // Create VJ Control Panel (after SaveLoadManager is ready)
    try {
      vjControlPanel = new VJControlPanel(editor);
      window.vjControlPanel = vjControlPanel;
    } catch (error) {
      console.error("ERROR creating VJ control panel:", error);
      console.error("Error stack:", error.stack);
    }

    // Create MIDI system
    try {
      const midiManager = new MIDIManager(editor.eventSystem);
      window.midiManager = midiManager;
      editor.midiManager = midiManager;

      const midiBinding = new MIDIParameterBinding(graph, editor.eventSystem, midiManager);
      window.midiBinding = midiBinding;
      editor.midiBinding = midiBinding;

      const midiSettingsPanel = getMIDISettingsPanel(midiManager, midiBinding);
      window.midiSettingsPanel = midiSettingsPanel;
      editor.midiSettingsPanel = midiSettingsPanel;
    } catch (error) {
      console.error("ERROR creating MIDI system:", error);
      console.error("Error stack:", error.stack);
    }

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
    window.welcomeWindow = welcomeWindow;
    window.rebuild = updateShaderFromGraph;
    window.buildWGSL = buildWGSL;
    window.floatingPreview = floatingPreview;

    // PERFORMANCE: Lightweight uniform update without shader rebuild
    window.updateUniformsOnly = function(nodeId, paramName, value) {
      if (!window.nodeCompiler?.uniformManager) return;
      const paramKey = `${nodeId}.${paramName}`;
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        window.nodeCompiler.uniformManager.uniformValues.set(paramKey, numValue);

        // DEBUG: Log parameter updates during drag (first 5 only to avoid spam)
        if (window.editor?._parameterDragging) {
          window._dragParamUpdateCount = (window._dragParamUpdateCount || 0) + 1;
          if (window._dragParamUpdateCount <= 5) {
            console.log('[updateUniformsOnly] Drag update #' + window._dragParamUpdateCount + ':', paramKey, '=', numValue);
          } else if (window._dragParamUpdateCount === 6) {
            console.log('[updateUniformsOnly] (suppressing further drag logs...)');
          }
        } else {
          window._dragParamUpdateCount = 0;
        }

        // CRITICAL: Send parameter update to external viewer immediately during drag
        // Throttle to ~60fps to avoid overwhelming the channel
        if (window.editor?._parameterDragging && window.liveShaderStream?.isStreaming) {
          const now = performance.now();
          const lastUpdateTime = window._lastParameterUpdateTime || 0;
          const UPDATE_THROTTLE_MS = 16; // ~60fps max update rate
          
          if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
            window._lastParameterUpdateTime = now;
            const uniformManager = window.nodeCompiler.uniformManager;
            if (uniformManager && uniformManager.uniformValues.size > 0) {
              const values = Array.from(uniformManager.uniformValues.values());
              const timeSec = performance.now() * 0.001;
              
              // CRITICAL: For compute nodes, also include the node's current params
              // since compute node parameters may not be in uniformKeys
              const graph = window.editor?.graph;
              let computeNodeParams = null;
              if (graph) {
                // Graph class uses getNode(id), not getNodeById(id)
                let node = null;
                if (typeof graph.getNode === 'function') {
                  node = graph.getNode(nodeId) || graph.getNode(String(nodeId));
                } else if (graph.nodes) {
                  // Fallback: search in graph.nodes array
                  node = graph.nodes.find(n => String(n.id) === String(nodeId));
                }
                
                if (node && node.kind && node.kind.startsWith('Compute')) {
                  // Include all params for this compute node
                  computeNodeParams = {
                    nodeId: String(nodeId),
                    params: { ...node.params }
                  };
                  
                  // DEBUG: Log compute node params being sent
                  if (window._dragParamUpdateCount <= 3) {
                    console.log('[updateUniformsOnly] Sending computeNodeParams for', nodeId, ':', computeNodeParams);
                  }
                } else if (window._dragParamUpdateCount <= 3) {
                  // DEBUG: Log if node not found or not a compute node
                  console.log('[updateUniformsOnly] Node lookup:', {
                    nodeId,
                    found: !!node,
                    kind: node?.kind,
                    isCompute: node?.kind?.startsWith('Compute'),
                    graphHasGetNode: typeof graph.getNode === 'function',
                    graphNodesLength: graph.nodes?.length
                  });
                }
              }
              
              // Get audio envelope values for transmission to viewer
              const audioEnvelope = {
                audioEnvelope: window._audioEnvelopeValue || 0.0,
                audioEnvelopeBass: window._audioEnvelopeBass || 0.0,
                audioEnvelopeMids: window._audioEnvelopeMids || 0.0,
                audioEnvelopeHighs: window._audioEnvelopeHighs || 0.0,
                audioEnvelopeFull: window._audioEnvelopeFull || 0.0
              };
              
              window.liveShaderStream.sendParameterUpdate(values, timeSec, computeNodeParams, audioEnvelope);
            }
          }
        } else {
          window._lastParameterUpdateTime = 0;
        }
      }
    };

    initializeRenderLoopFromSettings();

    await checkAutosaveRecovery();
    await updateShaderFromGraph();

    // Show welcome window at startup if not dismissed
    if (welcomeWindow) {
      const shouldShow = welcomeWindow.shouldShow();
      if (shouldShow) {
        try {
          welcomeWindow.show();
        } catch (error) {
          console.error("ERROR showing welcome window at startup:", error);
        }
      }
    } else {
      console.error("ERROR: welcomeWindow not initialized!");
    }

    setInterval(() => {
      const pill = document.getElementById("rz-fallback-pill");
      if (pill && pill.style.display !== "none") {
        pill.remove();
      }
    }, 2000);
  } catch (error) {
    errorHandler.handleError(error, { component: 'initialization' });
  }
}

// Undo callback functions
function onConnectionDeleted(connection) {
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
  if (undoManager && movementData) {
    undoManager.recordNodeMovement(movementData);
  } else {
    console.warn("UndoManager not available or movement data invalid:", { undoManager: !!undoManager, movementData });
  }
}

function onNodeDeleted(node) {
  if (undoManager && node) {
    undoManager.recordNodeDeletion(node);
  } else {
    console.warn("UndoManager not available or node invalid:", { undoManager: !!undoManager, node });
  }
}

function onConnectionCreated(sourceNodeId, targetNodeId, targetInput, sourceOutput = 0) {
  if (undoManager) {
    undoManager.recordConnectionCreation(sourceNodeId, targetNodeId, targetInput, sourceOutput);
  }
}

function onNodeCreated(node) {
  if (undoManager && node) {
    undoManager.recordNodeCreation(node);
  }
}

function onGroupDeleted(nodesToDelete) {
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

  /**
   * Setup Top Menu Dropdown System
   *
   * This handles the dropdown menu behavior for the top menu bar.
   * Menu structure: File, Edit, View, Settings, Display, Help
   *
   * Features:
   * - Click menu button to toggle dropdown
   * - Click outside to close all dropdowns
   * - Clicking menu items closes dropdown automatically
   * - Interactive elements (checkboxes, inputs, selects) keep dropdown open
   *
   * Menu HTML structure is in editor/index.html (search for #top-menu-bar)
   * Menu styles are in style.css and editor/style.css (keep both in sync!)
   */
  const setupMenuDropdowns = () => {
    const menuButtons = document.querySelectorAll('.menu-button');
    const menuDropdowns = document.querySelectorAll('.menu-dropdown');

    // Close all dropdowns
    const closeAllDropdowns = () => {
      menuDropdowns.forEach(dropdown => dropdown.classList.remove('show'));
      menuButtons.forEach(button => button.classList.remove('active'));
    };

    // Toggle dropdown for a specific menu
    menuButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdownId = button.id.replace('menu-', 'dropdown-');
        const dropdown = document.getElementById(dropdownId);

        if (!dropdown) return;

        // Check if this dropdown is already open
        const isOpen = dropdown.classList.contains('show');

        // Close all dropdowns first
        closeAllDropdowns();

        // If it wasn't open, open it
        if (!isOpen) {
          dropdown.classList.add('show');
          button.classList.add('active');
        }
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-section')) {
        closeAllDropdowns();
      }
    });

    // Close dropdown when clicking a menu item (except for checkboxes and inputs)
    menuDropdowns.forEach(dropdown => {
      dropdown.addEventListener('click', (e) => {
        // Don't close if clicking on checkbox, input, select, or label
        if (e.target.matches('input, select, label, .snap-controls, .snap-controls *')) {
          e.stopPropagation();
          return;
        }
        // Close dropdown if clicking on a button
        if (e.target.closest('button')) {
          setTimeout(() => closeAllDropdowns(), 100);
        }
      });
    });
  };

  setupMenuDropdowns();

  // Undo/Redo button handlers
  const undoBtn = removeExistingHandlers("btn-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (undoManager) {
        undoManager.undo();
      } else {
        console.error("UndoManager not available");
      }
    });
  } else {
    console.error("Undo button not found in DOM");
  }

  const redoBtn = removeExistingHandlers("btn-redo");
  if (redoBtn) {
    redoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (undoManager) {
        undoManager.redo();
      } else {
        console.error("UndoManager not available");
      }
    });
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
  } else {
    console.warn("Snap size input not found in DOM");
  }

  // Save Project button
  const saveBtn = removeExistingHandlers("btn-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      saveLoadManager.saveToFile();
    });
  }

  // Load Project button
  const loadBtn = removeExistingHandlers("btn-load");
  if (loadBtn) {
    loadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      triggerFileLoad();
    });
  }

  // File input change handler
  const fileInput = removeExistingHandlers("file-import");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          await saveLoadManager.loadFromFile(file);

          // Clear undo history when loading a new project
          if (undoManager) {
            undoManager.clear();
          }

          if (graph && graph.nodes) {
            graph.nodes.forEach((node) => {
              delete node.cachedValue;
              delete node.cached;
              node.needsUpdate = true;
            });

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
                  if (editor.markDirty) editor.markDirty('file-load-input-restore');
                  editor.draw();
                }
              }, 10);
            }

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
                  if (editor.markDirty) editor.markDirty('file-load-preview-refresh');
                  editor.draw();
                }
              }, 100);
            }

            graph.nodes.forEach((node) => {
              if (node.inputs) {
                node.inputs.forEach((input, index) => {
                  if (input) {
                    const originalInput = input;
                    node.inputs[index] = null;
                    setTimeout(() => {
                      node.inputs[index] = originalInput;
                      if (editor.draw) {
                        if (editor.markDirty) editor.markDirty('file-load-node-refresh');
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
        } catch (error) {
          console.error("Load failed:", error);
        }

        e.target.value = "";
      }
    });
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
      saveLoadManager.saveToFile(null, "json");
    });
  }

  // Export WGSL button
  const exportWgslBtn = removeExistingHandlers("btn-export-wgsl");
  if (exportWgslBtn) {
    exportWgslBtn.addEventListener("click", (e) => {
      e.preventDefault();
      saveLoadManager.saveToFile(null, "wgsl");
    });
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
      // Add visual feedback
      toggleConsoleBtn.style.backgroundColor = visible ? "rgba(74, 74, 78, 0.8)" : "";
      toggleConsoleBtn.style.borderColor = visible ? "rgba(102, 170, 255, 0.4)" : "";
    }
    if (notify && typeof updateStatus === "function") {
      updateStatus(visible ? "Console shown" : "Console hidden");
    }
  };

  if (toggleConsoleBtn) {
    // Set initial button text based on actual state
    setConsoleVisibility(consoleVisible, false);

    toggleConsoleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setConsoleVisibility(!consoleVisible);
    });
  }

  if (closeConsoleBtn) {
    closeConsoleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setConsoleVisibility(false);
    });
  }

  // Floating WGSL toggle button
  const floatingToggleBtn = removeExistingHandlers("btn-toggle-wgsl-console");
  if (floatingToggleBtn) {
    floatingToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setConsoleVisibility(!consoleVisible);
    });
  }

  // Audio Settings Panel - with robust error handling
  const audioSettingsBtn = removeExistingHandlers("btn-audio-settings");

  if (audioSettingsBtn) {
    audioSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        const audioPanel = getAudioSettingsPanel();

        if (audioPanel && typeof audioPanel.toggle === 'function') {
          audioPanel.toggle();

          // Update button appearance based on panel state
          if (audioPanel.visible) {
            audioSettingsBtn.textContent = "Audio Settings ✓";
            audioSettingsBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
            audioSettingsBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
          } else {
            audioSettingsBtn.textContent = "Audio Settings";
            audioSettingsBtn.style.backgroundColor = "";
            audioSettingsBtn.style.borderColor = "";
          }

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
  } else {
    console.error('[main.js] Audio settings button NOT found in DOM! Available buttons:',
      Array.from(document.querySelectorAll('button')).map(b => b.id).filter(Boolean));
  }

  // MIDI Settings Panel
  const midiSettingsBtn = removeExistingHandlers("btn-midi-settings");

  if (midiSettingsBtn) {
    midiSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        const midiPanel = window.midiSettingsPanel;

        if (midiPanel && typeof midiPanel.toggle === 'function') {
          midiPanel.toggle();

          // Update button appearance based on panel state
          if (midiPanel.visible) {
            midiSettingsBtn.textContent = "MIDI Settings ✓";
            midiSettingsBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
            midiSettingsBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
          } else {
            midiSettingsBtn.textContent = "MIDI Settings";
            midiSettingsBtn.style.backgroundColor = "";
            midiSettingsBtn.style.borderColor = "";
          }

          if (typeof updateStatus === "function") {
            updateStatus(midiPanel.visible ? "MIDI settings opened" : "MIDI settings closed");
          }
        } else {
          console.error('[main.js] MIDI panel is invalid:', midiPanel);
          if (typeof updateStatus === "function") {
            updateStatus("MIDI settings panel failed to load", "error");
          }
        }
      } catch (error) {
        console.error('[main.js] Error opening MIDI settings:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Error opening MIDI settings: " + error.message, "error");
        }
      }
    });
  } else {
    console.error('[main.js] MIDI settings button NOT found in DOM!');
  }

  // Timeline Panel
  const timelineBtn = removeExistingHandlers("btn-toggle-timeline");

  if (timelineBtn) {
    timelineBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        if (timelinePanel && typeof timelinePanel.toggle === 'function') {
          timelinePanel.toggle();

          // Update button appearance based on panel state
          if (timelinePanel.visible) {
            timelineBtn.textContent = "Timeline ✓";
            timelineBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
            timelineBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
          } else {
            timelineBtn.textContent = "Timeline";
            timelineBtn.style.backgroundColor = "";
            timelineBtn.style.borderColor = "";
          }

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
  } else {
    console.error('[main.js] Timeline button NOT found in DOM!');
  }

  // VJ Control Panel
  const vjBtn = removeExistingHandlers("btn-toggle-vj");

  if (vjBtn) {
    vjBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        if (vjControlPanel && typeof vjControlPanel.toggle === 'function') {
          vjControlPanel.toggle();

          // Update button appearance based on panel state
          if (vjControlPanel.visible) {
            vjBtn.textContent = "VJ Control ✓";
            vjBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
            vjBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
          } else {
            vjBtn.textContent = "VJ Control";
            vjBtn.style.backgroundColor = "";
            vjBtn.style.borderColor = "";
          }

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
  } else {
    console.error('[main.js] VJ Control button NOT found in DOM!');
  }

  // Display selector for multi-monitor support
  const displaySelect = document.getElementById('display-select');
  let availableScreens = [];
  let permissionGranted = false;

  // Try to detect available displays using Window Management API
  async function detectDisplays() {
    if (!displaySelect) {
      console.warn('[main.js] Display selector not found');
      return;
    }

    if (!('getScreenDetails' in window)) {
      displaySelect.title = 'Window Management API not supported in your browser';
      displaySelect.disabled = false;
      return;
    }

    try {
      // Request permission if needed
      const permission = await navigator.permissions.query({ name: 'window-management' });

      if (permission.state === 'granted' || permission.state === 'prompt') {
        const screenDetails = await window.getScreenDetails();
        availableScreens = screenDetails.screens;
        permissionGranted = true;

        // Clear and populate display selector
        displaySelect.innerHTML = '<option value="auto">Auto</option>';

        availableScreens.forEach((screen, index) => {
          const isPrimary = screen.isPrimary ? ' (Primary)' : '';
          const label = `Display ${index + 1}: ${screen.width}x${screen.height}${isPrimary}`;
          const option = document.createElement('option');
          option.value = index;
          option.textContent = label;
          displaySelect.appendChild(option);
        });

        displaySelect.title = `Select which monitor to open viewer on (${availableScreens.length} displays detected)`;
      } else if (permission.state === 'denied') {
        displaySelect.title = 'Permission denied. Enable Window Management in browser settings.';
      }
    } catch (error) {
      displaySelect.title = 'Click to request multi-monitor permission';
    }
  }

  // Detect displays on startup
  if (displaySelect) {
    detectDisplays();

    // Also try to detect when user clicks the dropdown (for permission prompt)
    displaySelect.addEventListener('focus', async () => {
      if (!permissionGranted && 'getScreenDetails' in window) {
        await detectDisplays();
      }
    }, { once: true });
  }

  // Open External Viewer button
  const openViewerBtn = removeExistingHandlers("btn-open-viewer");

  if (openViewerBtn) {
    // Check if running on Vercel or other cloud hosting
    const isCloudHosted = window.location.hostname.includes('vercel.app') ||
                          window.location.hostname.includes('netlify.app') ||
                          window.location.hostname.includes('github.io') ||
                          (!window.location.hostname.includes('localhost') &&
                           !window.location.hostname.includes('127.0.0.1') &&
                           !window.location.hostname.match(/^192\.168\./));

    if (isCloudHosted) {
      // Update button to show it works on Vercel
      openViewerBtn.title = "Open viewer in new tab (works on Vercel!)";
      openViewerBtn.style.opacity = "1.0";
    } else {
      openViewerBtn.title = "Launch external viewer (requires Python server)";
    }

    openViewerBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      // Check if running on Vercel/cloud
      if (isCloudHosted) {
        // If already streaming, stop it
        if (frameStreamingEnabled && liveShaderStream) {
          liveShaderStream.stopStreaming();
          frameStreamingEnabled = false;

          // Reset button appearance
          openViewerBtn.textContent = "Open External Viewer";
          openViewerBtn.style.backgroundColor = "";
          openViewerBtn.style.borderColor = "";

          if (typeof updateStatus === "function") {
            updateStatus("Streaming stopped");
          }
          return;
        }

        // Use LiveShaderStream for same-origin communication

        if (!LiveShaderStream.isSupported()) {
          alert('❌ Your browser doesn\'t support BroadcastChannel API.\n\nPlease use Chrome, Edge, Firefox, or Safari.');
          return;
        }

        try {
          // Initialize LiveShaderStream
          if (!liveShaderStream) {
            liveShaderStream = new LiveShaderStream();
            liveShaderStream.init();
            window.liveShaderStream = liveShaderStream; // Expose for GPU renderer
          }

          // Start streaming
          liveShaderStream.startStreaming();
          frameStreamingEnabled = true;

          // Send current shader immediately if available
          if (window.latestGeneratedWGSL) {
            const canvas = document.getElementById('gpu-canvas');

            // Extract current parameter values
            let uniformValues = [];
            if (window.nodeCompiler?.uniformManager?.uniformValues) {
              uniformValues = Array.from(window.nodeCompiler.uniformManager.uniformValues.values());
            }

            liveShaderStream.sendShaderUpdate(
              window.latestGeneratedWGSL,
              uniformValues,
              { width: canvas?.width || 1920, height: canvas?.height || 1080 }
            );
          } else {
            console.warn('[main.js] ⚠️ No shader available yet - triggering rebuild');
            // Trigger a shader rebuild to generate and send the shader
            if (window.rebuild && typeof window.rebuild === 'function') {
              setTimeout(() => {
                window.rebuild();
              }, 100);
            }
          }

          // Update button
          openViewerBtn.textContent = "Stop Streaming";
          openViewerBtn.style.backgroundColor = "rgba(0, 170, 0, 0.8)";
          openViewerBtn.style.borderColor = "rgba(0, 255, 0, 0.4)";

          // Get selected display
          const selectedDisplayIndex = displaySelect ? displaySelect.value : 'auto';
          let windowFeatures = 'width=1920,height=1080';

          // Position on selected display if available
          if (selectedDisplayIndex !== 'auto' && availableScreens.length > 0) {
            const screen = availableScreens[parseInt(selectedDisplayIndex)];
            if (screen) {
              const left = screen.availLeft;
              const top = screen.availTop;
              const width = Math.min(1920, screen.availWidth);
              const height = Math.min(1080, screen.availHeight);
              windowFeatures = `left=${left},top=${top},width=${width},height=${height}`;
            }
          }

          // Open live viewer in new window with auto-fullscreen
          const viewerUrl = window.location.origin + '/viewer-live.html?fullscreen=true&hideui=true';
          window.open(viewerUrl, 'RhizomiumLiveViewer', windowFeatures);

          if (typeof updateStatus === "function") {
            updateStatus("Streaming shaders to live viewer (60 FPS)");
          }
        } catch (error) {
          console.error('[main.js] Error starting LiveShaderStream:', error);
          alert('❌ Failed to start streaming: ' + error.message);
        }

        return;
      }

      // Local development - use HTTP/WebSocket streaming
      try {
        // If already streaming, stop it
        if (frameStreamingEnabled && frameStreamClient) {
          frameStreamClient.stopStreaming();
          frameStreamingEnabled = false;

          // Reset button appearance
          openViewerBtn.textContent = "Open External Viewer";
          openViewerBtn.style.backgroundColor = "";
          openViewerBtn.style.borderColor = "";

          if (typeof updateStatus === "function") {
            updateStatus("Streaming stopped");
          }
          return;
        }

        // Initialize frame streaming client if not already done
        if (!frameStreamClient) {
          frameStreamClient = new FrameStreamClient('http://localhost:5000');
        }

        // Start frame streaming
        try {
          await frameStreamClient.startStreaming();
          frameStreamingEnabled = true;

          if (typeof updateStatus === "function") {
            updateStatus("Frame streaming started");
          }
        } catch (streamError) {
          console.warn('[main.js] Frame streaming not available:', streamError);
        }

        // Try to launch rhizo_viewer via backend API
        const response = await fetch('/api/launch-viewer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewer: 'rhizo_viewer.py' })
        });

        if (response.ok) {
          if (typeof updateStatus === "function") {
            updateStatus("External viewer opened (WebSocket mode)");
          }

          // Update button text to show streaming is active
          openViewerBtn.textContent = "Stop Streaming";
          openViewerBtn.style.backgroundColor = "rgba(0, 170, 0, 0.8)";
          openViewerBtn.style.borderColor = "rgba(0, 255, 0, 0.4)";

        } else {
          console.error('[main.js] Failed to launch external viewer:', response.status);
          if (typeof updateStatus === "function") {
            updateStatus("Failed to launch external viewer", "error");
          }
        }
      } catch (error) {
        console.error('[main.js] Error launching external viewer:', error);

        // Show helpful message for local setup
        const isLocal = window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1';

        if (isLocal) {
          const message =
            "⚠️ Python backend not running.\n\n" +
            "To use the external viewer:\n" +
            "1. Open a terminal in the project directory\n" +
            "2. Run: python rhizo_server.py\n" +
            "3. Refresh this page\n" +
            "4. Click 'Open External Viewer' again\n\n" +
            "The viewer will connect via WebSocket for remote streaming.";

          alert(message);
        }

        if (typeof updateStatus === "function") {
          updateStatus("External viewer requires Python backend (run rhizo_server.py)", "warning");
        }
      }
    });
  } else {
    console.error('[main.js] External viewer button NOT found in DOM!');
  }

  // Resolution selector for canvas/streaming
  const resolutionSelect = document.getElementById('resolution-select');
  if (resolutionSelect) {
    resolutionSelect.addEventListener('change', (e) => {
      const resolution = e.target.value;
      const [width, height] = resolution.split('x').map(Number);

      const canvas = document.getElementById('gpu-canvas');
      if (canvas) {

        // Update canvas size
        canvas.width = width;
        canvas.height = height;

        // WebGPU renderer will automatically handle the resize on next render
        // The context will be recreated with new dimensions

        // Send resolution update to LiveShaderStream if active
        if (liveShaderStream && liveShaderStream.isStreaming) {
          liveShaderStream.sendResolutionUpdate(width, height);
        }

        if (typeof updateStatus === "function") {
          updateStatus(`Resolution changed to ${width}x${height}`);
        }
      }
    });

    // Set initial resolution on startup
    const initialResolution = resolutionSelect.value;
    const [initWidth, initHeight] = initialResolution.split('x').map(Number);
    const canvas = document.getElementById('gpu-canvas');
    if (canvas) {
      canvas.width = initWidth;
      canvas.height = initHeight;
    }
  } else {
    console.error('[main.js] Resolution selector NOT found in DOM!');
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
  }
  setConsoleVisibility(consoleVisible, false);

  // Import button
  const importBtn = removeExistingHandlers("btn-import");
  if (importBtn) {
    importBtn.addEventListener("click", (e) => {
      e.preventDefault();
      triggerFileLoad();
    });
  }

  // Backups button
  const backupsBtn = removeExistingHandlers("btn-backups");
  if (backupsBtn && backupDialog) {
    backupsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      backupDialog.show();
    });
  }

  // Welcome button
  const welcomeBtn = removeExistingHandlers("btn-welcome");
  if (welcomeBtn && welcomeWindow) {
    welcomeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        welcomeWindow.show({ force: true });
      } catch (error) {
        console.error("ERROR showing welcome window:", error);
      }
    });
  } else {
    if (!welcomeBtn) console.warn("WARNING: Welcome button not found in DOM!");
    if (!welcomeWindow) console.warn("WARNING: welcomeWindow not initialized!");
  }

  // Rebuild button
  const rebuildBtn = removeExistingHandlers("btn-rebuild");
  if (rebuildBtn) {
    rebuildBtn.addEventListener("click", (e) => {
      e.preventDefault();
      updateShaderFromGraph();
    });
  }
}

function setupKeyboardShortcuts() {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const isCommandKey = (event) => (isMac ? event.metaKey : event.ctrlKey);

  // Add copy/paste handler with capture phase to intercept before browser
  window.addEventListener("keydown", (e) => {
    if (shouldIgnoreShortcutTarget(e)) {
      return;
    }

    const cmdKey = isCommandKey(e);

    // Handle copy/paste EARLY to prevent browser default behavior
    if (cmdKey && !e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === "c") {
        // Only prevent default if we actually have something to copy
        if (copySelection()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        } else {
          // No nodes selected, let browser/Vercel handle it
          updateStatus("Select nodes to copy", "warning");
        }
        return;
      }
      if (e.key.toLowerCase() === "v") {
        // Only prevent default if we actually have something to paste
        if (pasteSelection()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        } else {
          // Nothing in clipboard, let browser handle it
          updateStatus("Nothing to paste", "warning");
        }
        return;
      }
    }
  }, { capture: true }); // Use capture phase to run before other handlers

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

      case "c":
        if (e.shiftKey) {
          e.preventDefault();
          if (computeShaderTest) {
            computeShaderTest.toggle();
            updateStatus(computeShaderTest.isEnabled ? "Compute shader test enabled" : "Compute shader test disabled");
          } else {
            updateStatus("Compute shader test not available", "warning");
          }
        }
        break;

      case "3":
        e.preventDefault();
        if (viewportPanel) {
          viewportPanel.toggle();
          updateStatus(viewportPanel.isVisible ? "3D Viewport opened" : "3D Viewport closed");
        } else {
          updateStatus("3D Viewport not available", "warning");
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

  if (target.isContentEditable) {
    return true;
  }

  return false;
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

function copySelection() {
  const selection = editor?.selection;
  const selected = selection?.getSelected?.();
  if (!selection || !selected || selected.size === 0) {
    return false;
  }

  // Clear any browser text selection to prevent interference
  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }

  const success = selection.copySelected();
  if (success) {
    updateStatus(`Copied ${selected.size} node${selected.size > 1 ? 's' : ''}`);
  }
  return success;
}

function pasteSelection() {
  const selection = editor?.selection;
  if (!selection) {
    return false;
  }

  const success = selection.pasteFromClipboard();
  if (success) {
    editor?.draw?.();
    updateStatus("Pasted from clipboard");
  }
  return success;
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
  }

  if (editor) {
    if (editor.selection && editor.selection.clear) {
      editor.selection.clear();
    }
    if (editor.nodePreviews) {
      editor.nodePreviews.clear();
    }
    if (editor.viewport) {
      editor.viewport.offsetX = 0;
      editor.viewport.offsetY = 0;
      editor.viewport.scale = 1;
    }
  }

  SeedGraphBuilder.createSeedGraph(graph);

  updateShaderFromGraph();
  if (editor && editor.draw) {
    if (editor.markDirty) editor.markDirty('new-project');
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
    if (editor.draw) {
      if (editor.markDirty) editor.markDirty('preview-update');
      editor.draw();
    }
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
    toggleBtn.addEventListener("click", () => {
      floatingPreview.toggle();

      // Update button text and appearance
      const isVisible = floatingPreview.isVisible;
      toggleBtn.textContent = isVisible ? "Hide Preview" : "Show Preview";

      if (isVisible) {
        toggleBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
        toggleBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
      } else {
        toggleBtn.style.backgroundColor = "";
        toggleBtn.style.borderColor = "";
      }
    });

    // Set initial state
    const isVisible = floatingPreview.isVisible;
    toggleBtn.textContent = isVisible ? "Hide Preview" : "Show Preview";
    if (isVisible) {
      toggleBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
      toggleBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
    }
  }

  if (dockBtn) {
    dockBtn.addEventListener("click", () => {
      floatingPreview.toggleDocked();
      const isDocked = floatingPreview.isDocked;

      dockBtn.textContent = isDocked ? "Float Preview" : "Dock Preview";

      if (isDocked) {
        dockBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
        dockBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
      } else {
        dockBtn.style.backgroundColor = "";
        dockBtn.style.borderColor = "";
      }
    });

    // Set initial state
    const isDocked = floatingPreview.isDocked;
    dockBtn.textContent = isDocked ? "Float Preview" : "Dock Preview";
    if (isDocked) {
      dockBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
      dockBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
    }
  }

  if (lockBtn) {
    lockBtn.addEventListener("click", () => {
      floatingPreview.toggleLock();
      const isLocked = floatingPreview.isLocked;

      lockBtn.textContent = isLocked ? "Unlock Preview" : "Lock Preview";

      if (isLocked) {
        lockBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
        lockBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
      } else {
        lockBtn.style.backgroundColor = "";
        lockBtn.style.borderColor = "";
      }
    });

    // Set initial state
    const isLocked = floatingPreview.isLocked;
    lockBtn.textContent = isLocked ? "Unlock Preview" : "Lock Preview";
    if (isLocked) {
      lockBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
      lockBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
    }
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      floatingPreview.toggleFullscreen();

      // Check if we're in fullscreen mode
      const isFullscreen = document.fullscreenElement !== null;

      if (isFullscreen) {
        fullscreenBtn.textContent = "Exit Fullscreen";
        fullscreenBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
        fullscreenBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
      } else {
        fullscreenBtn.textContent = "Fullscreen";
        fullscreenBtn.style.backgroundColor = "";
        fullscreenBtn.style.borderColor = "";
      }
    });

    // Listen for fullscreen changes (e.g., ESC key pressed)
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = document.fullscreenElement !== null;
      fullscreenBtn.textContent = isFullscreen ? "Exit Fullscreen" : "Fullscreen";

      if (isFullscreen) {
        fullscreenBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
        fullscreenBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
      } else {
        fullscreenBtn.style.backgroundColor = "";
        fullscreenBtn.style.borderColor = "";
      }
    });
  }
}
let lastUniformUpdate = 0;
// PERFORMANCE: Throttle preview computations to reduce CPU overhead
// Before: Preview computed every frame (60 times/sec) = 10-20ms × 60 = 600-1200ms/sec overhead
// After: Preview computed every 100ms (10 times/sec) = 10-20ms × 10 = 100-200ms/sec overhead
// PERFORMANCE: Add small random offset to prevent periodic operations from aligning
// This prevents all updates from happening at the same time, causing frame time spikes
const PREVIEW_UPDATE_OFFSET = Math.random() * 50; // 0-50ms random offset
const PROFILER_UPDATE_OFFSET = Math.random() * 50; // 0-50ms random offset

let lastPreviewUpdate = -PREVIEW_UPDATE_OFFSET; // Start with offset to spread out initial updates
let lastProfilerUpdate = -PROFILER_UPDATE_OFFSET;
const PROFILER_UPDATE_INTERVAL = 200; // Update profiler overlay every 200ms (5 FPS)
const PREVIEW_UPDATE_INTERVAL = 150; // ms (increased from 100ms to reduce frequency and spread out updates)

async function updateShaderFromGraph() {
  try {
    if (!graph || !graph.nodes || graph.nodes.length === 0) {
      if (window.gpuRenderer) {
        window.gpuRenderer.clear();
        window.gpuRenderer.presentFallbackColor();
      }
      return;
    }

    const outputNode = graph.nodes.find(
      (node) => node && /OutputFinal/i.test(node.kind || node.type || node.name || "")
    );

    if (!outputNode) {
      if (window.gpuRenderer) {
        window.gpuRenderer.clear();
        window.gpuRenderer.presentFallbackColor();
      }
      return;
    }

    const hasConnection =
      Array.isArray(outputNode.inputs) &&
      outputNode.inputs[0] !== null &&
      outputNode.inputs[0] !== undefined;

    if (!hasConnection) {
      if (window.gpuRenderer) {
        window.gpuRenderer.clear();
        window.gpuRenderer.presentFallbackColor();
      }
      return;
    }

    const updateStart = performance.now();

    const result = buildWGSL(window.editor.graph);
    const buildTime = (performance.now() - updateStart).toFixed(2);

    if (!result || !result.wgsl) {
      console.error("Shader compilation produced no code");
      return;
    }

    // Initialize compute nodes BEFORE setting shader source
    // This ensures compute textures exist when bind groups are created
    if (computeExecutor && window.computeNodeRegistry && window.computeNodeRegistry.size > 0) {
      await computeExecutor.initialize();
    }

    // Process ComputeFieldMapper nodes for 3D visualization
    if (fieldMapperIntegration && graph && graph.nodes) {
      try {
        await fieldMapperIntegration.processFieldMappers(graph.nodes, graph.connections || []);
      } catch (error) {
        console.error('[main] Error processing field mappers:', error);
      }
    }

    const rawWGSL = typeof result.wgsl === "string" ? result.wgsl : String(result.wgsl ?? "");

    // REMOVED AGGRESSIVE CACHING - it was breaking preview updates on connection changes
    // Rely on shader compilation cache (glslBuilder.js) and GPU pipeline cache (gpuRenderer.js) instead

    const regexStart = performance.now();
    const sanitizedWGSL = rawWGSL.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
    const regexTime = (performance.now() - regexStart).toFixed(2);

    const shaderLength = sanitizedWGSL.length;
    window.latestGeneratedWGSL = rawWGSL;
    window.latestGeneratedWGSLClean = sanitizedWGSL;

    const domStart = performance.now();
    const codeElement = document.getElementById("code");
    if (codeElement) {
      codeElement.textContent = sanitizedWGSL;
      codeElement.scrollTop = codeElement.scrollHeight;
    }
    const domTime = (performance.now() - domStart).toFixed(2);

    const gpuStart = performance.now();
    if (window.gpuRenderer) {
      window.gpuRenderer.setShaderSource(rawWGSL, {
        hasTextures: !!result.usesTextures,
        hasUniforms: !!result.usesUniforms,
      });

      lastUniformUpdate = performance.now();
      if (typeof updateStatus === "function") {
        updateStatus("Shader compiled");
      }

      // Send shader update to LiveShaderStream if active
      if (liveShaderStream && liveShaderStream.isStreaming) {
        const canvas = document.getElementById('gpu-canvas');

        // Extract parameter values from uniformManager as ordered array
        let uniformValues = [];
        if (result.uniformManager && result.uniformManager.uniformValues) {
          uniformValues = Array.from(result.uniformManager.uniformValues.values());
        } else {
          console.warn('[main.js] No uniformManager or uniformValues found in result');
        }

        liveShaderStream.sendShaderUpdate(
          rawWGSL,
          uniformValues,
          { width: canvas?.width || 1920, height: canvas?.height || 1080 }
        );
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
}

// PERFORMANCE: Track GPU frame skipping during canvas interactions
let gpuFrameSkipCounter = 0;

function handleRenderFrame(frameState) {
  // PERFORMANCE: Skip expensive operations during parameter drag
  // When dragging parameters, we don't need to update anything
  // All updates happen once on mouseup
  const isDragging = editor?._parameterDragging || false;
  
  // PERFORMANCE: Track canvas interactions to throttle GPU rendering
  // This prevents GPU and canvas from competing for resources, causing FPS drops
  const isCanvasInteracting = editor?.eventHandler?.isCanvasInteracting?.() || false;

  // PERFORMANCE: Skip expensive operations during drag, but keep basic rendering
  // Update timeline manager (only if not dragging)
  if (!isDragging && timelineManager && timelineManager.isEnabled()) {
    timelineManager.update(frameState.deltaTime);
  }

  // Update timeline panel visualization (only if not dragging)
  if (!isDragging && timelinePanel) {
    timelinePanel.update();
  }

  // GPU rendering - Always render for real-time preview updates
  // Check if compute shader test is active
  if (computeShaderTest && computeShaderTest.isEnabled) {
    // Render compute shader test instead of normal renderer
    computeShaderTest.render(frameState.simTime);
  } else if (window.gpuRenderer) {
    // GPU rendering - Always render for real-time preview
    // Canvas optimizations handle the performance, GPU keeps running
    const renderPromise = window.gpuRenderer.render({ timeSec: frameState.simTime });

      // Stream frames to external viewers if enabled
      // NOTE: Now streams during parameter drag for real-time external view updates
      // CRITICAL: Frame capture happens asynchronously after render completes
      // This ensures compute shaders have finished and the frame is ready
      // PERFORMANCE: Use requestIdleCallback to avoid blocking render loop
      if (frameStreamingEnabled) {
        const canvas = document.getElementById('gpu-canvas');
        if (canvas) {
          // Use requestIdleCallback to defer frame capture to idle time
          // This prevents frame streaming from affecting render performance
          if (window.requestIdleCallback) {
            window.requestIdleCallback(() => {
              renderPromise.then(() => {
                // Use BroadcastChannel for Vercel/cloud deployments
                if (broadcastFrameStream) {
                  broadcastFrameStream.sendFrameFromCanvas(canvas);
                }
                // Use HTTP streaming for local development
                else if (frameStreamClient) {
                  frameStreamClient.sendFrameFromCanvas(canvas, 'rgb', 0.85);
                }
              }).catch(err => {
                // Silently handle errors to avoid breaking render loop
              });
            }, { timeout: 100 });
          } else {
            // Fallback for browsers without requestIdleCallback
            renderPromise.then(() => {
              if (broadcastFrameStream) {
                broadcastFrameStream.sendFrameFromCanvas(canvas);
              } else if (frameStreamClient) {
                frameStreamClient.sendFrameFromCanvas(canvas, 'rgb', 0.85);
              }
            }).catch(err => {
              // Silently handle errors
            });
          }
        }
      }
  }

  // 3D Viewport rendering
  if (sceneRenderer3D && viewportPanel && viewportPanel.isVisible) {
    sceneRenderer3D.render(frameState.simTime);
  }

  // Update viewport panel
  if (viewportPanel && viewportPanel.isVisible) {
    viewportPanel.update();
  }

  // FPS counter - ALWAYS update for performance monitoring
  if (!frameState.manual && floatingPreview?.fpsCounter) {
    floatingPreview.fpsCounter.frame();
  }

  // Update compute profiler overlay (throttled to reduce overhead)
  // PERFORMANCE: Throttle to 5 updates per second to reduce DOM manipulation overhead
  // Also defer to idle time to avoid frame time spikes
  if (profilerOverlay && computeProfiler) {
    const now = performance.now();
    const shouldUpdateProfiler = (now - lastProfilerUpdate) >= PROFILER_UPDATE_INTERVAL;
    if (shouldUpdateProfiler) {
      // Defer profiler overlay update to idle time to avoid micro-stutters
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => {
          const metrics = computeProfiler.getMetrics();
          profilerOverlay.update(metrics);
        }, { timeout: 250 });
      } else {
        // Fallback: update synchronously
        const metrics = computeProfiler.getMetrics();
        profilerOverlay.update(metrics);
      }
      lastProfilerUpdate = now;
    }
  }

  // Undo UI updates (only if not dragging)
  if (!isDragging && undoManager) {
    undoManager.updateUI();
  }

  // Update preview values and canvas for time/audio-based expressions
  // Only when actually animating (not manual updates)
  if (!frameState.manual) {
    // PERFORMANCE: Skip preview computations during drag (expensive!)
    if (!isDragging) {
      // PERFORMANCE: Throttle preview COMPUTATIONS to reduce CPU overhead
      const now = performance.now();
      const shouldUpdatePreviews = (now - lastPreviewUpdate) >= PREVIEW_UPDATE_INTERVAL;

      if (shouldUpdatePreviews) {
        // PERFORMANCE: Defer preview computation to idle time to avoid frame time spikes
        // This prevents periodic micro-stutters from preview updates
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => {
            // Update preview values for time/audio-based expressions
            // This ensures node labels show current values
            if (editor?.previewComputer && editor?.graph) {
              const hadTimeAnimatedNodes = editor.expressionSystem?.timeAnimatedNodes?.size > 0;
              editor.previewComputer.computePreviews(editor.graph);

              // Only mark dirty if there are time-animated nodes that need visual updates
              if (hadTimeAnimatedNodes && editor.markDirty) {
                editor.markDirty('time-animation');
              }
            }
          }, { timeout: 150 });
        } else {
          // Fallback: do it synchronously but only if we have time
          // Update preview values for time/audio-based expressions
          if (editor?.previewComputer && editor?.graph) {
            const hadTimeAnimatedNodes = editor.expressionSystem?.timeAnimatedNodes?.size > 0;
            editor.previewComputer.computePreviews(editor.graph);

            if (hadTimeAnimatedNodes && editor.markDirty) {
              editor.markDirty('time-animation');
            }
          }
        }
        lastPreviewUpdate = now;
      }
    }

    // OPTIMIZATION: Only redraw when canvas is dirty
    // Canvas is marked dirty by: user interactions, preview updates, graph changes
    if (editor?.draw) {
      editor.draw(); // draw() will check _isDirty internally
    }
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

// Export 3D scene test functions
window.addTestCube = function() {
  if (!window.gpuRenderer || !window.gpuRenderer.device) {
    console.error('GPU device not available');
    return null;
  }
  if (!systemIntegration || !systemIntegration.scene) {
    console.error('SystemIntegration or Scene not available');
    return null;
  }

  const cube = addTestCubeToScene(
    systemIntegration.scene,
    window.gpuRenderer.device,
    'Test Cube'
  );

  // Show viewport if not already visible
  if (viewportPanel && !viewportPanel.isVisible) {
    viewportPanel.show();
  }

  return cube;
};

// Page Visibility API - Fix lag when returning to tab
// When tab becomes visible after being hidden, render a "warmup" frame
// to prepare GPU resources (MSAA texture, etc.) BEFORE user interaction
function setupPageVisibilityHandler() {
  if (typeof document.hidden === 'undefined') {
    console.warn('[main.js] Page Visibility API not supported');
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Tab hidden - optional: could pause render loop here to save battery
      console.log('[main.js] Tab hidden');
    } else {
      // Tab visible - AGGRESSIVE warmup to prepare GPU and canvas resources
      console.log('[main.js] Tab visible - aggressive warmup');

      // Multiple renders to fully warm up GPU pipeline
      // This happens BEFORE user interaction, preventing lag on first action
      if (window.gpuRenderer && renderLoopController) {
        try {
          // Multiple renders to fully warm up GPU pipeline
          for (let i = 0; i < 3; i++) {
            renderLoopController.renderNow({ advance: false });
          }
        } catch (error) {
          console.warn('[main.js] Warmup frames failed:', error);
        }
      }
      
      // Also warm up canvas 2D context
      if (editor && editor.draw) {
        try {
          if (typeof editor.markDirty === 'function') {
            editor.markDirty('visibility-warmup');
          }
          // Force multiple draws to wake up canvas context
          editor.draw();
          editor.draw();
        } catch (error) {
          console.warn('[main.js] Canvas warmup failed:', error);
        }
      }
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initialize();
    setupPageVisibilityHandler();
  });
} else {
  initialize();
  setupPageVisibilityHandler();
}
