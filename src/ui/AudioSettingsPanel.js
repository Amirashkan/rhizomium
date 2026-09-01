/**
 * AudioSettingsPanel.js
 *
 * The Audio panel: the patch's single control surface for the live audio analysis.
 *
 * It holds what used to be spread across every Audio Analysis node — the meter shaping and the
 * per-drum thresholds — because there is only ever ONE analysis engine behind them, and one set of
 * meters. Two nodes each carrying their own copy of those settings meant the last one written won
 * and the other node's sliders silently did nothing.
 *
 * The list of channels below is the other half. Each row shows what that channel reads RIGHT NOW,
 * and the ＋ next to it deploys an Audio Value node wired to it — a float you can drag into
 * anything. That is what makes a threshold findable: watch the meter here, put the threshold under
 * where it peaks when the drum lands, then deploy the trigger.
 *
 * The Audio Analysis node still exists and still works (patches that use it are untouched); this
 * is the way in for new ones.
 */

import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';
import {
  getAudioAnalysisSettings,
  updateAudioAnalysisSettings,
} from '../audio/audioAnalysisSettings.js';
import {
  AUDIO_TAP_LABELS,
  getAudioTapValues,
  setAudioTapsWanted,
} from '../audio/audioAnalysisTaps.js';
import { normalizeNodeName } from '../core/nodeName.js';
import { makeDraggable } from './utils/draggable.js';

/**
 * How the channels are grouped for reading.
 *
 * The continuous meters come first because they are what most patches actually modulate with. Each
 * drum then gets its own block, in signal-chain order: the METER the decision is made on, then the
 * envelope and the trigger that come out of it — so the threshold slider sits directly above the
 * meter it is compared against.
 */
const CHANNEL_GROUPS = [
  { title: 'Signal', channels: ['level', 'low', 'mid', 'high', 'centroid', 'density'] },
  { title: 'Kick', instrument: 'kick', channels: ['kickMeter', 'kick', 'kickTrig'] },
  { title: 'Snare', instrument: 'snare', channels: ['snareMeter', 'snare', 'snareTrig'] },
  { title: 'Hat', instrument: 'hat', channels: ['hatMeter', 'hat', 'hatTrig'] },
];

/** The envelope whose decay a trigger row flashes with — a one-frame pulse is invisible at 20 Hz. */
const TRIG_ENVELOPE = { kickTrig: 'kick', snareTrig: 'snare', hatTrig: 'hat' };

/** The meter shaping sliders, in the order they are drawn. */
const SHAPE_SLIDERS = [
  { name: 'attack', label: 'Attack', min: 1, max: 60, step: 1, unit: ' ms' },
  { name: 'release', label: 'Release', min: 20, max: 600, step: 5, unit: ' ms' },
  { name: 'gain', label: 'Gain', min: 0, max: 4, step: 0.05, unit: '' },
];

/** Where a deployed tap lands, relative to the middle of the view, and how the next one stacks. */
const DEPLOY_STEP_Y = 78;
const DEPLOY_COLUMN = 220;
const DEPLOY_PER_COLUMN = 6;

export class AudioSettingsPanel {
    constructor() {

        this.panel = null;
        this.visible = false;
        this.cleanupDraggable = null;
        this._deployed = 0;

        try {
            this.audioClient = getBrowserAudioCapture();

        } catch {

            this.audioClient = null;
        }

        this.createPanel();
        this.setupEventListeners();

    }

    createPanel() {
        this._ensureStyles();

        this.panel = document.createElement('div');
        this.panel.id = 'audio-settings-panel';
        this.panel.className = 'rzap';

        this.panel.innerHTML = `
            <div class="rzap-head">
                <h3>Audio</h3>
                <button id="audio-close-btn" class="rzap-close" title="Close">&times;</button>
            </div>

            <div class="rzap-body">
                <section class="rzap-sec">
                    <div class="rzap-sec-title">Source</div>
                    <input type="file" id="audio-file-input" accept="audio/*" class="rzap-file-input">
                    <div class="rzap-transport">
                        <button id="audio-play-btn" class="rzap-btn is-accent" disabled>▶ Play</button>
                        <button id="audio-pause-btn" class="rzap-btn" disabled>⏸ Pause</button>
                        <button id="audio-stop-btn" class="rzap-btn" disabled>⏹ Stop</button>
                    </div>
                    <div class="rzap-times">
                        <span id="audio-current-time">0:00</span>
                        <span id="audio-filename">No file loaded</span>
                        <span id="audio-duration">0:00</span>
                    </div>
                    <div id="audio-progress-container" class="rzap-progress">
                        <div id="audio-progress-bar" class="rzap-progress-fill"></div>
                    </div>
                </section>

                <section class="rzap-sec">
                    <div class="rzap-sec-title">Meter Shape</div>
                    <p class="rzap-note">
                        Shared by every audio node: how sharply a meter rises on a transient and how
                        long a hit stays readable. Changes what the meters look like, which is what a
                        threshold is then set against.
                    </p>
                    <div id="audio-shape"></div>
                </section>

                <section class="rzap-sec">
                    <div class="rzap-sec-title">
                        Channels
                        <span class="rzap-hint">＋ drops a float node on the canvas</span>
                    </div>
                    <div id="audio-channels"></div>
                </section>

                <section class="rzap-sec rzap-foot">
                    <p class="rzap-note">
                        In a parameter expression, <code>=audioEnvelope</code> still reads the overall
                        envelope — e.g. <code>=audioEnvelope * 2</code>.
                    </p>
                </section>
            </div>
        `;

        this._buildShapeSliders(this.panel.querySelector('#audio-shape'));
        this._buildChannelRows(this.panel.querySelector('#audio-channels'));

        document.body.appendChild(this.panel);

        this.cleanupDraggable = makeDraggable(this.panel, this.panel.querySelector('.rzap-head'));
    }

    /** Attack / Release / Gain, straight onto the shared settings. */
    _buildShapeSliders(host) {
        if (!host) return;
        const settings = getAudioAnalysisSettings();

        for (const spec of SHAPE_SLIDERS) {
            const row = document.createElement('label');
            row.className = 'rzap-slider';
            row.innerHTML = `
                <span class="rzap-slider-label">${spec.label}</span>
                <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">
                <span class="rzap-slider-value"></span>
            `;
            const input = row.querySelector('input');
            const readout = row.querySelector('.rzap-slider-value');
            const show = (v) => {
                readout.textContent = `${spec.step < 1 ? v.toFixed(2) : Math.round(v)}${spec.unit}`;
            };
            input.value = String(settings[spec.name]);
            show(settings[spec.name]);
            input.addEventListener('input', () => {
                const applied = updateAudioAnalysisSettings({ [spec.name]: parseFloat(input.value) });
                show(applied[spec.name]);
            });
            host.appendChild(row);
        }
    }

    /** One block per group: the drum's threshold, then its channel rows. */
    _buildChannelRows(host) {
        if (!host) return;
        const settings = getAudioAnalysisSettings();
        this._rows = new Map();
        this._marks = new Map();

        for (const group of CHANNEL_GROUPS) {
            const block = document.createElement('div');
            block.className = 'rzap-group';

            const title = document.createElement('div');
            title.className = 'rzap-group-title';
            title.textContent = group.title;
            block.appendChild(title);

            if (group.instrument) {
                block.appendChild(this._buildThresholdSlider(group.instrument, settings));
            }

            for (const channel of group.channels) {
                block.appendChild(this._buildChannelRow(channel, group.instrument));
            }
            host.appendChild(block);
        }
    }

    /**
     * A drum's threshold, and the marker it draws on that drum's meter. The marker is the point of
     * the panel: a threshold is set by looking at where it sits against the meter, not by typing a
     * number and guessing.
     */
    _buildThresholdSlider(instrument, settings) {
        const key = `${instrument}Thresh`;
        const row = document.createElement('label');
        row.className = 'rzap-slider is-thresh';
        row.innerHTML = `
            <span class="rzap-slider-label">Threshold</span>
            <input type="range" min="0" max="1" step="0.01">
            <span class="rzap-slider-value"></span>
        `;
        const input = row.querySelector('input');
        const readout = row.querySelector('.rzap-slider-value');
        const show = (v) => { readout.textContent = v.toFixed(2); };
        input.value = String(settings[key]);
        show(settings[key]);
        input.addEventListener('input', () => {
            const applied = updateAudioAnalysisSettings({ [key]: parseFloat(input.value) });
            show(applied[key]);
            this._placeMark(instrument, applied[key]);
        });
        return row;
    }

    _buildChannelRow(channel, instrument) {
        const label = AUDIO_TAP_LABELS[channel] || channel;
        const row = document.createElement('div');
        row.className = 'rzap-row';
        row.dataset.channel = channel;
        row.innerHTML = `
            <button class="rzap-add" title="Add an Audio Value node for ${label}">+</button>
            <span class="rzap-row-name">${label}</span>
            <span class="rzap-bar"><i class="rzap-bar-fill"></i><i class="rzap-bar-mark"></i></span>
            <span class="rzap-row-value">0.000</span>
        `;

        const mark = row.querySelector('.rzap-bar-mark');
        if (instrument && channel === `${instrument}Meter`) {
            // Only the meter row carries the marker: it is the signal the threshold is compared to.
            this._marks.set(instrument, mark);
            this._placeMark(instrument, getAudioAnalysisSettings()[`${instrument}Thresh`], mark);
        } else {
            mark.remove();
        }

        row.querySelector('.rzap-add').addEventListener('click', () => this.deployChannel(channel));

        this._rows.set(channel, {
            fill: row.querySelector('.rzap-bar-fill'),
            value: row.querySelector('.rzap-row-value'),
            envelope: TRIG_ENVELOPE[channel] || null,
        });
        return row;
    }

    _placeMark(instrument, threshold, element) {
        const mark = element || this._marks?.get(instrument);
        if (!mark) return;
        mark.style.left = `${Math.min(1, Math.max(0, threshold)) * 100}%`;
    }

    /**
     * Drop an Audio Value node for one channel into the middle of the view.
     *
     * Named after the channel, and stacked rather than piled: deploying four taps in a row should
     * read as a rack of four labelled floats, not as one node with three hidden underneath it.
     */
    deployChannel(channel) {
        const editor = window.editor;
        if (!editor?.createNode) {
            window.updateStatus?.('Editor not ready', 'error');
            return null;
        }

        const { x, y } = this._deployPosition(editor);
        const node = editor.createNode('AudioValue', x, y);
        if (!node) return null;

        node.params = node.params || {};
        node.params.channel = channel;
        const label = AUDIO_TAP_LABELS[channel] || channel;
        node.name = normalizeNodeName(label, node);
        this._deployed += 1;

        // The channel is a CPU-side lookup, not part of the emitted shader, so this needs no
        // rebuild — only a repaint, plus a re-render of the parameter panel in the case where it
        // already drew this node's Channel menu on the default the node was created with.
        editor.markDirty?.('audio-tap-deployed');
        editor.safeDraw?.();
        if (editor.paramPanel?.selectedNode?.id === node.id) {
            editor.paramPanel.showNodeParameters(node);
        }
        window.updateStatus?.(`Added ${label} node`);
        return node;
    }

    /** The middle of the current view, cascading down and then across for repeated deploys. */
    _deployPosition(editor) {
        const viewport = editor.viewport;
        const canvas = editor.canvas;
        const width = canvas?.clientWidth || window.innerWidth || 1200;
        const height = canvas?.clientHeight || window.innerHeight || 800;

        let x = width / 2;
        let y = height / 2;
        if (viewport?.screenToCanvas) {
            try {
                const world = viewport.screenToCanvas(width / 2, height / 2);
                if (world) { x = world.x; y = world.y; }
            } catch {
                // Fall back to screen coordinates rather than refusing to place the node.
            }
        }

        const index = this._deployed;
        return {
            x: x - 90 + Math.floor(index / DEPLOY_PER_COLUMN) * DEPLOY_COLUMN,
            y: y - 120 + (index % DEPLOY_PER_COLUMN) * DEPLOY_STEP_Y,
        };
    }

    setupEventListeners() {
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
                    filenameEl.style.color = 'var(--rz-accent)';
                    playBtn.disabled = false;
                    pauseBtn.disabled = false;
                    stopBtn.disabled = false;
                } catch {

                    filenameEl.textContent = 'Error loading file';
                    filenameEl.style.color = 'var(--rz-error)';
                }
            }
        });

        // Play button
        playBtn.addEventListener('click', async () => {
            try {
                await this.audioClient.play();
            } catch {

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
            const audioElement = this.audioClient?.audioElement;
            if (!audioElement || !audioElement.duration) return;

            const rect = progressContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;

            audioElement.currentTime = percentage * audioElement.duration;
        });

        // Update display periodically. Only while on screen: the taps behind it are computed on the
        // render loop and cost an engine tick per frame, which nothing should pay for a closed panel.
        setInterval(() => {
            if (this.visible) this._refresh();
        }, 50);
    }

    /** One pass over the live values. */
    _refresh() {
        const taps = getAudioTapValues();

        for (const [channel, row] of this._rows) {
            const value = typeof taps[channel] === 'number' ? taps[channel] : 0;
            // A trigger is one frame wide and would almost never be caught by a 20 Hz poll, so its
            // bar shows the matching envelope's decay — the same hit, made visible for long enough
            // to see. The number stays honest: it is the trigger itself, 0 or 1.
            const bar = row.envelope ? (taps[row.envelope] || 0) : value;
            row.fill.style.width = `${Math.min(1, Math.max(0, bar)) * 100}%`;
            row.value.textContent = value.toFixed(3);
        }

        const audioElement = this.audioClient?.audioElement;
        if (audioElement) {
            const currentTime = audioElement.currentTime || 0;
            const duration = audioElement.duration || 0;

            const currentTimeEl = this.panel.querySelector('#audio-current-time');
            const durationEl = this.panel.querySelector('#audio-duration');
            const progressBar = this.panel.querySelector('#audio-progress-bar');

            if (currentTimeEl) currentTimeEl.textContent = this.formatTime(currentTime);
            if (durationEl && isFinite(duration)) durationEl.textContent = this.formatTime(duration);
            if (progressBar && isFinite(duration) && duration > 0) {
                progressBar.style.width = `${(currentTime / duration) * 100}%`;
            }
        }
    }

    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    show() {
        if (this.panel) {
            this.panel.style.display = 'flex';
            this.visible = true;
            // Keep the analysis running while the meters are being watched, so thresholds can be
            // set before anything has been deployed.
            setAudioTapsWanted(true);
            this._refresh();
        }
    }

    hide() {
        if (this.panel) {
            this.panel.style.display = 'none';
            this.visible = false;
            setAudioTapsWanted(false);
        }
    }

    toggle() {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    _ensureStyles() {
        if (document.getElementById('rz-audio-panel-styles')) return;
        const style = document.createElement('style');
        style.id = 'rz-audio-panel-styles';
        style.textContent = `
            .rzap {
                position: fixed;
                top: 60px;
                right: 20px;
                width: 340px;
                max-height: calc(100vh - 100px);
                display: none;
                flex-direction: column;
                background: linear-gradient(var(--rz-panel-top), var(--rz-panel-bottom));
                border: 1px solid var(--rz-line-strong);
                border-radius: 10px;
                color: var(--rz-text);
                font-family: var(--rz-font-ui);
                font-size: 12px;
                z-index: 1000;
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
                overflow: hidden;
            }
            .rzap-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 14px;
                border-bottom: 1px solid var(--rz-line);
                cursor: move;
                flex: 0 0 auto;
            }
            .rzap-head h3 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
            .rzap-close {
                background: none; border: none; color: var(--rz-text-3);
                font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px;
            }
            .rzap-close:hover { color: var(--rz-text); }

            .rzap-body { overflow-y: auto; padding: 4px 14px 14px; }
            .rzap-sec { padding: 12px 0; border-bottom: 1px solid var(--rz-line); }
            .rzap-sec:last-child { border-bottom: none; }
            .rzap-sec-title {
                display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
                font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase;
                color: var(--rz-text-3); margin-bottom: 8px;
            }
            .rzap-hint { text-transform: none; letter-spacing: 0; color: var(--rz-text-faint); }
            .rzap-note { margin: 0 0 8px; color: var(--rz-text-faint); font-size: 11px; line-height: 1.45; }
            .rzap-note code {
                background: var(--rz-well); color: var(--rz-accent);
                padding: 1px 4px; border-radius: 3px; font-family: var(--rz-font-mono);
            }
            .rzap-foot { padding-bottom: 4px; }

            .rzap-file-input {
                width: 100%; padding: 5px; margin-bottom: 8px; box-sizing: border-box;
                background: var(--rz-well); color: var(--rz-text);
                border: 1px solid var(--rz-line-strong); border-radius: 6px;
                font-size: 11px; font-family: var(--rz-font-ui); cursor: pointer;
            }
            .rzap-transport { display: flex; gap: 4px; margin-bottom: 8px; }
            .rzap-btn {
                flex: 1; padding: 6px; border: 1px solid var(--rz-line-strong); border-radius: 6px;
                background: var(--rz-surface-raised); color: var(--rz-text);
                font-family: var(--rz-font-ui); font-size: 11px; cursor: pointer;
            }
            .rzap-btn:hover:not(:disabled) { background: var(--rz-hover); }
            .rzap-btn.is-accent { background: var(--rz-accent); color: var(--rz-accent-ink); border-color: transparent; }
            .rzap-btn:disabled { opacity: 0.45; cursor: default; }

            .rzap-times {
                display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px;
                font-family: var(--rz-font-mono); font-size: 10px; color: var(--rz-text-faint);
            }
            #audio-filename {
                flex: 1; text-align: center; font-family: var(--rz-font-ui); font-style: italic;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .rzap-progress {
                height: 6px; border-radius: 3px; overflow: hidden; cursor: pointer;
                background: var(--rz-fill-soft);
            }
            .rzap-progress-fill { height: 100%; width: 0%; background: var(--rz-accent); }

            .rzap-slider {
                display: grid; grid-template-columns: 62px 1fr 46px; align-items: center;
                gap: 8px; margin-bottom: 6px;
            }
            .rzap-slider-label { color: var(--rz-text-2); font-size: 11px; }
            .rzap-slider input { width: 100%; accent-color: var(--rz-accent); }
            .rzap-slider-value {
                text-align: right; font-family: var(--rz-font-mono); font-size: 10px;
                color: var(--rz-text-3);
            }
            .rzap-slider.is-thresh .rzap-slider-label { color: var(--rz-accent); }

            .rzap-group { margin-bottom: 10px; }
            .rzap-group:last-child { margin-bottom: 0; }
            .rzap-group-title {
                font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
                color: var(--rz-text-faint); margin: 8px 0 4px;
            }
            .rzap-row {
                display: grid; grid-template-columns: 20px 78px 1fr 42px;
                align-items: center; gap: 8px; padding: 2px 0;
            }
            .rzap-row-name { color: var(--rz-text-2); font-size: 11px; }
            .rzap-row-value {
                text-align: right; font-family: var(--rz-font-mono); font-size: 10px;
                color: var(--rz-text-3);
            }
            .rzap-add {
                width: 20px; height: 20px; padding: 0; line-height: 18px; text-align: center;
                border: 1px solid var(--rz-line-strong); border-radius: 5px;
                background: var(--rz-surface-raised); color: var(--rz-text-3);
                font-size: 13px; cursor: pointer;
            }
            .rzap-add:hover {
                background: var(--rz-accent); color: var(--rz-accent-ink); border-color: transparent;
            }
            .rzap-bar {
                position: relative; display: block; height: 6px; border-radius: 3px;
                background: var(--rz-fill-soft); overflow: hidden;
            }
            .rzap-bar-fill {
                display: block; height: 100%; width: 0%; background: var(--rz-accent);
            }
            .rzap-bar-mark {
                position: absolute; top: -1px; bottom: -1px; width: 2px; left: 50%;
                background: var(--rz-text); opacity: 0.75;
            }
        `;
        document.head.appendChild(style);
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
