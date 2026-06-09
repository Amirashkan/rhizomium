/**
 * LiveShaderStream - Real-time shader streaming using BroadcastChannel API
 *
 * Unlike BroadcastFrameStream which sends pre-rendered frames, this sends
 * the compiled WGSL shader code and parameters, allowing the external viewer
 * to render locally at full 60 FPS with zero frame serialization overhead.
 *
 * Features:
 * - Zero frame serialization overhead (no ImageData copying)
 * - True 60 FPS in external viewer (local GPU rendering)
 * - Real-time shader updates
 * - Real-time parameter updates
 * - Works across browser tabs/windows (same origin)
 * - Perfect for dual-screen setups
 */

export class LiveShaderStream {
    constructor(channelName = 'rhizo-live-shader-stream') {
        this.channelName = channelName;
        this.channel = null;
        this.isStreaming = false;

        // State tracking
        this.currentShader = null;
        this.currentUniforms = [];  // Changed from {} to [] to match new array format
        this.currentResolution = { width: 1920, height: 1080 };

        // Statistics
        this.shaderUpdatesSent = 0;
        this.uniformUpdatesSent = 0;

        // Check browser support
        if (!('BroadcastChannel' in window)) {
            this.supported = false;
        } else {
            this.supported = true;
        }
    }

    /**
     * Initialize the broadcast channel
     */
    init() {
        if (!this.supported) {
            throw new Error('BroadcastChannel API not supported in this browser');
        }

        this.channel = new BroadcastChannel(this.channelName);

        // Listen for shader requests from viewers
        this.channel.onmessage = (event) => {
            const data = event.data;

            if (data.type === 'request_shader') {
                // If no shader is available yet, trigger a rebuild
                if (!this.currentShader && window.rebuild && typeof window.rebuild === 'function') {
                    console.log('[LiveShaderStream] Shader requested but not available - triggering rebuild');
                    window.rebuild();
                } else {
                    this.sendCurrentState();
                }
            }
        };

        return this;
    }

    /**
     * Start streaming shaders
     */
    startStreaming() {
        if (!this.channel) {
            this.init();
        }

        this.isStreaming = true;
        this.shaderUpdatesSent = 0;
        this.uniformUpdatesSent = 0;

        // Announce streaming start
        this.channel.postMessage({
            type: 'stream_started',
            timestamp: Date.now()
        });

        // Send current state immediately
        this.sendCurrentState();
    }

    /**
     * Stop streaming
     */
    stopStreaming() {
        this.isStreaming = false;

        if (this.channel) {
            this.channel.postMessage({
                type: 'stream_stopped',
                timestamp: Date.now()
            });
        }
    }

    /**
     * Send shader update to viewers
     * @param {string} shaderCode - WGSL shader source code
     * @param {Object} uniformValues - Current uniform values
     * @param {Object} resolution - Current resolution {width, height}
     */
    sendShaderUpdate(shaderCode, uniformValues = {}, resolution = null) {
        if (!this.isStreaming || !this.channel) {
            console.log('[LiveShaderStream] Not sending update: isStreaming=', this.isStreaming, 'hasChannel=', !!this.channel);
            return;
        }

        if (!shaderCode || shaderCode.length === 0) {
            console.log('[LiveShaderStream] Not sending update: empty shader code');
            return;
        }

        console.log('[LiveShaderStream] Sending shader update, registry size:', window.computeNodeRegistry?.size || 0);

        this.currentShader = shaderCode;
        this.currentUniforms = uniformValues;
        if (resolution) {
            this.currentResolution = resolution;
        }

        // Serialize compute nodes from the registry
        const computeNodes = this._serializeComputeNodes();
        console.log('[LiveShaderStream] Serialized compute nodes:', computeNodes.length);

        // Serialize fragment nodes that are inputs to compute nodes
        const fragmentNodes = this._serializeFragmentNodes(computeNodes);

        // Serialize Texture2D node data URLs so the external viewer can upload them
        const textures = this._serializeTextures();

        // Extract parameter keys for mapping array indices back to node parameters
        const uniformKeys = [];
        if (window.nodeCompiler?.uniformManager?.uniformValues) {
            for (const key of window.nodeCompiler.uniformManager.uniformValues.keys()) {
                uniformKeys.push(key);
            }

            // DEBUG: Log colorize-related entries
            const colorizeEntries = [];
            for (const [key, value] of window.nodeCompiler.uniformManager.uniformValues.entries()) {
                if (key.includes('colorize')) {
                    colorizeEntries.push({ key, value });
                }
            }
            if (colorizeEntries.length > 0) {
                console.log('[LiveShaderStream] Colorize entries in uniformManager:', colorizeEntries);
                console.log('[LiveShaderStream] uniformKeys:', uniformKeys);
                console.log('[LiveShaderStream] uniformValues array:', uniformValues);
            }
        }

        // Compute node output values for nodes that produce simple numeric outputs
        // This enables parameter references like =node_14 to work in the viewer
        const nodeOutputValues = this._computeNodeOutputValues();

        // Get audio envelope values for transmission to viewer
        const audioEnvelope = {
            audioEnvelope: window._audioEnvelopeValue || 0.0,
            audioEnvelopeBass: window._audioEnvelopeBass || 0.0,
            audioEnvelopeMids: window._audioEnvelopeMids || 0.0,
            audioEnvelopeHighs: window._audioEnvelopeHighs || 0.0,
            audioEnvelopeFull: window._audioEnvelopeFull || 0.0
        };

        const message = {
            type: 'shader_update',
            shaderCode: shaderCode,
            uniformValues: uniformValues,
            uniformKeys: uniformKeys, // Map array indices to "nodeId.paramName" keys
            resolution: this.currentResolution,
            computeNodes: computeNodes, // Include compute node data
            fragmentNodes: fragmentNodes, // Include fragment node data for local rendering
            nodeOutputValues: nodeOutputValues, // Node output values for parameter reference evaluation
            audioEnvelope: audioEnvelope, // Include audio envelope values
            textures: textures, // Texture2D data URLs keyed by node ID
            timestamp: Date.now()
        };

        this.channel.postMessage(message);
        this.shaderUpdatesSent++;

    }

    /**
     * Serialize Texture2D node data so the external viewer can upload them locally.
     * Returns a plain object keyed by sanitized node ID -> { dataUrl, filename }.
     */
    _serializeTextures() {
        const result = {};
        const texManager = typeof window !== 'undefined' ? window.textureManager : null;
        if (!texManager || !texManager.textures) return result;

        for (const [nodeId, info] of texManager.textures.entries()) {
            if (info && info.dataUrl) {
                const sanitizedId = String(nodeId).replace(/[^a-zA-Z0-9_]/g, '_');
                result[sanitizedId] = {
                    dataUrl: info.dataUrl,
                    filename: info.filename || ''
                };
            }
        }
        return result;
    }

    /**
     * Serialize compute nodes from the registry for transmission to viewer
     * @returns {Array} Array of compute node data
     */
    _serializeComputeNodes() {
        const nodes = [];

        if (!window.computeNodeRegistry || window.computeNodeRegistry.size === 0) {
            return nodes;
        }

        for (const [nodeId, nodeData] of window.computeNodeRegistry) {
            const { node, wgslCode, resolution, supportsFeedback } = nodeData;

            // Extract actual input connections from the graph
            const inputs = this._extractComputeNodeInputs(node);

            // Serialize node data for viewer
            nodes.push({
                nodeId: nodeId,
                kind: node.kind,
                wgslCode: wgslCode,
                resolution: resolution,
                supportsFeedback: supportsFeedback,
                params: node.params || {},
                inputs: inputs
            });
        }

        return nodes;
    }

    /**
     * Extract input node IDs connected to a compute node
     * @param {Object} node - The compute node
     * @returns {Array} Array of input node IDs (or null for empty slots)
     */
    _extractComputeNodeInputs(node) {
        if (!window.graph || !window.graph.nodes || !node) {
            console.log('[LiveShaderStream] Cannot extract inputs: missing graph or node');
            return [];
        }

        const inputs = [];

        // Find the node in the graph
        const graphNode = window.graph.nodes.find(n => n && n.id === node.id);
        if (!graphNode) {
            console.log('[LiveShaderStream] Node not found in graph:', node.id);
            return [];
        }

        console.log('[LiveShaderStream] Extracting inputs for node', node.id, 'inputs:', graphNode.inputs);

        // Check input slots (typically 0 and 1 for nodes with inputs)
        for (let i = 0; i < 2; i++) {
            const inputSlot = graphNode.inputs?.[i];

            // Handle loaded file format: inputs[i] is directly a node ID string
            if (typeof inputSlot === 'string' || typeof inputSlot === 'number') {
                const cleanId = String(inputSlot).replace(/[^a-zA-Z0-9_]/g, "_");
                console.log(`[LiveShaderStream]   Input ${i}: loaded format, nodeId="${cleanId}"`);
                inputs.push(cleanId);
            }
            // Handle live LiteGraph format: inputs[i] has .connections[]
            else if (inputSlot && inputSlot.connections && inputSlot.connections.length > 0) {
                // Get the first connection (nodes typically have 1 connection per input)
                const connection = inputSlot.connections[0];
                if (connection && connection.node) {
                    // Store the source node ID
                    const cleanId = String(connection.node).replace(/[^a-zA-Z0-9_]/g, "_");
                    console.log(`[LiveShaderStream]   Input ${i}: live format, nodeId="${cleanId}"`);
                    inputs.push(cleanId);
                } else {
                    console.log(`[LiveShaderStream]   Input ${i}: live format, but connection invalid`);
                    inputs.push(null);
                }
            } else {
                console.log(`[LiveShaderStream]   Input ${i}: null/empty`);
                inputs.push(null);
            }
        }

        return inputs;
    }

    /**
     * Serialize fragment nodes that are inputs to compute nodes
     * @param {Array} computeNodes - Array of compute node data
     * @returns {Array} Array of fragment node data with compiled WGSL
     */
    _serializeFragmentNodes(computeNodes) {
        const fragmentNodes = [];
        const processedIds = new Set();

        // Collect all unique fragment node IDs from compute node inputs
        const fragmentNodeIds = new Set();
        for (const computeNode of computeNodes) {
            if (computeNode.inputs && Array.isArray(computeNode.inputs)) {
                for (const inputId of computeNode.inputs) {
                    if (inputId !== null && inputId !== undefined) {
                        // Check if this input is NOT a compute node (i.e., it's a fragment node)
                        const isComputeNode = window.computeNodeRegistry?.has(String(inputId));
                        if (!isComputeNode && !processedIds.has(inputId)) {
                            fragmentNodeIds.add(inputId);
                            processedIds.add(inputId);
                        }
                    }
                }
            }
        }

        if (fragmentNodeIds.size === 0) {
            return fragmentNodes;
        }

        // Compile each fragment node to WGSL
        for (const nodeId of fragmentNodeIds) {
            try {
                const node = window.graph?.getNode(nodeId);
                if (!node) {
                    continue;
                }

                // Compile node to shader using the same approach as FragmentTextureRenderer
                const compilationResult = this._compileFragmentNodeToShader(node);
                if (!compilationResult) {
                    continue;
                }

                const { wgsl, uniformManager } = compilationResult;

                // Extract parameter values in the order uniformManager assigned them
                const parameterValues = uniformManager ? Array.from(uniformManager.uniformValues.values()) : [];

                // Serialize fragment node data
                fragmentNodes.push({
                    nodeId: nodeId,
                    kind: node.kind,
                    wgslCode: wgsl,
                    params: node.params || {},
                    parameterValues: parameterValues, // Ordered parameter values for uniform buffer
                    inputs: node.inputs || []
                });

            } catch (error) {
                console.warn(`[LiveShaderStream] Failed to serialize fragment node ${nodeId}:`, error);
            }
        }

        return fragmentNodes;
    }

    /**
     * Compile a fragment node to WGSL shader
     * Uses the same approach as FragmentTextureRenderer
     * @private
     */
    _compileFragmentNodeToShader(targetNode) {
        try {
            // Create a minimal subgraph containing just this node and its dependencies
            const subgraph = this._extractFragmentSubgraph(targetNode);

            // Create a fake OutputFinal node to make buildWGSL happy
            const outputNode = {
                id: `output_for_${targetNode.id}`,
                kind: 'OutputFinal',
                inputs: [targetNode.id],
                params: {}
            };
            subgraph.nodes.push(outputNode);

            // Use the existing buildWGSL infrastructure
            // CRITICAL: skipCacheClear=true prevents clearing the main shader's caches
            if (!window.buildWGSL) {
                // Try to load buildWGSL if not already available
                console.warn('[LiveShaderStream] buildWGSL not available globally');
                return null;
            }

            const { wgsl, uniformManager } = window.buildWGSL(subgraph, { skipCacheClear: true });

            if (!wgsl || wgsl.trim() === '') {
                return null;
            }

            return { wgsl, uniformManager };
        } catch (error) {
            console.warn('[LiveShaderStream] Error compiling fragment node:', error);
            return null;
        }
    }

    /**
     * Extract a subgraph containing a fragment node and all its dependencies
     * @private
     */
    _extractFragmentSubgraph(targetNode) {
        const subgraphNodes = [];
        const visited = new Set();

        const addNodeWithDependencies = (node) => {
            if (!node || visited.has(node.id)) return;
            visited.add(node.id);

            // Add input dependencies first
            if (node.inputs && Array.isArray(node.inputs)) {
                for (const inputId of node.inputs) {
                    if (inputId !== null && inputId !== undefined) {
                        const inputNode = window.graph?.getNode(inputId);
                        if (inputNode) {
                            addNodeWithDependencies(inputNode);
                        }
                    }
                }
            }

            // Add the node itself
            subgraphNodes.push(node);
        };

        addNodeWithDependencies(targetNode);

        // Create connections array from node inputs
        const connections = [];
        for (const node of subgraphNodes) {
            if (node.inputs && Array.isArray(node.inputs)) {
                for (let pinIndex = 0; pinIndex < node.inputs.length; pinIndex++) {
                    const inputId = node.inputs[pinIndex];
                    if (inputId !== null && inputId !== undefined) {
                        connections.push({
                            from: { nodeId: inputId, pin: 0 },
                            to: { nodeId: node.id, pin: pinIndex }
                        });
                    }
                }
            }
        }

        return {
            nodes: subgraphNodes,
            connections: connections,
            getNode: (id) => subgraphNodes.find(n => n.id === id)
        };
    }

    /**
     * Send uniform update to viewers (for real-time parameter changes)
     * @param {string} uniformName - Name of the uniform
     * @param {number|Array} value - New value
     */
    sendUniformUpdate(uniformName, value) {
        if (!this.isStreaming || !this.channel) return;

        this.currentUniforms[uniformName] = value;

        const message = {
            type: 'uniform_update',
            uniformName: uniformName,
            value: value,
            timestamp: Date.now()
        };

        this.channel.postMessage(message);
        this.uniformUpdatesSent++;

        // Log every 60th update to avoid spam
        if (this.uniformUpdatesSent % 60 === 0) {
        }
    }

    /**
     * Send resolution update to viewers
     * @param {number} width - New width
     * @param {number} height - New height
     */
    sendResolutionUpdate(width, height) {
        if (!this.isStreaming || !this.channel) return;

        this.currentResolution = { width, height };

        const message = {
            type: 'resolution_update',
            width: width,
            height: height,
            timestamp: Date.now()
        };

        this.channel.postMessage(message);

    }

    /**
     * Send parameter and time update to viewers (for real-time sync during dragging)
     * @param {Array} uniformValues - Array of parameter values
     * @param {number} time - Current time in seconds
     * @param {Object} computeNodeParams - Optional compute node params
     * @param {Object} audioEnvelope - Optional audio envelope values {audioEnvelope, audioEnvelopeBass, audioEnvelopeMids, audioEnvelopeHighs, audioEnvelopeFull}
     */
    sendParameterUpdate(uniformValues, time, computeNodeParams = null, audioEnvelope = null) {
        if (!this.isStreaming || !this.channel) {
            // DEBUG: Log why we're not sending
            if (this.uniformUpdatesSent === 0) {
                console.warn('[LiveShaderStream] NOT sending parameter update - isStreaming:', this.isStreaming, 'hasChannel:', !!this.channel);
            }
            return;
        }

        this.currentUniforms = uniformValues;

        // Extract uniformKeys for mapping array indices to node parameters
        // CRITICAL: Include uniformKeys so viewer can map uniformValuesArray to specific node parameters
        const uniformKeys = [];
        if (window.nodeCompiler?.uniformManager?.uniformValues) {
            for (const key of window.nodeCompiler.uniformManager.uniformValues.keys()) {
                uniformKeys.push(key);
            }
        }

        // Get audio envelope values if not provided (fallback to window values)
        if (!audioEnvelope) {
            audioEnvelope = {
                audioEnvelope: window._audioEnvelopeValue || 0.0,
                audioEnvelopeBass: window._audioEnvelopeBass || 0.0,
                audioEnvelopeMids: window._audioEnvelopeMids || 0.0,
                audioEnvelopeHighs: window._audioEnvelopeHighs || 0.0,
                audioEnvelopeFull: window._audioEnvelopeFull || 0.0
            };
        }

        // CRITICAL: Recompute node output values when parameters change
        // This ensures that when a node with expressions (time/audio) changes,
        // nodes that reference it (e.g., =node_X) get updated values in the viewer
        const nodeOutputValues = this._computeNodeOutputValues();

        const message = {
            type: 'parameter_update',
            uniformValues: uniformValues,
            uniformKeys: uniformKeys, // Include keys for mapping
            computeNodeParams: computeNodeParams, // Include compute node params if provided
            audioEnvelope: audioEnvelope, // Include audio envelope values
            nodeOutputValues: nodeOutputValues, // Include updated node output values for parameter references
            time: time,
            timestamp: Date.now()
        };

        this.channel.postMessage(message);
        this.uniformUpdatesSent++;

        // Log every 60th update to avoid spam (once per second at 60fps)
        if (this.uniformUpdatesSent % 60 === 0) {
            console.log('[LiveShaderStream] Posted message #', this.uniformUpdatesSent, 'to channel:', this.channelName, 'values:', uniformValues.slice(0, 3), 'keys:', uniformKeys.length, 'computeParams:', !!computeNodeParams, 'audioEnv:', audioEnvelope.audioEnvelope.toFixed(3));
        }
    }

    /**
     * Send current state to newly connected viewers
     */
    sendCurrentState() {
        if (!this.currentShader) {
            return;
        }

        this.sendShaderUpdate(
            this.currentShader,
            this.currentUniforms,
            this.currentResolution
        );
    }

    /**
     * Update resolution tracking (call when preview resolution changes)
     * @param {number} width - New width
     * @param {number} height - New height
     */
    updateResolution(width, height) {
        if (this.currentResolution.width !== width ||
            this.currentResolution.height !== height) {
            this.sendResolutionUpdate(width, height);
        }
    }

    /**
     * Get streaming statistics
     */
    getStats() {
        return {
            supported: this.supported,
            streaming: this.isStreaming,
            shaderUpdatesSent: this.shaderUpdatesSent,
            uniformUpdatesSent: this.uniformUpdatesSent,
            currentResolution: this.currentResolution,
            hasShader: !!this.currentShader
        };
    }

    /**
     * Compute node output values for nodes that produce simple numeric outputs
     * This enables parameter references like =node_14 to work in the viewer
     * @returns {Map<string, number|Array>} Map of node ID -> output value
     */
    _computeNodeOutputValues() {
        const outputValues = {};
        
        if (!window.graph || !window.graph.nodes) {
            return outputValues;
        }

        // Get preview computer for node value computation
        const previewComputer = window.editor?.previewComputer;
        const nodeValueComputer = window.editor?.nodeValueComputer;

        // Process all nodes in the graph
        for (const node of window.graph.nodes) {
            if (!node || !node.id) continue;

            // Only compute values for nodes that produce simple numeric outputs
            // These are typically input nodes like Float, Vec2, etc.
            // Also include utility nodes that produce f32 outputs (like Remap, Posterize, Expr, etc.)
            const simpleOutputKinds = [
                'Float', 'ConstFloat',
                'Vec2', 'ConstVec2',
                'Vec3', 'ConstVec3',
                'Vec4', 'ConstVec4',
                'Time', 'UV', 'Mouse',
                'Remap', 'Posterize', 'Expr', 'ColorToGrayscale'
            ];

            const isSimpleOutput = simpleOutputKinds.some(kind => 
                node.kind && node.kind.toLowerCase().includes(kind.toLowerCase())
            );

            if (!isSimpleOutput) continue;

            try {
                let nodeValue = null;

                // Try to get from preview computer (cached computed values)
                if (previewComputer && previewComputer.lastComputedValues) {
                    nodeValue = previewComputer.lastComputedValues.get(node.id);
                }

                // Fallback: compute value directly
                if (nodeValue === undefined || nodeValue === null) {
                    if (nodeValueComputer) {
                        nodeValue = nodeValueComputer.computeNodeValue(node);
                    } else if (window.editor) {
                        nodeValue = window.editor.getNodeOutputValue(node);
                    }
                }

                // If we got a valid value, store it
                if (nodeValue !== undefined && nodeValue !== null) {
                    // Normalize node ID for lookup (handle different ID formats)
                    const normalizedId = String(node.id).replace(/[^a-zA-Z0-9_]/g, '_');
                    outputValues[normalizedId] = nodeValue;
                    // Also store with original ID format
                    outputValues[String(node.id)] = nodeValue;
                }
            } catch (error) {
                // Silently skip nodes that can't be computed
                console.debug(`[LiveShaderStream] Could not compute output value for node ${node.id}:`, error);
            }
        }

        return outputValues;
    }

    /**
     * Close the broadcast channel
     */
    close() {
        if (this.channel) {
            this.stopStreaming();
            this.channel.close();
            this.channel = null;
        }
    }

    /**
     * Static method to check if BroadcastChannel is supported
     */
    static isSupported() {
        return 'BroadcastChannel' in window;
    }
}

export default LiveShaderStream;
