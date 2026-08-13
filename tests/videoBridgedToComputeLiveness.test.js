// Regression: a video feeding a compute node froze on one frame.
//
// Reported as "it pauses when I add a Transform GPU after it — needs an action to update one
// frame". A compute node cannot sample a fragment node directly, so the fragment subgraph is
// materialized into a texture by FragmentTextureRenderer, which re-renders only when its
// change-detection hash moves. Every term of that hash is a parameter, an expression value or an
// input identity — and a playing video changes none of them. So the hash sat still, the bridged
// texture kept whichever frame was up when the bridge was built, and only an unrelated edit
// (which does move the hash) advanced it by one frame.
//
// The hash now folds in the playback position of every video the node samples, directly or
// through the fragment chain above it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

const hashOf = (node) =>
  FragmentTextureRenderer.prototype._buildFragmentNodeHash.call(
    new FragmentTextureRenderer({}), node, 0, {},
  );

describe('a video bridged into a compute node keeps advancing', () => {
  let video, texture2d, colorMix, computeTransform;

  beforeEach(() => {
    video = { currentTime: 0 };
    texture2d = { id: '5', kind: 'Texture2D', inputs: [null], params: { wrapU: 'repeat' } };
    colorMix = { id: '6', kind: 'ColorMix', inputs: ['5'], params: { mode: 'mix' } };
    computeTransform = { id: '7', kind: 'ComputeTransform', inputs: ['6'], params: {} };

    globalThis.window = globalThis.window || {};
    window.textureManager = { videos: new Map([['5', { video }]]) };
    window.editor = { graph: { nodes: [texture2d, colorMix, computeTransform] } };
    window.graph = { getNode: (id) => window.editor.graph.nodes.find((n) => String(n.id) === String(id)) };
  });

  afterEach(() => {
    delete window.textureManager;
    delete window.editor;
    delete window.graph;
  });

  it('changes the render hash as the video plays, though no parameter moved', () => {
    const first = hashOf(texture2d);
    video.currentTime = 0.033;
    const second = hashOf(texture2d);

    expect(second).not.toBe(first);
    // Nothing but the frame moved.
    expect(texture2d.params).toEqual({ wrapU: 'repeat' });
  });

  it('sees a video several fragment nodes upstream', () => {
    const first = hashOf(colorMix);
    video.currentTime = 0.5;

    expect(hashOf(colorMix)).not.toBe(first);
  });

  it('holds the hash still while the video is paused or held on a trimmed frame', () => {
    const first = hashOf(texture2d);
    expect(hashOf(texture2d)).toBe(first); // same frame, no re-render
  });

  it('adds nothing for a still image, so image nodes render exactly as before', () => {
    window.textureManager.videos = new Map();
    const withoutVideos = hashOf(texture2d);

    window.textureManager.videos = new Map([['999', { video }]]); // a video on some other node
    expect(hashOf(texture2d)).toBe(withoutVideos);
  });

  it('does not walk up through a compute node, whose output the input hash already covers', () => {
    const bridged = { id: '8', kind: 'ColorMix', inputs: ['7'], params: {} };
    window.editor.graph.nodes.push(bridged);

    const first = hashOf(bridged);
    video.currentTime = 2;
    expect(hashOf(bridged)).toBe(first);
  });

  it('survives a cycle in the graph rather than hanging', () => {
    const a = { id: 'a', kind: 'ColorMix', inputs: ['b'], params: {} };
    const b = { id: 'b', kind: 'ColorMix', inputs: ['a'], params: {} };
    window.editor.graph.nodes.push(a, b);

    expect(() => hashOf(a)).not.toThrow();
  });
});
