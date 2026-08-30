import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  MAX_BITRATE,
  MIN_BITRATE,
  VIDEO_QUALITY_STEPS,
  baseVideoBitrate,
  buildExportFilename,
  describeExport,
  estimateFileSizeMB,
  formatDuration,
  formatFileSize,
  getExportSettings,
  resetExportSettings,
  resolveVideoBitrate,
  sanitizeFilenamePrefix,
  setExportSettings,
  subscribeExportSettings,
} from '../src/ui/exportSettings.js';

const HD = { width: 1920, height: 1080 };

beforeEach(() => {
  resetExportSettings('test');
});

describe('the settings store', () => {
  it('starts from the defaults', () => {
    expect(getExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('moves only the fields a patch names', () => {
    setExportSettings({ duration: 12 }, 'test');

    expect(getExportSettings()).toEqual({ ...DEFAULT_EXPORT_SETTINGS, duration: 12 });
  });

  it('clamps a frame rate and a duration into range', () => {
    setExportSettings({ fps: 900, duration: 10_000 }, 'test');
    expect(getExportSettings()).toMatchObject({ fps: 120, duration: 300 });

    setExportSettings({ fps: 0, duration: 0 }, 'test');
    expect(getExportSettings()).toMatchObject({ fps: 1, duration: 1 });
  });

  it('keeps a duration to a tenth of a second', () => {
    setExportSettings({ duration: 7.28 }, 'test');
    expect(getExportSettings().duration).toBe(7.3);
  });

  it('ignores a value it does not recognise rather than storing it', () => {
    setExportSettings({ format: 'gif', quality: 'cinema', fps: 'soon' }, 'test');

    expect(getExportSettings()).toMatchObject({
      format: DEFAULT_EXPORT_SETTINGS.format,
      quality: DEFAULT_EXPORT_SETTINGS.quality,
      fps: DEFAULT_EXPORT_SETTINGS.fps,
    });
  });

  it('reports whether anything actually moved', () => {
    expect(setExportSettings({ fps: 30 }, 'test')).toBe(true);
    expect(setExportSettings({ fps: 30 }, 'test')).toBe(false);
  });

  it('tells subscribers what changed and who changed it', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeExportSettings(listener);

    setExportSettings({ quality: 'high' }, 'exportPanel');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 'high' }),
      'exportPanel',
    );

    unsubscribe();
    setExportSettings({ quality: 'draft' }, 'exportPanel');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('survives a listener that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    const offBad = subscribeExportSettings(() => {
      throw new Error('boom');
    });
    const offGood = subscribeExportSettings(good);

    expect(() => setExportSettings({ fps: 24 }, 'test')).not.toThrow();
    expect(good).toHaveBeenCalled();

    offBad();
    offGood();
    warn.mockRestore();
  });
});

describe('filename prefixes', () => {
  it('turns path separators and reserved characters into dashes', () => {
    expect(sanitizeFilenamePrefix('my/patch:v2')).toBe('my-patch-v2');
    expect(sanitizeFilenamePrefix('a\\b*c?d')).toBe('a-b-c-d');
  });

  it('keeps spaces, dots and dashes inside a name', () => {
    expect(sanitizeFilenamePrefix('sunset study 3.1')).toBe('sunset study 3.1');
  });

  it('falls back rather than producing a file with no name', () => {
    expect(sanitizeFilenamePrefix('///')).toBe(DEFAULT_EXPORT_SETTINGS.filenamePrefix);
    expect(sanitizeFilenamePrefix('   ')).toBe(DEFAULT_EXPORT_SETTINGS.filenamePrefix);
    expect(sanitizeFilenamePrefix(null)).toBe(DEFAULT_EXPORT_SETTINGS.filenamePrefix);
    expect(sanitizeFilenamePrefix('', 'render')).toBe('render');
  });

  it('caps a very long name', () => {
    expect(sanitizeFilenamePrefix('x'.repeat(200))).toHaveLength(64);
  });

  it('sanitizes on the way into the store, not on the way out', () => {
    setExportSettings({ filenamePrefix: 'night/walk' }, 'test');
    expect(getExportSettings().filenamePrefix).toBe('night-walk');
  });
});

describe('buildExportFilename', () => {
  const date = new Date('2026-04-20T17:05:09.123Z');

  it('carries the size, the frame rate and a sortable timestamp', () => {
    expect(
      buildExportFilename({ prefix: 'shader', ...HD, fps: 60, extension: 'mp4', date }),
    ).toBe('shader-1920x1080-60fps-2026-04-20T17-05-09.mp4');
  });

  it('leaves the frame rate out of a still', () => {
    expect(buildExportFilename({ prefix: 'shader', ...HD, extension: 'png', date })).toBe(
      'shader-1920x1080-2026-04-20T17-05-09.png',
    );
  });

  it('gives two exports of the same patch different names', () => {
    const first = buildExportFilename({ ...HD, extension: 'png', date });
    const second = buildExportFilename({
      ...HD,
      extension: 'png',
      date: new Date(date.getTime() + 1000),
    });
    expect(first).not.toBe(second);
  });
});

describe('bitrate', () => {
  it('spends more bits on a larger frame, but fewer per pixel', () => {
    const small = baseVideoBitrate({ width: 640, height: 360, fps: 30 });
    const large = baseVideoBitrate({ width: 3840, height: 2160, fps: 30 });

    expect(large).toBeGreaterThan(small);
    expect(large / (3840 * 2160)).toBeLessThan(small / (640 * 360));
  });

  it('pays for frame rate sublinearly', () => {
    const at30 = baseVideoBitrate({ ...HD, fps: 30 });
    const at60 = baseVideoBitrate({ ...HD, fps: 60 });

    expect(at60).toBeGreaterThan(at30);
    expect(at60).toBeLessThan(at30 * 2);
  });

  it('scales with the quality step, and the steps are ordered', () => {
    const rates = VIDEO_QUALITY_STEPS.map((step) =>
      resolveVideoBitrate({ ...HD, fps: 30, quality: step.id }),
    );

    expect(rates).toEqual([...rates].sort((a, b) => a - b));
    expect(rates.at(-1)).toBeGreaterThan(rates[0]);
  });

  it('leaves a local export uncapped - no upload budget applies to a download', () => {
    const bitrate = resolveVideoBitrate({ ...HD, fps: 60, quality: 'max', duration: 300 });
    const sizeMB = estimateFileSizeMB({ videoBitrate: bitrate, duration: 300 });

    expect(sizeMB).toBeGreaterThan(50);
  });

  it('fits a budget when one is given, counting the audio against it', () => {
    const budget = 20;
    const bitrate = resolveVideoBitrate({
      ...HD,
      fps: 60,
      quality: 'high',
      duration: 60,
      audioBitrate: 128_000,
      maxSizeMB: budget,
    });

    const sizeMB = estimateFileSizeMB({
      videoBitrate: bitrate,
      audioBitrate: 128_000,
      duration: 60,
    });
    expect(sizeMB).toBeLessThanOrEqual(budget);
  });

  it('stays inside the recorder-safe bounds', () => {
    expect(resolveVideoBitrate({ width: 128, height: 128, fps: 1, quality: 'draft' }))
      .toBeGreaterThanOrEqual(MIN_BITRATE);
    expect(resolveVideoBitrate({ width: 7680, height: 4320, fps: 120, quality: 'max' }))
      .toBeLessThanOrEqual(MAX_BITRATE);
  });
});

describe('formatting', () => {
  it('reads a file size at the scale it lands on', () => {
    expect(formatFileSize(0)).toBe('0 KB');
    expect(formatFileSize(400 * 1024)).toBe('400 KB');
    expect(formatFileSize(12.5 * 1024 * 1024)).toBe('12.5 MB');
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });

  it('reads a duration as seconds, then as minutes', () => {
    expect(formatDuration(8)).toBe('8s');
    expect(formatDuration(7.5)).toBe('7.5s');
    expect(formatDuration(64)).toBe('1:04');
    expect(formatDuration(300)).toBe('5:00');
  });
});

describe('describeExport', () => {
  it('promises no file size for a still, whose size the shader decides', () => {
    const described = describeExport({ format: 'png', ...HD });

    expect(described.estimatedBytes).toBe(0);
    expect(described.summary).toContain('1920 × 1080');
    expect(described.summary).not.toContain('~');
  });

  it('estimates from the same bitrate the recording will use', () => {
    const options = { ...HD, fps: 60, duration: 10, quality: 'high' };
    const described = describeExport({ format: 'video', ...options });

    expect(described.videoBitrate).toBe(resolveVideoBitrate(options));
    expect(described.estimatedBytes).toBeCloseTo((described.videoBitrate * 10) / 8, 0);
  });

  it('charges the audio track to the estimate it shows', () => {
    const base = { format: 'video', ...HD, fps: 30, duration: 20, quality: 'standard' };
    const silent = describeExport(base);
    const withAudio = describeExport({ ...base, audioBitrate: 128_000 });

    expect(withAudio.estimatedBytes).toBeGreaterThan(silent.estimatedBytes);
    expect(withAudio.summary).toContain('with audio');
  });

  it('says the whole shape of the file in one line', () => {
    const summary = describeExport({
      format: 'video',
      ...HD,
      fps: 60,
      duration: 10,
      quality: 'standard',
      containerLabel: 'MP4',
    }).summary;

    expect(summary).toContain('1920 × 1080');
    expect(summary).toContain('10s');
    expect(summary).toContain('60 fps');
    expect(summary).toContain('MP4');
    expect(summary).toMatch(/~[\d.]+ MB/);
  });
});
