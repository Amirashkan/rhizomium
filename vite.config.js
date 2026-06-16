import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Tauri serves the built `dist/` as static assets and has no server-side
// rewrites, so the editor must be a real page in the output. Build both the
// landing page and the editor as multi-page entries.
export default defineConfig({
  clearScreen: false,
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
      },
    },
  },
})
