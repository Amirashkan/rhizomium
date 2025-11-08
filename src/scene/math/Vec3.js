/**
 * 3D Vector class for position and direction calculations
 */
export class Vec3 {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    /**
     * Create a copy of this vector
     * @returns {Vec3}
     */
    clone() {
        return new Vec3(this.x, this.y, this.z);
    }

    /**
     * Copy values from another vector
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

    /**
     * Set vector components
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Vec3} this
     */
    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    /**
     * Add another vector to this one
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    add(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    /**
     * Subtract another vector from this one
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    subtract(v) {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    /**
     * Multiply this vector by a scalar
     * @param {number} s
     * @returns {Vec3} this
     */
    multiplyScalar(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }

    /**
     * Divide this vector by a scalar
     * @param {number} s
     * @returns {Vec3} this
     */
    divideScalar(s) {
        return this.multiplyScalar(1 / s);
    }

    /**
     * Calculate dot product with another vector
     * @param {Vec3} v
     * @returns {number}
     */
    dot(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    /**
     * Calculate cross product with another vector
     * @param {Vec3} v
     * @returns {Vec3} this
     */
    cross(v) {
        const x = this.y * v.z - this.z * v.y;
        const y = this.z * v.x - this.x * v.z;
        const z = this.x * v.y - this.y * v.x;
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    /**
     * Calculate length squared of this vector
     * @returns {number}
     */
    lengthSquared() {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    /**
     * Calculate length of this vector
     * @returns {number}
     */
    length() {
        return Math.sqrt(this.lengthSquared());
    }

    /**
     * Normalize this vector
     * @returns {Vec3} this
     */
    normalize() {
        const len = this.length();
        if (len > 0) {
            this.divideScalar(len);
        }
        return this;
    }

    /**
     * Calculate distance to another vector
     * @param {Vec3} v
     * @returns {number}
     */
    distanceTo(v) {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Linear interpolation to another vector
     * @param {Vec3} v
     * @param {number} alpha - interpolation factor [0, 1]
     * @returns {Vec3} this
     */
    lerp(v, alpha) {
        this.x += (v.x - this.x) * alpha;
        this.y += (v.y - this.y) * alpha;
        this.z += (v.z - this.z) * alpha;
        return this;
    }

    /**
     * Check if this vector equals another
     * @param {Vec3} v
     * @returns {boolean}
     */
    equals(v) {
        return this.x === v.x && this.y === v.y && this.z === v.z;
    }

    /**
     * Convert to array
     * @returns {number[]}
     */
    toArray() {
        return [this.x, this.y, this.z];
    }

    /**
     * Create from array
     * @param {number[]} arr
     * @returns {Vec3}
     */
    static fromArray(arr) {
        return new Vec3(arr[0], arr[1], arr[2]);
    }

    /**
     * Create zero vector
     * @returns {Vec3}
     */
    static zero() {
        return new Vec3(0, 0, 0);
    }

    /**
     * Create unit vector along X axis
     * @returns {Vec3}
     */
    static unitX() {
        return new Vec3(1, 0, 0);
    }

    /**
     * Create unit vector along Y axis
     * @returns {Vec3}
     */
    static unitY() {
        return new Vec3(0, 1, 0);
    }

    /**
     * Create unit vector along Z axis
     * @returns {Vec3}
     */
    static unitZ() {
        return new Vec3(0, 0, 1);
    }
}
