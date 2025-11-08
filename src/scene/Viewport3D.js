import { CameraNode } from './nodes/CameraNode.js';
import { CameraController } from './CameraController.js';
import { Vec3 } from './math/Vec3.js';
import { Mat4 } from './math/Mat4.js';

/**
 * 3D Viewport manager for rendering 3D scenes with camera control
 */
export class Viewport3D {
    /**
     * @param {HTMLCanvasElement} canvas - Canvas element for 3D rendering
     * @param {Object} options - Configuration options
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.width = canvas.width;
        this.height = canvas.height;

        // Create camera
        const aspect = this.width / this.height;
        this.camera = new CameraNode('MainCamera', {
            type: options.cameraType || 'perspective',
            fov: options.fov || 60,
            aspect: aspect,
            near: options.near || 0.1,
            far: options.far || 1000,
            left: options.left || -10,
            right: options.right || 10,
            top: options.top || 10,
            bottom: options.bottom || -10
        });

        // Create camera controller
        this.cameraController = new CameraController(this.camera, canvas, {
            orbitSpeed: options.orbitSpeed || 0.005,
            panSpeed: options.panSpeed || 0.001,
            zoomSpeed: options.zoomSpeed || 0.01,
            minDistance: options.minDistance || 0.1,
            maxDistance: options.maxDistance || 100
        });

        // Set initial camera position
        if (options.initialPosition) {
            this.cameraController.setTarget(
                options.initialPosition.target || new Vec3(0, 0, 0)
            );
            this.cameraController.setDistance(
                options.initialPosition.distance || 5
            );
            if (options.initialPosition.azimuth !== undefined &&
                options.initialPosition.elevation !== undefined) {
                this.cameraController.setAngles(
                    options.initialPosition.azimuth,
                    options.initialPosition.elevation
                );
            }
        }

        // Resize observer
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                this.handleResize(entry.contentRect.width, entry.contentRect.height);
            }
        });
        this.resizeObserver.observe(canvas);
    }

    /**
     * Handle canvas resize
     * @param {number} width
     * @param {number} height
     */
    handleResize(width, height) {
        this.width = width;
        this.height = height;

        // Update camera aspect ratio
        const aspect = width / height;
        this.camera.setAspect(aspect);

        // For orthographic, maintain aspect ratio
        if (this.camera.cameraType === 'orthographic') {
            const size = 10;
            this.camera.setOrthographic(
                -size * aspect, size * aspect,
                size, -size,
                this.camera.near, this.camera.far
            );
        }
    }

    /**
     * Get the view matrix
     * @returns {Mat4}
     */
    getViewMatrix() {
        return this.camera.getViewMatrix();
    }

    /**
     * Get the projection matrix
     * @returns {Mat4}
     */
    getProjectionMatrix() {
        return this.camera.getProjectionMatrix();
    }

    /**
     * Get combined view-projection matrix
     * @returns {Mat4}
     */
    getViewProjectionMatrix() {
        const viewProj = this.getProjectionMatrix().clone();
        viewProj.multiply(this.getViewMatrix());
        return viewProj;
    }

    /**
     * Convert screen coordinates to normalized device coordinates (NDC)
     * @param {number} screenX - Screen X in pixels
     * @param {number} screenY - Screen Y in pixels
     * @returns {Object} {x, y} in range [-1, 1]
     */
    screenToNDC(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((screenX - rect.left) / rect.width) * 2 - 1;
        const y = -((screenY - rect.top) / rect.height) * 2 + 1;
        return { x, y };
    }

    /**
     * Convert NDC to screen coordinates
     * @param {number} ndcX - NDC X in range [-1, 1]
     * @param {number} ndcY - NDC Y in range [-1, 1]
     * @returns {Object} {x, y} in screen pixels
     */
    ndcToScreen(ndcX, ndcY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (ndcX + 1) / 2 * rect.width + rect.left;
        const y = (-ndcY + 1) / 2 * rect.height + rect.top;
        return { x, y };
    }

    /**
     * Create a ray from screen coordinates into the 3D scene
     * @param {number} screenX - Screen X in pixels
     * @param {number} screenY - Screen Y in pixels
     * @returns {Object} {origin: Vec3, direction: Vec3}
     */
    screenToWorldRay(screenX, screenY) {
        const ndc = this.screenToNDC(screenX, screenY);

        // Get inverse view-projection matrix
        const viewProj = this.getViewProjectionMatrix();
        const invViewProj = viewProj.clone().invert();

        // Near and far points in clip space
        const nearPoint = new Vec3(ndc.x, ndc.y, -1);
        const farPoint = new Vec3(ndc.x, ndc.y, 1);

        // Unproject to world space
        const nearWorld = this.unprojectPoint(nearPoint, invViewProj);
        const farWorld = this.unprojectPoint(farPoint, invViewProj);

        // Calculate ray direction
        const direction = farWorld.clone().subtract(nearWorld).normalize();

        return {
            origin: nearWorld,
            direction: direction
        };
    }

    /**
     * Unproject a point from clip space to world space
     * @param {Vec3} clipPoint - Point in clip space
     * @param {Mat4} invViewProj - Inverse view-projection matrix
     * @returns {Vec3} Point in world space
     */
    unprojectPoint(clipPoint, invViewProj) {
        const e = invViewProj.elements;

        // Transform point
        const x = clipPoint.x;
        const y = clipPoint.y;
        const z = clipPoint.z;

        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const wz = e[2] * x + e[6] * y + e[10] * z + e[14];

        return new Vec3(wx / w, wy / w, wz / w);
    }

    /**
     * Project a 3D world point to screen coordinates
     * @param {Vec3} worldPoint - Point in world space
     * @returns {Object} {x, y, depth} - screen coordinates and depth
     */
    worldToScreen(worldPoint) {
        const viewProj = this.getViewProjectionMatrix();
        const e = viewProj.elements;

        // Transform to clip space
        const x = worldPoint.x;
        const y = worldPoint.y;
        const z = worldPoint.z;

        const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];
        const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
        const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
        const clipZ = e[2] * x + e[6] * y + e[10] * z + e[14];

        // Perspective divide
        const ndcX = clipX / clipW;
        const ndcY = clipY / clipW;
        const ndcZ = clipZ / clipW;

        // Convert to screen coordinates
        const screen = this.ndcToScreen(ndcX, ndcY);

        return {
            x: screen.x,
            y: screen.y,
            depth: ndcZ
        };
    }

    /**
     * Convert texture/compute coordinates to world coordinates
     * This maps from [0,1] texture space to world space using field bounds
     * @param {number} u - Texture U coordinate [0, 1]
     * @param {number} v - Texture V coordinate [0, 1]
     * @param {number} w - Texture W coordinate [0, 1] (for 3D textures)
     * @param {Object} bounds - World space bounds {min: Vec3, max: Vec3}
     * @returns {Vec3} World position
     */
    textureToWorld(u, v, w = 0, bounds = null) {
        // Default bounds if not provided
        if (!bounds) {
            bounds = {
                min: new Vec3(-1, -1, -1),
                max: new Vec3(1, 1, 1)
            };
        }

        const x = bounds.min.x + u * (bounds.max.x - bounds.min.x);
        const y = bounds.min.y + v * (bounds.max.y - bounds.min.y);
        const z = bounds.min.z + w * (bounds.max.z - bounds.min.z);

        return new Vec3(x, y, z);
    }

    /**
     * Convert world coordinates to texture/compute coordinates
     * @param {Vec3} worldPoint - Point in world space
     * @param {Object} bounds - World space bounds {min: Vec3, max: Vec3}
     * @returns {Object} {u, v, w} in [0, 1] range
     */
    worldToTexture(worldPoint, bounds = null) {
        // Default bounds if not provided
        if (!bounds) {
            bounds = {
                min: new Vec3(-1, -1, -1),
                max: new Vec3(1, 1, 1)
            };
        }

        const u = (worldPoint.x - bounds.min.x) / (bounds.max.x - bounds.min.x);
        const v = (worldPoint.y - bounds.min.y) / (bounds.max.y - bounds.min.y);
        const w = (worldPoint.z - bounds.min.z) / (bounds.max.z - bounds.min.z);

        return { u, v, w };
    }

    /**
     * Switch between perspective and orthographic camera
     * @param {string} type - 'perspective' or 'orthographic'
     */
    setCameraType(type) {
        if (type === 'perspective') {
            this.camera.setPerspective(
                this.camera.fov,
                this.camera.aspect,
                this.camera.near,
                this.camera.far
            );
        } else if (type === 'orthographic') {
            const aspect = this.width / this.height;
            const size = 10;
            this.camera.setOrthographic(
                -size * aspect, size * aspect,
                size, -size,
                this.camera.near, this.camera.far
            );
        }
    }

    /**
     * Get current camera type
     * @returns {string} 'perspective' or 'orthographic'
     */
    getCameraType() {
        return this.camera.cameraType;
    }

    /**
     * Frame a bounding box in the view
     * @param {Object} bounds - {min: Vec3, max: Vec3}
     */
    frameBounds(bounds) {
        this.cameraController.frameBounds(bounds);
    }

    /**
     * Reset camera to default position
     */
    resetCamera() {
        this.cameraController.reset();
    }

    /**
     * Update (call each frame)
     */
    update() {
        this.cameraController.update();
    }

    /**
     * Dispose of the viewport and clean up resources
     */
    dispose() {
        this.cameraController.dispose();
        this.resizeObserver.disconnect();
    }

    /**
     * Get camera controller for advanced control
     * @returns {CameraController}
     */
    getController() {
        return this.cameraController;
    }

    /**
     * Get camera node
     * @returns {CameraNode}
     */
    getCamera() {
        return this.camera;
    }
}
