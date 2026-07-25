/**
 * AudioEnvelopeClient.js
 *
 * WebSocket client for receiving real-time audio envelope values from the audio server.
 * Provides a singleton instance that can be accessed throughout the application.
 */

class AudioEnvelopeClient {
    constructor(serverUrl = 'ws://localhost:8765/ws') {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.maxReconnectDelay = 30000; // Max 30 seconds

        // Current envelope value (thread-safe access)
        this._envelopeValue = 0.0;
        this._lastUpdateTime = 0;

        // Event listeners
        this.listeners = {
            connected: [],
            disconnected: [],
            value: [],
            error: []
        };

        // Auto-connect on instantiation
        this.connect();
    }

    /**
     * Connect to the WebSocket server
     */
    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        try {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                this.connected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                this._emit('connected');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'envelope') {
                        this._envelopeValue = data.value;
                        this._lastUpdateTime = performance.now();
                        this._emit('value', data.value);
                    } else if (data.type === 'pong') {
                        // Handle pong response
                    }
                } catch {

                }
            };

            this.ws.onerror = (error) => {

                this._emit('error', error);
            };

            this.ws.onclose = () => {
                this.connected = false;
                this._emit('disconnected');
                this._scheduleReconnect();
            };

        } catch (error) {

            this._emit('error', error);
            this._scheduleReconnect();
        }
    }

    /**
     * Schedule automatic reconnection
     */
    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);


        setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
        if (this.ws) {
            this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Get the current envelope value
     * @returns {number} Current envelope value (0.0 - 1.0)
     */
    getValue() {
        return this._envelopeValue;
    }

    /**
     * Get the time since last update
     * @returns {number} Time in milliseconds
     */
    getTimeSinceUpdate() {
        return performance.now() - this._lastUpdateTime;
    }

    /**
     * Check if client is connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Send a ping to the server
     */
    ping() {
        if (this.isConnected()) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
        }
    }

    /**
     * Add event listener
     * @param {string} event - Event name: 'connected', 'disconnected', 'value', 'error'
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
     */
    off(event, callback) {
        if (this.listeners[event]) {
            const index = this.listeners[event].indexOf(callback);
            if (index > -1) {
                this.listeners[event].splice(index, 1);
            }
        }
    }

    /**
     * Emit event to all listeners
     * @private
     */
    _emit(event, ...args) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(...args);
                } catch {

                }
            });
        }
    }

    /**
     * Update server configuration
     * @param {Object} config - Configuration object
     */
    async updateConfig(config) {
        const response = await fetch(`http://localhost:8765/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result;
    }

    /**
     * Get server status
     */
    async getStatus() {
        const response = await fetch(`http://localhost:8765/status`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton AudioEnvelopeClient instance
 * @param {string} serverUrl - Optional server URL (only used on first call)
 * @returns {AudioEnvelopeClient}
 */
export function getAudioEnvelopeClient(serverUrl) {
    if (!instance) {
        instance = new AudioEnvelopeClient(serverUrl);
    }
    return instance;
}

/**
 * Get the current audio envelope value (convenience function)
 * @returns {number}
 */
export function getAudioEnvelope() {
    if (!instance) {
        instance = new AudioEnvelopeClient();
    }
    return instance.getValue();
}

export default AudioEnvelopeClient;
