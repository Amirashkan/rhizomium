/**
<<<<<<< HEAD
 * BrowserAudioCapture.js
 *
 * Captures audio from uploaded files and extracts envelope
 * No server, no installation, no permissions required
 *
 * Usage:
 * 1. User uploads an audio file (MP3, WAV, OGG, etc.)
 * 2. Audio plays in browser
 * 3. Real-time envelope extraction controls shader parameters
 */

export class BrowserAudioCapture {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.audioElement = null;
        this.source = null;
        this.filter = null;
        this.isPlaying = false;

        // Multi-band envelope values
        this._envelopeValue = 0.0;      // Current (based on config.frequency.mode)
        this._envelopeBass = 0.0;       // Bass (20-250 Hz)
        this._envelopeMids = 0.0;       // Mids (250-2000 Hz)
        this._envelopeHighs = 0.0;      // Highs (2000-20000 Hz)
        this._envelopeFull = 0.0;       // Full spectrum

        this._followerValue = 0.0;
        this._lastUpdateTime = performance.now();

        // ADSR state (shared for now, could be per-band if needed)
        this._adsrPhase = 'idle'; // idle, attack, decay, sustain, release
        this._adsrValue = 0.0;

        // Configuration
        this.config = {
            follower: {
                attack_ms: 50,
                release_ms: 200,
                threshold: 0.1
            },
            adsr: {
                attack_ms: 120,
                decay_ms: 180,
                sustain: 0.7,
                release_ms: 600
            },
            shaping: {
                curve: 'exp', // 'linear', 'exp', 'sigmoid'
                normalize: true,
                normDecay: 0.999
            },
            frequency: {
                mode: 'fullband', // 'fullband', 'bass', 'mids', 'highs', 'custom'
                customMin: 60,    // Hz
                customMax: 250    // Hz
            }
        };

        // Normalization
        this._peak = 0.000001;

        // Event listeners
        this.listeners = {
            started: [],
            stopped: [],
            loaded: [],
            value: [],
            error: []
        };

        // Start processing loop
        this._startProcessingLoop();
    }

    /**
     * Load audio from file
     */
    async loadFile(file) {
        try {

            // Stop current audio if any
            this.stop();

            // Create audio element if needed
            if (!this.audioElement) {
                this.audioElement = new Audio();
                this.audioElement.crossOrigin = 'anonymous';
                this.audioElement.loop = true; // Loop by default
            }

            // Load file
            const url = URL.createObjectURL(file);
            this.audioElement.src = url;

            // Wait for metadata
            await new Promise((resolve, reject) => {
                this.audioElement.onloadedmetadata = resolve;
                this.audioElement.onerror = reject;
            });

            // Create audio context if needed
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Create analyser
            if (!this.analyser) {
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.3;
            }

            // Create source and connect
            if (this.source) {
                this.source.disconnect();
            }
            this.source = this.audioContext.createMediaElementSource(this.audioElement);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination); // So we can hear it

            this._emit('loaded', file.name);

        } catch (error) {

            this._emit('error', error);
            throw error;
        }
    }

    /**
     * Start playing audio
     */
    async play() {
        if (!this.audioElement) {
            throw new Error('No audio file loaded');
        }

        try {
            await this.audioElement.play();
            this.isPlaying = true;
            this._emit('started');
        } catch (error) {

            this._emit('error', error);
            throw error;
        }
    }

    /**
     * Pause audio
     */
    pause() {
        if (this.audioElement) {
            this.audioElement.pause();
            this.isPlaying = false;
            this._emit('stopped');
        }
    }

    /**
     * Stop audio and cleanup
     */
    stop() {
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
            this.isPlaying = false;
        }

        this._followerValue = 0;
        this._adsrValue = 0;
        this._adsrPhase = 'idle';
        this._envelopeValue = 0;

        this._emit('stopped');
    }

    /**
     * Get current envelope value
     */
    getValue() {
        return this._envelopeValue;
    }

    /**
     * Check if audio is playing
     */
    getIsPlaying() {
        return this.isPlaying;
    }

    /**
     * Update configuration
     */
    updateConfig(config) {
        if (config.follower) {
            Object.assign(this.config.follower, config.follower);
        }
        if (config.adsr) {
            Object.assign(this.config.adsr, config.adsr);
        }
        if (config.shaping) {
            Object.assign(this.config.shaping, config.shaping);
        }
        if (config.frequency) {
            Object.assign(this.config.frequency, config.frequency);
        }
    }

    /**
     * Get RMS for a specific frequency band from FFT data
     */
    _getFrequencyBandRMS(mode = null) {
        if (!this.analyser) return 0;

        // Use provided mode or fall back to config
        const bandMode = mode || this.config.frequency.mode;

        // For fullband, use time-domain RMS (faster, no FFT needed)
        if (bandMode === 'fullband') {
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);
            this.analyser.getFloatTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            return Math.sqrt(sum / bufferLength);
        }

        // For frequency-specific bands, use FFT
        const bufferLength = this.analyser.frequencyBinCount;
        const frequencyData = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(frequencyData);

        // Sample rate and nyquist frequency
        const sampleRate = this.audioContext.sampleRate;
        const nyquist = sampleRate / 2;
        const binWidth = nyquist / bufferLength;

        // Determine frequency range based on mode
        let minFreq, maxFreq;
        switch (bandMode) {
            case 'bass':
                minFreq = 20;
                maxFreq = 250;
                break;
            case 'mids':
                minFreq = 250;
                maxFreq = 2000;
                break;
            case 'highs':
                minFreq = 2000;
                maxFreq = 20000;
                break;
            case 'custom':
                minFreq = this.config.frequency.customMin;
                maxFreq = this.config.frequency.customMax;
                break;
            default:
                minFreq = 0;
                maxFreq = nyquist;
        }

        // Convert frequency range to bin indices
        const startBin = Math.floor(minFreq / binWidth);
        const endBin = Math.ceil(maxFreq / binWidth);

        // Calculate RMS for the frequency band
        let sum = 0;
        let count = 0;
        for (let i = startBin; i < endBin && i < bufferLength; i++) {
            const normalized = frequencyData[i] / 255.0; // Normalize to 0-1
            sum += normalized * normalized;
            count++;
        }

        return count > 0 ? Math.sqrt(sum / count) : 0;
    }

    /**
     * Process audio and update envelope
     */
    _processAudio() {
        if (!this.isPlaying || !this.analyser) {
            // Decay envelope when not playing
            const now = performance.now();
            const dt = (now - this._lastUpdateTime) / 1000;
            this._lastUpdateTime = now;

            this._updateFollower(0, dt);
            this._updateADSR(false, dt);

            let raw = this._adsrValue * this._followerValue;
            if (this.config.shaping.normalize && this._peak > 0.000001) {
                this._peak *= this.config.shaping.normDecay;
                raw = raw / this._peak;
            }
            raw = this._applyShaping(raw);
            this._envelopeValue = Math.max(0, Math.min(1, raw));

            // Expose globally for GPU shader access
            window._audioEnvelopeValue = this._envelopeValue;

            return;
        }

        // Calculate RMS for all frequency bands
        const rmsBass = this._getFrequencyBandRMS('bass');
        const rmsMids = this._getFrequencyBandRMS('mids');
        const rmsHighs = this._getFrequencyBandRMS('highs');
        const rmsFull = this._getFrequencyBandRMS('fullband');

        // Current RMS based on config (for backwards compatibility)
        const rms = this._getFrequencyBandRMS();

        // Time delta
        const now = performance.now();
        const dt = (now - this._lastUpdateTime) / 1000; // Convert to seconds
        this._lastUpdateTime = now;

        // Follower (AR envelope) - using current config band
        this._updateFollower(rms, dt);

        // Gate via threshold
        const gate = this._followerValue > this.config.follower.threshold;

        // ADSR
        this._updateADSR(gate, dt);

        // Process envelope for each band (using simpler approach without gating)
        const processEnvelope = (rmsValue) => {
            // Scale up RMS for better range
            let raw = rmsValue * 3.0;

            // Apply exponential shaping for better response
            raw = this._applyShaping(raw);

            // Clamp to 0-1
            return Math.max(0, Math.min(1, raw));
        };

        // Update all band envelopes with smooth values
        this._envelopeBass = processEnvelope(rmsBass);
        this._envelopeMids = processEnvelope(rmsMids);
        this._envelopeHighs = processEnvelope(rmsHighs);
        this._envelopeFull = processEnvelope(rmsFull);

        // Current envelope uses full follower+ADSR processing (backwards compatibility)
        let raw = this._adsrValue * this._followerValue;
        if (this.config.shaping.normalize) {
            this._peak = Math.max(raw, this._peak * this.config.shaping.normDecay);
            if (this._peak > 0.000001) {
                raw = raw / this._peak;
            }
        }
        raw = this._applyShaping(raw);
        this._envelopeValue = Math.max(0, Math.min(1, raw));

        // Expose all globally for GPU shader access
        window._audioEnvelopeValue = this._envelopeValue;
        window._audioEnvelopeBass = this._envelopeBass;
        window._audioEnvelopeMids = this._envelopeMids;
        window._audioEnvelopeHighs = this._envelopeHighs;
        window._audioEnvelopeFull = this._envelopeFull;

        // Debug logging (every 1 second)
        if (!this._lastDebugLog || performance.now() - this._lastDebugLog > 1000) {
                main: this._envelopeValue.toFixed(3),
                bass: this._envelopeBass.toFixed(3),
                mids: this._envelopeMids.toFixed(3),
                highs: this._envelopeHighs.toFixed(3),
                full: this._envelopeFull.toFixed(3)
            });
            this._lastDebugLog = performance.now();
        }

        // Emit value update
        this._emit('value', this._envelopeValue);
    }

    /**
     * Update follower (AR envelope)
     */
    _updateFollower(rms, dt) {
        const cfg = this.config.follower;
        const attackSec = cfg.attack_ms / 1000;
        const releaseSec = cfg.release_ms / 1000;

        const attackCoeff = attackSec === 0 ? 0 : Math.pow(0.01, dt / attackSec);
        const releaseCoeff = releaseSec === 0 ? 0 : Math.pow(0.01, dt / releaseSec);

        if (rms > this._followerValue) {
            this._followerValue = (1 - attackCoeff) * rms + attackCoeff * this._followerValue;
        } else {
            this._followerValue = (1 - releaseCoeff) * rms + releaseCoeff * this._followerValue;
        }
    }

    /**
     * Update ADSR envelope
     */
    _updateADSR(gate, dt) {
        const cfg = this.config.adsr;

        // State transitions
        if (gate) {
            if (this._adsrPhase === 'idle' || this._adsrPhase === 'release') {
                this._adsrPhase = 'attack';
            }
        } else {
            if (this._adsrPhase !== 'idle') {
                this._adsrPhase = 'release';
            }
        }

        // Process current phase
        switch (this._adsrPhase) {
            case 'attack': {
                const attackSec = cfg.attack_ms / 1000;
                if (attackSec === 0) {
                    this._adsrValue = 1.0;
                    this._adsrPhase = 'decay';
                } else {
                    this._adsrValue += dt / attackSec;
                    if (this._adsrValue >= 1.0) {
                        this._adsrValue = 1.0;
                        this._adsrPhase = 'decay';
                    }
                }
                break;
            }

            case 'decay': {
                const decaySec = cfg.decay_ms / 1000;
                const target = Math.max(0, Math.min(1, cfg.sustain));
                if (decaySec === 0) {
                    this._adsrValue = target;
                    this._adsrPhase = 'sustain';
                } else {
                    this._adsrValue += (target - this._adsrValue) * Math.min(dt / decaySec, 1);
                    if (Math.abs(this._adsrValue - target) < 0.0001) {
                        this._adsrValue = target;
                        this._adsrPhase = 'sustain';
                    }
                }
                break;
            }

            case 'sustain':
                // Hold at sustain level
                break;

            case 'release': {
                const releaseSec = cfg.release_ms / 1000;
                if (releaseSec === 0) {
                    this._adsrValue = 0;
                    this._adsrPhase = 'idle';
                } else {
                    this._adsrValue += (0 - this._adsrValue) * Math.min(dt / releaseSec, 1);
                    if (this._adsrValue <= 0.0001) {
                        this._adsrValue = 0;
                        this._adsrPhase = 'idle';
                    }
                }
                break;
            }

            case 'idle':
                this._adsrValue = 0;
                break;
        }
    }

    /**
     * Apply output shaping curve
     */
    _applyShaping(value) {
        value = Math.max(0, Math.min(1, value));

        switch (this.config.shaping.curve) {
            case 'linear':
                return value;

            case 'sigmoid':
                // Smoothstep
                return value * value * (3 - 2 * value);

            case 'exp':
            default:
                return Math.pow(value, 0.5);
        }
    }

    /**
     * Start processing loop
     */
    _startProcessingLoop() {
        let lastShaderRebuildValue = 0;
        const REBUILD_THRESHOLD = 0.05; // Rebuild if value changes by more than 5%
        let lastRebuildTime = 0;
        const MIN_REBUILD_INTERVAL = 50; // Min 50ms between rebuilds (~20fps max)

        const processFrame = () => {
            this._processAudio();

            // TEMPORARILY DISABLED: Auto-rebuild causing infinite loop
            // TODO: Need to fix rebuild triggering preview which triggers rebuild
            // if (this.isPlaying && typeof window.rebuild === 'function') {
            //     const now = performance.now();
            //     const valueDelta = Math.abs(this._envelopeValue - lastShaderRebuildValue);

            //     if (valueDelta > REBUILD_THRESHOLD && now - lastRebuildTime >= MIN_REBUILD_INTERVAL) {
            //         // Only rebuild if there are nodes using audioEnvelope expressions
            //         const hasAudioExpressions = window.editor?.graph?.nodes?.some(node =>
            //             node.params && Object.values(node.params).some(val =>
            //                 typeof val === 'string' && val.includes('audioEnvelope')
            //             )
            //         );

            //         if (hasAudioExpressions) {
            //             window.rebuild();
            //             lastShaderRebuildValue = this._envelopeValue;
            //             lastRebuildTime = now;
            //         }
            //     }
            // }

            requestAnimationFrame(processFrame);
        };
        processFrame();
    }

    /**
     * Add event listener
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    /**
     * Remove event listener
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
     * Emit event
     */
    _emit(event, ...args) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {

                }
            });
        }
    }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton BrowserAudioCapture instance
 */
export function getBrowserAudioCapture() {
    if (!instance) {
        try {
            instance = new BrowserAudioCapture();
        } catch (error) {

            throw error;
        }
    }
    return instance;
}

/**
 * Get the current audio envelope value (convenience function)
 */
export function getAudioEnvelope() {
    if (!instance) {
        instance = new BrowserAudioCapture();
    }
    const value = instance.getValue();
    return value;
}

export default BrowserAudioCapture;
