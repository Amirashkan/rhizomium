// What a search engine, a link preview, or an assistant reads of this site.
//
// Every page here is JavaScript-first — the landing page paints a canvas, the
// studio is an empty shell until main.js boots, and the documentation is
// docsify rendering markdown in the browser — so the machine-readable half of
// the site lives entirely in <head> and in the files scripts/docs-meta.mjs
// emits at build time. None of it is visible in the app, which is exactly why
// it rots silently: a canonical URL that drifts, an og:image renamed out from
// under the tag, or the docsify placeholder losing its markers all leave a
// page that looks perfect and indexes as a blank.
//
// The rules pinned below:
//
//   - the public pages name one canonical URL each, on the production origin,
//     so previews and /index.html do not compete with them in the index;
//   - the two surfaces that are nobody's destination (the patch viewer, the
//     second-monitor output) stay out of the index, and stay crawlable so the
//     links out of them still count;
//   - link-preview cards carry a title, a description and an image, and the
//     image is a path that survives a build rather than a hashed bundle asset;
//   - the structured data parses and describes this site, not a copy-paste of
//     someone else's;
//   - /docs ships a real index for readers without JavaScript, generated from
//     _sidebar.md, and the shell keeps the markers the generator splices into.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SITE, generate, readSidebar } from '../scripts/docs-meta.mjs';

const root = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// The pages a crawler is meant to reach, and the URL each one claims.
const INDEXED = [
  { file: 'index.html', canonical: `${SITE}/` },
  { file: 'editor/index.html', canonical: `${SITE}/studio` },
  { file: 'docs/index.html', canonical: `${SITE}/docs` },
];

// The pages that must not be indexed. The viewer renders whatever patch a link
// names, so bare /viewer is an empty shell; second-monitor.html is the output
// surface the studio drives on another display and is inert on its own.
const NOINDEX = ['viewer/index.html', 'editor/second-monitor.html'];

const meta = (html, name) =>
  html.match(new RegExp(`<meta\\s+name="${name}"[^>]*content="([^"]*)"`, 'i'))?.[1] ??
  html.match(new RegExp(`<meta\\s+name="${name}"[^>]*\\n?\\s*content="([^"]*)"`, 'i'))?.[1];

const property = (html, prop) =>
  html.match(new RegExp(`<meta\\s+property="${prop}"[^>]*content="([^"]*)"`, 'i'))?.[1] ??
  html.match(new RegExp(`<meta\\s+property="${prop}"[^>]*\\n?\\s*content="([^"]*)"`, 'i'))?.[1];

const canonicalOf = (html) =>
  html.match(/<link\s+rel="canonical"[^>]*href="([^"]*)"/i)?.[1];

describe('indexed pages describe themselves', () => {
  for (const page of INDEXED) {
    describe(page.file, () => {
      const html = read(page.file);

      it('claims its production URL as canonical', () => {
        expect(canonicalOf(html)).toBe(page.canonical);
      });

      it('has a title and a description a result can be built from', () => {
        const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
        expect(title.length).toBeGreaterThan(10);
        expect(title).toMatch(/Rhizomium/);
        // Long enough to say something; short enough not to be truncated into
        // nonsense in a result listing.
        const description = meta(html, 'description') ?? '';
        expect(description.length).toBeGreaterThan(60);
        expect(description.length).toBeLessThan(320);
      });

      it('carries a complete link-preview card', () => {
        expect(property(html, 'og:title')).toBeTruthy();
        expect(property(html, 'og:description')).toBeTruthy();
        expect(property(html, 'og:url')).toBe(page.canonical);
        expect(meta(html, 'twitter:card')).toBe('summary_large_image');
      });

      it('points og:image at a path that outlives a build', () => {
        const image = property(html, 'og:image') ?? '';
        expect(image.startsWith(`${SITE}/`)).toBe(true);
        // Card scrapers fetch this by URL, so it has to be a file that is
        // copied verbatim into dist. Anything Vite bundles is rewritten to a
        // content hash on every build and the tag would rot within a deploy.
        const local = image.slice(`${SITE}/`.length);
        expect(local.startsWith('docs/')).toBe(true);
        expect(existsSync(resolve(root, local))).toBe(true);
      });
    });
  }
});

describe('pages that are nobody‘s destination stay out of the index', () => {
  for (const file of NOINDEX) {
    it(`${file} is noindex, and still followed`, () => {
      const robots = meta(read(file), 'robots') ?? '';
      expect(robots).toMatch(/noindex/);
      // `follow` matters: these pages link back into the site, and a crawler
      // told to ignore the page should still count the links on it.
      expect(robots).toMatch(/follow/);
      expect(robots).not.toMatch(/nofollow/);
    });
  }
});

describe('structured data', () => {
  const blocks = (file) =>
    [...read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]));

  it('parses on the landing page and describes this site', () => {
    const [graph] = blocks('index.html');
    expect(graph['@context']).toBe('https://schema.org');
    const types = graph['@graph'].map((n) => n['@type']);
    expect(types).toContain('WebSite');
    expect(types).toContain('SoftwareApplication');
    // Every URL in the graph has to be ours: a stale example.com left behind
    // from a template is worse than no structured data at all.
    const urls = JSON.stringify(graph).match(/https?:\/\/[^"']+/g) ?? [];
    for (const url of urls) {
      expect(
        url.startsWith(SITE) ||
          url.startsWith('https://schema.org') ||
          url.startsWith('https://github.com/Amirashkan/'),
      ).toBe(true);
    }
  });

  it('parses on the documentation page', () => {
    expect(blocks('docs/index.html')[0]['@context']).toBe('https://schema.org');
  });
});

describe('the documentation is readable without JavaScript', () => {
  it('the docsify shell keeps the markers the generator splices into', () => {
    const html = read('docs/index.html');
    expect(html).toMatch(/<!--docs-fallback-->[\s\S]*<!--\/docs-fallback-->/);
    // The block has to sit inside #app, which is what docsify overwrites when
    // it boots. Anywhere else and readers with JavaScript keep seeing it.
    const app = html.match(/<div id="app">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(app).toMatch(/<!--docs-fallback-->/);
  });

  describe('the build output', () => {
    let out;
    let sidebar;

    beforeAll(() => {
      // Run the generator the way vite.config.js does: against a copy of the
      // shell, after the docs directory has been copied into place.
      out = mkdtempSync(join(tmpdir(), 'rhizomium-docs-meta-'));
      mkdirSync(join(out, 'docs'), { recursive: true });
      cpSync(resolve(root, 'docs'), join(out, 'docs'), { recursive: true });
      generate(resolve(root, 'docs'), out);
      sidebar = readSidebar(resolve(root, 'docs'));
    });

    const emitted = (name) => readFileSync(join(out, name), 'utf8');

    it('replaces the placeholder with an index of every documented page', () => {
      const shell = emitted('docs/index.html');
      expect(shell).not.toMatch(/Loading Rhizomium Documentation/);
      expect(shell).toMatch(/<h1>Rhizomium Documentation<\/h1>/);
      for (const page of sidebar) {
        if (!existsSync(resolve(root, 'docs', page.file))) continue;
        expect(shell).toContain(`href="/docs/${page.file}"`);
      }
    });

    it('lists the same pages in the sitemap, on the production origin', () => {
      const sitemap = emitted('sitemap.xml');
      for (const url of [`${SITE}/`, `${SITE}/studio`, `${SITE}/docs`]) {
        expect(sitemap).toContain(`<loc>${url}</loc>`);
      }
      for (const page of sidebar) {
        if (!existsSync(resolve(root, 'docs', page.file))) continue;
        expect(sitemap).toContain(`<loc>${SITE}/docs/${page.file}</loc>`);
      }
      // Nothing that is deliberately unpublished may leak into it.
      expect(sitemap).not.toMatch(/\/docs\/(internal|profiling)\//);
    });

    it('serves a robots.txt that allows crawling and names the sitemap', () => {
      const robots = emitted('robots.txt');
      expect(robots).toMatch(/^User-agent: \*/m);
      expect(robots).toMatch(/^Allow: \//m);
      expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
      // Disallowing the noindex pages here would be a mistake, not a fix: a
      // crawler that is not allowed to fetch them never reads their meta tag.
      expect(robots).not.toMatch(/^Disallow: \/viewer/m);
    });

    it('still emits the plain-text corpus for assistants', () => {
      expect(emitted('llms.txt')).toMatch(/^# Rhizomium/);
      expect(emitted('llms-full.txt').length).toBeGreaterThan(1000);
    });
  });
});
