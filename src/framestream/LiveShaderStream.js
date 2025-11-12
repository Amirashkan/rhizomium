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
            return;
        }

        if (!shaderCode || shaderCode.length === 0) {
            return;
        }

        this.currentShader = shaderCode;
        this.currentUniforms = uniformValues;
        if (resolution) {
            this.currentResolution = resolution;
        }

        // Serialize compute nodes from the registry
        const computeNodes = this._serializeComputeNodes();

        // Serialize fragment nodes that are inputs to compute nodes
        const fragmentNodes = this._serializeFragmentNodes(computeNodes);

        const message = {
            type: 'shader_update',
            shaderCode: shaderCode,
            uniformValues: uniformValues,
            resolution: this.currentResolution,
            computeNodes: computeNodes, // Include compute node data
            fragmentNodes: fragmentNodes, // Include fragment node data for local rendering
            timestamp: Date.now()
        };

        this.channel.postMessage(message);
        this.shaderUpdatesSent++;

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
            return [];
        }

        const inputs = [];

        // Find the node in the graph
        const graphNode = window.graph.nodes.find(n => n && n.id === node.id);
        if (!graphNode) {
            return [];
        }

        // Check input slots (typically 0 and 1 for nodes with inputs)
        for (let i = 0; i < 2; i++) {
            const inputSlot = graphNode.inputs?.[i];

            // Handle loaded file format: inputs[i] is directly a node ID string
            if (typeof inputSlot === 'string' || typeof inputSlot === 'number') {
                inputs.push(String(inputSlot).replace(/[^a-zA-Z0-9_]/g, "_"));
            }
            // Handle live LiteGraph format: inputs[i] has .connections[]
            else if (inputSlot && inputSlot.connections && inputSlot.connections.length > 0) {
                // Get the first connection (nodes typically have 1 connection per input)
                const connection = inputSlot.connections[0];
                if (connection && connection.node) {
                    // Store the source node ID
                    inputs.push(String(connection.node).replace(/[^a-zA-Z0-9_]/g, "_"));
                } else {
                    inputs.push(null);
                }
            } else {
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
     */
    sendParameterUpdate(uniformValues, time) {
        if (!this.isStreaming || !this.channel) return;

        this.currentUniforms = uniformValues;

        const message = {
            type: 'parameter_update',
            uniformValues: uniformValues,
            time: time,
            timestamp: Date.now()
        };

        this.channel.postMessage(message);
        this.uniformUpdatesSent++;

        // Log every 30th update to avoid spam
        if (this.uniformUpdatesSent % 30 === 0) {
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
