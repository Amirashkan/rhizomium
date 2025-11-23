# Rhizomium Thread Categorization

This document lists all threads from the Rhizomium Thread Architecture Analysis, clearly categorized as **Primary** or **Secondary** threads with their names, roles, and file locations.

---

## PRIMARY THREADS (Core Logic)

### 1. RenderLoop (Main Render Loop Thread)
- **Name**: `RenderLoop` / Main Animation Frame Loop
- **Role**: Primary rendering coordination thread that manages frame timing (VSync or fixed FPS), coordinates all frame-based updates, and handles simulation time and delta time calculations
- **File Location**: 
  - `src/core/RenderLoop.js`
  - `main.js:handleRenderFrame()`
- **Priority**: CRITICAL - Core rendering pipeline
- **Frequency**: 60 FPS (VSync) or configurable fixed FPS

### 2. ExecutionQueue (Graph Execution Thread)
- **Name**: `ExecutionQueue` / Task Queue Processor
- **Role**: Manages prioritized task execution queue, handles concurrent task execution (max 4 concurrent), coordinates shader compilation, validation, and execution, processes graph changes and node updates
- **File Location**: `src/core/ExecutionQueue.js`
- **Priority**: HIGH - Core logic execution
- **Frequency**: Continuous (throttled to ~60 FPS)

### 3. ComputeExecutor (GPU Compute Execution Thread)
- **Name**: `ComputeExecutor` / GPU Compute Dispatcher
- **Role**: Executes compute shader nodes in topological order, manages GPU compute pipeline execution, handles compute node dependencies and dispatch, coordinates fragment-to-compute and compute-to-fragment interop
- **File Location**: `src/gpu/ComputeExecutor.js`
- **Priority**: HIGH - GPU compute operations
- **Frequency**: On-demand (when compute nodes need execution)

### 4. Shader Build Pipeline (Shader Compilation Thread)
- **Name**: Shader Build Pipeline
- **Role**: Generates WGSL shader code from node graph, compiles shaders and creates GPU pipelines, manages shader cache and pipeline recreation, handles shader error reporting
- **File Location**: 
  - `src/codegen/glslBuilder.js`
  - `main.js:updateShaderFromGraph()`
- **Priority**: HIGH - Required for rendering
- **Frequency**: On-demand (when graph changes)

### 5. SystemIntegration (System Integration Thread)
- **Name**: `SystemIntegration` / Core System Coordinator
- **Role**: Coordinates all subsystems (graph, type system, execution queue), manages system state and validation, handles node creation, connection, and deletion, coordinates type propagation and validation
- **File Location**: `src/core/SystemIntegration.js`
- **Priority**: HIGH - System coordination
- **Frequency**: On-demand (when system state changes)

---

## SECONDARY THREADS (Peripheral Tasks)

### 6. UI Update Thread (Canvas 2D Rendering)
- **Name**: Canvas 2D Rendering / Editor UI Thread
- **Role**: Renders node graph UI (nodes, connections, grid), handles canvas 2D drawing operations, updates node positions and visual states, manages viewport transformations
- **File Location**: 
  - `src/core/Editor.js:draw()`
  - `src/core/Renderer.js`
- **Priority**: MEDIUM - UI responsiveness
- **Frequency**: Every frame (60 FPS) via RenderLoop

### 7. PreviewIntegration (Preview Rendering Thread)
- **Name**: `PreviewIntegration` / Node Preview Animation Loop
- **Role**: Updates time-based node previews, manages preview animation loop (30 FPS throttled), handles preview thumbnail generation, coordinates preview system updates
- **File Location**: `src/core/preview/PreviewIntegration.js`
- **Priority**: MEDIUM - Visual feedback
- **Frequency**: 30 FPS (throttled from 60 FPS)

### 8. PreviewComputer (Preview Computation Thread)
- **Name**: `PreviewComputer` / Node Value Computer
- **Role**: Computes node preview values (48x48 thumbnails), evaluates node outputs for preview display, caches preview results, updates preview textures
- **File Location**: 
  - `src/core/PreviewComputer.js`
  - `src/core/preview/NodeValueComputer.js`
- **Priority**: MEDIUM - Preview updates
- **Frequency**: Every frame (60 FPS) but throttled during interactions

### 9. ParameterExpressionSystem (Parameter Evaluation Thread)
- **Name**: `ParameterExpressionSystem` / Expression Evaluator
- **Role**: Evaluates parameter expressions (e.g., `=time * 2`), handles time-based and audio-based expressions, manages expression caching, tracks expression dependencies
- **File Location**: `src/utils/ParameterExpressionSystem.js`
- **Priority**: MEDIUM - Parameter updates
- **Frequency**: On-demand (when parameter values are accessed)

### 10. PreviewThrottler (Preview Throttler Thread)
- **Name**: `PreviewThrottler` / Update Throttling
- **Role**: Throttles preview updates during user interactions, manages update frequency based on interaction mode (idle, edit, drag, compile), prevents excessive preview computation during parameter dragging
- **File Location**: `src/preview/PreviewThrottler.js`
- **Priority**: LOW - Performance optimization
- **Frequency**: Variable (16ms idle, 100ms edit, 50ms drag, 500ms compile)

### 11. TimelineManager (Timeline Manager Thread)
- **Name**: `TimelineManager` / Animation Timeline
- **Role**: Manages animation timeline and keyframes, updates timeline state each frame, handles timeline scrubbing and playback
- **File Location**: `src/core/TimelineManager.js`
- **Priority**: MEDIUM - Animation support
- **Frequency**: Every frame (60 FPS)

### 12. EventHandler (Event Handler Thread)
- **Name**: `EventHandler` / User Input Handler
- **Role**: Handles mouse and keyboard events, manages node selection and manipulation, coordinates UI interactions, triggers canvas redraws on interaction
- **File Location**: `src/core/EventHandler.js`
- **Priority**: HIGH - User interaction responsiveness
- **Frequency**: On-demand (user input events)

### 13. AudioEngine (Audio Processing Thread - Python)
- **Name**: `AudioEngine` / Audio Capture Thread
- **Role**: Captures audio input (mic or loopback), processes audio blocks and computes RMS, generates audio envelope values, provides audio data to JavaScript via WebSocket/API
- **File Location**: `audio/audio_engine.py`
- **Priority**: MEDIUM - Audio reactivity
- **Frequency**: Audio sample rate (typically 44.1kHz or 48kHz)

### 14. FrameStreamServer (WebSocket Frame Stream Thread - Python)
- **Name**: `FrameStreamServer` / WebSocket Server Thread
- **Role**: Serves WebSocket connections for frame streaming, broadcasts GPU-rendered frames to external viewers, manages client connections and frame distribution
- **File Location**: 
  - `frame_stream_server.py`
  - `rhizo_server.py`
- **Priority**: MEDIUM - Dual-screen support
- **Frequency**: Frame rate (typically 30-60 FPS)

### 15. RhizomiumViewer WebSocket Client Thread (External Viewer WebSocket Client Thread - Python)
- **Name**: `RhizomiumViewer._websocket_client_thread` / Viewer WebSocket Thread
- **Role**: Connects to WebSocket server for frame streaming, receives frame data asynchronously, queues frames for rendering thread, handles reconnection logic
- **File Location**: `rhizo_viewer.py:114-200`
- **Priority**: MEDIUM - External viewer support
- **Frequency**: Continuous (async event loop)

### 16. RhizomiumViewer Render Thread (External Viewer Render Thread - Python)
- **Name**: `RhizomiumViewer.render()` / ModernGL Render Thread
- **Role**: Renders received frames to OpenGL window, handles aspect ratio preservation, manages texture updates and rendering, displays frames on external monitor
- **File Location**: `rhizo_viewer.py:258-431`
- **Priority**: MEDIUM - External display
- **Frequency**: VSync (typically 60 FPS)

### 17. MIDIManager (MIDI Processing Thread)
- **Name**: `MIDIManager` / MIDI Input Handler
- **Role**: Receives MIDI input events, maps MIDI CC/notes to parameters, updates parameter values from MIDI, throttles MIDI updates to prevent overload
- **File Location**: `src/midi/MIDIManager.js`
- **Priority**: MEDIUM - MIDI control support
- **Frequency**: On-demand (MIDI events)

### 18. SaveLoadManager (Save/Load Manager Thread)
- **Name**: `SaveLoadManager` / File I/O Handler
- **Role**: Handles graph serialization/deserialization, manages file save/load operations, coordinates backup creation, handles import/export operations
- **File Location**: `src/core/SaveLoadManager.js`
- **Priority**: LOW - File operations
- **Frequency**: On-demand (user-initiated)

### 19. UndoManager (Undo/Redo Manager Thread)
- **Name**: `UndoManager` / History Manager
- **Role**: Manages undo/redo history, tracks graph state changes, handles undo/redo operations
- **File Location**: `src/core/UndoManager.js`
- **Priority**: MEDIUM - User experience
- **Frequency**: On-demand (state changes)

### 20. GPUPerformanceMonitor (GPU Performance Monitor Thread)
- **Name**: `GPUPerformanceMonitor` / Performance Profiler
- **Role**: Monitors GPU frame times and FPS, tracks performance metrics, displays performance overlay, warns about performance issues
- **File Location**: `src/utils/GPUPerformanceMonitor.js`
- **Priority**: LOW - Performance monitoring
- **Frequency**: Every frame (60 FPS)

### 21. ComputeProfiler (Compute Profiler Thread)
- **Name**: `ComputeProfiler` / Compute Shader Profiler
- **Role**: Profiles compute shader execution times, tracks compute node performance, provides profiling overlay
- **File Location**: `src/gpu/ComputeProfiler.js`
- **Priority**: LOW - Performance analysis
- **Frequency**: On-demand (when compute nodes execute)

---

## SUMMARY

### Primary Threads: 5
1. RenderLoop
2. ExecutionQueue
3. ComputeExecutor
4. Shader Build Pipeline
5. SystemIntegration

### Secondary Threads: 16
1. UI Update Thread
2. PreviewIntegration
3. PreviewComputer
4. ParameterExpressionSystem
5. PreviewThrottler
6. TimelineManager
7. EventHandler
8. AudioEngine (Python)
9. FrameStreamServer (Python)
10. RhizomiumViewer WebSocket Client Thread (Python)
11. RhizomiumViewer Render Thread (Python)
12. MIDIManager
13. SaveLoadManager
14. UndoManager
15. GPUPerformanceMonitor
16. ComputeProfiler

**Total Threads: 21**

