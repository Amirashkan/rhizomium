# Vendored webfonts

Space Grotesk (display/UI) and JetBrains Mono (numerics, ids, code) are the
faces the interface redesign specifies. They are checked in rather than fetched
because the editor ships a strict CSP — `font-src 'self' data:` in
`editor/index.html` and `src-tauri/tauri.conf.json` — so a Google Fonts link
would simply be blocked, and the desktop build has no network at all.

Latin subsets only, `woff2` only. Weights match what the UI actually uses:
Space Grotesk 400/500/600/700, JetBrains Mono 400/500/600.

Source: the `@fontsource/space-grotesk` and `@fontsource/jetbrains-mono`
packages (`files/<family>-latin-<weight>-normal.woff2`). To refresh:

    npm i --no-save @fontsource/space-grotesk @fontsource/jetbrains-mono
    cp node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-{400,500,600,700}-normal.woff2 src/assets/fonts/
    cp node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-{400,500,600}-normal.woff2 src/assets/fonts/
    npm uninstall @fontsource/space-grotesk @fontsource/jetbrains-mono

The `@font-face` rules live in `src/styles/tokens.css`, next to the
`--rz-font-*` tokens that name the families.

Both families are licensed under the SIL Open Font License 1.1.
