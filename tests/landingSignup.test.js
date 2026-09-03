// Where the landing page's sign-up goes.
//
// The page used to end its sign-up in a dead drop: a form with no action and
// no backend behind it, which said so rather than swallowing the address.
// Accounts have an owner though — the gallery — and the editor already sends
// people to `${GALLERY_ORIGIN}/login` from inside the studio (see
// src/ui/accountSession.js). The landing page now does the same, handing the
// typed address over as the `?email=` the gallery's sign-in page prefills.
//
// Three ways that regresses without the page looking broken, which is why
// each is pinned here:
//
//   - the action drifts off the gallery's sign-in URL, or the field stops
//     being called `email`, and the handoff arrives empty. Nobody sees an
//     error: they see a sign-in form to retype their address into.
//   - the submit handler starts cancelling the navigation again (a fetch, a
//     "you're on the list"), and the address stops reaching the gallery at all
//     while the page reports success.
//   - the validation stops cancelling, and a typo is carried across two
//     domains before anything says so.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GALLERY_ORIGIN } from '../src/utils/galleryEndpoint.js';

const SIGN_IN_URL = `${GALLERY_ORIGIN}/login`;

let form;
let input;
let status;

/** Submits the form the way the button does. @returns {boolean} whether the
 *  browser was left to make the trip. */
function submit(address) {
  input.value = address;
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return !event.defaultPrevented;
}

beforeAll(async () => {
  // The real page, minus the two subresources happy-dom would go to the
  // network for. vitest runs from the repo root; happy-dom rewrites
  // import.meta.url, so resolve from the working directory.
  const html = readFileSync(resolve('index.html'), 'utf8')
    .replace(/<link\b[^>]*>/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/g, '');
  document.documentElement.innerHTML = html;

  // landing.js wires itself up on import, against whatever is in the document.
  await import('../src/landing/landing.js');

  form = document.querySelector('[data-signup]');
  input = form.querySelector('input[type=email]');
  status = form.querySelector('[data-signup-status]');
});

beforeEach(() => {
  status.textContent = '';
  status.removeAttribute('data-tone');
});

describe('the sign-up form', () => {
  it('submits to the gallery sign-in page', () => {
    expect(form.getAttribute('action')).toBe(SIGN_IN_URL);
  });

  it('carries the address as the ?email= the gallery reads', () => {
    // GET, not POST: it has to arrive in the query string. The gallery has no
    // endpoint that would take a body.
    expect(form.getAttribute('method')?.toLowerCase()).toBe('get');
    expect(input.getAttribute('name')).toBe('email');
  });

  it('says where the button leads, and links there as well', () => {
    expect(form.querySelector(`a[href="${SIGN_IN_URL}"]`)).not.toBeNull();
  });
});

describe('the sign-up links', () => {
  it('reach the section that carries the handoff', () => {
    const section = document.querySelector('#signup');
    expect(section.contains(form)).toBe(true);

    // The nav and the footer both offer "sign up"; neither may point at a
    // section that has gone away.
    expect(document.querySelectorAll('a[href="#signup"]').length).toBeGreaterThanOrEqual(2);
  });
});

describe('submitting', () => {
  it('lets a usable address travel to the gallery', () => {
    expect(submit('artist@example.com')).toBe(true);
    expect(status.textContent).toMatch(/gallery/i);
    expect(status.getAttribute('data-tone')).toBeNull();
  });

  it('sends the address nowhere else on the way', async () => {
    const fetched = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetched;
    try {
      submit('artist@example.com');
      // The submit handler is synchronous, but a stray POST need not be.
      await Promise.resolve();
      expect(fetched).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('stops a typo here rather than on the gallery', () => {
    expect(submit('nope')).toBe(false);
    expect(status.getAttribute('data-tone')).toBe('error');
  });

  it('stops an empty field', () => {
    expect(submit('   ')).toBe(false);
    expect(status.getAttribute('data-tone')).toBe('error');
  });
});
