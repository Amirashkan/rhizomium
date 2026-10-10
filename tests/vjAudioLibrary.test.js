// The VJ panel's audio files: a list kept across reloads, any of which can be
// put into the audio system from the panel.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioLibrary, isAudioFile } from '../src/vj/AudioLibrary.js';
import { VJControlPanel } from '../src/vj/VJControlPanel.js';

/** The record store, in memory, at the surface the library uses. */
function memoryStore(initial = []) {
  const records = new Map(initial.map((r) => [r.id, r]));
  return {
    records,
    getAll: async () => [...records.values()],
    put: async (record) => { records.set(record.id, { ...record }); },
    delete: async (id) => { records.delete(id); },
  };
}

const audio = (name, type = 'audio/mpeg') => new File(['x'.repeat(10)], name, { type });

/** The deck, at the surface the panel uses. */
function fakeDeck() {
  const state = { file: '', loaded: false, playing: false };
  return {
    state,
    loads: [],
    describe: () => ({ ...state }),
    async load(file, name) {
      this.loads.push(name);
      state.file = name;
      state.loaded = true;
      return { ...state };
    },
    async play() { state.playing = true; return { ok: true }; },
    pause() { state.playing = false; return { ok: true }; },
    stop() { state.playing = false; return { ok: true }; },
  };
}

function makePanel(store = memoryStore()) {
  const library = new AudioLibrary(store);
  const deck = fakeDeck();
  const client = { on: vi.fn(), audioElement: { dataset: {} } };
  const editor = {
    graph: { nodes: [] },
    onChange: vi.fn(),
    saveLoadManager: { exportProject: vi.fn(() => ({ nodes: [] })), importProject: vi.fn(async () => true) },
  };
  const panel = new VJControlPanel(editor, { audioLibrary: library, audioDeck: deck, audioClient: client });
  return { panel, library, deck, store };
}

afterEach(() => {
  document.querySelectorAll('#vj-control-panel').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('the audio library', () => {
  it('tells audio from everything else', () => {
    expect(isAudioFile(audio('a.mp3'))).toBe(true);
    expect(isAudioFile({ name: 'b.WAV', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'cover.jpg', type: 'image/jpeg' })).toBe(false);
  });

  it('keeps the files it is given, skipping what is not audio', async () => {
    const store = memoryStore();
    const library = new AudioLibrary(store);
    const { added, skipped } = await library.add([audio('one.mp3'), new File(['x'], 'cover.jpg', { type: 'image/jpeg' })]);

    expect(added.map((t) => t.name)).toEqual(['one.mp3']);
    expect(skipped).toEqual(['cover.jpg']);
    expect(store.records.get(added[0].id).blob).toBeTruthy();
  });

  it('comes back after a reload in the order it was left in', async () => {
    const store = memoryStore();
    const first = new AudioLibrary(store);
    const { added } = await first.add([audio('a.mp3'), audio('b.mp3'), audio('c.mp3')]);
    await first.move(added[2].id, 0);
    await first.rename(added[0].id, 'Intro');

    const second = new AudioLibrary(store);
    await second.load();
    expect(second.getAll().map((t) => t.name)).toEqual(['c.mp3', 'Intro', 'b.mp3']);
  });

  it('forgets a removed file for good', async () => {
    const store = memoryStore();
    const library = new AudioLibrary(store);
    const { added } = await library.add([audio('a.mp3'), audio('b.mp3')]);
    await library.remove(added[0].id);

    const reloaded = new AudioLibrary(store);
    await reloaded.load();
    expect(reloaded.getAll().map((t) => t.name)).toEqual(['b.mp3']);
  });

  it('hands back a file named after the track', async () => {
    const library = new AudioLibrary(memoryStore());
    const { added } = await library.add([audio('a.mp3')]);
    await library.rename(added[0].id, 'Opener');
    const file = library.fileFor(added[0].id);
    expect(file.name).toBe('Opener');
    expect(file.type).toBe('audio/mpeg');
  });

  it('still works for the session where nothing can be saved', async () => {
    const library = new AudioLibrary({
      getAll: async () => { throw new Error('no IndexedDB'); },
      put: async () => { throw new Error('no IndexedDB'); },
      delete: async () => { throw new Error('no IndexedDB'); },
    });
    await library.load();
    await library.add([audio('a.mp3')]);
    expect(library.persistent).toBe(false);
    expect(library.getAll()).toHaveLength(1);
  });
});

describe('the VJ panel audio tab', () => {
  it('lists the library and loads a picked track into the audio system', async () => {
    const { panel, library, deck } = makePanel();
    await library.add([audio('a.mp3'), audio('b.mp3')]);
    panel.show();
    panel.switchTab('audio');

    const rows = panel.audioItems.querySelectorAll('.vj-audio-item');
    expect([...rows].map((r) => r.querySelector('.vj-audio-name').textContent)).toEqual(['a.mp3', 'b.mp3']);

    rows[1].click();
    await vi.waitFor(() => expect(deck.loads).toEqual(['b.mp3']));
    await vi.waitFor(() => {
      const current = panel.audioItems.querySelector('.vj-audio-item.current');
      expect(current?.dataset.audioId).toBe(library.getAll()[1].id);
    });
    expect(deck.state.playing).toBe(false);
  });

  it('keeps playing through a swap', async () => {
    const { panel, library, deck } = makePanel();
    const { added } = await library.add([audio('a.mp3'), audio('b.mp3')]);
    panel.show();
    panel.switchTab('audio');

    await panel.loadAudioTrack(added[0].id, { play: true });
    expect(deck.state.playing).toBe(true);
    await panel.loadAudioTrack(added[1].id);
    expect(deck.state).toMatchObject({ file: 'b.mp3', playing: true });
  });

  it('drops the loaded marker once something else is loaded over the track', async () => {
    const { panel, library, deck } = makePanel();
    const { added } = await library.add([audio('a.mp3')]);
    await panel.loadAudioTrack(added[0].id);
    expect(panel.loadedAudioTrackId()).toBe(added[0].id);

    // The Audio panel loads its own file.
    deck.state.file = 'something-else.wav';
    expect(panel.loadedAudioTrackId()).toBe(null);
  });

  it('adds dropped or picked files and says what it skipped', async () => {
    const { panel, library } = makePanel();
    panel.show();
    panel.switchTab('audio');
    await panel.addAudioFiles([audio('a.mp3'), new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(library.getAll().map((t) => t.name)).toEqual(['a.mp3']);
    expect(panel.audioNowPlaying.textContent).toMatch(/skipped 1 file/);
  });

  it('removes a track from the list without stopping what is playing', async () => {
    const { panel, library, deck } = makePanel();
    const { added } = await library.add([audio('a.mp3')]);
    await panel.loadAudioTrack(added[0].id, { play: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    panel.removeAudioTrack(added[0].id);
    expect(library.size).toBe(0);
    expect(deck.state.playing).toBe(true);
  });
});
