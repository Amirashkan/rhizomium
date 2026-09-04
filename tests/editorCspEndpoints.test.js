// The editor's CSP has to list every socket it opens.
//
// A missing connect-src entry fails silently and late: the panel just sits at
// "Connecting..." with an error only in the browser console, and nothing in the
// JS tests would catch it because they never load the page. So the origins are
// pinned here against both copies of the policy — the meta tag used by the web
// build and the Tauri config used by the desktop app, which must stay in step.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function connectSrc(policy) {
  const match = policy.match(/connect-src ([^;]*)/);
  if (!match) throw new Error('no connect-src directive found');
  return match[1].trim().split(/\s+/);
}

function editorMetaPolicy() {
  const html = readFileSync(join(repoRoot, 'editor/index.html'), 'utf8');
  const match = html.match(/http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/);
  if (!match) throw new Error('no CSP meta tag found in editor/index.html');
  return match[1];
}

function viewerMetaPolicy() {
  const html = readFileSync(join(repoRoot, 'viewer/index.html'), 'utf8');
  const match = html.match(/http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/);
  if (!match) throw new Error('no CSP meta tag found in viewer/index.html');
  return match[1];
}

function directive(policy, name) {
  const match = policy.match(new RegExp(`${name} ([^;]*)`));
  return match ? match[1].trim().split(/\s+/) : null;
}

function tauriPolicy() {
  const config = JSON.parse(readFileSync(join(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  const policy = config.app?.security?.csp;
  if (!policy) throw new Error('no csp found in tauri.conf.json');
  return policy;
}

// Every WebSocket the editor opens, and what opens it. Both hostname spellings
// are listed because the URL follows window.location: the Python server serves
// the editor from 127.0.0.1 and the Vite dev server from localhost.
const REQUIRED_ORIGINS = [
  ['audio envelope server', 'ws://localhost:8765'],
  ['frame stream server', 'ws://127.0.0.1:8766'],
  ['OSC bridge', 'ws://127.0.0.1:8767'],
  ['OSC bridge', 'ws://localhost:8767'],
  ['NDI bridge', 'ws://127.0.0.1:8768'],
  ['NDI bridge', 'ws://localhost:8768'],

  // The account. Both are same-origin-or-better on the web and neither is in
  // the desktop app, where every page is served from tauri://localhost: the
  // gallery holds the session and the tier (src/ai/entitlements.js), and the
  // editor's own deployment holds the AI backend, which src/ai/aiClient.js has
  // to name by origin rather than by path once it is not the page's own host.
  ['gallery entitlements', 'https://art.tenderworld.org'],
  ['AI backend', 'https://studio.tenderworld.org'],
];

describe('editor CSP allows the sockets the editor opens', () => {
  it.each(REQUIRED_ORIGINS)('meta CSP allows the %s at %s', (_name, origin) => {
    expect(connectSrc(editorMetaPolicy())).toContain(origin);
  });

  it.each(REQUIRED_ORIGINS)('Tauri CSP allows the %s at %s', (_name, origin) => {
    expect(connectSrc(tauriPolicy())).toContain(origin);
  });

  it('keeps the two policies in step with each other', () => {
    // They are maintained by hand in separate files, so drift is the failure
    // mode: a socket added to one build and forgotten in the other.
    expect(new Set(connectSrc(tauriPolicy()))).toEqual(
      new Set(connectSrc(editorMetaPolicy())),
    );
  });
});

// The web patch viewer is a separate page with a separate policy, and a
// deliberately narrower one: it runs patches other people wrote, opened from
// links other people sent, so the set of hosts it may talk to is the point.
describe('the web viewer CSP', () => {
  it('allows the gallery, for entitlements and the patch itself', () => {
    expect(connectSrc(viewerMetaPolicy())).toContain('https://art.tenderworld.org');
  });

  it('allows nothing else off-origin', () => {
    expect(new Set(connectSrc(viewerMetaPolicy()))).toEqual(
      new Set(["'self'", 'https://art.tenderworld.org']),
    );
  });

  it('runs no inline script — the viewer page has none to run', () => {
    // This page was written that way from the start; the editor and the splash
    // have since been brought to the same line (see the suite below).
    expect(directive(viewerMetaPolicy(), 'script-src')).toEqual(["'self'"]);
  });

  it('lets a patch’s inlined textures and videos through', () => {
    // Patch media arrives as data: URLs (see src/core/patchTextures.js); blob:
    // is how a restored video is handed to the player.
    for (const name of ['img-src', 'media-src']) {
      expect(directive(viewerMetaPolicy(), name)).toEqual(expect.arrayContaining(['data:', 'blob:']));
    }
  });
});

// No page the app ships may run inline script.
//
// `script-src 'unsafe-inline'` was the last real hole in an otherwise tight
// policy, and it mattered here more than it does in most apps: the editor
// renders patches other people wrote, and `connect-src` reaches the gallery, so
// script injected into the editor could read the machine and upload what it
// found to the attacker's own account. The three inline blocks that required
// the exemption — the splash's version line, the editor's device check, and the
// warning overlay's onclick — are modules under src/ now.
//
// The failure mode this guards is quiet in one direction and loud in the other:
// re-adding 'unsafe-inline' silently gives the hole back, and adding an inline
// <script> without it leaves a page that only breaks once it is running under
// the real policy, which no other test loads. So check both halves — the
// policies, and the markup they have to be true of.
describe('no page runs inline script', () => {
  // Every HTML page either build emits. viewer/ is web-only and splash.html is
  // desktop-only; the editor and the second monitor ship in both.
  const PAGES = [
    'editor/index.html',
    'editor/second-monitor.html',
    'viewer/index.html',
    'splash.html',
    'index.html',
  ];

  it.each([
    ['the editor meta CSP (web build)', () => editorMetaPolicy()],
    ['the Tauri CSP (desktop build)', () => tauriPolicy()],
    ['the viewer meta CSP', () => viewerMetaPolicy()],
  ])('%s forbids inline script', (_name, policy) => {
    expect(directive(policy(), 'script-src')).toEqual(["'self'"]);
  });

  it.each(PAGES)('%s has no inline <script> block', (page) => {
    const html = readFileSync(join(repoRoot, page), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && body.trim())
      .map(([, , body]) => body.trim().slice(0, 80));
    expect(inline).toEqual([]);
  });

  it.each(PAGES)('%s has no inline event-handler attribute', (page) => {
    const html = readFileSync(join(repoRoot, page), 'utf8');
    // onclick=, onload=, onerror=... An attribute handler is inline script and
    // is blocked by the same directive; bind it with addEventListener instead.
    const handlers = [...html.matchAll(/\son[a-zA-Z]+\s*=\s*["']/g)].map((m) => m[0].trim());
    expect(handlers).toEqual([]);
  });

  it.each(PAGES)('%s has no javascript: URL', (page) => {
    const html = readFileSync(join(repoRoot, page), 'utf8');
    expect(html).not.toMatch(/["'(]\s*javascript:/i);
  });
});
