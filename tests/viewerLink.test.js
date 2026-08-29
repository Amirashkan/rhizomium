// The two links the web viewer tool hands back, and the difference between them.
//
// A preview link runs the patch out of this browser's IndexedDB; a share link
// points at a patch on the gallery. Sending someone the first one is the mistake
// worth testing against, so what is checked here is that each is built from the
// right source and that a share link is refused rather than issued when it would
// point somewhere the viewer will not fetch from.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeShareLink } from '../src/ui/viewerLink.js';
import { PatchSourceError } from '../src/viewer/patchSource.js';
import { GALLERY_ORIGIN } from '../src/ai/entitlements.js';

const ORIGIN = 'https://studio.example.org';

describe('makeShareLink', () => {
  it('points the viewer at a patch on the gallery', () => {
    const url = new URL(makeShareLink(`${GALLERY_ORIGIN}/patches/slow-bloom.rz`, { origin: ORIGIN }));
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/viewer');
    expect(url.searchParams.get('patch')).toBe(`${GALLERY_ORIGIN}/patches/slow-bloom.rz`);
  });

  it('carries the title, so the tab is named before the patch has loaded', () => {
    const url = new URL(
      makeShareLink(`${GALLERY_ORIGIN}/p.rz`, { title: 'Slow bloom', origin: ORIGIN }),
    );
    expect(url.searchParams.get('title')).toBe('Slow bloom');
  });

  it('leaves the title out rather than writing an empty one', () => {
    const url = new URL(makeShareLink(`${GALLERY_ORIGIN}/p.rz`, { origin: ORIGIN }));
    expect(url.searchParams.has('title')).toBe(false);
  });

  it('accepts a patch served from the studio’s own origin', () => {
    const url = new URL(makeShareLink(`${ORIGIN}/patches/local.rz`, { origin: ORIGIN }));
    expect(url.searchParams.get('patch')).toBe(`${ORIGIN}/patches/local.rz`);
  });

  it('refuses a host the viewer will not fetch from, here rather than at the far end', () => {
    expect(() => makeShareLink('https://elsewhere.example/p.rz', { origin: ORIGIN }))
      .toThrow(PatchSourceError);
  });

  it('refuses something that is not a link at all', () => {
    expect(() => makeShareLink('not a url', { origin: ORIGIN })).toThrow(PatchSourceError);
    expect(() => makeShareLink('', { origin: ORIGIN })).toThrow(PatchSourceError);
  });

  it('refuses a javascript: URL, whatever else it looks like', () => {
    expect(() => makeShareLink('javascript:alert(1)', { origin: ORIGIN })).toThrow(PatchSourceError);
  });
});

describe('makePreviewLink', () => {
  let makePreviewLink;
  let putHandoff;

  beforeEach(async () => {
    vi.resetModules();

    putHandoff = vi.fn(async () => 'handoff-1');
    vi.doMock('../src/viewer/patchHandoff.js', () => ({ putHandoff }));

    ({ makePreviewLink } = await import('../src/ui/viewerLink.js'));

    window.saveLoadManager = {
      exportProject: () => ({ nodes: [{ id: '1', kind: 'Circle' }], connections: [] }),
      getProjectName: () => 'Slow bloom',
    };
  });

  afterEach(() => {
    vi.doUnmock('../src/viewer/patchHandoff.js');
    delete window.saveLoadManager;
  });

  it('stores the patch in this browser and points the viewer at that record', async () => {
    const { url, title } = await makePreviewLink({ origin: ORIGIN });
    expect(putHandoff).toHaveBeenCalledOnce();

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/viewer');
    expect(parsed.searchParams.get('handoff')).toBe('handoff-1');
    expect(parsed.searchParams.get('title')).toBe('Slow bloom');
    // Never both: a link carrying a patch URL would be shareable, and this one
    // is not.
    expect(parsed.searchParams.has('patch')).toBe(false);
    expect(title).toBe('Slow bloom');
  });

  it('refuses an empty canvas rather than handing over a link to nothing', async () => {
    window.saveLoadManager.exportProject = () => ({ nodes: [], connections: [] });
    await expect(makePreviewLink({ origin: ORIGIN })).rejects.toThrow(/nothing on the canvas/i);
    expect(putHandoff).not.toHaveBeenCalled();
  });

  it('refuses when there is no project to read', async () => {
    delete window.saveLoadManager;
    await expect(makePreviewLink({ origin: ORIGIN })).rejects.toThrow(/could not be read/i);
  });
});

describe('publishForLink', () => {
  let publishForLink;
  let buildPatch;
  let captureStill;
  let uploadArtwork;

  beforeEach(async () => {
    vi.resetModules();

    buildPatch = vi.fn(async () => ({ blob: new Blob(['{}']), filename: 'p.rz' }));
    captureStill = vi.fn(async () => ({
      blob: new Blob(['img']),
      filename: 'shader.webp',
      width: 16,
      height: 9,
    }));
    uploadArtwork = vi.fn(async () => ({
      data: {
        url: `${GALLERY_ORIGIN}/media/shader.webp`,
        patchUrl: `${GALLERY_ORIGIN}/patches/p.rz`,
        publishUrl: `${GALLERY_ORIGIN}/gallery/publish?x=1`,
      },
      patchDropped: false,
    }));

    vi.doMock('../src/ui/publish.js', () => ({ buildPatch, captureStill, uploadArtwork }));
    ({ publishForLink } = await import('../src/ui/viewerLink.js'));

    window.saveLoadManager = { getProjectName: () => 'Slow bloom' };
  });

  afterEach(() => {
    vi.doUnmock('../src/ui/publish.js');
    delete window.saveLoadManager;
  });

  it('publishes the still with the patch and builds a link to the patch', async () => {
    const result = await publishForLink({ origin: ORIGIN });

    // The patch rides with the media in one upload, as the gallery stores them.
    expect(uploadArtwork).toHaveBeenCalledOnce();
    expect(uploadArtwork.mock.calls[0][3]).toMatchObject({ filename: 'p.rz' });

    const url = new URL(result.shareUrl);
    expect(url.searchParams.get('patch')).toBe(`${GALLERY_ORIGIN}/patches/p.rz`);
    expect(url.searchParams.get('title')).toBe('Slow bloom');
    // Not the media URL: a viewer link to a .webp opens an image in the viewer.
    expect(result.shareUrl).not.toContain('shader.webp');
  });

  it('refuses to call it a link when the gallery did not store the patch', async () => {
    uploadArtwork.mockResolvedValue({
      data: { url: `${GALLERY_ORIGIN}/media/shader.webp` },
      patchDropped: true,
    });
    await expect(publishForLink({ origin: ORIGIN })).rejects.toMatchObject({
      code: 'PATCH_NOT_STORED',
    });
  });

  it('names the host when the patch lands somewhere the viewer will not fetch from', async () => {
    uploadArtwork.mockResolvedValue({
      data: {
        url: `${GALLERY_ORIGIN}/media/shader.webp`,
        patchUrl: 'https://bucket.example/patches/p.rz',
      },
      patchDropped: false,
    });
    await expect(publishForLink({ origin: ORIGIN })).rejects.toThrow(/bucket\.example/);
  });

  it('does not upload anything when there is nothing to publish', async () => {
    buildPatch.mockResolvedValue(null);
    await expect(publishForLink({ origin: ORIGIN })).rejects.toThrow(/nothing on the canvas/i);
    expect(captureStill).not.toHaveBeenCalled();
    expect(uploadArtwork).not.toHaveBeenCalled();
  });

  it('stops when the artist cancelled the oversize-patch question', async () => {
    buildPatch.mockResolvedValue({ cancelled: true });
    await expect(publishForLink({ origin: ORIGIN })).rejects.toThrow(/cancelled/i);
    expect(uploadArtwork).not.toHaveBeenCalled();
  });
});
