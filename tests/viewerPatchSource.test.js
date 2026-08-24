// Where the web viewer will and will not fetch a patch from.
//
// `?patch=` is attacker-controlled by construction — a viewer link is a thing
// strangers send you — so the origin is allowlisted rather than followed. These
// tests are the allowlist: a change that widens it should have to change a test
// that says out loud what was widened.

import { describe, it, expect, vi } from 'vitest';
import {
  ALLOWED_PATCH_ORIGINS,
  MAX_PATCH_BYTES,
  PatchSourceError,
  describePatchSource,
  fetchPatch,
  parsePatchText,
  resolvePatchUrl,
} from '../src/viewer/patchSource.js';
import { PATCH_SCHEMA_VERSION } from '../src/core/patchSerializer.js';

const PAGE = 'https://studio.tenderworld.org';
const GALLERY = 'https://art.tenderworld.org';

describe('the patch URL allowlist', () => {
  it('accepts the gallery', () => {
    const url = resolvePatchUrl(`${GALLERY}/patches/slow-bloom.rz`, PAGE);
    expect(url.origin).toBe(GALLERY);
  });

  it('accepts a patch served from the viewer’s own origin, relative or absolute', () => {
    expect(resolvePatchUrl('/presets/demo.rz', PAGE).href).toBe(`${PAGE}/presets/demo.rz`);
    expect(resolvePatchUrl(`${PAGE}/presets/demo.rz`, PAGE).origin).toBe(PAGE);
  });

  it.each([
    'https://attacker.example/beacon.rz',
    'https://art.tenderworld.org.attacker.example/x.rz',
    'https://internal.corp/secrets.rz',
    'http://169.254.169.254/latest/meta-data/',
  ])('refuses %s', (candidate) => {
    expect(() => resolvePatchUrl(candidate, PAGE)).toThrow(PatchSourceError);
    try {
      resolvePatchUrl(candidate, PAGE);
    } catch (error) {
      expect(error.code).toBe('blocked_origin');
    }
  });

  it.each(['javascript:alert(1)', 'data:application/json,{}', 'file:///etc/passwd', 'blob:x'])(
    'refuses the %s scheme outright',
    (candidate) => {
      expect(() => resolvePatchUrl(candidate, PAGE)).toThrow(/http\(s\) URL/);
    },
  );

  it('refuses a plaintext link to another origin even when that origin is allowed', () => {
    expect(() => resolvePatchUrl('http://art.tenderworld.org/x.rz', PAGE)).toThrow(/https/);
  });

  it('allows http for a local origin serving its own files', () => {
    const local = 'http://127.0.0.1:5000';
    expect(resolvePatchUrl('/presets/demo.rz', local).href).toBe(`${local}/presets/demo.rz`);
  });

  it('keeps the allowlist to the gallery until a bucket host is added on purpose', () => {
    expect(ALLOWED_PATCH_ORIGINS).toEqual([GALLERY]);
  });
});

describe('reading the viewer’s own URL', () => {
  it('finds a patch link', () => {
    const source = describePatchSource(
      `?patch=${encodeURIComponent(`${GALLERY}/p/1.rz`)}&title=Slow%20Bloom`,
      PAGE,
    );
    expect(source.kind).toBe('url');
    expect(source.url.href).toBe(`${GALLERY}/p/1.rz`);
    expect(source.title).toBe('Slow Bloom');
  });

  it('finds a handoff from the editor', () => {
    const source = describePatchSource('?handoff=abc-123', PAGE);
    expect(source).toMatchObject({ kind: 'handoff', id: 'abc-123' });
  });

  it('prefers the handoff when both are present, since it is this browser’s own', () => {
    const source = describePatchSource(`?handoff=abc&patch=${GALLERY}/p/1.rz`, PAGE);
    expect(source.kind).toBe('handoff');
  });

  it('reports an empty URL as nothing to open, not as an error', () => {
    expect(describePatchSource('', PAGE).kind).toBe('none');
  });

  it('rejects a hostile patch link while reading the URL', () => {
    expect(() => describePatchSource('?patch=https://attacker.example/x.rz', PAGE)).toThrow(
      PatchSourceError,
    );
  });
});

describe('fetching a patch', () => {
  const patch = { app: 'Rhizomium-Web', schemaVersion: PATCH_SCHEMA_VERSION, nodes: [], connections: [] };

  function response(body, { status = 200 } = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  it('parses a patch and never sends credentials with the request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(patch));
    const result = await fetchPatch(`${GALLERY}/p/1.rz`, { fetchImpl });

    expect(result).toMatchObject({ app: 'Rhizomium-Web' });
    expect(fetchImpl.mock.calls[0][1].credentials).toBe('omit');
  });

  it('says a missing patch is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response('', { status: 404 }));
    await expect(fetchPatch(`${GALLERY}/p/1.rz`, { fetchImpl })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('reports a network failure as one', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchPatch(`${GALLERY}/p/1.rz`, { fetchImpl })).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('refuses a patch larger than the gallery’s own limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response('x'.repeat(MAX_PATCH_BYTES + 1)));
    await expect(fetchPatch(`${GALLERY}/p/1.rz`, { fetchImpl })).rejects.toMatchObject({
      code: 'too_large',
    });
  });

  it('turns a parse failure into a viewer-facing error', () => {
    expect(() => parsePatchText('not json')).toThrow(PatchSourceError);
    expect(() => parsePatchText(JSON.stringify({ schemaVersion: 9999 }))).toThrow(/newer version/i);
  });
});
