/**
 * UVTransform
 *
 * Utilities for transforming UV coordinates
 * Supports scale, rotate, offset, and other UV manipulations
 */

export class UVTransform {
    /**
     * Apply scale to UV coordinates
     * @param {Float32Array} uvs - Input UV coordinates
     * @param {number} scaleU - Scale factor for U coordinate
     * @param {number} scaleV - Scale factor for V coordinate
     * @returns {Float32Array} Transformed UV coordinates
     */
    static scale(uvs, scaleU, scaleV) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i += 2) {
            result[i] = uvs[i] * scaleU;
            result[i + 1] = uvs[i + 1] * scaleV;
        }
        return result;
    }

    /**
     * Apply offset to UV coordinates
     * @param {Float32Array} uvs - Input UV coordinates
     * @param {number} offsetU - Offset for U coordinate
     * @param {number} offsetV - Offset for V coordinate
     * @returns {Float32Array} Transformed UV coordinates
     */
    static offset(uvs, offsetU, offsetV) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i += 2) {
            result[i] = uvs[i] + offsetU;
            result[i + 1] = uvs[i + 1] + offsetV;
        }
        return result;
    }

    /**
     * Rotate UV coordinates around center (0.5, 0.5)
     * @param {Float32Array} uvs - Input UV coordinates
     * @param {number} angleRadians - Rotation angle in radians
     * @param {number} centerU - Center U coordinate (default 0.5)
     * @param {number} centerV - Center V coordinate (default 0.5)
     * @returns {Float32Array} Transformed UV coordinates
     */
    static rotate(uvs, angleRadians, centerU = 0.5, centerV = 0.5) {
        const result = new Float32Array(uvs.length);
        const cos = Math.cos(angleRadians);
        const sin = Math.sin(angleRadians);

        for (let i = 0; i < uvs.length; i += 2) {
            const u = uvs[i] - centerU;
            const v = uvs[i + 1] - centerV;

            result[i] = u * cos - v * sin + centerU;
            result[i + 1] = u * sin + v * cos + centerV;
        }

        return result;
    }

    /**
     * Apply full transformation (scale, rotate, offset)
     * @param {Float32Array} uvs - Input UV coordinates
     * @param {Object} transform - Transform parameters
     * @param {number} [transform.scaleU=1.0] - Scale factor for U
     * @param {number} [transform.scaleV=1.0] - Scale factor for V
     * @param {number} [transform.offsetU=0.0] - Offset for U
     * @param {number} [transform.offsetV=0.0] - Offset for V
     * @param {number} [transform.rotation=0.0] - Rotation in radians
     * @param {number} [transform.centerU=0.5] - Rotation center U
     * @param {number} [transform.centerV=0.5] - Rotation center V
     * @returns {Float32Array} Transformed UV coordinates
     */
    static transform(uvs, transform) {
        const {
            scaleU = 1.0,
            scaleV = 1.0,
            offsetU = 0.0,
            offsetV = 0.0,
            rotation = 0.0,
            centerU = 0.5,
            centerV = 0.5
        } = transform;

        let result = uvs;

        // Apply scale first
        if (scaleU !== 1.0 || scaleV !== 1.0) {
            result = this.scale(result, scaleU, scaleV);
        }

        // Then rotation
        if (rotation !== 0.0) {
            result = this.rotate(result, rotation, centerU, centerV);
        }

        // Finally offset
        if (offsetU !== 0.0 || offsetV !== 0.0) {
            result = this.offset(result, offsetU, offsetV);
        }

        return result;
    }

    /**
     * Flip UV coordinates horizontally
     * @param {Float32Array} uvs - Input UV coordinates
     * @returns {Float32Array} Flipped UV coordinates
     */
    static flipHorizontal(uvs) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i += 2) {
            result[i] = 1.0 - uvs[i];
            result[i + 1] = uvs[i + 1];
        }
        return result;
    }

    /**
     * Flip UV coordinates vertically
     * @param {Float32Array} uvs - Input UV coordinates
     * @returns {Float32Array} Flipped UV coordinates
     */
    static flipVertical(uvs) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i += 2) {
            result[i] = uvs[i];
            result[i + 1] = 1.0 - uvs[i + 1];
        }
        return result;
    }

    /**
     * Clamp UV coordinates to [0, 1] range
     * @param {Float32Array} uvs - Input UV coordinates
     * @returns {Float32Array} Clamped UV coordinates
     */
    static clamp(uvs) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i++) {
            result[i] = Math.max(0.0, Math.min(1.0, uvs[i]));
        }
        return result;
    }

    /**
     * Apply repeat/wrap to UV coordinates
     * @param {Float32Array} uvs - Input UV coordinates
     * @returns {Float32Array} Wrapped UV coordinates
     */
    static repeat(uvs) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i++) {
            result[i] = uvs[i] - Math.floor(uvs[i]);
        }
        return result;
    }

    /**
     * Apply mirror repeat to UV coordinates
     * @param {Float32Array} uvs - Input UV coordinates
     * @returns {Float32Array} Mirrored UV coordinates
     */
    static mirrorRepeat(uvs) {
        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i++) {
            const t = uvs[i] - Math.floor(uvs[i]);
            result[i] = Math.floor(uvs[i]) % 2 === 0 ? t : 1.0 - t;
        }
        return result;
    }

    /**
     * Normalize UV coordinates to [0, 1] range based on min/max values
     * @param {Float32Array} uvs - Input UV coordinates
     * @returns {Float32Array} Normalized UV coordinates
     */
    static normalize(uvs) {
        // Find min and max
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;

        for (let i = 0; i < uvs.length; i += 2) {
            minU = Math.min(minU, uvs[i]);
            maxU = Math.max(maxU, uvs[i]);
            minV = Math.min(minV, uvs[i + 1]);
            maxV = Math.max(maxV, uvs[i + 1]);
        }

        const rangeU = maxU - minU;
        const rangeV = maxV - minV;

        const result = new Float32Array(uvs.length);
        for (let i = 0; i < uvs.length; i += 2) {
            result[i] = rangeU > 0 ? (uvs[i] - minU) / rangeU : 0.5;
            result[i + 1] = rangeV > 0 ? (uvs[i + 1] - minV) / rangeV : 0.5;
        }

        return result;
    }

    /**
     * Generate UV coordinates from vertex positions using planar projection
     * @param {Float32Array} positions - Vertex positions (x, y, z)
     * @param {string} plane - Projection plane: 'xy', 'xz', 'yz'
     * @param {Object} bounds - Optional bounding box {min: [x,y,z], max: [x,y,z]}
     * @returns {Float32Array} Generated UV coordinates
     */
    static planarProjection(positions, plane = 'xz', bounds = null) {
        const vertexCount = positions.length / 3;
        const uvs = new Float32Array(vertexCount * 2);

        // Calculate bounds if not provided
        if (!bounds) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;

            for (let i = 0; i < vertexCount; i++) {
                minX = Math.min(minX, positions[i * 3]);
                maxX = Math.max(maxX, positions[i * 3]);
                minY = Math.min(minY, positions[i * 3 + 1]);
                maxY = Math.max(maxY, positions[i * 3 + 1]);
                minZ = Math.min(minZ, positions[i * 3 + 2]);
                maxZ = Math.max(maxZ, positions[i * 3 + 2]);
            }

            bounds = {
                min: [minX, minY, minZ],
                max: [maxX, maxY, maxZ]
            };
        }

        const size = [
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2]
        ];

        for (let i = 0; i < vertexCount; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            switch (plane.toLowerCase()) {
                case 'xy':
                    uvs[i * 2] = (x - bounds.min[0]) / size[0];
                    uvs[i * 2 + 1] = (y - bounds.min[1]) / size[1];
                    break;
                case 'xz':
                    uvs[i * 2] = (x - bounds.min[0]) / size[0];
                    uvs[i * 2 + 1] = (z - bounds.min[2]) / size[2];
                    break;
                case 'yz':
                    uvs[i * 2] = (y - bounds.min[1]) / size[1];
                    uvs[i * 2 + 1] = (z - bounds.min[2]) / size[2];
                    break;
                default:
                    uvs[i * 2] = 0.5;
                    uvs[i * 2 + 1] = 0.5;
            }
        }

        return uvs;
    }

    /**
     * Generate UV coordinates using spherical projection
     * @param {Float32Array} positions - Vertex positions (x, y, z)
     * @param {Object} center - Sphere center {x, y, z}
     * @returns {Float32Array} Generated UV coordinates
     */
    static sphericalProjection(positions, center = { x: 0, y: 0, z: 0 }) {
        const vertexCount = positions.length / 3;
        const uvs = new Float32Array(vertexCount * 2);

        for (let i = 0; i < vertexCount; i++) {
            const dx = positions[i * 3] - center.x;
            const dy = positions[i * 3 + 1] - center.y;
            const dz = positions[i * 3 + 2] - center.z;

            const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (radius > 0.0001) {
                // U: azimuthal angle
                uvs[i * 2] = 0.5 + Math.atan2(dz, dx) / (2 * Math.PI);
                // V: polar angle
                uvs[i * 2 + 1] = 0.5 - Math.asin(dy / radius) / Math.PI;
            } else {
                uvs[i * 2] = 0.5;
                uvs[i * 2 + 1] = 0.5;
            }
        }

        return uvs;
    }

    /**
     * Generate UV coordinates using cylindrical projection
     * @param {Float32Array} positions - Vertex positions (x, y, z)
     * @param {string} axis - Cylinder axis: 'x', 'y', 'z'
     * @param {Object} center - Cylinder center {x, y, z}
     * @param {Object} bounds - Optional bounds for height mapping
     * @returns {Float32Array} Generated UV coordinates
     */
    static cylindricalProjection(positions, axis = 'y', center = { x: 0, y: 0, z: 0 }, bounds = null) {
        const vertexCount = positions.length / 3;
        const uvs = new Float32Array(vertexCount * 2);

        // Calculate height bounds if not provided
        if (!bounds) {
            let min = Infinity, max = -Infinity;
            const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

            for (let i = 0; i < vertexCount; i++) {
                const val = positions[i * 3 + axisIndex];
                min = Math.min(min, val);
                max = Math.max(max, val);
            }

            bounds = { min, max };
        }

        const heightRange = bounds.max - bounds.min;

        for (let i = 0; i < vertexCount; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            switch (axis.toLowerCase()) {
                case 'y':
                    // U: angle around Y axis
                    uvs[i * 2] = 0.5 + Math.atan2(z - center.z, x - center.x) / (2 * Math.PI);
                    // V: height along Y axis
                    uvs[i * 2 + 1] = (y - bounds.min) / heightRange;
                    break;
                case 'x':
                    // U: angle around X axis
                    uvs[i * 2] = 0.5 + Math.atan2(y - center.y, z - center.z) / (2 * Math.PI);
                    // V: height along X axis
                    uvs[i * 2 + 1] = (x - bounds.min) / heightRange;
                    break;
                case 'z':
                    // U: angle around Z axis
                    uvs[i * 2] = 0.5 + Math.atan2(y - center.y, x - center.x) / (2 * Math.PI);
                    // V: height along Z axis
                    uvs[i * 2 + 1] = (z - bounds.min) / heightRange;
                    break;
            }
        }

        return uvs;
    }
}
