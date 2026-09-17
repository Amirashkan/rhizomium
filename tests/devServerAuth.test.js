// The credential a `npm run dev` browser sends to the gallery.
//
// The bug this pins down cost whole days of the coPerformer never once
// running, and it was one guard:
//
//   getDesktopToken() { if (!isTauri()) return null; ... }
//
// A dev run is a browser, not Tauri, so it held no bearer token. It has no
// cookie either — the gallery is reached through vite.config.js's server-side
// `/gallery-api` proxy, and the browser has no art.tenderworld.org cookie to
// send from localhost in the first place (src/utils/galleryEndpoint.js).
//
// With neither credential the gallery's grant route reads the caller as
// anonymous and prices every feature at the free tier. `ai.performer_live`
// costs more than that, and its refusal is not transient: PerformerDirector
// sets `enabled = false` and stops asking for the rest of the session. An
// Admin account got exactly the same silence as a signed-out one.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEV_SERVER_PORT } from '../src/utils/galleryEndpoint.js';
import {
  desktopAuthHeaders,
  getDesktopToken,
  resetDesktopTokenCache,
  usesBearerToken,
} from '../src/ai/desktopToken.js';

const STORAGE_KEY = 'rhizomium.gallery.desktopToken';
const DEV_URL = `http://localhost:${DEV_SERVER_PORT}/editor/`;
const DEPLOYED_URL = 'https://studio.tenderworld.org/editor/';

/** The URL happy-dom starts on, and the one every other suite expects back. */
const DEFAULT_URL = 'http://localhost:3000/';

beforeEach(() => {
  resetDesktopTokenCache();
  window.localStorage.clear();
  delete window.__TAURI_INTERNALS__;
});

afterEach(() => {
  window.happyDOM.setURL(DEFAULT_URL);
  delete window.__TAURI_INTERNALS__;
  resetDesktopTokenCache();
  window.localStorage.clear();
});

describe('which clients authenticate with a bearer token', () => {
  it('counts the Vite dev server, whose cookie never reaches the gallery', () => {
    window.happyDOM.setURL(DEV_URL);
    expect(usesBearerToken()).toBe(true);
  });

  it('counts the desktop app, served from a different site', () => {
    window.__TAURI_INTERNALS__ = {};
    expect(usesBearerToken()).toBe(true);
  });

  it('does not count a deployed web build, where the cookie does the work', () => {
    window.happyDOM.setURL(DEPLOYED_URL);
    expect(usesBearerToken()).toBe(false);
  });

  it('does not count another local server, which has no proxy to forward through', () => {
    // The raw Python server on 5000, or any other loopback host. Only the Vite
    // dev server has the `/gallery-api` hop, and `strictPort: true` pins it to
    // one port — which is what keeps this from widening to localhost at large.
    window.happyDOM.setURL('http://localhost:5000/editor/');
    expect(usesBearerToken()).toBe(false);
  });
});

describe('reading the token', () => {
  it('hands the dev server the token a pairing stored', () => {
    window.happyDOM.setURL(DEV_URL);
    window.localStorage.setItem(STORAGE_KEY, 'tok-dev');

    expect(getDesktopToken()).toBe('tok-dev');
    expect(desktopAuthHeaders()).toEqual({ Authorization: 'Bearer tok-dev' });
  });

  it('still refuses to read one on a deployed build, token in storage or not', () => {
    window.happyDOM.setURL(DEPLOYED_URL);
    window.localStorage.setItem(STORAGE_KEY, 'tok-web');

    expect(getDesktopToken()).toBeNull();
    expect(desktopAuthHeaders()).toEqual({});
  });

  it('sends nothing when the dev server has not been paired', () => {
    window.happyDOM.setURL(DEV_URL);

    expect(getDesktopToken()).toBeNull();
    expect(desktopAuthHeaders()).toEqual({});
  });
});

describe('the grant call the coPerformer makes', () => {
  async function grantRequest(url) {
    window.happyDOM.setURL(url);
    window.localStorage.setItem(STORAGE_KEY, 'tok-live');
    resetDesktopTokenCache();

    const { EntitlementsClient } = await import('../src/ai/entitlements.js');
    let sent = null;
    const client = new EntitlementsClient({
      baseUrl: '/gallery-api',
      fetch: (_endpoint, init) => {
        sent = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ granted: true, grant: 'g' }),
        });
      },
    });

    await client.requestGrant('ai.performer_live', { units: 3 });
    return sent;
  }

  it('carries the artist’s identity from the dev server', async () => {
    // Without this header the gallery reads the caller as anonymous, answers
    // "free", and the live performer is refused before it ever plays a note.
    const sent = await grantRequest(DEV_URL);

    expect(sent.headers.Authorization).toBe('Bearer tok-live');
  });

  it('leaves it to the cookie on a deployed build', async () => {
    const sent = await grantRequest(DEPLOYED_URL);

    expect(sent.headers.Authorization).toBeUndefined();
    expect(sent.credentials).toBe('include');
  });
});
