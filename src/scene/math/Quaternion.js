import { Vec3 } from './Vec3.js';

/**
 * Quaternion class for representing rotations
 */
export class Quaternion {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} w
     */
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    /**
     * Create a copy of this quaternion
     * @returns {Quaternion}
     */
    clone() {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }

    /**
     * Copy values from another quaternion
     * @param {Quaternion} q
     * @returns {Quaternion} this
     */
    copy(q) {
        this.x = q.x;
        this.y = q.y;
        this.z = q.z;
        this.w = q.w;
        return this;
    }

    /**
     * Set quaternion components
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} w
     * @returns {Quaternion} this
     */
    set(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }

    /**
     * Set from Euler angles (in radians)
     * @param {number} x - rotation around X axis
     * @param {number} y - rotation around Y axis
     * @param {number} z - rotation around Z axis
     * @param {string} order - rotation order (default: 'XYZ')
     * @returns {Quaternion} this
     */
    setFromEuler(x, y, z, order = 'XYZ') {
        const c1 = Math.cos(x / 2);
        const c2 = Math.cos(y / 2);
        const c3 = Math.cos(z / 2);
        const s1 = Math.sin(x / 2);
        const s2 = Math.sin(y / 2);
        const s3 = Math.sin(z / 2);

        switch (order) {
            case 'XYZ':
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
                break;
            case 'YXZ':
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
                break;
            case 'ZXY':
                this.x = s1 * c2 * c3 - c1 * s2 * s3;
                this.y = c1 * s2 * c3 + s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
                break;
            case 'ZYX':
                this.x = s1 * c2 * c3 - c1 * s2 * s3;
                this.y = c1 * s2 * c3 + s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
                break;
            case 'YZX':
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 + s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
                break;
            case 'XZY':
                this.x = s1 * c2 * c3 - c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
                break;
        }

        return this;
    }

    /**
     * Set from axis and angle
     * @param {Vec3} axis - normalized axis vector
     * @param {number} angle - rotation angle in radians
     * @returns {Quaternion} this
     */
    setFromAxisAngle(axis, angle) {
        const halfAngle = angle / 2;
        const s = Math.sin(halfAngle);

        this.x = axis.x * s;
        this.y = axis.y * s;
        this.z = axis.z * s;
        this.w = Math.cos(halfAngle);

        return this;
    }

    /**
     * Multiply this quaternion by another
     * @param {Quaternion} q
     * @returns {Quaternion} this
     */
    multiply(q) {
        const x = this.x * q.w + this.w * q.x + this.y * q.z - this.z * q.y;
        const y = this.y * q.w + this.w * q.y + this.z * q.x - this.x * q.z;
        const z = this.z * q.w + this.w * q.z + this.x * q.y - this.y * q.x;
        const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;

        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;

        return this;
    }

    /**
     * Calculate length squared of this quaternion
     * @returns {number}
     */
    lengthSquared() {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    /**
     * Calculate length of this quaternion
     * @returns {number}
     */
    length() {
        return Math.sqrt(this.lengthSquared());
    }

    /**
     * Normalize this quaternion
     * @returns {Quaternion} this
     */
    normalize() {
        const len = this.length();
        if (len > 0) {
            const invLen = 1 / len;
            this.x *= invLen;
            this.y *= invLen;
            this.z *= invLen;
            this.w *= invLen;
        }
        return this;
    }

    /**
     * Conjugate this quaternion
     * @returns {Quaternion} this
     */
    conjugate() {
        this.x *= -1;
        this.y *= -1;
        this.z *= -1;
        return this;
    }

    /**
     * Invert this quaternion
     * @returns {Quaternion} this
     */
    invert() {
        return this.conjugate().normalize();
    }

    /**
     * Spherical linear interpolation to another quaternion
     * @param {Quaternion} q
     * @param {number} t - interpolation factor [0, 1]
     * @returns {Quaternion} this
     */
    slerp(q, t) {
        if (t === 0) return this;
        if (t === 1) return this.copy(q);

        const x = this.x, y = this.y, z = this.z, w = this.w;

        // Calculate cosine
        let cosHalfTheta = w * q.w + x * q.x + y * q.y + z * q.z;

        if (cosHalfTheta < 0) {
            this.w = -q.w;
            this.x = -q.x;
            this.y = -q.y;
            this.z = -q.z;
            cosHalfTheta = -cosHalfTheta;
        } else {
            this.copy(q);
        }

        if (cosHalfTheta >= 1.0) {
            this.w = w;
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }

        const sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta;

        if (sqrSinHalfTheta <= Number.EPSILON) {
            const s = 1 - t;
            this.w = s * w + t * this.w;
            this.x = s * x + t * this.x;
            this.y = s * y + t * this.y;
            this.z = s * z + t * this.z;
            return this.normalize();
        }

        const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
        const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

        this.w = (w * ratioA + this.w * ratioB);
        this.x = (x * ratioA + this.x * ratioB);
        this.y = (y * ratioA + this.y * ratioB);
        this.z = (z * ratioA + this.z * ratioB);

        return this;
    }

    /**
     * Convert to array
     * @returns {number[]}
     */
    toArray() {
        return [this.x, this.y, this.z, this.w];
    }

    /**
     * Create identity quaternion
     * @returns {Quaternion}
     */
    static identity() {
        return new Quaternion(0, 0, 0, 1);
    }

    /**
     * Create from Euler angles (in radians)
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {string} order
     * @returns {Quaternion}
     */
    static fromEuler(x, y, z, order = 'XYZ') {
        return new Quaternion().setFromEuler(x, y, z, order);
    }

    /**
     * Create from axis and angle
     * @param {Vec3} axis
     * @param {number} angle
     * @returns {Quaternion}
     */
    static fromAxisAngle(axis, angle) {
        return new Quaternion().setFromAxisAngle(axis, angle);
    }
}
