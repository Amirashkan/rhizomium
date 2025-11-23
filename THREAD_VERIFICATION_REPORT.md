# Rhizomium Thread Categorization Verification Report

This document verifies the categorization of all 21 Rhizomium threads into Primary and Secondary categories based on their roles, file locations, and priorities.

**Verification Date**: Generated from codebase analysis  
**Total Threads**: 21  
**Primary Threads**: 5  
**Secondary Threads**: 16

---

## PRIMARY THREADS (Core Logic)

### 1. RenderLoop
- **Category**: PRIMARY
- **Name**: `RenderLoop` / Main Animation Frame Loop
- **Role**: Primary rendering coordination thread that manages frame timing (VSync or fixed FPS), coordinates all frame-based updates, and handles simulation time and delta time calculations
- **File Path**: 
  - `src/core/RenderLoop.js` ✓
  - `main.js:handleRenderFrame()` ✓
- **Frequency**: 60 FPS (VSync) or configurable fixed FPS
- **Priority**: CRITICAL - Core rendering pipeline
- **Verification Status**: ✅ VERIFIED - File exists and role confirmed

### 2. ExecutionQueue
- **Category**: PRIMARY
- **Name**: `ExecutionQueue` / Task Queue Processor
- **Role**: Manages prioritized task execution queue, handles concurrent task execution (max 4 concurrent), coordinates shader compilation, validation, and execution, processes graph changes and node updates
- **File Path**: `src/core/ExecutionQueue.js` ✓
- **Frequency**: Continuous (throttled to ~60 FPS)
- **Priority**: HIGH - Core logic execution
- **Verification Status**: ✅ VERIFIED - File exists and role confirmed

### 3. ComputeExecutor
- **Category**: PRIMARY
- **Name**: `ComputeExecutor` / GPU Compute Dispatcher
- **Role**: Executes compute shader nodes in topological order, manages GPU compute pipeline execution, handles compute node dependencies and dispatch, coordinates fragment-to-compute and compute-to-fragment interop
- **File Path**: `src/gpu/ComputeExecutor.js` ✓
- **Frequency**: On-demand (when compute nodes need execution)
- **Priority**: HIGH - GPU compute operations
- **Verification Status**: ✅ VERIFIED - File exists

### 4. Shader Build Pipeline
- **Category**: PRIMARY
- **Name**: Shader Build Pipeline
- **Role**: Generates WGSL shader code from node graph, compiles shaders and creates GPU pipelines, manages shader cache and pipeline recreation, handles shader error reporting
- **File Path**: 
  - `src/codegen/glslBuilder.js` ✓
  - `main.js:updateShaderFromGraph()` ✓
- **Frequency**: On-demand (when graph changes)
- **Priority**: HIGH - Required for rendering
- **Verification Status**: ✅ VERIFIED - Files exist

### 5. SystemIntegration
- **Category**: PRIMARY
- **Name**: `SystemIntegration` / Core System Coordinator
- **Role**: Coordinates all subsystems (graph, type system, execution queue), manages system state and validation, handles node creation, connection, and deletion, coordinates type propagation and validation
- **File Path**: `src/core/SystemIntegration.js` ✓
- **Frequency**: On-demand (when system state changes)
- **Priority**: HIGH - System coordination
- **Verification Status**: ✅ VERIFIED - File exists

---

## SECONDARY THREADS (Peripheral Tasks)

### 6. UI Update Thread
- **Category**: SECONDARY
- **Name**: Canvas 2D Rendering / Editor UI Thread
- **Role**: Renders node graph UI (nodes, connections, grid), handles canvas 2D drawing operations, updates node positions and visual states, manages viewport transformations
- **File Path**: 
  - `src/core/Editor.js:draw()` ✓
  - `src/core/Renderer.js` ✓
- **Frequency**: Every frame (60 FPS) via RenderLoop
- **Priority**: MEDIUM - UI responsiveness
- **Verification Status**: ✅ VERIFIED - Files exist

### 7. PreviewIntegration
- **Category**: SECONDARY
- **Name**: `PreviewIntegration` / Node Preview Animation Loop
- **Role**: Updates time-based node previews, manages preview animation loop (30 FPS throttled), handles preview thumbnail generation, coordinates preview system updates
- **File Path**: `src/core/preview/PreviewIntegration.js` ✓
- **Frequency**: 30 FPS (throttled from 60 FPS)
- **Priority**: MEDIUM - Visual feedback
- **Verification Status**: ✅ VERIFIED - File exists

### 8. PreviewComputer
- **Category**: SECONDARY
- **Name**: `PreviewComputer` / Node Value Computer
- **Role**: Computes node preview values (48x48 thumbnails), evaluates node outputs for preview display, caches preview results, updates preview textures
- **File Path**: 
  - `src/core/PreviewComputer.js` ✓
  - `src/core/preview/NodeValueComputer.js` ✓
- **Frequency**: Every frame (60 FPS) but throttled during interactions
- **Priority**: MEDIUM - Preview updates
- **Verification Status**: ✅ VERIFIED - Files exist

### 9. ParameterExpressionSystem
- **Category**: SECONDARY
- **Name**: `ParameterExpressionSystem` / Expression Evaluator
- **Role**: Evaluates parameter expressions (e.g., `=time * 2`), handles time-based and audio-based expressions, manages expression caching, tracks expression dependencies
- **File Path**: `src/utils/ParameterExpressionSystem.js` ✓
- **Frequency**: On-demand (when parameter values are accessed)
- **Priority**: MEDIUM - Parameter updates
- **Verification Status**: ✅ VERIFIED - File exists

### 10. PreviewThrottler
- **Category**: SECONDARY
- **Name**: `PreviewThrottler` / Update Throttling
- **Role**: Throttles preview updates during user interactions, manages update frequency based on interaction mode (idle, edit, drag, compile), prevents excessive preview computation during parameter dragging
- **File Path**: `src/preview/PreviewThrottler.js` ✓
- **Frequency**: Variable (16ms idle, 100ms edit, 50ms drag, 500ms compile)
- **Priority**: LOW - Performance optimization
- **Verification Status**: ✅ VERIFIED - File exists

### 11. TimelineManager
- **Category**: SECONDARY
- **Name**: `TimelineManager` / Animation Timeline
- **Role**: Manages animation timeline and keyframes, updates timeline state each frame, handles timeline scrubbing and playback
- **File Path**: `src/core/TimelineManager.js` ✓
- **Frequency**: Every frame (60 FPS)
- **Priority**: MEDIUM - Animation support
- **Verification Status**: ✅ VERIFIED - File exists

### 12. EventHandler
- **Category**: SECONDARY
- **Name**: `EventHandler` / User Input Handler
- **Role**: Handles mouse and keyboard events, manages node selection and manipulation, coordinates UI interactions, triggers canvas redraws on interaction
- **File Path**: `src/core/EventHandler.js` ✓
- **Frequency**: On-demand (user input events)
- **Priority**: HIGH - User interaction responsiveness
- **Verification Status**: ✅ VERIFIED - File exists

### 13. AudioEngine
- **Category**: SECONDARY
- **Name**: `AudioEngine` / Audio Capture Thread
- **Role**: Captures audio input (mic or loopback), processes audio blocks and computes RMS, generates audio envelope values, provides audio data to JavaScript via WebSocket/API
- **File Path**: `audio/audio_engine.py` ✓
- **Frequency**: Audio sample rate (typically 44.1kHz or 48kHz)
- **Priority**: MEDIUM - Audio reactivity
- **Verification Status**: ✅ VERIFIED - File exists

### 14. FrameStreamServer
- **Category**: SECONDARY
- **Name**: `FrameStreamServer` / WebSocket Server Thread
- **Role**: Serves WebSocket connections for frame streaming, broadcasts GPU-rendered frames to external viewers, manages client connections and frame distribution
- **File Path**: 
  - `frame_stream_server.py` ✓
  - `rhizo_server.py` ✓
- **Frequency**: Frame rate (typically 30-60 FPS)
- **Priority**: MEDIUM - Dual-screen support
- **Verification Status**: ✅ VERIFIED - Files exist

### 15. RhizomiumViewer WebSocket Client Thread
- **Category**: SECONDARY
- **Name**: `RhizomiumViewer._websocket_client_thread` / Viewer WebSocket Thread
- **Role**: Connects to WebSocket server for frame streaming, receives frame data asynchronously, queues frames for rendering thread, handles reconnection logic
- **File Path**: `rhizo_viewer.py:114-200` ✓
- **Frequency**: Continuous (async event loop)
- **Priority**: MEDIUM - External viewer support
- **Verification Status**: ✅ VERIFIED - File exists

### 16. RhizomiumViewer Render Thread
- **Category**: SECONDARY
- **Name**: `RhizomiumViewer.render()` / ModernGL Render Thread
- **Role**: Renders received frames to OpenGL window, handles aspect ratio preservation, manages texture updates and rendering, displays frames on external monitor
- **File Path**: `rhizo_viewer.py:258-431` ✓
- **Frequency**: VSync (typically 60 FPS)
- **Priority**: MEDIUM - External display
- **Verification Status**: ✅ VERIFIED - File exists

### 17. MIDIManager
- **Category**: SECONDARY
- **Name**: `MIDIManager` / MIDI Input Handler
- **Role**: Receives MIDI input events, maps MIDI CC/notes to parameters, updates parameter values from MIDI, throttles MIDI updates to prevent overload
- **File Path**: `src/midi/MIDIManager.js` ✓
- **Frequency**: On-demand (MIDI events)
- **Priority**: MEDIUM - MIDI control support
- **Verification Status**: ✅ VERIFIED - File exists

### 18. SaveLoadManager
- **Category**: SECONDARY
- **Name**: `SaveLoadManager` / File I/O Handler
- **Role**: Handles graph serialization/deserialization, manages file save/load operations, coordinates backup creation, handles import/export operations
- **File Path**: `src/core/SaveLoadManager.js` ✓
- **Frequency**: On-demand (user-initiated)
- **Priority**: LOW - File operations
- **Verification Status**: ✅ VERIFIED - File exists

### 19. UndoManager
- **Category**: SECONDARY
- **Name**: `UndoManager` / History Manager
- **Role**: Manages undo/redo history, tracks graph state changes, handles undo/redo operations
- **File Path**: `src/core/UndoManager.js` ✓
- **Frequency**: On-demand (state changes)
- **Priority**: MEDIUM - User experience
- **Verification Status**: ✅ VERIFIED - File exists

### 20. GPUPerformanceMonitor
- **Category**: SECONDARY
- **Name**: `GPUPerformanceMonitor` / Performance Profiler
- **Role**: Monitors GPU frame times and FPS, tracks performance metrics, displays performance overlay, warns about performance issues
- **File Path**: `src/utils/GPUPerformanceMonitor.js` ✓
- **Frequency**: Every frame (60 FPS)
- **Priority**: LOW - Performance monitoring
- **Verification Status**: ✅ VERIFIED - File exists

### 21. ComputeProfiler
- **Category**: SECONDARY
- **Name**: `ComputeProfiler` / Compute Shader Profiler
- **Role**: Profiles compute shader execution times, tracks compute node performance, provides profiling overlay
- **File Path**: `src/gpu/ComputeProfiler.js` ✓
- **Frequency**: On-demand (when compute nodes execute)
- **Priority**: LOW - Performance analysis
- **Verification Status**: ✅ VERIFIED - File exists

---

## VERIFICATION SUMMARY

### Categorization Rationale

**PRIMARY THREADS** (5 threads):
- All threads are **CRITICAL** or **HIGH** priority
- Core to the rendering and execution pipeline
- Required for basic application functionality
- Handle essential operations: rendering, execution, GPU compute, shader compilation, system coordination

**SECONDARY THREADS** (16 threads):
- Priority ranges from **LOW** to **HIGH** (but not CRITICAL)
- Support peripheral features and user experience enhancements
- Include UI rendering, previews, user input, external services, and utility functions
- Can be disabled or throttled without breaking core functionality

### Verification Results

| Category | Count | Status |
|----------|-------|--------|
| Primary Threads | 5 | ✅ All verified |
| Secondary Threads | 16 | ✅ All verified |
| **Total** | **21** | **✅ 100% Verified** |

### File Path Verification

- ✅ All 21 threads have verified file locations
- ✅ All file paths match the documented locations
- ✅ No missing or incorrect file paths detected

### Priority Distribution

**Primary Threads:**
- CRITICAL: 1 (RenderLoop)
- HIGH: 4 (ExecutionQueue, ComputeExecutor, Shader Build Pipeline, SystemIntegration)

**Secondary Threads:**
- HIGH: 1 (EventHandler)
- MEDIUM: 11 (UI Update, PreviewIntegration, PreviewComputer, ParameterExpressionSystem, TimelineManager, AudioEngine, FrameStreamServer, RhizomiumViewer WebSocket Client, RhizomiumViewer Render, MIDIManager, UndoManager)
- LOW: 4 (PreviewThrottler, SaveLoadManager, GPUPerformanceMonitor, ComputeProfiler)

---

## CONCLUSION

✅ **VERIFICATION COMPLETE**: All 21 Rhizomium threads have been verified and correctly categorized into Primary (5) and Secondary (16) categories based on their roles, file locations, priorities, and functional importance to the core system.

The categorization accurately reflects:
- **Primary threads** are essential for core rendering and execution
- **Secondary threads** support peripheral features and user experience
- All file paths are correct and verified
- Priority levels appropriately reflect thread importance
- Frequency patterns align with thread roles

