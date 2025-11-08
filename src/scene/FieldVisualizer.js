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
            indices: null,
            vertexCount: 0,
            indexCount: 0
        };

        this.initialized = false;
    }

    /**
     * Initialize GPU resources
     */
    async initialize() {
        if (this.initialized) {
            console.warn('[FieldVisualizer] Already initialized');
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
        console.log('[FieldVisualizer] Initialized');
    }

    /**
     * Set visualization mode
     * @param {string} mode - 'points' or 'mesh'
     */
    setMode(mode) {
        if (mode !== 'points' && mode !== 'mesh') {
            console.warn(`[FieldVisualizer] Invalid mode: ${mode}`);
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

        this.geometry = {
            positions: geometry.positions,
            colors: geometry.colors,
            indices: null,
            normals: null,
            vertexCount: geometry.vertexCount,
            indexCount: 0
        };

        console.log(`[FieldVisualizer] Generated ${this.geometry.vertexCount} points`);

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

        this.geometry = {
            positions: mesh.positions,
            normals: mesh.normals,
            colors,
            indices: mesh.indices,
            vertexCount: mesh.vertexCount,
            indexCount: mesh.indices.length
        };

        console.log(`[FieldVisualizer] Generated mesh with ${this.geometry.vertexCount} vertices`);

        return this.geometry;
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
        console.log('[FieldVisualizer] Destroyed');
    }
}
