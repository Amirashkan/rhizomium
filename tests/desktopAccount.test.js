// The account in the desktop app.
//
// Three things were broken there, and none of them announced itself: the AI
// backend was addressed by a path that does not exist inside Tauri, links out
// of the editor were refused by the OS webview, and there was no route to a
// sign-in page at all. Each has a test here, because each failed silently — a
// dead button, a "could not reach the gallery", a request that 404'd into a
// bundled asset — and a silent failure is exactly what a regression looks like.

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

describe('the sign-in flow', () => {
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

  it('reports the origin problem the editor cannot tell apart from an outage', async () => {
    const { account } = await loadWithPage(fakePage());

    // A CORS rejection reaches JavaScript as an opaque network error, so a
    // gallery that has not been told to accept the desktop app looks exactly
    // like a gallery that is down. The hint is what stops an artist debugging
    // their own wifi over a deployment setting.
    expect(account.DESKTOP_ORIGIN_HINT).toMatch(/deployment setting/i);
  });
});

describe('accountSummary', () => {
  beforeEach(() => vi.resetModules());

  it('tells signed in, signed out and unreachable apart', async () => {
    const { accountSummary } = await import('../src/ui/accountSession.js');

    expect(accountSummary({ authenticated: true, tierLabel: 'Cloude Plus' }))
      .toBe('Signed in · Cloude Plus');
    expect(accountSummary({ authenticated: false, degraded: true }))
      .toBe('Not signed in · gallery unreachable');
    expect(accountSummary({ authenticated: false, tier: 'free', tierLabel: 'Free' }))
      .toBe('Not signed in · Free allowance');
  });
});
