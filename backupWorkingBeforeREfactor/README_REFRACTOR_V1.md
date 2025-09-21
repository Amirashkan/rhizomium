# Refactor v1 (auto-structured)

- Consolidated to `src/` with clear domains:
  - core/: Editor, Canvas, Connection
  - nodes/: individual node classes
  - codegen/: GLSL/WGSL builders
  - gpu/: renderer
  - assets/: WGSL templates

- Chosen files prefer _fixed_ > _patched_ > _original_ when multiple versions existed.
- All other originals are preserved under `_legacy/` for manual diff and cleanup.
- `index.html` now points to `src/main.js`.

Next steps (suggested):

1. Ensure all imports use relative ESM paths (e.g., `./core/Editor.js`).
2. Remove any global usage (`window.*`) in favor of module exports.
3. Run a quick smoke test with a static server.
4. Delete duplicated implementations after confirming parity.
