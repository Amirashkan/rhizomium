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
