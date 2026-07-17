/**
 * ShapeGeometry
 *
 * Parametric primitives the 3D Field Visualizer maps compute textures onto.
 * All shapes fit in [-1, 1], carry per-vertex normals + UVs, and use
 * Uint32Array indices. Built once per (shape, segments) and cached — the
 * GPU shape path never regenerates geometry per frame.
 */

export class ShapeGeometry {
    static SHAPES = ['plane', 'sphere', 'box', 'torus'];

    static _cache = new Map();

    /**
     * Get (build + cache) a shape's geometry.
     * @param {string} shape - 'plane' | 'sphere' | 'box' | 'torus'
     * @param {number} segments - Tessellation (clamped to [4, 256])
     * @returns {Object} { positions, normals, uvs, indices, vertexCount, indexCount }
     */
    static get(shape, segments = 96) {
        const seg = Math.max(4, Math.min(256, Math.round(segments) || 96));
        const key = `${shape}:${seg}`;
        let geometry = this._cache.get(key);
        if (!geometry) {
            switch (shape) {
                case 'sphere': geometry = this.sphere(seg); break;
                case 'box': geometry = this.box(Math.max(1, Math.round(seg / 4))); break;
                case 'torus': geometry = this.torus(seg); break;
                case 'plane':
                default: geometry = this.plane(seg); break;
            }
            this._cache.set(key, geometry);
        }
        return geometry;
    }

    /**
     * XZ ground plane spanning [-1,1], normals +Y.
     */
    static plane(segments) {
        const n = segments + 1;
        const positions = new Float32Array(n * n * 3);
        const normals = new Float32Array(n * n * 3);
        const uvs = new Float32Array(n * n * 2);

        for (let iz = 0; iz < n; iz++) {
            for (let ix = 0; ix < n; ix++) {
                const i = iz * n + ix;
                const u = ix / segments;
                const v = iz / segments;
                positions[i * 3 + 0] = u * 2 - 1;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = v * 2 - 1;
                normals[i * 3 + 1] = 1;
                uvs[i * 2 + 0] = u;
                uvs[i * 2 + 1] = v;
            }
        }

        return this._withGridIndices(positions, normals, uvs, segments, segments, n);
    }

    /**
     * UV sphere, radius 1.
     */
    static sphere(segments) {
        const n = segments + 1;
        const positions = new Float32Array(n * n * 3);
        const normals = new Float32Array(n * n * 3);
        const uvs = new Float32Array(n * n * 2);

        for (let iy = 0; iy < n; iy++) {
            const v = iy / segments;
            const phi = v * Math.PI; // 0 = top pole
            for (let ix = 0; ix < n; ix++) {
                const u = ix / segments;
                const theta = u * Math.PI * 2;
                const i = iy * n + ix;

                const x = Math.sin(phi) * Math.cos(theta);
                const y = Math.cos(phi);
                const z = Math.sin(phi) * Math.sin(theta);

                positions[i * 3 + 0] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
                normals[i * 3 + 0] = x;
                normals[i * 3 + 1] = y;
                normals[i * 3 + 2] = z;
                uvs[i * 2 + 0] = u;
                uvs[i * 2 + 1] = v;
            }
        }

        return this._withGridIndices(positions, normals, uvs, segments, segments, n);
    }

    /**
     * Cube spanning [-1,1] with a (segments x segments) grid per face.
     */
    static box(segments) {
        // Each face: normal axis + two tangent axes
        const faces = [
            { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },   // +Z
            { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },  // -Z
            { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },  // +X
            { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },   // -X
            { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // +Y
            { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] }    // -Y
        ];

        const perFaceVerts = (segments + 1) * (segments + 1);
        const vertexCount = perFaceVerts * 6;
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const uvs = new Float32Array(vertexCount * 2);
        const indices = new Uint32Array(segments * segments * 6 * 6);

        let vi = 0;
        let ii = 0;
        for (const face of faces) {
            const base = vi;
            for (let it = 0; it <= segments; it++) {
                const t = it / segments;
                for (let is = 0; is <= segments; is++) {
                    const s = is / segments;
                    const su = s * 2 - 1;
                    const tv = t * 2 - 1;
                    positions[vi * 3 + 0] = face.n[0] + face.u[0] * su + face.v[0] * tv;
                    positions[vi * 3 + 1] = face.n[1] + face.u[1] * su + face.v[1] * tv;
                    positions[vi * 3 + 2] = face.n[2] + face.u[2] * su + face.v[2] * tv;
                    normals[vi * 3 + 0] = face.n[0];
                    normals[vi * 3 + 1] = face.n[1];
                    normals[vi * 3 + 2] = face.n[2];
                    uvs[vi * 2 + 0] = s;
                    uvs[vi * 2 + 1] = t;
                    vi++;
                }
            }
            const row = segments + 1;
            for (let it = 0; it < segments; it++) {
                for (let is = 0; is < segments; is++) {
                    const a = base + it * row + is;
                    const b = a + 1;
                    const c = a + row;
                    const d = c + 1;
                    indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
                    indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
                }
            }
        }

        return { positions, normals, uvs, indices, vertexCount, indexCount: indices.length };
    }

    /**
     * Torus in the XZ plane. Major radius 0.65, minor 0.35 (fits [-1,1]).
     */
    static torus(segments) {
        const R = 0.65;
        const r = 0.35;
        const n = segments + 1;
        const positions = new Float32Array(n * n * 3);
        const normals = new Float32Array(n * n * 3);
        const uvs = new Float32Array(n * n * 2);

        for (let j = 0; j < n; j++) {
            const v = j / segments;
            const phi = v * Math.PI * 2; // around the tube
            for (let i = 0; i < n; i++) {
                const u = i / segments;
                const theta = u * Math.PI * 2; // around the ring
                const k = j * n + i;

                const cx = Math.cos(theta);
                const cz = Math.sin(theta);
                positions[k * 3 + 0] = (R + r * Math.cos(phi)) * cx;
                positions[k * 3 + 1] = r * Math.sin(phi);
                positions[k * 3 + 2] = (R + r * Math.cos(phi)) * cz;
                normals[k * 3 + 0] = Math.cos(phi) * cx;
                normals[k * 3 + 1] = Math.sin(phi);
                normals[k * 3 + 2] = Math.cos(phi) * cz;
                uvs[k * 2 + 0] = u;
                uvs[k * 2 + 1] = v;
            }
        }

        return this._withGridIndices(positions, normals, uvs, segments, segments, n);
    }

    /**
     * Standard two-triangles-per-cell indices for a (cols+1) x (rows+1) grid.
     * @private
     */
    static _withGridIndices(positions, normals, uvs, cols, rows, rowStride) {
        const indices = new Uint32Array(cols * rows * 6);
        let ii = 0;
        for (let iy = 0; iy < rows; iy++) {
            for (let ix = 0; ix < cols; ix++) {
                const a = iy * rowStride + ix;
                const b = a + 1;
                const c = a + rowStride;
                const d = c + 1;
                indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
                indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
            }
        }
        return {
            positions,
            normals,
            uvs,
            indices,
            vertexCount: positions.length / 3,
            indexCount: indices.length
        };
    }
}
