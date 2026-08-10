// src/scene/NodeCamera3D.js

/**
 * NodeCamera3D - one independent viewpoint per 3D Field Visualizer node.
 *
 * The interactive camera (Viewport3D + CameraController) is bound to the
 * viewport canvas and there is only ever one of it. A graph can hold any
 * number of 3D nodes though, and each renders its own frame, so each needs a
 * camera of its own that works with no DOM attached: this class is that
 * camera. It holds the same orbit state the controller does (azimuth,
 * elevation, distance, target) plus the projection settings, and produces the
 * view/projection matrices SceneRenderer3D needs.
 *
 * The focused node's state is mirrored to and from the interactive controller
 * (see FieldMapperIntegration), so orbiting the viewport moves exactly one
 * node's camera and leaves every other node's framing untouched.
 */

import { CameraNode } from './nodes/CameraNode.js';
import { Vec3 } from './math/Vec3.js';

// Matches CameraController's limits so state survives a round trip through
// the interactive controller unchanged
const MIN_ELEVATION = -Math.PI / 2 + 0.01;
const MAX_ELEVATION = Math.PI / 2 - 0.01;
const MIN_DISTANCE = 0.1;
const MAX_DISTANCE = 100;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export class NodeCamera3D {
    /**
     * The view a freshly created 3D node opens with - the same three-quarter
     * framing the single shared viewport used to start from.
     * @returns {Object}
     */
    static defaults() {
        return {
            azimuth: Math.PI / 4,
            elevation: Math.PI / 6,
            distance: 5,
            target: [0, 0, 0],
            type: 'perspective',
            fov: 60,
            orthoSize: 10,
            autoRotate: false,
            autoRotateSpeed: 0.25
        };
    }

    /**
     * @param {Object} state - Partial state; missing fields take the defaults
     */
    constructor(state = null) {
        this.camera = new CameraNode('NodeCamera', {
            type: 'perspective',
            fov: 60,
            aspect: 1,
            near: 0.1,
            far: 1000
        });

        Object.assign(this, NodeCamera3D.defaults());
        this._lastSpinAt = 0;

        if (state) {
            this.setState(state);
        } else {
            this._applyState();
        }
    }

    /**
     * Apply a partial state patch. Unknown/invalid fields keep their current
     * value, so a malformed saved camera degrades to a usable view instead of
     * poisoning the projection matrix with NaN.
     * @param {Object} state
     * @returns {NodeCamera3D} this
     */
    setState(state) {
        if (!state || typeof state !== 'object') return this;

        this.azimuth = finite(Number(state.azimuth), this.azimuth);
        this.elevation = clamp(finite(Number(state.elevation), this.elevation), MIN_ELEVATION, MAX_ELEVATION);
        this.distance = clamp(finite(Number(state.distance), this.distance), MIN_DISTANCE, MAX_DISTANCE);

        if (Array.isArray(state.target) && state.target.length >= 3) {
            this.target = [
                finite(Number(state.target[0]), 0),
                finite(Number(state.target[1]), 0),
                finite(Number(state.target[2]), 0)
            ];
        }

        if (state.type === 'perspective' || state.type === 'orthographic') {
            this.type = state.type;
        }
        this.fov = clamp(finite(Number(state.fov), this.fov), 1, 179);
        this.orthoSize = Math.max(0.01, finite(Number(state.orthoSize), this.orthoSize));

        if (typeof state.autoRotate === 'boolean') {
            this.autoRotate = state.autoRotate;
        }
        this.autoRotateSpeed = finite(Number(state.autoRotateSpeed), this.autoRotateSpeed);

        this._applyState();
        return this;
    }

    /**
     * Plain-object snapshot, safe to store on a graph node and serialize with
     * the project.
     * @returns {Object}
     */
    getState() {
        return {
            azimuth: this.azimuth,
            elevation: this.elevation,
            distance: this.distance,
            target: [...this.target],
            type: this.type,
            fov: this.fov,
            orthoSize: this.orthoSize,
            autoRotate: this.autoRotate,
            autoRotateSpeed: this.autoRotateSpeed
        };
    }

    /**
     * Set the aspect ratio of the frame this camera renders into
     * @param {number} aspect
     */
    setAspect(aspect) {
        if (!(aspect > 0) || !Number.isFinite(aspect)) return;
        if (this.camera.aspect === aspect) return;
        this.camera.setAspect(aspect);
        // Orthographic bounds are derived from the aspect, so they need
        // rebuilding; the perspective matrix reads it directly
        if (this.type === 'orthographic') {
            this._applyProjection();
        }
    }

    /**
     * Advance the turntable spin. Runs for every node - including ones the
     * viewport isn't currently showing - so an unfocused 3D node set to spin
     * keeps spinning in its own output.
     * @param {number} nowMs - performance.now() timestamp
     */
    update(nowMs = performance.now()) {
        if (!this.autoRotate) {
            this._lastSpinAt = nowMs;
            return;
        }
        const dt = Math.min(0.1, (nowMs - (this._lastSpinAt || nowMs)) / 1000);
        this._lastSpinAt = nowMs;
        this.azimuth += this.autoRotateSpeed * dt;
        this._applyPosition();
    }

    /**
     * @returns {import('./math/Mat4.js').Mat4}
     */
    getViewMatrix() {
        return this.camera.getViewMatrix();
    }

    /**
     * @returns {import('./math/Mat4.js').Mat4}
     */
    getProjectionMatrix() {
        return this.camera.getProjectionMatrix();
    }

    /**
     * Push the whole state onto the backing CameraNode
     * @private
     */
    _applyState() {
        this._applyProjection();
        this._applyPosition();
    }

    /**
     * @private
     */
    _applyProjection() {
        const aspect = this.camera.aspect > 0 ? this.camera.aspect : 1;
        if (this.type === 'orthographic') {
            this.camera.setOrthographic(
                -this.orthoSize * aspect, this.orthoSize * aspect,
                this.orthoSize, -this.orthoSize,
                this.camera.near, this.camera.far
            );
        } else {
            this.camera.setPerspective(this.fov, aspect, this.camera.near, this.camera.far);
        }
    }

    /**
     * Spherical orbit state -> camera transform. Mirrors
     * CameraController.updateCameraPosition() so the focused node's framing
     * doesn't jump when it is handed to (or taken back from) the interactive
     * controller.
     * @private
     */
    _applyPosition() {
        const x = this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
        const y = this.distance * Math.sin(this.elevation);
        const z = this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

        this.camera.transform.setPosition(
            this.target[0] + x,
            this.target[1] + y,
            this.target[2] + z
        );
        this.camera.lookAt(new Vec3(this.target[0], this.target[1], this.target[2]));
    }
}
