// The cloud file manager's idea of who you are.
//
// It reported "Not signed in" inside a desktop app that had just been signed
// in, and logged the refusal as `Authentication check failed: Error: Not
// authenticated` — an exception for what is, on the web, an ordinary state.
//
// Two separate things were wrong. It authenticated with the session cookie
// alone, and the desktop app has no cookie the gallery will accept (its pages
// are a different site); the credential it does hold is the paired bearer
// token in src/ai/desktopToken.js, which every request here left behind. And
// being signed out was routed through the same catch as a dead network, so a
// normal state and a broken one were indistinguishable in the console.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TOKEN_KEY = 'rhizomium.gallery.desktopToken';

function setTauri(on) {
  if (on) window.__TAURI_INTERNALS__ = {};
  else delete window.__TAURI_INTERNALS__;
}

/** Open the dialog and let the auth check run to completion. */
async function openFileManager() {
  const { FileManager } = await import('../src/ui/FileManager.js');
  const manager = new FileManager(null);
  manager.createDialog();
  manager.isOpen = true;
  await manager.checkAuthAndLoadFiles();
  return manager;
}

const text = (manager, id) => manager.dialog.querySelector(`#${id}`).textContent;
const loginButton = (manager) => manager.dialog.querySelector('#file-manager-login-btn');

describe('the file manager auth check', () => {
  let fetchMock;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    window.localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setTauri(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the desktop token, which is what the app is signed in with', async () => {
    setTauri(true);
    window.localStorage.setItem(TOKEN_KEY, 'tok-abc');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, user: { email: 'artist@example.com' } }),
    });

    const manager = await openFileManager();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/check$/);
    expect(options.headers.Authorization).toBe('Bearer tok-abc');
    // The whole bug: this said "Not signed in" for an account the app held a
    // valid credential for.
    expect(text(manager, 'file-manager-user-info')).toContain('artist@example.com');
    expect(loginButton(manager).style.display).toBe('none');
  });

  it('does not ask the gallery who we are with no credential to ask as', async () => {
    setTauri(true);

    const manager = await openFileManager();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(text(manager, 'file-manager-user-info')).toBe('Not signed in');
    expect(loginButton(manager).style.display).toBe('block');
    // The desktop sign-in is a pairing, not a browser session - an artist who
    // signed in on the website in another window needs telling that it did
    // nothing for this window.
    expect(text(manager, 'file-manager-info')).toMatch(/own credential/);
  });

  it('treats a signed-out answer as a state, not a failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: false }),
    });

    const manager = await openFileManager();

    expect(text(manager, 'file-manager-user-info')).toBe('Not signed in');
    expect(loginButton(manager).style.display).toBe('block');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('reads a 401 the same way, rather than as a broken gallery', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const manager = await openFileManager();

    expect(text(manager, 'file-manager-user-info')).toBe('Not signed in');
    expect(loginButton(manager).style.display).toBe('block');
  });

  it('says so, and names the origin, when the request never got out', async () => {
    // What a CORS refusal and an offline machine both look like from here.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const manager = await openFileManager();

    expect(text(manager, 'file-manager-user-info')).toBe('Cloud file manager unavailable');
    expect(text(manager, 'file-manager-info')).toContain(window.location.origin);
    // Nothing to sign in to - offering the button would be offering a fix that
    // cannot work.
    expect(loginButton(manager).style.display).toBe('none');
  });

  it('carries the token on the file calls too, not just the auth check', async () => {
    setTauri(true);
    window.localStorage.setItem(TOKEN_KEY, 'tok-abc');
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, user: { email: 'artist@example.com' } }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ files: [] }) });

    await openFileManager();

    const listCall = fetchMock.mock.calls.find(([url]) => url.includes('/api/files/list'));
    expect(listCall).toBeDefined();
    expect(listCall[1].headers.Authorization).toBe('Bearer tok-abc');
  });
});
