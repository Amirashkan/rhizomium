import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Which URL a feature run is POSTed to.
 *
 * The desktop build has to name the deployment: its pages come from
 * `tauri://localhost`, where a relative `/api` is a missing asset. `tauri dev`
 * looks like the desktop build to isTauri() and is nothing like it here — the
 * window is served by the Vite dev server, so the relative path works and is
 * the only way a local backend can be reached at all.
 *
 * Testing isTauri() alone sent `tauri dev` at production, where a feature this
 * checkout serves and the deployment does not comes back
 * "<feature> is not available in this editor yet" — with a local AI server
 * running, proxied and ignored.
 */

vi.mock('../src/utils/isTauri.js', () => ({
  isTauri: () => globalThis.__testIsTauri ?? false,
}));

const { aiEndpoint, STUDIO_ORIGIN } = await import('../src/ai/aiClient.js');

function at(origin, tauri) {
  globalThis.__testIsTauri = tauri;
  vi.stubGlobal('window', { location: { origin } });
  return aiEndpoint();
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__testIsTauri;
});

describe('aiEndpoint', () => {
  it('names the deployment for the packaged desktop app', () => {
    expect(at('tauri://localhost', true)).toBe(`${STUDIO_ORIGIN}/api/ai/run`);
    // Windows serves the same bundle from a different scheme.
    expect(at('http://tauri.localhost', true)).toBe(`${STUDIO_ORIGIN}/api/ai/run`);
  });

  it('uses the relative path under `tauri dev`, so API_PROXY is honoured', () => {
    expect(at('http://localhost:5173', true)).toBe('/api/ai/run');
    expect(at('http://127.0.0.1:5173', true)).toBe('/api/ai/run');
  });

  it('uses the relative path on the web, in or out of the dev server', () => {
    expect(at('https://studio.tenderworld.org', false)).toBe('/api/ai/run');
    expect(at('http://localhost:5173', false)).toBe('/api/ai/run');
  });

  it('names the deployment for a desktop window on some other local port', () => {
    // Only the dev server's own port has a proxy in front of it; a packaged app
    // that happens to serve from localhost still has no /api of its own.
    expect(at('http://localhost:4173', true)).toBe(`${STUDIO_ORIGIN}/api/ai/run`);
  });
});
