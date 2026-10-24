// A published video is far larger than the 4.5MB request body the gallery's
// host accepts, so media above DIRECT_UPLOAD_MIN_BYTES goes straight to the
// gallery's storage and the upload request names it by path. These pin that
// split, the fallback for a gallery that predates it, and that retrying
// without the patch does not upload the video a second time.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { uploadArtwork, DIRECT_UPLOAD_MIN_BYTES } = await import('../src/ui/publish.js');

let xhrResponses = [];
let xhrRequests = [];

class FakeXHR {
  constructor() {
    this.upload = { addEventListener: () => {} };
    this._listeners = {};
  }
  addEventListener(type, fn) {
    this._listeners[type] = fn;
  }
  open() {}
  setRequestHeader() {}
  send(formData) {
    const outcome = xhrResponses.shift() || { status: 200, body: { url: 'u', publishUrl: 'p' } };
    xhrRequests.push({
      file: formData.get('file'),
      mediaPath: formData.get('mediaPath'),
      hasPatch: formData.has('patch'),
    });
    queueMicrotask(() => {
      this.status = outcome.status;
      this.responseText = JSON.stringify(outcome.body);
      this._listeners.load?.();
    });
  }
}

const SLOT = {
  path: 'user-1/123.mp4',
  bucket: 'artworks',
  token: 'tok',
  contentType: 'video/mp4',
  apiKey: 'anon',
  resumableUrl: 'https://x.supabase.co/storage/v1/upload/resumable/sign',
  // Small, so one upload is several chunks.
  chunkSize: 1024 * 1024,
};
const UPLOAD_URL = 'https://x.supabase.co/storage/v1/upload/resumable/sign/abc';
const SIZE = DIRECT_UPLOAD_MIN_BYTES + 1;

const big = () => new Blob([new Uint8Array(SIZE)], { type: 'video/mp4' });
const patch = () => ({ blob: new Blob(['{}']), filename: 'p.rz' });

// A stand-in for the gallery's signing route and Supabase's tus endpoint.
// `storage.received` is the byte count it has accepted, which is what HEAD
// reports and what a PATCH at any other offset is refused for (409).
let storage;
let calls;

function fakeFetch(url, init = {}) {
  const method = init.method || 'GET';
  calls.push({ url, method, headers: init.headers || {}, body: init.body });

  if (url.endsWith('/api/rhizo-upload/sign')) {
    return storage.sign();
  }
  if (url === SLOT.resumableUrl && method === 'POST') {
    return new Response(null, { status: 201, headers: { Location: UPLOAD_URL } });
  }
  if (url === UPLOAD_URL && method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'Upload-Offset': String(storage.received) } });
  }
  if (url === UPLOAD_URL && method === 'PATCH') {
    const fault = storage.faults.shift();
    if (fault === 'network') throw new TypeError('Failed to fetch');
    if (fault) return new Response(JSON.stringify({ message: fault.message }), { status: fault.status });
    if (Number(init.headers['Upload-Offset']) !== storage.received) return new Response(null, { status: 409 });
    storage.received += init.body.size;
    return new Response(null, { status: 204, headers: { 'Upload-Offset': String(storage.received) } });
  }
  throw new Error(`unexpected ${method} ${url}`);
}

let fetchMock;

beforeEach(() => {
  storage = {
    received: 0,
    faults: [],
    sign: () => new Response(JSON.stringify(SLOT), { status: 200 }),
  };
  calls = [];
  xhrResponses = [];
  xhrRequests = [];
  vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true, advanceTimeDelta: 1000 });
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  fetchMock = vi.fn(async (url, init) => fakeFetch(url, init));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const patches = () => calls.filter((c) => c.method === 'PATCH');

describe('uploadArtwork with large media', () => {
  it('uploads to storage with the signed token, then names the media by path', async () => {
    const result = await uploadArtwork(big(), 'clip.mp4', null, patch());

    expect(JSON.parse(calls[0].body)).toEqual({ filename: 'clip.mp4', size: SIZE });

    const create = calls[1];
    expect(create.method).toBe('POST');
    expect(create.headers).toMatchObject({ apikey: 'anon', 'x-signature': 'tok', 'Upload-Length': String(SIZE) });
    const metadata = Object.fromEntries(
      create.headers['Upload-Metadata'].split(',').map((pair) => {
        const [key, value] = pair.split(' ');
        return [key, atob(value)];
      }),
    );
    expect(metadata).toMatchObject({ bucketName: 'artworks', objectName: SLOT.path, contentType: 'video/mp4' });

    expect(patches()).toHaveLength(Math.ceil(SIZE / SLOT.chunkSize));
    expect(storage.received).toBe(SIZE);

    expect(xhrRequests).toEqual([{ file: null, mediaPath: SLOT.path, hasPatch: true }]);
    expect(result.patchDropped).toBe(false);
  });

  it('keeps small media in the one request, as before', async () => {
    await uploadArtwork(new Blob(['x'], { type: 'image/webp' }), 'x.webp', null, null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(xhrRequests[0].file).not.toBeNull();
  });

  it('falls back to the one request for a gallery with no signing route', async () => {
    storage.sign = () => new Response('', { status: 404 });

    await uploadArtwork(big(), 'clip.mp4', null, null);

    expect(patches()).toHaveLength(0);
    expect(xhrRequests[0].file).not.toBeNull();
    expect(xhrRequests[0].mediaPath).toBeNull();
  });

  it('retries a rejected patch without uploading the media again', async () => {
    xhrResponses = [{ status: 500, body: { error: 'Patch upload failed: Bucket not found' } }];

    const result = await uploadArtwork(big(), 'clip.mp4', null, patch());

    expect(storage.received).toBe(SIZE);
    expect(patches()).toHaveLength(Math.ceil(SIZE / SLOT.chunkSize));
    expect(xhrRequests.map((r) => [r.mediaPath, r.hasPatch])).toEqual([
      [SLOT.path, true],
      [SLOT.path, false],
    ]);
    expect(result.patchDropped).toBe(true);
  });

  it("surfaces the gallery's refusal to sign", async () => {
    storage.sign = () =>
      new Response(JSON.stringify({ error: 'File too large. Maximum size is 500MB.' }), { status: 413 });

    await expect(uploadArtwork(big(), 'clip.mp4', null, null)).rejects.toThrow(/Maximum size is 500MB/);
    expect(xhrRequests).toHaveLength(0);
  });

  it("surfaces storage's own reason when it refuses the bytes", async () => {
    storage.faults = [{ status: 413, message: 'The object exceeded the maximum allowed size' }];

    await expect(uploadArtwork(big(), 'clip.mp4', null, null)).rejects.toThrow(
      /too large.*exceeded the maximum allowed size/,
    );
    expect(xhrRequests).toHaveLength(0);
  });

  it('resumes a dropped chunk from what storage says it has', async () => {
    storage.faults = [undefined, 'network', { status: 503, message: 'busy' }];

    await uploadArtwork(big(), 'clip.mp4', null, null);

    expect(storage.received).toBe(SIZE);
    expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(2);
    expect(xhrRequests[0].mediaPath).toBe(SLOT.path);
  });
});
