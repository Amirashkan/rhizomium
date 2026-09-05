// Vercel Speed Insights is a property of the *deployment*, not of the app.
//
// It appends a <script> from `/_vercel/speed-insights/script.js` and beacons
// samples to `/_vercel/speed-insights/vitals`. Both are Vercel edge routes, so
// on every other host the script is a 404 and the samples go nowhere — and in
// the desktop app it is worse than useless: `tauri://localhost` has no such
// asset, `tauri dev` reaches for `https://va.vercel-scripts.com/...` which
// `script-src 'self'` refuses, and the offline app acquires telemetry it is not
// supposed to have. The origin gate below is what keeps it on the web.
//
// The tag is appended by hand rather than by '@vercel/speed-insights', which
// for a router-less app contributed nothing but that one line and a bare
// specifier that had to resolve — a stale `node_modules` turned the editor into
// a Vite 500, and the unbundled deployments could not resolve it at all. The
// second suite pins the tag so replacing the package cannot quietly change what
// the deployment collects.
//
// The last suite is the one that would have caught the original breakage. The
// editor is served UNBUNDLED by rhizo_server.py — editor/index.html loads
// `../main.js` as a plain module script — so a static bare import anywhere in
// its graph is not a missing feature, it is an unresolvable specifier that
// takes the whole page down. Every third-party import in this tree is dynamic
// for that reason; this pins the rule rather than leaving it to the comments.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import {
  speedInsightsApplies,
  initSpeedInsights,
  SPEED_INSIGHTS_SCRIPT,
} from '../src/utils/speedInsights.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function page(url, { inTauri = false } = {}) {
  const { protocol, hostname } = new URL(url);
  return { isTauri: inTauri, location: { protocol, hostname } };
}

describe('where Speed Insights runs', () => {
  it('runs on the web deployment', () => {
    expect(speedInsightsApplies(page('https://studio.tenderworld.org/studio'))).toBe(true);
  });

  it('runs on a Vercel preview deployment', () => {
    expect(speedInsightsApplies(page('https://rhizomium-abc123.vercel.app/'))).toBe(true);
  });

  it('does not run in the desktop app', () => {
    // The custom protocol, as served on macOS and Linux.
    expect(speedInsightsApplies(page('tauri://localhost/editor/index.html', { inTauri: true })))
      .toBe(false);
  });

  it('does not run in the desktop app on Windows, which serves over http', () => {
    // http://tauri.localhost passes every protocol check there is, so the
    // hostname has to be refused too — belt and braces with isTauri().
    expect(speedInsightsApplies(page('http://tauri.localhost/editor/index.html', { inTauri: true })))
      .toBe(false);
    expect(speedInsightsApplies(page('http://tauri.localhost/editor/index.html')))
      .toBe(false);
  });

  it('does not run on the Vite dev server', () => {
    expect(speedInsightsApplies(page('http://localhost:5173/editor/'))).toBe(false);
  });

  it('does not run on the Python server', () => {
    expect(speedInsightsApplies(page('http://127.0.0.1:5000/studio'))).toBe(false);
  });

  it('does not run from a file:// URL', () => {
    expect(speedInsightsApplies(page('file:///home/artist/dist/editor/index.html'))).toBe(false);
  });

  it('does not run with no page at all', () => {
    expect(speedInsightsApplies({ isTauri: false, location: undefined })).toBe(false);
  });
});

// A document stub, rather than the happy-dom one: appending a real <script
// src> makes happy-dom fetch it, and the src under test is a Vercel edge route,
// so the suite would either hit the network or log a load failure from outside
// any test. What is being asserted is the tag, not the running of it.
function fakePage(url, { inTauri = false } = {}) {
  const appended = [];
  const window = {};
  const document = {
    defaultView: window,
    createElement: (tagName) => ({ tagName: tagName.toUpperCase() }),
    head: {
      appendChild: (node) => appended.push(node),
      querySelector: (selector) => {
        const src = selector.match(/src="([^"]+)"/)?.[1];
        return appended.find((node) => node.src === src) ?? null;
      },
    },
  };
  return { env: { ...page(url, { inTauri }), document }, appended, window };
}

const VERCEL_PAGE = 'https://studio.tenderworld.org/studio';

describe('starting Speed Insights', () => {
  it('returns false and touches nothing where it does not apply', () => {
    // The test environment's page is http://localhost, which is one of the
    // hosts above — so this exercises the path every desktop and local boot
    // takes: decide, decline, and leave the document alone.
    const { env, appended } = fakePage('http://localhost:5173/editor/');
    expect(initSpeedInsights(env)).toBe(false);
    expect(appended).toEqual([]);
  });

  it('does not inject in the desktop app', () => {
    const { env, appended } = fakePage('tauri://localhost/editor/index.html', { inTauri: true });
    expect(initSpeedInsights(env)).toBe(false);
    expect(appended).toEqual([]);
  });

  it('does not inject in the desktop app on Windows, which serves over http', () => {
    const { env, appended } = fakePage('http://tauri.localhost/editor/index.html', { inTauri: true });
    expect(initSpeedInsights(env)).toBe(false);
    expect(appended).toEqual([]);
  });

  it('appends one script on the deployment', () => {
    const { env, appended } = fakePage(VERCEL_PAGE);
    expect(initSpeedInsights(env)).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0].tagName).toBe('SCRIPT');
  });

  it('points it at the same-origin Vercel route, which is all script-src \'self\' allows', () => {
    // The package reached for https://va.vercel-scripts.com under a
    // development NODE_ENV, and the CSP every page ships refuses that. A
    // root-relative path is same-origin wherever the deployment is served.
    const { env, appended } = fakePage(VERCEL_PAGE);
    initSpeedInsights(env);
    expect(appended[0].src).toBe('/_vercel/speed-insights/script.js');
    expect(appended[0].src).toBe(SPEED_INSIGHTS_SCRIPT);
  });

  it('defers it, so collecting metrics never blocks the editor boot', () => {
    const { env, appended } = fakePage(VERCEL_PAGE);
    initSpeedInsights(env);
    expect(appended[0].defer).toBe(true);
  });

  it('stubs the window.si queue the collector pushes into before it loads', () => {
    const { env, window } = fakePage(VERCEL_PAGE);
    initSpeedInsights(env);
    expect(typeof window.si).toBe('function');
    window.si('event', { name: 'boot' });
    expect(window.siq).toEqual([['event', { name: 'boot' }]]);
  });

  it('leaves an existing window.si alone', () => {
    const { env, window } = fakePage(VERCEL_PAGE);
    const existing = () => {};
    window.si = existing;
    initSpeedInsights(env);
    expect(window.si).toBe(existing);
  });

  it('injects once, so a second entry point cannot double-count samples', () => {
    const { env, appended } = fakePage(VERCEL_PAGE);
    expect(initSpeedInsights(env)).toBe(true);
    expect(initSpeedInsights(env)).toBe(false);
    expect(appended).toHaveLength(1);
  });

  it('does not throw with no document to inject into', () => {
    // A worker, a server-side render, a harness with no DOM: decline rather
    // than dereference a head that is not there.
    const env = { ...page(VERCEL_PAGE), document: {} };
    expect(initSpeedInsights(env)).toBe(false);
  });
});

// Every module the browser may be handed directly, i.e. all of main.js's graph
// and every entry under src/.
function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (name.endsWith('.js') && !name.endsWith('.test.js')) {
      found.push(path);
    }
  }
  return found;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// A static import is always a statement, so every one of these is anchored to
// the start of a line. Matching a bare `from '...'` anywhere instead picks up
// prose in trailing comments, which is not a module specifier.
const STATIC_IMPORT = [
  // import x from 'y' / export { x } from 'y', all on one line.
  /^[^\S\n]*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  // The closing line of a multi-line named import: `} from 'y'`.
  /^[^\S\n]*\}\s*from\s*['"]([^'"]+)['"]/gm,
  // Side-effect import, `import 'y'`. Dynamic `import('y')` has no space and
  // is deliberately not matched — that is the form this rule asks for.
  /^[^\S\n]*import\s+['"]([^'"]+)['"]/gm,
];

/** Every specifier the file imports statically. */
function staticSpecifiers(source) {
  const code = stripComments(source);
  return STATIC_IMPORT.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[1]));
}

const isBare = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('/');

describe('nothing the browser loads unbundled imports a bare specifier', () => {
  const files = [join(repoRoot, 'main.js'), ...sourceFiles(join(repoRoot, 'src'))];

  it('finds the source tree', () => {
    // A broken walk would make the assertion below vacuously true.
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no static bare import anywhere in main.js or src/', () => {
    const offenders = files.flatMap((file) =>
      staticSpecifiers(readFileSync(file, 'utf8'))
        .filter(isBare)
        .map((specifier) => `${relative(repoRoot, file)}: import from '${specifier}'`),
    );

    // Reach third-party packages with `await import('pkg')` instead. The
    // unbundled deployments cannot resolve a bare specifier, and a static one
    // fails the entire module graph rather than just its own feature.
    expect(offenders).toEqual([]);
  });
});
