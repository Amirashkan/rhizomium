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
// The second suite is the one that would have caught the original breakage.
// The editor is served UNBUNDLED by rhizo_server.py — editor/index.html loads
// `../main.js` as a plain module script — so a static bare import anywhere in
// its graph is not a missing feature, it is an unresolvable specifier that
// takes the whole page down. Every third-party import in this tree is dynamic
// for that reason; this pins the rule rather than leaving it to the comments.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { speedInsightsApplies, initSpeedInsights } from '../src/utils/speedInsights.js';

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

describe('starting Speed Insights', () => {
  it('resolves false instead of throwing where it does not apply', async () => {
    // The test environment's page is http://localhost, which is one of the
    // hosts above — so this exercises the path every desktop and local boot
    // takes: decide, decline, and never reach for the package at all.
    await expect(initSpeedInsights()).resolves.toBe(false);
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
