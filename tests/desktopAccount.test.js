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
    await openExternal('https://gallery.test/desktop?code=RZXK-4M7P', {
      label: 'gallery-account',
    });
    expect(closed).toHaveLength(1);
    expect(created).toEqual([
      'https://gallery.test/login',
      'https://gallery.test/desktop?code=RZXK-4M7P',
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
    vi.spyOn(entitlements, 'load').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'refresh').mockResolvedValue({ authenticated: true });
    vi.spyOn(entitlements, 'authenticated', 'get').mockReturnValue(false);

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

    vi.spyOn(entitlements, 'load').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'refresh').mockResolvedValue({ authenticated: false });
    vi.spyOn(entitlements, 'authenticated', 'get').mockReturnValue(false);

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

    vi.spyOn(entitlements, 'load').mockResolvedValue({ authenticated: true });
    vi.spyOn(entitlements, 'authenticated', 'get').mockReturnValue(true);

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

describe('the desktop pairing flow', () => {
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

  async function loadDesktop(fetchImpl, page) {
    setTauri(true);
    vi.stubGlobal('fetch', fetchImpl);
    vi.doMock('../src/utils/openExternal.js', () => ({
      openExternal: vi.fn().mockResolvedValue(page),
    }));
    return {
      account: await import('../src/ui/accountSession.js'),
      token: await import('../src/ai/desktopToken.js'),
    };
  }

  function fakePage() {
    const page = { handler: null, close: vi.fn().mockResolvedValue(undefined) };
    page.onClosed = (cb) => { page.handler = cb; };
    return page;
  }

  it('pairs, stores the token, and sends it as a bearer header afterwards', async () => {
    const fetchImpl = galleryStub({ approveAfter: 1 });
    const { account, token } = await loadDesktop(fetchImpl, fakePage());

    await expect(account.signInToGallery()).resolves.toBe(true);
    expect(token.getDesktopToken()).toBe('tok-secret');

    // The point of the whole exercise: the editor's own gallery calls now
    // carry a credential, which a cookie could never have done from here.
    //
    // The *last* such call, not the first: signInToGallery reads the
    // entitlements before it pairs, to see whether there is anything to do, and
    // that read necessarily predates the token.
    const entitlementsCalls = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('/api/entitlements')
    );
    const afterPairing = entitlementsCalls.at(-1);
    expect(afterPairing?.[1]?.headers?.Authorization).toBe('Bearer tok-secret');
  });

  it('keeps polling while the gallery says pending', async () => {
    const fetchImpl = galleryStub({ approveAfter: 3 });
    const { account } = await loadDesktop(fetchImpl, fakePage());

    await expect(account.signInToGallery()).resolves.toBe(true);
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
    const { account, token } = await loadDesktop(fetchImpl, fakePage());

    const said = [];
    await expect(account.signInToGallery({ onStatus: (m) => said.push(m) })).resolves.toBe(false);
    expect(said.join(' ')).toMatch(/not set up for desktop sign-in/i);
    // Nothing stored on a failed pairing — a half-signed-in app is worse than
    // a signed-out one, because only one of them offers you a way in.
    expect(token.getDesktopToken()).toBeNull();
  });

  it('signs out by forgetting the token', async () => {
    const fetchImpl = galleryStub({ approveAfter: 1 });
    const { account, token } = await loadDesktop(fetchImpl, fakePage());

    await account.signInToGallery();
    expect(token.getDesktopToken()).toBe('tok-secret');

    await expect(account.signOut()).resolves.toBe(true);
    expect(token.getDesktopToken()).toBeNull();
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
