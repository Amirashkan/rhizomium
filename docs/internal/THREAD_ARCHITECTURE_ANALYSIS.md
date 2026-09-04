# Rhizomium Thread Architecture Analysis

## Overview
This document identifies all primary and secondary execution contexts (threads) in the Rhizomium system. Since this is a JavaScript/WebGPU application, "threads" refer to execution contexts including the main JavaScript event loop, Web Workers, Python threads, and scheduled async operations.

---

## PRIMARY THREADS (Core Logic)

### 1. **Main Render Loop Thread**
- **Name**: `RenderLoop` / Main Animation Frame Loop
- **Location**: `src/core/RenderLoop.js`, `main.js:handleRenderFrame()`
- **Role**: 
  - Primary rendering coordination thread
  - Manages frame timing (VSync or fixed FPS)
  - Coordinates all frame-based updates
  - Handles simulation time and delta time calculations
- **Dependencies**:
  - `requestAnimationFrame` (browser API)
  - `GPURenderer` (GPU rendering)
  - `TimelineManager` (animation timeline)
  - `Editor.draw()` (UI canvas rendering)
  - `PreviewComputer` (node preview computation)
- **Frequency**: 60 FPS (VSync) or configurable fixed FPS
- **Priority**: CRITICAL - Core rendering pipeline

### 2. **Graph Execution Thread**
- **Name**: `ExecutionQueue` / Task Queue Processor
- **Location**: `src/core/ExecutionQueue.js`
- **Role**:
  - Manages prioritized task execution queue
  - Handles concurrent task execution (max 4 concurrent)
  - Coordinates shader compilation, validation, and execution
  - Processes graph changes and node updates
- **Dependencies**:
  - `SystemIntegration` (system coordination)
  - `Graph` (node graph data structure)
  - `ComputeExecutor` (GPU compute execution)
  - `ParameterExpressionSystem` (expression evaluation)
- **Frequency**: Continuous (throttled to ~60 FPS)
- **Priority**: HIGH - Core logic execution

### 3. **GPU Compute Execution Thread**
- **Name**: `ComputeExecutor` / GPU Compute Dispatcher
- **Location**: `src/gpu/ComputeExecutor.js`
- **Role**:
  - Executes compute shader nodes in topological order
  - Manages GPU compute pipeline execution
  - Handles compute node dependencies and dispatch
  - Coordinates fragment-to-compute and compute-to-fragment interop
- **Dependencies**:
  - `ComputeShaderManager` (shader management)
  - `Graph` (node graph for dependency resolution)
  - `ComputeProfiler` (performance monitoring)
  - WebGPU Device (GPU context)
- **Frequency**: On-demand (when compute nodes need execution)
- **Priority**: HIGH - GPU compute operations

### 4. **Shader Compilation Thread**
- **Name**: Shader Build Pipeline
- **Location**: `src/codegen/glslBuilder.js`, `main.js:updateShaderFromGraph()`
- **Role**:
  - Generates WGSL shader code from node graph
  - Compiles shaders and creates GPU pipelines
  - Manages shader cache and pipeline recreation
  - Handles shader error reporting
- **Dependencies**:
  - `Graph` (node graph structure)
  - `NodeCompiler` (node-to-code compilation)
  - `GPURenderer` (pipeline creation)
  - WebGPU Device (shader compilation)
- **Frequency**: On-demand (when graph changes)
- **Priority**: HIGH - Required for rendering

### 5. **System Integration Thread**
- **Name**: `SystemIntegration` / Core System Coordinator
- **Location**: `src/core/SystemIntegration.js`
- **Role**:
  - Coordinates all subsystems (graph, type system, execution queue)
  - Manages system state and validation
  - Handles node creation, connection, and deletion
  - Coordinates type propagation and validation
- **Dependencies**:
  - `Graph` (node graph)
  - `TypeSystem` (type checking)
  - `ExecutionQueue` (task execution)
  - `ParameterEventSystem` (event handling)
  - `Scene` (3D scene management)
- **Frequency**: On-demand (when system state changes)
- **Priority**: HIGH - System coordination

---

## SECONDARY THREADS (Peripheral Tasks)

### 6. **UI Update Thread**
- **Name**: Canvas 2D Rendering / Editor UI Thread
- **Location**: `src/core/Editor.js:draw()`, `src/core/Renderer.js`
- **Role**:
  - Renders node graph UI (nodes, connections, grid)
  - Handles canvas 2D drawing operations
  - Updates node positions and visual states
  - Manages viewport transformations
- **Dependencies**:
  - `Editor` (editor state)
  - `Graph` (node data)
  - `SelectionManager` (selection state)
  - `ViewportManager` (viewport state)
- **Frequency**: Every frame (60 FPS) via RenderLoop
- **Priority**: MEDIUM - UI responsiveness

### 7. **Preview Rendering Thread**
- **Name**: `PreviewIntegration` / Node Preview Animation Loop
- **Location**: `src/core/preview/PreviewIntegration.js`
- **Role**:
  - Updates time-based node previews
  - Manages preview animation loop (30 FPS throttled)
  - Handles preview thumbnail generation
  - Coordinates preview system updates
- **Dependencies**:
  - `PreviewSystem` (preview management)
  - `PreviewComputer` (preview computation)
  - `Editor` (editor state)
- **Frequency**: 30 FPS (throttled from 60 FPS)
- **Priority**: MEDIUM - Visual feedback

### 8. **Preview Computation Thread**
- **Name**: `PreviewComputer` / Node Value Computer
- **Location**: `src/core/PreviewComputer.js`, `src/core/preview/NodeValueComputer.js`
- **Role**:
  - Computes node preview values (48x48 thumbnails)
  - Evaluates node outputs for preview display
  - Caches preview results
  - Updates preview textures
- **Dependencies**:
  - `Graph` (node graph)
  - `NodeValueComputer` (value computation)
  - `ParameterExpressionSystem` (expression evaluation)
- **Frequency**: Every frame (60 FPS) but throttled during interactions
- **Priority**: MEDIUM - Preview updates

### 9. **Parameter Evaluation Thread**
- **Name**: `ParameterExpressionSystem` / Expression Evaluator
- **Location**: `src/utils/ParameterExpressionSystem.js`
- **Role**:
  - Evaluates parameter expressions (e.g., `=time * 2`)
  - Handles time-based and audio-based expressions
  - Manages expression caching
  - Tracks expression dependencies
- **Dependencies**:
  - `Graph` (node data)
  - Time context (from RenderLoop)
  - Audio context (from AudioEngine)
  - Node reference system
- **Frequency**: On-demand (when parameter values are accessed)
- **Priority**: MEDIUM - Parameter updates

### 10. **Preview Throttler Thread**
- **Name**: `PreviewThrottler` / Update Throttling
- **Location**: `src/preview/PreviewThrottler.js`
- **Role**:
  - Throttles preview updates during user interactions
  - Manages update frequency based on interaction mode (idle, edit, drag, compile)
  - Prevents excessive preview computation during parameter dragging
- **Dependencies**:
  - `Editor` (interaction state)
  - Preview update callbacks
- **Frequency**: Variable (16ms idle, 100ms edit, 50ms drag, 500ms compile)
- **Priority**: LOW - Performance optimization

### 11. **Timeline Manager Thread**
- **Name**: `TimelineManager` / Animation Timeline
- **Location**: `src/core/TimelineManager.js`
- **Role**:
  - Manages animation timeline and keyframes
  - Updates timeline state each frame
  - Handles timeline scrubbing and playback
- **Dependencies**:
  - `RenderLoop` (frame timing)
  - `Editor` (editor state)
- **Frequency**: Every frame (60 FPS)
- **Priority**: MEDIUM - Animation support

### 12. **Event Handler Thread**
- **Name**: `EventHandler` / User Input Handler
- **Location**: `src/core/EventHandler.js`
- **Role**:
  - Handles mouse and keyboard events
  - Manages node selection and manipulation
  - Coordinates UI interactions
  - Triggers canvas redraws on interaction
- **Dependencies**:
  - `Editor` (editor state)
  - `SelectionManager` (selection state)
  - `ConnectionManager` (connection handling)
- **Frequency**: On-demand (user input events)
- **Priority**: HIGH - User interaction responsiveness

### 13. **Audio Processing Thread (Python)**
- **Name**: `AudioEngine` / Audio Capture Thread
- **Location**: `audio/audio_engine.py`
- **Role**:
  - Captures audio input (mic or loopback)
  - Processes audio blocks and computes RMS
  - Generates audio envelope values
  - Provides audio data to JavaScript via WebSocket/API
- **Dependencies**:
  - PortAudio/WASAPI (audio input)
  - `AudioEnvelopeProcessor` (envelope processing)
  - Threading lock for thread safety
- **Frequency**: Audio sample rate (typically 44.1kHz or 48kHz)
- **Priority**: MEDIUM - Audio reactivity

### 14. **WebSocket Frame Stream Thread (Python)**
- **Name**: `FrameStreamServer` / WebSocket Server Thread
- **Location**: `frame_stream_server.py`, `rhizo_server.py`
- **Role**:
  - Serves WebSocket connections for frame streaming
  - Broadcasts GPU-rendered frames to external viewers
  - Manages client connections and frame distribution
- **Dependencies**:
  - Flask server (HTTP/WebSocket)
  - Frame data from JavaScript (via WebSocket client)
- **Frequency**: Frame rate (typically 30-60 FPS)
- **Priority**: MEDIUM - Dual-screen support

### 15. **External Viewer WebSocket Client Thread (Python)**
- **Name**: `RhizomiumViewer._websocket_client_thread` / Viewer WebSocket Thread
- **Location**: `rhizo_viewer.py:114-200`
- **Role**:
  - Connects to WebSocket server for frame streaming
  - Receives frame data asynchronously
  - Queues frames for rendering thread
  - Handles reconnection logic
- **Dependencies**:
  - WebSocket client (async)
  - Frame queue (thread-safe queue)
  - Main render thread (for frame consumption)
- **Frequency**: Continuous (async event loop)
- **Priority**: MEDIUM - External viewer support

### 16. **External Viewer Render Thread (Python)**
- **Name**: `RhizomiumViewer.render()` / ModernGL Render Thread
- **Location**: `rhizo_viewer.py:258-431`
- **Role**:
  - Renders received frames to OpenGL window
  - Handles aspect ratio preservation
  - Manages texture updates and rendering
  - Displays frames on external monitor
- **Dependencies**:
  - ModernGL window context
  - Frame queue (from WebSocket thread)
  - OpenGL rendering pipeline
- **Frequency**: VSync (typically 60 FPS)
- **Priority**: MEDIUM - External display

### 17. **MIDI Processing Thread**
- **Name**: `MIDIManager` / MIDI Input Handler
- **Location**: `src/midi/MIDIManager.js`
- **Role**:
  - Receives MIDI input events
  - Maps MIDI CC/notes to parameters
  - Updates parameter values from MIDI
  - Throttles MIDI updates to prevent overload
- **Dependencies**:
  - Web MIDI API
  - `ParameterBindingSystem` (parameter binding)
  - `Editor` (parameter updates)
- **Frequency**: On-demand (MIDI events)
- **Priority**: MEDIUM - MIDI control support

### 18. **Save/Load Manager Thread**
- **Name**: `SaveLoadManager` / File I/O Handler
- **Location**: `src/core/SaveLoadManager.js`
- **Role**:
  - Handles graph serialization/deserialization
  - Manages file save/load operations
  - Coordinates backup creation
  - Handles import/export operations
- **Dependencies**:
  - `Graph` (graph data)
  - Browser File API
  - LocalStorage/IndexedDB
- **Frequency**: On-demand (user-initiated)
- **Priority**: LOW - File operations

### 19. **Undo/Redo Manager Thread**
- **Name**: `UndoManager` / History Manager
- **Location**: `src/core/UndoManager.js`
- **Role**:
  - Manages undo/redo history
  - Tracks graph state changes
  - Handles undo/redo operations
- **Dependencies**:
  - `Graph` (graph state)
  - `Editor` (editor state)
  - `ParameterEventSystem` (parameter changes)
- **Frequency**: On-demand (state changes)
- **Priority**: MEDIUM - User experience

### 20. **GPU Performance Monitor Thread**
- **Name**: `GPUPerformanceMonitor` / Performance Profiler
- **Location**: `src/utils/GPUPerformanceMonitor.js`
- **Role**:
  - Monitors GPU frame times and FPS
  - Tracks performance metrics
  - Displays performance overlay
  - Warns about performance issues
- **Dependencies**:
  - WebGPU Device (for timing queries)
  - `RenderLoop` (frame timing)
- **Frequency**: Every frame (60 FPS)
- **Priority**: LOW - Performance monitoring

### 21. **Compute Profiler Thread**
- **Name**: `ComputeProfiler` / Compute Shader Profiler
- **Location**: `src/gpu/ComputeProfiler.js`
- **Role**:
  - Profiles compute shader execution times
  - Tracks compute node performance
  - Provides profiling overlay
- **Dependencies**:
  - `ComputeExecutor` (compute execution)
  - WebGPU Device (timing queries)
- **Frequency**: On-demand (when compute nodes execute)
- **Priority**: LOW - Performance analysis

---

## THREAD DEPENDENCIES SUMMARY

### Primary Thread Dependencies:
```
RenderLoop
  ├─> GPURenderer.render()
  ├─> TimelineManager.update()
  ├─> PreviewComputer.computePreviews()
  └─> Editor.draw()

ExecutionQueue
  ├─> SystemIntegration (coordination)
  ├─> ComputeExecutor (GPU compute)
  └─> ParameterExpressionSystem (evaluation)

ComputeExecutor
  ├─> ComputeShaderManager (shader management)
  └─> Graph (dependency resolution)
```

### Secondary Thread Dependencies:
```
PreviewIntegration
  ├─> PreviewSystem
  └─> PreviewComputer

ParameterExpressionSystem
  ├─> Time context (from RenderLoop)
  └─> Audio context (from AudioEngine)

External Viewer (Python)
  ├─> WebSocket Client Thread
  └─> Render Thread
```

---

## PERFORMANCE CONSIDERATIONS

### Current Issues:
1. **Main Thread Overload**: All JavaScript execution happens on the main thread, causing potential blocking
2. **Excessive Preview Computation**: Previews computed every frame even when not needed
3. **Canvas Redraws**: Canvas redrawn every frame regardless of changes
4. **No Web Workers**: No background processing for heavy computations

### Optimization Opportunities:
1. **Move Preview Computation to Web Worker**: Offload preview computation to background thread
2. **Dirty Tracking**: Only update UI/previews when actual changes occur
3. **Throttle Parameter Evaluation**: Batch parameter evaluations instead of per-access
4. **Separate GPU Command Encoding**: Use async GPU command encoding to reduce main thread blocking

---

## NOTES

- **JavaScript Single-Threaded Model**: All JavaScript execution (except Web Workers) runs on the main thread. "Threads" here refer to execution contexts and scheduled operations.
- **Python Threading**: External services (viewer, server, audio) use actual OS threads for concurrent execution.
- **GPU Execution**: GPU operations (compute shaders, rendering) execute asynchronously on the GPU, but command encoding happens on the main thread.
- **Event Loop**: All JavaScript operations are coordinated through the browser's event loop, with `requestAnimationFrame` providing the primary rendering cadence.

