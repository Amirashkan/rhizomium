// Closing on top of edits made since the last save has to ask first.
//
// The autosave snapshot is not the answer to this: it clears
// hasUnsavedChanges, so that flag goes quiet 30 seconds after an edit while
// the artist's file is still missing every one of those edits. What the
// warning is built on is hasUnsavedFileChanges, and these cover both halves —
// the browser's beforeunload prompt and the desktop window's close request.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

const P = SaveLoadManager.prototype;

const tauri = vi.hoisted(() => ({ enabled: false, window: null }));
vi.mock('../src/utils/isTauri.js', () => ({ isTauri: () => tauri.enabled }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => tauri.window,
}));

const modal = vi.hoisted(() => ({ custom: vi.fn() }));
vi.mock('../src/ui/ModalManager.js', () => ({ modalManager: modal }));

const { installUnsavedCloseGuard } = await import('../src/core/closeGuard.js');

/** Just enough manager for the dirty-state methods under test. */
function managerStub(overrides = {}) {
  return {
    graph: { nodes: [{ id: 'n1' }] },
    hasUnsavedChanges: false,
    hasUnsavedFileChanges: false,
    isImporting: false,
    currentProjectName: 'patch.rz',
    _updateDocumentTitle: vi.fn(),
    markUnsaved: P.markUnsaved,
    markSaved: P.markSaved,
    hasUnsavedWork: P.hasUnsavedWork,
    getProjectName: P.getProjectName,
    _baseName: P._baseName,
    saveProject: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('what counts as unsaved work', () => {
  it('survives the autosave that clears the in-memory dirty flag', () => {
    const m = managerStub();
    m.markUnsaved();
    expect(m.hasUnsavedWork()).toBe(true);

    // What saveToLocal does at the end of a snapshot.
    m.hasUnsavedChanges = false;

    expect(m.hasUnsavedWork()).toBe(true);
  });

  it('is cleared by a save to the artist\'s file', () => {
    const m = managerStub();
    m.markUnsaved();
    m.markSaved();
    expect(m.hasUnsavedChanges).toBe(false);
    expect(m.hasUnsavedWork()).toBe(false);
  });

  it('never fires over an empty canvas', () => {
    const m = managerStub({ graph: { nodes: [] } });
    m.markUnsaved();
    expect(m.hasUnsavedWork()).toBe(false);
  });

  it('keeps the unsaved dot in the title through an autosave', () => {
    const m = managerStub({ _updateDocumentTitle: P._updateDocumentTitle });
    m.markUnsaved();
    m.hasUnsavedChanges = false;
    m._updateDocumentTitle();
    expect(document.title.startsWith('• ')).toBe(true);
  });
});

describe('the browser close prompt', () => {
  let handlers;

  beforeEach(() => {
    handlers = {};
    tauri.enabled = false;
    vi.spyOn(document, 'addEventListener').mockImplementation((name, fn) => {
      handlers[name] = fn;
    });
    vi.spyOn(window, 'addEventListener').mockImplementation((name, fn) => {
      handlers[name] = fn;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function unloadEvent() {
    return { preventDefault: vi.fn(), returnValue: undefined };
  }

  function install(overrides = {}) {
    const m = managerStub({
      autosaveEnabled: true,
      saveToLocal: vi.fn(),
      setupUnloadHandler: P.setupUnloadHandler,
      ...overrides,
    });
    m.setupUnloadHandler();
    return m;
  }

  it('asks before a close that would drop edits since the last save', () => {
    const m = install();
    m.markUnsaved();
    m.hasUnsavedChanges = false; // an autosave landed in the meantime

    const e = unloadEvent();
    handlers.beforeunload(e);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe('');
  });

  it('lets a saved project close without a word', () => {
    const m = install();
    m.markUnsaved();
    m.markSaved();

    const e = unloadEvent();
    handlers.beforeunload(e);

    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('still takes the parting snapshot', () => {
    const m = install();
    m.markUnsaved();

    handlers.beforeunload(unloadEvent());

    expect(m.saveToLocal).toHaveBeenCalled();
  });

  it('leaves the question to the desktop guard inside Tauri', () => {
    tauri.enabled = true;
    const m = install();
    m.markUnsaved();

    const e = unloadEvent();
    handlers.beforeunload(e);

    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('the desktop close guard', () => {
  let onCloseRequested;
  let appWindow;

  beforeEach(() => {
    tauri.enabled = true;
    onCloseRequested = null;
    appWindow = {
      onCloseRequested: vi.fn(async (fn) => { onCloseRequested = fn; return () => {}; }),
      destroy: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    tauri.window = appWindow;
    modal.custom.mockReset();
  });

  afterEach(() => { tauri.enabled = false; });

  /** Pick the named button the way the artist clicking it would. */
  function answer(label) {
    modal.custom.mockImplementation(async (config) => {
      config.buttons.find((b) => b.label === label).onClick();
    });
  }

  async function close() {
    const event = { preventDefault: vi.fn() };
    await onCloseRequested(event);
    return event;
  }

  it('does not touch a close with nothing unsaved', async () => {
    const m = managerStub();
    await installUnsavedCloseGuard(m);

    const event = await close();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(modal.custom).not.toHaveBeenCalled();
  });

  it('holds the window open while the question is on screen', async () => {
    const m = managerStub();
    m.markUnsaved();
    answer('Cancel');
    await installUnsavedCloseGuard(m);

    const event = await close();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(appWindow.destroy).not.toHaveBeenCalled();
  });

  it('saves first, then closes', async () => {
    const m = managerStub();
    m.markUnsaved();
    answer('Save');
    await installUnsavedCloseGuard(m);

    await close();

    expect(m.saveProject).toHaveBeenCalled();
    expect(appWindow.destroy).toHaveBeenCalled();
  });

  it('keeps the window open when that save is cancelled', async () => {
    const m = managerStub({ saveProject: vi.fn().mockResolvedValue(false) });
    m.markUnsaved();
    answer('Save');
    await installUnsavedCloseGuard(m);

    await close();

    expect(appWindow.destroy).not.toHaveBeenCalled();
  });

  it('closes on "Don\'t Save" without writing anything', async () => {
    const m = managerStub();
    m.markUnsaved();
    answer("Don't Save");
    await installUnsavedCloseGuard(m);

    await close();

    expect(m.saveProject).not.toHaveBeenCalled();
    expect(appWindow.destroy).toHaveBeenCalled();
  });

  it('treats a dismissed dialog as a cancel', async () => {
    const m = managerStub();
    m.markUnsaved();
    modal.custom.mockResolvedValue(undefined); // Escape
    await installUnsavedCloseGuard(m);

    await close();

    expect(appWindow.destroy).not.toHaveBeenCalled();
  });

  it('asks once - the close it performs itself is not questioned again', async () => {
    const m = managerStub();
    m.markUnsaved();
    answer("Don't Save");
    await installUnsavedCloseGuard(m);

    await close();
    await close();

    expect(modal.custom).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way on the web', async () => {
    tauri.enabled = false;
    expect(await installUnsavedCloseGuard(managerStub())).toBe(null);
    expect(appWindow.onCloseRequested).not.toHaveBeenCalled();
  });
});
