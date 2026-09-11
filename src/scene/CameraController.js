import { Vec3 } from './math/Vec3.js';

/**
 * Camera controller for interactive 3D camera controls
 * Supports orbit, pan, and zoom for both perspective and orthographic cameras
 */
export class CameraController {
    /**
     * @param {CameraNode} camera - The camera to control
     * @param {HTMLElement} domElement - The DOM element to attach event listeners to
     * @param {Object} options - Configuration options
     */
    constructor(camera, domElement, options = {}) {
        this.camera = camera;
        this.domElement = domElement;

        // Camera control state
        this.enabled = true;
        this.target = new Vec3(0, 0, 0);
        this.distance = 5;

        // Orbit angles (spherical coordinates)
        this.azimuth = 0; // Rotation around Y axis (radians)
        this.elevation = Math.PI / 4; // Rotation from XZ plane (radians)

        // Control sensitivity
        this.orbitSpeed = options.orbitSpeed !== undefined ? options.orbitSpeed : 0.005;
        this.panSpeed = options.panSpeed !== undefined ? options.panSpeed : 0.001;
        this.zoomSpeed = options.zoomSpeed !== undefined ? options.zoomSpeed : 0.1;

        // Limits
        this.minDistance = options.minDistance !== undefined ? options.minDistance : 0.1;
        this.maxDistance = options.maxDistance !== undefined ? options.maxDistance : 100;
        this.minElevation = options.minElevation !== undefined ? options.minElevation : -Math.PI / 2 + 0.01;
        this.maxElevation = options.maxElevation !== undefined ? options.maxElevation : Math.PI / 2 - 0.01;

        // Mouse state
        this.isOrbiting = false;
        this.isPanning = false;
        this.isZooming = false;
        this.mouseStart = { x: 0, y: 0 };
        this.lastAngles = { azimuth: 0, elevation: 0 };
        this.lastTarget = new Vec3();

        // Touch state for mobile support
        this.touchStart = [];
        this.lastTouchDistance = 0;

        // Bind event handlers
        this.onMouseDown = this.handleMouseDown.bind(this);
        this.onMouseMove = this.handleMouseMove.bind(this);
        this.onMouseUp = this.handleMouseUp.bind(this);
        this.onWheel = this.handleWheel.bind(this);
        this.onContextMenu = this.handleContextMenu.bind(this);
        this.onTouchStart = this.handleTouchStart.bind(this);
        this.onTouchMove = this.handleTouchMove.bind(this);
        this.onTouchEnd = this.handleTouchEnd.bind(this);

        // Attach event listeners
        this.attachEventListeners();

        // Initialize camera position
        this.updateCameraPosition();
    }

    /**
     * Attach event listeners to the DOM element
     */
    attachEventListeners() {
        if (!this.domElement) return;

        this.domElement.addEventListener('mousedown', this.onMouseDown, false);
        this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
        this.domElement.addEventListener('contextmenu', this.onContextMenu, false);

        // Touch events for mobile
        this.domElement.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.domElement.addEventListener('touchmove', this.onTouchMove, { passive: false });
        this.domElement.addEventListener('touchend', this.onTouchEnd, false);
    }

    /**
     * Remove event listeners
     */
    detachEventListeners() {
        if (!this.domElement) return;

        this.domElement.removeEventListener('mousedown', this.onMouseDown);
        this.domElement.removeEventListener('wheel', this.onWheel);
        this.domElement.removeEventListener('contextmenu', this.onContextMenu);

        this.domElement.removeEventListener('touchstart', this.onTouchStart);
        this.domElement.removeEventListener('touchmove', this.onTouchMove);
        this.domElement.removeEventListener('touchend', this.onTouchEnd);

        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
    }

    /**
     * Handle mouse down event
     */
    handleMouseDown(event) {
        if (!this.enabled) return;

        event.preventDefault();

        this.mouseStart.x = event.clientX;
        this.mouseStart.y = event.clientY;

        if (event.button === 0) {
            // Left mouse button - orbit
            this.isOrbiting = true;
            this.lastAngles.azimuth = this.azimuth;
            this.lastAngles.elevation = this.elevation;
        } else if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
            // Middle mouse button or Shift + left button - pan
            this.isPanning = true;
            this.lastTarget.copy(this.target);
        } else if (event.button === 2) {
            // Right mouse button - zoom
            this.isZooming = true;
        }

        document.addEventListener('mousemove', this.onMouseMove, false);
        document.addEventListener('mouseup', this.onMouseUp, false);
    }

    /**
     * Handle mouse move event
     */
    handleMouseMove(event) {
        if (!this.enabled) return;

        const deltaX = event.clientX - this.mouseStart.x;
        const deltaY = event.clientY - this.mouseStart.y;

        if (this.isOrbiting) {
            this.orbit(deltaX, deltaY);
        } else if (this.isPanning) {
            this.pan(deltaX, deltaY);
        } else if (this.isZooming) {
            this.zoom(deltaY);
        }
    }

    /**
     * Handle mouse up event
     */
    handleMouseUp(_event) {
        if (!this.enabled) return;

        this.isOrbiting = false;
        this.isPanning = false;
        this.isZooming = false;

        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
    }

    /**
     * Handle mouse wheel event
     */
    handleWheel(event) {
        if (!this.enabled) return;

        event.preventDefault();

        const delta = event.deltaY;
        this.zoomDelta(delta);
    }

    /**
     * Handle context menu (prevent on right-click)
     *
     * The right button zooms, and the zoom is released by the document mouseup
     * bound in handleMouseDown. On Windows that mouseup is never delivered:
     * Chromium runs the native context menu in a nested message loop that
     * consumes it (crbug 40935507), so in the desktop build a right-drag here
     * left isZooming set and the camera went on zooming with every later mouse
     * move. `buttons` says which platform we are on — still held means the real
     * mouseup is coming, already released means it has been eaten and this is
     * the last word we get about the gesture.
     */
    handleContextMenu(event) {
        if (!this.enabled) return;
        event.preventDefault();
        if (this.isZooming && (event.buttons & 2) === 0) {
            this.handleMouseUp(event);
        }
    }

    /**
     * Handle touch start event
     */
    handleTouchStart(event) {
        if (!this.enabled) return;

        event.preventDefault();

        this.touchStart = Array.from(event.touches).map(touch => ({
            x: touch.clientX,
            y: touch.clientY
        }));

        if (event.touches.length === 1) {
            // Single touch - orbit
            this.isOrbiting = true;
            this.lastAngles.azimuth = this.azimuth;
            this.lastAngles.elevation = this.elevation;
        } else if (event.touches.length === 2) {
            // Two finger - pinch to zoom
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            this.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
        }
    }

    /**
     * Handle touch move event
     */
    handleTouchMove(event) {
        if (!this.enabled) return;

        event.preventDefault();

        if (event.touches.length === 1 && this.touchStart.length === 1) {
            // Single touch orbit
            const deltaX = event.touches[0].clientX - this.touchStart[0].x;
            const deltaY = event.touches[0].clientY - this.touchStart[0].y;
            this.orbit(deltaX, deltaY);
        } else if (event.touches.length === 2 && this.touchStart.length === 2) {
            // Two finger pinch zoom
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const delta = distance - this.lastTouchDistance;
            this.zoomDelta(-delta * 2);
            this.lastTouchDistance = distance;
        }
    }

    /**
     * Handle touch end event
     */
    handleTouchEnd(_event) {
        if (!this.enabled) return;

        this.isOrbiting = false;
        this.isPanning = false;
        this.touchStart = [];
    }

    /**
     * Orbit the camera around the target
     * @param {number} deltaX - Horizontal mouse delta
     * @param {number} deltaY - Vertical mouse delta
     */
    orbit(deltaX, deltaY) {
        this.azimuth = this.lastAngles.azimuth - deltaX * this.orbitSpeed;
        this.elevation = this.lastAngles.elevation + deltaY * this.orbitSpeed;

        // Clamp elevation to avoid gimbal lock
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation));

        this.updateCameraPosition();
    }

    /**
     * Pan the camera and target
     * @param {number} deltaX - Horizontal mouse delta
     * @param {number} deltaY - Vertical mouse delta
     */
    pan(deltaX, deltaY) {
        // Get camera's right and up vectors
        const viewMatrix = this.camera.getViewMatrix();

        // Extract right and up vectors from view matrix
        const right = new Vec3(
            viewMatrix.elements[0],
            viewMatrix.elements[4],
            viewMatrix.elements[8]
        );
        const up = new Vec3(
            viewMatrix.elements[1],
            viewMatrix.elements[5],
            viewMatrix.elements[9]
        );

        // Calculate pan amount based on distance
        const panAmount = this.distance * this.panSpeed;

        // Pan in screen space
        const panX = right.multiplyScalar(-deltaX * panAmount);
        const panY = up.multiplyScalar(deltaY * panAmount);

        this.target.copy(this.lastTarget);
        this.target.add(panX).add(panY);

        this.updateCameraPosition();
    }

    /**
     * Zoom the camera (adjust distance or FOV)
     * @param {number} delta - Mouse delta
     */
    zoom(delta) {
        this.zoomDelta(delta);
    }

    /**
     * Zoom by a delta amount
     * @param {number} delta
     */
    zoomDelta(delta) {
        const zoomAmount = 1 + delta * this.zoomSpeed;

        if (this.camera.cameraType === 'perspective') {
            // For perspective: adjust distance
            this.distance *= zoomAmount;
            this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        } else {
            // For orthographic: adjust bounds
            const scale = zoomAmount;
            this.camera.left *= scale;
            this.camera.right *= scale;
            this.camera.top *= scale;
            this.camera.bottom *= scale;
            this.camera._projectionMatrixNeedsUpdate = true;
        }

        this.updateCameraPosition();
    }

    /**
     * Update camera position based on current orbit angles
     */
    updateCameraPosition() {
        // Convert spherical coordinates to Cartesian
        const x = this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
        const y = this.distance * Math.sin(this.elevation);
        const z = this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

        // Set camera position
        this.camera.transform.setPosition(
            this.target.x + x,
            this.target.y + y,
            this.target.z + z
        );

        // Make camera look at target
        this.camera.lookAt(this.target);
    }

    /**
     * Set the camera target position
     * @param {number|Vec3} x
     * @param {number} y
     * @param {number} z
     */
    setTarget(x, y, z) {
        if (x instanceof Vec3) {
            this.target.copy(x);
        } else {
            this.target.set(x, y, z);
        }
        this.updateCameraPosition();
    }

    /**
     * Get the current target position
     * @returns {Vec3}
     */
    getTarget() {
        return this.target.clone();
    }

    /**
     * Set the distance from target
     * @param {number} distance
     */
    setDistance(distance) {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
        this.updateCameraPosition();
    }

    /**
     * Get the current distance
     * @returns {number}
     */
    getDistance() {
        return this.distance;
    }

    /**
     * Set orbit angles
     * @param {number} azimuth - Rotation around Y axis (radians)
     * @param {number} elevation - Rotation from XZ plane (radians)
     */
    setAngles(azimuth, elevation) {
        this.azimuth = azimuth;
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, elevation));
        this.updateCameraPosition();
    }

    /**
     * Get current orbit angles
     * @returns {Object} {azimuth, elevation}
     */
    getAngles() {
        return {
            azimuth: this.azimuth,
            elevation: this.elevation
        };
    }

    /**
     * Reset camera to default position
     */
    reset() {
        this.target.set(0, 0, 0);
        this.distance = 5;
        this.azimuth = 0;
        this.elevation = Math.PI / 4;
        this.updateCameraPosition();
    }

    /**
     * Frame a bounding box in the view
     * @param {Object} bounds - {min: Vec3, max: Vec3}
     */
    frameBounds(bounds) {
        const center = new Vec3(
            (bounds.min.x + bounds.max.x) / 2,
            (bounds.min.y + bounds.max.y) / 2,
            (bounds.min.z + bounds.max.z) / 2
        );

        const size = new Vec3(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z
        );

        const maxDim = Math.max(size.x, size.y, size.z);
        const distance = maxDim / Math.tan(this.camera.fov * Math.PI / 360) * 1.2;

        this.setTarget(center);
        this.setDistance(distance);
    }

    /**
     * Update loop - call this every frame if continuous updates are needed
     */
    update() {
        // This can be used for smooth damping or animations
        // Currently, updates are immediate in response to input
    }

    /**
     * Enable the controller
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable the controller
     */
    disable() {
        this.enabled = false;
        this.isOrbiting = false;
        this.isPanning = false;
        this.isZooming = false;
    }

    /**
     * Dispose of the controller and remove event listeners
     */
    dispose() {
        this.detachEventListeners();
        this.camera = null;
        this.domElement = null;
    }

    /**
     * Convert screen coordinates to world ray
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {number} width - Viewport width
     * @param {number} height - Viewport height
     * @returns {Object} {origin: Vec3, direction: Vec3}
     */
    screenToWorldRay(screenX, screenY, width, height) {
        // Normalize screen coordinates to [-1, 1]
        const x = (screenX / width) * 2 - 1;
        const y = -(screenY / height) * 2 + 1;

        const origin = this.camera.getWorldPosition();
        const direction = new Vec3(x, y, -1);

        // This is a simplified ray calculation
        // For accurate results, you'd need to unproject using inverse projection and view matrices

        return { origin, direction: direction.normalize() };
    }
}
