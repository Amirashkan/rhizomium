import { describe, it, expect, vi } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

const P = SaveLoadManager.prototype;

// Build a stub `this` so we exercise the save methods without the constructor's
// side effects (timers, IndexedDB, unload handlers).
function makeStub(overrides = {}) {
  return {
    supportsFileSystemAccess: false,
    currentFileHandle: null,
    currentProjectName: null,
    hasUnsavedChanges: false,
    exportProject: () => ({ app: 'Rhizomium-Web', nodes: [], connections: [] }),
    downloadFile: vi.fn(),
    updateStatus: vi.fn(),
    markUnsaved: P.markUnsaved,
    _updateDocumentTitle: vi.fn(),
    _baseName: P._baseName,
    _sanitizeFileName: P._sanitizeFileName,
    _suggestedFileName: P._suggestedFileName,
    _writeToHandle: P._writeToHandle,
    _promptForName: P._promptForName,
    saveProject: P.saveProject,
    saveProjectAs: P.saveProjectAs,
    getProjectName: P.getProjectName,
    ...overrides,
  };
}

describe('SaveLoadManager naming helpers', () => {
  it('strips extensions and illegal characters from file names', () => {
    const s = makeStub();
    expect(P._baseName.call(s, 'My Scene.rz')).toBe('My Scene');
    expect(P._sanitizeFileName.call(s, 'a/b:c*?.json')).toBe('a-b-c');
    expect(P._sanitizeFileName.call(s, '  spaced   name  ')).toBe('spaced name');
  });

  it('suggests a name based on the current project and format', () => {
    const stub = makeStub({ currentProjectName: 'cool-thing.rz' });
    expect(P._suggestedFileName.call(stub, 'rhizomium')).toBe('cool-thing.rz');
    expect(P._suggestedFileName.call(stub, 'json')).toBe('cool-thing.json');
  });

  it('falls back to a dated default when unnamed', () => {
    const stub = makeStub();
    expect(P._suggestedFileName.call(stub, 'rhizomium')).toMatch(
      /^rhizomium-project-\d{4}-\d{2}-\d{2}\.rz$/,
    );
  });

  it('getProjectName reports Untitled when unbound', () => {
    expect(P.getProjectName.call(makeStub())).toBe('Untitled');
    expect(P.getProjectName.call(makeStub({ currentProjectName: 'x.rz' }))).toBe('x');
  });
});

describe('SaveLoadManager.saveProject routing', () => {
  it('writes back to the bound handle without re-prompting', async () => {
    const handle = { name: 'scene.rz' };
    const write = vi.fn().mockResolvedValue(undefined);
    const stub = makeStub({
      supportsFileSystemAccess: true,
      currentFileHandle: handle,
      hasUnsavedChanges: true,
      _writeToHandle: write,
      saveProjectAs: vi.fn(),
    });

    const ok = await P.saveProject.call(stub);

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledWith(handle, expect.any(String));
    expect(stub.saveProjectAs).not.toHaveBeenCalled();
    expect(stub.hasUnsavedChanges).toBe(false);
  });

  it('delegates to Save As when no file is bound', async () => {
    const saveProjectAs = vi.fn().mockResolvedValue(true);
    const stub = makeStub({ saveProjectAs });
    const ok = await P.saveProject.call(stub);
    expect(saveProjectAs).toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it('re-prompts via Save As when the bound handle is stale', async () => {
    const err = new Error('gone');
    err.name = 'NotFoundError';
    const saveProjectAs = vi.fn().mockResolvedValue(true);
    const stub = makeStub({
      supportsFileSystemAccess: true,
      currentFileHandle: { name: 'old.rz' },
      _writeToHandle: vi.fn().mockRejectedValue(err),
      saveProjectAs,
    });

    await P.saveProject.call(stub);

    expect(stub.currentFileHandle).toBe(null);
    expect(saveProjectAs).toHaveBeenCalled();
  });
});

describe('SaveLoadManager.saveProjectAs download fallback', () => {
  it('names and downloads the project, binding the name', async () => {
    const stub = makeStub({
      _promptForName: vi.fn().mockResolvedValue('My Cool Scene'),
    });

    const ok = await P.saveProjectAs.call(stub);

    expect(ok).toBe(true);
    expect(stub.downloadFile).toHaveBeenCalledWith(
      expect.any(String),
      'My Cool Scene.rz',
      'application/json',
    );
    expect(stub.currentProjectName).toBe('My Cool Scene.rz');
    expect(stub.currentFileHandle).toBe(null);
    expect(stub.hasUnsavedChanges).toBe(false);
  });

  it('aborts cleanly when the name dialog is cancelled', async () => {
    const stub = makeStub({
      _promptForName: vi.fn().mockResolvedValue(null),
    });

    const ok = await P.saveProjectAs.call(stub);

    expect(ok).toBe(false);
    expect(stub.downloadFile).not.toHaveBeenCalled();
  });
});
