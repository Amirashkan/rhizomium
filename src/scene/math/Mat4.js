import { Vec3 } from './Vec3.js';
import { Quaternion } from './Quaternion.js';

/**
 * 4x4 Matrix class for transformations
 * Stored in column-major order (like WebGL/WebGPU)
 */
export class Mat4 {
    /**
     * Create a new 4x4 matrix
     * @param {number[]} elements - optional 16 element array
     */
    constructor(elements = null) {
        this.elements = elements || [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
    }

    /**
     * Create a copy of this matrix
     * @returns {Mat4}
     */
    clone() {
        return new Mat4([...this.elements]);
    }

    /**
     * Copy values from another matrix
     * @param {Mat4} m
     * @returns {Mat4} this
     */
    copy(m) {
        for (let i = 0; i < 16; i++) {
            this.elements[i] = m.elements[i];
        }
        return this;
    }

    /**
     * Set matrix to identity
     * @returns {Mat4} this
     */
    identity() {
        this.elements = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
        return this;
    }

    /**
     * Multiply this matrix by another
     * @param {Mat4} m
     * @returns {Mat4} this
     */
    multiply(m) {
        const a = this.elements;
        const b = m.elements;
        const result = [];

        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += a[i + k * 4] * b[k + j * 4];
                }
                result[i + j * 4] = sum;
            }
        }

        this.elements = result;
        return this;
    }

    /**
     * Set matrix from position, rotation (quaternion), and scale
     * @param {Vec3} position
     * @param {Quaternion} rotation
     * @param {Vec3} scale
     * @returns {Mat4} this
     */
    compose(position, rotation, scale) {
        const e = this.elements;

        const x = rotation.x, y = rotation.y, z = rotation.z, w = rotation.w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        const sx = scale.x, sy = scale.y, sz = scale.z;

        e[0] = (1 - (yy + zz)) * sx;
        e[1] = (xy + wz) * sx;
        e[2] = (xz - wy) * sx;
        e[3] = 0;

        e[4] = (xy - wz) * sy;
        e[5] = (1 - (xx + zz)) * sy;
        e[6] = (yz + wx) * sy;
        e[7] = 0;

        e[8] = (xz + wy) * sz;
        e[9] = (yz - wx) * sz;
        e[10] = (1 - (xx + yy)) * sz;
        e[11] = 0;

        e[12] = position.x;
        e[13] = position.y;
        e[14] = position.z;
        e[15] = 1;

        return this;
    }

    /**
     * Decompose matrix into position, rotation, and scale
     * @param {Vec3} position
     * @param {Quaternion} rotation
     * @param {Vec3} scale
     * @returns {Mat4} this
     */
    decompose(position, rotation, scale) {
        const e = this.elements;

        let sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
        const sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
        const sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);

        // Determine if we have a negative scale
        const det = this.determinant();
        if (det < 0) sx = -sx;

        position.x = e[12];
        position.y = e[13];
        position.z = e[14];

        // Scale the rotation part
        const invSX = 1 / sx;
        const invSY = 1 / sy;
        const invSZ = 1 / sz;

        const m11 = e[0] * invSX;
        const m12 = e[4] * invSY;
        const m13 = e[8] * invSZ;
        const m21 = e[1] * invSX;
        const m22 = e[5] * invSY;
        const m23 = e[9] * invSZ;
        const m31 = e[2] * invSX;
        const m32 = e[6] * invSY;
        const m33 = e[10] * invSZ;

        const trace = m11 + m22 + m33;

        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            rotation.w = 0.25 / s;
            rotation.x = (m32 - m23) * s;
            rotation.y = (m13 - m31) * s;
            rotation.z = (m21 - m12) * s;
        } else if (m11 > m22 && m11 > m33) {
            const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
            rotation.w = (m32 - m23) / s;
            rotation.x = 0.25 * s;
            rotation.y = (m12 + m21) / s;
            rotation.z = (m13 + m31) / s;
        } else if (m22 > m33) {
            const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
            rotation.w = (m13 - m31) / s;
            rotation.x = (m12 + m21) / s;
            rotation.y = 0.25 * s;
            rotation.z = (m23 + m32) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
            rotation.w = (m21 - m12) / s;
            rotation.x = (m13 + m31) / s;
            rotation.y = (m23 + m32) / s;
            rotation.z = 0.25 * s;
        }

        scale.x = sx;
        scale.y = sy;
        scale.z = sz;

        return this;
    }

    /**
     * Calculate determinant
     * @returns {number}
     */
    determinant() {
        const e = this.elements;

        const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
        const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
        const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
        const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];

        return (
            n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
            n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
            n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
            n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
        );
    }

    /**
     * Invert this matrix
     * @returns {Mat4} this
     */
    invert() {
        const e = this.elements;

        const n11 = e[0], n21 = e[1], n31 = e[2], n41 = e[3];
        const n12 = e[4], n22 = e[5], n32 = e[6], n42 = e[7];
        const n13 = e[8], n23 = e[9], n33 = e[10], n43 = e[11];
        const n14 = e[12], n24 = e[13], n34 = e[14], n44 = e[15];

        const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
        const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
        const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
        const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

        const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;

        if (det === 0) {
            console.warn('Mat4.invert(): Cannot invert matrix, determinant is 0');
            return this.identity();
        }

        const detInv = 1 / det;

        e[0] = t11 * detInv;
        e[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
        e[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
        e[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;

        e[4] = t12 * detInv;
        e[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
        e[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
        e[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;

        e[8] = t13 * detInv;
        e[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
        e[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
        e[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;

        e[12] = t14 * detInv;
        e[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
        e[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
        e[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;

        return this;
    }

    /**
     * Transpose this matrix
     * @returns {Mat4} this
     */
    transpose() {
        const e = this.elements;
        let temp;

        temp = e[1]; e[1] = e[4]; e[4] = temp;
        temp = e[2]; e[2] = e[8]; e[8] = temp;
        temp = e[6]; e[6] = e[9]; e[9] = temp;
        temp = e[3]; e[3] = e[12]; e[12] = temp;
        temp = e[7]; e[7] = e[13]; e[13] = temp;
        temp = e[11]; e[11] = e[14]; e[14] = temp;

        return this;
    }

    /**
     * Create a perspective projection matrix
     * @param {number} fov - field of view in radians
     * @param {number} aspect - aspect ratio
     * @param {number} near - near plane
     * @param {number} far - far plane
     * @returns {Mat4}
     */
    static perspective(fov, aspect, near, far) {
        const mat = new Mat4();
        const e = mat.elements;

        const f = 1.0 / Math.tan(fov / 2);
        const rangeInv = 1.0 / (near - far);

        e[0] = f / aspect;
        e[1] = 0;
        e[2] = 0;
        e[3] = 0;

        e[4] = 0;
        e[5] = f;
        e[6] = 0;
        e[7] = 0;

        e[8] = 0;
        e[9] = 0;
        e[10] = (near + far) * rangeInv;
        e[11] = -1;

        e[12] = 0;
        e[13] = 0;
        e[14] = near * far * rangeInv * 2;
        e[15] = 0;

        return mat;
    }

    /**
     * Create an orthographic projection matrix
     * @param {number} left
     * @param {number} right
     * @param {number} bottom
     * @param {number} top
     * @param {number} near
     * @param {number} far
     * @returns {Mat4}
     */
    static orthographic(left, right, bottom, top, near, far) {
        const mat = new Mat4();
        const e = mat.elements;

        const w = 1.0 / (right - left);
        const h = 1.0 / (top - bottom);
        const p = 1.0 / (far - near);

        e[0] = 2 * w;
        e[1] = 0;
        e[2] = 0;
        e[3] = 0;

        e[4] = 0;
        e[5] = 2 * h;
        e[6] = 0;
        e[7] = 0;

        e[8] = 0;
        e[9] = 0;
        e[10] = -2 * p;
        e[11] = 0;

        e[12] = -(right + left) * w;
        e[13] = -(top + bottom) * h;
        e[14] = -(far + near) * p;
        e[15] = 1;

        return mat;
    }

    /**
     * Create a look-at view matrix
     * @param {Vec3} eye - camera position
     * @param {Vec3} target - look at target
     * @param {Vec3} up - up vector
     * @returns {Mat4}
     */
    static lookAt(eye, target, up) {
        const mat = new Mat4();
        const e = mat.elements;

        const z = new Vec3()
            .copy(eye)
            .subtract(target)
            .normalize();

        if (z.lengthSquared() === 0) {
            z.z = 1;
        }

        const x = new Vec3()
            .copy(up)
            .cross(z)
            .normalize();

        if (x.lengthSquared() === 0) {
            if (Math.abs(up.z) === 1) {
                z.x += 0.0001;
            } else {
                z.z += 0.0001;
            }
            z.normalize();
            x.copy(up).cross(z).normalize();
        }

        const y = new Vec3()
            .copy(z)
            .cross(x);

        e[0] = x.x; e[4] = y.x; e[8] = z.x;
        e[1] = x.y; e[5] = y.y; e[9] = z.y;
        e[2] = x.z; e[6] = y.z; e[10] = z.z;

        e[12] = -x.dot(eye);
        e[13] = -y.dot(eye);
        e[14] = -z.dot(eye);

        return mat;
    }
}
