import { Node } from './Node.js';
import { FieldVisualizer } from '../FieldVisualizer.js';
import { ParameterEvents } from '../../utils/ParameterEventSystem.js';

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
     * @param {ParameterEventSystem} options.eventSystem - Event system for parameter changes
     */
    constructor(name = '', options = {}) {
        super(name);

        /**
         * Parameter event system
         * @type {ParameterEventSystem|null}
         */
        this.eventSystem = options.eventSystem || null;

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

        /**
         * Field visualizer instance
         * @type {FieldVisualizer|null}
         */
        this.visualizer = null;

        /**
         * Visualization parameters
         * @type {Object}
         */
        this.visualizationParams = {
            // Threshold for point cloud
            threshold: 0.5,

            // Point size
            pointSize: 0.02,

            // Color parameters
            colorMode: 'gradient', // 'solid', 'gradient', 'field'
            colorScale: [0.0, 1.0],
            colorA: [0.2, 0.4, 1.0, 1.0],
            colorB: [1.0, 0.4, 0.2, 1.0],
            solidColor: [1.0, 1.0, 1.0, 1.0],

            // Displacement
            displacementScale: 0.0,
            displacementAxis: [0, 1, 0],

            // Sampling
            sampleRate: 1
        };

        /**
         * Generated geometry (cached)
         * @type {Object|null}
         */
        this.geometry = null;

        /**
         * Flag indicating if visualization needs regeneration
         * @type {boolean}
         */
        this.needsUpdate = true;

        /**
         * Event listener unsubscribe functions
         * @type {Function[]}
         */
        this._unsubscribers = [];

        // Subscribe to parameter changes if event system is provided
        if (this.eventSystem) {
            this._setupEventListeners();
        }
    }

    /**
     * Setup event listeners for parameter changes
     * @private
     */
    _setupEventListeners() {
        // Listen for parameter changes on this node
        const unsubscribe = this.eventSystem.on(ParameterEvents.PARAMETER_CHANGED, (data) => {
            if (data.nodeId === this.id || data.nodeId === this.name) {
                this._handleParameterChange(data.parameterName, data.newValue);
            }
        });
        this._unsubscribers.push(unsubscribe);
    }

    /**
     * Handle parameter change from UI
     * @param {string} paramName - Parameter name from UI
     * @param {*} value - New parameter value
     * @private
     */
    _handleParameterChange(paramName, value) {
        // Map UI parameters to internal structure
        switch (paramName) {
            case 'width':
                this.setDimensions(value, this.dimensions[1], this.dimensions[2]);
                break;
            case 'height':
                this.setDimensions(this.dimensions[0], value, this.dimensions[2]);
                break;
            case 'depth':
                this.setDimensions(this.dimensions[0], this.dimensions[1], value);
                break;

            case 'mappingMode':
                this.setMappingMode(value);
                break;
            case 'updateFrequency':
                this.updateFrequency = value;
                break;

            case 'boundsMinX':
                this.fieldBounds.min[0] = value;
                this.markNeedsUpdate();
                break;
            case 'boundsMinY':
                this.fieldBounds.min[1] = value;
                this.markNeedsUpdate();
                break;
            case 'boundsMinZ':
                this.fieldBounds.min[2] = value;
                this.markNeedsUpdate();
                break;
            case 'boundsMaxX':
                this.fieldBounds.max[0] = value;
                this.markNeedsUpdate();
                break;
            case 'boundsMaxY':
                this.fieldBounds.max[1] = value;
                this.markNeedsUpdate();
                break;
            case 'boundsMaxZ':
                this.fieldBounds.max[2] = value;
                this.markNeedsUpdate();
                break;

            case 'threshold':
                this.visualizationParams.threshold = value;
                this.markNeedsUpdate();
                break;
            case 'isoThreshold':
                this.isoThreshold = value;
                this.markNeedsUpdate();
                break;
            case 'pointSize':
                this.visualizationParams.pointSize = value;
                this.markNeedsUpdate();
                break;
            case 'sampleRate':
                this.visualizationParams.sampleRate = value;
                this.markNeedsUpdate();
                break;

            case 'colorMode':
                this.visualizationParams.colorMode = value;
                this.markNeedsUpdate();
                break;
            case 'colorAR':
                this.visualizationParams.colorA[0] = value;
                this.markNeedsUpdate();
                break;
            case 'colorAG':
                this.visualizationParams.colorA[1] = value;
                this.markNeedsUpdate();
                break;
            case 'colorAB':
                this.visualizationParams.colorA[2] = value;
                this.markNeedsUpdate();
                break;
            case 'colorAA':
                this.visualizationParams.colorA[3] = value;
                this.markNeedsUpdate();
                break;
            case 'colorBR':
                this.visualizationParams.colorB[0] = value;
                this.markNeedsUpdate();
                break;
            case 'colorBG':
                this.visualizationParams.colorB[1] = value;
                this.markNeedsUpdate();
                break;
            case 'colorBB':
                this.visualizationParams.colorB[2] = value;
                this.markNeedsUpdate();
                break;
            case 'colorBA':
                this.visualizationParams.colorB[3] = value;
                this.markNeedsUpdate();
                break;
            case 'solidColorR':
                this.visualizationParams.solidColor[0] = value;
                this.markNeedsUpdate();
                break;
            case 'solidColorG':
                this.visualizationParams.solidColor[1] = value;
                this.markNeedsUpdate();
                break;
            case 'solidColorB':
                this.visualizationParams.solidColor[2] = value;
                this.markNeedsUpdate();
                break;
            case 'solidColorA':
                this.visualizationParams.solidColor[3] = value;
                this.markNeedsUpdate();
                break;
            case 'colorScaleMin':
                this.visualizationParams.colorScale[0] = value;
                this.markNeedsUpdate();
                break;
            case 'colorScaleMax':
                this.visualizationParams.colorScale[1] = value;
                this.markNeedsUpdate();
                break;

            case 'displacementScale':
                this.visualizationParams.displacementScale = value;
                this.markNeedsUpdate();
                break;
            case 'displacementAxisX':
                this.visualizationParams.displacementAxis[0] = value;
                this.markNeedsUpdate();
                break;
            case 'displacementAxisY':
                this.visualizationParams.displacementAxis[1] = value;
                this.markNeedsUpdate();
                break;
            case 'displacementAxisZ':
                this.visualizationParams.displacementAxis[2] = value;
                this.markNeedsUpdate();
                break;

        }
    }

    /**
     * Mark this node as needing visualization update
     */
    markNeedsUpdate() {
        this.needsUpdate = true;

        // Emit node dirty event
        if (this.eventSystem) {
            this.eventSystem.emit(ParameterEvents.NODE_DIRTY, {
                nodeId: this.id || this.name,
                nodeName: this.name
            });
        }
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
        this.markNeedsUpdate();
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
        this.markNeedsUpdate();
        return this;
    }

    /**
     * Set mapping mode
     * @param {string} mode - 'volume', 'surface', or 'points'
     * @returns {ComputeFieldMapperNode} this
     */
    setMappingMode(mode) {
        this.mappingMode = mode;
        this.markNeedsUpdate();
        return this;
    }

    /**
     * Set isosurface threshold
     * @param {number} threshold
     * @returns {ComputeFieldMapperNode} this
     */
    setIsoThreshold(threshold) {
        this.isoThreshold = threshold;
        this.markNeedsUpdate();
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
     * Initialize field visualizer
     * @param {GPUDevice} device - WebGPU device
     */
    async initializeVisualizer(device) {
        if (this.visualizer) {
            return;
        }

        // Store device for later use (needed for texture readback)
        this.device = device;

        this.visualizer = new FieldVisualizer(device);
        await this.visualizer.initialize();

        // Set initial parameters
        this.visualizer.setDimensions(this.dimensions);
        this.visualizer.setFieldBounds(this.fieldBounds.min, this.fieldBounds.max);
        this.visualizer.setMode(this.mappingMode === 'points' ? 'points' : 'mesh');
        this.visualizer.setThreshold(this.visualizationParams.threshold);
        this.visualizer.setIsoValue(this.isoThreshold);
        this.visualizer.setPointSize(this.visualizationParams.pointSize);
        this.visualizer.setColorParams(this.visualizationParams);
        this.visualizer.setDisplacement(
            this.visualizationParams.displacementScale,
            this.visualizationParams.displacementAxis
        );
    }

    /**
     * Generate visualization from compute shader output
     * @param {GPUTexture} fieldTexture - Output texture from compute shader
     * @param {boolean} forceUpdate - Force regeneration even if not marked dirty
     * @returns {Promise<Object>} Generated geometry
     */
    async generateVisualization(fieldTexture, forceUpdate = false) {
        if (!this.visualizer) {
            return null;
        }

        // Only regenerate if needed (unless forced)
        if (!this.needsUpdate && !forceUpdate && this.geometry) {
            return this.geometry;
        }

        // Update visualizer parameters
        this.visualizer.setDimensions(this.dimensions);
        this.visualizer.setFieldBounds(this.fieldBounds.min, this.fieldBounds.max);
        this.visualizer.setThreshold(this.visualizationParams.threshold);
        this.visualizer.setIsoValue(this.isoThreshold);
        this.visualizer.setColorParams(this.visualizationParams);

        // Generate geometry based on mapping mode
        if (this.mappingMode === 'points') {
            this.geometry = await this.visualizer.generatePointCloud(fieldTexture);
        } else if (this.mappingMode === 'surface' || this.mappingMode === 'volume') {
            // For mesh mode, we need 3D field data
            // Check if the texture is 3D
            if (fieldTexture.dimension === '3d') {
                // Generate mesh from 3D texture using marching cubes
                // We need the device to read texture data
                if (!this.device) {

                    this.geometry = null;
                } else {
                    this.geometry = await this.visualizer.generateMeshFromTexture3D(fieldTexture, this.device);
                }
            } else {
                // 2D texture - generate mesh from heightmap-style data
                // Read 2D texture and use marching cubes on extruded data
                this.geometry = await this.visualizer.generatePointCloud(fieldTexture);
            }
        }

        // Mark as clean
        this.needsUpdate = false;

        // Emit node clean event
        if (this.eventSystem) {
            this.eventSystem.emit(ParameterEvents.NODE_CLEAN, {
                nodeId: this.id || this.name,
                nodeName: this.name
            });
        }

        return this.geometry;
    }

    /**
     * Set visualization parameter
     * @param {string} name - Parameter name
     * @param {*} value - Parameter value
     */
    setVisualizationParam(name, value) {
        this.visualizationParams[name] = value;
        this.markNeedsUpdate();
    }

    /**
     * Get generated geometry
     * @returns {Object|null} Geometry data
     */
    getGeometry() {
        return this.geometry;
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
        json.visualizationParams = this.visualizationParams;
        return json;
    }

    /**
     * Cleanup and unsubscribe from events
     */
    dispose() {
        // Unsubscribe from all events
        this._unsubscribers.forEach(unsubscribe => unsubscribe());
        this._unsubscribers = [];

        // Dispose visualizer if it exists
        if (this.visualizer && this.visualizer.dispose) {
            this.visualizer.dispose();
        }

        super.dispose?.();
    }
}
