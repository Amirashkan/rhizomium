# External Viewer vs Floating Preview - Issues Analysis

## Executive Summary

The **Floating Preview** works correctly because it uses the same GPU canvas directly and properly handles aspect ratio, canvas resizing, and synchronization. The **External Viewer** has several critical issues related to aspect ratio handling, texture size management, and window resizing that cause incorrect rendering.

---

## Architecture Differences

### Floating Preview
- **Rendering Method**: Uses the same WebGPU canvas directly (moves it to a floating container)
- **Frame Source**: Direct GPU rendering, no frame streaming
- **Resize Handling**: Uses `resizeCanvasSync()` to properly synchronize GPU operations
- **Aspect Ratio**: Maintains aspect ratio through CSS sizing and proper canvas dimensions

### External Viewer
- **Rendering Method**: Receives frames via WebSocket/IPC and renders to OpenGL texture
- **Frame Source**: Streamed frames from the main renderer
- **Resize Handling**: Recreates texture on window resize (incorrectly)
- **Aspect Ratio**: No aspect ratio preservation - stretches to fill window

---

## Critical Issues in External Viewer

### Issue 1: No Aspect Ratio Preservation

**Location**: `rhizo_viewer.py` lines 197-243, 245-326

**Problem**: 
The external viewer always renders a fullscreen quad that stretches the texture to fill the entire window, regardless of the frame's aspect ratio. This causes distortion when the window aspect ratio doesn't match the frame aspect ratio.

**Code Evidence**:
```python
# Line 197-243: Fullscreen quad creation
vertex_shader = """
#version 330
in vec2 in_position;
out vec2 v_texcoord;

void main() {
    v_texcoord = in_position * 0.5 + 0.5;
    v_texcoord.y = 1.0 - v_texcoord.y;  // Flip Y
    gl_Position = vec4(in_position, 0.0, 1.0);  // Always fullscreen
}
"""
```

**Comparison with Floating Preview**:
```javascript
// Floating preview maintains aspect ratio
const { width, height } = this.settings.settings.resolution;
const aspectRatio = width / height;

let fsWidth = window.innerWidth;
let fsHeight = window.innerHeight;

// Fit to window while maintaining aspect ratio
if (fsWidth / fsHeight > aspectRatio) {
  fsWidth = fsHeight * aspectRatio;
} else {
  fsHeight = fsWidth / aspectRatio;
}
```

**Impact**: 
- Frames appear stretched or squashed
- Non-standard aspect ratios (e.g., 21:9, 4:3) are distorted
- Fullscreen mode shows incorrect proportions

---

### Issue 2: Window Resize Destroys Texture Size

**Location**: `rhizo_viewer.py` lines 349-354

**Problem**: 
When the window is resized, the `resize()` method recreates the texture to match the new window size, completely ignoring the actual frame dimensions. This causes:
1. Loss of frame dimension information
2. Texture size mismatch with incoming frames
3. Potential crashes or rendering errors

**Code Evidence**:
```python
def resize(self, width: int, height: int):
    """Handle window resize."""
    # Update texture size if needed
    if (width, height) != self.texture.size:
        self.texture = self.ctx.texture((width, height), 3)  # WRONG: Uses window size
        self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
```

**What Should Happen**:
- Window resize should only affect the viewport/rendering area
- Texture size should remain based on frame dimensions
- Aspect ratio should be recalculated for the new window size

**Comparison with Floating Preview**:
```javascript
// Floating preview properly handles resize
async updateSize() {
  const { width, height } = this.settings.settings.resolution;  // Uses frame dimensions
  // ... maintains aspect ratio ...
  await gpuRenderer.resizeCanvasSync(width, height);  // Synchronized resize
}
```

**Impact**:
- Resizing window breaks frame rendering
- Texture size becomes incorrect
- Frames may not render at all after resize

---

### Issue 3: IPC Mode Doesn't Update Texture Size

**Location**: `rhizo_viewer.py` lines 254-285

**Problem**: 
In IPC mode, the texture is initialized to the window size (1920x1080) and never updated based on actual frame dimensions. The code assumes all frames match the window size, which is incorrect.

**Code Evidence**:
```python
def _render_ipc_mode(self):
    """Render frames from IPC shared memory"""
    # ...
    if data is not None and len(data) > 0:
        self.texture.write(data.tobytes())  # Assumes texture size matches frame size
        # No check if texture size matches frame dimensions!
```

**Comparison**: 
WebSocket mode (lines 287-326) correctly checks and updates texture size:
```python
if (width, height) != self.texture.size or self.texture.components != components:
    print(f"[rhizo_viewer] Updating texture size: {width}x{height} ({format_type})")
    self.texture = self.ctx.texture((width, height), components)
```

**Impact**:
- IPC mode only works if frames are exactly 1920x1080
- Other resolutions cause rendering errors or crashes
- Frame data may be truncated or misaligned

---

### Issue 4: No Frame Dimension Tracking

**Location**: Throughout `rhizo_viewer.py`

**Problem**: 
The external viewer doesn't maintain a separate variable to track the actual frame dimensions. It only knows:
- Window size (from `window_size` or resize events)
- Texture size (which gets incorrectly changed on window resize)

**What's Missing**:
```python
# Should have:
self.frame_width = None
self.frame_height = None
self.frame_aspect_ratio = None
```

**Impact**:
- Cannot properly calculate letterboxing/pillarboxing
- Cannot maintain aspect ratio during window resize
- Cannot validate frame dimensions before rendering

---

### Issue 5: Texture Initialization Uses Window Size

**Location**: `rhizo_viewer.py` lines 44-78

**Problem**: 
The texture is initialized to `window_size` (1920x1080) before any frames are received, assuming all frames will be this size.

**Code Evidence**:
```python
def __init__(self, **kwargs):
    # ...
    # Create texture for received frames
    self.texture = self.ctx.texture(self.window_size, 3)  # Assumes 1920x1080
    self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
```

**What Should Happen**:
- Texture should be created lazily when first frame arrives
- Or initialized to a reasonable default and resized on first frame
- Should track frame dimensions separately

**Impact**:
- Wastes memory if frames are smaller
- Causes errors if frames are larger
- Assumes fixed resolution

---

### Issue 6: No Letterboxing/Pillarboxing

**Location**: `rhizo_viewer.py` lines 197-243 (vertex shader)

**Problem**: 
The fullscreen quad always fills the entire window. There's no logic to:
- Calculate letterboxing (black bars top/bottom for wide windows)
- Calculate pillarboxing (black bars left/right for tall windows)
- Center the frame within the window

**What's Needed**:
The vertex shader should calculate proper UV coordinates and positions to:
1. Maintain aspect ratio
2. Center the frame
3. Add black bars where needed

**Comparison with Floating Preview**:
```javascript
// Floating preview centers and maintains aspect ratio
this.container.style.cssText +=
  ";display:flex!important;align-items:center!important;justify-content:center!important;";
```

**Impact**:
- Frames are always stretched to fill window
- No way to see correct aspect ratio
- Professional presentation mode not possible

---

### Issue 7: Missing Frame Dimension Validation

**Location**: `rhizo_viewer.py` lines 254-285 (IPC mode)

**Problem**: 
IPC mode doesn't validate that the received frame data matches the texture size before writing. This can cause:
- Buffer overruns
- Truncated frames
- Memory corruption

**Code Evidence**:
```python
data = self.channel.recv_frame()
if data is not None and len(data) > 0:
    self.texture.write(data.tobytes())  # No size validation!
```

**What Should Happen**:
```python
# Should validate:
expected_size = self.texture.width * self.texture.height * self.texture.components
if len(data) != expected_size:
    # Resize texture or handle mismatch
```

**Impact**:
- Potential crashes with mismatched frame sizes
- Silent data corruption
- Unpredictable rendering

---

## Summary of Required Fixes

### High Priority
1. **Add aspect ratio preservation** - Calculate and maintain frame aspect ratio
2. **Fix window resize handling** - Don't change texture size on window resize
3. **Add frame dimension tracking** - Store frame width/height separately
4. **Fix IPC mode texture updates** - Update texture size based on frame dimensions

### Medium Priority
5. **Implement letterboxing/pillarboxing** - Add black bars to maintain aspect ratio
6. **Lazy texture initialization** - Create texture when first frame arrives
7. **Add frame dimension validation** - Validate frame size before writing to texture

### Low Priority
8. **Add aspect ratio configuration** - Allow user to choose stretch/letterbox/fit modes
9. **Improve error handling** - Better error messages for size mismatches
10. **Add frame dimension display** - Show actual frame size in UI

---

## Recommended Implementation Approach

### Step 1: Add Frame Dimension Tracking
```python
def __init__(self, **kwargs):
    # ...
    self.frame_width = None
    self.frame_height = None
    self.frame_aspect_ratio = None
    self.texture = None  # Initialize lazily
```

### Step 2: Update Texture on Frame Receive
```python
def _update_texture_size(self, width, height, components):
    """Update texture size if frame dimensions changed"""
    if (self.texture is None or 
        (width, height) != self.texture.size[:2] or 
        self.texture.components != components):
        if self.texture:
            self.texture.release()
        self.texture = self.ctx.texture((width, height), components)
        self.texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.frame_width = width
        self.frame_height = height
        self.frame_aspect_ratio = width / height
```

### Step 3: Fix Window Resize
```python
def resize(self, width: int, height: int):
    """Handle window resize - only update viewport, not texture"""
    # Don't change texture size - it's based on frame dimensions
    # Just update viewport if needed
    pass  # Or update viewport/rendering area only
```

### Step 4: Add Aspect Ratio Preserving Rendering
```python
def _calculate_viewport(self):
    """Calculate viewport with letterboxing/pillarboxing"""
    if not self.frame_aspect_ratio:
        return 0, 0, self.wnd.width, self.wnd.height
    
    window_aspect = self.wnd.width / self.wnd.height
    
    if window_aspect > self.frame_aspect_ratio:
        # Window is wider - add pillarboxing
        viewport_width = int(self.wnd.height * self.frame_aspect_ratio)
        viewport_height = self.wnd.height
        viewport_x = (self.wnd.width - viewport_width) // 2
        viewport_y = 0
    else:
        # Window is taller - add letterboxing
        viewport_width = self.wnd.width
        viewport_height = int(self.wnd.width / self.frame_aspect_ratio)
        viewport_x = 0
        viewport_y = (self.wnd.height - viewport_height) // 2
    
    return viewport_x, viewport_y, viewport_width, viewport_height
```

### Step 5: Update Render Methods
```python
def render(self, time_val: float, frame_time: float):
    """Main render loop with aspect ratio preservation"""
    self.ctx.clear(0.0, 0.0, 0.0)
    
    # Calculate viewport with aspect ratio
    vp_x, vp_y, vp_w, vp_h = self._calculate_viewport()
    self.ctx.viewport = (vp_x, vp_y, vp_w, vp_h)
    
    if self.use_websocket:
        self._render_websocket_mode()
    else:
        self._render_ipc_mode()
```

---

## Testing Checklist

- [ ] Test with different frame resolutions (1920x1080, 1280x720, 3840x2160, etc.)
- [ ] Test window resizing with various aspect ratios
- [ ] Test fullscreen mode
- [ ] Test IPC mode with different resolutions
- [ ] Test WebSocket mode with different resolutions
- [ ] Verify aspect ratio is maintained in all cases
- [ ] Verify letterboxing/pillarboxing appears correctly
- [ ] Test rapid resolution changes
- [ ] Test with non-standard aspect ratios (21:9, 4:3, etc.)

---

## Conclusion

The external viewer has fundamental architectural issues that prevent it from correctly displaying frames with proper aspect ratio and handling window resizing. The floating preview works correctly because it uses the same rendering pipeline directly. The external viewer needs significant refactoring to properly handle frame dimensions, aspect ratios, and window resizing.

