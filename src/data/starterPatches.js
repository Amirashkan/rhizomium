// src/data/starterPatches.js — the patches offered on the welcome screen.
//
// A first launch opens on the seed graph (SeedGraphBuilder), which is one
// signal path and deliberately small. These are the next thing to look at: three
// finished patches an artist can open, run and take apart, each built around a
// different move rather than a different node.
//
//   Aurora Field  — one source feeding two places (a branch).
//   Mirror Cells  — a generator read through an effect.
//   Dot Bloom     — two versions of one signal composited back together.
//
// They are written in the same shape the AI patch generator returns — nodes with
// `kind`/`x`/`y`/`params` plus a connection list — so they load through
// replaceGraphWithPatch() with nothing here to maintain about the save format.
// Parameters are only set where they differ from the node's default, and every
// value stays inside the min/max its definition declares; tests/starterPatches
// checks both against the registry.
//
// Each one has to render something on the first frame: a starter patch that
// opens black teaches nothing. That is why every generator here animates gently
// on its own, with no parameter to turn before anything moves.

/** Horizontal distance between columns. A node card is 180 wide. */
const COL = 320;

export const STARTER_PATCHES = [
  {
    id: "aurora-field",
    title: "Aurora Field",
    blurb: "Drifting noise coloured by a gradient, then displaced by the same noise.",
    patch: {
      nodes: [
        {
          id: "noise",
          kind: "ComputeNoise",
          name: "Drift",
          x: 0,
          y: 0,
          // Grayscale: this is a value field driving the gradient below, not a
          // picture in its own right.
          params: { scale: 3.0, octaves: 5, speed: 0.08, colorize: false },
        },
        {
          id: "gradient",
          kind: "ComputeGradient",
          name: "Aurora Ramp",
          x: COL,
          y: 0,
          params: {
            type: "Linear",
            colorMode: "Gradient",
            interpolation: "Smooth",
            inputMix: 1.0,
            colorStops: [
              { position: 0.0, color: [0.04, 0.03, 0.12, 1] },
              { position: 0.4, color: [0.09, 0.35, 0.42, 1] },
              { position: 0.72, color: [0.35, 0.85, 0.62, 1] },
              { position: 1.0, color: [0.95, 0.82, 0.55, 1] },
            ],
          },
        },
        {
          id: "warp",
          kind: "ComputeWarp",
          name: "Curtain",
          x: COL * 2,
          y: 0,
          params: { mode: "Displace", strength: 0.35 },
        },
        { id: "out", kind: "OutputFinal", x: COL * 3, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: "noise", pin: 0 }, to: { nodeId: "gradient", pin: 0 } },
        { from: { nodeId: "gradient", pin: 0 }, to: { nodeId: "warp", pin: 0 } },
        // The branch: the same noise that coloured the image now bends it.
        { from: { nodeId: "noise", pin: 0 }, to: { nodeId: "warp", pin: 1 } },
        { from: { nodeId: "warp", pin: 0 }, to: { nodeId: "out", pin: 0 } },
      ],
    },
  },

  {
    id: "mirror-cells",
    title: "Mirror Cells",
    blurb: "Animated Voronoi cells folded through eight-fold kaleidoscope symmetry.",
    patch: {
      nodes: [
        {
          id: "cells",
          kind: "ComputeVoronoi",
          name: "Cells",
          x: 0,
          y: 0,
          params: { mode: "Cells", scale: 5.0, pointCount: 24, animate: true, speed: 0.12 },
        },
        {
          id: "kaleido",
          kind: "ComputeKaleidoscope",
          name: "Fold",
          x: COL,
          y: 0,
          params: { segments: 8, scale: 1.4, animate: true, speed: 0.2 },
        },
        { id: "out", kind: "OutputFinal", x: COL * 2, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: "cells", pin: 0 }, to: { nodeId: "kaleido", pin: 0 } },
        { from: { nodeId: "kaleido", pin: 0 }, to: { nodeId: "out", pin: 0 } },
      ],
    },
  },

  {
    id: "dot-bloom",
    title: "Dot Bloom",
    blurb: "A dot grid screened back over its own blur — the bloom recipe, in three nodes.",
    patch: {
      nodes: [
        {
          id: "dots",
          kind: "ComputePattern",
          name: "Dots",
          x: 0,
          y: 0,
          params: { type: "Dots", scaleX: 10.0, scaleY: 10.0, thickness: 0.35, smoothness: 0.05 },
        },
        {
          id: "blur",
          kind: "ComputeBlur",
          name: "Halo",
          x: COL,
          y: 0,
          params: { radius: 12.0, quality: "High" },
        },
        {
          id: "mix",
          kind: "ComputeMix",
          name: "Screen Back",
          x: COL * 2,
          y: 0,
          // Screen keeps the halo and lets the sharp dots sit on top of it.
          params: { mode: "Screen", amount: 1.0 },
        },
        { id: "out", kind: "OutputFinal", x: COL * 3, y: 0, params: {} },
      ],
      connections: [
        { from: { nodeId: "dots", pin: 0 }, to: { nodeId: "blur", pin: 0 } },
        { from: { nodeId: "blur", pin: 0 }, to: { nodeId: "mix", pin: 0 } },
        // The other half of the branch: the unblurred dots, over their own halo.
        { from: { nodeId: "dots", pin: 0 }, to: { nodeId: "mix", pin: 1 } },
        { from: { nodeId: "mix", pin: 0 }, to: { nodeId: "out", pin: 0 } },
      ],
    },
  },
];

/** One starter patch by id, or null. */
export function starterPatchById(id) {
  return STARTER_PATCHES.find((entry) => entry.id === id) || null;
}
