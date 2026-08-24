/**
 * patchSource.js — deciding where the viewer's patch comes from, and refusing
 * the places it must not come from.
 *
 * The viewer is opened by a URL, and the URL says which patch to run:
 *
 *   /viewer?patch=<url>      a `.rz` file on the gallery (or on this origin)
 *   /viewer?handoff=<id>     a patch this browser's editor just handed over
 *   /viewer                  nothing yet — the page offers a file picker
 *
 * ## Why the URL form is allowlisted
 *
 * `?patch=` is attacker-controlled by construction: the whole point of the
 * viewer is that someone sends you a link to it. Fetching whatever that
 * parameter says would make every shared viewer link a way to aim a visitor's
 * browser at an arbitrary host — the same beacon problem patchTextures.js
 * refuses for a patch's inlined media, one level up. A patch that renders is
 * worth nothing next to that, so the origin has to be one we publish from.
 *
 * Adding an origin here is a deliberate act: it is the list of hosts a viewer
 * link can make a visitor's browser talk to.
 */

import { deserializePatch } from '../core/patchSerializer.js';
import { GALLERY_ORIGIN } from '../ai/entitlements.js';

/**
 * Origins a `?patch=` URL may point at, besides the page's own.
 *
 * The gallery serves published patches from a public storage bucket, which may
 * be a different host from the site itself (`publish.js` never sees that URL —
 * the gallery hands one back). When a link from the gallery is refused with
 * `blocked_origin`, that bucket host is what belongs in this list.
 */
export const ALLOWED_PATCH_ORIGINS = [GALLERY_ORIGIN];

/** How big a `.rz` file the viewer will read (the gallery's own limit). */
export const MAX_PATCH_BYTES = 5 * 1024 * 1024;

export class PatchSourceError extends Error {
  constructor(message, code = 'patch_unavailable') {
    super(message);
    this.name = 'PatchSourceError';
    this.code = code;
  }
}

/**
 * Resolve a `?patch=` value against the page, and check the result is somewhere
 * we are willing to fetch from.
 *
 * @param {string} value the raw parameter
 * @param {string} pageOrigin e.g. 'https://studio.tenderworld.org'
 * @returns {URL}
 * @throws {PatchSourceError} when the URL is unparseable or off-allowlist
 */
export function resolvePatchUrl(value, pageOrigin) {
  let url;
  try {
    url = new URL(String(value), pageOrigin);
  } catch {
    throw new PatchSourceError('That patch link is not a valid URL.', 'bad_patch_url');
  }

  // http: is allowed only for a local origin serving its own files (the Python
  // server and `npm run dev` both do). Everything else has to be https.
  const sameOrigin = url.origin === pageOrigin;
  if (!/^https?:$/.test(url.protocol)) {
    throw new PatchSourceError(
      'A patch link has to be an http(s) URL.',
      'bad_patch_url',
    );
  }
  if (!sameOrigin && url.protocol !== 'https:') {
    throw new PatchSourceError('A patch link from another site has to be https.', 'blocked_origin');
  }

  if (!sameOrigin && !ALLOWED_PATCH_ORIGINS.includes(url.origin)) {
    throw new PatchSourceError(
      `The viewer only opens patches published to the gallery, not ${url.origin}.`,
      'blocked_origin',
    );
  }

  return url;
}

/**
 * Read the viewer's URL and say what it is being asked to open.
 *
 * @param {URLSearchParams|string} search the page's query string
 * @param {string} pageOrigin
 * @returns {{kind: 'url', url: URL, title: string|null}
 *          |{kind: 'handoff', id: string, title: string|null}
 *          |{kind: 'none', title: null}}
 */
export function describePatchSource(search, pageOrigin) {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const title = params.get('title');

  const handoff = params.get('handoff');
  if (handoff) return { kind: 'handoff', id: String(handoff), title };

  const patch = params.get('patch');
  if (patch) return { kind: 'url', url: resolvePatchUrl(patch, pageOrigin), title };

  return { kind: 'none', title: null };
}

/**
 * Fetch and parse a patch.
 *
 * Credentials are deliberately omitted: a published patch is public, and a
 * viewer link is a thing strangers click.
 */
export async function fetchPatch(url, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(String(url), {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new PatchSourceError(
      'Could not reach the patch. Check your connection and try again.',
      'network',
    );
  }

  if (!res.ok) {
    throw new PatchSourceError(
      res.status === 404
        ? 'That patch is not there any more.'
        : `The patch could not be downloaded (${res.status}).`,
      res.status === 404 ? 'not_found' : 'http_error',
    );
  }

  const text = await res.text();
  if (text.length > MAX_PATCH_BYTES) {
    throw new PatchSourceError('That patch is too large to open in the viewer.', 'too_large');
  }

  return parsePatchText(text);
}

/** Parse `.rz` text into project data, with viewer-facing wording on failure. */
export function parsePatchText(text) {
  try {
    return deserializePatch(text);
  } catch (error) {
    throw new PatchSourceError(error.message, 'bad_patch');
  }
}
