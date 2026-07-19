/**
 * FieldVisualizer
 *
 * Generates 3D representations from compute field data.
 * Supports multiple visualization modes:
 * - Point cloud / particles
 * - Voxel grid to mesh (marching cubes)
 */

import { PointCloudGenerator } from './generators/PointCloudGenerator.js';
import { MarchingCubes } from './algorithms/MarchingCubes.js';

export class FieldVisualizer {
    /**
     * @param {GPUDevice} device - WebGPU device
     */
    constructor(device) {
        this.device = device;

        // GPU resources
        this.computePipeline = null;
        this.bindGroup = null;
        this.buffers = {
            fieldData: null,      // Input: field values
            positions: null,      // Output: vertex positions
            colors: null,         // Output: vertex colors
            indices: null,        // Output: mesh indices (for mesh mode)
            params: null,         // Visualization parameters
            counter: null         // Atomic counter for particle generation
        };

        // Visualization parameters
        this.params = {
            // Mode: 'points' or 'mesh'
            mode: 'points',

            // Field dimensions
            dimensions: [64, 64, 64],

            // Threshold for point cloud (only show points where value > threshold)
            threshold: 0.5,

            // Iso-surface threshold for marching cubes
            isoValue: 0.5,

            // Point/particle size
            pointSize: 0.02,

            // Color mapping
            colorMode: 'field', // 'field', 'gradient', 'solid'
            colorScale: [0.0, 1.0], // Map field values from this range
            colorA: [0.2, 0.4, 1.0, 1.0], // Color at min value
            colorB: [1.0, 0.4, 0.2, 1.0], // Color at max value
            solidColor: [1.0, 1.0, 1.0, 1.0],

            // Displacement
            displacementScale: 0.0,
            displacementAxis: [0, 1, 0], // Displacement direction

            // Field bounds in world space
            fieldBounds: {
                min: [-1, -1, -1],
                max: [1, 1, 1]
            },

            // Sampling
            sampleRate: 1 // Sample every N cells (1 = every cell)
        };

        // Generated geometry
        this.geometry = {
            positions: null,
            colors: null,
            uvs: null,
            indices: null,
            vertexCount: 0,
            indexCount: 0
        };

        // UV mapping mode for procedural geometry
        this.uvMode = 'planar-xz'; // Options: 'planar-xz', 'planar-xy', 'spherical', 'cylindrical'

        this.initialized = false;
    }

    /**
     * Initialize GPU resources
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        // Create parameter buffer
        this.buffers.params = this.device.createBuffer({
            size: 256, // Enough for all parameters
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Create counter buffer for atomic operations
        this.buffers.counter = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });

        this.initialized = true;
    }

    /**
     * Set visualization mode
     * @param {string} mode - 'points' or 'mesh'
     */
    setMode(mode) {
        if (mode !== 'points' && mode !== 'mesh') {

            return;
        }
        this.params.mode = mode;
    }

    /**
     * Set field dimensions
     * @param {number[]} dimensions - [width, height, depth]
     */
    setDimensions(dimensions) {
        this.params.dimensions = dimensions;
    }

    /**
     * Set threshold for point generation
     * @param {number} threshold - Only show points where field value > threshold
     */
    setThreshold(threshold) {
        this.params.threshold = threshold;
    }

    /**
     * Set iso-value for mesh generation (marching cubes)
     * @param {number} isoValue - Surface threshold
     */
    setIsoValue(isoValue) {
        this.params.isoValue = isoValue;
    }

    /**
     * Set point size
     * @param {number} size - Point size in world units
     */
    setPointSize(size) {
        this.params.pointSize = size;
    }

    /**
     * Set color mode and parameters
     * @param {Object} colorParams
     */
    setColorParams(colorParams) {
        Object.assign(this.params, colorParams);
    }

    /**
     * Set displacement parameters
     * @param {number} scale - Displacement amount
     * @param {number[]} axis - Displacement direction [x, y, z]
     */
    setDisplacement(scale, axis = [0, 1, 0]) {
        this.params.displacementScale = scale;
        this.params.displacementAxis = axis;
    }

    /**
     * Set field bounds in world space
     * @param {number[]} min - [x, y, z]
     * @param {number[]} max - [x, y, z]
     */
    setFieldBounds(min, max) {
        this.params.fieldBounds = { min, max };
    }

    /**
     * Generate point cloud from field data
     * @param {GPUTexture} fieldTexture - Input field texture (2D or 3D)
     * @returns {Promise<Object>} Geometry data
     */
    async generatePointCloud(fieldTexture) {
        if (!this.initialized) {
            await this.initialize();
        }

        const [w, h, d] = this.params.dimensions;
        const is3D = d > 1;

        // Use PointCloudGenerator to create geometry
        const geometry = await PointCloudGenerator.generateFromTexture(
            fieldTexture,
            this.device,
            [w, h],
            {
                threshold: this.params.threshold,
                sampleRate: this.params.sampleRate,
                bounds: this.params.fieldBounds,
                colorMode: this.params.colorMode,
                colorScale: this.params.colorScale,
                colorA: this.params.colorA,
                colorB: this.params.colorB,
                solidColor: this.params.solidColor,
                displacementScale: this.params.displacementScale,
                displacementAxis: this.params.displacementAxis,
                is3D
            }
        );

        // Generate UVs for point cloud
        const uvs = this.generateUVs(geometry.positions, geometry.vertexCount);

        this.geometry = {
            positions: geometry.positions,
            colors: geometry.colors,
            uvs,
            indices: null,
            normals: null,
            vertexCount: geometry.vertexCount,
            indexCount: 0
        };

        return this.geometry;
    }

    /**
     * Generate mesh from field data using marching cubes
     * @param {Float32Array} fieldData - 3D field data
     * @returns {Object} Geometry data
     */
    async generateMesh(fieldData) {
        if (!this.initialized) {
            await this.initialize();
        }

        const [w, h, d] = this.params.dimensions;

        // Use MarchingCubes to generate mesh
        const mesh = MarchingCubes.generateMesh(
            fieldData,
            [w, h, d],
            this.params.isoValue,
            this.params.fieldBounds
        );

        // Generate colors for vertices (based on position or normal)
        const colors = new Float32Array(mesh.vertexCount * 4);
        for (let i = 0; i < mesh.vertexCount; i++) {
            const color = this.calculateColor(0.5); // Default mid-value
            colors[i * 4 + 0] = color[0];
            colors[i * 4 + 1] = color[1];
            colors[i * 4 + 2] = color[2];
            colors[i * 4 + 3] = color[3];
        }

        // Generate UVs for mesh
        const uvs = this.generateUVs(mesh.positions, mesh.vertexCount);

        this.geometry = {
            positions: mesh.positions,
            normals: mesh.normals,
            colors,
            uvs,
            indices: mesh.indices,
            vertexCount: mesh.vertexCount,
            indexCount: mesh.indices.length
        };

        return this.geometry;
    }

    /**
     * Generate mesh from 3D texture using marching cubes
     * @param {GPUTexture} texture - Input 3D texture
     * @param {GPUDevice} device - WebGPU device
     * @returns {Promise<Object>} Geometry data
     */
    async generateMeshFromTexture3D(texture, device) {
        if (!this.initialized) {
            await this.initialize();
        }

        const [w, h, d] = this.params.dimensions;

        // Import PointCloudGenerator for texture reading utility
        const { PointCloudGenerator } = await import('./generators/PointCloudGenerator.js');

        // Read texture data
        const fieldData = await PointCloudGenerator.readTextureData3D(texture, device, [w, h, d]);

        // Use MarchingCubes to generate mesh
        const mesh = MarchingCubes.generateMesh(
            fieldData,
            [w, h, d],
            this.params.isoValue,
            this.params.fieldBounds
        );

        // Generate colors for vertices (based on position or normal)
        const colors = new Float32Array(mesh.vertexCount * 4);
        for (let i = 0; i < mesh.vertexCount; i++) {
            const color = this.calculateColor(0.5); // Default mid-value
            colors[i * 4 + 0] = color[0];
            colors[i * 4 + 1] = color[1];
            colors[i * 4 + 2] = color[2];
            colors[i * 4 + 3] = color[3];
        }

        // Generate UVs for mesh
        const uvs = this.generateUVs(mesh.positions, mesh.vertexCount);

        this.geometry = {
            positions: mesh.positions,
            normals: mesh.normals,
            colors,
            uvs,
            indices: mesh.indices,
            vertexCount: mesh.vertexCount,
            indexCount: mesh.indices.length
        };

        return this.geometry;
    }

    /**
     * Generate a heightmap surface mesh from a 2D field texture.
     * The field value drives vertex height along Y within the field bounds.
     * @param {GPUTexture} texture - Input 2D texture
     * @param {GPUDevice} device - WebGPU device
     * @returns {Promise<Object|null>} Geometry data
     */
    async generateHeightmapMesh(texture, device) {
        if (!this.initialized) {
            await this.initialize();
        }

        const [w, h] = this.params.dimensions;

        const fieldData = await PointCloudGenerator.readFieldSlice(texture, device, w, h);
        if (!fieldData) {
            return null;
        }

        const mesh = FieldVisualizer.buildHeightmapMesh(
            fieldData,
            w,
            h,
            this.params.fieldBounds,
            (value) => this.calculateColor(value)
        );

        this.geometry = mesh;
        return this.geometry;
    }

    /**
     * Build a heightmap grid mesh from CPU field data.
     * @param {Float32Array} fieldData - gridW * gridH field values in [0,1]
     * @param {number} gridW - Grid width (>= 2)
     * @param {number} gridH - Grid height (>= 2)
     * @param {Object} bounds - {min: [x,y,z], max: [x,y,z]} world bounds
     * @param {Function} colorFn - Maps a field value to an RGBA array
     * @returns {Object} Geometry data
     */
    static buildHeightmapMesh(fieldData, gridW, gridH, bounds, colorFn = () => [1, 1, 1, 1]) {
        const { min, max } = bounds;
        const vertexCount = gridW * gridH;

        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 4);
        const uvs = new Float32Array(vertexCount * 2);

        const sizeX = max[0] - min[0];
        const sizeY = max[1] - min[1];
        const sizeZ = max[2] - min[2];
        const cellX = gridW > 1 ? sizeX / (gridW - 1) : 1;
        const cellZ = gridH > 1 ? sizeZ / (gridH - 1) : 1;

        const heightAt = (x, y) => {
            const cx = Math.max(0, Math.min(gridW - 1, x));
            const cy = Math.max(0, Math.min(gridH - 1, y));
            const v = Math.max(0, Math.min(1, fieldData[cy * gridW + cx]));
            return v * sizeY;
        };

        for (let gy = 0; gy < gridH; gy++) {
            for (let gx = 0; gx < gridW; gx++) {
                const i = gy * gridW + gx;
                const tx = gridW > 1 ? gx / (gridW - 1) : 0;
                const tz = gridH > 1 ? gy / (gridH - 1) : 0;
                const value = Math.max(0, Math.min(1, fieldData[i]));

                positions[i * 3 + 0] = min[0] + tx * sizeX;
                positions[i * 3 + 1] = min[1] + value * sizeY;
                positions[i * 3 + 2] = min[2] + tz * sizeZ;

                // Normal from central height differences
                const dx = (heightAt(gx + 1, gy) - heightAt(gx - 1, gy)) / (2 * cellX);
                const dz = (heightAt(gx, gy + 1) - heightAt(gx, gy - 1)) / (2 * cellZ);
                const len = Math.sqrt(dx * dx + 1 + dz * dz);
                normals[i * 3 + 0] = -dx / len;
                normals[i * 3 + 1] = 1 / len;
                normals[i * 3 + 2] = -dz / len;

                const color = colorFn(value);
                colors[i * 4 + 0] = color[0];
                colors[i * 4 + 1] = color[1];
                colors[i * 4 + 2] = color[2];
                colors[i * 4 + 3] = color[3];

                uvs[i * 2 + 0] = tx;
                uvs[i * 2 + 1] = tz;
            }
        }

        // Two CCW-from-above triangles per grid cell
        const indices = new Uint32Array((gridW - 1) * (gridH - 1) * 6);
        let idx = 0;
        for (let gy = 0; gy < gridH - 1; gy++) {
            for (let gx = 0; gx < gridW - 1; gx++) {
                const a = gy * gridW + gx;
                const b = a + 1;
                const c = a + gridW;
                const d = c + 1;
                indices[idx++] = a;
                indices[idx++] = c;
                indices[idx++] = b;
                indices[idx++] = b;
                indices[idx++] = c;
                indices[idx++] = d;
            }
        }

        return {
            positions,
            normals,
            colors,
            uvs,
            indices,
            vertexCount,
            indexCount: indices.length
        };
    }

    /**
     * Calculate color based on field value
     * @param {number} value - Field value
     * @returns {number[]} RGBA color
     */
    calculateColor(value) {
        const { colorMode, colorScale, colorA, colorB, solidColor } = this.params;

        if (colorMode === 'solid') {
            return solidColor;
        }

        // Normalize value to 0-1 range
        const t = (value - colorScale[0]) / (colorScale[1] - colorScale[0]);
        const clamped = Math.max(0, Math.min(1, t));

        if (colorMode === 'gradient' || colorMode === 'field') {
            // Interpolate between colorA and colorB
            return [
                colorA[0] + (colorB[0] - colorA[0]) * clamped,
                colorA[1] + (colorB[1] - colorA[1]) * clamped,
                colorA[2] + (colorB[2] - colorA[2]) * clamped,
                colorA[3] + (colorB[3] - colorA[3]) * clamped
            ];
        }

        return [1, 1, 1, 1];
    }

    /**
     * Set UV mapping mode
     * @param {string} mode - UV mapping mode: 'planar-xz', 'planar-xy', 'spherical', 'cylindrical'
     */
    setUVMode(mode) {
        const validModes = ['planar-xz', 'planar-xy', 'planar-yz', 'spherical', 'cylindrical'];
        if (!validModes.includes(mode)) {

            return;
        }
        this.uvMode = mode;
    }

    /**
     * Generate UV coordinates for vertices based on their positions
     * @param {Float32Array} positions - Vertex positions (x, y, z)
     * @param {number} vertexCount - Number of vertices
     * @returns {Float32Array} UV coordinates (u, v)
     */
    generateUVs(positions, vertexCount) {
        const uvs = new Float32Array(vertexCount * 2);
        const bounds = this.params.fieldBounds;
        const boundsSize = [
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2]
        ];

        for (let i = 0; i < vertexCount; i++) {
            const x = positions[i * 3 + 0];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            let u = 0, v = 0;

            switch (this.uvMode) {
                case 'planar-xz':
                    // Project onto XZ plane
                    u = (x - bounds.min[0]) / boundsSize[0];
                    v = (z - bounds.min[2]) / boundsSize[2];
                    break;

                case 'planar-xy':
                    // Project onto XY plane
                    u = (x - bounds.min[0]) / boundsSize[0];
                    v = (y - bounds.min[1]) / boundsSize[1];
                    break;

                case 'planar-yz':
                    // Project onto YZ plane
                    u = (y - bounds.min[1]) / boundsSize[1];
                    v = (z - bounds.min[2]) / boundsSize[2];
                    break;

                case 'spherical':
                    // Spherical projection
                    // Calculate spherical coordinates from position
                    const dx = x - (bounds.min[0] + bounds.max[0]) / 2;
                    const dy = y - (bounds.min[1] + bounds.max[1]) / 2;
                    const dz = z - (bounds.min[2] + bounds.max[2]) / 2;
                    const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (radius > 0.0001) {
                        // U: azimuthal angle (0 to 1)
                        u = 0.5 + Math.atan2(dz, dx) / (2 * Math.PI);
                        // V: polar angle (0 to 1)
                        v = 0.5 - Math.asin(dy / radius) / Math.PI;
                    } else {
                        u = 0.5;
                        v = 0.5;
                    }
                    break;

                case 'cylindrical':
                    // Cylindrical projection around Y axis
                    const centerX = (bounds.min[0] + bounds.max[0]) / 2;
                    const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
                    const dcx = x - centerX;
                    const dcz = z - centerZ;

                    // U: angle around Y axis
                    u = 0.5 + Math.atan2(dcz, dcx) / (2 * Math.PI);
                    // V: height along Y axis
                    v = (y - bounds.min[1]) / boundsSize[1];
                    break;

                default:
                    // Default to planar XZ
                    u = (x - bounds.min[0]) / boundsSize[0];
                    v = (z - bounds.min[2]) / boundsSize[2];
            }

            uvs[i * 2 + 0] = u;
            uvs[i * 2 + 1] = v;
        }

        return uvs;
    }

    /**
     * Get generated geometry
     * @returns {Object} Geometry data
     */
    getGeometry() {
        return this.geometry;
    }

    /**
     * Destroy GPU resources
     */
    destroy() {
        Object.values(this.buffers).forEach(buffer => {
            if (buffer) buffer.destroy();
        });

        this.buffers = {
            fieldData: null,
            positions: null,
            colors: null,
            indices: null,
            params: null,
            counter: null
        };

        this.initialized = false;
    }
}
