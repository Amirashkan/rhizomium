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

        // The renderer pulls the live compute texture by source id each frame;
        // both render modes (surface and instances) are fully GPU-driven, so
        // no CPU-side geometry generation happens here
        fieldMapper.sourceNodeId = sourceNodeId;
    }

    /**
     * Resolve the render setup for a graph node, mapping legacy saves onto
     * the current parameters:
     * - shape 'points' (previous version) and mappingMode 'points' (original
     *   version) become instanced quads sized from the old point params
     * - mappingMode 'surface'/'volume' become the plane surface
     * @param {Object} params - Graph node params
     * @returns {{mode: string, shape: string, instanceShape: string}}
     */
    resolveRenderSetup(params = {}) {
        const legacyPoints = params.shape === 'points' || (!params.shape && params.mappingMode === 'points');
        const mode = params.mode === 'instances' || (!params.mode && legacyPoints)
            ? 'instances'
            : 'surface';
        const shape = (params.shape && params.shape !== 'points') ? params.shape : 'plane';
        const instanceShape = params.instanceShape || (legacyPoints ? 'quad' : 'cube');
        return { mode, shape, instanceShape };
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
    /**
     * Resolve a numeric parameter to a finite number: timeline overrides and
     * `=expression` strings are evaluated through the editor's expression
     * system (with the sim clock, so time/audio expressions animate). A raw
     * expression string fed into a GPU uniform would become NaN and blank
     * the whole render.
     * @param {Object} node - Graph node (expression context)
     * @param {Object} params - node.params
     * @param {string} name - Parameter name
     * @param {number} fallback - Value when missing/unresolvable
     * @returns {number}
     */
    resolveNumericParam(node, params, name, fallback) {
        let value = params[name];

        const expressionSystem = typeof window !== 'undefined' ? window.expressionSystem : null;
        if (expressionSystem) {
            try {
                if (typeof expressionSystem.getEffectiveParameterValue === 'function') {
                    value = expressionSystem.getEffectiveParameterValue(node.id, name, value);
                }
                if (expressionSystem.isExpression(value)) {
                    this._freshenReferencedValues(value);
                    const time = (typeof window !== 'undefined' && typeof window.renderLoop?._simTime === 'number')
                        ? window.renderLoop._simTime
                        : performance.now() / 1000;
                    // Evaluate UNCACHED: evaluateExpression caches results for
                    // expressions whose text isn't time-dependent, which would
                    // pin node references to a stale value no matter how fresh
                    // the underlying data is
                    const clean = String(value).trim().slice(1).trim();
                    if (clean && typeof expressionSystem.buildEvaluationContext === 'function'
                        && typeof expressionSystem.safeEvaluate === 'function') {
                        const evalContext = expressionSystem.buildEvaluationContext({ time }, node);
                        value = expressionSystem.safeEvaluate(clean, evalContext);
                    } else {
                        value = expressionSystem.evaluateExpression(value, { time }, node);
                    }
                }
            } catch {
                return fallback;
            }
        }

        const num = typeof value === 'number' ? value : parseFloat(value);
        return Number.isFinite(num) ? num : fallback;
    }

    /**
     * Recompute the CPU value of every node referenced by an expression
     * (node_<id> identifiers) into the expression system's value source.
     * The cached values in PreviewComputer refresh on a throttled schedule
     * and PAUSE during parameter drags, which made referenced floats look
     * quantized in the 3D output and freeze mid-drag. Evaluating them
     * synchronously per frame keeps references perfectly live.
     * @param {string} expression - Raw `=...` expression string
     * @private
     */
    _freshenReferencedValues(expression) {
        const editor = typeof window !== 'undefined' ? window.editor : null;
        const computer = editor?.nodeValueComputer
            || editor?.previewSystem?.nodeValueComputer
            || editor?.previewComputer?.nodeValueComputer;
        const valueCache = editor?.previewComputer?.lastComputedValues;
        if (!computer || !valueCache || typeof computer.computeNodeValue !== 'function') {
            return;
        }

        // node_12 / node_12_x style identifiers ([A-Za-z0-9]+ stops at '_')
        const seen = new Set();
        for (const match of String(expression).matchAll(/node_([A-Za-z0-9]+)/g)) {
            const refId = match[1];
            if (seen.has(refId)) continue;
            seen.add(refId);

            const refNode = editor.graph?.nodes?.find(
                (n) => n && String(n.id) === refId
            );
            if (!refNode) continue;

            try {
                const live = computer.computeNodeValue(refNode);
                if (live !== undefined && live !== null) {
                    valueCache.set(refNode.id, live);
                }
            } catch {
                // Keep the cached value for this reference
            }
        }
    }

    updateFieldMapperParams(fieldMapper, node) {
        const params = node.params || {};
        const setup = this.resolveRenderSetup(params);
        const num = (name, fallback) => this.resolveNumericParam(node, params, name, fallback);
        const scale = num('scale', 1.5);

        // GPU render parameters, consumed by SceneRenderer3D each frame.
        // Legacy point params (pointSize/gridSize/threshold) feed the
        // equivalent instance parameters so old saves keep their look.
        fieldMapper.shapeParams = {
            mode: setup.mode,
            shape: setup.shape,
            resolution: num('resolution', 96),
            displacementScale: num('displacementScale', 0.4),
            textureAmount: num('textureAmount', 1.0),
            instanceShape: setup.instanceShape,
            instanceCount: num('instanceCount', num('gridSize', 48)),
            instanceSize: num('instanceSize', num('pointSize', 0.03)),
            sizeByField: num('sizeByField', 0.6),
            instanceThreshold: num('instanceThreshold', num('threshold', 0.15))
        };
        fieldMapper.transform.setScale(scale, scale, scale);
        fieldMapper.mappingMode = 'surface';
        fieldMapper.fieldBounds = { min: [-1, -1, -1], max: [1, 1, 1] };
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
     * Per-frame update. Both render modes are GPU-driven (the render pass
     * samples the live compute texture), so the only per-frame work is
     * re-syncing parameters from the graph nodes - which is what makes
     * parameter drags apply in REAL TIME (drags mutate node.params without a
     * graph rebuild, and this is the only place that reads them per frame).
     */
    updateFrame() {
        if (this.fieldMappers.size === 0) {
            return;
        }

        for (const [nodeId, fieldMapper] of this.fieldMappers.entries()) {
            const graphNode = this._graphNodes.find(n => n && n.id === nodeId);
            if (graphNode) {
                this.updateFieldMapperParams(fieldMapper, graphNode);
            }
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
