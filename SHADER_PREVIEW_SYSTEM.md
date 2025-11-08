# Real-Time Shader Preview System

## Overview

The Real-Time Shader Preview System provides GPU-accelerated preview rendering for GLSL nodes with intelligent throttling to reduce load during user interactions.

## Features

### 1. GPU Compute Preview
- **GPU-accelerated rendering**: Previews are rendered on GPU for better performance
- **Texture caching**: Preview textures are cached to avoid redundant renders
- **Optional CPU readback**: Preview data can be read back to CPU for thumbnail generation

### 2. Throttled Updates
- **Intelligent throttling**: Update frequency adapts to user interactions
- **Multiple modes**:
  - **Idle mode**: ~60fps (16ms interval) when no interaction
  - **Edit mode**: ~10fps (100ms interval) during parameter editing
  - **Drag mode**: ~5fps (200ms interval) during node dragging
  - **Compile mode**: ~2fps (500ms interval) during shader compilation

### 3. Single and Combined Node Preview
- **Single node preview**: Preview individual compute nodes
- **Combined preview**: Support for previewing node combinations (future)

## Architecture

### Components

#### 1. `PreviewThrottler` (`src/preview/PreviewThrottler.js`)
Manages update throttling based on user interaction state.

**Key Methods:**
- `setMode(mode)` - Set throttle mode (idle, edit, drag, compile)
- `requestUpdate(updateFn, immediate)` - Request a throttled update
- `beginDrag()` / `endDrag()` - Track drag interactions
- `beginEdit()` / `endEdit()` - Track edit interactions
- `beginCompile()` / `endCompile()` - Track compilation

#### 2. `GPUPreviewRenderer` (`src/preview/GPUPreviewRenderer.js`)
Handles GPU-based rendering and CPU readback for previews.

**Key Methods:**
- `getOrCreatePreviewTexture(nodeId, size)` - Get or create cached preview texture
- `renderToPreviewTexture(pipeline, bindGroups, nodeId, options)` - Render shader to texture
- `readbackPreviewTexture(nodeId, options)` - Read texture data to CPU
- `renderAndReadback(pipeline, bindGroups, nodeId, options)` - Combined render + readback
- `clearCache()` - Clear all cached textures

#### 3. `ShaderPreviewManager` (`src/preview/ShaderPreviewManager.js`)
Main coordinator that ties everything together.

**Key Methods:**
- `requestNodePreview(node, immediate)` - Request preview for a single node
- `requestNodesPreviews(nodes, immediate)` - Request previews for multiple nodes
- `setPreviewMode(options)` - Configure preview behavior
- `beginInteraction(type)` / `endInteraction(type)` - Track interactions for throttling

### Integration Points

The system is integrated into the Editor at several key points:

1. **Editor initialization** (`src/core/Editor.js`):
   ```javascript
   initializeShaderPreviewManager()
   ```

2. **Node dragging** (`src/core/EventHandler.js`):
   ```javascript
   // Start drag
   editor.shaderPreviewManager.beginInteraction('drag');

   // End drag
   editor.shaderPreviewManager.endInteraction('drag');
   ```

3. **Parameter editing** (`src/utils/ParameterExpressionSystem.js`, `src/ui/components/TextInputHandler.js`):
   ```javascript
   // Start edit
   editor.shaderPreviewManager.beginInteraction('edit');

   // End edit
   editor.shaderPreviewManager.endInteraction('edit');
   ```

## Usage

### Basic Usage

The system is automatically initialized with the Editor and works transparently:

```javascript
// Request preview for a single node
editor.shaderPreviewManager.requestNodePreview(node);

// Request preview for multiple nodes
editor.shaderPreviewManager.requestNodesPreviews([node1, node2, node3]);

// Request immediate update (bypass throttling)
editor.shaderPreviewManager.requestNodePreview(node, true);
```

### Configuration

Configure preview behavior:

```javascript
editor.shaderPreviewManager.setPreviewMode({
  enableGPUPreview: true,     // Use GPU for previews
  enableCPUReadback: true,    // Enable CPU readback for thumbnails
  previewSize: 256            // Preview texture size
});
```

### Manual Interaction Tracking

If adding new interaction types:

```javascript
// Start custom interaction
editor.shaderPreviewManager.beginInteraction('drag');

// Perform operations...

// End custom interaction
editor.shaderPreviewManager.endInteraction('drag');
```

## Performance Characteristics

### Throttling Intervals

| Mode | Interval | FPS | Use Case |
|------|----------|-----|----------|
| Idle | 16ms | ~60 | Normal editing, no active interaction |
| Edit | 100ms | ~10 | Parameter value editing |
| Drag | 200ms | ~5 | Node dragging, connection creation |
| Compile | 500ms | ~2 | Shader compilation in progress |

### GPU Preview vs CPU Preview

**GPU Preview (enabled by default):**
- ✅ Fast rendering on GPU
- ✅ No CPU readback overhead (unless needed)
- ✅ Better for real-time updates
- ❌ Requires GPU device availability

**CPU Preview (fallback):**
- ✅ Works without GPU
- ✅ Uses existing Canvas2D rendering
- ❌ Slower for complex shaders
- ❌ Limited to CPU performance

## Current Limitations

1. **Compute nodes only**: Currently optimized for compute shader nodes
2. **Fragment shader preview**: Fragment node preview compilation not yet implemented
3. **Combined node preview**: Multi-node preview requires additional shader compilation

## Future Enhancements

1. **Fragment shader preview**: Compile and preview fragment shader nodes
2. **Multi-node preview**: Preview combinations of connected nodes
3. **Preview cache persistence**: Save previews across sessions
4. **Adaptive quality**: Lower resolution during interactions, higher when idle
5. **Background rendering**: Render previews in background worker

## Debugging

### Check System Status

```javascript
// Check if ShaderPreviewManager is initialized
console.log(window.shaderPreviewManager);

// Check current throttle mode
console.log(window.shaderPreviewManager.throttler.mode);

// Check cached preview textures
console.log(window.shaderPreviewManager.gpuRenderer.previewCache);
```

### Enable Debug Logging

The system logs to console with `[ShaderPreviewManager]`, `[PreviewThrottler]`, and `[GPUPreviewRenderer]` prefixes.

### Common Issues

**Preview not updating:**
- Check if GPU device is available: `window.gpuRenderer?.device`
- Verify ShaderPreviewManager initialized: `window.shaderPreviewManager`
- Check throttle mode: May be throttled during interaction

**Preview quality issues:**
- Adjust preview size: `setPreviewMode({ previewSize: 512 })`
- Check GPU texture format compatibility
- Verify compute shader output is correct

## See Also

- [GLSL Architecture Overview](./GLSL_ARCHITECTURE_OVERVIEW.md)
- [ComputeNodeBase Documentation](./COMPUTE_NODE_BASE_ARCHITECTURE.md)
- [Quick Reference Guide](./QUICK_REFERENCE_GUIDE.md)
