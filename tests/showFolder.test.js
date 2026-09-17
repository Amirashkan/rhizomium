// Reading a show out of a directory: which file is the manifest, which files
// are media, and what a look's "media" list actually resolves to.
//
// None of it touches a directory handle, a GPU or a model — the index works on
// a plain list of {path, file}, which is the whole reason it can be tested at
// the level the artist experiences it: a folder with a typo in it.

import { describe, it, expect } from 'vitest';
import {
  MEDIA_LIMITS,
  classifyMedia,
  folderPickerKind,
  indexShowFolder,
  mediaSlotName,
  mediaSlots,
  readFileList,
  readMediaDataUrl,
  resolveLookMedia,
} from '../src/performer/ShowFolder.js';

/** A file as a directory hands one over: a name, a type and a size. */
const file = (name, { size = 1024, type = '' } = {}) => ({ name, size, type });

const entry = (path, options) => ({ path, file: file(path.split('/').pop(), options) });

const FOLDER = [
  entry('night-set.rzshow.json'),
  entry('media/fog-loop.mp4', { type: 'video/mp4', size: 4 * 1024 * 1024 }),
  entry('media/grain.png', { type: 'image/png' }),
  entry('media/plates/room.jpg', { type: 'image/jpeg' }),
  entry('set.wav', { type: 'audio/wav' }),
  entry('notes.txt', { type: 'text/plain' }),
];

describe('classifyMedia', () => {
  it('reads the extension, so a clip with no MIME type is still a clip', () => {
    // A .mov off some file managers arrives with type: "". The name is the one
    // thing that is always there.
    expect(classifyMedia({ name: 'plate.mov', type: '' })).toBe('video');
    expect(classifyMedia({ name: 'grain.PNG', type: '' })).toBe('image');
    expect(classifyMedia({ name: 'set.wav', type: '' })).toBe('audio');
  });

  it('takes the type when the extension is the one that is missing', () => {
    expect(classifyMedia({ name: 'clip', type: 'video/webm' })).toBe('video');
  });

  it('is nothing for anything that is not media, and for a dotfile', () => {
    expect(classifyMedia({ name: 'notes.txt' })).toBeNull();
    expect(classifyMedia({ name: 'night-set.rzshow.json' })).toBeNull();
    expect(classifyMedia({ name: '.DS_Store' })).toBeNull();
  });
});

describe('indexShowFolder', () => {
  it('finds the manifest and the media, and ignores everything else', () => {
    const folder = indexShowFolder(FOLDER, { name: 'Night set' });

    expect(folder.manifest.path).toBe('night-set.rzshow.json');
    expect(folder.media.map((item) => item.path)).toEqual([
      'media/fog-loop.mp4',
      'media/grain.png',
      'media/plates/room.jpg',
      'set.wav',
    ]);
    expect(folder.media.find((item) => item.path === 'media/fog-loop.mp4').kind).toBe('video');
  });

  it('says so when there is no manifest, rather than looking empty', () => {
    const folder = indexShowFolder([entry('media/grain.png', { type: 'image/png' })]);
    expect(folder.manifest).toBeNull();
    expect(folder.problems.some((p) => /No manifest/.test(p.message))).toBe(true);
    // The media is still indexed: a folder of footage with no manifest yet is
    // exactly where an artist starts, and the clips are what they will name.
    expect(folder.media).toHaveLength(1);
  });

  it('picks the shallowest, most specific manifest and lists the rest behind it', () => {
    const folder = indexShowFolder([
      entry('media/manifest.json'),
      entry('show.json'),
      entry('night-set.rzshow.json'),
    ]);

    expect(folder.manifest.path).toBe('night-set.rzshow.json');
    expect(folder.extraManifests).toEqual(expect.arrayContaining(['show.json', 'media/manifest.json']));
    // All of them, best first. Which are worth complaining about is decided
    // once they have been read — a folder of project folders holds one manifest
    // each and wants every one of them. See ShowImport.readFolderShow().
    expect(folder.manifests.map((one) => one.path))
      .toEqual(['night-set.rzshow.json', 'show.json', 'media/manifest.json']);
  });

  it('lists a clip too big to inline as skipped, with the size in the reason', () => {
    const folder = indexShowFolder([
      entry('huge.mp4', { type: 'video/mp4', size: MEDIA_LIMITS.video + 1 }),
    ]);

    expect(folder.media).toHaveLength(0);
    expect(folder.skipped[0].path).toBe('huge.mp4');
    // The artist put it there on purpose. "I cannot see it" is the wrong answer.
    expect(folder.skipped[0].reason).toMatch(/MB/);
  });

  it('says once that the track is not something the editor plays', () => {
    const folder = indexShowFolder(FOLDER);
    expect(folder.problems.some((p) => /audio file/.test(p.message))).toBe(true);
  });

  it('walks past build directories and dotfiles without listing them', () => {
    const folder = indexShowFolder([
      entry('node_modules/thing/logo.png', { type: 'image/png' }),
      entry('.git/objects/x.png', { type: 'image/png' }),
      entry('._grain.png', { type: 'image/png' }),
      entry('grain.png', { type: 'image/png' }),
    ]);
    expect(folder.media.map((item) => item.path)).toEqual(['grain.png']);
  });

  it('never throws, whatever it is handed', () => {
    for (const junk of [null, undefined, 'a folder', 42, [null, {}, { path: 'x' }]]) {
      expect(() => indexShowFolder(junk)).not.toThrow();
    }
  });
});

describe('resolveLookMedia', () => {
  const folder = indexShowFolder(FOLDER);

  const resolve = (media) => resolveLookMedia(folder, { media });

  it('takes a filename, a name without its extension, and a path', () => {
    expect(resolve(['fog-loop.mp4']).items.map((i) => i.path)).toEqual(['media/fog-loop.mp4']);
    expect(resolve(['fog-loop']).items.map((i) => i.path)).toEqual(['media/fog-loop.mp4']);
    expect(resolve(['media/grain.png']).items.map((i) => i.path)).toEqual(['media/grain.png']);
  });

  it('does not care about case or punctuation, because nobody retypes a filename exactly', () => {
    expect(resolve(['Fog Loop']).items.map((i) => i.path)).toEqual(['media/fog-loop.mp4']);
  });

  it('takes everything out of a folder that is named', () => {
    expect(resolve(['plates']).items.map((i) => i.path)).toEqual(['media/plates/room.jpg']);
  });

  it('takes the lot for "*"', () => {
    // Audio is never a candidate: nothing can put a .wav on a texture node.
    expect(resolve(['*']).items.map((i) => i.kind)).toEqual(['video', 'image', 'image']);
  });

  it('keeps the manifest\'s order rather than the folder\'s', () => {
    expect(resolve(['grain', 'fog-loop']).items.map((i) => i.label)).toEqual(['grain', 'fog-loop']);
  });

  it('reports a name that matches nothing instead of guessing', () => {
    const { items, missing } = resolve(['fog-loop', 'smoke.mp4']);
    expect(items.map((i) => i.label)).toEqual(['fog-loop']);
    expect(missing).toEqual(['smoke.mp4']);
  });

  it('refuses to choose between two clips that answer to the same word', () => {
    const ambiguous = indexShowFolder([
      entry('fog-a.mp4', { type: 'video/mp4' }),
      entry('fog-b.mp4', { type: 'video/mp4' }),
    ]);
    // Guessing here is how the wrong plate ends up in the drop.
    expect(resolveLookMedia(ambiguous, { media: ['fog'] }).missing).toEqual(['fog']);
  });

  it('caps what one look can hold, and says how many it left out', () => {
    const many = indexShowFolder(
      Array.from({ length: 7 }, (_, i) => entry(`clip-${i}.png`, { type: 'image/png' }))
    );
    const { items, dropped } = resolveLookMedia(many, { media: ['*'] });
    expect(items).toHaveLength(MEDIA_LIMITS.perLook);
    expect(dropped).toBe(7 - MEDIA_LIMITS.perLook);
  });

  it('never lists the same clip twice, however many references reach it', () => {
    expect(resolve(['fog-loop', 'fog-loop.mp4', '*']).items.filter((i) => i.label === 'fog-loop'))
      .toHaveLength(1);
  });

  it('is empty with no folder, rather than throwing', () => {
    expect(resolveLookMedia(null, { media: ['fog'] }).items).toEqual([]);
  });
});

describe('the node a clip lands on', () => {
  it('is named after the clip, and the prompt and the binder agree on it', () => {
    const [clip] = resolveLookMedia(indexShowFolder(FOLDER), { media: ['fog-loop'] }).items;
    expect(mediaSlotName(clip)).toBe('Media: fog-loop');
    expect(mediaSlots([clip])).toEqual([
      { node: 'Media: fog-loop', kind: 'video', file: 'fog-loop.mp4' },
    ]);
  });
});

describe('readMediaDataUrl', () => {
  /** A file the hand-rolled path can read: bytes and a type, no Blob. */
  const bytes = (name, type, data) => ({
    name,
    type,
    size: data.length,
    arrayBuffer: async () => new Uint8Array(data).buffer,
  });

  it('inlines the bytes as the data: URL a patch carries', async () => {
    const item = { path: 'grain.png', name: 'grain.png', kind: 'image', file: bytes('grain.png', 'image/png', [1, 2, 3]) };
    expect(await readMediaDataUrl(item)).toBe(`data:image/png;base64,${btoa('\x01\x02\x03')}`);
  });

  it('guesses a type from the extension when the platform gave none', async () => {
    // It matters: restoring a patch's media dispatches on data:image/ versus
    // data:video/, so a clip inlined as octet-stream is one the loader refuses.
    const item = { path: 'plate.mov', name: 'plate.mov', kind: 'video', file: bytes('plate.mov', '', [0]) };
    expect(await readMediaDataUrl(item)).toMatch(/^data:video\/quicktime;base64,/);
  });

  it('gives an untyped file a real image/video header, not octet-stream', async () => {
    // FileReader writes the blob's own type into the header, and the patch
    // loader takes inline media only when that header says image or video. A
    // .mov with no type would otherwise go into the scene and be refused on
    // the way back out — a black look at showtime, with nothing saying why.
    const item = {
      path: 'plate.mov',
      name: 'plate.mov',
      kind: 'video',
      file: new File([new Uint8Array([1, 2, 3])], 'plate.mov', { type: '' }),
    };
    expect(await readMediaDataUrl(item)).toMatch(/^data:video\/quicktime;base64,/);
  });

  it('keeps the type the platform did give it', async () => {
    const item = {
      path: 'grain.png',
      name: 'grain.png',
      kind: 'image',
      file: new File([new Uint8Array([1])], 'grain.png', { type: 'image/png' }),
    };
    expect(await readMediaDataUrl(item)).toMatch(/^data:image\/png;base64,/);
  });

  it('reads a clip once, however many looks ask for it', async () => {
    let reads = 0;
    const item = {
      path: 'grain.png',
      name: 'grain.png',
      kind: 'image',
      file: { name: 'grain.png', type: 'image/png', arrayBuffer: async () => { reads++; return new Uint8Array([7]).buffer; } },
    };

    await readMediaDataUrl(item);
    await readMediaDataUrl(item);
    expect(reads).toBe(1);
  });
});

describe('getting the entries', () => {
  it('strips the picked folder\'s own name, so both readers agree on a path', () => {
    const entries = readFileList([
      { name: 'grain.png', webkitRelativePath: 'Night set/media/grain.png' },
      { name: 'show.rzshow.json', webkitRelativePath: 'Night set/show.rzshow.json' },
    ]);
    expect(entries.map((e) => e.path)).toEqual(['media/grain.png', 'show.rzshow.json']);
  });

  it('knows which picker this browser has', () => {
    expect(['directory', 'input', 'none']).toContain(folderPickerKind());
  });
});
