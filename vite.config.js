import { defineConfig } from 'vite'
import { resolve, sep } from 'node:path'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { generate as generateDocsMeta } from './scripts/docs-meta.mjs'
import { oscBridge } from './scripts/osc-bridge-plugin.mjs'

// Single source of truth for the version the app reports about itself (see
// src/utils/appVersion.js) - read from package.json so it cannot drift.
const { version: appVersion } = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
)

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


// The web viewer is `viewer/index.html`, reached at `/viewer`. Both deployments
// route that path explicitly — Vercel with a rewrite, the Python server with a
// route — but Vite's dev server does not: an extensionless path it cannot
// resolve falls through to the root index.html, so `/viewer` quietly served the
// landing page while only `/viewer/` worked. The editor's "Open in Web Viewer"
// link is built from the former, so map it here and keep the three servers
// answering the same URL.
function viewerRoute() {
  return {
    name: 'rhizomium-viewer-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/viewer' || req.url?.startsWith('/viewer?')) {
          req.url = `/viewer/index.html${req.url.slice('/viewer'.length)}`
        }
        next()
      })
    },
  }
}

// Tauri serves the built `dist/` as static assets and has no server-side
// rewrites, so the editor must be a real page in the output.
//
// The two targets want different front doors, which is what `--mode desktop`
// (npm run build:desktop) selects between:
//
//   web     - index.html, the landing page, with the editor behind its
//             "Launch Studio" button, plus the web patch viewer.
//   desktop - splash.html, the borderless launch window. The landing page is
//             left out of the bundle entirely: an installed application does
//             not market itself to the person who just double-clicked it, it
//             opens. Tauri points its hidden main window straight at the
//             editor and the splash covers the boot (see src-tauri/src/lib.rs).
//
// Both build the editor, the second-monitor viewer and the web patch viewer,
// which are the pages that actually do the work.
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'desktop'

  return {
    clearScreen: false,
    plugins: [copyDocs(), oscBridge(), viewerRoute()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
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
          ...(isDesktop
            ? { splash: resolve(__dirname, 'splash.html') }
            : {
                main: resolve(__dirname, 'index.html'),
                // The web patch viewer (/viewer). Its own entry so Rollup keeps
                // it lean: it shares the codegen and the renderer with the
                // editor but none of the editor's UI, and the whole point of
                // the page is that it boots fast on someone else's link.
                //
                // Web-only, like the landing page. It opens in a second tab,
                // and the OS WebView the desktop app renders in blocks
                // window.open() outright — the desktop app's own full-screen
                // surface is the second-monitor viewer.
                viewer: resolve(__dirname, 'viewer/index.html'),
              }),
          editor: resolve(__dirname, 'editor/index.html'),
          'second-monitor': resolve(__dirname, 'editor/second-monitor.html'),
        },
      },
      // The editor entry lands around 1.4 MB (~340 kB gzipped) and trips
      // Rollup's default 500 kB advisory. That default targets apps with a
      // deferrable route/vendor split; this one has neither. `main.js` wires up
      // every subsystem - GPU, WGSL codegen, 3D scene, MIDI/OSC/audio, the whole
      // panel set - during boot, so there is no import to move behind a dynamic
      // import() without changing startup behaviour, and there is no third-party
      // dependency of any size to peel off into a vendor chunk. Forcing a split
      // with `manualChunks` actively hurt: grouping by source directory pulled
      // the whole app into shared chunks and inflated the deliberately-lean
      // second-monitor viewer page from ~100 kB to the full bundle, because
      // Rollup's automatic per-entry splitting is what keeps those entries
      // apart. Raise the threshold so the advisory reports real growth instead
      // of firing on every build; lowering it again is the checkpoint if the
      // editor boot path ever does get split.
      chunkSizeWarningLimit: 1500,
    },
  }
})
