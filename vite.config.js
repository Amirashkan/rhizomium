import { defineConfig } from 'vite'
import { resolve, sep } from 'node:path'
import { cpSync, existsSync } from 'node:fs'
import { generate as generateDocsMeta } from './scripts/docs-meta.mjs'

// `docs/` is a self-contained docsify site: `docs/index.html` pulls docsify
// from a CDN and fetches the markdown next to it at runtime. Rollup only emits
// the HTML entries it is given, and markdown is never imported by any module,
// so without this the whole documentation site is missing from `dist/` and
// `/docs` 404s. Copy the directory verbatim after the bundle is written.
function copyDocs() {
  const src = resolve(__dirname, 'docs')
  // Local profiling output (gitignored) — not part of the published site.
  const skip = resolve(src, 'profiling')
  return {
    name: 'rhizomium-copy-docs',
    apply: 'build',
    closeBundle() {
      if (!existsSync(src)) return
      cpSync(src, resolve(__dirname, 'dist/docs'), {
        recursive: true,
        filter: (from) => from !== skip && !from.startsWith(skip + sep),
      })
      // The docs render client-side, so a crawler that does not execute
      // JavaScript sees an empty shell. Emit the plain-text corpus and the
      // sitemap next to it, from the same sources, so they cannot drift.
      const { pages } = generateDocsMeta(src, resolve(__dirname, 'dist'))
      this.info?.(`docs: copied site + generated llms.txt, llms-full.txt, sitemap.xml, robots.txt (${pages} pages)`)
    },
  }
}

// Tauri serves the built `dist/` as static assets and has no server-side
// rewrites, so the editor must be a real page in the output. Build both the
// landing page and the editor as multi-page entries.
export default defineConfig({
  clearScreen: false,
  plugins: [copyDocs()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'chrome105',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor/index.html'),
        'second-monitor': resolve(__dirname, 'editor/second-monitor.html'),
      },
    },
  },
})
