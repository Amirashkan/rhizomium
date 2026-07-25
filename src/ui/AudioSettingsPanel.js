/**
 * AudioSettingsPanel.js
 *
 * UI panel for configuring audio envelope parameters
 */

import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';
import { makeDraggable } from './utils/draggable.js';

export class AudioSettingsPanel {
    constructor() {

        this.panel = null;
        this.visible = false;
        this.cleanupDraggable = null;

        try {
            this.audioClient = getBrowserAudioCapture();

        } catch (error) {

            this.audioClient = null;
        }

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

            <div style="font-size: 11px; color: #666; border-top: 1px solid #444; padding-top: 12px;">
                <p style="margin: 0 0 8px 0;">
                    Use <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; color: #4CAF50;">=audioEnvelope</code> in parameter expressions, or add an <strong>Audio Analysis</strong> node for kick / onset detection.
                </p>
                <p style="margin: 0;">
                    Examples:<br>
                    <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; font-size: 10px;">=audioEnvelope * 2</code><br>
                    <code style="background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 2px; font-size: 10px;">=sin(audioEnvelope * 3.14)</code>
                </p>
            </div>
        `;

        document.body.appendChild(this.panel);


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

    show() {
        if (this.panel) {
            this.panel.style.display = 'block';
            this.visible = true;

        }
    }

    hide() {
        if (this.panel) {
            this.panel.style.display = 'none';
            this.visible = false;
        }
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
