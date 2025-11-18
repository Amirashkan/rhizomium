/**
 * BroadcastFrameStream - Client-side frame streaming using BroadcastChannel API
 *
 * This works entirely in the browser without a backend server.
 * Perfect for Vercel static deployments!
 *
 * Features:
 * - No backend required
 * - Works across browser tabs/windows (same origin)
 * - Zero latency (local communication)
 * - Perfect for Vercel static hosting
 *
 * Limitations:
 * - Only works within same origin (same domain)
 * - Doesn't work across different devices/computers
 * - For network streaming, use the Partykit or Pusher version
 */

export class BroadcastFrameStream {
    constructor(channelName = 'rhizo-frame-stream') {
        this.channelName = channelName;
        this.channel = null;
        this.isStreaming = false;
        this.isReceiving = false;

        // Statistics
        this.framesSent = 0;
        this.framesReceived = 0;
        this.lastFrameTime = 0;
        this.fps = 0;

        // Callbacks
        this.onFrameCallback = null;
        this.onMetadataCallback = null;

        // Throttling
        this.targetFps = 60;
        this.minFrameInterval = 1000 / this.targetFps;

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

        // Add listener to debug messages from other tabs
        this.channel.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'viewer_ping') {
                // Viewer ping received
            } else if (data.type === 'request_frame') {
                // Frame requested
            }
        };

        return this;
    }

    /**
     * Start sending frames (editor mode)
     */
    startStreaming() {
        if (!this.channel) {
            this.init();
        }

        this.isStreaming = true;
        this.framesSent = 0;

        // Announce streaming start
        this.channel.postMessage({
            type: 'stream_started',
            timestamp: Date.now()
        });
    }

    /**
     * Stop sending frames
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
     * Start receiving frames (viewer mode)
     * @param {Function} onFrame - Callback for frame data: (imageData, metadata) => {}
     */
    startReceiving(onFrame, onMetadata = null) {
        if (!this.channel) {
            this.init();
        }

        this.isReceiving = true;
        this.framesReceived = 0;
        this.onFrameCallback = onFrame;
        this.onMetadataCallback = onMetadata;

        // Set up message handler
        this.channel.onmessage = (event) => {
            this.handleMessage(event.data);
        };

        // Request current frame
        this.channel.postMessage({
            type: 'request_frame',
            timestamp: Date.now()
        });
    }

    /**
     * Stop receiving frames
     */
    stopReceiving() {
        this.isReceiving = false;

        if (this.channel) {
            this.channel.onmessage = null;
        }
    }

    /**
     * Handle incoming messages
     */
    handleMessage(data) {
        if (!this.isReceiving) return;

        const { type } = data;

        if (type === 'frame') {
            this.framesReceived++;

            // Update FPS
            const now = performance.now();
            if (this.lastFrameTime > 0) {
                const delta = (now - this.lastFrameTime) / 1000;
                if (delta > 0) {
                    this.fps = 0.9 * this.fps + 0.1 * (1 / delta);
                }
            }
            this.lastFrameTime = now;

            // Call callback with frame data
            if (this.onFrameCallback) {
                this.onFrameCallback(data.imageData, data.metadata);
            }

        } else if (type === 'metadata') {
            if (this.onMetadataCallback) {
                this.onMetadataCallback(data);
            }
        } else if (type === 'stream_started') {
            // Stream started
        } else if (type === 'stream_stopped') {
            // Stream stopped
        } else if (type === 'request_frame') {
            // Another viewer is requesting a frame, ignore if we're not streaming
        }
    }

    /**
     * Send a frame from a canvas
     * @param {HTMLCanvasElement} canvas - Source canvas
     */
    async sendFrameFromCanvas(canvas) {
        if (!this.isStreaming || !this.channel) return;

        // Throttle to 60 FPS to prevent overwhelming the viewer
        const now = performance.now();
        const timeSinceLastFrame = now - this.lastFrameTime;

        if (timeSinceLastFrame < this.minFrameInterval) {
            // Skip this frame - too soon
            return;
        }

        this.lastFrameTime = now;

        try {
            // CRITICAL: Wait for GPU frame to be presented before capturing
            // This ensures compute shaders have finished and the frame is ready
            const gpuRenderer = window.gpuRenderer;
            if (gpuRenderer && typeof gpuRenderer.waitForFrame === 'function') {
                await gpuRenderer.waitForFrame();
            }

            // For WebGPU canvases, we need to use an offscreen 2D canvas
            // to read the pixels (WebGPU canvases don't have getContext('2d'))

            // Create or reuse offscreen canvas
            if (!this._offscreenCanvas) {
                this._offscreenCanvas = document.createElement('canvas');
                this._offscreenCtx = this._offscreenCanvas.getContext('2d', {
                    willReadFrequently: true
                });
            }

            // Resize offscreen canvas if needed
            if (this._offscreenCanvas.width !== canvas.width ||
                this._offscreenCanvas.height !== canvas.height) {
                this._offscreenCanvas.width = canvas.width;
                this._offscreenCanvas.height = canvas.height;
            }

            // Copy WebGPU canvas to 2D canvas using drawImage
            // This works for both WebGPU and regular canvases
            this._offscreenCtx.drawImage(canvas, 0, 0);

            // Read pixels from 2D canvas
            const imageData = this._offscreenCtx.getImageData(
                0, 0,
                canvas.width,
                canvas.height
            );

            // Prepare metadata
            const metadata = {
                width: canvas.width,
                height: canvas.height,
                timestamp: Date.now(),
                frame_number: this.framesSent
            };

            // Broadcast frame
            this.channel.postMessage({
                type: 'frame',
                imageData: imageData,
                metadata: metadata
            });

            this.framesSent++;

        } catch (error) {
            // Silently handle errors to avoid spamming console
        }
    }

    /**
     * Send frame from ImageData
     * @param {ImageData} imageData - Frame data
     * @param {number} width - Frame width
     * @param {number} height - Frame height
     */
    sendFrame(imageData, width, height) {
        if (!this.isStreaming || !this.channel) return;

        try {
            const metadata = {
                width,
                height,
                timestamp: Date.now(),
                frame_number: this.framesSent
            };

            this.channel.postMessage({
                type: 'frame',
                imageData: imageData,
                metadata: metadata
            });

            this.framesSent++;

        } catch (error) {

        }
    }

    /**
     * Set target FPS for streaming
     * @param {number} fps - Target FPS (1-60)
     */
    setTargetFPS(fps) {
        this.targetFps = Math.max(1, Math.min(60, fps));
        this.minFrameInterval = 1000 / this.targetFps;
    }

    /**
     * Get streaming statistics
     */
    getStats() {
        return {
            supported: this.supported,
            streaming: this.isStreaming,
            receiving: this.isReceiving,
            framesSent: this.framesSent,
            framesReceived: this.framesReceived,
            fps: this.fps.toFixed(1),
            targetFps: this.targetFps
        };
    }

    /**
     * Close the broadcast channel
     */
    close() {
        if (this.channel) {
            this.stopStreaming();
            this.stopReceiving();
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

export default BroadcastFrameStream;
