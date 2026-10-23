import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  canChooseExportFolder,
  chooseExportFolder,
  getExportDestination,
  resetExportDestination,
  saveExport,
} from '../src/ui/exportDestination.js';

/** A directory handle backed by a Map, enough for the File System Access calls used. */
function fakeDirectory(name, existing = []) {
  const files = new Map(existing.map((file) => [file, null]));
  return {
    name,
    files,
    async getFileHandle(file, { create = false } = {}) {
      if (!files.has(file) && !create) {
        throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      }
      return {
        async createWritable() {
          return {
            async write(blob) {
              files.set(file, blob);
            },
            async close() {},
          };
        },
      };
    },
  };
}

let clicked;

beforeEach(async () => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    clicked.push(this.download);
  });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  await resetExportDestination();
});

afterEach(() => {
  delete window.showDirectoryPicker;
  vi.restoreAllMocks();
});

describe('the export destination', () => {
  it('downloads when no folder has been chosen', async () => {
    const saved = await saveExport(new Blob(['x']), 'a.png');

    expect(saved).toEqual({ filename: 'a.png', location: 'Downloads' });
    expect(clicked).toEqual(['a.png']);
  });

  it('offers no choice where the browser has no folder picker', () => {
    expect(canChooseExportFolder()).toBe(false);
  });

  it('writes into a picked folder without overwriting', async () => {
    const folder = fakeDirectory('renders', ['a.png']);
    window.showDirectoryPicker = vi.fn(async () => folder);

    expect(canChooseExportFolder()).toBe(true);
    await chooseExportFolder();
    expect(getExportDestination()).toMatchObject({ kind: 'folder', label: 'renders' });

    const saved = await saveExport(new Blob(['x']), 'a.png');

    expect(saved).toEqual({ filename: 'a (2).png', location: 'renders/a (2).png' });
    expect(folder.files.has('a (2).png')).toBe(true);
    expect(clicked).toEqual([]);
  });

  it('keeps the current destination when the picker is cancelled', async () => {
    window.showDirectoryPicker = vi.fn(async () => {
      throw Object.assign(new Error('cancel'), { name: 'AbortError' });
    });

    await chooseExportFolder();

    expect(getExportDestination()).toEqual({ kind: 'downloads' });
  });

  it('falls back to a download when the folder cannot be written', async () => {
    const folder = fakeDirectory('gone');
    folder.getFileHandle = async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    };
    window.showDirectoryPicker = vi.fn(async () => folder);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await chooseExportFolder();

    const saved = await saveExport(new Blob(['x']), 'b.mp4');

    expect(saved).toMatchObject({ filename: 'b.mp4', location: 'Downloads', fellBack: true });
    expect(clicked).toEqual(['b.mp4']);
  });
});
