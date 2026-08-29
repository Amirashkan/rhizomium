// main.js - Complete version with Undo System and Event System
import { GPURenderer } from "./src/gpu/gpuRenderer.js";
import { requestDeviceWithTextureLimits } from "./src/gpu/deviceLimits.js";
import { RenderLoop } from "./src/core/RenderLoop.js";
import { buildWGSL } from "./src/codegen/glslBuilder.js";
import { Editor } from "./src/core/Editor.js";
import { SaveLoadManager } from "./src/core/SaveLoadManager.js";
import { BackupDialog } from "./src/ui/BackupDialog.js";
import { FileManager } from "./src/ui/FileManager.js";
import { getAIPanel } from "./src/ui/AIPanel.js";
import { getCollabPanel } from "./src/ui/CollabPanel.js";
import { showAccountDialog } from "./src/ui/accountSession.js";
import { entitlements } from "./src/ai/entitlements.js";
import { requireOutputFeature, checkOutputFeature } from "./src/ai/outputGating.js";
import { WelcomeWindow } from "./src/ui/WelcomeWindow.js";
import { Graph } from "./src/data/Graph.js";
import { makeNode, NodeDefs, updateNodeIdCounter } from "./src/data/NodeDefs.js";
import { SeedGraphBuilder } from "./src/utils/SeedGraphBuilder.js";
import { FloatingGPUPreview } from "./src/ui/FloatingGPUPreview.js";
import { StatusBar } from './src/ui/StatusBar.js';
import { FpsMeter } from './src/ui/FpsMeter.js';
import { TauriSecondMonitorViewer } from "./src/ui/TauriSecondMonitorViewer.js";
import { isViteBuild } from "./src/utils/isViteBuild.js";
import { isTauri } from "./src/utils/isTauri.js";
import { signalAppReady } from "./src/core/tauriSplash.js";
import { UndoManager } from "./src/core/UndoManager.js";
import { ParameterEventSystem } from "./src/utils/ParameterEventSystem.js";
import { ErrorHandler } from './src/core/ErrorHandler.js';
import { getAudioSettingsPanel } from './src/ui/AudioSettingsPanel.js';
import { MIDIManager } from './src/midi/MIDIManager.js';
import { MIDIParameterBinding } from './src/midi/MIDIParameterBinding.js';
import { getMIDISettingsPanel } from './src/ui/MIDISettingsPanel.js';
import { NDIOutput } from './src/output/NDIOutput.js';
import { OSCManager } from './src/osc/OSCManager.js';
import { OSCParameterBinding } from './src/osc/OSCParameterBinding.js';
import { getOSCSettingsPanel } from './src/ui/OSCSettingsPanel.js';
import { MappingModel } from './src/mapping/MappingModel.js';
import { getMappingPanel } from './src/ui/MappingPanel.js';
import { ScreenModel, MAIN_SCREEN_ID } from './src/screens/ScreenModel.js';
import { getScreensPanel } from './src/ui/ScreensPanel.js';
import { ViewerControlsModel } from './src/viewer/ViewerControls.js';
import { getViewerControlsPanel } from './src/ui/ViewerControlsPanel.js';
import { getOutputAspect } from './src/ui/OutputFormat.js';
import { getShaderCompilerWindow } from './src/ui/ShaderCompilerWindow.js';
import { findProjectionMapNode, syncMappingToNode } from './src/mapping/projectionMapNode.js';
import { TimelineManager } from './src/core/TimelineManager.js';
import { TimelinePanel } from './src/ui/TimelinePanel.js';
import { VJControlPanel } from './src/vj/VJControlPanel.js';
import { ensureIconSprite } from './src/ui/iconSprite.js';
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
import { exportPNG, exportAnimation } from './src/ui/exportRender.js';
import { publishImage, publishAnimation } from './src/ui/publish.js';
import { openInWebViewer } from './src/ui/openInWebViewer.js';
import { modalManager } from './src/ui/ModalManager.js';
import { PreviewPerfMonitor } from "./src/utils/PreviewPerfMonitor.js";
import { getPerfProbe } from "./src/utils/PerfProbe.js";
import { installPerfBench } from "./src/utils/PerfBenchPatch.js";
import { TriggerNodeProcessor } from "./src/core/TriggerNodeProcessor.js";
import { HoldNodeProcessor } from "./src/core/HoldNodeProcessor.js";
import { CountNodeProcessor } from "./src/core/CountNodeProcessor.js";
import { FeedbackResetProcessor } from "./src/core/FeedbackResetProcessor.js";
import { VideoResetProcessor } from "./src/core/VideoResetProcessor.js";
import { WaveSyncProcessor } from "./src/core/WaveSyncProcessor.js";
import { AudioAnalysisProcessor } from "./src/core/AudioAnalysisProcessor.js";
import { TextNodeProcessor } from "./src/core/TextNodeProcessor.js";
import { setupTauriFileAssociation } from "./src/core/tauriFileOpen.js";
import { startCompositionFormatSync } from "./src/core/CompositionFormatSync.js";
import { makeDraggable } from "./src/ui/utils/draggable.js";
import {
  applyMenuShortcutHints,
  installShortcutDispatcher,
  showShortcutsDialog,
} from "./src/ui/shortcuts.js";
// TEMPORARILY REMOVED: Thread separation system imports (causing performance issues)
// import { getThreadSeparationManager } from './src/core/ThreadSeparationManager.js';
// import { getBrowserAudioCapture } from './src/audio/BrowserAudioCapture.js';

// Verify timeline imports loaded

// The NDI publisher, built the first time the artist switches NDI output on.
// Kept at module scope so the source-name field and the menu button address the
// same publisher, and so switching off and on again does not lose its settings.
let ndiOutput = null;

window.makeNode = makeNode;
window.NodeDefs = NodeDefs;
window.updateNodeIdCounter = updateNodeIdCounter;

// Always-on frame attribution probe + benchmark patch generator.
// Console: window.perfReport(), window.perfBench.mixedGraph(300), .blurTower(6)
const perfProbe = getPerfProbe();
installPerfBench();

// Drives the Trigger node's "On value change" mode each frame. See TriggerNodeProcessor.
const triggerNodeProcessor = new TriggerNodeProcessor();
// Drives the Hold (sample-and-hold) node's CPU-side latch each frame. See HoldNodeProcessor.
const holdNodeProcessor = new HoldNodeProcessor();
// Drives the Count node's CPU-side counter each frame. See CountNodeProcessor.
const countNodeProcessor = new CountNodeProcessor();
// Exposed so the Count node's "Reset Count" button (ParameterPanel.runParameterAction) can queue a reset.
window.countNodeProcessor = countNodeProcessor;
// Watches the Feedback nodes' Reset pin and clears feedback on a rising edge. See FeedbackResetProcessor.
const feedbackResetProcessor = new FeedbackResetProcessor();
// Rewinds a Texture 2D video when its Reset expression sees a rising edge. See VideoResetProcessor.
const videoResetProcessor = new VideoResetProcessor();
// Restarts a Wave node's cycle when its sync pin sees a rising edge. See WaveSyncProcessor.
const waveSyncProcessor = new WaveSyncProcessor();
// Runs precise audio kick/onset detection each frame for Audio Analysis nodes. See AudioAnalysisProcessor.
const audioKickProcessor = new AudioAnalysisProcessor();
// Re-rasterises Text nodes whose string or layout reads a live expression. See TextNodeProcessor.
const textNodeProcessor = new TextNodeProcessor();

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

    // Texture nodes own their own drop zones - leave those files to them.
    const dropZone = e.target.closest(".file-drop-zone");
    if (dropZone) return;

    // Anywhere else, a dropped .rz opens as a project. This is how a patch
    // downloaded from a gallery artwork gets back into the editor, so it has to
    // work on the canvas and not just through File → Open.
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "rz" && ext !== "json") return;

    // The dropped file has no writable handle, so a later "Save" becomes
    // "Save As" - the same as opening through the hidden file input.
    if (saveLoadManager) saveLoadManager.currentFileHandle = null;
    loadProjectFromFile(file);
  });
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
let floatingPreview = null;
let statusBar = null;
let fpsMeter = null;
let secondMonitorViewer = null;
// The output rig: which displays this patch is thrown onto, and what each of
// them shows. The model is the single source of truth — the screens panel edits
// it, the project file carries it, and the output bridge opens and closes
// windows to match it.
let screenModel = null;
let screensPanel = null;
// The parameters this patch hands to whoever opens it in the web viewer. Same
// shape as the rig above: a document the panel edits and the project file
// carries, read by the viewer page rather than by anything in the editor.
let viewerControlsModel = null;
let viewerControlsPanel = null;
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

if (typeof window.render !== "function") {
  window.render = () => {};
}

// Icons are <use> references into a document-level <symbol> sprite. The editor's
// markup contains <use> refs that are parsed before any of this runs, so inject
// at module evaluation (this script is deferred - document.body exists) rather
// than inside initialize(), which is async and would land after first paint.
ensureIconSprite();

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
    // Ask for more than the spec's 16 sampled textures per stage where the
    // machine allows it: a patch with more texture-ish nodes than that compiled
    // to a shader naming bindings the device would not grant, and died.
    const device = await requestDeviceWithTextureLimits(adapter);
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
          // Off until asked for (Ctrl+P, or the close button to dismiss it).
          //
          // This used to open on startup, which quietly undid the two lines
          // above: showing the overlay is what the render loop syncs
          // computeProfiler.setEnabled() to, so every session began with the
          // per-frame GPU timestamp readback running. That readback is the
          // CPU<->GPU sync the comment above warns must not run when nothing is
          // displayed — and it was running for everyone, in front of a panel
          // most people never asked to see.
          autoShowOverlay: false,
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

    // Create OSC system. Unlike MIDI this opens no socket until the artist
    // connects from the OSC panel — the bridge may not be running, and a failed
    // connection on every startup would be noise.
    try {
      const oscManager = new OSCManager(editor.eventSystem);
      window.oscManager = oscManager;
      editor.oscManager = oscManager;

      const oscBinding = new OSCParameterBinding(graph, editor.eventSystem, oscManager);
      window.oscBinding = oscBinding;
      editor.oscBinding = oscBinding;

      const oscSettingsPanel = getOSCSettingsPanel(oscManager, oscBinding);
      window.oscSettingsPanel = oscSettingsPanel;
      editor.oscSettingsPanel = oscSettingsPanel;
    } catch (error) {
      console.error("ERROR creating OSC system:", error);
      console.error("Error stack:", error.stack);
    }

    const gpuCanvas = document.getElementById("gpu-canvas");
    if (gpuCanvas) {
      floatingPreview = new FloatingGPUPreview(gpuCanvas);
      setupPreviewButtons();
      floatingPreview.show();

      // Feed the preview overlay's GPU-time figure from real frame completions.
      // The overlay's fps comes from presentedFrameRate instead — completions
      // measure what the GPU costs, which is a different question from how many
      // frames the window actually shows.
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
          // A projector shut down from its own window (Esc) is the artist saying
          // "not this one" — record it, or the next region nudge reopens it.
          onScreenSelfClosed: (screenId) => screenModel?.update(screenId, { enabled: false }),
        });
        window.secondMonitorViewer = secondMonitorViewer;

        // Multi-screen output. The rig is a document: the panel edits it, the
        // project file carries it, and every change here is pushed straight to
        // the open windows — a region nudged during setup moves on the projector
        // while the artist is still looking at the wall.
        screenModel = new ScreenModel();
        window.screenModel = screenModel;
        editor.screenModel = screenModel;
        screenModel.onChange((model) => {
          secondMonitorViewer.syncScreens(model.enabledScreens());
          syncOutputMenuToScreens();
        });

        screensPanel = getScreensPanel(screenModel, {
          onStatus: (message, kind) => updateStatus(message, kind),
          // Closing or reframing what is already open is never gated — a tier
          // that lapsed mid-show must not strand a projector.
          canUseMultiScreen: () => checkOutputFeature("output.multiscreen").allowed,
          getCompositionAspect: () => getOutputAspect(),
        });
        window.screensPanel = screensPanel;
      }

      // Projection mapping — corner-pin the rendered output onto the physical
      // surfaces a projector is aimed at. The model is the single source of
      // truth: the panel edits it, the project file carries it, and the output
      // window warps by it. It starts switched off, so nothing about the
      // existing output changes until an artist turns it on.
      try {
        const mappingModel = new MappingModel();
        window.mappingModel = mappingModel;
        editor.mappingModel = mappingModel;

        const mappingPanel = getMappingPanel(mappingModel, {
          getSource: () => gpuCanvas,
          onStatus: (message, kind) => updateStatus(message, kind),
        });
        window.mappingPanel = mappingPanel;
        editor.mappingPanel = mappingPanel;

        // Push every edit to the output window as it happens, so a corner
        // dragged in the panel moves on the projector during the drag - which
        // is the only way aligning against a real object is workable.
        mappingModel.onChange((model) => {
          if (secondMonitorViewer && typeof secondMonitorViewer.setMapping === "function") {
            secondMonitorViewer.setMapping(model.serialize());
          }
          // Keep the graph's ProjectionMap node — the mapping in the shader —
          // on the same geometry. This writes uniform bytes, not a recompile,
          // so a corner drag stays a drag.
          const mapNode = findProjectionMapNode(graph);
          if (mapNode) syncMappingToNode(model, mapNode);
        });
      } catch (error) {
        console.error("ERROR creating projection mapping tool:", error);
      }
    }

    // Web viewer controls: the parameters this patch offers to whoever opens it
    // in the web viewer. A document like the rig and the mapping — the panel
    // edits it, the project file carries it, the viewer reads it — and it is
    // created on every build, not just the desktop one, because the surface it
    // configures is the web.
    viewerControlsModel = new ViewerControlsModel();
    window.viewerControlsModel = viewerControlsModel;
    editor.viewerControlsModel = viewerControlsModel;
    viewerControlsModel.onChange(() => editor.markDirty?.("viewer-controls"));

    window.graph = graph;
    window.editor = editor;
    window.saveLoadManager = saveLoadManager;
    window.backupDialog = backupDialog;
    window.fileManager = fileManager;
    window.welcomeWindow = welcomeWindow;
    window.entitlements = entitlements;

    // What this visitor may do, read once on load and cached for the session.
    // Signed-out visitors get a real answer here, so this is not gated on being
    // logged in; if the gallery cannot be reached it resolves to the free tier
    // rather than rejecting. Nothing waits on it — the AI panel re-reads it
    // when opened, and every paid action asks for a fresh grant regardless.
    entitlements.load().catch((error) => {
      console.warn('Could not load entitlements:', error);
    });
    window.rebuild = updateShaderFromGraph;
    window.buildWGSL = buildWGSL;
    window.floatingPreview = floatingPreview;

    // Canvas status bar — zoom, GPU state, cursor position, the wire-colour
    // legend and the transport readout. Reads live state; owns none.
    statusBar = new StatusBar(editor);
    statusBar.mount();
    window.statusBar = statusBar;

    // Frame rate sits with the canvas readouts at the bottom; the status
    // message keeps its place at the right of the menu bar.
    fpsMeter = new FpsMeter(statusBar.fpsSlot);
    fpsMeter.mount();
    window.fpsMeter = fpsMeter;

    // Initialize Preview/Export Settings Window BEFORE setupUIEventHandlers
    // so that handlers can find it
    if (floatingPreview) {
      previewExportSettingsWindow = new PreviewExportSettingsWindow(floatingPreview);
      window.previewExportSettingsWindow = previewExportSettingsWindow;
    }

    // Initialize Preferences Window BEFORE setupUIEventHandlers
    // so that handlers can find it
    preferencesWindow = new PreferencesWindow();
    window.preferencesWindow = preferencesWindow;

    // Now set up UI event handlers (which will attach handlers to the windows we just created)
    setupUIEventHandlers();
    setupKeyboardShortcuts();

    // Stored preferences win over the editor's built-in defaults, so apply them
    // once the handlers above have wired the matching View-menu controls.
    preferencesWindow.applyAll();

    // Desktop only: open a .rz the app was launched with (double-clicked patch).
    // Deliberately not awaited - a file-association open should not hold up the
    // rest of the boot, and it no-ops in the browser.
    setupTauriFileAssociation(loadProjectFromFile).catch((err) => {
      console.warn('Tauri file association setup failed:', err);
    });

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

    // Resizing the composition has to reach the graph, not just the canvas:
    // compute textures are sized at initialize() and thumbnails keep the shape
    // they were last rendered at, so without this a resolution change only
    // showed up in the node band on some later, unrelated edit.
    startCompositionFormatSync({
      rebuild: () => updateShaderFromGraph(),
      refreshThumbnails: () => window.shaderPreviewManager?.refreshAllThumbnails?.(),
    });

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
  } finally {
    // Desktop only: swap the launch window for the editor window. In the
    // `finally` rather than at the end of the `try` on purpose — a boot that
    // threw still has to put the editor on screen, because the error it needs
    // to show is in that window.
    signalAppReady();
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
    window.preferencesWindow?.syncPreference("gridSize", currentSnapSize);

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
      window.preferencesWindow?.syncPreference("snapToGrid", enabled);
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

  // Projection Mapping tool
  const mappingBtn = removeExistingHandlers("btn-mapping-tool");

  if (mappingBtn) {
    mappingBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        const mappingPanel = window.mappingPanel;

        if (mappingPanel && typeof mappingPanel.toggle === "function") {
          mappingPanel.toggle();
          mappingBtn.textContent = mappingPanel.isVisible()
            ? "Projection Mapping \u2713"
            : "Projection Mapping\u2026";
          if (typeof updateStatus === "function") {
            updateStatus(mappingPanel.isVisible()
              ? "Projection mapping opened"
              : "Projection mapping closed");
          }
        } else if (typeof updateStatus === "function") {
          updateStatus("Projection mapping panel failed to load", "error");
        }
      } catch (error) {
        console.error("[main.js] Error opening projection mapping:", error);
        if (typeof updateStatus === "function") {
          updateStatus("Error opening projection mapping: " + error.message, "error");
        }
      }
    });
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

  // OSC Settings Panel
  const oscSettingsBtn = removeExistingHandlers("btn-osc-settings");

  if (oscSettingsBtn) {
    oscSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        const oscPanel = window.oscSettingsPanel;

        if (oscPanel && typeof oscPanel.toggle === 'function') {
          oscPanel.toggle();

          if (oscPanel.visible) {
            oscSettingsBtn.textContent = "OSC Receiver ✓";
            oscSettingsBtn.style.backgroundColor = "rgba(74, 74, 78, 0.8)";
            oscSettingsBtn.style.borderColor = "rgba(102, 170, 255, 0.4)";
          } else {
            oscSettingsBtn.textContent = "OSC Receiver";
            oscSettingsBtn.style.backgroundColor = "";
            oscSettingsBtn.style.borderColor = "";
          }

          if (typeof updateStatus === "function") {
            updateStatus(oscPanel.visible ? "OSC receiver opened" : "OSC receiver closed");
          }
        } else {
          console.error('[main.js] OSC panel is invalid:', oscPanel);
          if (typeof updateStatus === "function") {
            updateStatus("OSC panel failed to load", "error");
          }
        }
      } catch (error) {
        console.error('[main.js] Error opening OSC settings:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Error opening OSC settings: " + error.message, "error");
        }
      }
    });
  } else {
    console.error('[main.js] OSC settings button NOT found in DOM!');
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

  // Compute profiler overlay. Ctrl+Alt+P does the same thing, but a shortcut is
  // not a way to find a panel — and this one starts hidden, so without a menu
  // entry it was unreachable unless you already knew it existed.
  const profilerBtn = removeExistingHandlers("btn-toggle-profiler");

  if (profilerBtn) {
    const paintProfilerBtn = () => {
      const on = !!profilerOverlay?.visible;
      profilerBtn.textContent = on ? "Compute Profiler ✓" : "Compute Profiler";
      profilerBtn.style.backgroundColor = on ? "rgba(74, 74, 78, 0.8)" : "";
      profilerBtn.style.borderColor = on ? "rgba(102, 170, 255, 0.4)" : "";
    };

    profilerBtn.addEventListener("click", (e) => {
      e.preventDefault();

      // The overlay is built during WebGPU init, so it does not exist if the
      // device never came up.
      if (!profilerOverlay) {
        updateStatus("Profiler unavailable — no GPU device", "warning");
        return;
      }

      profilerOverlay.toggle();
      paintProfilerBtn();
      updateStatus(
        profilerOverlay.visible
          ? "Compute profiler opened — per-frame GPU timing is on"
          : "Compute profiler closed",
      );
    });

    // The shortcut and the panel's own close button change it behind our back,
    // so re-read the state each time the menu is opened rather than trusting
    // whatever the last click left behind.
    document.getElementById("dropdown-view")?.addEventListener("pointerenter", paintProfilerBtn);
    paintProfilerBtn();
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

      // Multi-screen output is a Cloude Plus entitlement. Closing a viewer that
      // is already running is never gated - a tier that lapsed mid-show should
      // not strand a window open on the projector.
      if (!secondMonitorViewer.isActive
          && !requireOutputFeature("output.multiscreen", {
            onRefused: (message, check) => {
              if (typeof updateStatus === "function") {
                updateStatus(`${message} See ${check.upgradeUrl}`, "warning");
              }
            },
          })) {
        return;
      }

      try {
        // This is the rig's master switch: it turns on every screen the artist
        // has laid out, not just one window. Going through the model rather than
        // the viewer keeps one source of truth — the panel, the project file and
        // the open windows can never disagree about what the rig is.
        if (screenModel) {
          const screens = screenModel.list();
          if (!screens.length) {
            screenModel.ensureMain();
          } else {
            const turningOff = screenModel.enabledScreens().length > 0;
            for (const screen of screens) {
              screenModel.update(screen.id, { enabled: !turningOff });
            }
          }
        } else {
          await secondMonitorViewer.toggle();
        }
      } catch (error) {
        console.error('[main.js] Error toggling the output screens:', error);
        if (typeof updateStatus === "function") {
          updateStatus("Output screen error: " + error.message, "error");
        }
      }
    });

    // The screens panel: lay the patch out across a rig of displays.
    const outputScreensBtn = removeExistingHandlers("btn-output-screens");
    if (outputScreensBtn && screensPanel) {
      outputScreensBtn.style.removeProperty("display");
      outputScreensBtn.addEventListener("click", (e) => {
        e.preventDefault();
        screensPanel.toggle();
      });
    }

    // Display-size control for the second viewer. The viewer always RENDERS the
    // output format - same framing, same sim resolution as the editor - and this
    // only chooses how many pixels it presents with. Auto (0, the default) uses
    // the viewer display's own resolution; a fixed long edge presents below it,
    // with the render letterboxed into the surface either way.
    const secondMonitorDisplayRow = document.getElementById("row-second-monitor-display");
    const secondMonitorDisplaySel = removeExistingHandlers("second-monitor-display");
    const secondMonitorDisplayCustomRow = document.getElementById("row-second-monitor-display-custom");
    const secondMonitorDisplayCustom = removeExistingHandlers("second-monitor-display-custom");
    if (secondMonitorDisplayRow && secondMonitorDisplaySel
        && typeof secondMonitorViewer.setDisplayResolution === "function") {
      secondMonitorDisplayRow.style.removeProperty("display");

      const presets = new Set(["0", "1280", "1920", "2560", "3840"]);
      // Read through the model when there is one, so the menu shows what the rig
      // says rather than only what happens to be open.
      const current = screenModel?.get(MAIN_SCREEN_ID)?.displayMaxDim
        ?? secondMonitorViewer.displayMaxDim;
      const isCustom = Number.isFinite(current) && current > 0 && !presets.has(String(current));

      if (Number.isFinite(current)) {
        secondMonitorDisplaySel.value = isCustom ? "custom" : String(current);
        if (isCustom && secondMonitorDisplayCustom) {
          secondMonitorDisplayCustom.value = String(current);
        }
      }

      const syncCustomRow = () => {
        if (!secondMonitorDisplayCustomRow) return;
        secondMonitorDisplayCustomRow.style.display =
          secondMonitorDisplaySel.value === "custom" ? "" : "none";
      };
      syncCustomRow();

      // Setting it on the model rather than the viewer is what makes it stick:
      // the rig carries the value into the project file and back out again,
      // where the viewer only knows about windows that are open right now.
      const setMainDisplayRes = (longEdge) => {
        if (screenModel?.get(MAIN_SCREEN_ID)) {
          screenModel.update(MAIN_SCREEN_ID, { displayMaxDim: longEdge });
          return screenModel.get(MAIN_SCREEN_ID).displayMaxDim;
        }
        secondMonitorViewer.setDisplayResolution(longEdge);
        return secondMonitorViewer.displayMaxDim;
      };

      secondMonitorDisplaySel.addEventListener("change", (e) => {
        syncCustomRow();
        const raw = e.target.value === "custom"
          ? secondMonitorDisplayCustom?.value
          : e.target.value;
        const longEdge = parseInt(raw, 10);
        if (Number.isFinite(longEdge)) setMainDisplayRes(longEdge);
      });

      secondMonitorDisplayCustom?.addEventListener("change", (e) => {
        const longEdge = parseInt(e.target.value, 10);
        if (!Number.isFinite(longEdge)) return;
        // The value is clamped on the way in; show what was actually applied.
        e.target.value = String(setMainDisplayRes(longEdge));
      });
    }
  }

  // NDI output. Publishes the render onto the network as an NDI source that a
  // vision mixer, OBS or a monitor on another machine can subscribe to.
  //
  // Vite/desktop build only, like the second monitor, and for a stronger
  // reason: a browser cannot speak NDI at all, so the frames go to a local
  // bridge process (ndi_bridge_server.py) that owns the actual sender.
  const ndiBtn = removeExistingHandlers("btn-ndi-output");
  if (ndiBtn && isViteBuild()) {
    document.getElementById("sep-ndi-output")?.style.removeProperty("display");
    ndiBtn.style.removeProperty("display");
    document.getElementById("row-ndi-source-name")?.style.removeProperty("display");
    setNdiButtonState(false);

    const ndiNameInput = removeExistingHandlers("ndi-source-name");
    ndiNameInput?.addEventListener("change", (e) => {
      const name = String(e.target.value || "").trim();
      if (!name) {
        // An empty name would leave the source unnamed on the network; put the
        // running one back rather than accepting it.
        e.target.value = ndiOutput?.sourceName || "Rhizomium";
        return;
      }
      ndiOutput?.setSourceName(name);
    });

    ndiBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      // Stopping is never gated - a tier that lapsed mid-show should not strand
      // a source published on the network with no way to take it down.
      if (ndiOutput?.isEnabled) {
        ndiOutput.disable();
        setNdiButtonState(false);
        if (typeof updateStatus === "function") updateStatus("NDI output stopped");
        return;
      }

      // NDI output is a Cloude Plus entitlement.
      if (!requireOutputFeature("output.ndi", {
        onRefused: (message, check) => {
          if (typeof updateStatus === "function") {
            updateStatus(`${message} See ${check.upgradeUrl}`, "warning");
          }
        },
      })) {
        return;
      }

      try {
        if (!ndiOutput) {
          ndiOutput = new NDIOutput({
            sourceName: ndiNameInput?.value?.trim() || undefined,
          });
        }
        await ndiOutput.initialize(window.gpuRenderer);
        setNdiButtonState(true);

        const status = ndiOutput.getStatus();
        if (typeof updateStatus === "function") {
          if (status.ndiAvailable) {
            updateStatus(`NDI output live as "${status.sourceName}"`);
          } else {
            // The bridge is running but cannot publish - usually a missing NDI
            // runtime. It knows exactly why, so pass that on rather than
            // reporting a generic failure.
            updateStatus(`NDI unavailable: ${status.ndiError}`, "warning");
          }
        }
      } catch {
        // Nothing is listening. Stop rather than retrying in the background,
        // so the button keeps telling the truth about whether output is on.
        ndiOutput?.disable();
        setNdiButtonState(false);
        if (typeof updateStatus === "function") {
          updateStatus(
            "Could not reach the NDI bridge. Start it with: python3 ndi_bridge_server.py",
            "error"
          );
        }
      }
    });
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

  // Print every shortcut on its own menu row, and install the dispatcher that
  // fires those rows from the keyboard. Both read src/ui/shortcuts.js, so the
  // key a menu advertises is by construction the key that runs it. This must
  // come after setupRhizomiumMenu(), which is what puts the click handlers the
  // dispatcher reuses on those rows.
  applyMenuShortcutHints();
  installShortcutDispatcher({
    shouldIgnore: (event) =>
      shouldIgnoreShortcutTarget(event) || modalManager.isModalOpen(),
  });
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
    await exportPNG();
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
    await exportAnimation();
  };

  content.appendChild(exportPngBtn);
  content.appendChild(exportAnimBtn);

  exportWindow.appendChild(header);
  exportWindow.appendChild(content);
  document.body.appendChild(exportWindow);

  // Make draggable
  makeDraggable(exportWindow, header);

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
      if (typeof createNewProject !== "function") {
        console.warn("createNewProject function not available");
        return;
      }
      // Ask first — this throws the current graph away. The confirmation used
      // to live only on the Ctrl+N path; now that the shortcut fires this row,
      // it belongs here, where both routes go through it.
      if (confirm("Create new project? Unsaved changes will be lost.")) {
        createNewProject();
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

  // Publish - share the current render to the TenderWorld gallery.
  const publishImageBtn = document.getElementById("btn-publish-image");
  if (publishImageBtn) {
    publishImageBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      updateStatus("Publishing image to TenderWorld…");
      await publishImage();
    });
  }

  const publishAnimationBtn = document.getElementById("btn-publish-animation");
  if (publishAnimationBtn) {
    publishAnimationBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      updateStatus("Publishing animation to TenderWorld…");
      await publishAnimation();
    });
  }

  // Open in Web Viewer - this patch, running on its own page. Gated on
  // viewer.web inside openInWebViewer(), which also does the upsell.
  const webViewerBtn = document.getElementById("btn-web-viewer");
  if (webViewerBtn && isTauri()) {
    // The desktop app renders in the OS WebView, which blocks window.open()
    // outright, and its bundle does not carry the viewer page at all (see
    // vite.config.js). Second Monitor Viewer is the desktop equivalent.
    //
    // The item is DISABLED rather than removed. It used to be hidden, and a
    // menu entry that is simply absent reads as a feature that does not exist —
    // there is no way to tell "not here" from "not built". Disabled with a
    // reason says which one this is, and where the equivalent lives.
    webViewerBtn.disabled = true;
    webViewerBtn.title =
      "The web viewer runs in a browser tab, which the desktop app has none of. " +
      "Open this patch in the browser editor to use it, or use View \u2192 Open Output " +
      "for a full-screen render on this machine.";
  } else if (webViewerBtn) {
    webViewerBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await openInWebViewer({
        onStatus: (message, type = "info") => updateStatus(message, type),
      });
    });
  }

  // Web Viewer Controls - which parameters the viewer page hands to a visitor.
  // Available in the desktop app too: what it edits is part of the published
  // document, and a patch authored on the desktop is viewed on the web like any
  // other.
  const viewerControlsBtn = document.getElementById("btn-viewer-controls");
  if (viewerControlsBtn) {
    viewerControlsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!viewerControlsModel) {
        updateStatus("The viewer controls are not ready yet.", "warning");
        return;
      }
      if (!viewerControlsPanel) {
        viewerControlsPanel = getViewerControlsPanel(viewerControlsModel, {
          getNodes: () => window.editor?.graph?.nodes || [],
          onStatus: (message, kind) => updateStatus(message, kind),
          onPreview: () =>
            openInWebViewer({
              onStatus: (message, type = "info") => updateStatus(message, type),
            }),
          canPreview: () => !isTauri(),
        });
        window.viewerControlsPanel = viewerControlsPanel;
      }
      viewerControlsPanel.toggle();
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
  
  // Cut — routed through the shared helper so it uses the system clipboard and repaints the canvas.
  const cutBtn = document.getElementById("btn-cut");
  if (cutBtn && editor?.selection) {
    cutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cutSelection();
    });
  }

  // Copy — routed through the shared helper (system clipboard + status).
  const copyBtn = document.getElementById("btn-copy");
  if (copyBtn && editor?.selection) {
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copySelection();
    });
  }

  // Paste — routed through the shared helper (reads the system clipboard, then repaints).
  const pasteBtn = document.getElementById("btn-paste");
  if (pasteBtn && editor?.selection) {
    pasteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pasteSelection();
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
        editor?.markDirty?.('menu-delete-button');
        editor?.draw?.();
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

  // View -> Grid -> Show Grid. Only paints the dots; snapping is a separate toggle.
  const viewShowGridCheckbox = document.getElementById("view-show-grid");
  if (viewShowGridCheckbox) {
    const initialGridVisible =
      typeof editor?.isGridVisible === "function" ? editor.isGridVisible() : true;
    viewShowGridCheckbox.checked = initialGridVisible;
    viewShowGridCheckbox.addEventListener("change", (e) => {
      const visible = !!e.target.checked;
      if (typeof editor?.setGridVisible === "function") {
        editor.setGridVisible(visible);
      }
      window.preferencesWindow?.syncPreference("showGrid", visible);
      if (typeof updateStatus === "function") {
        updateStatus(`Grid ${visible ? "shown" : "hidden"}`);
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

  // Duplicate Node — routed through the shared helper so it repaints the canvas.
  const duplicateNodeBtn = document.getElementById("btn-duplicate-node");
  if (duplicateNodeBtn && editor?.selection) {
    duplicateNodeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      duplicateSelection();
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

  // Account — who the gallery thinks you are, and the way to change it. The
  // desktop app has no second tab to sign in from, so this is its only route.
  const accountBtn = document.getElementById("btn-account");
  if (accountBtn) {
    accountBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showAccountDialog().catch((error) => {
        console.warn("[main.js] Account dialog failed:", error);
      });
    });
  }

  // AI Assistant
  const aiPanelBtn = document.getElementById("btn-ai-panel");
  if (aiPanelBtn) {
    aiPanelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // A dock, not a dialog: the same menu entry opens and closes it.
      Promise.resolve(getAIPanel().toggle()).catch((error) => {
        console.warn("[main.js] AI panel could not be toggled:", error);
      });
    });
  }

  // Collab space. The panel does its own gating (src/collab/collabGate.js) and
  // draws the refusal itself, so the menu entry is never hidden — an artist who
  // cannot use it should still find out it exists.
  const collabBtn = document.getElementById("btn-collab");
  if (collabBtn) {
    collabBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Promise.resolve(getCollabPanel().toggle()).catch((error) => {
        console.warn("[main.js] Collab panel could not be toggled:", error);
      });
    });
  }

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
      const compilerWindow = getShaderCompilerWindow();
      compilerWindow.toggle();
      if (typeof updateStatus === "function") {
        updateStatus(compilerWindow.isVisible()
          ? "Shader Compiler opened"
          : "Shader Compiler closed");
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
      // The docsify site under /docs, which vite.config.js copies verbatim into
      // the build — so this resolves on the dev server, the web deployment and
      // the desktop bundle alike. It used to point at a placeholder repo URL
      // that 404'd, which meant the Help menu never reached the documentation
      // at all.
      window.open("/docs/", "_blank");
      if (typeof updateStatus === "function") {
        updateStatus("Opening documentation...");
      }
    });
  }

  // Shortcuts — the whole keymap, printed from the same table the menu rows are
  // annotated from (src/ui/shortcuts.js).
  const shortcutsBtn = document.getElementById("btn-shortcuts");
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showShortcutsDialog();
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
      if (e.key.toLowerCase() === "x") {
        // If the user has selected text, let the browser cut that text instead of hijacking
        // Ctrl/Cmd+X to cut the node(s).
        const textSelection = window.getSelection?.();
        if (textSelection && textSelection.toString().trim().length > 0) {
          return;
        }
        // Only prevent default if we actually cut something
        if (cutSelection()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        } else {
          // No nodes selected, let browser handle it
          updateStatus("Select nodes to cut", "warning");
        }
        return;
      }
      if (e.key.toLowerCase() === "v") {
        // Paste is async (it may read the system clipboard for cross-window support), so we can't
        // decide synchronously whether there's anything to paste. Take over Ctrl/Cmd+V on the
        // editor surface — text fields are already excluded by shouldIgnoreShortcutTarget above —
        // and report afterwards if the clipboard held nothing pasteable.
        e.preventDefault();
        e.stopImmediatePropagation();
        pasteSelection().then((ok) => {
          if (!ok) {
            updateStatus("Nothing to paste", "warning");
          }
        });
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

    // An Alt-modified combination is a different shortcut, not one of these.
    // Without this guard every entry below also answered to Ctrl+Alt: Ctrl+Alt+S
    // saved, Ctrl+Alt+Z undid, Ctrl+Alt+P toggled the preview. Two ways that
    // bites — a real Ctrl+Alt shortcut elsewhere fires two actions at once, and
    // on international Windows layouts AltGr arrives as Ctrl+Alt, so typing an
    // AltGr character ran them.
    if (e.altKey) return;

    // Only the shortcuts with no menu row of their own live here. Everything
    // the menu bar offers is dispatched from src/ui/shortcuts.js by clicking
    // the row itself — Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+D, Ctrl+B, Ctrl+P, Ctrl+3
    // and the rest used to be duplicated in this switch, which meant two places
    // to keep in step and a shortcut that could quietly do something other than
    // the menu item it was printed next to.
    switch (e.key.toLowerCase()) {
      case "l":
        if (e.shiftKey) {
          e.preventDefault();
          saveLoadManager?.loadFromLocal?.();
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

      default:
        break;
    }
  });

  window.addEventListener("keydown", (e) => {
    // This is where Delete/Backspace deletes the selected nodes, and it calls
    // preventDefault(), so it has to stay out of the way whenever the keystroke
    // belongs to a text field. `shouldIgnoreShortcutTarget` covers a focused input;
    // the modal check covers a dialog whose field has not been clicked into yet
    // (Publish → Animation asks for FPS and duration before recording).
    if (shouldIgnoreShortcutTarget(e) || modalManager.isModalOpen()) {
      return;
    }

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

// ---- System clipboard bridge ----------------------------------------------------------------
// Copy/cut also write the selected nodes to the OS clipboard as JSON, and paste reads it back, so
// nodes can be moved between separate editor windows/tabs. The in-app clipboard
// (selection.clipboard) stays the synchronous fallback for same-window paste and for when the
// browser denies clipboard access.
const NODE_CLIPBOARD_MARKER = "__glslNodeEditorClipboard";

function serializeNodeClipboard(clip) {
  if (!clip || !Array.isArray(clip.nodes) || clip.nodes.length === 0) {
    return null;
  }
  return JSON.stringify({
    [NODE_CLIPBOARD_MARKER]: 1,
    version: 1,
    nodes: clip.nodes,
    connections: Array.isArray(clip.connections) ? clip.connections : [],
  });
}

function parseNodeClipboard(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (!data || data[NODE_CLIPBOARD_MARKER] !== 1) {
      return null;
    }
    if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
      return null;
    }
    return {
      nodes: data.nodes,
      connections: Array.isArray(data.connections) ? data.connections : [],
    };
  } catch {
    return null; // Not our payload (or not JSON) — ignore.
  }
}

// Best-effort, fire-and-forget write. Clipboard access can be blocked (no permission, insecure
// context, unfocused document); the in-app clipboard already holds the same data, so failure here
// only means cross-window paste is unavailable this time.
async function writeNodesToSystemClipboard(clip) {
  const text = serializeNodeClipboard(clip);
  if (!text) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ignore — fall back to the in-app clipboard */
  }
  return false;
}

async function readNodesFromSystemClipboard() {
  try {
    if (navigator.clipboard?.readText) {
      return parseNodeClipboard(await navigator.clipboard.readText());
    }
  } catch {
    /* read blocked by permissions/context — fall back to the in-app clipboard */
  }
  return null;
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
    writeNodesToSystemClipboard(selection.clipboard);
    updateStatus(`Copied ${selected.size} node${selected.size > 1 ? 's' : ''}`);
  }
  return success;
}

function cutSelection() {
  const selection = editor?.selection;
  const selected = selection?.getSelected?.();
  if (!selection || !selected || selected.size === 0) {
    return false;
  }

  // Clear any browser text selection to prevent interference
  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }

  const count = selected.size;

  // Regular cut = copy the selection to the clipboard, then remove it. Bail if the copy fails so
  // we never delete nodes the user can't paste back. deleteSelected() is the undo-aware path
  // (records undo, reconnects wires) shared with Delete/Backspace.
  if (!selection.copySelected()) {
    return false;
  }
  writeNodesToSystemClipboard(selection.clipboard);
  selection.deleteSelected();
  // deleteSelected() removes the nodes but doesn't mark the canvas dirty, and editor.draw() is a
  // no-op while the canvas is clean — so without this the cut nodes lingered on screen until the
  // next interaction (the "needs one more click" symptom). markDirty first, then draw.
  editor?.markDirty?.('cut-selection');
  editor?.draw?.();
  updateStatus(`Cut ${count} node${count > 1 ? 's' : ''}`);
  return true;
}

async function pasteSelection() {
  const selection = editor?.selection;
  if (!selection) {
    return false;
  }

  // Prefer the system clipboard so paste works across separate editor windows/tabs. When it holds
  // our node payload, adopt it as the in-app clipboard; otherwise keep whatever was copied in this
  // window (system read may be denied, or the clipboard may hold unrelated text).
  const external = await readNodesFromSystemClipboard();
  if (external) {
    selection.clipboard = external;
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

// Toggling the preview window now runs through View → Panels → Toggle Preview
// Panel, which Ctrl/Cmd+2 (and Ctrl/Cmd+P) click — one code path for the menu
// row and its shortcut.

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

    // kind/type only — `node.name` is the artist's display title (see src/core/nodeName.js) and
    // must never decide what a node IS, or renaming one "output final mix" would hijack the sink.
    const outputNode = graph.nodes.find(
      (node) => node && /OutputFinal/i.test(node.kind || node.type || "")
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


    const result = buildWGSL(window.editor.graph);

    if (!result || !result.wgsl) {
      console.error("Shader compilation produced no code");
      return;
    }

    // Initialize compute nodes BEFORE setting shader source
    // This ensures compute textures exist when bind groups are created.
    // An EMPTY registry is not a reason to skip it once the executor has managers:
    // that is a graph whose last compute node just went away (deleted, or replaced
    // wholesale by a project load), and initialize() is what tears the old managers
    // down — safely, holding their textures alive until the new bind groups are in
    // place. Skipping it left them dispatching every frame for a graph that no
    // longer contains them.
    if (computeExecutor && (window.computeNodeRegistry?.size > 0 || computeExecutor.initialized)) {
      await computeExecutor.initialize();
    }

    // Process ComputeFieldMapper nodes for 3D visualization
    await processFieldMapperNodes();

    const rawWGSL = typeof result.wgsl === "string" ? result.wgsl : String(result.wgsl ?? "");

    // REMOVED AGGRESSIVE CACHING - it was breaking preview updates on connection changes
    // Rely on shader compilation cache (glslBuilder.js) and GPU pipeline cache (gpuRenderer.js) instead

    // Strips anything the WGSL tokenizer would reject outright, keeping printable ASCII plus the
    // three whitespace controls that carry the shader's line structure — the control characters in
    // the class are the point of it, so no-control-regex has nothing to warn about here.
    // eslint-disable-next-line no-control-regex
    const sanitizedWGSL = rawWGSL.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

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
  } finally {
    // The Shader Compiler window follows the graph, and every outcome of a
    // build is a state it has something to say about — compiled, bailed for
    // want of a wired output, or thrown. Announced from `finally` so the early
    // returns above are covered too; nothing else listens, and no listener
    // means no cost.
    window.dispatchEvent(new CustomEvent("rz:shader-built"));
  }
}

function updateStatus(message, type = "info") {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = message;
    // Keep the layout class: it is what pushes the readout to the right of the
    // menu bar and draws its live-state dot. Assigning `type` alone dropped it,
    // leaving the status stranded next to the Help menu.
    statusEl.className = type ? `menu-status ${type}` : "menu-status";

    if (type !== "error") {
      setTimeout(() => {
        if (statusEl.textContent === message) {
          statusEl.textContent = "Idle";
          statusEl.className = "menu-status";
        }
      }, 3000);
    }
  }
}

/**
 * Reflect the output rig's active/inactive state on its menu button.
 *
 * The button is the rig's master switch, so what it says has to say how many
 * screens it is about to turn on: "Close Output (3 screens)" is the difference
 * between an artist knowing their wall is live and finding out from the audience.
 * Safe to call when the button is absent (non-Vite builds) — it no-ops.
 */
function setSecondMonitorButtonState(active) {
  const btn = document.getElementById("btn-second-monitor");
  if (!btn) return;
  const count = screenModel ? screenModel.enabledScreens().length : (active ? 1 : 0);
  const many = count > 1 ? ` (${count} screens)` : "";
  btn.textContent = active ? `Close Output${many}` : `Open Output${many}`;
  btn.style.backgroundColor = active ? "rgba(0, 170, 0, 0.8)" : "";
  btn.style.borderColor = active ? "rgba(0, 255, 0, 0.4)" : "";
}

function setNdiButtonState(active) {
  const btn = document.getElementById("btn-ndi-output");
  if (!btn) return;
  btn.textContent = active ? "Stop NDI Output" : "NDI Output";
  btn.style.backgroundColor = active ? "rgba(0, 170, 0, 0.8)" : "";
  btn.style.borderColor = active ? "rgba(0, 255, 0, 0.4)" : "";
}

/**
 * Keep the output menu in step with the rig after a model change.
 *
 * The windows open asynchronously, so the button's label is driven from what the
 * rig SAYS should be on rather than waiting for the last projector to come up —
 * otherwise the menu reads "Open Output" for a moment while the wall is already
 * lighting up.
 */
function syncOutputMenuToScreens() {
  if (!screenModel) return;
  setSecondMonitorButtonState(screenModel.enabledScreens().length > 0);
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
      // Then the Trigger node's "On value change" pulses, before the consumers below: a
      // change-mode Trigger's pulse is CPU-only state (node.__triggerPulse), and Hold / Count /
      // the Feedback reset pin all read it, so it has to be this frame's value not last frame's.
      triggerNodeProcessor.update(window.editor.graph, {
        time: frameState.simTime,
        uniformManager: window.nodeCompiler.uniformManager,
      });
      // Then restart any Wave whose sync pin rose this frame, before the consumers below: a synced
      // Wave's cycle origin is CPU-only state (node.__waveSyncTime), and Hold / Count / the Feedback
      // reset pin can all read a Wave, so it has to be this frame's origin not last frame's. It
      // runs after the Trigger pass for the same reason — a Trigger is a natural sync source.
      waveSyncProcessor.update(window.editor.graph, {
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
      // Rewind any video whose Reset expression rose this frame, on the same unthrottled cadence:
      // the expression is often a beat ("=audioEnvelopeBass > 0.6"), and a missed edge is a missed
      // cue. Runs before the frame is dispatched so the rewound frame is the one drawn.
      videoResetProcessor.update(window.editor.graph, {
        time: frameState.simTime,
        textureManager: window.textureManager,
      });
      // Redraw Text nodes that read a live value ("{node_4}", "=time"). Last, so the string shows
      // this frame's values from the processors above. Self-throttled and a no-op for Text nodes
      // without an expression, unlike the per-frame uniform writes above — a raster is far heavier.
      textNodeProcessor.update(window.editor.graph);
    } catch {
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

      renderPromise.catch(__err => {
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

    // Publish each 3D node's OWN rendered frame as its output texture so
    // downstream nodes and the main canvas consume that node's view alone
    if (hasFieldMappers) {
      fieldMapperIntegration.publishOutputs();
    }

    // Mirror each node's own frame into its editor thumbnail so it stays
    // live. Throttled: a readback 4x/sec is imperceptible on the tiny
    // thumbnail but keeps GPU->CPU traffic negligible.
    const now = performance.now();
    if (now - (window.__fieldMapperThumbAt || 0) > 250) {
      window.__fieldMapperThumbAt = now;
      const previewManager = window.editor?.shaderPreviewManager;
      if (previewManager && graph?.nodes) {
        for (const node of graph.nodes) {
          if (node && node.kind === 'ComputeFieldMapper') {
            // Pass a getter so the queue always downscales the CURRENT
            // texture, not one retired by a resolution change while queued
            previewManager.updateNodeThumbnailFromTexture(
              node,
              () => sceneRenderer3D?.getNodeTexture?.(node.id) ?? null
            );
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
    // (keeps the drag smooth), but it is what keeps node thumbnails and pin
    // readouts current, so keep it alive when the graph is animated; it's
    // throttled to 10 FPS and runs in reduced-work interaction mode, so the drag
    // stays responsive.
    //
    // Note this pass is NOT what keeps a live reference chain moving — e.g. a
    // Circle radius `=node_X` where X is a Remap fed by a ConstFloat
    // `=audioEnvelope`. Its 10 FPS cadence is exactly what made such a value step
    // rather than animate. `_freshenReferencedValues` in the fragment bridge and
    // the field mapper now resolve those references through
    // PreviewComputer.evaluateNodeLive, which re-evaluates the whole upstream
    // chain at this frame's time.
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
    // The editor never boots on this machine, but the desktop app must still
    // reveal its window: the device-warning overlay is rendered inside it, and
    // leaving the splash up instead would hide the one thing worth reading.
    signalAppReady();
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
        signalAppReady();
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
      } else {
        // Failed between the last poll and this timeout — same as above, the
        // desktop window still has to appear so the warning can be read.
        signalAppReady();
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
