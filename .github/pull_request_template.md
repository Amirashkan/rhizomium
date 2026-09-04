## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- What was wrong, or what this makes possible. -->

## How it was tested

<!--
Say what you actually ran and saw. WebGPU is mocked in the test environment, so
if this touches rendering, say what you checked by hand in a browser and on
what GPU. A screenshot or short clip is ideal for a visual change.
-->

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build:web`
- [ ] Checked in a browser (say which, and on what GPU)

## Performance

<!-- Delete this section if the change cannot affect the render loop. -->

- [ ] Does not move a parameter change onto the recompile path
- [ ] Does not add a new `requestAnimationFrame` loop
- [ ] Still holds 60 fps on the patch I tested with

## Checklist

- [ ] Commits are signed off (`git commit -s`) — see [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md#sign-your-commits-off-dco)
- [ ] One logical change; no unrelated refactors in this diff
- [ ] No `eval()` or `new Function()` added
- [ ] Docs updated if behaviour changed
