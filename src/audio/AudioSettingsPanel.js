/**
 * AudioSettingsPanel.js - UI panel for audio file upload and playback
 * Uses BrowserAudioCapture with proper cleanup to avoid connection errors
 */

import { BrowserAudioCapture } from './BrowserAudioCapture.js';

export class AudioSettingsPanel {
  constructor(containerElement) {
    this.container = containerElement;
    this.audioCapture = new BrowserAudioCapture();
    this.panelElement = null;
    this.isPlaying = false;

    this.createPanel();
  }

  createPanel() {
    this.panelElement = document.createElement('div');
    this.panelElement.className = 'audio-settings-panel';
    this.panelElement.style.cssText = `
      padding: 16px;
      background: rgba(0, 0, 0, 0.8);
      border-radius: 8px;
      color: white;
      font-family: sans-serif;
    `;

    this.panelElement.innerHTML = `
      <h3 style="margin: 0 0 12px 0; font-size: 14px;">Audio Settings</h3>

      <div class="audio-file-input" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px; font-size: 12px;">
          Audio File:
        </label>
        <input
          type="file"
          accept="audio/*"
          style="
            display: block;
            padding: 8px;
            border: 1px solid #444;
            border-radius: 4px;
            background: #222;
            color: white;
            font-size: 12px;
            width: 100%;
            box-sizing: border-box;
          "
        />
        <div class="audio-status" style="
          margin-top: 4px;
          font-size: 11px;
          color: #888;
          min-height: 16px;
        "></div>
      </div>

      <div class="audio-controls" style="margin-bottom: 12px; display: none;">
        <button class="btn-play" style="
          padding: 6px 12px;
          margin-right: 4px;
          background: #4a90e2;
          border: none;
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 12px;
        ">Play</button>

        <button class="btn-pause" style="
          padding: 6px 12px;
          margin-right: 4px;
          background: #666;
          border: none;
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 12px;
        ">Pause</button>

        <button class="btn-stop" style="
          padding: 6px 12px;
          background: #d9534f;
          border: none;
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 12px;
        ">Stop</button>
      </div>

      <div class="audio-volume" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px; font-size: 12px;">
          Volume: <span class="volume-value">100</span>%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value="100"
          class="volume-slider"
          style="width: 100%;"
        />
      </div>

      <canvas class="audio-visualizer" width="300" height="100" style="
        width: 100%;
        height: 100px;
        background: #000;
        border-radius: 4px;
        display: none;
      "></canvas>
    `;

    if (this.container) {
      this.container.appendChild(this.panelElement);
    }

    this.attachEventListeners();
  }

  attachEventListeners() {
    const fileInput = this.panelElement.querySelector('input[type="file"]');
    const playBtn = this.panelElement.querySelector('.btn-play');
    const pauseBtn = this.panelElement.querySelector('.btn-pause');
    const stopBtn = this.panelElement.querySelector('.btn-stop');
    const volumeSlider = this.panelElement.querySelector('.volume-slider');
    const volumeValue = this.panelElement.querySelector('.volume-value');

    // File input handler - THIS IS WHERE THE FIX APPLIES
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      console.log('File selected:', file.name);
      this.showStatus('Loading...', 'info');

      try {
        // Initialize audio context on first user interaction
        this.audioCapture.initialize();

        // Load the file - this will properly clean up previous connections
        // and create a new audio element
        const result = await this.audioCapture.loadFile(file);

        this.showStatus(`Loaded: ${result.fileName} (${result.duration.toFixed(1)}s)`, 'success');
        this.showControls(true);

      } catch (error) {
        console.error('Failed to load audio file:', error);
        this.showStatus(`Error: ${error.message}`, 'error');
        this.showControls(false);
      }
    });

    // Play button
    playBtn.addEventListener('click', () => {
      this.audioCapture.play();
      this.isPlaying = true;
      this.startVisualization();
    });

    // Pause button
    pauseBtn.addEventListener('click', () => {
      this.audioCapture.pause();
      this.isPlaying = false;
    });

    // Stop button
    stopBtn.addEventListener('click', () => {
      this.audioCapture.stop();
      this.isPlaying = false;
    });

    // Volume slider
    volumeSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      volumeValue.textContent = value;
      this.audioCapture.setVolume(value / 100);
    });
  }

  showStatus(message, type = 'info') {
    const statusEl = this.panelElement.querySelector('.audio-status');
    if (!statusEl) return;

    const colors = {
      info: '#888',
      success: '#5cb85c',
      error: '#d9534f'
    };

    statusEl.textContent = message;
    statusEl.style.color = colors[type] || colors.info;
  }

  showControls(show) {
    const controls = this.panelElement.querySelector('.audio-controls');
    const visualizer = this.panelElement.querySelector('.audio-visualizer');

    if (controls) {
      controls.style.display = show ? 'block' : 'none';
    }

    if (visualizer) {
      visualizer.style.display = show ? 'block' : 'none';
    }
  }

  startVisualization() {
    const canvas = this.panelElement.querySelector('.audio-visualizer');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const draw = () => {
      if (!this.isPlaying) return;

      const freqData = this.audioCapture.getFrequencyData();
      if (!freqData) {
        requestAnimationFrame(draw);
        return;
      }

      // Clear canvas
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      // Draw frequency bars
      const barWidth = width / freqData.length * 2.5;
      let x = 0;

      for (let i = 0; i < freqData.length && x < width; i++) {
        const barHeight = (freqData[i] / 255) * height;

        // Create gradient
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#4a90e2');
        gradient.addColorStop(1, '#2a5f9e');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }

      requestAnimationFrame(draw);
    };

    draw();
  }

  destroy() {
    this.isPlaying = false;
    this.audioCapture.destroy();

    if (this.panelElement && this.panelElement.parentNode) {
      this.panelElement.parentNode.removeChild(this.panelElement);
    }
  }
}
