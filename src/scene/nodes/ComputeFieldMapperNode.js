import { Node } from './Node.js';

/**
 * ComputeFieldMapper node for mapping compute shader outputs to 3D space
 * This node represents a 3D field that can be computed via GPU compute shaders
 */
export class ComputeFieldMapperNode extends Node {
    /**
     * @param {string} name
     * @param {Object} options
     * @param {number[]} options.dimensions - [width, height, depth] of the compute field
     * @param {Object} options.computeShader - reference to compute shader
     * @param {string} options.mappingMode - how to map the field ('volume', 'surface', 'points')
     */
    constructor(name = '', options = {}) {
        super(name);

        /**
         * Dimensions of the compute field [width, height, depth]
         * @type {number[]}
         */
        this.dimensions = options.dimensions || [64, 64, 64];

        /**
         * Reference to compute shader or shader graph
         * This can be connected to the existing compute pipeline
         * @type {Object|null}
         */
        this.computeShader = options.computeShader || null;

        /**
         * Mapping mode: how to interpret the compute field
         * - 'volume': 3D volumetric data
         * - 'surface': 2D surface mapped in 3D space
         * - 'points': Point cloud from field values
         * @type {string}
         */
        this.mappingMode = options.mappingMode || 'volume';

        /**
         * Field bounds in world space
         * @type {Object}
         */
        this.fieldBounds = options.fieldBounds || {
            min: [-1, -1, -1],
            max: [1, 1, 1]
        };

        /**
         * Threshold for isosurface extraction (if mappingMode is 'surface')
         * @type {number}
         */
        this.isoThreshold = options.isoThreshold !== undefined ? options.isoThreshold : 0.5;

        /**
         * GPU buffer references for compute output
         * @type {Object}
         */
        this.buffers = {
            data: null,        // Main compute data buffer
            positions: null,   // Vertex positions (if generating geometry)
            normals: null,     // Vertex normals (if generating geometry)
            colors: null       // Vertex colors (if applicable)
        };

        /**
         * Compute dispatch parameters
         * @type {Object}
         */
        this.dispatchSize = options.dispatchSize || {
            x: Math.ceil(this.dimensions[0] / 8),
            y: Math.ceil(this.dimensions[1] / 8),
            z: Math.ceil(this.dimensions[2] / 8)
        };

        /**
         * Update frequency (frames per update, 0 = every frame)
         * @type {number}
         */
        this.updateFrequency = options.updateFrequency !== undefined ? options.updateFrequency : 0;

        /**
         * Frame counter for update frequency
         * @type {number}
         */
        this._frameCounter = 0;
    }

    /**
     * Get node type
     * @returns {string}
     */
    getType() {
        return 'ComputeFieldMapperNode';
    }

    /**
     * Set compute shader reference
     * @param {Object} shader
     * @returns {ComputeFieldMapperNode} this
     */
    setComputeShader(shader) {
        this.computeShader = shader;
        return this;
    }

    /**
     * Set field dimensions
     * @param {number} width
     * @param {number} height
     * @param {number} depth
     * @returns {ComputeFieldMapperNode} this
     */
    setDimensions(width, height, depth) {
        this.dimensions = [width, height, depth];
        this.dispatchSize = {
            x: Math.ceil(width / 8),
            y: Math.ceil(height / 8),
            z: Math.ceil(depth / 8)
        };
        return this;
    }

    /**
     * Set field bounds in world space
     * @param {number[]} min - [x, y, z]
     * @param {number[]} max - [x, y, z]
     * @returns {ComputeFieldMapperNode} this
     */
    setFieldBounds(min, max) {
        this.fieldBounds = { min, max };
        return this;
    }

    /**
     * Set mapping mode
     * @param {string} mode - 'volume', 'surface', or 'points'
     * @returns {ComputeFieldMapperNode} this
     */
    setMappingMode(mode) {
        this.mappingMode = mode;
        return this;
    }

    /**
     * Set isosurface threshold
     * @param {number} threshold
     * @returns {ComputeFieldMapperNode} this
     */
    setIsoThreshold(threshold) {
        this.isoThreshold = threshold;
        return this;
    }

    /**
     * Check if compute should update this frame
     * @returns {boolean}
     */
    shouldUpdate() {
        if (this.updateFrequency === 0) {
            return true;
        }

        this._frameCounter++;
        if (this._frameCounter >= this.updateFrequency) {
            this._frameCounter = 0;
            return true;
        }

        return false;
    }

    /**
     * Map field coordinates to world space
     * @param {number} i - x index in field
     * @param {number} j - y index in field
     * @param {number} k - z index in field
     * @returns {number[]} world position [x, y, z]
     */
    fieldToWorld(i, j, k) {
        const [width, height, depth] = this.dimensions;
        const { min, max } = this.fieldBounds;

        const x = min[0] + (i / width) * (max[0] - min[0]);
        const y = min[1] + (j / height) * (max[1] - min[1]);
        const z = min[2] + (k / depth) * (max[2] - min[2]);

        return [x, y, z];
    }

    /**
     * Clone this compute field mapper node
     * @returns {ComputeFieldMapperNode}
     */
    clone() {
        const cloned = new ComputeFieldMapperNode(this.name, {
            dimensions: [...this.dimensions],
            computeShader: this.computeShader,
            mappingMode: this.mappingMode,
            fieldBounds: {
                min: [...this.fieldBounds.min],
                max: [...this.fieldBounds.max]
            },
            isoThreshold: this.isoThreshold,
            dispatchSize: { ...this.dispatchSize },
            updateFrequency: this.updateFrequency
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
        json.dimensions = this.dimensions;
        json.mappingMode = this.mappingMode;
        json.fieldBounds = this.fieldBounds;
        json.isoThreshold = this.isoThreshold;
        json.dispatchSize = this.dispatchSize;
        json.updateFrequency = this.updateFrequency;
        return json;
    }
}
