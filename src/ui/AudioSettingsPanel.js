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
  AUDIO_INSTRUMENTS,
  AUDIO_TAP_LABELS,
  audioChannelInstrument,
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
        // The player loops by default (a VJ set runs off one track for an hour); the panel shows it
        // rather than leaving it as invisible behaviour.
        this._loop = true;
        this._loadError = null;
        this._seeking = false;

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
                    <div class="rzap-sec-title">
                        Source
                        <span id="audio-state" class="rzap-state" data-state="empty">
                            <i class="rzap-dot"></i><span id="audio-state-text">No file</span>
                        </span>
                    </div>
                    <label class="rzap-file">
                        <input type="file" id="audio-file-input" accept="audio/*">
                        <span class="rzap-file-btn">Choose file…</span>
                        <span id="audio-filename" class="rzap-file-name">No file loaded</span>
                    </label>
                    <div class="rzap-transport">
                        <button id="audio-playpause" class="rzap-btn is-primary" disabled>▶ Play</button>
                        <button id="audio-stop-btn" class="rzap-btn" disabled>⏹ Stop</button>
                        <button id="audio-loop" class="rzap-btn is-toggle" title="Loop the track">⟲ Loop</button>
                    </div>
                    <div id="audio-progress-container" class="rzap-progress" title="Click or drag to seek">
                        <div id="audio-progress-bar" class="rzap-progress-fill"></div>
                        <div id="audio-progress-head" class="rzap-progress-head"></div>
                    </div>
                    <div class="rzap-times">
                        <span id="audio-current-time">0:00</span>
                        <span id="audio-duration">0:00</span>
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
                    <p class="rzap-note">
                        A drum's Threshold sets where new nodes for it start, and the markers on its
                        meter show where the deployed ones actually sit. Select a deployed node to
                        MIDI-map its Threshold or give it an expression
                        (<code>=midi</code>, <code>=midi * 0.6 + 0.2</code>).
                    </p>
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
     * A drum's threshold: where the rows below preview at, and what a newly deployed tap starts
     * with. Once deployed, the tap owns its own Threshold — a node parameter, so it can be
     * MIDI-mapped or given an expression like any other — and the markers on the meter row follow
     * those instead. This is where a threshold is FOUND (against a meter you can watch); the node
     * is where it then lives.
     */
    _buildThresholdSlider(instrument, settings) {
        const key = `${instrument}Thresh`;
        const row = document.createElement('label');
        row.className = 'rzap-slider is-thresh';
        row.title = 'Where new nodes for this drum start. A deployed node carries its own '
            + 'Threshold, which can be MIDI-mapped or driven by an expression.';
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
            this._syncMarks(instrument);
        });
        return row;
    }

    _buildChannelRow(channel, instrument) {
        const label = AUDIO_TAP_LABELS[channel] || channel;
        const row = document.createElement('div');
        row.className = 'rzap-row';
        row.dataset.channel = channel;
        row.innerHTML = `
            <button class="rzap-add" title="Add an Audio node for ${label}">+</button>
            <span class="rzap-row-name">${label}</span>
            <span class="rzap-bar"><i class="rzap-bar-fill"></i><span class="rzap-bar-marks"></span></span>
            <span class="rzap-row-value">0.000</span>
        `;

        const marks = row.querySelector('.rzap-bar-marks');
        if (instrument && channel === `${instrument}Meter`) {
            // Only the meter row carries markers: it is the signal a threshold is compared to.
            this._marks.set(instrument, marks);
        } else {
            marks.remove();
        }

        row.querySelector('.rzap-add').addEventListener('click', () => this.deployChannel(channel));

        this._rows.set(channel, {
            fill: row.querySelector('.rzap-bar-fill'),
            value: row.querySelector('.rzap-row-value'),
            envelope: TRIG_ENVELOPE[channel] || null,
        });
        return row;
    }

    /**
     * Draw this drum's thresholds on its meter.
     *
     * With taps deployed, the markers are THEIR thresholds — so a knob mapped to a tap's Threshold
     * is a line sliding across the meter it is being set against, which is the only way to see
     * whether a mapping is aimed anywhere useful. With none deployed there is nothing live to show,
     * so the marker falls back to the panel's default: where the next one would start.
     */
    _syncMarks(instrument) {
        const host = this._marks?.get(instrument);
        if (!host) return;

        const deployed = this._deployedThresholds(instrument);
        const values = deployed.length
            ? deployed
            : [getAudioAnalysisSettings()[`${instrument}Thresh`]];

        // Reuse the elements rather than rebuilding the row every frame: this runs on the refresh
        // tick, and the marker count only changes when a node is added or removed.
        while (host.children.length > values.length) host.lastChild.remove();
        while (host.children.length < values.length) {
            const mark = document.createElement('i');
            mark.className = 'rzap-bar-mark';
            host.appendChild(mark);
        }
        values.forEach((value, i) => {
            const mark = host.children[i];
            mark.style.left = `${Math.min(1, Math.max(0, value)) * 100}%`;
            mark.classList.toggle('is-default', deployed.length === 0);
        });
    }

    /** The live threshold of every deployed tap on this drum, de-duplicated. */
    _deployedThresholds(instrument) {
        const nodes = window.editor?.graph?.nodes || [];
        const seen = new Set();
        for (const node of nodes) {
            if (node?.kind !== 'Audio') continue;
            if (audioChannelInstrument(node.params?.channel) !== instrument) continue;
            // The resolved number the processor last decided on — which is what an expression or a
            // MIDI-mapped threshold actually evaluated to this frame, not the string in the field.
            const live = typeof node.__audio_threshold === 'number'
                ? node.__audio_threshold
                : parseFloat(node.params?.threshold);
            seen.add(Number.isFinite(live) ? Math.min(1, Math.max(0, live)) : 0.5);
        }
        return [...seen].sort((a, b) => a - b);
    }

    /**
     * Drop an Audio node for one channel into the middle of the view.
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
        const node = editor.createNode('Audio', x, y);
        if (!node) return null;

        node.params = node.params || {};
        node.params.channel = channel;
        // Hand the tap the threshold currently set against the meter, then let go of it: from here
        // the number lives on the node, where it can be MIDI-mapped or given an expression.
        const instrument = audioChannelInstrument(channel);
        if (instrument) {
            node.params.threshold = getAudioAnalysisSettings()[`${instrument}Thresh`];
        }
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

        // The transport. Every button reads its state back off the audio element in
        // _syncTransport(), so what is on screen is what the player is actually doing rather than
        // what the last click asked for — a file that fails to start, or playback stopped from
        // anywhere else, shows up here instead of leaving a "Play" button that has already played.
        const fileInput = this.panel.querySelector('#audio-file-input');
        const playPauseBtn = this.panel.querySelector('#audio-playpause');
        const stopBtn = this.panel.querySelector('#audio-stop-btn');
        const loopBtn = this.panel.querySelector('#audio-loop');
        const filenameEl = this.panel.querySelector('#audio-filename');

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            this._loadError = null;
            filenameEl.textContent = file.name;
            try {
                await this.audioClient.loadFile(file);
                // Loading resets the element, so re-apply the loop the panel is showing.
                if (this.audioClient.audioElement) this.audioClient.audioElement.loop = this._loop;
            } catch {
                this._loadError = 'Could not read that file';
            }
            this._syncTransport();
        });

        playPauseBtn.addEventListener('click', async () => {
            if (this._isPlaying()) {
                this.audioClient?.pause();
            } else {
                try {
                    await this.audioClient?.play();
                } catch {
                    // Autoplay policy, a decode failure: the state line says so rather than the
                    // button silently doing nothing.
                    this._loadError = 'Playback was blocked — click again';
                }
            }
            this._syncTransport();
        });

        stopBtn.addEventListener('click', () => {
            this.audioClient?.stop();
            this._syncTransport();
        });

        loopBtn.addEventListener('click', () => {
            this._loop = !this._loop;
            if (this.audioClient?.audioElement) this.audioClient.audioElement.loop = this._loop;
            this._syncTransport();
        });

        // Seeking: click anywhere on the bar, or drag along it. Pointer capture is what makes the
        // drag survive leaving the 6px-tall bar, which is otherwise impossible to stay inside.
        const progress = this.panel.querySelector('#audio-progress-container');
        const seekTo = (clientX) => {
            const audioElement = this.audioClient?.audioElement;
            if (!audioElement || !isFinite(audioElement.duration) || !audioElement.duration) return;
            const rect = progress.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
            audioElement.currentTime = ratio * audioElement.duration;
            this._syncTransport();
        };
        progress.addEventListener('pointerdown', (e) => {
            progress.setPointerCapture?.(e.pointerId);
            this._seeking = true;
            seekTo(e.clientX);
        });
        progress.addEventListener('pointermove', (e) => {
            if (this._seeking) seekTo(e.clientX);
        });
        const endSeek = (e) => {
            if (!this._seeking) return;
            this._seeking = false;
            progress.releasePointerCapture?.(e.pointerId);
        };
        progress.addEventListener('pointerup', endSeek);
        progress.addEventListener('pointercancel', endSeek);

        // The player can start and stop without the panel: an Audio node's button, another window.
        for (const event of ['loaded', 'started', 'stopped', 'error']) {
            this.audioClient?.on?.(event, () => this._syncTransport());
        }

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

        for (const instrument of AUDIO_INSTRUMENTS) this._syncMarks(instrument);
        this._syncTransport();
    }

    /** Is the player actually producing sound right now? */
    _isPlaying() {
        const el = this.audioClient?.audioElement;
        // The element is the truth: `isPlaying` on the client is set by its own play()/pause() and
        // cannot know about a track that ran out or was stopped from somewhere else.
        if (el) return !el.paused && !el.ended && el.readyState > 2;
        return !!this.audioClient?.getIsPlaying?.();
    }

    /**
     * Put the transport in the state the player is actually in.
     *
     * The old row was three buttons that looked identical whatever was happening — Play stayed lit
     * after it had been pressed, nothing said whether a file was loaded, whether it was playing or
     * paused, or that it loops. Every one of those is now readable at a glance: the state chip
     * names it, the primary button shows the action that would change it, and Stop dims when there
     * is nothing to stop.
     */
    _syncTransport() {
        const el = this.audioClient?.audioElement;
        const hasFile = !!(el && el.src);
        const playing = this._isPlaying();
        const position = el?.currentTime || 0;
        const duration = el && isFinite(el.duration) ? el.duration : 0;

        let state = 'empty';
        let label = 'No file';
        if (this._loadError) {
            state = 'error';
            label = this._loadError;
        } else if (!hasFile) {
            state = 'empty';
            label = 'No file';
        } else if (playing) {
            state = 'playing';
            label = 'Playing';
        } else if (position > 0) {
            state = 'paused';
            label = 'Paused';
        } else {
            state = 'ready';
            label = 'Ready';
        }

        const chip = this.panel.querySelector('#audio-state');
        chip.dataset.state = state;
        this.panel.querySelector('#audio-state-text').textContent = label;

        const playPause = this.panel.querySelector('#audio-playpause');
        playPause.textContent = playing ? '⏸ Pause' : '▶ Play';
        playPause.disabled = !hasFile;
        playPause.classList.toggle('is-playing', playing);

        const stop = this.panel.querySelector('#audio-stop-btn');
        stop.disabled = !hasFile || (!playing && position === 0);

        const loop = this.panel.querySelector('#audio-loop');
        loop.classList.toggle('is-on', this._loop);
        loop.setAttribute('aria-pressed', String(this._loop));

        this.panel.querySelector('#audio-current-time').textContent = this.formatTime(position);
        this.panel.querySelector('#audio-duration').textContent = this.formatTime(duration);
        const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
        this.panel.querySelector('#audio-progress-bar').style.width = `${ratio * 100}%`;
        this.panel.querySelector('#audio-progress-head').style.left = `${ratio * 100}%`;
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

            /* What the player is doing, in words, where the eye lands first. */
            .rzap-state {
                display: inline-flex; align-items: center; gap: 5px;
                text-transform: none; letter-spacing: 0; color: var(--rz-text-3);
            }
            .rzap-dot {
                width: 6px; height: 6px; border-radius: 50%;
                background: var(--rz-text-disabled);
            }
            .rzap-state[data-state="ready"] .rzap-dot { background: var(--rz-text-3); }
            .rzap-state[data-state="paused"] { color: var(--rz-warn); }
            .rzap-state[data-state="paused"] .rzap-dot { background: var(--rz-warn); }
            .rzap-state[data-state="error"] { color: var(--rz-error); }
            .rzap-state[data-state="error"] .rzap-dot { background: var(--rz-error); }
            .rzap-state[data-state="playing"] { color: var(--rz-accent); }
            .rzap-state[data-state="playing"] .rzap-dot {
                background: var(--rz-accent);
                animation: rzap-pulse 1.4s ease-in-out infinite;
            }
            /* The one moving thing in the panel that is not a meter: it says "running" even on a
               silent passage, where every meter reads zero and nothing else would. */
            @keyframes rzap-pulse {
                0%, 100% { opacity: 1; box-shadow: 0 0 0 0 var(--rz-accent-30); }
                50% { opacity: 0.55; box-shadow: 0 0 0 3px transparent; }
            }
            @media (prefers-reduced-motion: reduce) {
                .rzap-state[data-state="playing"] .rzap-dot { animation: none; }
            }

            .rzap-file {
                display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
                cursor: pointer;
            }
            .rzap-file input { display: none; }
            .rzap-file-btn {
                flex: 0 0 auto; padding: 5px 9px; border-radius: 6px;
                border: 1px solid var(--rz-line-strong); background: var(--rz-surface-raised);
                color: var(--rz-text-2); font-size: 11px; white-space: nowrap;
            }
            .rzap-file:hover .rzap-file-btn { background: var(--rz-hover); color: var(--rz-text); }
            .rzap-file-name {
                flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--rz-text-3);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }

            .rzap-transport { display: flex; gap: 4px; margin-bottom: 8px; }
            .rzap-btn {
                flex: 1; padding: 6px; border: 1px solid var(--rz-line-strong); border-radius: 6px;
                background: var(--rz-surface-raised); color: var(--rz-text);
                font-family: var(--rz-font-ui); font-size: 11px; cursor: pointer;
            }
            .rzap-btn:hover:not(:disabled) { background: var(--rz-hover); }
            .rzap-btn:disabled { opacity: 0.4; cursor: default; }
            /* Play is the accented action; while it IS playing the accent moves to the state chip
               and the button reads as the thing it would do next (pause), not as the thing running. */
            .rzap-btn.is-primary {
                background: var(--rz-accent); color: var(--rz-accent-ink); border-color: transparent;
            }
            .rzap-btn.is-primary.is-playing {
                background: var(--rz-accent-14); color: var(--rz-accent);
                border-color: var(--rz-accent-30);
            }
            .rzap-btn.is-toggle { flex: 0 0 auto; padding: 6px 9px; color: var(--rz-text-3); }
            .rzap-btn.is-toggle.is-on {
                color: var(--rz-accent); border-color: var(--rz-accent-30);
                background: var(--rz-accent-08);
            }

            .rzap-times {
                display: flex; justify-content: space-between; gap: 8px; margin-top: 4px;
                font-family: var(--rz-font-mono); font-size: 10px; color: var(--rz-text-faint);
            }
            .rzap-progress {
                position: relative; height: 6px; border-radius: 3px; cursor: pointer;
                background: var(--rz-fill-soft); touch-action: none;
            }
            .rzap-progress-fill {
                height: 100%; width: 0%; border-radius: 3px; background: var(--rz-accent);
            }
            .rzap-progress-head {
                position: absolute; top: 50%; left: 0; width: 9px; height: 9px;
                margin: -4.5px 0 0 -4.5px; border-radius: 50%;
                background: var(--rz-accent); pointer-events: none;
            }

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
            .rzap-bar-marks { position: absolute; inset: 0; pointer-events: none; }
            .rzap-bar-mark {
                position: absolute; top: -1px; bottom: -1px; width: 2px; left: 50%;
                background: var(--rz-text); opacity: 0.85;
            }
            /* Nothing deployed yet: this is only where the next one would start. */
            .rzap-bar-mark.is-default { opacity: 0.4; }
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
