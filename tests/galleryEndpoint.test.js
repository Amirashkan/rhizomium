// Where a gallery API call goes, and what it carries.
//
// Two failures from the same root, both reported from the desktop app running
// against the dev server:
//
//   - the file manager said "Not signed in" for an app that was signed in. It
//     authenticated with the session cookie alone, and the desktop app has no
//     cookie the gallery will honour — its credential is the paired bearer
//     token, which this file never sent.
//   - publishing died on a CORS preflight to /api/rhizo-upload. That route
//     answers no cross-origin caller at all, so the request was refused before
//     it was sent.
//
// The first is fixed by sending the credential the app actually holds; the
// second by not making the call cross-origin in dev at all — vite.config.js
// forwards it server-side. Both are silent when they regress: a signed-in app
// that quietly reads as anonymous, and an upload that never leaves the browser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEV_SERVER_PORT,
  GALLERY_ORIGIN,
  GALLERY_PROXY_PREFIX,
  galleryApiBase,
  galleryApiUrl,
  isDevServerOrigin,
} from '../src/utils/galleryEndpoint.js';

// vitest runs from the repo root; happy-dom rewrites import.meta.url, so
// resolve from the working directory rather than from this module.
const viteConfig = readFileSync(resolve('vite.config.js'), 'utf8');

describe('recognising the dev server', () => {
  it('matches the Vite dev server on every loopback spelling', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(isDevServerOrigin(`http://${host}:${DEV_SERVER_PORT}`)).toBe(true);
    }
  });

  it('leaves other local servers alone - they have no proxy to forward through', () => {
    // The Python server (rhizo_server.py) serves the raw sources on :5000 and
    // has no /gallery-api route; sending it there would 404 a working call.
    expect(isDevServerOrigin('http://127.0.0.1:5000')).toBe(false);
    expect(isDevServerOrigin('http://localhost:3000')).toBe(false);
  });

  it('is not fooled by a hostname that merely contains the port', () => {
    expect(isDevServerOrigin('https://localhost:51730')).toBe(false);
    expect(isDevServerOrigin('https://5173.example.com')).toBe(false);
  });

  it('says no to the deployments, which reach the gallery directly', () => {
    expect(isDevServerOrigin('https://studio.tenderworld.org')).toBe(false);
    expect(isDevServerOrigin('tauri://localhost')).toBe(false);
    expect(isDevServerOrigin(undefined)).toBe(false);
  });
});

describe('building a gallery API URL', () => {
  it('goes through the same-origin proxy on the dev server', () => {
    const origin = `http://localhost:${DEV_SERVER_PORT}`;
    expect(galleryApiBase(origin)).toBe(GALLERY_PROXY_PREFIX);
    expect(galleryApiUrl('/api/rhizo-upload', origin)).toBe(
      `${GALLERY_PROXY_PREFIX}/api/rhizo-upload`,
    );
  });

  it('names the gallery everywhere else', () => {
    expect(galleryApiUrl('/api/entitlements', 'tauri://localhost')).toBe(
      `${GALLERY_ORIGIN}/api/entitlements`,
    );
    expect(galleryApiUrl('/api/auth/check', 'https://studio.tenderworld.org')).toBe(
      `${GALLERY_ORIGIN}/api/auth/check`,
    );
  });
});

describe('the dev proxy this module depends on', () => {
  // The prefix is only useful because vite.config.js forwards it. Nothing at
  // runtime connects the two, so check they still agree: a renamed prefix or a
  // moved dev-server port would silently send every gallery call into a 404.
  it('is declared in vite.config.js under the prefix this module builds', () => {
    expect(viteConfig).toContain(`'${GALLERY_PROXY_PREFIX}': {`);
    expect(viteConfig).toContain('https://art.tenderworld.org');
  });

  it('strips the prefix before forwarding, so the gallery sees its own paths', () => {
    expect(viteConfig).toMatch(
      new RegExp(`replace\\(/\\^\\\\${GALLERY_PROXY_PREFIX}/, ''\\)`),
    );
  });

  it('runs on the port this module matches on', () => {
    expect(viteConfig).toMatch(new RegExp(`port:\\s*${DEV_SERVER_PORT}\\b`));
    expect(viteConfig).toMatch(/strictPort:\s*true/);
  });
});

describe('the upload endpoint', () => {
  let sent;

  class FakeXHR {
    constructor() {
      this.upload = { addEventListener: () => {} };
      this._listeners = {};
      this.headers = {};
    }

    addEventListener(type, fn) {
      this._listeners[type] = fn;
    }

    setRequestHeader(name, value) {
      this.headers[name] = value;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send() {
      sent = this;
      queueMicrotask(() => {
        this.status = 200;
        this.responseText = JSON.stringify({ url: 'https://art.tenderworld.org/x.webp' });
        this._listeners.load?.();
      });
    }
  }

  beforeEach(() => {
    sent = null;
    vi.resetModules();
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function upload() {
    const { uploadArtwork } = await import('../src/ui/publish.js');
    await uploadArtwork(new Blob(['x']), 'x.webp', null, null);
    return sent;
  }

  it('posts to the gallery from a deployment', async () => {
    expect((await upload()).url).toBe(`${GALLERY_ORIGIN}/api/rhizo-upload`);
  });

  it('posts through the dev proxy on the dev server, where CORS refused it', async () => {
    window.happyDOM.setURL(`http://localhost:${DEV_SERVER_PORT}/editor/`);
    try {
      expect((await upload()).url).toBe(`${GALLERY_PROXY_PREFIX}/api/rhizo-upload`);
    } finally {
      window.happyDOM.setURL('http://localhost:3000/');
    }
  });

  it('carries the desktop token, which is the only credential that app has', async () => {
    window.__TAURI_INTERNALS__ = {};
    window.localStorage.setItem('rhizomium.gallery.desktopToken', 'tok-123');

    expect((await upload()).headers.Authorization).toBe('Bearer tok-123');
  });

  it('sends no Authorization on the web, where the cookie is the credential', async () => {
    const request = await upload();

    expect(request.headers.Authorization).toBeUndefined();
    expect(request.withCredentials).toBe(true);
  });

  it('reports an upload the browser refused to send, naming the origin', async () => {
    class RefusedXHR extends FakeXHR {
      send() {
        queueMicrotask(() => this._listeners.error?.());
      }
    }
    vi.stubGlobal('XMLHttpRequest', RefusedXHR);
    const { uploadArtwork } = await import('../src/ui/publish.js');

    // The CORS case: status 0, no body, nothing to quote back. "Upload failed"
    // sent the artist to look for a server that never heard from them.
    await expect(uploadArtwork(new Blob(['x']), 'x.webp', null, null)).rejects.toThrow(
      new RegExp(window.location.origin),
    );
  });
});
