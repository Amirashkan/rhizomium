import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import {
  parseAutosaveEntry,
  createAutosaveStore,
  FallbackAutosaveStore,
  IndexedDBAutosaveStore,
  TauriAutosaveStore,
} from '../src/core/AutosaveStore.js';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }));

const P = SaveLoadManager.prototype;
const KEY = 'rhizomium.autosave.v2';

// A localStorage stand-in with a byte budget, so the quota can actually be hit
// the way it is in a browser rather than mocked at the call site.
function makeStorage(limitBytes = Infinity) {
  const entries = new Map();
  const used = () =>
    [...entries].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    entries,
    getItem: (k) => (entries.has(k) ? entries.get(k) : null),
    removeItem: (k) => entries.delete(k),
    setItem: (k, v) => {
      const next = used() - (entries.get(k)?.length || 0) + v.length;
      if (next > limitBytes) {
        const error = new Error(
          `Failed to execute 'setItem' on 'Storage': Setting the value of '${k}' exceeded the quota.`,
        );
        error.name = 'QuotaExceededError';
        throw error;
      }
      entries.set(k, v);
    },
  };
}

function bigProject() {
  return {
    app: 'Rhizomium-Web',
    nodes: [{ id: 'n1', kind: 'Texture2D', dataUrl: 'x'.repeat(4000) }],
    connections: [{ from: 'n1', to: 'n2' }],
  };
}

function makeStub(overrides = {}) {
  const put = vi.fn().mockResolvedValue(undefined);
  return {
    autosaveKey: KEY,
    hasUnsavedChanges: true,
    _lastAutosaveHash: null,
    exportProject: () => bigProject(),
    updateStatus: vi.fn(),
    formatAge: P.formatAge,
    importProject: vi.fn().mockResolvedValue(undefined),
    getBackups: vi.fn().mockResolvedValue([]),
    _computeProjectHash: P._computeProjectHash,
    _writeLocalEntry: P._writeLocalEntry,
    autosaveStore: { put, get: vi.fn().mockResolvedValue(null) },
    graph: { nodes: [] },
    ...overrides,
  };
}

beforeEach(() => {
  global.localStorage = makeStorage();
  global.window = { errorHandler: { handleError: vi.fn() } };
  invoke.mockReset();
});

describe('autosave storage', () => {
  it('keeps the project out of localStorage, writing only a pointer', async () => {
    const stub = makeStub();

    const ok = await P.saveToLocal.call(stub);

    expect(ok).toBe(true);
    expect(stub.autosaveStore.put).toHaveBeenCalledTimes(1);
    expect(stub.autosaveStore.put.mock.calls[0][0].data.nodes).toHaveLength(1);

    const entry = JSON.parse(localStorage.getItem(KEY));
    expect(entry.storage).toBe('external');
    expect(entry.data).toBeUndefined();
    expect(entry.nodeCount).toBe(1);
    expect(entry.connectionCount).toBe(1);
    expect(localStorage.getItem(KEY).length).toBeLessThan(300);
    expect(stub.hasUnsavedChanges).toBe(false);
  });

  it('replaces a legacy inline payload that already filled the quota', async () => {
    // 5KB budget with a 4.5KB legacy autosave already in it: the old code
    // threw QuotaExceededError here on every single autosave tick.
    global.localStorage = makeStorage(5000);
    localStorage.entries.set(
      KEY,
      JSON.stringify({ data: bigProject(), timestamp: Date.now() }),
    );
    const stub = makeStub();

    const ok = await P.saveToLocal.call(stub);

    expect(ok).toBe(true);
    expect(stub.updateStatus).toHaveBeenCalledWith('Project saved locally');
    expect(JSON.parse(localStorage.getItem(KEY)).storage).toBe('external');
  });

  it('reports a full quota in plain language instead of the raw error', async () => {
    global.localStorage = makeStorage(10); // nothing fits, not even the pointer
    const stub = makeStub();

    // The snapshot still reached the autosave store, so the save is not a loss
    const ok = await P.saveToLocal.call(stub);

    expect(ok).toBe(true);
    expect(stub.autosaveStore.put).toHaveBeenCalled();
    expect(stub.updateStatus).toHaveBeenCalledWith(
      'Autosaved, but browser storage is full',
      'error',
    );
  });

  it('falls back to an inline localStorage snapshot when no store is available', async () => {
    const stub = makeStub({
      autosaveStore: {
        put: vi.fn().mockRejectedValue(new Error('IndexedDB is not available')),
        get: vi.fn().mockResolvedValue(null),
      },
    });

    const ok = await P.saveToLocal.call(stub);

    expect(ok).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)).data.nodes).toHaveLength(1);
  });
});

describe('autosave recovery', () => {
  it('loads the snapshot the pointer refers to', async () => {
    const data = bigProject();
    const stub = makeStub({
      autosaveStore: {
        put: vi.fn(),
        get: vi.fn().mockResolvedValue({ data, timestamp: Date.now() - 5000 }),
      },
    });
    localStorage.setItem(
      KEY,
      JSON.stringify({ storage: 'external', timestamp: Date.now() - 5000, nodeCount: 1 }),
    );

    const ok = await P.loadFromLocal.call(stub);

    expect(ok).toBe(true);
    expect(stub.importProject).toHaveBeenCalledWith(data);
  });

  it('still reads a legacy inline autosave written by an older build', async () => {
    const data = bigProject();
    const stub = makeStub();
    localStorage.setItem(KEY, JSON.stringify({ data, timestamp: Date.now() }));

    const ok = await P.loadFromLocal.call(stub);

    expect(ok).toBe(true);
    expect(stub.importProject).toHaveBeenCalledWith(data);
    expect(stub.autosaveStore.get).not.toHaveBeenCalled();
  });

  it('falls back to the newest backup when the snapshot went missing', async () => {
    const data = bigProject();
    const stub = makeStub({
      getBackups: vi.fn().mockResolvedValue([{ data, timestamp: Date.now() }]),
    });
    localStorage.setItem(
      KEY,
      JSON.stringify({ storage: 'external', timestamp: Date.now(), nodeCount: 1 }),
    );

    const ok = await P.loadFromLocal.call(stub);

    expect(ok).toBe(true);
    expect(stub.importProject).toHaveBeenCalledWith(data);
  });

  it('hasAutosave and getAutosaveAge read the pointer, not the payload', () => {
    const stub = makeStub();
    const timestamp = Date.now() - 60000;
    localStorage.setItem(
      KEY,
      JSON.stringify({ storage: 'external', timestamp, nodeCount: 3 }),
    );

    expect(P.hasAutosave.call(stub)).toBe(true);
    expect(P.getAutosaveAge.call(stub)).toBeGreaterThanOrEqual(60000);

    localStorage.setItem(
      KEY,
      JSON.stringify({ storage: 'external', timestamp, nodeCount: 0 }),
    );
    expect(P.hasAutosave.call(stub)).toBe(false);
  });
});

describe('turning autosave off', () => {
  function autosaveStub(overrides = {}) {
    return makeStub({
      autosaveEnabled: true,
      autosaveInterval: 1000,
      _autosaveTimer: null,
      setupAutoSave: P.setupAutoSave,
      shouldAutoSave: () => true,
      saveToLocal: vi.fn().mockResolvedValue(true),
      createBackup: vi.fn().mockResolvedValue(true),
      ...overrides,
    });
  }

  it('stops the periodic snapshot, and resumes it when switched back on', async () => {
    vi.useFakeTimers();
    try {
      const stub = autosaveStub();
      P.setupAutoSave.call(stub);
      await vi.advanceTimersByTimeAsync(1000);
      expect(stub.saveToLocal).toHaveBeenCalledTimes(1);

      P.setAutosaveEnabled.call(stub, false);
      await vi.advanceTimersByTimeAsync(10000);
      expect(stub.saveToLocal).toHaveBeenCalledTimes(1);

      P.setAutosaveEnabled.call(stub, true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(stub.saveToLocal).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the snapshot taken when the window is hidden or closed', () => {
    const handlers = {};
    vi.spyOn(document, 'addEventListener').mockImplementation((name, fn) => {
      handlers[name] = fn;
    });
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    global.window.addEventListener = (name, fn) => {
      handlers[name] = fn;
    };

    const stub = autosaveStub({ autosaveEnabled: false });
    P.setupUnloadHandler.call(stub);

    handlers.visibilitychange();
    handlers.beforeunload({});
    expect(stub.saveToLocal).not.toHaveBeenCalled();

    // The same handlers still save once autosave is back on.
    stub.autosaveEnabled = true;
    handlers.visibilitychange();
    expect(stub.saveToLocal).toHaveBeenCalledTimes(1);

    delete document.visibilityState;
    vi.restoreAllMocks();
  });
});

describe('desktop autosave', () => {
  it('writes the snapshot to a file through the Rust side, not browser storage', async () => {
    invoke.mockResolvedValue(undefined);
    const record = { data: bigProject(), timestamp: 42 };

    await new TauriAutosaveStore().put(record);

    expect(invoke).toHaveBeenCalledWith('write_autosave', {
      contents: JSON.stringify(record),
    });
    // A video patch is megabytes; none of it touched localStorage
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads the snapshot back, and reports no autosave when the file is absent', async () => {
    const record = { data: bigProject(), timestamp: 42 };
    invoke.mockResolvedValueOnce(JSON.stringify(record));
    await expect(new TauriAutosaveStore().get()).resolves.toEqual(record);

    invoke.mockResolvedValueOnce(null);
    await expect(new TauriAutosaveStore().get()).resolves.toBeNull();
  });

  it('picks the file-backed store inside Tauri and IndexedDB in a browser', () => {
    expect(createAutosaveStore()).toBeInstanceOf(IndexedDBAutosaveStore);

    global.window.__TAURI_INTERNALS__ = {};
    expect(createAutosaveStore()).toBeInstanceOf(FallbackAutosaveStore);
  });

  it('falls back to IndexedDB when an older binary has no autosave commands', async () => {
    const primary = {
      put: vi.fn().mockRejectedValue(new Error('command write_autosave not found')),
    };
    const fallback = { put: vi.fn().mockResolvedValue(undefined) };
    const store = new FallbackAutosaveStore(primary, fallback);

    await store.put({ timestamp: 1 });
    await store.put({ timestamp: 2 });

    expect(fallback.put).toHaveBeenCalledTimes(2);
    // The broken primary is not retried on every tick
    expect(primary.put).toHaveBeenCalledTimes(1);
  });
});

describe('parseAutosaveEntry', () => {
  it('normalizes both record shapes and rejects junk', () => {
    expect(parseAutosaveEntry(null)).toBeNull();
    expect(parseAutosaveEntry('not json')).toBeNull();
    expect(parseAutosaveEntry('{"timestamp":1}').nodeCount).toBe(0);

    const legacy = parseAutosaveEntry(
      JSON.stringify({ data: { nodes: [1, 2] }, timestamp: 7 }),
    );
    expect(legacy).toMatchObject({ timestamp: 7, nodeCount: 2 });
    expect(legacy.data.nodes).toHaveLength(2);

    const pointer = parseAutosaveEntry(
      JSON.stringify({ storage: 'external', timestamp: 9, nodeCount: 5 }),
    );
    expect(pointer).toMatchObject({ timestamp: 9, nodeCount: 5, data: null });
  });
});
