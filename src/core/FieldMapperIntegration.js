/**
 * FieldMapperIntegration
 *
 * Handles integration of ComputeFieldMapper nodes with the graph execution pipeline.
 * ComputeFieldMapper nodes generate 3D geometry from compute shader outputs.
 */

import { ComputeFieldMapperNode } from '../scene/nodes/ComputeFieldMapperNode.js';

export class FieldMapperIntegration {
    constructor(device, scene, computeExecutor, sceneRenderer3D, viewportPanel) {
        this.device = device;
        this.scene = scene;
        this.computeExecutor = computeExecutor;
        this.sceneRenderer3D = sceneRenderer3D;
        this.viewportPanel = viewportPanel;

        /**
         * Map of node ID -> ComputeFieldMapperNode instance
         * @type {Map<string, ComputeFieldMapperNode>}
         */
        this.fieldMappers = new Map();

        /**
         * Track which nodes are in the scene
         * @type {Set<string>}
         */
        this.nodesInScene = new Set();

        /**
         * Latest known graph nodes, kept for per-frame updates
         * @type {Array}
         */
        this._graphNodes = [];

        /**
         * Guard so overlapping async GPU readbacks don't pile up
         * @type {boolean}
         */
        this._updating = false;
    }

    /**
     * Process ComputeFieldMapper nodes in the graph
     * @param {Array} nodes - All nodes in the graph
     * @param {Array} connections - All connections
     */
    async processFieldMappers(nodes, connections) {

        if (!nodes || !this.device || !this.scene) {
            return;
        }

        this._graphNodes = nodes;

        // Find all ComputeFieldMapper nodes
        const fieldMapperNodes = nodes.filter(n => n.kind === 'ComputeFieldMapper');


        if (fieldMapperNodes.length === 0) {
            // No field mapper nodes - clean up any existing ones
            this.cleanup();
            return;
        }


        // Track which nodes are still active
        const activeNodeIds = new Set();

        for (const node of fieldMapperNodes) {
            activeNodeIds.add(node.id);

            try {
                await this.processFieldMapperNode(node, connections);
            } catch {
                // Non-fatal: a single bad mapper shouldn't stop the others
            }
        }

        // Remove field mappers that are no longer in the graph
        for (const nodeId of this.fieldMappers.keys()) {
            if (!activeNodeIds.has(nodeId)) {
                this.removeFieldMapper(nodeId);
            }
        }

        // Let the executor know it must run its fragment auto-bridge even when
        // no compute nodes are registered (pure fragment graph -> mapper)
        if (this.computeExecutor) {
            this.computeExecutor.fieldMapperBridgeActive = this.fieldMappers.size > 0;
        }

        // Render the 3D scene if there are active field mappers, and publish
        // the frame immediately so shader bind groups built right after this
        // graph update already find the mapper's output texture
        if (this.sceneRenderer3D && activeNodeIds.size > 0) {
            this.sceneRenderer3D.render();
            this.publishOutputs(this.sceneRenderer3D.getSceneTexture?.());
        }
    }

    /**
     * Process a single ComputeFieldMapper node
     * @param {Object} node - The node to process
     * @param {Array} connections - All connections (optional - will use node.inputs if not provided)
     */
    async processFieldMapperNode(node, connections) {
        const nodeId = node.id;

        const sourceNodeId = this.findSourceNodeId(node, connections);

        // Get or create field mapper instance. Shapes render even before an
        // input is connected (bare lit shape), so creation doesn't wait for a
        // texture.
        let fieldMapper = this.fieldMappers.get(nodeId);

        if (!fieldMapper) {
            fieldMapper = this.createFieldMapper(node);
            this.fieldMappers.set(nodeId, fieldMapper);

            // Add to scene
            this.scene.addNode(fieldMapper);
            this.nodesInScene.add(nodeId);

            // A 3D node just became active - surface the viewport so the
            // result is actually visible without hunting for the shortcut
            this.showViewport();

        } else {
            // Update parameters if they changed
            this.updateFieldMapperParams(fieldMapper, node);
        }

        // The renderer pulls the live compute texture by source id each frame
        fieldMapper.sourceNodeId = sourceNodeId;

        // Only the points shape needs CPU-side geometry generation; the other
        // shapes sample the compute texture directly on the GPU
        if (fieldMapper.shapeParams?.shape !== 'points') {
            return;
        }

        const computeTexture = (sourceNodeId !== null && sourceNodeId !== undefined)
            ? this.getComputeTexture(sourceNodeId)
            : null;
        if (!computeTexture) {
            return;
        }

        try {
            await fieldMapper.generateVisualization(computeTexture);
        } catch {
            // Non-fatal: the per-frame update will retry with fresh data
        }
    }

    /**
     * Resolve the shape for a graph node, mapping legacy saves that used
     * mappingMode (points/surface/volume) onto the new shape parameter.
     * @param {Object} params - Graph node params
     * @returns {string}
     */
    resolveShape(params = {}) {
        if (params.shape) {
            return params.shape;
        }
        if (params.mappingMode === 'points') {
            return 'points';
        }
        return 'plane';
    }

    /**
     * Create a new ComputeFieldMapperNode instance
     * @param {Object} node - Graph node
     * @returns {ComputeFieldMapperNode}
     */
    createFieldMapper(node) {
        const fieldMapper = new ComputeFieldMapperNode(node.id, {
            fieldBounds: { min: [-1, -1, -1], max: [1, 1, 1] }
        });

        // Initialize visualizer
        fieldMapper.initializeVisualizer(this.device);

        // Set visualization parameters
        this.updateFieldMapperParams(fieldMapper, node);

        return fieldMapper;
    }

    /**
     * Update field mapper parameters from node
     * @param {ComputeFieldMapperNode} fieldMapper
     * @param {Object} node - Graph node
     */
    updateFieldMapperParams(fieldMapper, node) {
        const params = node.params || {};
        const shape = this.resolveShape(params);
        const scale = params.scale ?? 1.5;

        // GPU shape path parameters, consumed by SceneRenderer3D each frame
        fieldMapper.shapeParams = {
            shape,
            resolution: params.resolution ?? 96,
            displacementScale: params.displacementScale ?? 0.4,
            textureAmount: params.textureAmount ?? 1.0
        };
        fieldMapper.transform.setScale(scale, scale, scale);

        // Points path (CPU-sampled cloud). Size comes from the transform
        // scale, so the field itself always maps into the unit box.
        const grid = params.gridSize ?? params.width ?? 64;
        fieldMapper.dimensions = [grid, grid, 1];
        fieldMapper.fieldBounds = { min: [-1, -1, -1], max: [1, 1, 1] };
        fieldMapper.mappingMode = shape === 'points' ? 'points' : 'surface';
        fieldMapper.updateFrequency = params.updateFrequency ?? 0;

        fieldMapper.setVisualizationParam('threshold', params.threshold ?? 0.35);
        fieldMapper.setVisualizationParam('pointSize', params.pointSize ?? 0.035);
        fieldMapper.setVisualizationParam('sampleRate', params.sampleRate ?? 1);
        fieldMapper.setVisualizationParam('colorMode', params.colorMode === 'solid' ? 'solid' : 'gradient');

        const colorA = [params.colorAR ?? 0.2, params.colorAG ?? 0.4, params.colorAB ?? 1.0, 1.0];
        const colorB = [params.colorBR ?? 1.0, params.colorBG ?? 0.4, params.colorBB ?? 0.2, 1.0];
        fieldMapper.setVisualizationParam('colorA', colorA);
        fieldMapper.setVisualizationParam('colorB', colorB);
        // Solid mode reuses the gradient-start color as the flat color
        fieldMapper.setVisualizationParam('solidColor', colorA);
        fieldMapper.setVisualizationParam('colorScale', [0.0, 1.0]);

        // Points displace upward with the field value, using the same scale
        // as the GPU shapes
        fieldMapper.setVisualizationParam('displacementScale', params.displacementScale ?? 0.4);
        fieldMapper.setVisualizationParam('displacementAxis', [0, 1, 0]);
    }

    /**
     * Resolve the graph node feeding this field mapper's input pin.
     * node.inputs holds source node ids; the connections array holds node
     * OBJECTS in fromNode/toNode, so compare against their ids.
     * @param {Object} node - Field mapper graph node
     * @param {Array} connections - Graph connections (optional)
     * @returns {string|number|null} Source node id
     */
    findSourceNodeId(node, connections) {
        if (node.inputs && node.inputs[0] !== null && node.inputs[0] !== undefined) {
            return node.inputs[0];
        }

        if (Array.isArray(connections)) {
            const inputConnection = connections.find(c => {
                const toId = c?.toNode?.id ?? c?.toNode;
                return toId === node.id;
            });
            if (inputConnection) {
                return inputConnection.fromNode?.id ?? inputConnection.fromNode;
            }
        }

        return null;
    }

    /**
     * Get compute texture from a node
     * @param {string} nodeId
     * @returns {GPUTexture|null}
     */
    getComputeTexture(nodeId) {
        if (!this.computeExecutor) {
            return null;
        }

        // Dispatched outputs are keyed by raw graph id; skip the executor's
        // 1x1 fallback texture - reading it back would just produce black
        if (typeof this.computeExecutor.getNodeOutput === 'function') {
            const output = this.computeExecutor.getNodeOutput(nodeId);
            if (output && output !== this.computeExecutor.fallbackTexture) {
                return output;
            }
        }

        // Fall back to the manager's live output texture. Managers are keyed
        // by a sanitized registry id, so try both spellings.
        const sanitizedId = String(nodeId).replace(/[^a-zA-Z0-9_]/g, '_');
        const computeManager = this.computeExecutor.computeManagers?.get(nodeId)
            || this.computeExecutor.computeManagers?.get(sanitizedId);
        if (computeManager) {
            if (typeof computeManager.getOutputTexture === 'function') {
                return computeManager.getOutputTexture();
            }
            if (computeManager.outputTexture) {
                return computeManager.outputTexture;
            }
        }

        return null;
    }

    /**
     * Per-frame update: regenerate visualizations from the live compute
     * textures so animated fields stay in motion in the 3D viewport.
     * Safe to call every frame - overlapping GPU readbacks are skipped, and
     * each mapper honors its updateFrequency (0 = every opportunity).
     */
    async updateFrame() {
        if (this.fieldMappers.size === 0) {
            return;
        }

        // Re-sync parameters from the graph nodes every frame so edits apply
        // in REAL TIME - parameter drags update node.params without a full
        // graph rebuild, and this is the only place that reads them per frame.
        // (A handful of property writes; negligible per-frame cost.)
        for (const [nodeId, fieldMapper] of this.fieldMappers.entries()) {
            const graphNode = this._graphNodes.find(n => n && n.id === nodeId);
            if (graphNode) {
                this.updateFieldMapperParams(fieldMapper, graphNode);
            }
        }

        if (this._updating) {
            return;
        }

        this._updating = true;
        try {
            for (const [nodeId, fieldMapper] of this.fieldMappers.entries()) {
                // GPU shapes sample the live compute texture directly in the
                // render pass - no per-frame CPU work needed
                if (fieldMapper.shapeParams?.shape !== 'points') {
                    continue;
                }

                if (!fieldMapper.shouldUpdate()) {
                    continue;
                }

                const graphNode = this._graphNodes.find(n => n && n.id === nodeId);
                const sourceNodeId = graphNode ? this.findSourceNodeId(graphNode, null) : null;
                if (sourceNodeId === null || sourceNodeId === undefined) {
                    continue;
                }

                const computeTexture = this.getComputeTexture(sourceNodeId);
                if (!computeTexture) {
                    continue;
                }

                try {
                    await fieldMapper.generateVisualization(computeTexture, true);
                } catch {
                    // Skip this frame's update; the next one will retry
                }
            }
        } finally {
            this._updating = false;
        }
    }

    /**
     * Remove a field mapper from the scene
     * @param {string} nodeId
     */
    removeFieldMapper(nodeId) {
        // Drop the published output so downstream bindings don't keep sampling
        // a deleted node's view (the scene texture itself is owned by
        // SceneRenderer3D and must not be destroyed here)
        if (this.computeExecutor) {
            this.computeExecutor.nodeOutputs?.delete(nodeId);
            this.computeExecutor.computeTextures?.delete(nodeId);
        }

        const fieldMapper = this.fieldMappers.get(nodeId);
        if (fieldMapper) {
            // Remove from scene
            if (this.nodesInScene.has(nodeId)) {
                this.scene.removeNode(fieldMapper);
                this.nodesInScene.delete(nodeId);
            }

            // Cleanup
            if (typeof fieldMapper.dispose === 'function') {
                fieldMapper.dispose();
            }

            this.fieldMappers.delete(nodeId);
        }
    }

    /**
     * Clean up all field mappers
     */
    cleanup() {
        for (const nodeId of this.fieldMappers.keys()) {
            this.removeFieldMapper(nodeId);
        }
        if (this.computeExecutor) {
            this.computeExecutor.fieldMapperBridgeActive = false;
        }
    }

    /**
     * Publish the rendered 3D view as each mapper node's graph output. With
     * an entry in computeTextures/nodeOutputs, the whole downstream pipeline
     * lights up for free: the node's own GPU thumbnail, downstream node
     * previews, and fragment chains that sample compute_node_<id> (including
     * OutputFinal).
     * @param {GPUTexture} sceneTexture - SceneRenderer3D's offscreen frame
     */
    publishOutputs(sceneTexture) {
        if (!sceneTexture || !this.computeExecutor || this.fieldMappers.size === 0) {
            return;
        }

        if (!this._outputSampler && this.device) {
            this._outputSampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear'
            });
        }

        for (const nodeId of this.fieldMappers.keys()) {
            this.computeExecutor.nodeOutputs.set(nodeId, sceneTexture);
            const existing = this.computeExecutor.computeTextures.get(nodeId);
            if (existing) {
                existing.texture = sceneTexture;
            } else {
                this.computeExecutor.computeTextures.set(nodeId, {
                    texture: sceneTexture,
                    sampler: this._outputSampler
                });
            }
        }
    }

    /**
     * Show the 3D viewport
     */
    showViewport() {
        if (this.viewportPanel && typeof this.viewportPanel.show === 'function') {
            this.viewportPanel.show();
        }
    }

    /**
     * Hide the 3D viewport
     */
    hideViewport() {
        if (this.viewportPanel && typeof this.viewportPanel.hide === 'function') {
            this.viewportPanel.hide();
        }
    }
}
