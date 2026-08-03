// Vite plugin: run the OSC bridge alongside the dev server.
//
// OSC arrives over UDP and no browser can listen for UDP, so it reaches the
// editor through a small Python bridge. `python rhizo_server.py` starts that
// bridge, but the two Vite-based ways to run the editor — `npm run dev` and
// `npm run tauri:dev`, which runs this same dev server — start no Python at
// all. Without this, OSC in the desktop app means knowing to run a second
// process by hand, and the only symptom of forgetting is the editor reporting
// that it cannot reach the bridge.
//
// Strictly best-effort: the editor is entirely usable without OSC, so every
// failure here is a printed line, never a broken dev server.

import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'

const WS_PORT = 8767
const SCRIPT = 'osc_bridge_server.py'

/** Is something already listening on the bridge's WebSocket port? */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    const done = (answer) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Start `command` on the bridge script, resolving null if it cannot run. */
function tryPython(command, root) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, [SCRIPT], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      resolve(null)
      return
    }

    // ENOENT for a missing interpreter arrives asynchronously, and so does an
    // immediate exit from a missing dependency, so give it a moment to fail
    // before calling it started.
    const settle = setTimeout(() => {
      child.off('error', onError)
      child.off('exit', onExit)
      resolve(child)
    }, 800)

    const onError = () => {
      clearTimeout(settle)
      resolve(null)
    }
    const onExit = () => {
      clearTimeout(settle)
      resolve(null)
    }

    child.once('error', onError)
    child.once('exit', onExit)
  })
}

export function oscBridge() {
  let child = null

  return {
    name: 'rhizomium-osc-bridge',
    apply: 'serve',

    async configureServer(server) {
      const log = (msg) => server.config.logger.info(`  ➜  OSC:      ${msg}`)

      // Opt out for anyone who runs the bridge themselves, or does not want a
      // UDP port opened at all.
      if (process.env.RHIZO_NO_OSC) {
        log('disabled (RHIZO_NO_OSC is set)')
        return
      }

      // rhizo_server.py may already have started one; a second would only fail
      // to bind the port.
      if (await portInUse(WS_PORT)) {
        log(`already running on ws://127.0.0.1:${WS_PORT}/ws`)
        return
      }

      child = (await tryPython('python3', server.config.root))
        ?? (await tryPython('python', server.config.root))

      if (!child) {
        log(`not started — run "npm run osc" for OSC support (needs Python + aiohttp)`)
        return
      }

      child.stderr?.on('data', (data) => {
        const text = String(data)
        // The bridge logs its own startup lines to stderr; only surface the
        // ones the artist can act on.
        if (/error|Traceback|Could not listen/i.test(text)) {
          server.config.logger.warn(`[osc-bridge] ${text.trim()}`)
        }
      })

      child.once('exit', (code) => {
        if (code) server.config.logger.warn(`[osc-bridge] exited with code ${code}`)
        child = null
      })

      log(`listening for OSC on udp://0.0.0.0:9000`)

      const stop = () => {
        if (!child) return
        child.kill()
        child = null
      }
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    },
  }
}

export default oscBridge
