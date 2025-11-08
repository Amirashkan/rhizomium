import { Vec3 } from './math/Vec3.js';
import { Quaternion } from './math/Quaternion.js';
import { Mat4 } from './math/Mat4.js';

/**
 * Transform class representing position, rotation, and scale
 */
export class Transform {
    constructor() {
        this.position = new Vec3(0, 0, 0);
        this.rotation = Quaternion.identity();
        this.scale = new Vec3(1, 1, 1);

        this._localMatrix = new Mat4();
        this._worldMatrix = new Mat4();
        this._matrixNeedsUpdate = true;
    }

    /**
     * Set position
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Transform} this
     */
    setPosition(x, y, z) {
        this.position.set(x, y, z);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Set rotation from Euler angles (in radians)
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {string} order
     * @returns {Transform} this
     */
    setRotationFromEuler(x, y, z, order = 'XYZ') {
        this.rotation.setFromEuler(x, y, z, order);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Set rotation from axis and angle
     * @param {Vec3} axis
     * @param {number} angle - in radians
     * @returns {Transform} this
     */
    setRotationFromAxisAngle(axis, angle) {
        this.rotation.setFromAxisAngle(axis, angle);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Set rotation from quaternion
     * @param {Quaternion} quaternion
     * @returns {Transform} this
     */
    setRotation(quaternion) {
        this.rotation.copy(quaternion);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Set scale
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Transform} this
     */
    setScale(x, y, z) {
        this.scale.set(x, y, z);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Set uniform scale
     * @param {number} s
     * @returns {Transform} this
     */
    setUniformScale(s) {
        this.scale.set(s, s, s);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Translate by offset
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Transform} this
     */
    translate(x, y, z) {
        this.position.add(new Vec3(x, y, z));
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Rotate around axis by angle
     * @param {Vec3} axis
     * @param {number} angle - in radians
     * @returns {Transform} this
     */
    rotate(axis, angle) {
        const q = Quaternion.fromAxisAngle(axis, angle);
        this.rotation.multiply(q);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Get local transformation matrix
     * @returns {Mat4}
     */
    getLocalMatrix() {
        if (this._matrixNeedsUpdate) {
            this._localMatrix.compose(this.position, this.rotation, this.scale);
            this._matrixNeedsUpdate = false;
        }
        return this._localMatrix;
    }

    /**
     * Get world transformation matrix
     * @param {Mat4|null} parentWorldMatrix
     * @returns {Mat4}
     */
    getWorldMatrix(parentWorldMatrix = null) {
        const localMatrix = this.getLocalMatrix();

        if (parentWorldMatrix) {
            this._worldMatrix.copy(parentWorldMatrix).multiply(localMatrix);
        } else {
            this._worldMatrix.copy(localMatrix);
        }

        return this._worldMatrix;
    }

    /**
     * Mark matrix as needing update
     */
    markMatrixNeedsUpdate() {
        this._matrixNeedsUpdate = true;
    }

    /**
     * Copy values from another transform
     * @param {Transform} transform
     * @returns {Transform} this
     */
    copy(transform) {
        this.position.copy(transform.position);
        this.rotation.copy(transform.rotation);
        this.scale.copy(transform.scale);
        this._matrixNeedsUpdate = true;
        return this;
    }

    /**
     * Clone this transform
     * @returns {Transform}
     */
    clone() {
        const t = new Transform();
        t.position.copy(this.position);
        t.rotation.copy(this.rotation);
        t.scale.copy(this.scale);
        return t;
    }

    /**
     * Reset to identity
     * @returns {Transform} this
     */
    reset() {
        this.position.set(0, 0, 0);
        this.rotation.set(0, 0, 0, 1);
        this.scale.set(1, 1, 1);
        this._matrixNeedsUpdate = true;
        return this;
    }
}
