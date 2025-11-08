import { Node } from './Node.js';
import { Mat4 } from '../math/Mat4.js';
import { Vec3 } from '../math/Vec3.js';

/**
 * Camera node for defining view and projection
 */
export class CameraNode extends Node {
    /**
     * @param {string} name
     * @param {Object} options
     * @param {string} options.type - 'perspective' or 'orthographic'
     * @param {number} options.fov - field of view in degrees (for perspective)
     * @param {number} options.aspect - aspect ratio
     * @param {number} options.near - near clipping plane
     * @param {number} options.far - far clipping plane
     * @param {number} options.left - left bound (for orthographic)
     * @param {number} options.right - right bound (for orthographic)
     * @param {number} options.top - top bound (for orthographic)
     * @param {number} options.bottom - bottom bound (for orthographic)
     */
    constructor(name = '', options = {}) {
        super(name);

        /**
         * Camera type: 'perspective' or 'orthographic'
         * @type {string}
         */
        this.cameraType = options.type || 'perspective';

        // Perspective camera parameters
        /**
         * Field of view in degrees
         * @type {number}
         */
        this.fov = options.fov !== undefined ? options.fov : 60;

        /**
         * Aspect ratio
         * @type {number}
         */
        this.aspect = options.aspect !== undefined ? options.aspect : 16 / 9;

        // Common parameters
        /**
         * Near clipping plane
         * @type {number}
         */
        this.near = options.near !== undefined ? options.near : 0.1;

        /**
         * Far clipping plane
         * @type {number}
         */
        this.far = options.far !== undefined ? options.far : 1000;

        // Orthographic camera parameters
        /**
         * Left bound for orthographic camera
         * @type {number}
         */
        this.left = options.left !== undefined ? options.left : -10;

        /**
         * Right bound for orthographic camera
         * @type {number}
         */
        this.right = options.right !== undefined ? options.right : 10;

        /**
         * Top bound for orthographic camera
         * @type {number}
         */
        this.top = options.top !== undefined ? options.top : 10;

        /**
         * Bottom bound for orthographic camera
         * @type {number}
         */
        this.bottom = options.bottom !== undefined ? options.bottom : -10;

        // Cached matrices
        this._projectionMatrix = new Mat4();
        this._viewMatrix = new Mat4();
        this._projectionMatrixNeedsUpdate = true;
    }

    /**
     * Get node type
     * @returns {string}
     */
    getType() {
        return 'CameraNode';
    }

    /**
     * Set camera as perspective
     * @param {number} fov - field of view in degrees
     * @param {number} aspect - aspect ratio
     * @param {number} near - near clipping plane
     * @param {number} far - far clipping plane
     * @returns {CameraNode} this
     */
    setPerspective(fov, aspect, near, far) {
        this.cameraType = 'perspective';
        this.fov = fov;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
        this._projectionMatrixNeedsUpdate = true;
        return this;
    }

    /**
     * Set camera as orthographic
     * @param {number} left
     * @param {number} right
     * @param {number} top
     * @param {number} bottom
     * @param {number} near
     * @param {number} far
     * @returns {CameraNode} this
     */
    setOrthographic(left, right, top, bottom, near, far) {
        this.cameraType = 'orthographic';
        this.left = left;
        this.right = right;
        this.top = top;
        this.bottom = bottom;
        this.near = near;
        this.far = far;
        this._projectionMatrixNeedsUpdate = true;
        return this;
    }

    /**
     * Get projection matrix
     * @returns {Mat4}
     */
    getProjectionMatrix() {
        if (this._projectionMatrixNeedsUpdate) {
            if (this.cameraType === 'perspective') {
                const fovRadians = (this.fov * Math.PI) / 180;
                this._projectionMatrix = Mat4.perspective(
                    fovRadians,
                    this.aspect,
                    this.near,
                    this.far
                );
            } else {
                this._projectionMatrix = Mat4.orthographic(
                    this.left,
                    this.right,
                    this.bottom,
                    this.top,
                    this.near,
                    this.far
                );
            }
            this._projectionMatrixNeedsUpdate = false;
        }
        return this._projectionMatrix;
    }

    /**
     * Get view matrix (inverse of world matrix)
     * @returns {Mat4}
     */
    getViewMatrix() {
        this._viewMatrix.copy(this.getWorldMatrix()).invert();
        return this._viewMatrix;
    }

    /**
     * Look at a target position
     * @param {Vec3} target
     * @param {Vec3} up
     * @returns {CameraNode} this
     */
    lookAt(target, up = new Vec3(0, 1, 0)) {
        const position = this.getWorldPosition();
        const viewMatrix = Mat4.lookAt(position, target, up);

        // Extract rotation from view matrix and invert it
        viewMatrix.invert();

        const tempPos = new Vec3();
        const tempRot = this.transform.rotation;
        const tempScale = new Vec3();

        viewMatrix.decompose(tempPos, tempRot, tempScale);

        this.transform.setRotation(tempRot);
        return this;
    }

    /**
     * Update aspect ratio
     * @param {number} aspect
     * @returns {CameraNode} this
     */
    setAspect(aspect) {
        this.aspect = aspect;
        this._projectionMatrixNeedsUpdate = true;
        return this;
    }

    /**
     * Clone this camera node
     * @returns {CameraNode}
     */
    clone() {
        const cloned = new CameraNode(this.name, {
            type: this.cameraType,
            fov: this.fov,
            aspect: this.aspect,
            near: this.near,
            far: this.far,
            left: this.left,
            right: this.right,
            top: this.top,
            bottom: this.bottom
        });
        cloned.transform.copy(this.transform);
        cloned.visible = this.visible;
        cloned.userData = { ...this.userData };
        return cloned;
    }

    /**
     * Serialize to JSON
     * @returns {Object}
     */
    toJSON() {
        const json = super.toJSON();
        json.cameraType = this.cameraType;
        json.fov = this.fov;
        json.aspect = this.aspect;
        json.near = this.near;
        json.far = this.far;
        json.left = this.left;
        json.right = this.right;
        json.top = this.top;
        json.bottom = this.bottom;
        return json;
    }
}
