// The unbundled deployments cannot resolve a bare specifier.
//
// The editor is served UNBUNDLED by rhizo_server.py and by the static Vercel
// host — editor/index.html loads `../main.js` as a plain module script, and
// vercel.json builds nothing — so the browser is handed these files as written.
// A bare `import x from 'pkg'` anywhere in that graph is not a missing feature,
// it is an unresolvable specifier that fails the whole module graph and leaves
// the editor a blank page.
//
// Vite is no kinder about it. `vite:import-analysis` resolves specifiers at
// transform time, so a package listed in package.json but absent from
// `node_modules` — a checkout that has not reinstalled, a registry the machine
// cannot reach — is a 500 on the module rather than a degraded feature. That is
// exactly how '@vercel/speed-insights' took the editor down; a dynamic import
// in a try/catch did not save it, because the failure happened before any
// catch could run.
//
// So: reach third-party packages with `await import('pkg')`, and only ones the
// app can do without. This pins the rule rather than leaving it to the comments
// on each module that follows it (openExternal.js, ScreenWindow.js).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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
