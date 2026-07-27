// Generates the machine-readable companions to the documentation site:
//
//   /llms.txt        curated index for LLMs and assistants (llmstxt.org)
//   /llms-full.txt   the whole corpus as one plain-text document
//   /sitemap.xml     crawlable URLs
//   /robots.txt      crawl policy pointing at the sitemap
//
// The docs render client-side through docsify, so a crawler that does not run
// JavaScript sees almost nothing. These files give both search engines and
// chat assistants the actual prose at stable, no-JavaScript URLs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const SITE = 'https://studio.tenderworld.org';

// Pull the curated order and titles straight from the sidebar so this never
// drifts from the navigation readers actually see.
export function readSidebar(docsDir) {
  const file = join(docsDir, '_sidebar.md');
  if (!existsSync(file)) return [];
  const out = [];
  let section = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const link = line.match(/^\s*\*\s*\[([^\]]+)\]\(([^)]+)\)/);
    const head = line.match(/^\s*\*\s+([^[\s][^\n]*?)\s*$/);
    if (link) {
      const [, title, href] = link;
      if (/^https?:/.test(href) || href === '/') continue;
      out.push({ title: title.trim(), file: href.trim(), section });
    } else if (head) {
      section = head[1].trim();
    }
  }
  return out;
}

// First real paragraph of a page, flattened to one line - used as the
// description in llms.txt.
function summarize(md) {
  const body = md.replace(/^#[^\n]*\n/, '');
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('|') ||
        t.startsWith('>') || t.startsWith('![') || t.startsWith('---')) continue;
    return t.replace(/\s+/g, ' ')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[*_`]/g, '')
            .slice(0, 180);
  }
  return '';
}

export function generate(docsDir, outDir) {
  const pages = readSidebar(docsDir).filter((p) => existsSync(join(docsDir, p.file)));
  mkdirSync(outDir, { recursive: true });

  // --- llms.txt -----------------------------------------------------------
  const bySection = new Map();
  for (const p of pages) {
    if (!bySection.has(p.section)) bySection.set(p.section, []);
    bySection.get(p.section).push(p);
  }
  let llms = `# Rhizomium\n\n`;
  llms += `> A modular GPU node environment for real-time generative visuals, built on `;
  llms += `WebGPU and WGSL. Shaders are composed visually by connecting nodes; parameters `;
  llms += `can be driven by expressions, audio, MIDI or a keyframe timeline. Runs in the `;
  llms += `browser (Chrome/Edge 113+) with no installation, and as a Tauri desktop app.\n\n`;
  llms += `The editor is at ${SITE}/studio and the documentation at ${SITE}/docs.\n`;
  llms += `Every page below is also readable as plain markdown at the URL given.\n\n`;
  for (const [section, list] of bySection) {
    llms += `## ${section || 'Documentation'}\n\n`;
    for (const p of list) {
      const md = readFileSync(join(docsDir, p.file), 'utf8');
      const desc = summarize(md);
      llms += `- [${p.title}](${SITE}/docs/${p.file})${desc ? `: ${desc}` : ''}\n`;
    }
    llms += '\n';
  }
  writeFileSync(join(outDir, 'llms.txt'), llms);

  // --- llms-full.txt ------------------------------------------------------
  let full = `# Rhizomium Documentation (complete)\n\n`;
  full += `Source: ${SITE}/docs\nGenerated from the documentation sources at build time.\n`;
  full += `Rhizomium is a WebGPU node editor for real-time generative visuals.\n\n`;
  for (const p of pages) {
    full += `\n\n${'='.repeat(78)}\n# ${p.title}\n`;
    full += `URL: ${SITE}/docs/${p.file}\n${'='.repeat(78)}\n\n`;
    full += readFileSync(join(docsDir, p.file), 'utf8').replace(/^#\s+[^\n]*\n/, '').trim() + '\n';
  }
  writeFileSync(join(outDir, 'llms-full.txt'), full);

  // --- sitemap.xml --------------------------------------------------------
  // Docsify routes with a hash, which search engines do not treat as distinct
  // URLs, so the markdown sources are listed as well: they are real URLs that
  // return the full text without JavaScript.
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, pri: '1.0' },
    { loc: `${SITE}/studio`, pri: '0.9' },
    { loc: `${SITE}/docs`, pri: '0.9' },
    ...pages.map((p) => ({ loc: `${SITE}/docs/${p.file}`, pri: '0.6' })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
                    `    <priority>${u.pri}</priority>\n  </url>`).join('\n') +
    `\n</urlset>\n`;
  writeFileSync(join(outDir, 'sitemap.xml'), sitemap);

  // --- robots.txt ---------------------------------------------------------
  writeFileSync(join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\n` +
    `# Plain-text corpus for assistants and crawlers that do not run JavaScript.\n` +
    `# ${SITE}/llms.txt\n# ${SITE}/llms-full.txt\n\n` +
    `Sitemap: ${SITE}/sitemap.xml\n`);

  return { pages: pages.length, bytes: full.length };
}
