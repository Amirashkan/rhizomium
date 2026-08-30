import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDesktopTokenCache } from '../src/ai/desktopToken.js';
import {
  isPatchAttributable,
  describeUpload,
  uploadArtwork,
  UploadBlockedError,
} from '../src/ui/publish.js';

// Minimal XMLHttpRequest stand-in. Each instance takes its outcome from the
// queue the test set up, so a first-attempt failure and a second-attempt
// success can be scripted in order.
let responses = [];
let requests = [];

class FakeXHR {
  constructor() {
    this.upload = { addEventListener: () => {} };
    this._listeners = {};
    this.withCredentials = false;
    this.headers = {};
    this.opened = false;
  }

  addEventListener(type, fn) {
    this._listeners[type] = fn;
  }

  open() {
    this.opened = true;
  }

  setRequestHeader(name, value) {
    // XHR throws if this is called before open(); the real one would, and a
    // stub that did not would hide the ordering bug it exists to catch.
    if (!this.opened) throw new Error('setRequestHeader before open');
    this.headers[name] = value;
  }

  send(formData) {
    const outcome = responses.shift() || { status: 200, body: {} };
    requests.push({
      hasPatch: formData.has('patch'),
      hasFile: formData.has('file'),
      headers: { ...this.headers },
      withCredentials: this.withCredentials,
    });

    queueMicrotask(() => {
      if (outcome.networkError) {
        this._listeners.error?.();
        return;
      }
      this.status = outcome.status;
      this.responseText = JSON.stringify(outcome.body);
      this._listeners.load?.();
    });
  }
}

const media = () => new Blob(['media-bytes'], { type: 'image/webp' });
const patch = () => ({
  blob: new Blob(['{"schemaVersion":6}'], { type: 'application/json' }),
  filename: 'slow-bloom.rz',
});

beforeEach(() => {
  responses = [];
  requests = [];
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isPatchAttributable', () => {
  it('claims a failure that names the patch', () => {
    const err = new Error('Patch upload failed: Bucket not found (500)');
    err.status = 500;

    expect(isPatchAttributable(err)).toBe(true);
  });

  it('claims a bare 500 - storage faults may not survive naming the cause', () => {
    const err = new Error('Upload failed (500)');
    err.status = 500;

    expect(isPatchAttributable(err)).toBe(true);
  });

  it('does not claim an auth failure - it fails the same without the patch', () => {
    const err = new Error('Unauthorized (401)');
    err.status = 401;

    expect(isPatchAttributable(err)).toBe(false);
  });

  it('does not claim an oversize media failure', () => {
    const err = new Error('File too large (120.00 MB). Server limit exceeded.');
    err.status = 413;

    expect(isPatchAttributable(err)).toBe(false);
  });

  it('does not claim a plain media rejection', () => {
    const err = new Error('Unsupported file type (400)');
    err.status = 400;

    expect(isPatchAttributable(err)).toBe(false);
  });

  it('claims a 400 that names the patch', () => {
    const err = new Error('Patch must be .rz, .json or .zip (400)');
    err.status = 400;

    expect(isPatchAttributable(err)).toBe(true);
  });
});

describe('uploadArtwork', () => {
  it('sends the media and the patch together when all is well', async () => {
    responses = [{ status: 200, body: { url: 'https://cdn/img.webp', patchUrl: 'https://cdn/p.rz' } }];

    const result = await uploadArtwork(media(), 'shader.webp', null, patch());

    expect(requests).toHaveLength(1);
    expect(requests[0].hasPatch).toBe(true);
    expect(result.patchDropped).toBe(false);
    expect(result.data.patchUrl).toBe('https://cdn/p.rz');
  });

  it('republishes without the patch when the gallery has no patches bucket', async () => {
    responses = [
      { status: 500, body: { error: 'Patch upload failed: Bucket not found' } },
      { status: 200, body: { url: 'https://cdn/img.webp', patchUrl: null } },
    ];

    const result = await uploadArtwork(media(), 'shader.webp', null, patch());

    expect(requests).toHaveLength(2);
    expect(requests[0].hasPatch).toBe(true);
    expect(requests[1].hasPatch).toBe(false);
    // The artwork still publishes - that is the whole point.
    expect(result.data.url).toBe('https://cdn/img.webp');
    expect(result.patchDropped).toBe(true);
    expect(result.patchError.message).toMatch(/Bucket not found/);
  });

  // happy-dom's FormData drops the filename argument, so the name the gallery
  // receives is covered by patchFilename() in patchSerializer.test.js instead.
  it('still sends the media on the retry', async () => {
    responses = [
      { status: 500, body: { error: 'Patch upload failed: Bucket not found' } },
      { status: 200, body: { url: 'https://cdn/img.webp' } },
    ];

    await uploadArtwork(media(), 'shader.webp', null, patch());

    expect(requests[1].hasFile).toBe(true);
  });

  it('does not retry when there was no patch to blame', async () => {
    responses = [{ status: 500, body: { error: 'Storage unavailable' } }];

    await expect(uploadArtwork(media(), 'shader.webp', null, null)).rejects.toThrow(/Storage unavailable/);
    expect(requests).toHaveLength(1);
  });

  it('does not retry a 401 - it would only re-upload the media for nothing', async () => {
    responses = [{ status: 401, body: { error: 'Unauthorized' } }];

    await expect(uploadArtwork(media(), 'shader.webp', null, patch())).rejects.toThrow(/Unauthorized/);
    expect(requests).toHaveLength(1);
  });

  it('surfaces the original failure when the retry fails too', async () => {
    responses = [
      { status: 500, body: { error: 'Patch upload failed: Bucket not found' } },
      { status: 500, body: { error: 'Storage unavailable' } },
    ];

    await expect(uploadArtwork(media(), 'shader.webp', null, patch())).rejects.toThrow(/Storage unavailable/);
    expect(requests).toHaveLength(2);
  });
});

describe('describeUpload', () => {
  it('says both landed', () => {
    expect(describeUpload('Image', {}, false)).toMatch(/Image and patch uploaded/);
  });

  it('says the artwork landed without a patch attached', () => {
    expect(describeUpload('Animation', null, false)).toMatch(/Animation uploaded successfully/);
  });

  it('does not claim a patch was published when it was dropped', () => {
    const message = describeUpload('Image', {}, true);

    expect(message).toMatch(/could not store the patch/);
    expect(message).not.toMatch(/and patch uploaded/);
  });
});

// An upload the browser refused to send at all — the CORS case, which is what
// publishing from a dev server hits. XHR reports it identically to being
// offline, so what matters is that the failure names the origin instead of
// saying "Upload failed", and that it is not retried without the patch.
describe('an upload that never left the browser', () => {
  it('names the origin and both possible causes', async () => {
    responses = [{ networkError: true }];

    await expect(uploadArtwork(media(), 'shader.webp', null, patch()))
      .rejects.toThrow(UploadBlockedError);

    responses = [{ networkError: true }];
    const error = await uploadArtwork(media(), 'shader.webp', null, patch()).catch((e) => e);

    expect(error.code).toBe('upload_blocked');
    // Both causes, because XHR cannot tell them apart and neither can we.
    expect(error.message).toMatch(/offline/i);
    expect(error.message).toMatch(/does not allow that origin/i);
    // happy-dom serves the page from localhost, which is the origin the
    // developer hitting this actually needs to see in the message.
    expect(error.message).toContain(window.location.origin);
  });

  it('is not the patch’s fault, so it is not retried without it', async () => {
    expect(isPatchAttributable(new UploadBlockedError('http://localhost:5173', 'https://g/api')))
      .toBe(false);

    responses = [{ networkError: true }];
    await uploadArtwork(media(), 'shader.webp', null, patch()).catch(() => {});
    // One attempt, not two: a blocked request is blocked whatever is in it.
    expect(requests).toHaveLength(1);
  });

  it('still retries without the patch when the gallery answered and blamed it', async () => {
    responses = [
      { status: 500, body: { error: 'Patch upload failed: Bucket not found' } },
      { status: 200, body: { url: 'https://cdn/img.webp' } },
    ];
    const result = await uploadArtwork(media(), 'shader.webp', null, patch());
    expect(result.patchDropped).toBe(true);
    expect(requests).toHaveLength(2);
  });
});

// How an upload says who is making it. A browser on a tenderworld.org host has
// the session cookie; the desktop app is a different site, never gets one, and
// carries a bearer token instead. The upload used to send neither header and
// rely on the cookie alone, so a paired desktop app read its entitlements fine
// and then got 401 on publish.
describe('who the upload says it is', () => {
  afterEach(() => {
    resetDesktopTokenCache();
    delete window.__TAURI__;
    try {
      window.localStorage.removeItem('rhizomium.gallery.desktopToken');
    } catch {
      // A storage-less environment is the signed-out case, which is the default.
    }
  });

  it('sends the cookie and no Authorization header from a browser', async () => {
    responses = [{ status: 200, body: { url: 'https://cdn/img.webp' } }];
    await uploadArtwork(media(), 'shader.webp', null, null);

    expect(requests[0].withCredentials).toBe(true);
    expect(requests[0].headers.Authorization).toBeUndefined();
  });

  it('sends the desktop token when there is one', async () => {
    // getDesktopToken() is gated on the Tauri globals, so both are needed for
    // this to be the desktop case rather than a browser with a stale key.
    window.__TAURI__ = {};
    window.localStorage.setItem('rhizomium.gallery.desktopToken', 'tok-123');
    resetDesktopTokenCache();

    responses = [{ status: 200, body: { url: 'https://cdn/img.webp' } }];
    await uploadArtwork(media(), 'shader.webp', null, null);

    expect(requests[0].headers.Authorization).toBe('Bearer tok-123');
    // Still set: a desktop token and a cookie are not exclusive, and the
    // gallery takes whichever it finds.
    expect(requests[0].withCredentials).toBe(true);
  });

  it('sends the token on the retry that drops the patch too', async () => {
    window.__TAURI__ = {};
    window.localStorage.setItem('rhizomium.gallery.desktopToken', 'tok-123');
    resetDesktopTokenCache();

    responses = [
      { status: 500, body: { error: 'Patch upload failed: Bucket not found' } },
      { status: 200, body: { url: 'https://cdn/img.webp' } },
    ];
    await uploadArtwork(media(), 'shader.webp', null, patch());

    expect(requests).toHaveLength(2);
    // An unauthenticated retry would turn a patch problem into a 401.
    expect(requests[1].headers.Authorization).toBe('Bearer tok-123');
  });
});
