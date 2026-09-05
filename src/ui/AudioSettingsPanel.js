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
  AUDIO_ANALYSIS_DEFAULTS,
  AUDIO_SETTING_SPECS,
} from '../audio/audioAnalysisDefaults.js';
import {
  AUDIO_TAP_LABELS,
  getAudioTapValues,
  setAudioTapsWanted,
} from '../audio/audioAnalysisTaps.js';
import { parameterHoldsExpression } from '../parameters/ExternalParameterControl.js';
import { normalizeNodeName } from '../core/nodeName.js';
import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';

/**
 * What the audio source is doing right now, in one place.
 *
 * The panel's state chip and the Audio node's parameter panel must say the SAME thing: a node whose
 * channels all read zero is not broken, it is a patch with nothing playing, and that is the single
 * most useful sentence either surface can show. Keeping the wording here means they cannot drift.
 *
 * @returns {{state: string, label: string, fileName: string, playing: boolean, hasFile: boolean}}
 */
export function describeAudioSource() {
  let client = null;
  try {
    client = getBrowserAudioCapture();
  } catch {
    client = null;
  }
  const el = client?.audioElement || null;
  const hasFile = !!(el && el.src);
  // The element is the truth: `isPlaying` on the client is set by its own play()/pause() and cannot
  // know about a track that ran out or was stopped from somewhere else.
  const filePlaying = el ? (!el.paused && !el.ended && el.readyState > 2) : false;
  const fileName = (typeof el?.dataset?.fileName === 'string' && el.dataset.fileName) || '';

  // A live input takes precedence because it is exclusive: starting one pauses the file, so if a
  // stream is open it is what the meters are reading.
  if (client?.liveKind) {
    return {
      state: 'live',
      label: client.liveKind === 'system' ? 'System audio' : 'Live input',
      fileName: client.liveLabel || '',
      playing: true,
      hasFile,
      live: true,
      sourceKind: client.liveKind,
    };
  }

  const playing = el ? filePlaying : !!client?.getIsPlaying?.();
  const base = { fileName, playing, hasFile, live: false, sourceKind: hasFile ? 'file' : null };
  if (!hasFile) return { ...base, state: 'empty', label: 'No audio loaded' };
  if (playing) return { ...base, state: 'playing', label: 'Playing' };
  if ((el?.currentTime || 0) > 0) return { ...base, state: 'paused', label: 'Paused' };
  return { ...base, state: 'ready', label: 'Loaded, not playing' };
}

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

/**
 * The meter shaping settings, in the order they are shown. Labels and ranges come from their one
 * declaration (audio/audioAnalysisDefaults.js), so this surface and the node's fields agree.
 */
const SHAPE_SETTINGS = ['attack', 'release', 'gain'];

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
        // Which source the panel is showing controls for. Only one can feed the analysis at a
        // time, so this is also which one is allowed to be running.
        this._sourceMode = 'file';
        this._devices = [];
        // Per-drum fire counts as of the last refresh, so a trigger row can report a hit that
        // landed between two polls.
        this._trigSeen = {};
        this._deviceId = '';
        this._starting = false;
        // One re-read per readout, run on the refresh tick.
        this._settingSyncs = [];

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
                    <div class="rzap-tabs" role="group" aria-label="Audio source">
                        <button class="rzap-tab is-on" data-source="file">File</button>
                        <button class="rzap-tab" data-source="mic">Mic / line‑in</button>
                        <button class="rzap-tab" data-source="system">System</button>
                    </div>

                    <div id="audio-file-block">
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
                    </div>

                    <div id="audio-live-block" hidden>
                        <label id="audio-device-row" class="rzap-device">
                            <span>Input</span>
                            <select id="audio-input-device"></select>
                        </label>
                        <div class="rzap-transport">
                            <button id="audio-live-toggle" class="rzap-btn is-primary">● Listen</button>
                        </div>
                        <p id="audio-live-note" class="rzap-note"></p>
                    </div>
                </section>

                <section class="rzap-sec">
                    <div class="rzap-sec-title">
                        Settings
                        <span id="audio-setup-note" class="rzap-hint"></span>
                    </div>
                    <p class="rzap-note">
                        Shown here, set on the <strong>Audio</strong> node — where each is an
                        ordinary parameter: MIDI-mappable, driveable by an expression
                        (<code>=midi</code>, <code>=midi * 0.6 + 0.2</code>), undoable, and saved
                        with the patch. Attack and Release shape how the meters below move; Gain
                        sets how hot they read.
                    </p>
                    <div id="audio-shape"></div>
                    <button id="audio-add-setup" class="rzap-btn rzap-add-setup">
                        + Audio node
                    </button>
                </section>

                <section class="rzap-sec">
                    <div class="rzap-sec-title">
                        Channels
                        <span class="rzap-hint">＋ drops a float node on the canvas</span>
                    </div>
                    <p id="audio-silent" class="rzap-note rzap-warn" hidden>
                        Nothing is playing, so every channel reads 0 — and so does any node reading
                        one. Load a track above and press Play.
                    </p>
                    <p class="rzap-note">
                        Each drum's Threshold is marked on the meter it is compared against — put it
                        above where that meter idles between hits and below where it peaks on one.
                        It moves on the Audio node.
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
        // Parked against the right edge next to the parameter panel; keep it
        // there when the width changes.
        this.cleanupResizable = makeResizable(this.panel, {
            minWidth: 300,
            minHeight: 240,
            anchor: { x: 'right', y: 'top' },
        });
    }

    /**
     * The Audio node the patch keeps its analysis settings on, if it has one.
     *
     * This panel READS that node. It does not write to it, and there is nowhere else for the
     * numbers to live: a control has to be MIDI-learnable, expression-driveable, undoable and saved
     * with the patch, and a node parameter is all four. A slider here was none of them, and it
     * wrote to a localStorage store beside the node — a second home for the same number, which a
     * patch could hold two disagreeing copies of with nothing on screen saying which one won.
     */
    _setupNode() {
        return (window.editor?.graph?.nodes || []).find((n) => n?.kind === 'Audio') || null;
    }

    /**
     * A setting's current value, and whether a formula is producing it.
     *
     * `value` is the number actually being decided on — the processor's resolved figure when the
     * parameter holds an expression, so the slider and the meter marker show where the threshold
     * really sits rather than the text of the formula. `expression` is that text, and is what stops
     * the slider from writing over it.
     */
    _settingState(name) {
        const node = this._setupNode();
        const expression = node && parameterHoldsExpression(node, name)
            ? String(node.params[name])
            : null;

        const resolved = node?.__audio_settings?.[name];
        if (typeof resolved === 'number') return { value: resolved, expression, node };
        const raw = node?.params?.[name];
        if (typeof raw === 'number') return { value: Number(raw), expression, node };
        return { value: AUDIO_ANALYSIS_DEFAULTS[name], expression, node };
    }

    /** A setting's current value. */
    _setting(name) {
        return this._settingState(name).value;
    }

    /** Attack / Release / Gain, as readouts. They are set on the Audio node. */
    _buildShapeSliders(host) {
        if (!host) return;
        for (const name of SHAPE_SETTINGS) host.appendChild(this._buildReadout(name));
    }

    /**
     * One setting, shown but not editable: its name, where it sits in its range, and its value.
     *
     * Not a disabled slider — a greyed-out control reads as broken rather than as "this lives
     * somewhere else". A bar and a number say what the value IS, which is all this surface is for;
     * the button under the section says where to change it.
     */
    _buildReadout(name) {
        const spec = AUDIO_SETTING_SPECS[name];
        const row = document.createElement('div');
        row.className = 'rzap-readout';
        row.innerHTML = `
            <span class="rzap-readout-label"></span>
            <span class="rzap-readout-track"><span class="rzap-readout-fill"></span></span>
            <span class="rzap-readout-value"></span>
        `;
        // "(ms)" is dropped here: the value beside it already carries the unit, and the full label
        // wraps to two lines in this column. The node's own field keeps it, where there is no
        // number in view to read the unit off.
        row.querySelector('.rzap-readout-label').textContent = spec.label.replace(/\s*\(ms\)$/, '');

        const fill = row.querySelector('.rzap-readout-fill');
        const value = row.querySelector('.rzap-readout-value');
        const sync = () => {
            const state = this._settingState(name);
            const span = spec.max - spec.min;
            const ratio = span > 0 ? (state.value - spec.min) / span : 0;
            fill.style.width = `${Math.min(1, Math.max(0, ratio)) * 100}%`;
            // The number is what the engine decided on, so an expression shows its RESULT here and
            // its text beside it — the formula alone would not say where the threshold actually is.
            value.textContent = state.expression
                ? state.expression
                : `${spec.step < 1 ? state.value.toFixed(2) : Math.round(state.value)}${spec.unit || ''}`;
            row.classList.toggle('is-driven', !!state.expression);
            row.title = state.expression
                ? `${spec.label} = ${state.expression} → ${state.value.toFixed(3)}`
                : `${spec.label}, from the Audio node`;
        };
        sync();
        this._settingSyncs.push(sync);
        return row;
    }

    /** One block per group: the drum's threshold, then its channel rows. */
    _buildChannelRows(host) {
        if (!host) return;
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
                block.appendChild(this._buildThresholdSlider(group.instrument));
            }

            for (const channel of group.channels) {
                block.appendChild(this._buildChannelRow(channel, group.instrument));
            }
            host.appendChild(block);
        }
    }

    /**
     * A drum's threshold, shown against the meter it is compared to — which is the only way one is
     * ever found: it wants to sit above where the meter idles between hits and below where it peaks
     * on one, and the marker on the row below says where it currently is.
     *
     * Shown, not set. It is a parameter of the patch's Audio node, where it can be MIDI-mapped or
     * given an expression; the button at the top of this section goes there.
     */
    _buildThresholdSlider(instrument) {
        const key = `${instrument}Thresh`;
        const row = this._buildReadout(key);
        row.classList.add('is-thresh');
        row.querySelector('.rzap-readout-label').textContent = 'Threshold';

        // The marker on this drum's meters has to move with it, so wrap the readout's own sync.
        const sync = this._settingSyncs.pop();
        const withMark = () => {
            sync();
            this._placeMark(instrument, this._setting(key));
        };
        withMark();
        this._settingSyncs.push(withMark);
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
            // A trigger row reads its drum's fire count rather than the 0/1 channel; same mapping.
            instrument: TRIG_ENVELOPE[channel] || null,
        });
        return row;
    }

    /**
     * Say where these settings are coming from, and offer the way to them.
     *
     * The difference matters the moment you want a knob on a threshold: with no node these are the
     * built-in defaults and nothing can move them; on an Audio node each is a parameter like any
     * other, and MIDI learn, expressions, undo and the save file all reach it.
     */
    _syncSetupNote() {
        const node = this._setupNode();
        const note = this.panel.querySelector('#audio-setup-note');
        const add = this.panel.querySelector('#audio-add-setup');
        // Without a node these are the built-in defaults and nothing can change them, which is the
        // one thing this line has to make obvious — a readout with no way to it looks broken.
        note.textContent = node ? `on Audio #${node.id}` : 'defaults — no Audio node';
        add.textContent = node ? `Edit on Audio #${node.id}` : '+ Audio node to change these';
    }

    /**
     * Put an Audio node in the patch, carrying the settings as they stand.
     *
     * Seeded from the current values rather than from the defaults: the point of adding one is
     * usually to automate a threshold that has already been dialled in against the meters.
     */
    addSetupNode() {
        const editor = window.editor;
        if (!editor?.createNode) {
            window.updateStatus?.('Editor not ready', 'error');
            return null;
        }
        const existing = this._setupNode();
        if (existing) return existing;

        const { x, y } = this._deployPosition(editor);
        const node = editor.createNode('Audio', x - 220, y);
        if (!node) return null;

        editor.markDirty?.('audio-setup-added');
        editor.safeDraw?.();
        this._syncSetupNote();
        window.updateStatus?.('Added Audio node — its thresholds can be MIDI-mapped');
        return node;
    }

    /**
     * Put the settings in front of the artist where they can actually be changed: the patch's Audio
     * node, selected, with its parameters open. Adds the node first if the patch has none.
     *
     * This is the whole answer to "the panel shows a threshold I cannot drag". The readouts here
     * are next to the meters because that is where a threshold is JUDGED; it is changed on the
     * node, because that is where a number can be MIDI-mapped and saved.
     */
    editOnSetupNode() {
        const node = this._setupNode() || this.addSetupNode();
        if (!node) return null;

        const editor = window.editor;
        try {
            // The selection is a Set of node ids on the graph (see core/SelectionManager.js).
            if (editor?.graph) editor.graph.selection = new Set([node.id]);
        } catch {
            // Selection is a convenience; the parameters below are the point.
        }
        editor?.paramPanel?.showNodeParameters?.(node);
        editor?.safeDraw?.();
        this._syncSetupNote();
        return node;
    }

    /**
     * Draw this drum's threshold on its meter — the line a hit has to cross, against the signal it
     * is compared to. A knob mapped to the threshold slides it across the meter, which is the only
     * way to see whether the mapping is aimed anywhere useful.
     */
    _syncMarks(instrument) {
        this._placeMark(instrument, this._setting(`${instrument}Thresh`));
    }

    /** Position (creating on first use) the marker on this drum's meter row. */
    _placeMark(instrument, threshold) {
        const host = this._marks?.get(instrument);
        if (!host) return;
        if (!host.firstChild) {
            const mark = document.createElement('i');
            mark.className = 'rzap-bar-mark';
            host.appendChild(mark);
        }
        host.firstChild.style.left = `${Math.min(1, Math.max(0, threshold)) * 100}%`;
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
                // Parked on the element so describeAudioSource() can name the track anywhere.
                if (this.audioClient.audioElement) this.audioClient.audioElement.dataset.fileName = file.name;
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

        // The source tabs. Switching stops whatever is currently running: the analysis engine has
        // one input, and leaving a microphone open while the File tab is on screen would show a
        // transport that explains none of what the meters are doing.
        for (const tab of this.panel.querySelectorAll('.rzap-tab')) {
            tab.addEventListener('click', () => this._setSourceMode(tab.dataset.source));
        }

        const deviceSelect = this.panel.querySelector('#audio-input-device');
        deviceSelect.addEventListener('change', async () => {
            this._deviceId = deviceSelect.value;
            // Already listening: switch inputs there and then rather than making them press Stop
            // and Listen again to hear the change.
            if (this.audioClient?.liveKind === 'mic') await this._startLive();
        });

        this.panel.querySelector('#audio-live-toggle').addEventListener('click', async () => {
            if (this.audioClient?.liveKind) {
                this.audioClient.stopLiveInput();
                this._syncTransport();
                return;
            }
            await this._startLive();
        });

        this.panel.querySelector('#audio-add-setup')
            .addEventListener('click', () => this.editOnSetupNode());

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

    /**
     * Show one source's controls and make sure it is the only one that can be running.
     */
    _setSourceMode(mode) {
        if (!mode || mode === this._sourceMode) return;
        this._sourceMode = mode;
        this._loadError = null;

        // Whatever was running belonged to the tab we just left.
        this.audioClient?.stopLiveInput?.();
        if (mode !== 'file' && this._isFilePlaying()) this.audioClient?.pause?.();

        if (mode === 'mic') this._loadDevices();
        this._syncTransport();
    }

    /**
     * Fill the input picker.
     *
     * Device labels are blank until the page has been granted microphone access at least once, so
     * this runs again after a successful start and the placeholder names are replaced with real
     * ones. Until then the picker still works — the ids are real, only the labels are withheld.
     */
    async _loadDevices() {
        const devices = await (this.audioClient?.listInputDevices?.() || []);
        this._devices = devices;

        const select = this.panel.querySelector('#audio-input-device');
        if (!select) return;
        const wanted = this._deviceId || select.value || '';
        select.innerHTML = '';

        const auto = document.createElement('option');
        auto.value = '';
        auto.textContent = devices.length ? 'Default input' : 'No inputs found';
        select.appendChild(auto);

        for (const device of devices) {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label;
            select.appendChild(option);
        }
        select.value = devices.some((d) => d.deviceId === wanted) ? wanted : '';
        this._deviceId = select.value;
    }

    /** Open the live input the current tab describes, reporting whatever the browser says. */
    async _startLive() {
        if (this._starting) return;
        this._starting = true;
        this._loadError = null;
        this._syncTransport();
        try {
            await this.audioClient?.startLiveInput?.({
                kind: this._sourceMode === 'system' ? 'system' : 'mic',
                deviceId: this._sourceMode === 'mic' ? (this._deviceId || null) : null,
            });
            // Permission granted means the device labels are readable now.
            if (this._sourceMode === 'mic') await this._loadDevices();
        } catch (error) {
            // A denied permission and an unplugged interface look identical from a dead meter, so
            // say which it was rather than leaving the panel silent.
            this._loadError = this._liveErrorText(error);
        } finally {
            this._starting = false;
            this._syncTransport();
        }
    }

    /** The browser's DOMException names, in words that say what to do about it. */
    _liveErrorText(error) {
        const name = error?.name || '';
        if (name === 'NotAllowedError') {
            return this._sourceMode === 'system'
                ? 'Screen share was cancelled'
                : 'Microphone access was denied';
        }
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'That input is not available';
        if (name === 'NotReadableError') return 'Another app is using that input';
        return error?.message || 'Could not open that input';
    }

    /** Is the FILE transport playing? (A live input is playing, but not this.) */
    _isFilePlaying() {
        const el = this.audioClient?.audioElement;
        return !!el && !el.paused && !el.ended && el.readyState > 2;
    }

    /** One pass over the live values. */
    _refresh() {
        const taps = getAudioTapValues();

        for (const [channel, row] of this._rows) {
            // A trigger is one analysis step wide — 8 ms — and this poll runs at 20 Hz, so reading
            // the 0/1 channel would catch about one hit in six and the row would look broken on a
            // track that is plainly triggering. The fire COUNT cannot be missed: any hit since the
            // last poll is still in it, which is the same reason a node reads it (see
            // audioAnalysisTaps.js). So the number here is "did this drum fire since I last
            // looked", which is what a 20 Hz readout can honestly answer.
            const value = row.instrument
                ? (this._firedSince(row.instrument, taps) ? 1 : 0)
                : (typeof taps[channel] === 'number' ? taps[channel] : 0);
            // The bar shows the matching envelope's decay — the same hit, made visible for long
            // enough to see.
            const bar = row.envelope ? (taps[row.envelope] || 0) : value;
            row.fill.style.width = `${Math.min(1, Math.max(0, bar)) * 100}%`;
            row.value.textContent = value.toFixed(3);
        }

        // A setting can move without the panel: a knob mapped to a threshold, an expression on one,
        // the setup node being added, edited or deleted. Every control here reads it back.
        for (const sync of this._settingSyncs) sync();
        this._syncSetupNote();
        this._syncTransport();
    }

    /**
     * Has this drum fired since the last poll? Reading the count leaves nothing to chance about
     * when the poll happens to land relative to the 8 ms analysis step.
     */
    _firedSince(instrument, taps) {
        const count = taps.trigCount?.[instrument] || 0;
        const seen = this._trigSeen[instrument];
        this._trigSeen[instrument] = count;
        // First look: adopt the count rather than reporting every hit since the page loaded.
        return seen !== undefined && count > seen;
    }

    /** Is anything feeding the analysis right now? */
    _isPlaying() {
        if (this.audioClient?.liveKind) return true;
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
        const source = describeAudioSource();
        const hasFile = source.hasFile;
        const playing = source.playing;
        const position = el?.currentTime || 0;
        const duration = el && isFinite(el.duration) ? el.duration : 0;

        // Shorter wording here than on the node: the chip sits under a "SOURCE" heading, next to
        // the transport, so it does not have to repeat the word "audio".
        const CHIP = { empty: 'No file', ready: 'Ready', paused: 'Paused', playing: 'Playing' };
        // On a live tab the chip is about the live input, not about whatever the file transport was
        // left doing — "Paused" next to a Listen button describes nothing the user can see.
        const idleLive = this._sourceMode !== 'file' && !source.live;
        const state = this._loadError ? 'error' : (idleLive ? 'empty' : source.state);
        const label = this._loadError
            || (source.live ? (source.fileName || source.label) : null)
            || (idleLive ? 'Not listening' : (CHIP[source.state] || source.label));

        // One tab's controls at a time, and the tab row shows which.
        const mode = this._sourceMode;
        for (const tab of this.panel.querySelectorAll('.rzap-tab')) {
            const on = tab.dataset.source === mode;
            tab.classList.toggle('is-on', on);
            tab.setAttribute('aria-pressed', String(on));
        }
        this.panel.querySelector('#audio-file-block').hidden = mode !== 'file';
        const liveBlock = this.panel.querySelector('#audio-live-block');
        liveBlock.hidden = mode === 'file';
        if (mode !== 'file') this._syncLive(mode);

        // Nothing is playing, so every channel below reads zero. Say it where the zeros are, not
        // only up here — a node deployed from a silent panel looks broken otherwise, and the way
        // out of it depends on which source tab they are on.
        const silent = this.panel.querySelector('#audio-silent');
        silent.hidden = playing;
        silent.textContent = this._sourceMode === 'file'
            ? 'Nothing is playing, so every channel reads 0 — and so does any node reading one. Load a track above and press Play.'
            : 'Nothing is playing, so every channel reads 0 — and so does any node reading one. Press Listen above.';

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

    /** The live block: device picker for the mic, one button, and what to expect. */
    _syncLive(mode) {
        const listening = this.audioClient?.liveKind || null;
        const mine = listening === (mode === 'system' ? 'system' : 'mic');

        this.panel.querySelector('#audio-device-row').hidden = mode !== 'mic';

        const toggle = this.panel.querySelector('#audio-live-toggle');
        toggle.textContent = this._starting ? '… Opening' : (mine ? '⏹ Stop listening' : '● Listen');
        toggle.disabled = this._starting;
        toggle.classList.toggle('is-playing', mine);

        const note = this.panel.querySelector('#audio-live-note');
        if (mine) {
            // Nothing is monitored back out, and a silent panel with live meters would otherwise
            // read as broken.
            note.textContent = mode === 'system'
                ? 'Analysing shared audio. Nothing is played back — you still hear it from its own tab.'
                : 'Analysing the input. Nothing is played back, so there is no feedback loop.';
        } else if (mode === 'system') {
            note.textContent = 'Pick a tab, window or screen and tick "Share audio" — without it the stream arrives silent.';
        } else {
            note.textContent = 'Uses the browser\u2019s microphone permission. Echo cancellation and auto‑gain are turned off so the meters follow the music.';
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
            if (this._sourceMode === 'mic') this._loadDevices();
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
                /* Clear of the parameter panel, which lives against the right edge: adding an Audio
                   node opens this panel AND selects the node, and covering the node's own controls
                   with the thing that explains them is the one place they must not overlap.
                   Draggable from the header either way. */
                right: 330px;
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

            .rzap-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 14px 14px; }
            .rzap-sec { padding: 12px 0; border-bottom: 1px solid var(--rz-line); }
            .rzap-sec:last-child { border-bottom: none; }
            .rzap-sec-title {
                display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
                font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase;
                color: var(--rz-text-3); margin-bottom: 8px;
            }
            .rzap-hint { text-transform: none; letter-spacing: 0; color: var(--rz-text-faint); }
            .rzap-note { margin: 0 0 8px; color: var(--rz-text-faint); font-size: 11px; line-height: 1.45; }
            .rzap-warn {
                color: var(--rz-warn); background: var(--rz-warn-soft);
                border-radius: 6px; padding: 7px 9px;
            }
            .rzap-note code {
                background: var(--rz-well); color: var(--rz-accent);
                padding: 1px 4px; border-radius: 3px; font-family: var(--rz-font-mono);
            }
            .rzap-foot { padding-bottom: 4px; }

            /* What the player is doing, in words, where the eye lands first. */
            .rzap-state {
                display: inline-flex; align-items: center; gap: 5px;
                text-transform: none; letter-spacing: 0; color: var(--rz-text-3);
                /* A device name is whatever the driver calls it — "Default - Scarlett 2i2 USB
                   (1235:8210)" is a real one — and the heading it shares a line with must not be
                   pushed off the panel by it. */
                max-width: 62%; min-width: 0; overflow: hidden;
                text-overflow: ellipsis; white-space: nowrap;
            }
            .rzap-state #audio-state-text {
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .rzap-state .rzap-dot { flex: none; }
            .rzap-dot {
                width: 6px; height: 6px; border-radius: 50%;
                background: var(--rz-text-disabled);
            }
            .rzap-state[data-state="ready"] .rzap-dot { background: var(--rz-text-3); }
            .rzap-state[data-state="paused"] { color: var(--rz-warn); }
            .rzap-state[data-state="paused"] .rzap-dot { background: var(--rz-warn); }
            .rzap-state[data-state="error"] { color: var(--rz-error); }
            .rzap-state[data-state="error"] .rzap-dot { background: var(--rz-error); }
            .rzap-state[data-state="live"] { color: var(--rz-accent); }
            .rzap-state[data-state="live"] .rzap-dot { background: var(--rz-accent); }
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

            /* Source tabs: which input the controls below belong to. */
            .rzap-tabs { display: flex; gap: 2px; margin-bottom: 8px; }
            .rzap-tab {
                flex: 1; padding: 5px 4px; border: 1px solid var(--rz-line); border-radius: 6px;
                background: transparent; color: var(--rz-text-3);
                font-family: var(--rz-font-ui); font-size: 10px; cursor: pointer;
            }
            .rzap-tab:hover { background: var(--rz-hover); color: var(--rz-text); }
            .rzap-tab.is-on {
                color: var(--rz-accent); border-color: var(--rz-accent-30);
                background: var(--rz-accent-08);
            }

            .rzap-device {
                display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
                font-size: 11px; color: var(--rz-text-3);
            }
            /* The display:flex above and the UA stylesheet's [hidden] rule have equal specificity,
               so the later one wins — which is this stylesheet's, and the row stayed on screen
               (empty) on the System tab. */
            .rzap-device[hidden] { display: none; }
            .rzap-device select {
                flex: 1; min-width: 0; padding: 5px 6px; border-radius: 6px;
                border: 1px solid var(--rz-line-strong); background: var(--rz-surface-raised);
                color: var(--rz-text); font-family: var(--rz-font-ui); font-size: 11px;
            }
            #audio-live-note { margin-top: 8px; }

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
            .rzap-add-setup { width: 100%; margin-top: 8px; color: var(--rz-text-2); }
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

            /* A setting, shown but not set here. Deliberately not a disabled slider: a greyed-out
               control reads as broken, where a bar and a number read as a reading. */
            .rzap-readout {
                display: grid; grid-template-columns: 62px 1fr 62px; align-items: center;
                gap: 8px; margin-bottom: 6px;
            }
            .rzap-readout-label { color: var(--rz-text-2); font-size: 11px; }
            .rzap-readout-track {
                height: 4px; border-radius: 2px; background: var(--rz-fill-soft); overflow: hidden;
            }
            .rzap-readout-fill {
                display: block; height: 100%; width: 0%; border-radius: 2px;
                background: var(--rz-text-faint);
            }
            .rzap-readout-value {
                text-align: right; font-family: var(--rz-font-mono); font-size: 10px;
                color: var(--rz-text-3); overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap;
            }
            .rzap-readout.is-thresh .rzap-readout-label { color: var(--rz-accent); }
            .rzap-readout.is-thresh .rzap-readout-fill { background: var(--rz-accent); }
            /* Driven by an expression (=midi, an LFO): the value shown is what it evaluated to. */
            .rzap-readout.is-driven .rzap-readout-value {
                color: var(--rz-audio); font-family: var(--rz-font-mono);
            }
            .rzap-readout.is-driven .rzap-readout-value::after {
                content: " fx"; font-size: 8px; opacity: 0.8;
            }

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
