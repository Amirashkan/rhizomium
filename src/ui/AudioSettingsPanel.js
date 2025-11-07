/**
 * AudioSettingsPanel.js
 *
 * UI panel for configuring audio envelope parameters
 */

import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';
import { makeDraggable } from './utils/draggable.js';

export class AudioSettingsPanel {
    constructor() {
        console.log('[AudioSettingsPanel] Constructor called');
        this.panel = null;
        this.visible = false;
        this.cleanupDraggable = null;

        try {
            this.audioClient = getBrowserAudioCapture();
            console.log('[AudioSettingsPanel] audioClient created:', this.audioClient);
        } catch (error) {
            console.error('[AudioSettingsPanel] Error creating audioClient:', error);
            this.audioClient = null;
        }

        // Default configuration
        this.config = {
            follower: {
                attack_ms: 50.0,
                release_ms: 200.0,
                threshold: 0.1
            },
            adsr: {
                attack_ms: 120.0,
                decay_ms: 180.0,
                sustain: 0.7,
                release_ms: 600.0
            },
            shaping: {
                curve: 'exp',
                normalize: true
            },
            frequency: {
                mode: 'fullband',
                customMin: 60,
                customMax: 250
            }
        };

        this.createPanel();
        this.setupEventListeners();
        console.log('[AudioSettingsPanel] Panel created and attached to DOM');
    }

    createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'audio-settings-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            width: 300px;
            background: rgba(30, 30, 30, 0.95);
            border: 1px solid #555;
            border-radius: 8px;
            padding: 16px;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            display: none;
        `;

        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Audio Envelope</h3>
                <button id="audio-close-btn" style="
                    background: none;
                    border: none;
                    color: #aaa;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 0;
                    width: 24px;
                    height: 24px;
                    line-height: 24px;
                    text-align: center;
                ">&times;</button>
            </div>

            <div style="margin-bottom: 12px; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 4px;">
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Load Audio File (MP3, WAV, OGG)
                    </label>
                    <input type="file" id="audio-file-input" accept="audio/*" style="
                        width: 100%;
                        padding: 4px;
                        background: #444;
                        color: #fff;
                        border: 1px solid #666;
                        border-radius: 4px;
                        font-size: 11px;
                        cursor: pointer;
                    ">
                </div>
                <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                    <button id="audio-play-btn" style="
                        flex: 1;
                        padding: 6px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    " disabled>▶ Play</button>
                    <button id="audio-pause-btn" style="
                        flex: 1;
                        padding: 6px;
                        background: #FF9800;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    " disabled>⏸ Pause</button>
                    <button id="audio-stop-btn" style="
                        flex: 1;
                        padding: 6px;
                        background: #f44336;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    " disabled>⏹ Stop</button>
                </div>

                <!-- Time Bar -->
                <div style="margin-bottom: 12px; margin-top: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span id="audio-current-time" style="font-family: monospace; font-size: 10px; color: #888;">0:00</span>
                        <span id="audio-duration" style="font-family: monospace; font-size: 10px; color: #888;">0:00</span>
                    </div>
                    <div id="audio-progress-container" style="
                        height: 6px;
                        background: rgba(255, 255, 255, 0.15);
                        border-radius: 3px;
                        overflow: hidden;
                        cursor: pointer;
                        position: relative;
                    ">
                        <div id="audio-progress-bar" style="
                            height: 100%;
                            width: 0%;
                            background: linear-gradient(90deg, #2196F3, #4CAF50);
                            transition: width 0.1s;
                        "></div>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-weight: 500; font-size: 11px;">File:</span>
                    <span id="audio-filename" style="font-size: 10px; color: #888; font-style: italic;">No file loaded</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 500;">Envelope:</span>
                    <span id="audio-value" style="font-family: monospace; color: #4CAF50;">0.000</span>
                </div>
                <div style="margin-top: 8px;">
                    <div style="height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden;">
                        <div id="audio-value-bar" style="height: 100%; width: 0%; background: #4CAF50; transition: width 0.1s;"></div>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">Follower</h4>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Attack (ms): <span id="follower-attack-value">50</span>
                    </label>
                    <input type="range" id="follower-attack" min="0" max="200" step="1" value="50" style="width: 100%;">
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Release (ms): <span id="follower-release-value">200</span>
                    </label>
                    <input type="range" id="follower-release" min="0" max="500" step="1" value="200" style="width: 100%;">
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Threshold: <span id="follower-threshold-value">0.10</span>
                    </label>
                    <input type="range" id="follower-threshold" min="0" max="1" step="0.01" value="0.1" style="width: 100%;">
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">ADSR</h4>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Attack (ms): <span id="adsr-attack-value">120</span>
                    </label>
                    <input type="range" id="adsr-attack" min="0" max="2000" step="10" value="120" style="width: 100%;">
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Decay (ms): <span id="adsr-decay-value">180</span>
                    </label>
                    <input type="range" id="adsr-decay" min="0" max="2000" step="10" value="180" style="width: 100%;">
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Sustain: <span id="adsr-sustain-value">0.70</span>
                    </label>
                    <input type="range" id="adsr-sustain" min="0" max="1" step="0.01" value="0.7" style="width: 100%;">
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Release (ms): <span id="adsr-release-value">600</span>
                    </label>
                    <input type="range" id="adsr-release" min="0" max="3000" step="10" value="600" style="width: 100%;">
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">Shaping</h4>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Curve:
                    </label>
                    <select id="shaping-curve" style="width: 100%; padding: 4px; background: #444; color: #fff; border: 1px solid #666; border-radius: 4px;">
                        <option value="linear">Linear</option>
                        <option value="exp" selected>Exponential</option>
                        <option value="sigmoid">Sigmoid</option>
                    </select>
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: flex; align-items: center; font-size: 11px; color: #888; cursor: pointer;">
                        <input type="checkbox" id="shaping-normalize" checked style="margin-right: 8px;">
                        Auto-normalize
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #aaa;">Frequency Range</h4>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                        Band:
                    </label>
                    <select id="frequency-mode" style="width: 100%; padding: 4px; background: #444; color: #fff; border: 1px solid #666; border-radius: 4px;">
                        <option value="fullband" selected>Full Band (All Frequencies)</option>
                        <option value="bass">Bass (20-250 Hz)</option>
                        <option value="mids">Mids (250-2000 Hz)</option>
                        <option value="highs">Highs (2000-20000 Hz)</option>
                        <option value="custom">Custom Range</option>
                    </select>
                </div>
                <div id="custom-frequency-controls" style="display: none; margin-top: 8px;">
                    <div style="margin-bottom: 8px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                            Min Freq (Hz): <span id="frequency-min-value">60</span>
                        </label>
                        <input type="range" id="frequency-min" min="20" max="10000" step="10" value="60" style="width: 100%;">
                    </div>
                    <div style="margin-bottom: 8px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">
                            Max Freq (Hz): <span id="frequency-max-value">250</span>
                        </label>
                        <input type="range" id="frequency-max" min="20" max="20000" step="10" value="250" style="width: 100%;">
                    </div>
                </div>
            </div>

            <div style="font-size: 11px; color: #666; border-top: 1px solid #444; padding-top: 12px;">
                <p style="margin: 0 0 8px 0;">
                    Use <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; color: #4CAF50;">=audioEnvelope</code> in parameter expressions
                </p>
                <p style="margin: 0;">
                    Examples:<br>
                    <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; font-size: 10px;">=audioEnvelope * 2</code><br>
                    <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; font-size: 10px;">=sin(audioEnvelope * 3.14)</code>
                </p>
            </div>
        `;

        document.body.appendChild(this.panel);
        console.log('[AudioSettingsPanel] Panel appended to document.body, element:', this.panel);
        console.log('[AudioSettingsPanel] Panel initial styles - display:', this.panel.style.display, 'z-index:', this.panel.style.zIndex);

        // Make panel draggable by its header
        const header = this.panel.querySelector('div[style*="display: flex"]');
        if (header) {
            this.cleanupDraggable = makeDraggable(this.panel, header);
        }
    }

    setupEventListeners() {
        // Close button
        const closeBtn = this.panel.querySelector('#audio-close-btn');
        closeBtn.addEventListener('click', () => this.hide());

        // File input
        const fileInput = this.panel.querySelector('#audio-file-input');
        const playBtn = this.panel.querySelector('#audio-play-btn');
        const pauseBtn = this.panel.querySelector('#audio-pause-btn');
        const stopBtn = this.panel.querySelector('#audio-stop-btn');
        const filenameEl = this.panel.querySelector('#audio-filename');

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    await this.audioClient.loadFile(file);
                    filenameEl.textContent = file.name;
                    filenameEl.style.color = '#4CAF50';
                    playBtn.disabled = false;
                    pauseBtn.disabled = false;
                    stopBtn.disabled = false;
                } catch (error) {
                    console.error('Failed to load audio file:', error);
                    filenameEl.textContent = 'Error loading file';
                    filenameEl.style.color = '#f44336';
                }
            }
        });

        // Play button
        playBtn.addEventListener('click', async () => {
            try {
                await this.audioClient.play();
            } catch (error) {
                console.error('Failed to play audio:', error);
            }
        });

        // Pause button
        pauseBtn.addEventListener('click', () => {
            this.audioClient.pause();
        });

        // Stop button
        stopBtn.addEventListener('click', () => {
            this.audioClient.stop();
        });

        // Follower controls
        this.setupSlider('follower-attack', 'follower.attack_ms', (val) => val);
        this.setupSlider('follower-release', 'follower.release_ms', (val) => val);
        this.setupSlider('follower-threshold', 'follower.threshold', (val) => parseFloat(val).toFixed(2));

        // ADSR controls
        this.setupSlider('adsr-attack', 'adsr.attack_ms', (val) => val);
        this.setupSlider('adsr-decay', 'adsr.decay_ms', (val) => val);
        this.setupSlider('adsr-sustain', 'adsr.sustain', (val) => parseFloat(val).toFixed(2));
        this.setupSlider('adsr-release', 'adsr.release_ms', (val) => val);

        // Shaping controls
        const curveSelect = this.panel.querySelector('#shaping-curve');
        curveSelect.addEventListener('change', (e) => {
            this.config.shaping.curve = e.target.value;
            this.audioClient.updateConfig(this.config);
        });

        const normalizeCheckbox = this.panel.querySelector('#shaping-normalize');
        normalizeCheckbox.addEventListener('change', (e) => {
            this.config.shaping.normalize = e.target.checked;
            this.audioClient.updateConfig(this.config);
        });

        // Frequency controls
        const frequencyModeSelect = this.panel.querySelector('#frequency-mode');
        const customFrequencyControls = this.panel.querySelector('#custom-frequency-controls');

        frequencyModeSelect.addEventListener('change', (e) => {
            this.config.frequency.mode = e.target.value;

            // Show/hide custom controls
            if (e.target.value === 'custom') {
                customFrequencyControls.style.display = 'block';
            } else {
                customFrequencyControls.style.display = 'none';
            }

            this.audioClient.updateConfig(this.config);
        });

        this.setupSlider('frequency-min', 'frequency.customMin', (val) => val);
        this.setupSlider('frequency-max', 'frequency.customMax', (val) => val);

        // Time bar seeking
        const progressContainer = this.panel.querySelector('#audio-progress-container');
        progressContainer.addEventListener('click', (e) => {
            const audioElement = this.audioClient.audioElement;
            if (!audioElement || !audioElement.duration) return;

            const rect = progressContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;
            const seekTime = percentage * audioElement.duration;

            audioElement.currentTime = seekTime;
        });

        // Update display periodically
        setInterval(() => {
            if (this.visible) {
                // Update envelope value
                const value = this.audioClient.getValue();
                const valueEl = this.panel.querySelector('#audio-value');
                const valueBar = this.panel.querySelector('#audio-value-bar');
                if (valueEl && valueBar) {
                    valueEl.textContent = value.toFixed(3);
                    valueBar.style.width = `${value * 100}%`;
                }

                // Update time bar
                const audioElement = this.audioClient.audioElement;
                if (audioElement) {
                    const currentTime = audioElement.currentTime || 0;
                    const duration = audioElement.duration || 0;

                    const currentTimeEl = this.panel.querySelector('#audio-current-time');
                    const durationEl = this.panel.querySelector('#audio-duration');
                    const progressBar = this.panel.querySelector('#audio-progress-bar');

                    if (currentTimeEl) {
                        currentTimeEl.textContent = this.formatTime(currentTime);
                    }
                    if (durationEl && isFinite(duration)) {
                        durationEl.textContent = this.formatTime(duration);
                    }
                    if (progressBar && isFinite(duration) && duration > 0) {
                        const percentage = (currentTime / duration) * 100;
                        progressBar.style.width = `${percentage}%`;
                    }
                }
            }
        }, 50);
    }

    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    setupSlider(sliderId, configPath, formatFn) {
        const slider = this.panel.querySelector(`#${sliderId}`);
        const valueDisplay = this.panel.querySelector(`#${sliderId}-value`);

        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            const formatted = formatFn(value);
            valueDisplay.textContent = formatted;

            // Update config
            const parts = configPath.split('.');
            this.config[parts[0]][parts[1]] = value;
        });

        slider.addEventListener('change', () => {
            this.audioClient.updateConfig(this.config);
            console.log('[AudioSettings] Configuration updated');
        });
    }

    show() {
        console.log('[AudioSettingsPanel] show() called');
        if (this.panel) {
            this.panel.style.display = 'block';
            this.visible = true;
            console.log('[AudioSettingsPanel] Panel shown, display:', this.panel.style.display);
        } else {
            console.error('[AudioSettingsPanel] show() called but panel is null!');
        }
    }

    hide() {
        console.log('[AudioSettingsPanel] hide() called');
        if (this.panel) {
            this.panel.style.display = 'none';
            this.visible = false;
        }
    }

    toggle() {
        console.log('[AudioSettingsPanel] toggle() called, current visible:', this.visible);
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// Create singleton instance
let instance = null;

export function getAudioSettingsPanel() {
    if (!instance) {
        try {
            console.log('[getAudioSettingsPanel] Creating new AudioSettingsPanel instance');
            instance = new AudioSettingsPanel();
            console.log('[getAudioSettingsPanel] Instance created successfully:', instance);
        } catch (error) {
            console.error('[getAudioSettingsPanel] Failed to create AudioSettingsPanel:', error);
            throw error; // Re-throw so caller knows it failed
        }
    }
    return instance;
}

export default AudioSettingsPanel;
