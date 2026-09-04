// Regression: adding a Gradient or Color Adjust before the output froze the audio reactions.
//
// Both nodes are compute nodes, so the fragment chain above them can no longer be drawn straight to
// the screen — it is materialized into a texture by FragmentTextureRenderer, which re-renders only
// when its change-detection hash moves or the node looks time-dependent. Both of those questions
// were asked about the BRIDGED NODE'S OWN params only, and the bridged node is the last one in the
// chain — typically a Color Mix or a Blend with nothing but static params on it. The audio lives
// further up (a Circle whose radius is `=node_<audio>`, or one written as `=audioEnvelope * 0.3`),
// invisible to that check, so the hash sat still and the bridged texture kept the frame it was
// built with while the audio kept moving.
//
// Both questions are now asked about the whole fragment chain that gets compiled into the bridged
// shader, exactly as the video-frame check already walked it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

const renderer = () => new FragmentTextureRenderer({});

const hashOf = (node) =>
  FragmentTextureRenderer.prototype._buildFragmentNodeHash.call(renderer(), node, 0, {});

const timeDependent = (node) =>
  FragmentTextureRenderer.prototype._hasTimeDependentParameters.call(renderer(), node);

describe('an audio-driven chain bridged into a compute node keeps reacting', () => {
  let audio, circle, colorMix;

  beforeEach(() => {
    // Audio → Circle.radius (by reference) → Color Mix → Color Adjust (compute) → Output.
    audio = { id: '10', kind: 'AudioValue', inputs: [], params: { channel: 'kick' }, __audio_value: 0 };
    circle = { id: '11', kind: 'Circle', inputs: [null], params: { radius: '=node_10' } };
    colorMix = { id: '12', kind: 'ColorMix', inputs: ['11'], params: { mode: 'mix' } };
    const colorAdjust = { id: '13', kind: 'ComputeColorAdjust', inputs: ['12'], params: {} };

    globalThis.window = globalThis.window || {};
    window.editor = { graph: { nodes: [audio, circle, colorMix, colorAdjust] } };
    window.graph = {
      nodes: window.editor.graph.nodes,
      getNode: (id) => window.editor.graph.nodes.find((n) => String(n.id) === String(id)),
    };
  });

  afterEach(() => {
    delete window.editor;
    delete window.graph;
  });

  it('moves the hash of the bridged node when an Audio node one hop upstream moves', () => {
    const first = hashOf(colorMix);
    audio.__audio_value = 0.62;

    expect(hashOf(colorMix)).not.toBe(first);
    // Nothing but the audio moved.
    expect(colorMix.params).toEqual({ mode: 'mix' });
  });

  it('treats the bridged node as time-dependent when the audio is written upstream as an expression', () => {
    circle.params = { radius: '=audioEnvelope * 0.3' };

    expect(timeDependent(colorMix)).toBe(true);
  });

  it('sees a Hold and a Count referenced upstream, not only on the bridged node itself', () => {
    const hold = { id: '20', kind: 'Hold', inputs: [], params: {}, __holdValue: 0.1 };
    const count = { id: '21', kind: 'Count', inputs: [], params: {}, __countValue: 3 };
    circle.params = { radius: '=node_20', segments: '=node_21' };
    window.editor.graph.nodes.push(hold, count);

    const first = hashOf(colorMix);
    hold.__holdValue = 0.8;
    const afterHold = hashOf(colorMix);
    count.__countValue = 4;

    expect(afterHold).not.toBe(first);
    expect(hashOf(colorMix)).not.toBe(afterHold);
  });

  it('moves the hash for an Audio node WIRED into the chain, whose value lives on the CPU', () => {
    // The panel's usual way of driving a shape: a wire from the Audio tap into a parameter pin.
    // Nothing about that appears in anyone's params — the value rides on the node object.
    circle.params = { radius: 0.3 };
    circle.inputs = ['10'];

    const first = hashOf(colorMix);
    audio.__audio_value = 0.71;

    expect(hashOf(colorMix)).not.toBe(first);
  });

  it('renders every frame when a Time or Wave node feeds the chain', () => {
    const wave = { id: '40', kind: 'Wave', inputs: [], params: { frequency: 2 } };
    circle.params = { radius: 0.3 };
    circle.inputs = ['40'];
    window.editor.graph.nodes.push(wave);

    expect(timeDependent(colorMix)).toBe(true);
  });

  it('follows a `=node_<id>` reference, not only wires, when deciding the chain is live', () => {
    // The Wave is not wired into anything — the Circle reaches it through its radius expression,
    // which is how the shader reaches it too.
    const wave = { id: '41', kind: 'Wave', inputs: [], params: { frequency: 2 } };
    circle.params = { radius: '=node_41 * 0.3' };
    window.editor.graph.nodes.push(wave);

    expect(timeDependent(colorMix)).toBe(true);
  });

  it('holds the hash still while nothing upstream moves, so a static chain still costs one render', () => {
    audio.__audio_value = 0.4;
    const first = hashOf(colorMix);

    expect(hashOf(colorMix)).toBe(first);
    expect(timeDependent(colorMix)).toBe(false);
  });

  it('does not walk up through a compute node, whose output the input hash already covers', () => {
    const noise = { id: '30', kind: 'ComputeNoise', inputs: [], params: { speed: '=node_10' } };
    const blend = { id: '31', kind: 'ColorMix', inputs: ['30'], params: {} };
    window.editor.graph.nodes.push(noise, blend);

    const first = hashOf(blend);
    audio.__audio_value = 0.9;

    expect(hashOf(blend)).toBe(first);
    expect(timeDependent(blend)).toBe(false);
  });
});
