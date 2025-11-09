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
    }

    /**
     * Process ComputeFieldMapper nodes in the graph
     * @param {Array} nodes - All nodes in the graph
     * @param {Array} connections - All connections
     */
    async processFieldMappers(nodes, connections) {
        console.log('[FieldMapperIntegration] processFieldMappers called');
        console.log('[FieldMapperIntegration] nodes:', nodes ? nodes.length : 'null');
        console.log('[FieldMapperIntegration] connections:', connections ? connections.length : 'null');
        console.log('[FieldMapperIntegration] device:', !!this.device);
        console.log('[FieldMapperIntegration] scene:', !!this.scene);

        if (!nodes || !this.device || !this.scene) {
            console.log('[FieldMapperIntegration] Missing required components, aborting');
            return;
        }

        // Find all ComputeFieldMapper nodes
        const fieldMapperNodes = nodes.filter(n => n.kind === 'ComputeFieldMapper');

        console.log('[FieldMapperIntegration] Found', fieldMapperNodes.length, 'ComputeFieldMapper nodes');

        if (fieldMapperNodes.length === 0) {
            // No field mapper nodes - clean up any existing ones
            this.cleanup();
            return;
        }

        console.log(`[FieldMapperIntegration] Processing ${fieldMapperNodes.length} ComputeFieldMapper node(s)`);

        // Track which nodes are still active
        const activeNodeIds = new Set();

        for (const node of fieldMapperNodes) {
            activeNodeIds.add(node.id);
            console.log(`[FieldMapperIntegration] Processing node ${node.id}...`);

            try {
                await this.processFieldMapperNode(node, connections);
            } catch (error) {
                console.error(`[FieldMapperIntegration] Error processing node ${node.id}:`, error);
            }
        }

        // Remove field mappers that are no longer in the graph
        for (const [nodeId, fieldMapper] of this.fieldMappers.entries()) {
            if (!activeNodeIds.has(nodeId)) {
                this.removeFieldMapper(nodeId);
            }
        }

        // Render the 3D scene if there are active field mappers
        if (this.sceneRenderer3D && activeNodeIds.size > 0) {
            console.log('[FieldMapperIntegration] Rendering 3D scene...');
            this.sceneRenderer3D.render();
        }
    }

    /**
     * Process a single ComputeFieldMapper node
     * @param {Object} node - The node to process
     * @param {Array} connections - All connections (optional - will use node.inputs if not provided)
     */
    async processFieldMapperNode(node, connections) {
        const nodeId = node.id;

        // Find input - try connections array first, then fall back to node.inputs
        let sourceNodeId = null;

        if (connections && connections.length > 0) {
            // Try modern connection structure (toNode/fromNode)
            const inputConnection = connections.find(c => c.toNode === nodeId);
            if (inputConnection) {
                sourceNodeId = inputConnection.fromNode;
            }
        }

        // Fall back to node.inputs array (older connection model)
        if (!sourceNodeId && node.inputs && node.inputs[0]) {
            sourceNodeId = node.inputs[0];
        }

        if (!sourceNodeId) {
            console.warn(`[FieldMapperIntegration] Node ${nodeId} has no input connection`);
            return;
        }

        // Get the compute texture from the source node
        const computeTexture = this.getComputeTexture(sourceNodeId);

        if (!computeTexture) {
            console.warn(`[FieldMapperIntegration] No compute texture available from node ${sourceNodeId}`);
            return;
        }

        // Get or create field mapper instance
        let fieldMapper = this.fieldMappers.get(nodeId);

        if (!fieldMapper) {
            fieldMapper = this.createFieldMapper(node);
            this.fieldMappers.set(nodeId, fieldMapper);

            // Add to scene
            this.scene.addNode(fieldMapper);
            this.nodesInScene.add(nodeId);

            console.log(`[FieldMapperIntegration] Created field mapper for node ${nodeId}`);
        } else {
            // Update parameters if they changed
            this.updateFieldMapperParams(fieldMapper, node);
        }

        // Generate visualization from compute texture
        try {
            await fieldMapper.generateVisualization(computeTexture);

            const geometry = fieldMapper.getGeometry();
            if (geometry && geometry.vertexCount > 0) {
                console.log(`[FieldMapperIntegration] Generated ${geometry.vertexCount} vertices for node ${nodeId}`);
            }
        } catch (error) {
            console.error(`[FieldMapperIntegration] Failed to generate visualization for node ${nodeId}:`, error);
        }
    }

    /**
     * Create a new ComputeFieldMapperNode instance
     * @param {Object} node - Graph node
     * @returns {ComputeFieldMapperNode}
     */
    createFieldMapper(node) {
        const params = node.params || {};

        const fieldMapper = new ComputeFieldMapperNode(node.id, {
            dimensions: [
                params.width || 64,
                params.height || 64,
                params.depth || 64
            ],
            mappingMode: params.mappingMode || 'points',
            fieldBounds: {
                min: [
                    params.boundsMinX ?? -1.0,
                    params.boundsMinY ?? -1.0,
                    params.boundsMinZ ?? -1.0
                ],
                max: [
                    params.boundsMaxX ?? 1.0,
                    params.boundsMaxY ?? 1.0,
                    params.boundsMaxZ ?? 1.0
                ]
            },
            isoThreshold: params.isoThreshold ?? 0.5,
            updateFrequency: params.updateFrequency ?? 0
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

        // Update dimensions
        fieldMapper.dimensions = [
            params.width || 64,
            params.height || 64,
            params.depth || 64
        ];

        // Update field bounds
        fieldMapper.fieldBounds = {
            min: [
                params.boundsMinX ?? -1.0,
                params.boundsMinY ?? -1.0,
                params.boundsMinZ ?? -1.0
            ],
            max: [
                params.boundsMaxX ?? 1.0,
                params.boundsMaxY ?? 1.0,
                params.boundsMaxZ ?? 1.0
            ]
        };

        // Update mapping mode and thresholds
        fieldMapper.mappingMode = params.mappingMode || 'points';
        fieldMapper.isoThreshold = params.isoThreshold ?? 0.5;

        // Update visualization parameters
        fieldMapper.setVisualizationParam('threshold', params.threshold ?? 0.5);
        fieldMapper.setVisualizationParam('pointSize', params.pointSize ?? 0.02);
        fieldMapper.setVisualizationParam('sampleRate', params.sampleRate ?? 1);

        // Color parameters
        fieldMapper.setVisualizationParam('colorMode', params.colorMode || 'gradient');
        fieldMapper.setVisualizationParam('colorA', [
            params.colorAR ?? 0.2,
            params.colorAG ?? 0.4,
            params.colorAB ?? 1.0,
            params.colorAA ?? 1.0
        ]);
        fieldMapper.setVisualizationParam('colorB', [
            params.colorBR ?? 1.0,
            params.colorBG ?? 0.4,
            params.colorBB ?? 0.2,
            params.colorBA ?? 1.0
        ]);
        fieldMapper.setVisualizationParam('solidColor', [
            params.solidColorR ?? 1.0,
            params.solidColorG ?? 1.0,
            params.solidColorB ?? 1.0,
            params.solidColorA ?? 1.0
        ]);
        fieldMapper.setVisualizationParam('colorScale', [
            params.colorScaleMin ?? 0.0,
            params.colorScaleMax ?? 1.0
        ]);

        // Displacement parameters
        fieldMapper.setVisualizationParam('displacementScale', params.displacementScale ?? 0.0);
        fieldMapper.setVisualizationParam('displacementAxis', [
            params.displacementAxisX ?? 0.0,
            params.displacementAxisY ?? 1.0,
            params.displacementAxisZ ?? 0.0
        ]);
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

        // Try to get from compute executor
        const computeManager = this.computeExecutor.computeManagers.get(nodeId);
        if (computeManager) {
            // Check if it has getOutputTexture method
            if (typeof computeManager.getOutputTexture === 'function') {
                return computeManager.getOutputTexture();
            }
            // Or outputTexture property
            if (computeManager.outputTexture) {
                return computeManager.outputTexture;
            }
        }

        return null;
    }

    /**
     * Remove a field mapper from the scene
     * @param {string} nodeId
     */
    removeFieldMapper(nodeId) {
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
            console.log(`[FieldMapperIntegration] Removed field mapper ${nodeId}`);
        }
    }

    /**
     * Clean up all field mappers
     */
    cleanup() {
        for (const nodeId of this.fieldMappers.keys()) {
            this.removeFieldMapper(nodeId);
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
