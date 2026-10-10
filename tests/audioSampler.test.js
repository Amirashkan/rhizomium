// The Audio Sampler node: plays one inlined audio file, starting it when its scene comes up and
// stopping it when the scene goes away.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioSamplerProcessor, isPlayableAudioSource } from '../src/core/AudioSamplerProcessor.js';
import { NodeDefs } from '../src/data/NodeDefs.js';

const CLIP = 'data:audio/wav;base64,UklGRg==';
const OTHER_CLIP = 'data:audio/mpeg;base64,SUQz';

function stubAudio() {
  const audio = {
    src: '',
    paused: true,
    loop: false,
    volume: 1,
    playbackRate: 1,
    currentTime: 0,
    play: vi.fn(() => { audio.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { audio.paused = true; }),
    removeAttribute: vi.fn((name) => { if (name === 'src') audio.src = ''; }),
    load: vi.fn(),
  };
  return audio;
}

function sampler(id = 'n1', params = {}) {
  return { id, kind: 'AudioSampler', params: { audioData: CLIP, playOnStart: true, ...params }, inputs: [] };
}

describe('Audio Sampler node', () => {
  let created;
  let proc;

  beforeEach(() => {
    created = [];
    proc = new AudioSamplerProcessor({
      createAudio: () => { const a = stubAudio(); created.push(a); return a; },
    });
  });

  it('is declared as an input node with a file, a hidden clip and play controls', () => {
    const def = NodeDefs.AudioSampler;
    expect(def).toBeTruthy();
    expect(def.pinsOut).toEqual([]);
    expect(def.params.find((p) => p.name === 'audioFile')).toMatchObject({ type: 'file', accept: 'audio/*' });
    expect(def.params.find((p) => p.name === 'audioData')).toMatchObject({ hidden: true });
    expect(def.params.find((p) => p.name === 'playOnStart')).toMatchObject({ default: true });
  });

  it('starts the clip the first frame its scene is live', () => {
    const graph = { nodes: [sampler()] };
    proc.update(graph);
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe(CLIP);
    expect(created[0].play).toHaveBeenCalledTimes(1);

    // Later frames leave it playing rather than restarting it.
    proc.update(graph);
    expect(created[0].play).toHaveBeenCalledTimes(1);
  });

  it('does not start on its own when Play When Scene Starts is off', () => {
    proc.update({ nodes: [sampler('n1', { playOnStart: false })] });
    expect(created[0].play).not.toHaveBeenCalled();
    proc.play('n1');
    expect(created[0].play).toHaveBeenCalledTimes(1);
  });

  it('stops when the scene is switched away, and starts afresh when switched back', () => {
    const sceneA = { nodes: [sampler('node_3')] };
    proc.update(sceneA);
    const first = created[0];

    // Scene B has a sampler under the same id with a different clip.
    proc.update({ nodes: [sampler('node_3', { audioData: OTHER_CLIP })] });
    expect(first.pause).toHaveBeenCalled();
    expect(created[1].src).toBe(OTHER_CLIP);
    expect(created[1].play).toHaveBeenCalled();

    // Scene with no sampler at all: silence.
    proc.update({ nodes: [] });
    expect(created[1].pause).toHaveBeenCalled();
    expect(proc.isPlaying('node_3')).toBe(false);

    // Back to scene A (re-imported, so a fresh node object): its clip starts again.
    proc.update({ nodes: [sampler('node_3')] });
    expect(created).toHaveLength(3);
    expect(created[2].play).toHaveBeenCalled();
  });

  it('applies loop, volume and speed every frame, clamped to what the element accepts', () => {
    const node = sampler('n1', { loop: true, volume: 3, playbackRate: '=2 * 2' });
    proc.update({ nodes: [node] });
    expect(created[0].loop).toBe(true);
    expect(created[0].volume).toBe(1);
    expect(created[0].playbackRate).toBe(4);

    node.params.volume = 0.25;
    proc.update({ nodes: [node] });
    expect(created[0].volume).toBe(0.25);
  });

  it('Stop pauses and rewinds; Play restarts from the top', () => {
    const node = sampler();
    proc.update({ nodes: [node] });
    created[0].currentTime = 4;
    proc.stop('n1');
    expect(created[0].paused).toBe(true);
    expect(created[0].currentTime).toBe(0);

    created[0].currentTime = 2;
    proc.play('n1');
    expect(created[0].currentTime).toBe(0);
    expect(created[0].paused).toBe(false);
  });

  it('refuses anything but an inline data: clip', () => {
    expect(isPlayableAudioSource(CLIP)).toBe(true);
    expect(isPlayableAudioSource('https://example.com/a.mp3')).toBe(false);
    expect(isPlayableAudioSource('')).toBe(false);

    proc.update({ nodes: [sampler('n1', { audioData: 'https://example.com/a.mp3' })] });
    expect(created).toHaveLength(0);
  });

  it('retries a play the browser blocked on the next user gesture', async () => {
    let blocked = true;
    proc = new AudioSamplerProcessor({
      createAudio: () => {
        const a = stubAudio();
        a.play = vi.fn(() => {
          if (blocked) return Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
          a.paused = false;
          return Promise.resolve();
        });
        created.push(a);
        return a;
      },
    });
    proc.update({ nodes: [sampler()] });
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0].paused).toBe(true);

    blocked = false;
    window.dispatchEvent(new window.Event('pointerdown'));
    expect(created[0].play).toHaveBeenCalledTimes(2);
    expect(created[0].paused).toBe(false);
    proc.dispose();
  });
});
