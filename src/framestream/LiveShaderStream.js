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
                this.sendCurrentState();
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

        const message = {
            type: 'shader_update',
            shaderCode: shaderCode,
            uniformValues: uniformValues,
            resolution: this.currentResolution,
            timestamp: Date.now()
        };

            codeLength: shaderCode.length,
            uniformCount: Array.isArray(uniformValues) ? uniformValues.length : Object.keys(uniformValues).length,
            uniformValues: uniformValues, // Log actual values for debugging
            resolution: this.currentResolution,
            shaderPreview: shaderCode.substring(0, 100) + '...'
        });

        this.channel.postMessage(message);
        this.shaderUpdatesSent++;

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
