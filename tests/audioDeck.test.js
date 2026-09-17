// The Audio panel's transport, addressed from somewhere other than the panel.
//
// This is what the AI performer plays a show's own bed through, so what is
// under test is the handful of promises it makes to that caller: the element is
// the truth about what is playing, a bed loops, a position past the end of the
// track wraps rather than parking at the end, and the live input that a file
// takes over is reported rather than disappearing quietly.

import { describe, it, expect } from 'vitest';
import { createAudioDeck } from '../src/audio/audioDeck.js';

/** The capture client, at the surface the deck actually uses. */
function fakeCapture(overrides = {}) {
  const element = {
    src: '', paused: true, ended: false, readyState: 4, currentTime: 0,
    duration: 60, loop: false, dataset: {},
  };
  return {
    audioElement: element,
    liveKind: null,
    loaded: [],
    async loadFile(file) {
      this.loaded.push(file?.name);
      element.src = `blob:${file?.name}`;
      element.currentTime = 0;
    },
    async play() {
      this.liveKind = null;
      element.paused = false;
    },
    pause() { element.paused = true; },
    stop() { element.paused = true; element.currentTime = 0; },
    ...overrides,
  };
}

const file = (name) => ({ name, size: 1024, type: 'audio/mpeg' });

describe('the audio deck', () => {
  it('says nothing is loaded before anything is', () => {
    const deck = createAudioDeck(fakeCapture());
    expect(deck.describe()).toMatchObject({ loaded: false, playing: false, file: '' });
  });

  it('names the track where every other surface reads the name from', () => {
    // describeAudioSource() reads the element's dataset, so a bed loaded here
    // and a track loaded by hand have to name themselves the same way.
    const capture = fakeCapture();
    const deck = createAudioDeck(capture);

    return deck.load(file('music.mp3'), 'media/music.mp3').then(() => {
      expect(capture.audioElement.dataset.fileName).toBe('media/music.mp3');
      expect(deck.describe().file).toBe('media/music.mp3');
    });
  });

  it('loops a bed, because a set with a hole in it is worse than a repeat', async () => {
    const capture = fakeCapture();
    await createAudioDeck(capture).load(file('music.mp3'), 'music.mp3');
    expect(capture.audioElement.loop).toBe(true);
  });

  it('refuses to play what was never loaded rather than throwing into a frame', async () => {
    const deck = createAudioDeck(fakeCapture());
    expect(await deck.play()).toEqual({ ok: false, reason: 'nothing is loaded' });
  });

  it('reports the live input a file has just taken over', async () => {
    const capture = fakeCapture({ liveKind: 'mic' });
    const deck = createAudioDeck(capture);
    await deck.load(file('music.mp3'), 'music.mp3');

    // One analysis engine: starting the file stops the microphone, and the
    // artist finds out here rather than by noticing the meters changed.
    expect(await deck.play()).toEqual({ ok: true, stoppedLive: 'mic' });
  });

  it('hands back the reason a blocked start was blocked', async () => {
    const capture = fakeCapture({ play: async () => { throw new Error('NotAllowedError'); } });
    const deck = createAudioDeck(capture);
    await deck.load(file('music.mp3'), 'music.mp3');

    expect(await deck.play()).toEqual({ ok: false, reason: 'NotAllowedError' });
  });

  it('reads what is playing off the element rather than off what it was told', async () => {
    const capture = fakeCapture();
    const deck = createAudioDeck(capture);
    await deck.load(file('music.mp3'), 'music.mp3');
    await deck.play();
    expect(deck.describe().playing).toBe(true);

    // Stopped from somewhere else entirely — another window, a track that ran
    // out. The deck has been told nothing and still says the truth.
    capture.audioElement.paused = true;
    expect(deck.describe().playing).toBe(false);
  });

  it('wraps a position past the end of the track', async () => {
    const capture = fakeCapture();
    const deck = createAudioDeck(capture);
    await deck.load(file('music.mp3'), 'music.mp3');

    deck.seek(75);
    // The element would clamp to the duration and sit there, which reads as a
    // dead bed under a section that is still running.
    expect(capture.audioElement.currentTime).toBe(15);
  });

  it('refuses a position that is not one', async () => {
    const capture = fakeCapture();
    const deck = createAudioDeck(capture);
    await deck.load(file('music.mp3'), 'music.mp3');

    expect(deck.seek(-1).ok).toBe(false);
    expect(deck.seek('soon').ok).toBe(false);
    expect(capture.audioElement.currentTime).toBe(0);
  });
});
