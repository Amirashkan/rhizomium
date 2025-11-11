/**
 * FieldVisualizerManager - Integration utility for real-time 3D field visualization
 *
 * This manager handles:
 * - Automatic parameter change detection
 * - Real-time visualization regeneration
 * - Render loop integration
 * - Event-driven updates
 */

import { ParameterEventSystem, ParameterEvents } from '../utils/ParameterEventSystem.js';

export class FieldVisualizerManager {
    /**
     * @param {GPUDevice} device - WebGPU device
     * @param {ParameterEventSystem} eventSystem - Parameter event system (optional, creates new if not provided)
     */
    constructor(device, eventSystem = null) {
        this.device = device;
        this.eventSystem = eventSystem || new ParameterEventSystem();

        /**
         * Registered field mapper nodes
         * @type {Map<string, ComputeFieldMapperNode>}
         */
        this.fieldMappers = new Map();

        /**
         * Compute shader nodes associated with field mappers
         * @type {Map<string, Object>}
         */
        this.computeNodes = new Map();

        /**
         * Pending update queue (node IDs that need regeneration)
         * @type {Set<string>}
         */
        this.pendingUpdates = new Set();

        /**
         * Auto-update flag
         * @type {boolean}
         */
        this.autoUpdate = true;

        /**
         * Frame counter
         * @type {number}
         */
        this.frameCount = 0;

        /**
         * Event listeners
         * @type {Function[]}
         */
        this._unsubscribers = [];

        // Setup event listeners
        this._setupEventListeners();
    }

    /**
     * Setup event listeners
     * @private
     */
    _setupEventListeners() {
        // Listen for node dirty events
        const unsubscribe = this.eventSystem.on(ParameterEvents.NODE_DIRTY, (data) => {
            const nodeId = data.nodeId;
            if (this.fieldMappers.has(nodeId)) {
                this.pendingUpdates.add(nodeId);
            }
        });
        this._unsubscribers.push(unsubscribe);
    }

    /**
     * Register a field mapper node for automatic updates
     * @param {string} id - Unique identifier for this field mapper
     * @param {ComputeFieldMapperNode} fieldMapper - Field mapper node
     * @param {Object} computeNode - Associated compute shader node (optional)
     */
    registerFieldMapper(id, fieldMapper, computeNode = null) {
        // Ensure the field mapper has the event system
        if (!fieldMapper.eventSystem) {
            fieldMapper.eventSystem = this.eventSystem;
            fieldMapper._setupEventListeners();
        }

        this.fieldMappers.set(id, fieldMapper);

        if (computeNode) {
            this.computeNodes.set(id, computeNode);
        }

        // Mark for initial update
        this.pendingUpdates.add(id);
    }

    /**
     * Unregister a field mapper node
     * @param {string} id - Field mapper identifier
     */
    unregisterFieldMapper(id) {
        const fieldMapper = this.fieldMappers.get(id);
        if (fieldMapper) {
            fieldMapper.dispose?.();
        }

        this.fieldMappers.delete(id);
        this.computeNodes.delete(id);
        this.pendingUpdates.delete(id);
    }

    /**
     * Update field mapper parameter via the event system
     * This will trigger automatic regeneration if auto-update is enabled
     *
     * @param {string} id - Field mapper identifier
     * @param {string} parameterName - Parameter name
     * @param {*} value - New value
     */
    updateParameter(id, parameterName, value) {
        this.eventSystem.emit(ParameterEvents.PARAMETER_CHANGED, {
            nodeId: id,
            parameterName: parameterName,
            newValue: value,
            timestamp: Date.now()
        });
    }

    /**
     * Update compute shader parameters and dispatch
     * @param {string} id - Field mapper identifier
     * @param {Object} uniforms - Uniform values to update
     * @param {GPUCommandEncoder} encoder - Command encoder (optional, creates new if not provided)
     * @param {number} time - Current time
     * @returns {GPUTexture|null} Output texture
     */
    updateComputeShader(id, uniforms, encoder = null, time = 0) {
        const computeNode = this.computeNodes.get(id);
        if (!computeNode) {
            return null;
        }

        // Update uniforms
        for (const [key, value] of Object.entries(uniforms)) {
            computeNode.setUniform(key, value);
        }

        // Create encoder if not provided
        const needsSubmit = !encoder;
        if (!encoder) {
            encoder = this.device.createCommandEncoder();
        }

        // Dispatch compute shader
        computeNode.dispatch(this.device, encoder, time);

        // Submit if we created the encoder
        if (needsSubmit) {
            this.device.queue.submit([encoder.finish()]);
        }

        return computeNode.getOutputTexture();
    }

    /**
     * Process pending updates and regenerate visualizations
     * Call this in your render loop
     *
     * @param {number} time - Current time
     * @returns {Promise<Map<string, Object>>} Map of updated geometries
     */
    async processPendingUpdates(time = 0) {
        if (!this.autoUpdate || this.pendingUpdates.size === 0) {
            return new Map();
        }

        const updatedGeometries = new Map();

        // Process each pending update
        for (const id of this.pendingUpdates) {
            const fieldMapper = this.fieldMappers.get(id);
            const computeNode = this.computeNodes.get(id);

            if (!fieldMapper) {
                continue;
            }

            // Check if we should update this frame based on update frequency
            if (!fieldMapper.shouldUpdate()) {
                continue;
            }

            // Get field texture
            let fieldTexture = null;
            if (computeNode) {
                // Compute shader is managed by us
                const encoder = this.device.createCommandEncoder();
                fieldTexture = this.updateComputeShader(id, {}, encoder, time);
                this.device.queue.submit([encoder.finish()]);
            } else if (fieldMapper.computeShader) {
                // External compute shader - just get the texture
                fieldTexture = fieldMapper.computeShader.getOutputTexture?.();
            }

            // Generate visualization
            if (fieldTexture) {
                try {
                    const geometry = await fieldMapper.generateVisualization(fieldTexture);
                    updatedGeometries.set(id, geometry);
                } catch (error) {

                }
            }
        }

        // Clear pending updates
        this.pendingUpdates.clear();

        this.frameCount++;

        return updatedGeometries;
    }

    /**
     * Force update of a specific field mapper
     * @param {string} id - Field mapper identifier
     * @param {number} time - Current time
     * @returns {Promise<Object|null>} Generated geometry
     */
    async forceUpdate(id, time = 0) {
        const fieldMapper = this.fieldMappers.get(id);
        if (!fieldMapper) {

            return null;
        }

        const computeNode = this.computeNodes.get(id);
        let fieldTexture = null;

        if (computeNode) {
            const encoder = this.device.createCommandEncoder();
            fieldTexture = this.updateComputeShader(id, {}, encoder, time);
            this.device.queue.submit([encoder.finish()]);
        } else if (fieldMapper.computeShader) {
            fieldTexture = fieldMapper.computeShader.getOutputTexture?.();
        }

        if (fieldTexture) {
            return await fieldMapper.generateVisualization(fieldTexture, true);
        }

        return null;
    }

    /**
     * Get all registered field mappers
     * @returns {Map<string, ComputeFieldMapperNode>}
     */
    getFieldMappers() {
        return this.fieldMappers;
    }

    /**
     * Get a specific field mapper
     * @param {string} id - Field mapper identifier
     * @returns {ComputeFieldMapperNode|null}
     */
    getFieldMapper(id) {
        return this.fieldMappers.get(id) || null;
    }

    /**
     * Enable or disable auto-update
     * @param {boolean} enabled
     */
    setAutoUpdate(enabled) {
        this.autoUpdate = enabled;
    }

    /**
     * Get event system (for external use)
     * @returns {ParameterEventSystem}
     */
    getEventSystem() {
        return this.eventSystem;
    }

    /**
     * Cleanup and dispose all resources
     */
    dispose() {
        // Unsubscribe from events
        this._unsubscribers.forEach(unsubscribe => unsubscribe());
        this._unsubscribers = [];

        // Dispose all field mappers
        for (const [id, fieldMapper] of this.fieldMappers) {
            fieldMapper.dispose?.();
        }

        this.fieldMappers.clear();
        this.computeNodes.clear();
        this.pendingUpdates.clear();
    }
}
