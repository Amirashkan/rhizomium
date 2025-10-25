/**
 * AudioSettingsPanel.js
 *
 * UI panel for configuring audio envelope parameters
 */

import { getAudioEnvelopeClient } from '../audio/AudioEnvelopeClient.js';

export class AudioSettingsPanel {
    constructor() {
        this.panel = null;
        this.visible = false;
        this.audioClient = getAudioEnvelopeClient();

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
            }
        };

        this.createPanel();
        this.setupEventListeners();
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
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 500;">Status:</span>
                    <span id="audio-status" style="color: #f44336;">Disconnected</span>
                </div>
                <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 500;">Value:</span>
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

            <div style="font-size: 11px; color: #666; border-top: 1px solid #444; padding-top: 12px;">
                <p style="margin: 0 0 8px 0;">
                    Use <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; color: #4CAF50;">=audioEnvelope</code> in parameter expressions
                </p>
                <p style="margin: 0;">
                    Examples:<br>
                    <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; font-size: 10px;">=audioEnvelope * 2</code><br>
                    <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; font-size: 10px;">=lerp(0.5, 2.0, audioEnvelope)</code>
                </p>
            </div>
        `;

        document.body.appendChild(this.panel);
    }

    setupEventListeners() {
        // Close button
        const closeBtn = this.panel.querySelector('#audio-close-btn');
        closeBtn.addEventListener('click', () => this.hide());

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
            this.updateServerConfig();
        });

        const normalizeCheckbox = this.panel.querySelector('#shaping-normalize');
        normalizeCheckbox.addEventListener('change', (e) => {
            this.config.shaping.normalize = e.target.checked;
            this.updateServerConfig();
        });

        // Audio client event listeners
        this.audioClient.on('connected', () => {
            const statusEl = this.panel.querySelector('#audio-status');
            statusEl.textContent = 'Connected';
            statusEl.style.color = '#4CAF50';
        });

        this.audioClient.on('disconnected', () => {
            const statusEl = this.panel.querySelector('#audio-status');
            statusEl.textContent = 'Disconnected';
            statusEl.style.color = '#f44336';
        });

        this.audioClient.on('value', (value) => {
            const valueEl = this.panel.querySelector('#audio-value');
            const valueBar = this.panel.querySelector('#audio-value-bar');
            valueEl.textContent = value.toFixed(3);
            valueBar.style.width = `${value * 100}%`;
        });

        // Update display periodically
        setInterval(() => {
            if (this.visible) {
                const value = this.audioClient.getValue();
                const valueEl = this.panel.querySelector('#audio-value');
                const valueBar = this.panel.querySelector('#audio-value-bar');
                if (valueEl && valueBar) {
                    valueEl.textContent = value.toFixed(3);
                    valueBar.style.width = `${value * 100}%`;
                }
            }
        }, 50);
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
            this.updateServerConfig();
        });
    }

    async updateServerConfig() {
        try {
            await this.audioClient.updateConfig(this.config);
            console.log('[AudioSettings] Configuration updated');
        } catch (error) {
            console.error('[AudioSettings] Failed to update configuration:', error);
        }
    }

    show() {
        this.panel.style.display = 'block';
        this.visible = true;
    }

    hide() {
        this.panel.style.display = 'none';
        this.visible = false;
    }

    toggle() {
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
        instance = new AudioSettingsPanel();
    }
    return instance;
}

export default AudioSettingsPanel;
