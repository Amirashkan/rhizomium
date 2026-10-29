import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// withBridge keeps whether the app's connection service is up in module
// state, so each test gets a fresh copy of the module.
async function load() {
  vi.resetModules();
  return import('../src/utils/bridgeAvailability.js');
}

describe('bridgeAvailability', () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  it('points every endpoint at loopback, not the page host', async () => {
    const { bridgeUrl } = await load();
    expect(bridgeUrl('osc')).toBe('ws://127.0.0.1:8767/osc');
    expect(bridgeUrl('video')).toBe('ws://127.0.0.1:8767/video');
  });

  it('starts the service once, on first use, then connects straight away', async () => {
    const invoke = vi.fn().mockResolvedValue(8767);
    window.__TAURI_INTERNALS__ = { invoke };
    const { withBridge } = await load();

    const first = vi.fn();
    const second = vi.fn();
    withBridge(first, vi.fn());
    withBridge(second, vi.fn());
    expect(first).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(second).toHaveBeenCalled());
    expect(first).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('start_bridge');

    const later = vi.fn();
    withBridge(later, vi.fn());
    expect(later).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports why the service could not start, and tries again next time', async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce('port 8767 is in use')
      .mockResolvedValue(8767);
    window.__TAURI_INTERNALS__ = { invoke };
    const { withBridge } = await load();

    const fail = vi.fn();
    withBridge(vi.fn(), fail);
    await vi.waitFor(() => expect(fail).toHaveBeenCalled());
    expect(fail.mock.calls[0][0].message).toBe('port 8767 is in use');

    const connect = vi.fn();
    withBridge(connect, vi.fn());
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
