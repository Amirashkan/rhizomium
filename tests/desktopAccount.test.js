// The account in the desktop app.
//
// Four things stood between the desktop build and a signed-in account, and
// none of them announced itself:
//
//   - window.open() is refused by the OS webview, so every link out of the
//     editor was a dead control,
//   - the AI backend was addressed by a relative path that resolves to a
//     missing asset inside the bundle,
//   - there was no route to a sign-in page,
//   - and once there was, the session cookie it produced could not be used:
//     the app is served from tauri://localhost, a different site from the
//     gallery, so the cookie is never sent. It carries a bearer token from
//     the pairing handshake instead.
//
// Each has a test here, because each failed silently — a dead button, a
// "could not reach the gallery", a request that 404'd into a bundled asset,
// a sign-in that succeeded and changed nothing — and a silent failure is
// exactly what a regression looks like.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Pretend to be, or not to be, the desktop app. */
function setTauri(on) {
  if (on) window.__TAURI_INTERNALS__ = {};
  else delete window.__TAURI_INTERNALS__;
}

describe('the AI backend is addressable from the desktop app', () => {
  let fetchMock;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: {}, warnings: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    setTauri(false);
    vi.unstubAllGlobals();
  });

  /** Run one feature with the grant call stubbed out, and report the URL used. */
  async function endpointUsed() {
    const { entitlements } = await import('../src/ai/entitlements.js');
    vi.spyOn(entitlements, 'requestGrant').mockResolvedValue({ granted: true, grant: 'g.h' });

    const { runFeature } = await import('../src/ai/aiClient.js');
    await runFeature('ai.patch_review', {});
    return fetchMock.mock.calls[0][0];
  }

  it('posts to a relative path on the web, so previews and local servers work', async () => {
    setTauri(false);
    expect(await endpointUsed()).toBe('/api/ai/run');
  });

  it('names the deployment in the desktop app, where /api is not a thing', async () => {
    setTauri(true);
    const { STUDIO_ORIGIN } = await import('../src/ai/aiClient.js');

    // The whole bug: inside Tauri the pages are bundled files served from
    // tauri://localhost, so '/api/ai/run' resolved to a missing asset and every
    // feature failed *after* its grant had already spent the artist's quota.
    expect(await endpointUsed()).toBe(`${STUDIO_ORIGIN}/api/ai/run`);
  });

  it('lists that origin in both copies of the CSP', async () => {
    // Naming the host is only half of it — connect-src has to allow it, and the
    // desktop policy is the one that matters. Covered in full by
    // editorCspEndpoints.test.js; asserted here against the constant itself so
    // the two cannot drift apart.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { STUDIO_ORIGIN } = await import('../src/ai/aiClient.js');

    const conf = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'),
    );
    expect(conf.app.security.csp).toContain(STUDIO_ORIGIN);
  });
});

describe('openExternal', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setTauri(false);
    vi.unstubAllGlobals();
  });

  it('opens a tab on the web and reports when the browser refused', async () => {
    setTauri(false);
    const { openExternal } = await import('../src/utils/openExternal.js');

    const open = vi.fn().mockReturnValue({ closed: false, close: vi.fn() });
    vi.stubGlobal('open', open);
    expect(await openExternal('https://example.test/x')).not.toBeNull();
    expect(open).toHaveBeenCalledWith('https://example.test/x', '_blank', 'noopener');

    // A popup blocker returns null, and callers have to be able to tell — the
    // publish flow says where the page is instead of pretending it opened.
    vi.stubGlobal('open', vi.fn().mockReturnValue(null));
    expect(await openExternal('https://example.test/x')).toBeNull();
  });

  it('replaces a window under the same label that is showing another page', async () => {
    setTauri(true);

    const closed = [];
    const created = [];
    let existing = null;

    class FakeWebviewWindow {
      constructor(label, options) {
        this.label = label;
        this.options = options;
        created.push(options.url);
        existing = this;
        // The real one emits this once the webview is up.
        setTimeout(() => this._createdHandler?.(), 0);
      }
      static async getByLabel() {
        return existing;
      }
      async setFocus() {
        this.focused = true;
      }
      async close() {
        closed.push(this.options?.url ?? 'existing');
        existing = null;
      }
      async once(event, handler) {
        if (event === 'tauri://created') this._createdHandler = handler;
        return () => {};
      }
    }

    vi.doMock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: FakeWebviewWindow }));
    vi.doMock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => null }));

    const { openExternal } = await import('../src/utils/openExternal.js');

    await openExternal('https://gallery.test/login', { label: 'gallery-account' });
    expect(created).toEqual(['https://gallery.test/login']);

    // Same URL again: focus what is already there, do not stack another.
    await openExternal('https://gallery.test/login', { label: 'gallery-account' });
    expect(created).toHaveLength(1);
    expect(existing.focused).toBe(true);

    // A different page under that label. Tauri has no navigate(), so focusing
    // the old window would show the artist the wrong page — which is exactly
    // what left a stale /gallery window standing in for the pairing page.
    await openExternal('https://gallery.test/desktop', {
      label: 'gallery-account',
    });
    expect(closed).toHaveLength(1);
    expect(created).toEqual([
      'https://gallery.test/login',
      'https://gallery.test/desktop',
    ]);

    vi.doUnmock('@tauri-apps/api/webviewWindow');
    vi.doUnmock('@tauri-apps/api/window');
  });

  it('never calls window.open in the desktop app', async () => {
    setTauri(true);
    const { openExternal } = await import('../src/utils/openExternal.js');

    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal('open', open);

    // The '@tauri-apps/api' import fails under vitest, which is the same path a
    // refusal takes: null, and a warning. What matters is that window.open —
    // blocked in the OS webview, and the reason every link out of the editor
    // was dead there — is not what gets tried.
    await openExternal('https://example.test/x');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the web sign-in flow', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setTauri(false);
    vi.unstubAllGlobals();
    vi.doUnmock('../src/utils/openExternal.js');
  });

  /**
   * A stand-in for the gallery window, whose close we drive by hand.
   *
   * `close()` waits for the flow to have registered its handler: signInToGallery
   * reads the entitlements and opens the window before it subscribes, so a test
   * that fired immediately would be closing a window nobody is watching yet.
   */
  function fakePage() {
    const page = {
      handler: null,
      close: vi.fn().mockResolvedValue(undefined),
      onClosed(callback) {
        page.handler = callback;
      },
      async userClosesIt() {
        for (let i = 0; i < 50 && !page.handler; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!page.handler) throw new Error('nothing subscribed to the window closing');
        await page.handler();
      },
    };
    return page;
  }

  async function loadWithPage(page) {
    vi.doMock('../src/utils/openExternal.js', () => ({
      openExternal: vi.fn().mockResolvedValue(page),
    }));
    return {
      account: await import('../src/ui/accountSession.js'),
      entitlements: (await import('../src/ai/entitlements.js')).entitlements,
    };
  }

  it('resolves as soon as the gallery says the visitor is signed in', async () => {
    const page = fakePage();
    const { account, entitlements } = await loadWithPage(page);

    // Signed out on the first read, signed in on the next: the artist typing a
    // password in the window we just opened.
    vi.spyOn(entitlements, 'loadAccount').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'refreshAccount').mockResolvedValue({ authenticated: true });
    vi.spyOn(entitlements, 'account', 'get').mockReturnValue({ authenticated: false });

    const pending = account.signInToGallery();
    // The close is what ends the wait promptly; without it the poll would get
    // there on its own three seconds later.
    await page.userClosesIt();

    await expect(pending).resolves.toBe(true);
    expect(page.close).toHaveBeenCalled();
  });

  it('gives up quietly when the artist closes the window signed out', async () => {
    const page = fakePage();
    const { account, entitlements } = await loadWithPage(page);

    vi.spyOn(entitlements, 'loadAccount').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'refreshAccount').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'account', 'get').mockReturnValue({ authenticated: false });

    const pending = account.signInToGallery();
    await page.userClosesIt();

    await expect(pending).resolves.toBe(false);
    // Nothing to close: they closed it. Closing it again would be closing a
    // window that is not there.
    expect(page.close).not.toHaveBeenCalled();
  });

  it('does not open a window for someone already signed in', async () => {
    const page = fakePage();
    const { account, entitlements } = await loadWithPage(page);
    const { openExternal } = await import('../src/utils/openExternal.js');

    vi.spyOn(entitlements, 'loadAccount').mockResolvedValue({ authenticated: true });
    vi.spyOn(entitlements, 'account', 'get').mockReturnValue({ authenticated: true });

    await expect(account.signInToGallery()).resolves.toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('names the deployment when the desktop app cannot pair', async () => {
    const { account } = await loadWithPage(fakePage());

    // A gallery without the pairing endpoints refuses every sign-in, and from
    // inside the app that is indistinguishable from being signed out. The hint
    // is what stops an artist debugging their own wifi over a deployment
    // setting.
    expect(account.DESKTOP_ORIGIN_HINT).toMatch(/deployment setting/i);
  });
});

describe('the desktop pairing handshake', () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    setTauri(false);
    vi.unstubAllGlobals();
    try {
      window.localStorage.clear();
    } catch {
      /* no storage in this environment */
    }
  });

  /** A gallery that approves the pairing on the Nth poll. */
  function galleryStub({ approveAfter = 1, startStatus = 200, startBody = null } = {}) {
    let polls = 0;
    return vi.fn(async (url, init) => {
      if (String(url).includes('/api/desktop/pair/start')) {
        return {
          ok: startStatus === 200,
          status: startStatus,
          json: async () =>
            startBody ?? { pairingId: 'pair-1', userCode: 'RZXK-4M7P', expiresAt: 'later' },
        };
      }
      if (String(url).includes('/api/desktop/pair/poll')) {
        polls += 1;
        return {
          ok: true,
          status: 200,
          json: async () =>
            polls >= approveAfter
              ? { status: 'approved', token: 'tok-secret' }
              : { status: 'pending' },
        };
      }
      if (String(url).includes('/api/entitlements')) {
        // Signed in exactly when the token is being sent.
        const authed = Boolean(init?.headers?.Authorization);
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: authed, tier: 'free', features: [], catalog: [] }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  async function load(fetchImpl) {
    setTauri(true);
    vi.stubGlobal('fetch', fetchImpl);
    return {
      pairing: await import('../src/ai/desktopPairing.js'),
      token: await import('../src/ai/desktopToken.js'),
      account: await import('../src/ui/accountSession.js'),
    };
  }

  it('pairs, and the token it stores is sent as a bearer header afterwards', async () => {
    const fetchImpl = galleryStub({ approveAfter: 1 });
    const { pairing, token } = await load(fetchImpl);

    const started = await pairing.startPairing();
    expect(started.pairing.userCode).toBe('RZXK-4M7P');

    const issued = await pairing.waitForToken(started.pairing.pairingId);
    expect(issued).toBe('tok-secret');
    token.setDesktopToken(issued);

    // The point of the whole exercise: the editor's own gallery calls now
    // carry a credential, which a cookie could never have done from here.
    const { entitlements } = await import('../src/ai/entitlements.js');
    await entitlements.refresh();
    const call = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/api/entitlements'));
    expect(call?.[1]?.headers?.Authorization).toBe('Bearer tok-secret');
  });

  it('keeps polling while the gallery says pending', async () => {
    const fetchImpl = galleryStub({ approveAfter: 3 });
    const { pairing } = await load(fetchImpl);

    await expect(pairing.waitForToken('pair-1')).resolves.toBe('tok-secret');
    const polls = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('/pair/poll')
    );
    expect(polls.length).toBeGreaterThanOrEqual(3);
  }, 20000);

  it('says so plainly when the gallery has no pairing endpoints', async () => {
    const fetchImpl = galleryStub({
      startStatus: 503,
      startBody: { error: 'nope', code: 'not_configured' },
    });
    const { pairing } = await load(fetchImpl);

    const started = await pairing.startPairing();
    expect(started.pairing).toBeUndefined();
    expect(started.error).toMatch(/not set up for desktop sign-in/i);
  });

  it('signs out by forgetting the token', async () => {
    const { account, token } = await load(galleryStub());

    token.setDesktopToken('tok-secret');
    expect(token.getDesktopToken()).toBe('tok-secret');

    await expect(account.signOut()).resolves.toBe(true);
    expect(token.getDesktopToken()).toBeNull();
  });
});

describe('the desktop sign-in window', () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    setTauri(false);
    vi.unstubAllGlobals();
    vi.doUnmock('../src/utils/openExternal.js');
    try {
      window.localStorage.clear();
    } catch {
      /* no storage in this environment */
    }
  });

  /**
   * A stand-in for the sign-in window. `finish` plays the part of its page: it
   * may store a token on the shared origin, the way editor/account.html does
   * from its own webview, and then it closes.
   */
  function fakeWindow() {
    const page = { handler: null, close: vi.fn().mockResolvedValue(undefined) };
    page.onClosed = (cb) => {
      page.handler = cb;
    };
    page.finish = async (storedToken) => {
      for (let i = 0; i < 50 && !page.handler; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!page.handler) throw new Error('nothing subscribed to the window closing');
      if (storedToken) {
        window.localStorage.setItem('rhizomium.gallery.desktopToken', storedToken);
      }
      page.handler();
    };
    return page;
  }

  async function loadDesktop(page) {
    setTauri(true);
    // Signed in exactly when a token is being sent, as the real gallery is.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (!String(url).includes('/api/entitlements')) throw new Error(`unexpected fetch: ${url}`);
        const authed = Boolean(init?.headers?.Authorization);
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: authed, tier: 'free', features: [], catalog: [] }),
        };
      })
    );
    const openExternal = vi.fn().mockResolvedValue(page);
    vi.doMock('../src/utils/openExternal.js', () => ({
      openExternal,
      openGalleryInBrowser: vi.fn().mockResolvedValue(true),
    }));
    return {
      openExternal,
      account: await import('../src/ui/accountSession.js'),
      token: await import('../src/ai/desktopToken.js'),
    };
  }

  it('opens the app\'s own sign-in page, not the gallery, in a window of its own', async () => {
    const page = fakeWindow();
    const { account, openExternal } = await loadDesktop(page);

    const pending = account.signInToGallery();
    await page.finish('tok-secret');
    await pending;

    // The gallery in a webview window was the bug: no browser session, magic
    // links landing elsewhere, and no way back to the code once signed in.
    const [url, options] = openExternal.mock.calls[0];
    expect(url).toMatch(/\/account\.html$/);
    expect(url).not.toMatch(/tenderworld/);
    expect(options.label).toBe('account');
  });

  it('is signed in once the window has stored a token and closed', async () => {
    const page = fakeWindow();
    const { account, token } = await loadDesktop(page);

    const said = [];
    const pending = account.signInToGallery({ onStatus: (m) => said.push(m) });
    await page.finish('tok-secret');

    await expect(pending).resolves.toBe(true);
    // Read from storage, not from what the editor had cached before the
    // window opened — the window wrote it from another webview.
    expect(token.getDesktopToken()).toBe('tok-secret');
    expect(said.at(-1)).toBe('Signed in.');
  });

  it('stays signed out when the window is closed without approving', async () => {
    const page = fakeWindow();
    const { account, token } = await loadDesktop(page);

    const pending = account.signInToGallery();
    await page.finish(null);

    await expect(pending).resolves.toBe(false);
    expect(token.getDesktopToken()).toBeNull();
  });

  it('does not count a token it already had as a new sign-in', async () => {
    // A token the gallery no longer honours reads as signed out, so the
    // artist signs in again — and cancels. That old token is not a success.
    window.localStorage.setItem('rhizomium.gallery.desktopToken', 'tok-stale');
    const page = fakeWindow();
    const { account } = await loadDesktop(page);

    // The stub calls any bearer token signed in; make the stale one fail.
    const { entitlements } = await import('../src/ai/entitlements.js');
    vi.spyOn(entitlements, 'loadAccount').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'refreshAccount').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'account', 'get').mockReturnValue({ authenticated: false });

    const pending = account.signInToGallery();
    await page.finish(null);
    await expect(pending).resolves.toBe(false);
  });

  it('is a page the desktop build ships, with a capability of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = process.cwd();

    // Without the entry the packaged app has no account.html, and the window
    // opens onto a missing asset.
    expect(readFileSync(resolve(root, 'vite.config.js'), 'utf8')).toContain(
      "account: resolve(__dirname, 'editor/account.html')"
    );
    expect(readFileSync(resolve(root, 'editor/account.html'), 'utf8')).toContain(
      'src="../src/ui/accountWindow.js"'
    );

    // It closes itself on success, which a window with no capability cannot.
    const capability = JSON.parse(
      readFileSync(resolve(root, 'src-tauri/capabilities/account.json'), 'utf8')
    );
    expect(capability.windows).toEqual(['account']);
    expect(capability.permissions).toContain('core:window:allow-close');

    // And it is not the editor: no creating windows, no output screens.
    const main = JSON.parse(
      readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8')
    );
    expect(main.windows).not.toContain('account');
  });
});

describe('the account under AI debug mode', () => {
  beforeEach(() => vi.resetModules());

  afterEach(async () => {
    const { setAIDebugMode } = await import('../src/ai/debugMode.js');
    setAIDebugMode(false);
    setTauri(false);
    vi.unstubAllGlobals();
    try {
      window.localStorage.clear();
    } catch {
      /* no storage in this environment */
    }
  });

  it('still reports who is signed in, while the tiers stay overridden', async () => {
    // Debug mode invents an admin tier that "is not an account". The Account
    // dialog read that invention too, so an artist who had just paired was
    // told "Not signed in · Admin allowance" by a dialog that never asked.
    setTauri(true);
    window.localStorage.setItem('rhizomium.gallery.desktopToken', 'tok-secret');
    const fetchImpl = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: Boolean(init?.headers?.Authorization),
        tier: 'free',
        tierLabel: 'Free',
        features: [],
        catalog: [],
      }),
    }));
    vi.stubGlobal('fetch', fetchImpl);

    const { setAIDebugMode } = await import('../src/ai/debugMode.js');
    const { entitlements } = await import('../src/ai/entitlements.js');
    const { accountSummary } = await import('../src/ui/accountSession.js');
    setAIDebugMode(true);

    await entitlements.loadAccount();

    expect(accountSummary()).toBe('Signed in · Free');
    // Everything that draws features keeps the debug answer.
    expect(entitlements.tier).toBe('admin');
    expect(entitlements.current.debug).toBe(true);
  });
});

describe('accountSummary', () => {
  beforeEach(() => vi.resetModules());

  it('tells signed in, signed out and unreachable apart', async () => {
    const { accountSummary } = await import('../src/ui/accountSession.js');

    expect(accountSummary({ authenticated: true, tierLabel: 'Studio' }))
      .toBe('Signed in · Studio');
    expect(accountSummary({ authenticated: false, degraded: true }))
      .toBe('Not signed in · gallery unreachable');
    expect(accountSummary({ authenticated: false, tier: 'free', tierLabel: 'Free' }))
      .toBe('Not signed in · Free allowance');
  });
});
