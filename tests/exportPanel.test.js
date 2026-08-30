import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExportPanel } from '../src/ui/ExportPanel.js';
import {
  describeExport,
  getExportSettings,
  resetExportSettings,
  setExportSettings,
} from '../src/ui/exportSettings.js';
import {
  getExportTarget,
  resolveResolution,
  setExportTarget,
  setOutputFormat,
} from '../src/ui/OutputFormat.js';

/** A canvas the panel can believe in, without a GPU behind it. */
function stubPreview() {
  window.floatingPreview = { gpuCanvas: { captureStream: () => ({}) } };
}

function stubMediaRecorder(supported) {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type) => supported.includes(type) });
}

let panel;

beforeEach(() => {
  document.body.innerHTML = '';
  resetExportSettings('test');
  setOutputFormat(1920, 1080, 'test');
  setExportTarget({ mode: 'output' }, 'test');
  stubPreview();
  stubMediaRecorder(['video/mp4;codecs=avc1.42E01E']);
  panel = new ExportPanel();
  panel.show();
});

afterEach(() => {
  panel.destroy();
  delete window.floatingPreview;
  delete window.audioCapture;
  vi.unstubAllGlobals();
});

const summaryText = () => document.querySelector('#export-panel .ep-summary-line').textContent;
const filenameText = () => document.querySelector('#export-panel .ep-summary-file').textContent;
const exportButton = () => document.querySelector('#export-panel .ep-export');
const warningEl = () => document.querySelector('#export-panel .ep-warning');
const segment = (value) =>
  document.querySelector(`#export-panel .ep-segment[data-value="${value}"]`);

describe('the export panel', () => {
  it('says what the export will be before it happens', () => {
    const settings = getExportSettings();
    const expected = describeExport({
      format: settings.format,
      ...resolveResolution('export'),
      fps: settings.fps,
      duration: settings.duration,
      quality: settings.quality,
      containerLabel: 'MP4',
    });

    expect(summaryText()).toBe(expected.summary);
  });

  it('keeps the summary honest when a setting changes', () => {
    setExportSettings({ duration: 30, fps: 24, quality: 'max' }, 'test');

    expect(summaryText()).toContain('30s');
    expect(summaryText()).toContain('24 fps');
    expect(summaryText()).toContain(
      `~${describeExport({
        format: 'video',
        ...resolveResolution('export'),
        fps: 24,
        duration: 30,
        quality: 'max',
      }).summary.split('~')[1].split(' · ')[0]}`,
    );
  });

  it('switches the whole panel with the format', () => {
    segment('png').click();

    expect(getExportSettings().format).toBe('png');
    expect(panel.controls.videoGroup.style.display).toBe('none');
    expect(exportButton().textContent).toBe('Export PNG');
    expect(filenameText().endsWith('.png')).toBe(true);

    segment('video').click();

    expect(panel.controls.videoGroup.style.display).toBe('block');
    expect(exportButton().textContent).toBe('Export video');
    expect(filenameText().endsWith('.mp4')).toBe(true);
  });

  it('offers export sizes as multiples of the composition', () => {
    const options = [...panel.controls.sizeSelect.options].map((o) => o.textContent);

    expect(options).toContainEqual('Output format — 1920 × 1080');
    expect(options).toContainEqual('0.5× output — 960 × 540');
    expect(options).toContainEqual('2× output — 3840 × 2160');
    expect(options.at(-1)).toBe('Custom…');
  });

  it('applies a chosen multiple to the export role', () => {
    const select = panel.controls.sizeSelect;
    select.value = '2';
    select.onchange();

    expect(getExportTarget()).toMatchObject({ mode: 'custom', width: 3840, height: 2160 });
    expect(summaryText()).toContain('3840 × 2160');
  });

  it('drops multiples the export limits could not honour', () => {
    setOutputFormat(3840, 2160, 'test');
    const values = [...panel.controls.sizeSelect.options].map((o) => o.value);

    // 2x of 4K lands exactly on the 7680x4320 ceiling and stays; 3x is past
    // it, so it is not offered at all rather than offered and clamped.
    expect(values).toContain('1');
    expect(values).toContain('0.5');
    expect(values).toContain('2');
    expect(values).not.toContain('3');
    expect(values).not.toContain('4');
  });

  it('opens the custom fields even when the size already matches a multiple', () => {
    const select = panel.controls.sizeSelect;
    select.value = 'custom';
    select.onchange();

    // The size is still 1920x1080 - a multiple - so only the artist's choice
    // can be what keeps the fields open.
    expect(select.value).toBe('custom');
    expect(panel.controls.customRow.style.display).toBe('flex');
    expect(panel.controls.customWidth.value).toBe('1920');

    select.value = '1';
    select.onchange();
    expect(panel.controls.customRow.style.display).toBe('none');
  });

  it('holds the composition ratio while a custom width is typed', () => {
    setExportTarget({ mode: 'custom', width: 1000, height: 500 }, 'test');
    panel.controls.customWidth.value = '1000';
    panel.controls.customHeight.value = '500';

    panel.controls.customWidth.value = '800';
    panel.controls.customWidth.dispatchEvent(new Event('change'));

    // 16:9 kept from the output format rather than the 2:1 it was set to.
    expect(getExportTarget()).toMatchObject({ width: 800, height: 450 });
  });

  it('lets the ratio go when the lock is off', () => {
    setExportTarget({ mode: 'custom', width: 1000, height: 500 }, 'test');
    panel.controls.aspectLock.input.checked = false;
    panel.controls.aspectLock.input.dispatchEvent(new Event('change'));

    panel.controls.customWidth.value = '800';
    panel.controls.customWidth.dispatchEvent(new Event('change'));

    expect(getExportTarget()).toMatchObject({ width: 800, height: 500 });
  });

  it('warns when the export would be framed differently from the composition', () => {
    setExportTarget({ mode: 'custom', width: 1000, height: 1000 }, 'test');

    expect(panel.controls.sizeNote.textContent).toContain('different shape');
  });

  it('turns a duration chip into the duration', () => {
    panel.controls.durationChips.find((chip) => chip.dataset.value === '15').click();

    expect(getExportSettings().duration).toBe(15);
    expect(panel.controls.duration.value).toBe('15');
    expect(
      panel.controls.durationChips.filter((chip) => chip.classList.contains('active')),
    ).toHaveLength(1);
  });

  it('reveals the frame-rate box only for a rate the presets do not cover', () => {
    expect(panel.controls.fpsInput.style.display).toBe('none');

    setExportSettings({ fps: 48 }, 'test');

    expect(panel.controls.fpsSelect.value).toBe('custom');
    expect(panel.controls.fpsInput.style.display).toBe('block');
    expect(panel.controls.fpsInput.value).toBe('48');
  });

  it('explains that a silent patch records silent, and offers nothing to tick', () => {
    expect(panel.controls.audio.input.disabled).toBe(true);
    expect(panel.controls.audio.input.checked).toBe(false);
    expect(panel.controls.audioNote.textContent).toContain('No audio file is loaded');
  });

  it('offers the audio track once there is one', () => {
    window.audioCapture = { audioContext: {}, source: {}, audioElement: {} };
    panel._refresh();

    expect(panel.controls.audio.input.disabled).toBe(false);
    expect(panel.controls.audio.input.checked).toBe(true);
    expect(summaryText()).toContain('with audio');
  });

  it('names the file the way the export will', () => {
    setExportSettings({ filenamePrefix: 'night/walk', fps: 30 }, 'test');

    expect(filenameText()).toMatch(/^night-walk-1920x1080-30fps-.+\.mp4$/);
  });

  it('says up front that this browser will produce WebM, not MP4', () => {
    stubMediaRecorder(['video/webm;codecs=vp9']);
    panel._refresh();

    expect(summaryText()).toContain('WebM');
    expect(filenameText().endsWith('.webm')).toBe(true);
    expect(warningEl().textContent).toContain('MP4 is not available');
  });

  it('refuses to offer a video export the browser cannot record', () => {
    stubMediaRecorder([]);
    panel._refresh();

    expect(exportButton().disabled).toBe(true);
    expect(warningEl().textContent).toContain('cannot record');

    segment('png').click();

    // A still needs no recorder, so it stays available.
    expect(exportButton().disabled).toBe(false);
  });

  it('warns before an artist waits out an enormous file', () => {
    setExportSettings({ duration: 300, quality: 'max', fps: 120 }, 'test');
    const select = panel.controls.sizeSelect;
    select.value = '2';
    select.onchange();

    expect(warningEl().textContent).toContain('large file');
  });
});
