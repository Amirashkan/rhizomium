/**
 * ExportPanel.js - One window that holds a whole export.
 *
 * What an artist wants from an export is a small, fixed set of decisions: still
 * or moving, how big, how long, how good, what it is called. Those decisions
 * used to be scattered - the size in the settings window, the frame rate and
 * the length in two modal prompts that arrived one after the other once the
 * export had already started, the quality nowhere at all - so the only way to
 * find out what you were about to get was to make it and look at the file.
 *
 * This panel puts all of them on one surface, next to a line that says what the
 * result will be ("1920 × 1080 · 10s · 60 fps · ~18.4 MB · MP4") and updates as
 * they are changed. Nothing is asked once Export is pressed.
 *
 * Size stays owned by OutputFormat.js - the panel writes the export role's
 * target and reads it back rather than keeping a copy - and it is offered as a
 * multiple of the composition rather than free pixels, so an export cannot
 * quietly acquire an aspect ratio the piece was never composed in. Custom is
 * still there for the case that needs it, with the ratio held by default.
 */

import { makeDraggable } from './utils/draggable.js';
import { canRecordAudio, isVideoExportSupported, runExport } from './exportRender.js';
import { AUDIO_BITRATE, selectRecordingMimeType } from '../audio/recordingAudio.js';
import {
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  getExportTarget,
  getOutputFormat,
  resolveResolution,
  setExportTarget,
  subscribeOutputFormat,
} from './OutputFormat.js';
import {
  FPS_PRESETS,
  MAX_DURATION,
  MAX_FPS,
  MIN_DURATION,
  MIN_FPS,
  VIDEO_QUALITY_STEPS,
  buildExportFilename,
  describeExport,
  getExportSettings,
  resetExportSettings,
  setExportSettings,
  subscribeExportSettings,
} from './exportSettings.js';

/**
 * Export sizes offered as multiples of the composition. A multiple is the
 * question artists actually have ("the same thing, but bigger for print"),
 * and unlike a list of pixel presets it cannot reshape the image.
 */
const SCALE_OPTIONS = [0.5, 1, 2, 3, 4];

/** Lengths worth one click; anything else is typed. */
const DURATION_CHIPS = [3, 5, 10, 15, 30, 60];

const STYLE_ID = 'export-panel-styles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #export-panel {
      position: fixed;
      width: 380px;
      max-width: 92vw;
      max-height: 86vh;
      display: flex;
      flex-direction: column;
      background: var(--rz-surface, #141110);
      border: 1px solid var(--rz-line-strong, rgba(255,244,230,0.13));
      border-radius: var(--rz-r-window, 14px);
      box-shadow: var(--rz-shadow-window, 0 30px 80px -20px rgba(0,0,0,0.75));
      color: var(--rz-text, #f3ede4);
      font-family: var(--rz-font-ui, system-ui, sans-serif);
      font-size: 13px;
      z-index: 1002;
      opacity: 0;
      transform: scale(0.97);
      transition: opacity 0.16s ease, transform 0.16s ease;
      overflow: hidden;
    }

    #export-panel.visible { opacity: 1; transform: scale(1); }

    #export-panel .ep-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: var(--rz-fill-soft, rgba(255,244,230,0.05));
      border-bottom: 1px solid var(--rz-line, rgba(255,244,230,0.08));
      cursor: move;
      flex-shrink: 0;
    }

    #export-panel .ep-title { font-size: 14px; font-weight: 600; }

    #export-panel .ep-close {
      background: transparent;
      border: none;
      color: var(--rz-text-2, #cabfb0);
      font-size: 18px;
      line-height: 1;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      cursor: pointer;
    }
    #export-panel .ep-close:hover {
      background: var(--rz-hover, rgba(255,244,230,0.07));
      color: var(--rz-text, #f3ede4);
    }

    #export-panel .ep-body {
      padding: 14px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    #export-panel .ep-field { margin-bottom: 14px; }
    /* Only the last field on the panel loses its gap - the video group's last
       field still has the file name below it. */
    #export-panel .ep-body > .ep-field:last-child { margin-bottom: 0; }

    #export-panel .ep-label {
      display: block;
      color: var(--rz-text-2, #cabfb0);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    #export-panel .ep-note {
      color: var(--rz-text-3, #8f867a);
      font-size: 11px;
      line-height: 1.45;
      margin-top: 6px;
    }

    #export-panel select,
    #export-panel input[type="text"],
    #export-panel input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 8px;
      background: var(--rz-well, #0f0c0a);
      border: 1px solid var(--rz-line-strong, rgba(255,244,230,0.13));
      border-radius: var(--rz-r-field, 8px);
      color: var(--rz-text, #f3ede4);
      font-family: inherit;
      font-size: 12px;
    }
    #export-panel input[type="number"] { font-family: var(--rz-font-mono, monospace); }
    #export-panel select:focus,
    #export-panel input:focus {
      outline: none;
      border-color: var(--rz-accent-30, rgba(198,242,78,0.3));
    }

    /* Segmented control: the one decision that changes what the rest of the
       panel is even about, so it reads as a switch rather than a dropdown. */
    #export-panel .ep-segments {
      display: flex;
      gap: 4px;
      padding: 3px;
      background: var(--rz-well, #0f0c0a);
      border: 1px solid var(--rz-line, rgba(255,244,230,0.08));
      border-radius: var(--rz-r-row, 10px);
    }

    #export-panel .ep-segment {
      flex: 1;
      padding: 7px 8px;
      background: transparent;
      border: none;
      border-radius: 7px;
      color: var(--rz-text-2, #cabfb0);
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    #export-panel .ep-segment:hover:not(.active) {
      background: var(--rz-hover, rgba(255,244,230,0.07));
      color: var(--rz-text, #f3ede4);
    }
    #export-panel .ep-segment.active {
      background: var(--rz-accent, #c6f24e);
      color: var(--rz-accent-ink, #14110a);
      font-weight: 600;
    }

    #export-panel .ep-row { display: flex; gap: 8px; }
    #export-panel .ep-row > * { flex: 1; min-width: 0; }

    #export-panel .ep-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

    #export-panel .ep-chip {
      padding: 5px 10px;
      background: var(--rz-fill-soft, rgba(255,244,230,0.05));
      border: 1px solid var(--rz-line, rgba(255,244,230,0.08));
      border-radius: var(--rz-r-pill, 999px);
      color: var(--rz-text-2, #cabfb0);
      font-family: var(--rz-font-mono, monospace);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    #export-panel .ep-chip:hover {
      background: var(--rz-hover, rgba(255,244,230,0.07));
      color: var(--rz-text, #f3ede4);
    }
    #export-panel .ep-chip.active {
      background: var(--rz-accent-14, rgba(198,242,78,0.14));
      border-color: var(--rz-accent-30, rgba(198,242,78,0.3));
      color: var(--rz-accent, #c6f24e);
    }

    #export-panel .ep-check {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      font-size: 12.5px;
    }
    #export-panel .ep-check input {
      width: 15px;
      height: 15px;
      margin: 1px 0 0 0;
      accent-color: var(--rz-accent, #c6f24e);
      cursor: pointer;
      flex-shrink: 0;
    }
    #export-panel .ep-check.disabled { opacity: 0.5; cursor: default; }
    #export-panel .ep-check.disabled input { cursor: default; }

    /* The answer to "what am I about to get?", kept in one place so it is
       never necessary to add up the controls above by eye. */
    #export-panel .ep-summary {
      padding: 10px 12px;
      background: var(--rz-fill-soft, rgba(255,244,230,0.05));
      border: 1px solid var(--rz-line, rgba(255,244,230,0.08));
      border-radius: var(--rz-r-card, 12px);
      margin-bottom: 12px;
    }

    #export-panel .ep-summary-line {
      font-family: var(--rz-font-mono, monospace);
      font-size: 11.5px;
      color: var(--rz-text, #f3ede4);
      line-height: 1.5;
      word-break: break-word;
    }

    #export-panel .ep-summary-file {
      font-family: var(--rz-font-mono, monospace);
      font-size: 10.5px;
      color: var(--rz-text-3, #8f867a);
      margin-top: 5px;
      word-break: break-all;
    }

    #export-panel .ep-warning {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--rz-line, rgba(255,244,230,0.08));
      color: var(--rz-warn, #f5a524);
      font-size: 11px;
      line-height: 1.45;
    }

    #export-panel .ep-footer {
      padding: 12px 14px;
      border-top: 1px solid var(--rz-line, rgba(255,244,230,0.08));
      background: var(--rz-fill-soft, rgba(255,244,230,0.05));
      flex-shrink: 0;
    }

    #export-panel .ep-export {
      width: 100%;
      padding: 10px 12px;
      background: var(--rz-accent, #c6f24e);
      border: 1px solid var(--rz-accent, #c6f24e);
      border-radius: var(--rz-r-field, 8px);
      color: var(--rz-accent-ink, #14110a);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    #export-panel .ep-export:hover:not(:disabled) { background: var(--rz-accent-hover, #d7f877); }
    #export-panel .ep-export:disabled { opacity: 0.45; cursor: not-allowed; }

    #export-panel .ep-reset {
      display: block;
      margin: 8px auto 0;
      background: none;
      border: none;
      color: var(--rz-text-3, #8f867a);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      text-decoration: underline;
    }
    #export-panel .ep-reset:hover { color: var(--rz-text, #f3ede4); }
  `;
  document.head.appendChild(style);
}

/** The container a recording would land in, described for a human. */
function containerInfo() {
  const mimeType = selectRecordingMimeType({ withAudio: false });
  if (!mimeType) return { extension: 'mp4', label: '', supported: false };
  const isMp4 = mimeType.includes('mp4');
  return {
    extension: isMp4 ? 'mp4' : 'webm',
    label: isMp4 ? 'MP4' : 'WebM',
    supported: true,
  };
}

export class ExportPanel {
  constructor() {
    this.panel = null;
    this.controls = {};
    this.cleanupDraggable = null;
    this.unsubscribes = [];
    this.exporting = false;
    // Custom sizes start locked to the composition's ratio: an export is
    // almost always the same image at a different size, and the rare case that
    // is not can say so by unticking one box.
    this.lockAspect = true;
    // Whether the artist asked for Custom, as opposed to landing on a size
    // that happens to be a multiple. Picking Custom has to open the fields
    // even when the current size is exactly the output format - which it
    // always is at the moment of picking - or the choice does nothing.
    this.customMode = false;
  }

  get isOpen() {
    return !!this.panel && this.panel.style.display !== 'none';
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show() {
    if (this.panel) {
      this.panel.style.display = 'flex';
      requestAnimationFrame(() => this.panel.classList.add('visible'));
      this._refresh();
      return;
    }

    injectStyles();
    this._build();
    this._refresh();
  }

  hide() {
    if (!this.panel) return;
    this.panel.classList.remove('visible');
    setTimeout(() => {
      if (this.panel) this.panel.style.display = 'none';
    }, 180);
  }

  destroy() {
    this.cleanupDraggable?.();
    this.unsubscribes.forEach((off) => off());
    this.unsubscribes = [];
    this.panel?.remove();
    this.panel = null;
    this.controls = {};
  }

  // ------------------------------------------------------------------ build

  _build() {
    const panel = document.createElement('div');
    panel.id = 'export-panel';
    this.panel = panel;

    const header = document.createElement('div');
    header.className = 'ep-header';

    const title = document.createElement('div');
    title.className = 'ep-title';
    title.textContent = 'Export';

    const close = document.createElement('button');
    close.className = 'ep-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.hide();

    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'ep-body custom-scroll';
    body.append(
      this._buildFormatField(),
      this._buildSizeField(),
      this._buildVideoFields(),
      this._buildFilenameField(),
    );

    const footer = document.createElement('div');
    footer.className = 'ep-footer';

    const summary = document.createElement('div');
    summary.className = 'ep-summary';
    const summaryLine = document.createElement('div');
    summaryLine.className = 'ep-summary-line';
    const summaryFile = document.createElement('div');
    summaryFile.className = 'ep-summary-file';
    const warning = document.createElement('div');
    warning.className = 'ep-warning';
    warning.style.display = 'none';
    summary.append(summaryLine, summaryFile, warning);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'ep-export';
    exportBtn.textContent = 'Export';
    exportBtn.onclick = () => this._runExport();

    const reset = document.createElement('button');
    reset.className = 'ep-reset';
    reset.textContent = 'Reset export settings';
    reset.onclick = () => {
      resetExportSettings('exportPanel');
      setExportTarget({ mode: 'output' }, 'exportPanel');
      this.lockAspect = true;
      this.customMode = false;
      this._refresh();
    };

    footer.append(summary, exportBtn, reset);
    panel.append(header, body, footer);
    document.body.appendChild(panel);

    this.controls.summaryLine = summaryLine;
    this.controls.summaryFile = summaryFile;
    this.controls.warning = warning;
    this.controls.exportBtn = exportBtn;

    // Centre once, then hand over to left/top so dragging works.
    panel.style.left = `${Math.max(12, (window.innerWidth - panel.offsetWidth) / 2)}px`;
    panel.style.top = `${Math.max(12, (window.innerHeight - panel.offsetHeight) / 2)}px`;

    requestAnimationFrame(() => {
      panel.classList.add('visible');
      this.cleanupDraggable = makeDraggable(panel, header);
    });

    // The size lives in OutputFormat and the rest in exportSettings; either can
    // be moved from elsewhere (the settings window, a loaded project), so the
    // panel follows both rather than trusting its own controls.
    // Every control writes to the store and reads the result back rather than
    // updating itself, so a change made here and a change made elsewhere land
    // the same way and the panel can never disagree with what will be exported.
    this.unsubscribes.push(
      subscribeOutputFormat(() => this._refresh()),
      subscribeExportSettings(() => this._refresh()),
    );
  }

  _buildFormatField() {
    const field = document.createElement('div');
    field.className = 'ep-field';

    const label = document.createElement('label');
    label.className = 'ep-label';
    label.textContent = 'What to export';

    const segments = document.createElement('div');
    segments.className = 'ep-segments';

    const options = [
      { value: 'png', label: 'Still frame' },
      { value: 'video', label: 'Video' },
    ];
    this.controls.formatSegments = options.map(({ value, label: text }) => {
      const button = document.createElement('button');
      button.className = 'ep-segment';
      button.dataset.value = value;
      button.textContent = text;
      button.onclick = () => setExportSettings({ format: value }, 'exportPanel');
      segments.appendChild(button);
      return button;
    });

    field.append(label, segments);
    return field;
  }

  _buildSizeField() {
    const field = document.createElement('div');
    field.className = 'ep-field';

    const label = document.createElement('label');
    label.className = 'ep-label';
    label.textContent = 'Size';

    const select = document.createElement('select');
    select.onchange = () => {
      if (select.value === 'custom') {
        this.customMode = true;
        const current = resolveResolution('export');
        setExportTarget({ mode: 'custom', ...current }, 'exportPanel');
      } else {
        this.customMode = false;
        const size = this._scaledOutput(Number(select.value));
        setExportTarget(
          Number(select.value) === 1 ? { mode: 'output' } : { mode: 'custom', ...size },
          'exportPanel',
        );
      }
      this._refresh();
    };

    const customRow = document.createElement('div');
    customRow.className = 'ep-row';
    customRow.style.marginTop = '8px';

    const width = this._numberInput(MIN_WIDTH, MAX_WIDTH, 'Width');
    const height = this._numberInput(MIN_HEIGHT, MAX_HEIGHT, 'Height');

    const commitCustom = (changed) => {
      const aspect = getOutputFormat().width / getOutputFormat().height;
      let w = parseInt(width.value, 10);
      let h = parseInt(height.value, 10);

      if (this.lockAspect && aspect > 0) {
        if (changed === 'width') h = Math.round(w / aspect);
        else w = Math.round(h * aspect);
      }

      setExportTarget({ mode: 'custom', width: w, height: h }, 'exportPanel');
      this._refresh();
    };
    width.addEventListener('change', () => commitCustom('width'));
    height.addEventListener('change', () => commitCustom('height'));

    customRow.append(width, height);

    const lock = this._checkbox('Keep the composition’s aspect ratio', (checked) => {
      this.lockAspect = checked;
    });
    lock.container.style.marginTop = '8px';
    lock.input.checked = this.lockAspect;

    const note = document.createElement('div');
    note.className = 'ep-note';

    field.append(label, select, customRow, lock.container, note);

    this.controls.sizeSelect = select;
    this.controls.customRow = customRow;
    this.controls.customWidth = width;
    this.controls.customHeight = height;
    this.controls.aspectLock = lock;
    this.controls.sizeNote = note;

    return field;
  }

  _buildVideoFields() {
    const group = document.createElement('div');
    this.controls.videoGroup = group;

    // ---- Duration
    const durationField = document.createElement('div');
    durationField.className = 'ep-field';

    const durationLabel = document.createElement('label');
    durationLabel.className = 'ep-label';
    durationLabel.textContent = 'Duration (seconds)';

    const duration = this._numberInput(MIN_DURATION, MAX_DURATION, 'Seconds');
    duration.step = '0.5';
    duration.addEventListener('change', () =>
      setExportSettings({ duration: Number(duration.value) }, 'exportPanel'),
    );

    const durationChips = document.createElement('div');
    durationChips.className = 'ep-chips';
    this.controls.durationChips = DURATION_CHIPS.map((seconds) => {
      const chip = document.createElement('button');
      chip.className = 'ep-chip';
      chip.dataset.value = String(seconds);
      chip.textContent = `${seconds}s`;
      chip.onclick = () => setExportSettings({ duration: seconds }, 'exportPanel');
      durationChips.appendChild(chip);
      return chip;
    });

    durationField.append(durationLabel, duration, durationChips);

    // ---- Frame rate + quality, side by side: two small choices, one row.
    const row = document.createElement('div');
    row.className = 'ep-field ep-row';

    const fpsField = document.createElement('div');
    const fpsLabel = document.createElement('label');
    fpsLabel.className = 'ep-label';
    fpsLabel.textContent = 'Frame rate';
    const fpsSelect = document.createElement('select');
    FPS_PRESETS.forEach((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} fps`;
      fpsSelect.appendChild(option);
    });
    const customFps = document.createElement('option');
    customFps.value = 'custom';
    customFps.textContent = 'Custom…';
    fpsSelect.appendChild(customFps);

    const fpsInput = this._numberInput(MIN_FPS, MAX_FPS, 'fps');
    fpsInput.style.marginTop = '6px';
    fpsInput.addEventListener('change', () =>
      setExportSettings({ fps: Number(fpsInput.value) }, 'exportPanel'),
    );

    fpsSelect.onchange = () => {
      if (fpsSelect.value === 'custom') {
        fpsInput.style.display = 'block';
        fpsInput.focus();
      } else {
        setExportSettings({ fps: Number(fpsSelect.value) }, 'exportPanel');
      }
    };
    fpsField.append(fpsLabel, fpsSelect, fpsInput);

    const qualityField = document.createElement('div');
    const qualityLabel = document.createElement('label');
    qualityLabel.className = 'ep-label';
    qualityLabel.textContent = 'Quality';
    const qualitySelect = document.createElement('select');
    VIDEO_QUALITY_STEPS.forEach((step) => {
      const option = document.createElement('option');
      option.value = step.id;
      option.textContent = step.label;
      qualitySelect.appendChild(option);
    });
    qualitySelect.onchange = () =>
      setExportSettings({ quality: qualitySelect.value }, 'exportPanel');
    qualityField.append(qualityLabel, qualitySelect);

    row.append(fpsField, qualityField);

    // ---- Audio
    const audioField = document.createElement('div');
    audioField.className = 'ep-field';
    const audio = this._checkbox('Record the loaded audio track', (checked) =>
      setExportSettings({ includeAudio: checked }, 'exportPanel'),
    );
    const audioNote = document.createElement('div');
    audioNote.className = 'ep-note';
    audioField.append(audio.container, audioNote);

    group.append(durationField, row, audioField);

    this.controls.duration = duration;
    this.controls.fpsSelect = fpsSelect;
    this.controls.fpsInput = fpsInput;
    this.controls.quality = qualitySelect;
    this.controls.audio = audio;
    this.controls.audioNote = audioNote;

    return group;
  }

  _buildFilenameField() {
    const field = document.createElement('div');
    field.className = 'ep-field';

    const label = document.createElement('label');
    label.className = 'ep-label';
    label.textContent = 'File name';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'shader';
    input.maxLength = 64;
    const commit = () => {
      setExportSettings({ filenamePrefix: input.value }, 'exportPanel');
      this._refreshSummary();
    };
    input.addEventListener('change', commit);
    input.addEventListener('input', () => this._refreshSummary(input.value));

    const note = document.createElement('div');
    note.className = 'ep-note';
    note.textContent = 'Size and time are appended, so repeated exports never overwrite each other.';

    field.append(label, input, note);
    this.controls.filename = input;
    return field;
  }

  // --------------------------------------------------------------- controls

  _numberInput(min, max, placeholder) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.placeholder = placeholder;
    return input;
  }

  _checkbox(text, onChange) {
    const container = document.createElement('label');
    container.className = 'ep-check';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => onChange(input.checked));

    const span = document.createElement('span');
    span.textContent = text;

    container.append(input, span);
    return { container, input, label: span };
  }

  /** The composition at a multiple of itself, clamped to what is exportable. */
  _scaledOutput(scale) {
    const output = getOutputFormat();
    return {
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(output.width * scale))),
      height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(output.height * scale))),
    };
  }

  /** Scales that fit inside the export limits, so no option is a dead end. */
  _availableScales() {
    const output = getOutputFormat();
    return SCALE_OPTIONS.filter(
      (scale) =>
        scale <= 1 ||
        (Math.round(output.width * scale) <= MAX_WIDTH &&
          Math.round(output.height * scale) <= MAX_HEIGHT),
    );
  }

  // ------------------------------------------------------------------- sync

  _refresh() {
    if (!this.panel) return;

    const settings = getExportSettings();
    const isVideo = settings.format === 'video';

    this.controls.formatSegments?.forEach((button) => {
      button.classList.toggle('active', button.dataset.value === settings.format);
    });

    this._refreshSizeControls();

    if (this.controls.videoGroup) {
      this.controls.videoGroup.style.display = isVideo ? 'block' : 'none';
    }

    if (this.controls.duration && document.activeElement !== this.controls.duration) {
      this.controls.duration.value = String(settings.duration);
    }
    this.controls.durationChips?.forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.value) === settings.duration);
    });

    const { fpsSelect, fpsInput } = this.controls;
    if (fpsSelect && fpsInput) {
      const isPreset = FPS_PRESETS.includes(settings.fps);
      fpsSelect.value = isPreset ? String(settings.fps) : 'custom';
      fpsInput.style.display = isPreset ? 'none' : 'block';
      if (document.activeElement !== fpsInput) fpsInput.value = String(settings.fps);
    }

    if (this.controls.quality) this.controls.quality.value = settings.quality;

    const audioAvailable = canRecordAudio();
    const { audio, audioNote } = this.controls;
    if (audio) {
      audio.input.checked = settings.includeAudio && audioAvailable;
      audio.input.disabled = !audioAvailable;
      audio.container.classList.toggle('disabled', !audioAvailable);
    }
    if (audioNote) {
      audioNote.textContent = audioAvailable
        ? 'The video carries the music the patch is reacting to, in sync. Playback starts from where the playhead sits now.'
        : 'No audio file is loaded, so the recording will be silent.';
    }

    if (this.controls.filename && document.activeElement !== this.controls.filename) {
      this.controls.filename.value = settings.filenamePrefix;
    }

    this._refreshSummary();
  }

  _refreshSizeControls() {
    const { sizeSelect, customRow, customWidth, customHeight, aspectLock, sizeNote } = this.controls;
    if (!sizeSelect) return;

    const output = getOutputFormat();
    const target = getExportTarget();
    const size = resolveResolution('export');

    // Rebuild the options each time: their labels carry the pixel sizes, which
    // move whenever the composition does.
    const scales = this._availableScales();
    sizeSelect.replaceChildren();
    scales.forEach((scale) => {
      const scaled = this._scaledOutput(scale);
      const option = document.createElement('option');
      option.value = String(scale);
      const name = scale === 1 ? 'Output format' : `${scale}× output`;
      option.textContent = `${name} — ${scaled.width} × ${scaled.height}`;
      sizeSelect.appendChild(option);
    });
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom…';
    sizeSelect.appendChild(custom);

    const matchedScale =
      target.mode === 'output'
        ? 1
        : scales.find((scale) => {
            const scaled = this._scaledOutput(scale);
            return scaled.width === size.width && scaled.height === size.height;
          });

    const showCustom = this.customMode || !matchedScale;
    sizeSelect.value = showCustom ? 'custom' : String(matchedScale);
    if (customRow) customRow.style.display = showCustom ? 'flex' : 'none';
    if (aspectLock) aspectLock.container.style.display = showCustom ? 'flex' : 'none';
    if (customWidth && document.activeElement !== customWidth) customWidth.value = String(size.width);
    if (customHeight && document.activeElement !== customHeight) {
      customHeight.value = String(size.height);
    }

    if (sizeNote) {
      const sim = resolveResolution('sim');
      const sameShape =
        Math.abs(size.width / size.height - output.width / output.height) < 0.01;
      sizeNote.textContent = sameShape
        ? `The composite is re-rendered at this size; the internal sims stay at ${sim.width} × ${sim.height}, so their detail does not change.`
        : `This is a different shape from the composition (${output.width} × ${output.height}), so the export will not be framed the way the preview is.`;
    }
  }

  /**
   * The one line that says what pressing Export produces. `draftPrefix` lets it
   * follow a filename being typed before that edit is committed.
   */
  _refreshSummary(draftPrefix) {
    const { summaryLine, summaryFile, warning, exportBtn } = this.controls;
    if (!summaryLine) return;

    const settings = getExportSettings();
    const size = resolveResolution('export');
    const isVideo = settings.format === 'video';
    const container = containerInfo();
    const audioBitrate = isVideo && settings.includeAudio && canRecordAudio() ? AUDIO_BITRATE : 0;

    const description = describeExport({
      format: settings.format,
      width: size.width,
      height: size.height,
      fps: settings.fps,
      duration: settings.duration,
      quality: settings.quality,
      audioBitrate,
      containerLabel: isVideo ? container.label : '',
    });

    summaryLine.textContent = description.summary;
    summaryFile.textContent = buildExportFilename({
      prefix: draftPrefix ?? settings.filenamePrefix,
      width: size.width,
      height: size.height,
      fps: isVideo ? settings.fps : 0,
      extension: isVideo ? container.extension : 'png',
    });

    const messages = [];
    if (isVideo && !isVideoExportSupported()) {
      messages.push('This browser cannot record the canvas. Try a Chromium-based browser.');
    } else if (isVideo && container.label === 'WebM') {
      messages.push('MP4 is not available in this browser, so the file will be WebM.');
    }
    if (isVideo && description.estimatedBytes > 512 * 1024 * 1024) {
      messages.push('That is a large file — a shorter clip or a lower quality will bring it down.');
    }

    warning.textContent = messages.join(' ');
    warning.style.display = messages.length ? 'block' : 'none';

    if (exportBtn && !this.exporting) {
      exportBtn.textContent = isVideo ? 'Export video' : 'Export PNG';
      exportBtn.disabled = isVideo && !isVideoExportSupported();
    }
  }

  async _runExport() {
    if (this.exporting) return;

    const { exportBtn } = this.controls;
    this.exporting = true;
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting…';
    }

    // Out of the way: the panel sits over the preview, and the exporter resizes
    // the very canvas the artist wants to watch while it records.
    const wasOpen = this.isOpen;
    this.hide();

    try {
      await runExport();
    } finally {
      this.exporting = false;
      if (wasOpen) this.show();
      else this._refreshSummary();
    }
  }
}

let instance = null;

/** The one export panel. Created on first use. */
export function getExportPanel() {
  if (!instance) instance = new ExportPanel();
  return instance;
}

export function showExportPanel() {
  getExportPanel().show();
}

export function toggleExportPanel() {
  getExportPanel().toggle();
}
