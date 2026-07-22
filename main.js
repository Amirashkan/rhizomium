// main.js - Complete version with Undo System and Event System
import { GPURenderer } from "./src/gpu/gpuRenderer.js";
import { RenderLoop } from "./src/core/RenderLoop.js";
import { buildWGSL } from "./src/codegen/glslBuilder.js";
import { Editor } from "./src/core/Editor.js";
import { SaveLoadManager } from "./src/core/SaveLoadManager.js";
import { BackupDialog } from "./src/ui/BackupDialog.js";
import { FileManager } from "./src/ui/FileManager.js";
import { WelcomeWindow } from "./src/ui/WelcomeWindow.js";
import { Graph } from "./src/data/Graph.js";
import { makeNode, NodeDefs, updateNodeIdCounter } from "./src/data/NodeDefs.js";
import { SeedGraphBuilder } from "./src/utils/SeedGraphBuilder.js";
import { FloatingGPUPreview } from "./src/ui/FloatingGPUPreview.js";
import { TauriSecondMonitorViewer } from "./src/ui/TauriSecondMonitorViewer.js";
import { isViteBuild } from "./src/utils/isViteBuild.js";
import { isTauri } from "./src/utils/isTauri.js";
import { TextureManager } from "./src/core/TextureManager.js";
import { UndoManager } from "./src/core/UndoManager.js";
import { ParameterEventSystem } from "./src/utils/ParameterEventSystem.js";
import { ErrorHandler } from './src/core/ErrorHandler.js';
import { getAudioSettingsPanel } from './src/ui/AudioSettingsPanel.js';
import { MIDIManager } from './src/midi/MIDIManager.js';
import { MIDIParameterBinding } from './src/midi/MIDIParameterBinding.js';
import { getMIDISettingsPanel } from './src/ui/MIDISettingsPanel.js';
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
import { PreviewExportSettingsWindow } from './src/ui/PreviewExportSettingsWindow.js';
import { PreferencesWindow } from './src/ui/PreferencesWindow.js';
import { PreviewPerfMonitor } from "./src/utils/PreviewPerfMonitor.js";
import { getPerfProbe } from "./src/utils/PerfProbe.js";
import { installPerfBench } from "./src/utils/PerfBenchPatch.js";
import { HoldNodeProcessor } from "./src/core/HoldNodeProcessor.js";
import { CountNodeProcessor } from "./src/core/CountNodeProcessor.js";
import { FeedbackResetProcessor } from "./src/core/FeedbackResetProcessor.js";
import { AudioAnalysisProcessor } from "./src/core/AudioAnalysisProcessor.js";
// TEMPORARILY REMOVED: Thread separation system imports (causing performance issues)
// import { getThreadSeparationManager } from './src/core/ThreadSeparationManager.js';
// import { getBrowserAudioCapture } from './src/audio/BrowserAudioCapture.js';

// Verify timeline imports loaded

window.makeNode = makeNode;
window.NodeDefs = NodeDefs;
window.updateNodeIdCounter = updateNodeIdCounter;

// Always-on frame attribution probe + benchmark patch generator.
// Console: window.perfReport(), window.perfBench.mixedGraph(300), .blurTower(6)
const perfProbe = getPerfProbe();
installPerfBench();

// Drives the Hold (sample-and-hold) node's CPU-side latch each frame. See HoldNodeProcessor.
const holdNodeProcessor = new HoldNodeProcessor();
// Drives the Count node's CPU-side counter each frame. See CountNodeProcessor.
const countNodeProcessor = new CountNodeProcessor();
// Exposed so the Count node's "Reset Count" button (ParameterPanel.runParameterAction) can queue a reset.
window.countNodeProcessor = countNodeProcessor;
// Watches the Feedback nodes' Reset pin and clears feedback on a rising edge. See FeedbackResetProcessor.
const feedbackResetProcessor = new FeedbackResetProcessor();
// Runs precise audio kick/onset detection each frame for Audio Analysis nodes. See AudioAnalysisProcessor.
const audioKickProcessor = new AudioAnalysisProcessor();

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
  if (!canvas) {
    console.error("No GPU canvas found after cleanup");
    return false;
  }

  canvas.width = canvas.clientWidth || window.innerWidth;
  canvas.height = canvas.clientHeight || window.innerHeight;

  try {
    __deviceReady = false;

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
// Retain the adapter: if it gets garbage-collected, Chromium drops the Dawn
// instance behind it and later buffer.mapAsync calls fail with "A valid
// external Instance reference no longer exists" (breaks 3D field readback)
window.gpuAdapter = adapter;
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

      // The second-monitor mirror taps window.gpuRenderer; re-point it at the
      // freshly created renderer so the output survives a device reinit.
      window.secondMonitorViewer?.reattach?.();

      // Profiling runs only while the overlay is shown (synced in the render loop).
      // Its per-frame GPU timestamp readback (mapAsync) is a CPU<->GPU sync that
      // stalls the shared GPU, so it must not run when nothing is displayed.
      computeProfiler.setEnabled(false);

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
let fileManager = null;
let welcomeWindow = null;
let undoManager = null;
let parameterEventSystem = null;
let __deviceReady = false;
let floatingPreview = null;
let secondMonitorViewer = null;
let previewExportSettingsWindow = null;
let preferencesWindow = null;
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
const previewPerfMonitor = new PreviewPerfMonitor();
window.previewPerfMonitor = previewPerfMonitor;

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
    const isWindows = navigator.userAgentData
      ? (await navigator.userAgentData.getHighEntropyValues(["platform"])).platform === "Windows"
      : /Windows/i.test(navigator.userAgent);
    const adapter = await navigator.gpu.requestAdapter(
      isWindows ? undefined : { powerPreference: "high-performance" }
    );
    const device = await adapter.requestDevice();
    // Retain the adapter: if it gets garbage-collected, Chromium drops the
    // Dawn instance behind it and later buffer.mapAsync calls fail with "A
    // valid external Instance reference no longer exists" (breaks 3D readback)
    window.gpuAdapter = adapter;
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

        // Profiling runs only while the overlay is shown (synced in the render loop).
        // Its per-frame GPU timestamp readback (mapAsync) is a CPU<->GPU sync that
        // stalls the shared GPU, so it must not run when nothing is displayed.
        computeProfiler.setEnabled(false);

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

      // Initialize Thread Separation System (optimized, deferred)
      // Now optimized with requestIdleCallback, reduced heartbeat frequency, and deferred initialization
      // Can be disabled by setting window.DISABLE_THREAD_SEPARATION = true
      if (!window.DISABLE_THREAD_SEPARATION) {
        try {
          const { getThreadSeparationManager } = await import('./src/core/ThreadSeparationManager.js');
          const threadSeparationManager = getThreadSeparationManager();
          
          // Initialize with optimized options
          threadSeparationManager.initialize();
          window.threadSeparationManager = threadSeparationManager;
          console.log("Thread separation system initialization scheduled (deferred)");
        } catch (error) {
          console.error("Failed to initialize thread separation system:", error);
        }
      } else {
        console.log("Thread separation system disabled (window.DISABLE_THREAD_SEPARATION = true)");
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
    fileManager = new FileManager(saveLoadManager);

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

      // Drive the preview FPS counter from real GPU-frame completions so the
      // overlay reports true throughput (and frame time), not dispatch rate.
      if (window.gpuRenderer) {
        window.gpuRenderer.onFramePresented = () => {
          const fc = floatingPreview?.fpsCounter;
          if (fc && floatingPreview.isVisible) fc.frame();
        };
      }

      // Second-monitor full-screen viewer — desktop (Tauri) only. It opens a real
      // borderless OS window on the second display and re-renders the shader there
      // natively (see TauriSecondMonitorViewer). The raw web deployments and the
      // plain browser dev build get no second viewer: the only thing a browser
      // popup could do is mirror copied pixels, which we no longer ship — so the
      // menu entry stays hidden outside the desktop app.
      if (isViteBuild() && isTauri()) {
        secondMonitorViewer = new TauriSecondMonitorViewer(gpuCanvas, {
          renderer: window.gpuRenderer,
          onStatus: (message, kind) => updateStatus(message, kind),
          onActiveChange: (active) => setSecondMonitorButtonState(active),
        });
        window.secondMonitorViewer = secondMonitorViewer;
      }
    }

    window.graph = graph;
    window.editor = editor;
    window.saveLoadManager = saveLoadManager;
    window.backupDialog = backupDialog;
    window.fileManager = fileManager;
    window.welcomeWindow = welcomeWindow;
    window.rebuild = updateShaderFromGraph;
    window.buildWGSL = buildWGSL;
    window.floatingPreview = floatingPreview;

    // Initialize Preview/Export Settings Window BEFORE setupUIEventHandlers
    // so that handlers can find it
    if (floatingPreview) {
      previewExportSettingsWindow = new PreviewExportSettingsWindow(floatingPreview);
      window.previewExportSettingsWindow = previewExportSettingsWindow;
      
      // Initialize settings with default values if needed
      if (floatingPreview.settings) {
        const previewSettings = floatingPreview.settings.settings;
        if (!previewSettings.showGrid) previewSettings.showGrid = false;
        if (previewSettings.showNodePreviews === undefined) previewSettings.showNodePreviews = true;
        if (!previewSettings.antiAliasing) previewSettings.antiAliasing = 2;
        if (previewSettings.startFrame === undefined) previewSettings.startFrame = 0;
        if (previewSettings.endFrame === undefined) previewSettings.endFrame = 60;
        if (previewSettings.loop === undefined) previewSettings.loop = true;
        if (previewSettings.alphaChannel === undefined) previewSettings.alphaChannel = false;
        if (!previewSettings.compression) previewSettings.compression = 90;
        if (!previewSettings.aspectRatio) previewSettings.aspectRatio = "16:9";
      }

      // Setup menu handlers
      setTimeout(() => setupPreviewSettingsMenu(), 100);
    }

    // Initialize Preferences Window BEFORE setupUIEventHandlers
    // so that handlers can find it
    preferencesWindow = new PreferencesWindow();
    window.preferencesWindow = preferencesWindow;

    // Now set up UI event handlers (which will attach handlers to the windows we just created)
    setupUIEventHandlers();
    setupKeyboardShortcuts();

    // PERFORMANCE: Lightweight uniform update without shader rebuild
    window.updateUniformsOnly = function(nodeId, paramName, value) {
      // Live-refresh node-preview thumbnails during a parameter drag so they track the value in
      // real time like the main canvas. The drag handlers update node.params + the GPU uniform
      // here every mouse-move but only call onParameterChange on mouseup, so the preview path is
      // otherwise never invoked mid-drag. _liveDragPreviewUpdate is throttled internally, and
      // node.params is already set by the drag handler, so the render picks up the current value.
      const previewIntegration = window.editor?.previewIntegration;
      if (previewIntegration?._liveDragPreviewUpdate) {
        const node = window.graph?.getNode?.(nodeId)
          || window.editor?.graph?.nodes?.find((n) => n.id === nodeId);
        if (node) previewIntegration._liveDragPreviewUpdate(node);
      }

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

// Global function to trigger file load dialog
// This needs to be accessible from both setupUIEventHandlers and setupRhizomiumMenu
// Prefers the native file picker (so an opened project becomes the bound file
// and later "Save" writes straight back to it); falls back to the hidden input.
async function triggerFileLoad() {
  if (saveLoadManager?.pickProjectFile) {
    try {
      const file = await saveLoadManager.pickProjectFile();
      if (file) {
        await loadProjectFromFile(file);
        return;
      }
      // null can mean "cancelled" or "picker unavailable". Only fall through to
      // the hidden input when the API isn't supported at all.
      if (saveLoadManager.supportsFileSystemAccess && typeof window.showOpenFilePicker === "function") {
        return; // user cancelled the native dialog
      }
    } catch (error) {
      console.error("Open via picker failed, falling back to file input:", error);
    }
  }

  const fileInput = document.getElementById("file-import");
  if (fileInput) {
    fileInput.value = "";
    setTimeout(() => {
      fileInput.click();
    }, 10);
  }
}

// Expose globally to ensure it's accessible everywhere
window.triggerFileLoad = triggerFileLoad;

// Load a project File into the editor and run the post-load graph refresh.
// Shared by the hidden <input> path and the native open picker.
async function loadProjectFromFile(file) {
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
        (node) => node.inputs && node.inputs.some((input) => input !== null),
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
              size: preview.size || "large",
              showVisualInfo: preview.showVisualInfo !== false,
              needsUpdate: true,
            });
          } else {
            // No saved per-node entry: seed from the per-kind default so numeric nodes load with
            // their thumbnail hidden (visual/compute nodes stay visible), matching freshly created
            // nodes which have no entry at all.
            editor.nodePreviews.set(node.id, {
              enabled: editor.defaultNodePreviewEnabled
                ? editor.defaultNodePreviewEnabled(node)
                : true,
              size: "large",
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
}
window.loadProjectFromFile = loadProjectFromFile;

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
        // Don't close if clicking on checkbox, input, select, label, submenu items, or within submenu
        if (e.target.matches('input, select, label, .snap-controls, .snap-controls *, .menu-item-with-submenu *, .submenu-button, .submenu-toggle, .submenu-section *')) {
          e.stopPropagation();
          return;
        }
        // Close dropdown if clicking on a button (but not submenu buttons)
        if (e.target.closest('button') && !e.target.closest('.menu-item-with-submenu')) {
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
      saveLoadManager.saveProject();
    });
  }

  // Load Project button (old ID for backward compatibility)
  const loadBtn = removeExistingHandlers("btn-load");
  if (loadBtn) {
    loadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      triggerFileLoad();
    });
  }
  // Open Project button (new ID - also handled in setupRhizomiumMenu)

  // File input change handler. The hidden <input> path has no writable handle,
  // so clear any previously bound file before loading this one.
  const fileInput = removeExistingHandlers("file-import");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        if (saveLoadManager) saveLoadManager.currentFileHandle = null;
        await loadProjectFromFile(file);
        e.target.value = "";
      }
    });
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

  // Second-monitor full-screen viewer (Vite/desktop build only).
  // The button and its separator ship hidden in editor/index.html and are only
  // revealed here when running the Vite build with the viewer instantiated.
  const secondMonitorBtn = removeExistingHandlers("btn-second-monitor");
  if (secondMonitorBtn && isViteBuild() && secondMonitorViewer) {
    document.getElementById("sep-second-monitor")?.style.removeProperty("display");
    secondMonitorBtn.style.removeProperty("display");
    setSecondMonitorButtonState(secondMonitorViewer.isActive);

    secondMonitorBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await secondMonitorViewer.toggle();
      } catch (error) {
        console.error('[main.js] Error toggling second-monitor viewer:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Second-monitor viewer error: " + error.message, "error");
        }
      }
    });

    // Compute-resolution control for the second viewer. The viewer is independent
    // of the floating preview: Auto (0, default) renders at the viewer display's
    // own resolution, a fixed long-edge at that detail (up to 2048). "Match
    // editor" (-1) is the explicit opt-in that follows the editor's
    // preview-derived size for exact feedback-sim matching.
    const secondMonitorResRow = document.getElementById("row-second-monitor-res");
    const secondMonitorResSel = removeExistingHandlers("second-monitor-res");
    if (secondMonitorResRow && secondMonitorResSel
        && typeof secondMonitorViewer.setComputeResolution === "function") {
      secondMonitorResRow.style.removeProperty("display");
      if (Number.isFinite(secondMonitorViewer.computeMaxDim)) {
        secondMonitorResSel.value = String(secondMonitorViewer.computeMaxDim);
      }
      secondMonitorResSel.addEventListener("change", (e) => {
        const maxDim = parseInt(e.target.value, 10);
        if (Number.isFinite(maxDim)) secondMonitorViewer.setComputeResolution(maxDim);
      });
    }
  }

  // Resolution selector (removed - resolution settings now in Preview/Export Settings window)
  // The resolution selector functionality has been moved to the Preview/Export Settings window

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

  // File Manager button
  const fileManagerBtn = removeExistingHandlers("btn-file-manager");
  if (fileManagerBtn && fileManager) {
    fileManagerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      fileManager.show();
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

  // Setup new Rhizomium menu structure handlers
  setupRhizomiumMenu();
}

function setupPreviewSettingsMenu() {
  if (!window.floatingPreview || !window.floatingPreview.settings) {
    console.warn("Preview settings not available");
    return;
  }

  const settings = window.floatingPreview.settings;
  const previewSettings = settings.settings;

  // Submenu hover behavior
  const submenuTrigger = document.getElementById("preview-settings-trigger");
  const submenu = document.getElementById("preview-settings-submenu");
  
  if (submenuTrigger && submenu) {
    let submenuTimeout = null;
    
    submenuTrigger.addEventListener("mouseenter", () => {
      clearTimeout(submenuTimeout);
      submenu.classList.add("show");
    });
    
    submenuTrigger.addEventListener("mouseleave", () => {
      submenuTimeout = setTimeout(() => {
        submenu.classList.remove("show");
      }, 200);
    });
    
    submenu.addEventListener("mouseenter", () => {
      clearTimeout(submenuTimeout);
    });
    
    submenu.addEventListener("mouseleave", () => {
      submenu.classList.remove("show");
    });
  }

  // Display Options - Show Grid
  const showGridCheckbox = document.getElementById("preview-show-grid");
  if (showGridCheckbox) {
    showGridCheckbox.checked = previewSettings.showGrid || false;
    showGridCheckbox.addEventListener("change", (e) => {
      settings.updateSetting("showGrid", e.target.checked);
      // TODO: Implement grid display in editor
    });
  }

  // Display Options - Show Wireframe
  const showWireframeCheckbox = document.getElementById("preview-show-wireframe");
  if (showWireframeCheckbox) {
    showWireframeCheckbox.checked = previewSettings.wireframe || false;
    showWireframeCheckbox.addEventListener("change", (e) => {
      settings.updateSetting("wireframe", e.target.checked);
    });
  }

  // Display Options - Show Node Previews
  const showNodePreviewsCheckbox = document.getElementById("preview-show-node-previews");
  if (showNodePreviewsCheckbox) {
    // Default to true if editor has node previews enabled
    const nodePreviewsEnabled = window.editor?.nodePreviews?.size > 0;
    showNodePreviewsCheckbox.checked = previewSettings.showNodePreviews !== false && nodePreviewsEnabled;
    showNodePreviewsCheckbox.addEventListener("change", (e) => {
      settings.updateSetting("showNodePreviews", e.target.checked);
      // TODO: Toggle node previews globally
    });
  }

  // Resolution / Quality - Resolution Dropdown
  const resolutionSelect = document.getElementById("preview-resolution");
  if (resolutionSelect) {
    const currentRes = previewSettings.resolution || { width: 1920, height: 1080 };
    if (currentRes.width === 1280 && currentRes.height === 720) {
      resolutionSelect.value = "720p";
    } else if (currentRes.width === 1920 && currentRes.height === 1080) {
      resolutionSelect.value = "1080p";
    } else if (currentRes.width === 3840 && currentRes.height === 2160) {
      resolutionSelect.value = "4k";
    } else {
      resolutionSelect.value = "custom";
    }

    resolutionSelect.addEventListener("change", (e) => {
      const resMap = {
        "720p": { width: 1280, height: 720 },
        "1080p": { width: 1920, height: 1080 },
        "4k": { width: 3840, height: 2160 },
      };
      
      if (resMap[e.target.value]) {
        settings.updateSetting("resolution.width", resMap[e.target.value].width);
        settings.updateSetting("resolution.height", resMap[e.target.value].height);
      }
    });
  }

  // Resolution / Quality - Anti-Aliasing Slider
  const aaSlider = document.getElementById("preview-aa");
  const aaValue = document.getElementById("preview-aa-value");
  if (aaSlider && aaValue) {
    aaSlider.value = previewSettings.antiAliasing || 2;
    aaValue.textContent = `${aaSlider.value}x`;
    aaSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      aaValue.textContent = `${value}x`;
      settings.updateSetting("antiAliasing", value);
      // TODO: Apply anti-aliasing to renderer
    });
  }

  // Animation Settings - Frame Range
  const startFrameInput = document.getElementById("preview-start-frame");
  const endFrameInput = document.getElementById("preview-end-frame");
  if (startFrameInput) {
    startFrameInput.value = previewSettings.startFrame || 0;
    startFrameInput.addEventListener("change", (e) => {
      const value = parseInt(e.target.value) || 0;
      settings.updateSetting("startFrame", value);
      // TODO: Apply frame range to animation
    });
  }
  if (endFrameInput) {
    endFrameInput.value = previewSettings.endFrame || 60;
    endFrameInput.addEventListener("change", (e) => {
      const value = parseInt(e.target.value) || 60;
      settings.updateSetting("endFrame", value);
      // TODO: Apply frame range to animation
    });
  }

  // Animation Settings - FPS
  const fpsInput = document.getElementById("preview-fps");
  if (fpsInput) {
    fpsInput.value = previewSettings.refreshRate || 60;
    fpsInput.addEventListener("change", (e) => {
      const value = parseInt(e.target.value) || 60;
      settings.updateSetting("refreshRate", Math.min(60, Math.max(1, value)));
    });
  }

  // Animation Settings - Loop / Play Options
  const loopCheckbox = document.getElementById("preview-loop");
  if (loopCheckbox) {
    loopCheckbox.checked = previewSettings.loop !== false;
    loopCheckbox.addEventListener("change", (e) => {
      settings.updateSetting("loop", e.target.checked);
      // TODO: Apply loop setting
    });
  }

  // Export / Publish - Export PNG
  const exportPngBtn = document.getElementById("preview-export-png");
  if (exportPngBtn) {
    exportPngBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (settings._exportPNG) {
        await settings._exportPNG();
      }
    });
  }

  // Export / Publish - Export Animation
  const exportAnimBtn = document.getElementById("preview-export-animation");
  if (exportAnimBtn) {
    exportAnimBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (settings._exportAnimation) {
        await settings._exportAnimation();
      }
    });
  }

  // Export / Publish - Publish Image
  const publishImageBtn = document.getElementById("preview-publish-image");
  if (publishImageBtn) {
    publishImageBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (settings._publishImage) {
        await settings._publishImage();
      }
    });
  }

  // Export / Publish - Publish Animation
  const publishAnimBtn = document.getElementById("preview-publish-animation");
  if (publishAnimBtn) {
    publishAnimBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (settings._publishAnimation) {
        await settings._publishAnimation();
      }
    });
  }

  // Advanced Settings - Alpha Channel
  const alphaChannelCheckbox = document.getElementById("preview-alpha-channel");
  if (alphaChannelCheckbox) {
    alphaChannelCheckbox.checked = previewSettings.alphaChannel || false;
    alphaChannelCheckbox.addEventListener("change", (e) => {
      settings.updateSetting("alphaChannel", e.target.checked);
      // TODO: Apply alpha channel setting
    });
  }

  // Advanced Settings - Compression Level
  const compressionSlider = document.getElementById("preview-compression");
  const compressionValue = document.getElementById("preview-compression-value");
  if (compressionSlider && compressionValue) {
    compressionSlider.value = previewSettings.compression || 90;
    compressionValue.textContent = `${compressionSlider.value}%`;
    compressionSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      compressionValue.textContent = `${value}%`;
      settings.updateSetting("compression", value);
      // TODO: Apply compression when exporting
    });
  }

  // Advanced Settings - GPU Precision
  const gpuPrecisionSelect = document.getElementById("preview-gpu-precision");
  if (gpuPrecisionSelect) {
    gpuPrecisionSelect.value = previewSettings.quality || "high";
    gpuPrecisionSelect.addEventListener("change", (e) => {
      settings.updateSetting("quality", e.target.value);
    });
  }

  // Miscellaneous - Reset to Defaults
  const resetBtn = document.getElementById("preview-reset-defaults");
  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Reset all settings to defaults
      const defaults = {
        resolution: { width: 1920, height: 1080 },
        refreshRate: 60,
        wireframe: false,
        showGrid: false,
        showNodePreviews: true,
        debugChannel: "none",
        timeScale: 1.0,
        isPaused: false,
        quality: "high",
        showFPS: false,
        antiAliasing: 2,
        startFrame: 0,
        endFrame: 60,
        loop: true,
        alphaChannel: false,
        compression: 90,
      };

      Object.keys(defaults).forEach((key) => {
        if (key === "resolution") {
          settings.updateSetting("resolution.width", defaults[key].width);
          settings.updateSetting("resolution.height", defaults[key].height);
        } else {
          settings.updateSetting(key, defaults[key]);
        }
      });

      // Update UI elements
      if (showGridCheckbox) showGridCheckbox.checked = defaults.showGrid;
      if (showWireframeCheckbox) showWireframeCheckbox.checked = defaults.wireframe;
      if (showNodePreviewsCheckbox) showNodePreviewsCheckbox.checked = defaults.showNodePreviews;
      if (resolutionSelect) resolutionSelect.value = "1080p";
      if (aaSlider) {
        aaSlider.value = defaults.antiAliasing;
        if (aaValue) aaValue.textContent = `${defaults.antiAliasing}x`;
      }
      if (startFrameInput) startFrameInput.value = defaults.startFrame;
      if (endFrameInput) endFrameInput.value = defaults.endFrame;
      if (fpsInput) fpsInput.value = defaults.refreshRate;
      if (loopCheckbox) loopCheckbox.checked = defaults.loop;
      if (alphaChannelCheckbox) alphaChannelCheckbox.checked = defaults.alphaChannel;
      if (compressionSlider) {
        compressionSlider.value = defaults.compression;
        if (compressionValue) compressionValue.textContent = `${defaults.compression}%`;
      }
      if (gpuPrecisionSelect) gpuPrecisionSelect.value = defaults.quality;

      if (typeof updateStatus === "function") {
        updateStatus("Preview settings reset to defaults");
      }
    });
  }
}

// Export Window Manager
let exportWindow = null;

function showExportWindow() {
  if (exportWindow) {
    exportWindow.style.display = "flex";
    exportWindow.style.opacity = "1";
    exportWindow.style.transform = "translate(-50%, -50%) scale(1)";
    return;
  }

  exportWindow = document.createElement("div");
  exportWindow.id = "export-window";
  exportWindow.style.cssText = `
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 320px;
    background: rgba(28, 28, 30, 0.98);
    backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.95);
    transition: all 0.2s ease;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
  `;

  const title = document.createElement("div");
  title.textContent = "Export";
  title.style.cssText = "color: #fff; font-size: 14px; font-weight: 600;";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
    background: transparent;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 18px;
    padding: 4px;
    border-radius: 4px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  closeBtn.onclick = () => hideExportWindow();

  header.appendChild(title);
  header.appendChild(closeBtn);

  const content = document.createElement("div");
  content.style.cssText = "padding: 16px; display: flex; flex-direction: column; gap: 12px;";

  const exportPngBtn = document.createElement("button");
  exportPngBtn.textContent = "Export as PNG";
  exportPngBtn.className = "submenu-button";
  exportPngBtn.style.cssText = `
    width: 100%;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  `;
  exportPngBtn.onmouseenter = () => {
    exportPngBtn.style.background = "rgba(255, 255, 255, 0.15)";
  };
  exportPngBtn.onmouseleave = () => {
    exportPngBtn.style.background = "rgba(255, 255, 255, 0.1)";
  };
  exportPngBtn.onclick = async () => {
    if (window.floatingPreview?.settings?._exportPNG) {
      await window.floatingPreview.settings._exportPNG();
    }
  };

  const exportAnimBtn = document.createElement("button");
  exportAnimBtn.textContent = "Export Animation (WebM)";
  exportAnimBtn.className = "submenu-button";
  exportAnimBtn.style.cssText = `
    width: 100%;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  `;
  exportAnimBtn.onmouseenter = () => {
    exportAnimBtn.style.background = "rgba(255, 255, 255, 0.15)";
  };
  exportAnimBtn.onmouseleave = () => {
    exportAnimBtn.style.background = "rgba(255, 255, 255, 0.1)";
  };
  exportAnimBtn.onclick = async () => {
    if (window.floatingPreview?.settings?._exportAnimation) {
      await window.floatingPreview.settings._exportAnimation();
    }
  };

  content.appendChild(exportPngBtn);
  content.appendChild(exportAnimBtn);

  exportWindow.appendChild(header);
  exportWindow.appendChild(content);
  document.body.appendChild(exportWindow);

  // Make draggable
  import('./src/ui/utils/draggable.js').then(({ makeDraggable }) => {
    makeDraggable(exportWindow, header);
  }).catch(() => {
    // Fallback if draggable fails
    console.warn("Could not make export window draggable");
  });

  requestAnimationFrame(() => {
    exportWindow.style.opacity = "1";
    exportWindow.style.transform = "translate(-50%, -50%) scale(1)";
  });
}

function hideExportWindow() {
  if (exportWindow) {
    exportWindow.style.opacity = "0";
    exportWindow.style.transform = "translate(-50%, -50%) scale(0.95)";
    setTimeout(() => {
      if (exportWindow) {
        exportWindow.style.display = "none";
      }
    }, 200);
  }
}

function setupRhizomiumMenu() {
  if (!saveLoadManager || !editor || !graph) {
    console.warn("Required components not available for menu setup");
    return;
  }

  // ========== FILE MENU ==========
  
  // New Project
  const newProjectBtn = document.getElementById("btn-new-project");
  if (newProjectBtn) {
    newProjectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement new project functionality
      if (typeof createNewProject === "function") {
        createNewProject();
      } else {
        console.warn("createNewProject function not available");
      }
    });
  }

  // Open Project (maps to existing Load Project)
  const openProjectBtn = document.getElementById("btn-open-project");
  if (openProjectBtn) {
    openProjectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof triggerFileLoad === 'function') {
        triggerFileLoad();
      } else if (typeof window.triggerFileLoad === 'function') {
        window.triggerFileLoad();
      } else {
        console.error('triggerFileLoad is not defined');
      }
    });
  }

  // Save (maps to existing Save Project)
  // Save button already handled above, but updating ID if needed
  const saveBtnNew = document.getElementById("btn-save");
  if (saveBtnNew && !saveBtnNew.hasAttribute("data-handler-attached")) {
    saveBtnNew.setAttribute("data-handler-attached", "true");
    saveBtnNew.addEventListener("click", (e) => {
      e.preventDefault();
      saveLoadManager.saveProject();
    });
  }

  // Save As - always prompts for a new location/name.
  const saveAsBtn = document.getElementById("btn-save-as");
  if (saveAsBtn) {
    saveAsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveLoadManager.saveProjectAs();
    });
  }

  // Export button - opens export window
  const exportBtn = document.getElementById("btn-export");
  if (exportBtn) {
    exportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showExportWindow();
    });
  }

  // Publish
  const publishBtn = document.getElementById("btn-publish");
  if (publishBtn) {
    publishBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = document.getElementById("publish-target")?.value || "tenderworld";
      const includePreviews = document.getElementById("publish-include-previews")?.checked || false;
      const commitMessage = document.getElementById("publish-commit-message")?.value || "";
      // TODO: Implement publish to cloud/server
      if (typeof updateStatus === "function") {
        updateStatus(`Publish to ${target}: Feature coming soon`);
      }
    });
  }

  // Exit
  const exitBtn = document.getElementById("btn-exit");
  if (exitBtn) {
    exitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Check for unsaved changes before exit
      if (typeof updateStatus === "function") {
        updateStatus("Exit: Close browser tab to exit");
      }
    });
  }

  // ========== EDIT MENU ==========
  
  // Cut (uses existing selection manager)
  const cutBtn = document.getElementById("btn-cut");
  if (cutBtn && editor?.selection) {
    cutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.selection.copySelected && editor.selection.deleteSelected) {
        editor.selection.copySelected();
        editor.selection.deleteSelected();
        if (typeof updateStatus === "function") {
          updateStatus("Cut selected nodes");
        }
      }
    });
  }

  // Copy (uses existing selection manager)
  const copyBtn = document.getElementById("btn-copy");
  if (copyBtn && editor?.selection) {
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.selection.copySelected) {
        editor.selection.copySelected();
        if (typeof updateStatus === "function") {
          updateStatus("Copied selected nodes");
        }
      }
    });
  }

  // Paste (uses existing selection manager)
  const pasteBtn = document.getElementById("btn-paste");
  if (pasteBtn && editor?.selection) {
    pasteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.selection.pasteFromClipboard) {
        editor.selection.pasteFromClipboard();
        if (typeof updateStatus === "function") {
          updateStatus("Pasted nodes");
        }
      }
    });
  }

  // Delete (uses existing selection manager)
  const deleteBtn = document.getElementById("btn-delete");
  if (deleteBtn && editor?.selection) {
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.selection.deleteSelected) {
        editor.selection.deleteSelected();
        if (typeof updateStatus === "function") {
          updateStatus("Deleted selected nodes");
        }
      }
    });
  }

  // Preferences
  const preferencesBtn = document.getElementById("btn-preferences");
  if (preferencesBtn && window.preferencesWindow) {
    preferencesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.preferencesWindow.show();
      if (typeof updateStatus === "function") {
        updateStatus("Preferences opened");
      }
    });
  }

  // ========== VIEW MENU ==========
  
  // Toggle ParamPanel
  const toggleParamPanelBtn = document.getElementById("btn-toggle-param-panel");
  if (toggleParamPanelBtn && editor?.paramPanel) {
    toggleParamPanelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Toggle param panel visibility
      const panel = editor.paramPanel.panel;
      if (panel) {
        const isHidden = panel.style?.display === "none" || panel.offsetParent === null;
        if (isHidden && editor.paramPanel.showNodeParameters) {
          const selected = editor.selection?.getSelected?.();
          if (selected && selected.size === 1) {
            const nodeId = selected.values().next().value;
            const node = editor.graph?.nodes?.find((n) => n.id === nodeId);
            if (node) {
              editor.paramPanel.showNodeParameters(node);
            }
          }
        } else {
          panel.style.display = isHidden ? "block" : "none";
        }
        if (typeof updateStatus === "function") {
          updateStatus(isHidden ? "ParamPanel shown" : "ParamPanel hidden");
        }
      }
    });
  }

  // Toggle 3D Viewport (same window as Ctrl/Cmd+3)
  const toggle3DViewportBtn = document.getElementById("btn-toggle-3d-viewport");
  if (toggle3DViewportBtn) {
    toggle3DViewportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (viewportPanel) {
        viewportPanel.toggle();
        if (typeof updateStatus === "function") {
          updateStatus(viewportPanel.isVisible ? "3D Viewport opened" : "3D Viewport closed");
        }
      } else if (typeof updateStatus === "function") {
        updateStatus("3D Viewport not available", "warning");
      }
    });
  }

  // Toggle Preview Panel
  const togglePreviewPanelBtn = document.getElementById("btn-toggle-preview-panel");
  if (togglePreviewPanelBtn && window.floatingPreview) {
    togglePreviewPanelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.floatingPreview.toggle) {
        window.floatingPreview.toggle();
        if (typeof updateStatus === "function") {
          updateStatus(window.floatingPreview.isVisible ? "Preview Panel shown" : "Preview Panel hidden");
        }
      }
    });
  }

  // Preview / Export Settings - opens as window
  const previewExportSettingsBtn = document.getElementById("btn-preview-export-settings");
  if (previewExportSettingsBtn && window.previewExportSettingsWindow) {
    previewExportSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.previewExportSettingsWindow.show();
      if (typeof updateStatus === "function") {
        updateStatus("Preview / Export Settings opened");
      }
    });
  }

  // Zoom In
  const zoomInBtn = document.getElementById("btn-zoom-in");
  if (zoomInBtn && editor?.viewport) {
    zoomInBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const canvas = editor.canvas;
      if (canvas && editor.viewport.zoom) {
        const rect = canvas.getBoundingClientRect();
        editor.viewport.zoom(rect.width / 2, rect.height / 2, -1);
        editor.draw();
        if (typeof updateStatus === "function") {
          updateStatus("Zoomed in");
        }
      }
    });
  }

  // Zoom Out
  const zoomOutBtn = document.getElementById("btn-zoom-out");
  if (zoomOutBtn && editor?.viewport) {
    zoomOutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const canvas = editor.canvas;
      if (canvas && editor.viewport.zoom) {
        const rect = canvas.getBoundingClientRect();
        editor.viewport.zoom(rect.width / 2, rect.height / 2, 1);
        editor.draw();
        if (typeof updateStatus === "function") {
          updateStatus("Zoomed out");
        }
      }
    });
  }

  // Reset Zoom
  const zoomResetBtn = document.getElementById("btn-zoom-reset");
  if (zoomResetBtn && editor?.viewport) {
    zoomResetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.viewport) {
        editor.viewport.scale = 1;
        editor.viewport.offsetX = 0;
        editor.viewport.offsetY = 0;
        editor.draw();
        if (typeof updateStatus === "function") {
          updateStatus("Zoom reset");
        }
      }
    });
  }

  // View Show Grid
  const viewShowGridCheckbox = document.getElementById("view-show-grid");
  if (viewShowGridCheckbox) {
    viewShowGridCheckbox.checked = true; // Default
    viewShowGridCheckbox.addEventListener("change", (e) => {
      // TODO: Implement grid visibility toggle
      if (typeof updateStatus === "function") {
        updateStatus(`Grid ${e.target.checked ? "shown" : "hidden"}`);
      }
    });
  }

  // ========== NODE MENU ==========
  
  // Create Node (opens node creation menu)
  const createNodeBtn = document.getElementById("btn-create-node");
  if (createNodeBtn && editor?.menu) {
    createNodeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.menu.showCreateMenu && editor.viewport && editor.canvas) {
        const rect = editor.canvas.getBoundingClientRect();
        const localX = rect.width / 2;
        const localY = rect.height / 2;
        const canvasPos = editor.viewport.screenToCanvas(localX, localY);
        editor.menu.showCreateMenu(canvasPos.x, canvasPos.y, rect.left + localX, rect.top + localY);
        if (typeof updateStatus === "function") {
          updateStatus("Node creation menu opened");
        }
      }
    });
  }

  // Delete Node (uses selection)
  const deleteNodeBtn = document.getElementById("btn-delete-node");
  if (deleteNodeBtn && editor?.selection) {
    deleteNodeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.selection.deleteSelected) {
        editor.selection.deleteSelected();
        if (typeof updateStatus === "function") {
          updateStatus("Deleted selected node(s)");
        }
      }
    });
  }

  // Duplicate Node
  const duplicateNodeBtn = document.getElementById("btn-duplicate-node");
  if (duplicateNodeBtn && editor?.selection) {
    duplicateNodeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editor.selection.copySelected && editor.selection.pasteFromClipboard) {
        editor.selection.copySelected();
        editor.selection.pasteFromClipboard();
        if (typeof updateStatus === "function") {
          updateStatus("Duplicated selected node(s)");
        }
      }
    });
  }

  // Connect Pins
  const connectPinsBtn = document.getElementById("btn-connect-pins");
  if (connectPinsBtn) {
    connectPinsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement connect pins functionality
      if (typeof updateStatus === "function") {
        updateStatus("Connect Pins: Feature coming soon");
      }
    });
  }

  // Disconnect Pins
  const disconnectPinsBtn = document.getElementById("btn-disconnect-pins");
  if (disconnectPinsBtn) {
    disconnectPinsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement disconnect pins functionality
      if (typeof updateStatus === "function") {
        updateStatus("Disconnect Pins: Feature coming soon");
      }
    });
  }

  // Node Settings
  const nodeSettingsBtn = document.getElementById("btn-node-settings");
  if (nodeSettingsBtn && editor?.paramPanel) {
    nodeSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const selected = editor.selection?.getSelected?.();
      if (selected && selected.size === 1 && editor.paramPanel.showNodeParameters) {
        const nodeId = selected.values().next().value;
        const node = editor.graph?.nodes?.find((n) => n.id === nodeId);
        if (node) {
          editor.paramPanel.showNodeParameters(node);
          if (typeof updateStatus === "function") {
            updateStatus("Opened node settings");
          }
        }
      } else if (typeof updateStatus === "function") {
        updateStatus("Select a single node to view settings");
      }
    });
  }

  // ========== TOOLS MENU ==========
  
  // Script Editor
  const scriptEditorBtn = document.getElementById("btn-script-editor");
  if (scriptEditorBtn) {
    scriptEditorBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement script editor
      if (typeof updateStatus === "function") {
        updateStatus("Script Editor: Feature coming soon");
      }
    });
  }

  // Shader Compiler
  const shaderCompilerBtn = document.getElementById("btn-shader-compiler");
  if (shaderCompilerBtn) {
    shaderCompilerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement shader compiler tool
      if (typeof updateStatus === "function") {
        updateStatus("Shader Compiler: Feature coming soon");
      }
    });
  }

  // GLSL Utilities
  const glslUtilitiesBtn = document.getElementById("btn-glsl-utilities");
  if (glslUtilitiesBtn) {
    glslUtilitiesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement GLSL utilities
      if (typeof updateStatus === "function") {
        updateStatus("GLSL Utilities: Feature coming soon");
      }
    });
  }

  // Audio Settings and MIDI Settings are already handled in setupUIEventHandlers()
  // They use removeExistingHandlers() so they'll work with the new menu structure

  // ========== WINDOW MENU ==========
  
  // Layout Default
  const layoutDefaultBtn = document.getElementById("btn-layout-default");
  if (layoutDefaultBtn) {
    layoutDefaultBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement layout system
      if (typeof updateStatus === "function") {
        updateStatus("Default Layout: Feature coming soon");
      }
    });
  }

  // Layout Custom
  const layoutCustomBtn = document.getElementById("btn-layout-custom");
  if (layoutCustomBtn) {
    layoutCustomBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement custom layout
      if (typeof updateStatus === "function") {
        updateStatus("Custom Layout: Feature coming soon");
      }
    });
  }

  // Layout Minimal
  const layoutMinimalBtn = document.getElementById("btn-layout-minimal");
  if (layoutMinimalBtn) {
    layoutMinimalBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement minimal layout
      if (typeof updateStatus === "function") {
        updateStatus("Minimal Layout: Feature coming soon");
      }
    });
  }

  // Floating Windows
  const floatingWindowsBtn = document.getElementById("btn-floating-windows");
  if (floatingWindowsBtn) {
    floatingWindowsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Implement floating windows manager
      if (typeof updateStatus === "function") {
        updateStatus("Floating Windows: Feature coming soon");
      }
    });
  }

  // Reset Layout
  const resetLayoutBtn = document.getElementById("btn-reset-layout");
  if (resetLayoutBtn) {
    resetLayoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Reset all panel positions
      if (typeof updateStatus === "function") {
        updateStatus("Layout reset: Feature coming soon");
      }
    });
  }

  // ========== HELP MENU ==========
  
  // Documentation
  const documentationBtn = document.getElementById("btn-documentation");
  if (documentationBtn) {
    documentationBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Open documentation
      window.open("https://github.com/your-repo/docs", "_blank");
      if (typeof updateStatus === "function") {
        updateStatus("Opening documentation...");
      }
    });
  }

  // Shortcuts
  const shortcutsBtn = document.getElementById("btn-shortcuts");
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Show shortcuts/keymap dialog
      if (typeof updateStatus === "function") {
        updateStatus("Shortcuts: Feature coming soon");
      }
    });
  }

  // About
  const aboutBtn = document.getElementById("btn-about");
  if (aboutBtn) {
    aboutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // TODO: Show about dialog
      alert("Rhizomium\nGLSL Node Editor\nVersion 1.0");
      if (typeof updateStatus === "function") {
        updateStatus("About Rhizomium");
      }
    });
  }

  // Setup nested submenu hover behavior for all submenus
  setupNestedSubmenuHover();
}


function setupNestedSubmenuHover() {
  const submenuTriggers = document.querySelectorAll(".menu-submenu-trigger");
  
  submenuTriggers.forEach((trigger) => {
    const submenu = trigger.nextElementSibling;
    if (!submenu || !submenu.classList.contains("menu-submenu")) return;
    
    let submenuTimeout = null;
    
    trigger.addEventListener("mouseenter", () => {
      clearTimeout(submenuTimeout);
      submenu.classList.add("show");
    });
    
    trigger.addEventListener("mouseleave", () => {
      submenuTimeout = setTimeout(() => {
        submenu.classList.remove("show");
      }, 200);
    });
    
    submenu.addEventListener("mouseenter", () => {
      clearTimeout(submenuTimeout);
    });
    
    submenu.addEventListener("mouseleave", () => {
      submenu.classList.remove("show");
    });
  });
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
        // If the user has selected text (e.g. a parameter value, a computed
        // result readout, or a label in the parameter panel), let the browser
        // copy that text instead of hijacking Ctrl/Cmd+C to copy the node(s).
        const textSelection = window.getSelection?.();
        if (textSelection && textSelection.toString().trim().length > 0) {
          return;
        }
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
          // Ctrl/Cmd+Shift+S -> Save As (pick a new location/name)
          saveLoadManager?.saveProjectAs?.();
        } else {
          // Ctrl/Cmd+S -> Save (write back to the bound file)
          saveLoadManager?.saveProject?.();
        }
        break;

      case "o":
        e.preventDefault();
        if (typeof triggerFileLoad === "function") {
          triggerFileLoad();
          break;
        }
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

  // Regenerate node thumbnails for the freshly created graph. createSeedGraph() makes brand-new
  // node objects with no __thumb, and nothing else here triggers preview generation, so without
  // this the nodes render as empty placeholders. updateAllPreviews() routes through the GPU
  // funnel in PreviewSystem.generateNodePreview.
  if (editor?.previewIntegration?.updateAllPreviews) {
    editor.previewIntegration.updateAllPreviews();
  } else if (editor?.previewSystem?.updateAllPreviews) {
    editor.previewSystem.updateAllPreviews(graph.nodes);
  }

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
    // Unbind from any previously opened file so the next Save prompts fresh.
    saveLoadManager.currentFileHandle = null;
    saveLoadManager.setProjectName(null);
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
let lastPreviewAnimationTime = null;
let lastPreviewStructureHash = null;
const PROFILER_UPDATE_INTERVAL = 200; // Update profiler overlay every 200ms (5 FPS)
const PREVIEW_UPDATE_INTERVAL = 100; // 10 FPS preview/dirty check cadence
const GPU_INTERACTION_REUSE_THRESHOLD = 16; // ms - reuse last GPU frame if render cost exceeds this during interactions

function computePreviewStructureHash(graph) {
  if (!graph || !Array.isArray(graph.nodes)) {
    return 'no-graph';
  }

  const nodeSignature = graph.nodes
    .filter(Boolean)
    .map((node) => {
      const inputs = (node.inputs || []).map((input) => input ?? 'null').join(',');
      const nodeKind = node.kind || node.type || 'unknown';
      return `${node.id ?? 'no-id'}:${nodeKind}:${inputs}`;
    })
    .sort()
    .join('|');

  const connectionSignature = (graph.connections || [])
    .filter(Boolean)
    .map((connection) => {
      const from = connection.fromNode ?? connection.from?.nodeId ?? connection.source ?? 'source';
      const to = connection.toNode ?? connection.to?.nodeId ?? connection.target ?? 'target';
      const pin = connection.toPin ?? connection.to?.input ?? connection.input ?? '0';
      return `${from}->${to}:${pin}`;
    })
    .sort()
    .join('|');

  return `${graph.nodes.length}:${graph.connections?.length ?? 0}:${nodeSignature}:${connectionSignature}`;
}

// Compute nodes that aren't wired into the output still need to be dispatched so their per-node
// preview thumbnails show real GPU output instead of a placeholder. When the graph has no connected
// OutputFinal, updateShaderFromGraph bails before buildWGSL / computeExecutor.initialize() ever run,
// so the compute nodes never get registered or dispatched. This helper performs just that work:
// buildWGSL registers the disconnected compute nodes into window.computeNodeRegistry (even when it
// can't compile a main shader), then computeExecutor.initialize() builds their managers and the
// render loop dispatches them every frame (gpuRenderer.render dispatches compute even with no main
// pipeline). It's a no-op when the graph has no compute nodes, so the common case pays nothing.
async function ensureDisconnectedComputePreviews() {
  try {
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return;
    const hasComputeNode = graph.nodes.some(
      (node) => node && typeof node.kind === "string" && node.kind.toLowerCase().startsWith("compute")
    );
    if (!hasComputeNode) return;

    // Side effect: registers disconnected compute nodes into window.computeNodeRegistry.
    buildWGSL(window.editor.graph);

    if (computeExecutor && window.computeNodeRegistry && window.computeNodeRegistry.size > 0) {
      await computeExecutor.initialize();
    }
  } catch (err) {
    // Non-fatal: previews simply fall back to the placeholder if this fails.
    console.warn("[main] Failed to prepare disconnected compute previews:", err);
  }
}

// ComputeFieldMapper nodes render into the 3D viewport, not the main shader, so they must be
// (re)processed on every graph edit - including when the graph has no wired OutputFinal, which
// is this node's recommended setup (compute chain -> field mapper, nothing to the output).
async function processFieldMapperNodes() {
  if (!fieldMapperIntegration || !graph || !graph.nodes) return;
  try {
    await fieldMapperIntegration.processFieldMappers(graph.nodes, graph.connections || []);
  } catch (error) {
    console.error("[main] Error processing field mappers:", error);
  }
}

async function updateShaderFromGraph() {
  try {
    // Every graph edit funnels through here - flag it so the 30s
    // autosave/backup loop has something to pick up (no-op during imports)
    saveLoadManager?.markUnsaved?.();

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
      // No output to render the main canvas, but compute nodes on the canvas still need their
      // per-node previews dispatched (otherwise they sit as placeholders until an output exists).
      await ensureDisconnectedComputePreviews();
      await processFieldMapperNodes();
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
      // The output isn't wired up yet, so the main shader can't compile — but a freshly placed
      // compute node should still preview its own output rather than a placeholder. Register and
      // dispatch the disconnected compute nodes so the render loop produces their thumbnails.
      await ensureDisconnectedComputePreviews();
      await processFieldMapperNodes();
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
    await processFieldMapperNodes();

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

/**
 * Reflect the second-monitor viewer's active/inactive state on its menu button.
 * Safe to call when the button is absent (non-Vite builds) — it no-ops.
 */
function setSecondMonitorButtonState(active) {
  const btn = document.getElementById("btn-second-monitor");
  if (!btn) return;
  btn.textContent = active ? "Close Second Monitor" : "Second Monitor Viewer";
  btn.style.backgroundColor = active ? "rgba(0, 170, 0, 0.8)" : "";
  btn.style.borderColor = active ? "rgba(0, 255, 0, 0.4)" : "";
}

function handleRenderFrame(frameState) {
  // PerfProbe: track real animation cadence; manual renders (warmup bursts,
  // renderNow calls) are counted separately so they show up as out-of-band work.
  if (frameState.manual) {
    perfProbe.count("manualRender");
  } else {
    perfProbe.tick();
  }
  previewPerfMonitor?.beginFrame(frameState);
  // PERFORMANCE: Skip expensive operations during parameter drag
  // When dragging parameters, we don't need to update anything
  // All updates happen once on mouseup
  const isDragging = editor?._parameterDragging || false;
  
  // PERFORMANCE: Track canvas interactions to throttle GPU rendering
  // This prevents GPU and canvas from competing for resources, causing FPS drops
  const isCanvasInteracting = editor?.eventHandler?.isCanvasInteracting?.() || false;
  const isPanning = editor?.eventHandler?.isPanning?.() || false;
  previewPerfMonitor?.recordInteractionState({ isCanvasInteracting, isDragging, isPanning });
  
  // Get interaction state manager to check throttling decisions
  const interactionStateManager = previewPerfMonitor?.getInteractionStateManager?.();
  const shouldThrottleTimeline = interactionStateManager?.shouldThrottleOperation('timeline') || false;
  const shouldThrottleUIPanels = interactionStateManager?.shouldThrottleOperation('uiPanels') || false;

  // PERFORMANCE: Skip expensive operations during drag/pan, but keep basic rendering
  // Update timeline manager (skip during panning/dragging)
  if (!shouldThrottleTimeline && !isDragging && timelineManager && timelineManager.isEnabled()) {
    timelineManager.update(frameState.deltaTime);
  }

  // Update timeline panel visualization (skip during panning/dragging)
  if (!shouldThrottleUIPanels && !isDragging && timelinePanel) {
    timelinePanel.update();
  }

  // GPU rendering - Always render every frame, even during interactions
  // PERFORMANCE: GPU renderer is async and non-blocking, so throttling is unnecessary
  // Frame skipping was causing compute profiler to show artificially low FPS
  // Reusing the last GPU frame during heavy interaction keeps dragging smooth,
  // but it skips gpuRenderer.render() — and with it computeExecutor.execute()
  // and the fragment auto-bridge — so an animated graph (audio/time-driven,
  // feedback sims, reference params) or a live 3D Field Visualizer visibly
  // freezes while you drag. Never reuse for those; they exist to keep moving.
  const graphIsAnimated =
    (window.computeExecutor?.isGraphAnimated?.() || false) ||
    (fieldMapperIntegration?.fieldMappers?.size > 0) ||
    !!window.audioCapture?.getIsPlaying?.();
  const gpuBudgetExceeded =
    isCanvasInteracting &&
    !graphIsAnimated &&
    (previewPerfMonitor?.getMetric("gpuMs") || 0) > GPU_INTERACTION_REUSE_THRESHOLD;
  previewPerfMonitor?.recordValue("gpuReuseActive", gpuBudgetExceeded ? 1 : 0);
  // Only skip GPU rendering if budget is exceeded (reuse last frame), otherwise render every frame
  const shouldRenderGPU = !gpuBudgetExceeded;
  
  // Advance the Hold (sample-and-hold) latch before dispatching the GPU frame so the held
  // value uniform reflects this frame's pulse. Runs every frame (not throttled like the
  // preview pass) so brief trigger pulses and rising edges aren't missed.
  if (window.editor?.graph && window.nodeCompiler?.uniformManager) {
    try {
      // Run kick/onset detection FIRST, on an unthrottled per-frame cadence so brief transients and
      // the rising edge of a kick aren't missed. Ordering matters: the Audio Analysis outputs
      // (level/kick/trig) feed the Hold/Count/Feedback processors below, so refreshing them here
      // means those consumers read this frame's values rather than the previous frame's.
      audioKickProcessor.update(window.editor.graph, {
        time: frameState.simTime,
        uniformManager: window.nodeCompiler.uniformManager,
      });
      holdNodeProcessor.update(window.editor.graph, {
        time: frameState.simTime,
        uniformManager: window.nodeCompiler.uniformManager,
      });
      // Advance the Count node's counter on the same cadence (every frame, unthrottled) so
      // rising edges of brief pulses aren't missed before the GPU frame is dispatched.
      countNodeProcessor.update(window.editor.graph, {
        time: frameState.simTime,
        uniformManager: window.nodeCompiler.uniformManager,
      });
      // Clear Feedback nodes whose Reset pin saw a rising edge this frame (e.g. a Trigger pulse).
      // Same unthrottled cadence so brief pulses aren't missed.
      feedbackResetProcessor.update(window.editor.graph, {
        time: frameState.simTime,
        computeExecutor: window.computeExecutor,
      });
    } catch (err) {
      // Never let the hold/count latch break the render loop.
    }
  }

  if (shouldRenderGPU) {
    const gpuToken = previewPerfMonitor?.timeSection("gpu");
    // Check if compute shader test is active
    if (computeShaderTest && computeShaderTest.isEnabled) {
      // Render compute shader test instead of normal renderer
      computeShaderTest.render(frameState.simTime);
      previewPerfMonitor?.endSection(gpuToken);
    } else if (window.gpuRenderer) {
      // ARCHITECTURAL FIX: Separate GPU and canvas rendering threads
      // GPU renderer is async and not awaited - it runs independently
      // This allows GPU work to proceed in parallel with canvas rendering
      // GPU renderer's sync work completes immediately, then async work proceeds
      // Canvas rendering can run without blocking GPU work continuation
      const gpuProbeToken = perfProbe.begin("gpuDispatchCpu");
      const renderPromise = window.gpuRenderer.render({ timeSec: frameState.simTime });
      perfProbe.end(gpuProbeToken);
      previewPerfMonitor?.endSection(gpuToken);
      previewPerfMonitor?.attachAsyncMetric("gpuQueueWaitMs", renderPromise);

      // NOTE: the preview FPS counter is NOT ticked here. Dispatching render()
      // happens at the loop's target cadence regardless of GPU load, so counting
      // dispatches pinned the label to ~60 even when heavy graphs ran far slower.
      // It is now ticked on actual GPU-frame completion via
      // gpuRenderer.onFramePresented (wired where floatingPreview is created).

      renderPromise.catch(err => {
        // Silently handle render errors to avoid breaking render loop
        // Errors are already logged in gpuRenderer.render()
      });

    }
  }

  // 3D scene rendering. Runs whenever a 3D Field Visualizer node exists -
  // not just while the viewport panel is open - because the rendered frame is
  // also the node's graph OUTPUT (own preview, downstream nodes, OutputFinal).
  const hasFieldMappers = fieldMapperIntegration && fieldMapperIntegration.fieldMappers.size > 0;
  if (sceneRenderer3D && (hasFieldMappers || (viewportPanel && viewportPanel.isVisible))) {
    // Regenerate points-mode geometry from the live compute textures so
    // animated fields keep moving. Async and self-guarded: if the previous
    // GPU readback is still in flight this is a no-op for the frame.
    // (GPU shape modes sample the compute texture in the render pass and
    // need no per-frame CPU work.)
    if (fieldMapperIntegration) {
      fieldMapperIntegration.updateFrame();
    }
    sceneRenderer3D.render(frameState.simTime);

    // Publish the rendered frame as each mapper node's output texture so
    // downstream nodes and the main canvas can consume the 3D view
    if (hasFieldMappers) {
      fieldMapperIntegration.publishOutputs(sceneRenderer3D.getSceneTexture?.());
    }

    // Mirror the rendered frame into the 3D node's editor thumbnail so it
    // stays live. Throttled: a readback 4x/sec is imperceptible on the tiny
    // thumbnail but keeps GPU->CPU traffic negligible.
    const now = performance.now();
    if (now - (window.__fieldMapperThumbAt || 0) > 250) {
      window.__fieldMapperThumbAt = now;
      const previewManager = window.editor?.shaderPreviewManager;
      if (previewManager && graph?.nodes) {
        // Pass a getter so the queue always downscales the CURRENT scene
        // texture, not one destroyed by a resolution change while queued
        const getSceneTexture = () => sceneRenderer3D?.getSceneTexture?.() ?? null;
        for (const node of graph.nodes) {
          if (node && node.kind === 'ComputeFieldMapper') {
            previewManager.updateNodeThumbnailFromTexture(node, getSceneTexture);
          }
        }
      }
    }
  }

  // Update viewport panel
  if (viewportPanel && viewportPanel.isVisible) {
    viewportPanel.update();
  }

  // FPS counter is handled by FloatingGPUPreview in its own render loop
  // This ensures it only counts actual preview refresh frames, not render loop frames

  // Update compute profiler overlay - Continue updating during interactions
  // FIX: Allow profiler to continue updating during panning to prevent freezing
  if (profilerOverlay && computeProfiler) {
    // Run the profiler only while its overlay is visible. Its per-frame GPU
    // timestamp readback (mapAsync) is a CPU<->GPU sync that periodically stalls the
    // shared GPU — which showed up as a hitch on the second-monitor output (both
    // windows freezing in lockstep). No display ⇒ no readback.
    if (computeProfiler.enabled !== profilerOverlay.visible) {
      computeProfiler.setEnabled(profilerOverlay.visible);
    }
    if (profilerOverlay.visible) {
      const now = performance.now();
      const shouldUpdateProfiler = (now - lastProfilerUpdate) >= PROFILER_UPDATE_INTERVAL;
      if (shouldUpdateProfiler) {
        const metrics = computeProfiler.getMetrics();
        profilerOverlay.update(metrics);
        lastProfilerUpdate = now;
      }
    }
  }

  // Undo UI updates (skip during panning/dragging)
  if (!shouldThrottleUIPanels && !isDragging && undoManager) {
    undoManager.updateUI();
  }

  // Update preview values and canvas for time/audio-based expressions
  // Only when actually animating (not manual updates)
  if (!frameState.manual) {
    // The preview pass is normally skipped while a parameter is being dragged
    // (keeps the drag smooth). But this pass is the ONLY thing that recomputes
    // node VALUES for a live reference chain — e.g. a Circle radius `=node_X`
    // where X is a Remap fed by a ConstFloat `=audioEnvelope`. `_freshenReferencedValues`
    // in the fragment bridge only refreshes the directly-referenced node, and
    // computeNodeValue can't evaluate a transitive chain (Remap isn't in its
    // switch, so it reads the frozen preview cache). So for an animated graph,
    // skipping this pass during a drag freezes the whole reference chain — and
    // with it the source fragment node (the Circle) and everything downstream.
    // Keep it alive when the graph is animated; it's throttled to 10 FPS and
    // runs in reduced-work interaction mode, so the drag stays responsive.
    if (!isDragging || graphIsAnimated) {
      const now = performance.now();
      if (now - lastPreviewUpdate >= PREVIEW_UPDATE_INTERVAL) {
        lastPreviewUpdate = now;

        if (editor?.previewComputer && editor?.graph) {
          const previewComputer = editor.previewComputer;
          const graphInstance = editor.graph;
          const animationTime = frameState.simTime || performance.now() / 1000;
          const expressionSystem = editor.expressionSystem || previewComputer.expressionSystem;
          // Count BOTH expression-time-animated nodes (=time / =audio, tracked in
          // timeAnimatedNodes) AND intrinsic clock nodes (Time / Random Value), which animate every
          // frame from g.time alone and so never register in timeAnimatedNodes. Without the
          // intrinsic check, a graph whose only animation is such a node never flags
          // needsPreviewCompute, so this loop never calls setInteractionMode — and the interaction
          // flag left set by a drag+tab node creation (that gesture has no balancing
          // interaction-end) is never cleared, freezing requestPreviewComputation and the node's
          // live value. hasActiveAnimations() short-circuits on timeAnimatedNodes, then on a cheap
          // intrinsic-kind scan, so this stays cheap.
          const hadTimeAnimatedNodes = (expressionSystem?.timeAnimatedNodes?.size || 0) > 0
            || (typeof editor.hasActiveAnimations === 'function' && editor.hasActiveAnimations());
          const timeChanged = hadTimeAnimatedNodes &&
            (lastPreviewAnimationTime === null || Math.abs(animationTime - lastPreviewAnimationTime) > 1e-4);

          const dirtyNodeCount = graphInstance?.dirtyNodes?.size ?? 0;
          const dirtyInputCount = graphInstance?.dirtyInputs?.size ?? 0;
          const parameterValuesChanged = (dirtyNodeCount + dirtyInputCount) > 0;

          const currentStructureHash = computePreviewStructureHash(graphInstance);
          const structureChanged = currentStructureHash !== lastPreviewStructureHash;
          if (structureChanged) {
            // Invalidate topological sort cache only when the structure hash truly changes
            lastPreviewStructureHash = currentStructureHash;
          }

          const explicitPreviewRequest = !!editor._needsPreviewUpdate;
          // Audio-reactive nodes change on the audio clock, not the sim clock, so `timeChanged`
          // (which tracks sim time) can be false every frame while the audio value is still moving —
          // leaving node value previews and =node_<id> readouts frozen even though the GPU output
          // reacts. When audio is playing, recompute the preview each frame so those stay live.
          const audioLive = !!(typeof window !== 'undefined' && window.audioCapture?.getIsPlaying?.());
          const needsPreviewCompute =
            (hadTimeAnimatedNodes && (timeChanged || audioLive)) ||
            parameterValuesChanged ||
            structureChanged ||
            explicitPreviewRequest;

          if (needsPreviewCompute) {
            const isCanvasInteracting = editor?.eventHandler?.isCanvasInteracting?.() || false;
            const queueManager = window.threadSeparationManager?.getQueueManager?.();
            const previewQueueSize = queueManager?.getQueueSize?.('previewComputer') || 0;
            const queueBacklogged = previewQueueSize > 5;

            if (!queueBacklogged) {
              if (previewComputer?.setInteractionMode) {
                previewComputer.setInteractionMode(isCanvasInteracting);
              }

              const finalizePreviewUpdate = () => {
                if (hadTimeAnimatedNodes && editor.markDirty) {
                  editor.markDirty('time-animation');
                }
                graphInstance.clearDirtyFlags?.();
                lastPreviewAnimationTime = animationTime;
              };

              try {
                // NOTE: requestPreviewComputation currently runs synchronously on
                // the main thread despite its name — the probe section makes that
                // cost visible in window.perfReport().
                if (typeof previewComputer.requestPreviewComputation === 'function') {
                  const previewProbeToken = perfProbe.begin("previewComputeCpu");
                  previewComputer.requestPreviewComputation(
                    graphInstance,
                    { time: animationTime },
                    {},
                    () => finalizePreviewUpdate()
                  );
                  perfProbe.end(previewProbeToken);
                } else {
                  // Fallback: defer with requestIdleCallback if worker not available
                  if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(() => {
                      previewComputer.computePreviews(graphInstance);
                      finalizePreviewUpdate();
                    }, { timeout: 100 });
                  } else {
                    previewComputer.computePreviews(graphInstance);
                    finalizePreviewUpdate();
                  }
                }
              } catch (err) {
                console.warn('[Performance] computePreviews error:', err);
              }

              editor._needsPreviewUpdate = false;
            } else {
              previewPerfMonitor?.recordValue?.('previewQueueSkip', 1);
            }
          }
        }
      }
    }

    // Reset interaction state cache at the start of each frame
    // This ensures fresh state values for the new frame
    if (editor?.eventHandler?._invalidateInteractionStateCache) {
      editor.eventHandler._invalidateInteractionStateCache();
    }

    // Canvas drawing - throttle during panning and skip when editor is clean
    const editorNeedsCanvasDraw = typeof editor?.isDirty === 'function'
      ? editor.isDirty()
      : !!editor?.draw;
    const sceneIsStatic = !editorNeedsCanvasDraw &&
      typeof editor?.isSceneStatic === 'function' &&
      editor.isSceneStatic(120);

    if (editorNeedsCanvasDraw && editor?.draw) {
      // PERFORMANCE: Always draw at 60fps during panning for smooth interaction
      // Even in empty graphs, panning should be smooth. Throttling causes choppy panning.
      // Canvas rendering is fast enough to handle 60fps, especially with an empty graph.
      const canvasToken = previewPerfMonitor?.timeSection("canvas");
      const canvasProbeToken = perfProbe.begin("canvasDraw");
      editor.draw();
      perfProbe.end(canvasProbeToken);
      previewPerfMonitor?.endSection(canvasToken);
    } else if (sceneIsStatic) {
      previewPerfMonitor?.recordValue('canvasStaticSkip', 1);
    }
  }
  previewPerfMonitor?.endFrame();
  
  // Apply dynamic quality adjustment based on frame budget
  const budgetAllocator = previewPerfMonitor?.getBudgetAllocator?.();
  // Performance monitoring for smart adaptive quality
  // FloatingGPUPreview now handles its own adaptive quality based on actual resource usage
  // This is called every frame to allow FloatingGPUPreview to monitor and auto-enable if needed
  if (window.floatingPreview && typeof window.floatingPreview._checkPerformanceAndAutoEnable === 'function') {
    window.floatingPreview._checkPerformanceAndAutoEnable();
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

// Initialize when DOM is ready.
//
// Start the app exactly once. The device-check may resolve either before the
// poll interval below or only when the 2s fallback timeout fires; guarding
// here means whichever path wins, the app is never initialized twice (which
// previously spawned a second WelcomeWindow overlay on top of the first).
let appStarted = false;
function startAppOnce() {
  if (appStarted) return;
  appStarted = true;
  initialize();
  setupPageVisibilityHandler();
}

function startWhenDeviceCheckReady() {
  // Check if device check failed
  if (window.__deviceCheckFailed) {
    console.warn('App initialization skipped due to unsupported device');
    return;
  }
  // Wait a bit for device check to complete if it's still running
  if (typeof window.__deviceCheckPassed === 'undefined') {
    let fallbackTimeout = null;
    const checkInterval = setInterval(() => {
      if (window.__deviceCheckFailed) {
        clearInterval(checkInterval);
        clearTimeout(fallbackTimeout);
        console.warn('App initialization skipped due to unsupported device');
      } else if (window.__deviceCheckPassed) {
        clearInterval(checkInterval);
        clearTimeout(fallbackTimeout);
        startAppOnce();
      }
    }, 100);
    // Timeout after 2 seconds - proceed anyway if check is taking too long
    fallbackTimeout = setTimeout(() => {
      clearInterval(checkInterval);
      if (!window.__deviceCheckFailed) {
        startAppOnce();
      }
    }, 2000);
  } else {
    startAppOnce();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startWhenDeviceCheckReady);
} else {
  startWhenDeviceCheckReady();
}
