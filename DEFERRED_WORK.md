# Deferred Work

Lightweight backlog of known-but-not-now items. Each points to an in-code
marker rather than re-describing it — read the comment at the location for
context. Markers are greppable:

    rg -n "KNOWN LIMITATION" src

| # | Location | Marker | One-liner |
|---|----------|--------|-----------|
| 1 | `src/codegen/compilers/UtilityNodes.js` (in `compileCustomGLSL`, `<`/`>` counting) | `KNOWN LIMITATION` | Angle brackets counted as generic delimiters collide with `<`/`>` comparison operators → multi-line CustomGLSL comparisons mis-merge. Needs a tokenizer. |
