// The desktop launch sequence: splash.html goes up, the editor boots hidden
// behind it, and `app_ready` swaps them. Two halves are testable from here —
// what the desktop bundle contains, and when the frontend fires the handoff.
// The Rust half (reveal_editor, SPLASH_TIMEOUT) is not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }));

describe('desktop build entries', () => {
  // Resolved through Vite's own config loader rather than by reading the file,
  // so a change to how the inputs are computed is covered, not just the text.
  async function inputsFor(mode) {
    const { resolveConfig } = await import('vite');
    const config = await resolveConfig({ root: ROOT }, 'build', mode, 'production');
    return config.build.rollupOptions.input;
  }

  it('gives the desktop bundle the splash window and no landing page', async () => {
    const input = await inputsFor('desktop');

    // The whole point: an installed app opens, it does not market itself. The
    // landing page must not be in the bundle at all, or a stray navigation to
    // "/" would land the artist back on a marketing page inside their editor.
    expect(input).not.toHaveProperty('main');
    expect(input.splash).toBe(resolve(ROOT, 'splash.html'));
  });

  it('gives the web bundle the landing page and no splash window', async () => {
    const input = await inputsFor('production');

    expect(input.main).toBe(resolve(ROOT, 'index.html'));
    expect(input).not.toHaveProperty('splash');
  });

  it('builds the editor and the second-monitor viewer either way', async () => {
    for (const mode of ['desktop', 'production']) {
      const input = await inputsFor(mode);
      expect(input.editor).toBe(resolve(ROOT, 'editor/index.html'));
      expect(input['second-monitor']).toBe(resolve(ROOT, 'editor/second-monitor.html'));
    }
  });
});

describe('tauri.conf.json launch windows', () => {
  const conf = JSON.parse(
    readFileSync(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'),
  );
  const windows = Object.fromEntries(conf.app.windows.map((w) => [w.label, w]));

  it('opens the editor as the main window, hidden until it has booted', () => {
    expect(windows.main.url).toBe('editor/index.html');
    expect(windows.main.visible).toBe(false);
  });

  it('shows the splash as a borderless floating window', () => {
    const splash = windows.splashscreen;
    expect(splash.url).toBe('splash.html');
    expect(splash.decorations).toBe(false);
    expect(splash.alwaysOnTop).toBe(true);
    expect(splash.resizable).toBe(false);
  });

  it('builds the desktop bundle, not the web one, before packaging', () => {
    // A stale `build:web` here would put the landing page back in the app and
    // leave splash.html out, so the window above would open on a 404.
    expect(conf.build.beforeBuildCommand).toBe('npm run build:desktop');
  });

  it('bundles for Windows only', () => {
    // Not a preference — WebView2 is the only OS webview with WebGPU, so a
    // macOS or Linux bundle installs fine and then shows the editor's "no GPU
    // device" screen. `"all"` here would start producing those again silently.
    expect(conf.bundle.targets).toEqual(['msi', 'nsis']);
  });
});

describe('signalAppReady', () => {
  let signalAppReady;

  beforeEach(async () => {
    invoke.mockReset().mockResolvedValue(undefined);
    vi.resetModules();
    // The module latches after the first call, so it has to be re-imported per
    // test to observe that latch rather than a leftover from the last one.
    ({ signalAppReady } = await import('../src/core/tauriSplash.js'));
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it('asks the shell to reveal the editor', async () => {
    window.__TAURI_INTERNALS__ = {};
    await signalAppReady();
    expect(invoke).toHaveBeenCalledWith('app_ready');
  });

  it('only fires once, however many boot paths reach it', async () => {
    window.__TAURI_INTERNALS__ = {};
    await signalAppReady();
    await signalAppReady();
    await signalAppReady();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a browser', async () => {
    await signalAppReady();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('swallows a failed handoff instead of breaking the boot', async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke.mockRejectedValue(new Error('ipc down'));

    // initialize() calls this from a finally block: throwing here would
    // replace whatever real startup error was on its way out.
    await expect(signalAppReady()).resolves.toBeUndefined();
  });
});
