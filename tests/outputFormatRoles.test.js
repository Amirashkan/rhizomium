// The output format owns the aspect ratio; every surface derives its pixel count from it.
//
// The point of the role model is that preview cost, simulation fidelity and export size can all
// move independently WITHOUT any of them being able to change the shape of the image. Two flat
// resolutions could disagree on aspect - that is what breaks sim UV math against the composite,
// and what makes the second viewer letterbox to the wrong frame.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_OUTPUT,
  applyProjectFormat,
  getExportTarget,
  getOutputAspect,
  getPreviewQuality,
  getSimQuality,
  resetOutputFormat,
  resolveResolution,
  subscribeOutputFormat,
  serializeProjectFormat,
  setExportTarget,
  setOutputFormat,
  setPreviewQuality,
  setSimQuality,
} from '../src/ui/OutputFormat.js';

const aspectOf = ({ width, height }) => +(width / height).toFixed(4);

describe('output format roles', () => {
  beforeEach(() => {
    window.localStorage?.clear();
    resetOutputFormat('test');
  });

  it('derives every role from the output size by default', () => {
    setOutputFormat(1920, 1080, 'test');

    expect(resolveResolution('output')).toEqual({ width: 1920, height: 1080 });
    expect(resolveResolution('preview')).toEqual({ width: 1920, height: 1080 });
    expect(resolveResolution('sim')).toEqual({ width: 1920, height: 1080 });
    expect(resolveResolution('export')).toEqual({ width: 1920, height: 1080 });
  });

  it('keeps every role on the output aspect whatever the quality knobs say', () => {
    setOutputFormat(1920, 1080, 'test');
    setPreviewQuality('quarter', 'test');
    setSimQuality('half', 'test');

    const output = getOutputAspect();
    expect(aspectOf(resolveResolution('preview'))).toBe(+output.toFixed(4));
    expect(aspectOf(resolveResolution('sim'))).toBe(+output.toFixed(4));
    expect(resolveResolution('preview')).toEqual({ width: 480, height: 270 });
    expect(resolveResolution('sim')).toEqual({ width: 960, height: 540 });
  });

  it('moves preview cost without touching the sims, and vice versa', () => {
    setOutputFormat(1280, 720, 'test');

    setPreviewQuality('quarter', 'test');
    expect(resolveResolution('preview')).toEqual({ width: 320, height: 180 });
    expect(resolveResolution('sim')).toEqual({ width: 1280, height: 720 });

    setSimQuality('half', 'test');
    expect(resolveResolution('preview')).toEqual({ width: 320, height: 180 });
    expect(resolveResolution('sim')).toEqual({ width: 640, height: 360 });
  });

  it('exports at a custom size while the preview stays cheap', () => {
    setOutputFormat(1280, 720, 'test');
    setPreviewQuality('quarter', 'test');
    setExportTarget({ mode: 'custom', width: 3840, height: 2160 }, 'test');

    expect(resolveResolution('export')).toEqual({ width: 3840, height: 2160 });
    expect(resolveResolution('preview')).toEqual({ width: 320, height: 180 });
  });

  it('snaps the export target back to the output when set to output mode', () => {
    setOutputFormat(1280, 720, 'test');
    setExportTarget({ mode: 'custom', width: 3840, height: 2160 }, 'test');
    setExportTarget({ mode: 'output' }, 'test');

    expect(getExportTarget().mode).toBe('output');
    expect(resolveResolution('export')).toEqual({ width: 1280, height: 720 });
  });

  it('clamps out-of-range sizes instead of rendering at zero', () => {
    setOutputFormat(-5, 99999, 'test');
    const output = resolveResolution('output');
    expect(output.width).toBe(128);
    expect(output.height).toBe(4320);
  });

  it('never lets a derived role collapse below a usable size', () => {
    setOutputFormat(128, 128, 'test');
    setPreviewQuality('quarter', 'test');
    expect(resolveResolution('preview')).toEqual({ width: 64, height: 64 });
  });

  it('notifies only the roles a change actually moves', () => {
    const changes = [];
    const stop = subscribeOutputFormat((c) => changes.push(c));

    setPreviewQuality('half', 'test');
    expect(changes.at(-1).roles).toEqual(['preview']);

    setSimQuality('half', 'test');
    expect(changes.at(-1).roles).toEqual(['sim']);

    setOutputFormat(800, 600, 'test');
    expect(changes.at(-1).roles).toEqual(['output', 'preview', 'sim', 'export']);

    stop();
  });
});

describe('project-scoped format', () => {
  beforeEach(() => {
    window.localStorage?.clear();
    resetOutputFormat('test');
  });

  it('serializes only what belongs to the artwork', () => {
    setOutputFormat(1920, 1080, 'test');
    setSimQuality('half', 'test');
    setPreviewQuality('quarter', 'test'); // machine-local: must NOT be serialized

    expect(serializeProjectFormat()).toEqual({
      output: { width: 1920, height: 1080 },
      simQuality: 'half',
    });
  });

  it('restores a project\'s authored format', () => {
    applyProjectFormat({ output: { width: 2560, height: 1440 }, simQuality: 'quarter' });

    expect(resolveResolution('output')).toEqual({ width: 2560, height: 1440 });
    expect(getSimQuality()).toBe('quarter');
  });

  it('leaves the current setting alone for projects saved before this existed', () => {
    setOutputFormat(1920, 1080, 'test');
    setSimQuality('half', 'test');

    applyProjectFormat(undefined);
    applyProjectFormat({});

    expect(resolveResolution('output')).toEqual({ width: 1920, height: 1080 });
    expect(getSimQuality()).toBe('half');
  });

  it('does not let a loaded project dictate machine-local preview quality', () => {
    setPreviewQuality('quarter', 'test');
    applyProjectFormat({ output: { width: 1920, height: 1080 }, simQuality: 'full' });

    expect(getPreviewQuality()).toBe('quarter');
  });

  it('resets to the documented default', () => {
    setOutputFormat(3840, 2160, 'test');
    setSimQuality('quarter', 'test');
    resetOutputFormat('test');

    expect(resolveResolution('output')).toEqual(DEFAULT_OUTPUT);
    expect(getSimQuality()).toBe('full');
    expect(getPreviewQuality()).toBe('full');
    expect(getExportTarget().mode).toBe('output');
  });
});
