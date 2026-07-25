/**
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

import { PRIORITY } from '../core/UnifiedRAFManager.js';
import { RealtimeAudioAnalysis } from './RealtimeAudioAnalysis.js';

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
            },
            // Envelope shaping for the real-time band meters (RealtimeAudioAnalysis).
            analysis: {
                attack_ms: 8,
                release_ms: 120,
                gain: 1
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

        // Handler name for UnifiedRAFManager
        this._handlerName = 'browserAudioCapture';

        // Register with UnifiedRAFManager - handler will be enabled/disabled based on isPlaying
        this._registerRAFHandler();
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

            // Load file (revoke previous object URL to avoid leaking memory)
            if (this._objectUrl) {
                URL.revokeObjectURL(this._objectUrl);
            }
            this._objectUrl = URL.createObjectURL(file);
            this.audioElement.src = this._objectUrl;

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

            // Second analyser dedicated to onset (kick) detection. Spectral flux measures the
            // frame-to-frame CHANGE in the spectrum, so the main analyser's 0.3 smoothing — good
            // for a stable envelope — would blur away exactly the transients flux keys on. This
            // one runs unsmoothed; fftSize 2048 gives ~21 Hz bins, enough to resolve the kick band.
            if (!this._fluxAnalyser) {
                this._fluxAnalyser = this.audioContext.createAnalyser();
                this._fluxAnalyser.fftSize = 2048;
                this._fluxAnalyser.smoothingTimeConstant = 0;
            }

            // Create source and connect.
            // createMediaElementSource() can only be called once per media element
            // for its entire lifetime, so reuse the existing source node on
            // subsequent loads — it keeps following the element's current src.
            if (!this.source) {
                this.source = this.audioContext.createMediaElementSource(this.audioElement);
                this.source.connect(this.analyser);
                this.source.connect(this._fluxAnalyser);
                this.analyser.connect(this.audioContext.destination); // So we can hear it
            }

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
            // Ensure the per-frame handler is registered (the constructor's attempt is a no-op if the
            // singleton was created before window.renderLoop existed — e.g. by the preview system),
            // then enable it. Without this the envelope never advances and the value freezes.
            this._registerRAFHandler();
            this._enableRAFHandler();
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
            // Disable RAF handler when paused
            this._disableRAFHandler();
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

        // Disable RAF handler when stopped
        this._disableRAFHandler();

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
        if (config.analysis) {
            if (!this.config.analysis) this.config.analysis = {};
            Object.assign(this.config.analysis, config.analysis);
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
        const [minFreq, maxFreq] = this._bandRange(bandMode, nyquist);

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
     * Frequency range (Hz) for a band mode, for the LEVEL envelope.
     */
    _bandRange(bandMode, nyquist) {
        switch (bandMode) {
            case 'bass': return [20, 250];
            case 'mids': return [250, 2000];
            case 'highs': return [2000, 20000];
            case 'custom': return [this.config.frequency.customMin, this.config.frequency.customMax];
            default: return [0, nyquist];
        }
    }

    /**
     * Frequency range (Hz) for a band mode, for ONSET DETECTION — deliberately not the same as the
     * level ranges above.
     *
     * "Bass" is narrowed to the kick's fundamental (30-120 Hz) rather than the full 20-250 Hz low
     * band. Measured on real audio, a snare's onset flux in 20-250 Hz is comparable to a kick's
     * (its body sits around 200 Hz and its noise burst covers the rest), so a detector watching
     * that range fires on the backbeat no matter how its threshold is set. Restricting to the
     * kick's fundamental roughly doubles the kick-to-snare contrast.
     *
     * The level envelope keeps the wider range: as a continuous modulation value it wants the whole
     * low end, and narrowing it would change what every existing patch's `level` output does.
     */
    _onsetBandRange(bandMode, nyquist) {
        switch (bandMode) {
            case 'bass': return [30, 120];
            case 'mids': return [250, 2000];
            case 'highs': return [2000, 16000];
            case 'custom': return [this.config.frequency.customMin, this.config.frequency.customMax];
            default: return [0, nyquist];
        }
    }

    /**
     * Run one frame of the real-time analysis and publish the results.
     *
     * Replaces the spectral-flux onset signal this used to compute. That measured how much the
     * spectrum CHANGED, which is a fine onset feature but produced an unbounded number with no
     * natural scale, so the threshold compared against it could not be aimed at anything. The
     * engine here produces bounded 0..1 meters per band instead, which a threshold can sit in
     * visibly — see RealtimeAudioAnalysis for why that split matters.
     */
    _runRealtimeAnalysis(dt) {
        if (!this._analysis) this._analysis = new RealtimeAudioAnalysis();
        if (!this._fluxAnalyser) return;
        this._analysis.setSampleRate(this.audioContext.sampleRate);
        const a = this._analysis.process(this._fluxAnalyser, dt, {
            attackMs: this.config.analysis?.attack_ms ?? 8,
            releaseMs: this.config.analysis?.release_ms ?? 120,
            gain: this.config.analysis?.gain ?? 1,
        });
        this._publishAnalysis(a);
    }

    /** Expose the frame's analysis on window, where the node processor and shaders read it. */
    _publishAnalysis(a) {
        if (typeof window === 'undefined') return;
        window._audioBands = a;
    }

    /** Everything reads zero while nothing is playing. */
    _publishSilentAnalysis() {
        if (typeof window === 'undefined') return;
        if (this._analysis) this._analysis.reset();
        window._audioBands = {
            level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
            centroid: 0, density: 0,
            presence: { low: false, mid: false, high: false, kick: false, snare: false, hat: false },
        };
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

            // No playback -> every meter reads zero, and the followers reset so the next track
            // does not inherit this one's scaling.
            this._publishSilentAnalysis();

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

        // Real-time band meters for the Audio Analysis node (see RealtimeAudioAnalysis).
        this._runRealtimeAnalysis(dt);

        // Expose all globally for GPU shader access
        window._audioEnvelopeValue = this._envelopeValue;
        window._audioEnvelopeBass = this._envelopeBass;
        window._audioEnvelopeMids = this._envelopeMids;
        window._audioEnvelopeHighs = this._envelopeHighs;
        window._audioEnvelopeFull = this._envelopeFull;

        // Debug logging (every 1 second)
        if (!this._lastDebugLog || performance.now() - this._lastDebugLog > 1000) {
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
     * Register handler with UnifiedRAFManager
     * Uses LOW priority since audio processing is less critical than rendering
     */
    /**
     * Advance the envelope one frame. Safe to call from any per-frame driver — both the unified RAF
     * handler and the AudioAnalysisProcessor call it — because it de-dupes: two calls in the same
     * frame process only once (whichever runs first wins; the second is a no-op). This lets the node
     * processor keep the envelope live even when the RAF handler failed to register.
     */
    tick() {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - (this._lastTickAt || 0) < 4) return;
        this._lastTickAt = now;
        this._processAudio();
    }

    _registerRAFHandler() {
        // Register handler with UnifiedRAFManager to use unified RAF loop
        // This consolidates all RAF-based updates into a single loop for better performance.
        // Idempotent: only registers once, and only once window.renderLoop exists.
        if (this._rafRegistered) return;
        if (window.renderLoop?.rafManager) {
            window.renderLoop.rafManager.registerHandler(
                this._handlerName,
                (frameInfo) => {
                    // Process audio - this will handle both playing and non-playing states
                    this.tick();
                },
                PRIORITY.LOW,
                {
                    // Condition: only execute if audio is playing and render loop is not paused
                    condition: (frameInfo) => {
                        return this.isPlaying && !frameInfo.paused;
                    },
                    enabled: false, // Start disabled, will be enabled when playing starts
                }
            );
            this._rafRegistered = true;
        }
    }

    /**
     * Enable RAF handler (when audio starts playing)
     */
    _enableRAFHandler() {
        if (window.renderLoop?.rafManager) {
            window.renderLoop.rafManager.setHandlerEnabled(this._handlerName, true);
        }
    }

    /**
     * Disable RAF handler (when audio pauses/stops)
     */
    _disableRAFHandler() {
        if (window.renderLoop?.rafManager) {
            window.renderLoop.rafManager.setHandlerEnabled(this._handlerName, false);
        }
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
        instance = new BrowserAudioCapture();
        // Expose the singleton so the render loop's graphIsAnimated check
        // (window.audioCapture?.getIsPlaying?.()) can see playback and avoid reusing a stale
        // GPU frame during canvas interaction while audio-reactive nodes should keep moving.
        if (typeof window !== 'undefined') window.audioCapture = instance;
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
