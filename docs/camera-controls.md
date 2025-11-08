# Camera Controls Documentation

This document describes the camera control system for the GLSL Node Editor's 3D viewport.

## Overview

The camera control system provides interactive controls for navigating 3D scenes with support for:
- **Orbit**: Rotate the camera around a target point
- **Pan**: Move the camera and target laterally
- **Zoom**: Move closer/farther or adjust field of view
- **Perspective and Orthographic**: Support for both projection modes

## Components

### 1. CameraNode
Located in `/src/scene/nodes/CameraNode.js`

A scene node that represents a camera with view and projection matrices.

**Features:**
- Perspective and orthographic projection modes
- Configurable FOV, aspect ratio, and clipping planes
- View matrix generation (inverse of world matrix)
- Projection matrix generation
- LookAt functionality

**Example:**
```javascript
import { CameraNode } from './src/scene/nodes/CameraNode.js';

// Create perspective camera
const camera = new CameraNode('MainCamera', {
    type: 'perspective',
    fov: 60,
    aspect: 16/9,
    near: 0.1,
    far: 1000
});

// Create orthographic camera
const orthoCamera = new CameraNode('OrthoCamera', {
    type: 'orthographic',
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    near: 0.1,
    far: 100
});

// Get matrices
const viewMatrix = camera.getViewMatrix();
const projectionMatrix = camera.getProjectionMatrix();
```

### 2. CameraController
Located in `/src/scene/CameraController.js`

Handles user input for interactive camera control.

**Features:**
- Mouse-based orbit, pan, and zoom
- Touch support for mobile devices
- Configurable sensitivity and limits
- Automatic camera position updates
- Bounding box framing

**Controls:**
- **Left Mouse Button**: Orbit around target
- **Middle Mouse Button** or **Shift + Left Button**: Pan camera
- **Right Mouse Button**: Zoom (alternative to mouse wheel)
- **Mouse Wheel**: Zoom in/out
- **Touch (1 finger)**: Orbit
- **Touch (2 fingers)**: Pinch to zoom

**Example:**
```javascript
import { CameraController } from './src/scene/CameraController.js';

const controller = new CameraController(camera, canvasElement, {
    orbitSpeed: 0.005,      // Sensitivity of orbit rotation
    panSpeed: 0.001,        // Sensitivity of panning
    zoomSpeed: 0.01,        // Sensitivity of zoom
    minDistance: 0.1,       // Minimum distance from target
    maxDistance: 100,       // Maximum distance from target
    minElevation: -Math.PI/2 + 0.01,  // Minimum elevation angle
    maxElevation: Math.PI/2 - 0.01    // Maximum elevation angle
});

// Set camera target
controller.setTarget(0, 0, 0);

// Set distance from target
controller.setDistance(5);

// Set orbit angles (radians)
controller.setAngles(0, Math.PI/4);

// Frame a bounding box
controller.frameBounds({
    min: new Vec3(-5, -5, -5),
    max: new Vec3(5, 5, 5)
});

// Reset to default position
controller.reset();
```

### 3. Viewport3D
Located in `/src/scene/Viewport3D.js`

High-level viewport manager that combines camera and controller.

**Features:**
- Automatic canvas resize handling
- Coordinate transformations (screen ↔ world ↔ texture)
- Ray casting from screen coordinates
- Camera type switching
- Complete viewport management

**Example:**
```javascript
import { Viewport3D } from './src/scene/Viewport3D.js';

const viewport = new Viewport3D(canvasElement, {
    cameraType: 'perspective',  // or 'orthographic'
    fov: 60,
    near: 0.1,
    far: 1000,
    orbitSpeed: 0.005,
    panSpeed: 0.001,
    zoomSpeed: 0.01,
    initialPosition: {
        target: new Vec3(0, 0, 0),
        distance: 5,
        azimuth: 0,
        elevation: Math.PI/4
    }
});

// In your render loop
function animate() {
    viewport.update();

    // Use matrices for rendering
    const viewMatrix = viewport.getViewMatrix();
    const projMatrix = viewport.getProjectionMatrix();

    // Your rendering code here...

    requestAnimationFrame(animate);
}
animate();
```

## Coordinate Systems

### Screen to World
Convert mouse/screen coordinates to 3D world coordinates:

```javascript
// Create a ray from screen position
const ray = viewport.screenToWorldRay(mouseX, mouseY);
console.log('Ray origin:', ray.origin);
console.log('Ray direction:', ray.direction);

// Project 3D point to screen
const screenPos = viewport.worldToScreen(new Vec3(0, 0, 0));
console.log('Screen X:', screenPos.x);
console.log('Screen Y:', screenPos.y);
console.log('Depth:', screenPos.depth);
```

### Texture to World Mapping
Convert between texture/compute coordinates and world coordinates:

```javascript
// Define world bounds for your compute field
const bounds = {
    min: new Vec3(-1, -1, -1),
    max: new Vec3(1, 1, 1)
};

// Convert texture coordinates to world position
const worldPos = viewport.textureToWorld(0.5, 0.5, 0.5, bounds);

// Convert world position to texture coordinates
const texCoords = viewport.worldToTexture(new Vec3(0, 0, 0), bounds);
console.log('U:', texCoords.u, 'V:', texCoords.v, 'W:', texCoords.w);
```

This ensures proper mapping from compute shader output (in texture coordinates) to 3D world space for visualization.

## Integration with Compute Shaders

When using with `ComputeFieldMapperNode`:

```javascript
import { ComputeFieldMapperNode } from './src/scene/nodes/ComputeFieldMapperNode.js';

// Create compute field mapper
const fieldMapper = new ComputeFieldMapperNode('NoiseField', {
    dimensions: [64, 64, 64],
    fieldBounds: {
        min: [-1, -1, -1],
        max: [1, 1, 1]
    }
});

// The fieldToWorld method maps compute indices to world coordinates
const worldPos = fieldMapper.fieldToWorld(32, 32, 32);

// Use the same bounds for viewport texture mapping
const bounds = {
    min: new Vec3(...fieldMapper.fieldBounds.min),
    max: new Vec3(...fieldMapper.fieldBounds.max)
};

// Now screen, world, and texture coordinates are all aligned
const ray = viewport.screenToWorldRay(mouseX, mouseY);
const texCoords = viewport.worldToTexture(ray.origin, bounds);
```

## Camera Projection Modes

### Perspective Camera
Natural 3D view with perspective distortion (parallel lines converge).

```javascript
viewport.setCameraType('perspective');

// Zoom affects distance from target
controller.setDistance(5);
```

**Use cases:**
- Natural 3D visualization
- Interactive scene exploration
- Realistic rendering

### Orthographic Camera
Parallel projection without perspective distortion (parallel lines stay parallel).

```javascript
viewport.setCameraType('orthographic');

// Zoom affects orthographic bounds (not distance)
// Distance still affects pan speed
```

**Use cases:**
- Technical/CAD visualization
- 2D-like views of 3D data
- Precise measurements

## Advanced Usage

### Custom Camera Setup

```javascript
// Get direct access to camera and controller
const camera = viewport.getCamera();
const controller = viewport.getController();

// Modify camera parameters
camera.fov = 45;
camera.near = 0.01;
camera.far = 10000;

// Adjust controller limits
controller.minDistance = 1;
controller.maxDistance = 50;
controller.orbitSpeed = 0.01;
```

### Disable/Enable Controls

```javascript
// Temporarily disable controls
controller.disable();

// Re-enable controls
controller.enable();

// Check if enabled
if (controller.enabled) {
    // Controls are active
}
```

### Manual Camera Updates

```javascript
// Set specific camera angles
controller.setAngles(Math.PI/4, Math.PI/6);

// Animate camera movement
function animateToPosition(targetPos, duration) {
    const startPos = controller.getTarget();
    const startTime = performance.now();

    function update() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);

        const currentPos = new Vec3(
            startPos.x + (targetPos.x - startPos.x) * t,
            startPos.y + (targetPos.y - startPos.y) * t,
            startPos.z + (targetPos.z - startPos.z) * t
        );

        controller.setTarget(currentPos);

        if (t < 1) {
            requestAnimationFrame(update);
        }
    }

    update();
}
```

## Best Practices

1. **Call `viewport.update()` every frame** in your render loop, even though updates are currently immediate (this allows for future animation/damping features).

2. **Handle canvas resize** - The Viewport3D automatically handles this via ResizeObserver, but ensure your canvas has proper size:
   ```javascript
   canvas.width = window.innerWidth;
   canvas.height = window.innerHeight;
   ```

3. **Consistent coordinate systems** - Always use the same bounds for texture↔world conversions across your application.

4. **Performance** - For large compute fields, consider using lower resolution for preview and higher for final render.

5. **Touch support** - The controller automatically supports touch gestures for mobile devices.

## Cleanup

Always dispose of viewports and controllers when done:

```javascript
// Clean up when switching scenes or closing application
viewport.dispose();  // This also disposes the controller

// Or dispose controller separately
controller.dispose();
```

## API Reference

### CameraNode
- `setPerspective(fov, aspect, near, far)` - Set as perspective camera
- `setOrthographic(left, right, top, bottom, near, far)` - Set as orthographic camera
- `getViewMatrix()` - Get view matrix
- `getProjectionMatrix()` - Get projection matrix
- `lookAt(target, up)` - Point camera at target
- `setAspect(aspect)` - Update aspect ratio

### CameraController
- `setTarget(x, y, z)` - Set orbit target position
- `setDistance(distance)` - Set distance from target
- `setAngles(azimuth, elevation)` - Set orbit angles
- `frameBounds(bounds)` - Frame bounding box in view
- `reset()` - Reset to default position
- `enable()` / `disable()` - Enable/disable controls
- `dispose()` - Clean up event listeners

### Viewport3D
- `getViewMatrix()` - Get view matrix
- `getProjectionMatrix()` - Get projection matrix
- `screenToWorldRay(x, y)` - Cast ray from screen
- `worldToScreen(point)` - Project world point to screen
- `textureToWorld(u, v, w, bounds)` - Convert texture to world coords
- `worldToTexture(point, bounds)` - Convert world to texture coords
- `setCameraType(type)` - Switch camera mode
- `resetCamera()` - Reset camera position
- `update()` - Update per frame
- `dispose()` - Clean up resources
