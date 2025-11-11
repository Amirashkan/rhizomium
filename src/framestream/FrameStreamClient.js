/**
 * FrameStreamClient - Client for sending rendered frames to WebSocket server
 *
 * This client integrates with the editor's rendering pipeline to capture
 * frames and stream them to connected viewers via WebSocket.
 *
 * Usage:
 *   const client = new FrameStreamClient('http://localhost:5000');
 *   await client.connect();
 *
 *   // In render loop:
 *   const frameData = canvas.toDataURL('image/jpeg', 0.9);
 *   client.sendFrame(frameData, width, height);
 *
 * Or directly from canvas/ImageData:
 *   client.sendFrameFromCanvas(canvas);
 */

export class FrameStreamClient {
    constructor(serverUrl = 'http://localhost:5000') {
        this.serverUrl = serverUrl;
        this.frameStreamUrl = `${serverUrl}/api/stream-frame`;
        this.connected = false;
        this.streaming = false;

        // Statistics
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.fps = 0;

        // Throttling
        this.targetFps = 30; // Target streaming FPS (lower than render FPS)
        this.minFrameInterval = 1000 / this.targetFps;

        // Queue for async frame sending
        this.sendQueue = [];
        this.sending = false;

    }

    /**
     * Check if the frame streaming server is available
     */
    async checkConnection() {
        try {
            const response = await fetch(`${this.serverUrl}/api/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                this.connected = true;
                return true;
            }
        } catch (error) {
            this.connected = false;
        }
        return false;
    }

    /**
     * Start streaming frames
     */
    async startStreaming() {
        const available = await this.checkConnection();
        if (!available) {
            throw new Error('Frame streaming server not available');
        }

        this.streaming = true;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();

    }

    /**
     * Stop streaming frames
     */
    stopStreaming() {
        this.streaming = false;
    }

    /**
     * Send a frame from a canvas element
     * This is the recommended method for WebGPU/WebGL canvases
     *
     * @param {HTMLCanvasElement} canvas - The canvas to capture
     * @param {string} format - 'rgb' or 'rgba'
     * @param {number} quality - JPEG quality (0-1) for compression
     */
    async sendFrameFromCanvas(canvas, format = 'rgb', quality = 0.85) {
        if (!this.streaming) return;

        // Throttle frame rate
        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        if (elapsed < this.minFrameInterval) {
            return; // Skip this frame
        }

        try {
            // Get ImageData from canvas
            const ctx = canvas.getContext('2d', { willReadFrequently: true }) ||
                       canvas.getContext('webgl2') ||
                       canvas.getContext('webgl');

            let imageData;
            if (ctx.constructor.name.includes('WebGL')) {
                // WebGL context - read pixels directly
                imageData = this.readWebGLPixels(ctx, canvas.width, canvas.height);
            } else {
                // 2D context
                imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            }

            // Convert to RGB if needed
            let frameData;
            if (format === 'rgb') {
                frameData = this.convertRGBAtoRGB(imageData.data);
            } else {
                frameData = imageData.data;
            }

            // Send to server
            await this.sendFrameData(
                frameData,
                canvas.width,
                canvas.height,
                format
            );

            this.lastFrameTime = now;
            this.frameCount++;

            // Update FPS
            if (this.frameCount % 30 === 0) {
                this.fps = 30000 / (now - (this.lastFrameTime - elapsed));
            }

        } catch (error) {

        }
    }

    /**
     * Send a frame from WebGPU GPUTexture
     *
     * @param {GPUDevice} device - WebGPU device
     * @param {GPUTexture} texture - Source texture
     * @param {number} width - Texture width
     * @param {number} height - Texture height
     */
    async sendFrameFromGPUTexture(device, texture, width, height) {
        if (!this.streaming) return;

        // Throttle frame rate
        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        if (elapsed < this.minFrameInterval) {
            return;
        }

        try {
            // Create a buffer to read texture data
            const bytesPerPixel = 4; // RGBA
            const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256; // Align to 256
            const bufferSize = bytesPerRow * height;

            const readBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });

            // Copy texture to buffer
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer(
                { texture: texture },
                {
                    buffer: readBuffer,
                    bytesPerRow: bytesPerRow,
                    rowsPerImage: height
                },
                { width, height, depthOrArrayLayers: 1 }
            );

            device.queue.submit([encoder.finish()]);

            // Read buffer
            await readBuffer.mapAsync(GPUMapMode.READ);
            const arrayBuffer = readBuffer.getMappedRange();
            const pixels = new Uint8Array(arrayBuffer);

            // Extract actual pixel data (remove padding)
            const frameData = new Uint8Array(width * height * 4);
            for (let y = 0; y < height; y++) {
                const srcOffset = y * bytesPerRow;
                const dstOffset = y * width * 4;
                frameData.set(pixels.subarray(srcOffset, srcOffset + width * 4), dstOffset);
            }

            // Convert RGBA to RGB
            const rgbData = this.convertRGBAtoRGB(frameData);

            // Send frame
            await this.sendFrameData(rgbData, width, height, 'rgb');

            // Cleanup
            readBuffer.unmap();
            readBuffer.destroy();

            this.lastFrameTime = now;
            this.frameCount++;

        } catch (error) {

        }
    }

    /**
     * Read pixels from WebGL context
     *
     * @param {WebGLRenderingContext} gl - WebGL context
     * @param {number} width - Width
     * @param {number} height - Height
     * @returns {ImageData} - Image data
     */
    readWebGLPixels(gl, width, height) {
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Flip Y (WebGL has origin at bottom-left)
        const flipped = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
        }

        return new ImageData(new Uint8ClampedArray(flipped), width, height);
    }

    /**
     * Convert RGBA to RGB (remove alpha channel)
     *
     * @param {Uint8Array|Uint8ClampedArray} rgba - RGBA data
     * @returns {Uint8Array} - RGB data
     */
    convertRGBAtoRGB(rgba) {
        const rgb = new Uint8Array((rgba.length / 4) * 3);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
            rgb[j] = rgba[i];         // R
            rgb[j + 1] = rgba[i + 1]; // G
            rgb[j + 2] = rgba[i + 2]; // B
        }
        return rgb;
    }

    /**
     * Send raw frame data to server
     *
     * @param {Uint8Array} data - Raw pixel data
     * @param {number} width - Frame width
     * @param {number} height - Frame height
     * @param {string} format - 'rgb' or 'rgba'
     */
    async sendFrameData(data, width, height, format = 'rgb') {
        // Queue the frame send to avoid blocking render loop
        this.sendQueue.push({ data, width, height, format });

        if (!this.sending) {
            this.processSendQueue();
        }
    }

    /**
     * Process the send queue asynchronously
     */
    async processSendQueue() {
        if (this.sending || this.sendQueue.length === 0) return;

        this.sending = true;

        while (this.sendQueue.length > 0) {
            // Take the latest frame, discard old ones
            const frame = this.sendQueue.pop();
            this.sendQueue = []; // Clear queue

            try {
                // Encode as base64
                const base64Data = this.arrayBufferToBase64(frame.data);

                // Send to server
                const response = await fetch(this.frameStreamUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        width: frame.width,
                        height: frame.height,
                        format: frame.format,
                        data: base64Data
                    })
                });

                if (!response.ok) {

                }

            } catch (error) {

                // Attempt reconnection
                this.connected = false;
            }
        }

        this.sending = false;
    }

    /**
     * Convert ArrayBuffer/Uint8Array to base64
     *
     * @param {Uint8Array} buffer - Data buffer
     * @returns {string} - Base64 encoded string
     */
    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;

        // Process in chunks to avoid stack overflow
        const chunkSize = 0x8000; // 32KB chunks
        for (let i = 0; i < len; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
            binary += String.fromCharCode.apply(null, chunk);
        }

        return btoa(binary);
    }

    /**
     * Set target streaming FPS
     *
     * @param {number} fps - Target FPS (1-60)
     */
    setTargetFPS(fps) {
        this.targetFps = Math.max(1, Math.min(60, fps));
        this.minFrameInterval = 1000 / this.targetFps;
    }

    /**
     * Get streaming statistics
     *
     * @returns {object} - Stats object
     */
    getStats() {
        return {
            connected: this.connected,
            streaming: this.streaming,
            frameCount: this.frameCount,
            fps: this.fps.toFixed(1),
            targetFps: this.targetFps,
            queueSize: this.sendQueue.length
        };
    }
}

export default FrameStreamClient;
