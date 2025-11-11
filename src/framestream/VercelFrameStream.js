/**
 * VercelFrameStream - Frame streaming for Vercel deployments
 *
 * This version uses Partykit (https://partykit.io/) for real-time streaming on Vercel.
 * Partykit provides WebSocket infrastructure that works with serverless platforms.
 *
 * Alternative: Use Pusher Channels or Ably for similar functionality
 *
 * Setup:
 * 1. Install Partykit: npm install partykit
 * 2. Create partykit/server.ts in your project
 * 3. Deploy: npx partykit deploy
 * 4. Use the Partykit URL in this client
 */

export class VercelFrameStream {
    constructor(config = {}) {
        // Partykit configuration
        this.partykitHost = config.partykitHost || 'YOUR_PARTYKIT_PROJECT.partykit.dev';
        this.roomName = config.roomName || 'frame-stream';

        // Or use Pusher Channels
        this.usePusher = config.usePusher || false;
        this.pusherConfig = config.pusher || {
            appKey: 'YOUR_PUSHER_KEY',
            cluster: 'us2'
        };

        this.connection = null;
        this.channel = null;
        this.isStreaming = false;
        this.isReceiving = false;

        // Statistics
        this.framesSent = 0;
        this.framesReceived = 0;
        this.lastFrameTime = 0;
        this.fps = 0;

        // Throttling
        this.targetFps = 30;
        this.minFrameInterval = 1000 / this.targetFps;

        // Callbacks
        this.onFrameCallback = null;
        this.onConnectionCallback = null;
    }

    /**
     * Connect to Partykit or Pusher
     */
    async connect() {
        if (this.usePusher) {
            await this.connectPusher();
        } else {
            await this.connectPartykit();
        }
    }

    /**
     * Connect to Partykit
     */
    async connectPartykit() {
        try {
            const url = `wss://${this.partykitHost}/parties/framestream/${this.roomName}`;
            this.connection = new WebSocket(url);

            this.connection.onopen = () => {
                if (this.onConnectionCallback) {
                    this.onConnectionCallback(true);
                }

                // Send hello message
                this.send({
                    type: 'hello',
                    role: this.isStreaming ? 'editor' : 'viewer',
                    timestamp: Date.now()
                });
            };

            this.connection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {

                }
            };

            this.connection.onerror = (error) => {

            };

            this.connection.onclose = () => {
                if (this.onConnectionCallback) {
                    this.onConnectionCallback(false);
                }

                // Auto-reconnect
                if (this.isStreaming || this.isReceiving) {
                    setTimeout(() => this.connect(), 2000);
                }
            };

        } catch (error) {

        }
    }

    /**
     * Connect to Pusher Channels (alternative to Partykit)
     */
    async connectPusher() {
        try {
            // Load Pusher library dynamically
            if (!window.Pusher) {
                await this.loadPusherScript();
            }

            this.connection = new window.Pusher(this.pusherConfig.appKey, {
                cluster: this.pusherConfig.cluster
            });

            this.channel = this.connection.subscribe(`private-${this.roomName}`);

            this.channel.bind('pusher:subscription_succeeded', () => {
                if (this.onConnectionCallback) {
                    this.onConnectionCallback(true);
                }
            });

            this.channel.bind('pusher:subscription_error', (error) => {

            });

            this.channel.bind('frame', (data) => {
                this.handleMessage(data);
            });

        } catch (error) {

        }
    }

    /**
     * Load Pusher script dynamically
     */
    loadPusherScript() {
        return new Promise((resolve, reject) => {
            if (window.Pusher) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://js.pusher.com/8.2.0/pusher.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Start streaming frames
     */
    async startStreaming() {
        this.isStreaming = true;
        await this.connect();
    }

    /**
     * Stop streaming frames
     */
    stopStreaming() {
        this.isStreaming = false;
    }

    /**
     * Start receiving frames
     */
    async startReceiving(onFrame) {
        this.isReceiving = true;
        this.onFrameCallback = onFrame;
        await this.connect();
    }

    /**
     * Stop receiving frames
     */
    stopReceiving() {
        this.isReceiving = false;
    }

    /**
     * Handle incoming messages
     */
    handleMessage(data) {
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

            // Decode base64 image data
            if (data.imageDataB64) {
                const imageData = this.decodeImageData(
                    data.imageDataB64,
                    data.width,
                    data.height
                );

                if (this.onFrameCallback) {
                    this.onFrameCallback(imageData, data.metadata);
                }
            }
        }
    }

    /**
     * Send frame from canvas
     */
    sendFrameFromCanvas(canvas) {
        if (!this.isStreaming || !this.connection) return;

        // Throttle frame rate
        const now = performance.now();
        if (now - this.lastFrameTime < this.minFrameInterval) {
            return;
        }
        this.lastFrameTime = now;

        try {
            // Convert canvas to base64
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64 = dataUrl.split(',')[1];

            const message = {
                type: 'frame',
                imageDataB64: base64,
                width: canvas.width,
                height: canvas.height,
                metadata: {
                    timestamp: Date.now(),
                    frame_number: this.framesSent
                }
            };

            this.send(message);
            this.framesSent++;

        } catch (error) {

        }
    }

    /**
     * Send message through connection
     */
    send(data) {
        if (this.usePusher && this.channel) {
            // For Pusher, we need to use HTTP API to send events
            // This requires server-side implementation
        } else if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(data));
        }
    }

    /**
     * Decode base64 image data
     */
    decodeImageData(base64, width, height) {
        // Create a temporary image element
        const img = new Image();
        img.src = 'data:image/jpeg;base64,' + base64;

        // Create canvas to decode
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        img.onload = () => {
            ctx.drawImage(img, 0, 0, width, height);
        };

        return canvas;
    }

    /**
     * Set connection callback
     */
    onConnection(callback) {
        this.onConnectionCallback = callback;
    }

    /**
     * Set target FPS
     */
    setTargetFPS(fps) {
        this.targetFps = Math.max(1, Math.min(60, fps));
        this.minFrameInterval = 1000 / this.targetFps;
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            connected: this.connection?.readyState === WebSocket.OPEN,
            streaming: this.isStreaming,
            receiving: this.isReceiving,
            framesSent: this.framesSent,
            framesReceived: this.framesReceived,
            fps: this.fps.toFixed(1),
            targetFps: this.targetFps
        };
    }

    /**
     * Close connection
     */
    close() {
        if (this.connection) {
            this.stopStreaming();
            this.stopReceiving();

            if (this.usePusher) {
                this.connection.disconnect();
            } else {
                this.connection.close();
            }

            this.connection = null;
        }
    }
}

export default VercelFrameStream;
