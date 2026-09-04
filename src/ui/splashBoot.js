// The splash window's two pieces of state.
//
// This ran as an inline <script type="module"> in splash.html until the
// webview's CSP dropped 'unsafe-inline' from `script-src`. It is a file now so
// that the one policy covers every window the app opens — a splash screen with
// an exemption is still an exemption.
//
// 1. The version, so a tester can tell at a glance which build launched.
//    APP_VERSION is substituted from package.json by Vite at build time; it is
//    null in a raw, un-bundled deployment, and then the line simply stays empty
//    rather than reading "vnull".
// 2. A "slower than usual" line. The editor is a GPU app: on a cold shader
//    cache, or behind a driver that is spinning up a discrete card, boot
//    legitimately takes a while. Saying so beats a silent box — and if it never
//    resolves at all, the Rust side gives up on the splash after SPLASH_TIMEOUT
//    and shows the editor window anyway, so the app can still be closed the
//    normal way.

import { APP_VERSION } from '../utils/appVersion.js';

const version = document.getElementById('version');
if (version && APP_VERSION) version.textContent = 'v' + APP_VERSION;

setTimeout(() => {
  const status = document.getElementById('status');
  if (status) status.textContent = 'Still starting — warming up the GPU…';
}, 8000);
