/**
 * A hand-built playlist's scenes carry the narration in Text nodes that were
 * typed in by hand. "Narration from Folder…" reads a transmissions folder and
 * writes its narration into those nodes, in playlist order.
 */

import { describe, it, expect } from 'vitest';
import {
  parseNarrationMarkdown,
  readNarrationFolder,
  planNarration,
  applySceneTexts,
  textsForScene,
  wrapText,
} from '../src/vj/NarrationImport.js';

const file = (content) => ({ text: async () => content });

const narrationMd = (title, brief, vignette) =>
  `# Narration — ${title}\n\n_Two reads, about 20 seconds each._\n\n`
  + `## The brief, reported\n\n${brief}\n\n## The vignette, from inside it\n\n${vignette}\n`;

const textNode = (id, text, name) => ({ id, kind: 'Text', params: { text }, ...(name ? { name } : {}) });

const sceneWith = (...nodes) => ({ data: { nodes: [{ id: 'out', kind: 'Output' }, ...nodes] } });

describe('parseNarrationMarkdown', () => {
  it('reads the title and both reads', () => {
    const parsed = parseNarrationMarkdown(narrationMd('Ice', 'Ice remembers.', 'I hold the core.'));
    expect(parsed).toEqual({ title: 'Ice', brief: 'Ice remembers.', vignette: 'I hold the core.' });
  });

  it('tolerates headings reworded by hand', () => {
    const parsed = parseNarrationMarkdown('## Brief\n\nA.\n\n## Vignette\n\nB.\n');
    expect(parsed.brief).toBe('A.');
    expect(parsed.vignette).toBe('B.');
  });
});

describe('readNarrationFolder', () => {
  it('reads a pool of projects in folder-name order', async () => {
    const folder = await readNarrationFolder([
      { path: '2026-09-15-b/narration.md', file: file(narrationMd('B', 'b brief', 'b vig')) },
      { path: '2026-09-14-a/narration.md', file: file(narrationMd('A', 'a brief', 'a vig')) },
      { path: '2026-09-14-a/media/image.png', file: file('') },
    ]);
    expect(folder.cues.map((cue) => cue.title)).toEqual(['A', 'B']);
    expect(folder.episode).toBe(false);
  });

  it('falls back to the manifest when narration.md is missing', async () => {
    const manifest = {
      manifest_version: 3,
      title: 'Lattice',
      copy: { narration: { brief: 'from manifest', vignette: 'scene read' } },
      performance: {},
    };
    const folder = await readNarrationFolder([{ path: 'manifest.json', file: file(JSON.stringify(manifest)) }]);
    expect(folder.cues).toEqual([{ folder: '', title: 'Lattice', brief: 'from manifest', vignette: 'scene read' }]);
  });

  it('follows an episode running order and reads its two ends', async () => {
    const episode = {
      order: ['2026-09-20-z', '2026-09-19-y'],
      opening: { text: 'Tonight, two things.' },
      signoff: { text: 'Goodnight.' },
    };
    const folder = await readNarrationFolder([
      { path: 'episode.json', file: file(JSON.stringify(episode)) },
      { path: '2026-09-19-y/narration.md', file: file(narrationMd('Y', 'y', 'yy')) },
      { path: '2026-09-20-z/narration.md', file: file(narrationMd('Z', 'z', 'zz')) },
    ]);
    expect(folder.cues.map((cue) => cue.title)).toEqual(['Z', 'Y']);
    expect(folder.opening).toBe('Tonight, two things.');
    expect(folder.signoff).toBe('Goodnight.');
  });
});

describe('textsForScene', () => {
  const reads = { title: 'Ice', brief: 'The brief.', vignette: 'The vignette.' };

  it('gives a lone Text node the whole narration', () => {
    const changes = textsForScene(sceneWith(textNode('t', 'old')).data, reads);
    expect(changes).toEqual([{ nodeId: 't', text: 'The brief.\n\nThe vignette.' }]);
  });

  it('gives two unnamed Text nodes the brief and the vignette in order', () => {
    const changes = textsForScene(sceneWith(textNode('a', 'x'), textNode('b', 'y')).data, reads);
    expect(changes.map((c) => c.text)).toEqual(['The brief.', 'The vignette.']);
  });

  it('touches only named nodes when any are named', () => {
    const scene = sceneWith(
      textNode('logo', 'FESTIVAL'),
      textNode('v', 'old', 'Vignette'),
      textNode('h', 'old', 'Title'),
    );
    const changes = textsForScene(scene.data, reads);
    expect(changes).toEqual([
      { nodeId: 'v', text: 'The vignette.' },
      { nodeId: 'h', text: 'Ice' },
    ]);
  });

  it('wraps to the line length of the text it replaces', () => {
    const old = 'twenty five characters ok\nshort';
    const long = 'one two three four five six seven eight nine ten eleven twelve';
    const [change] = textsForScene(sceneWith(textNode('t', old)).data, { brief: long });
    expect(Math.max(...change.text.split('\n').map((l) => l.length))).toBeLessThanOrEqual(25);
  });

  it('keeps braces and a leading = from turning into expressions', () => {
    const [change] = textsForScene(sceneWith(textNode('t', 'x')).data, { brief: '= a {b}' });
    expect(change.text).toBe(' a (b)');
  });
});

describe('planNarration + applySceneTexts', () => {
  const folder = {
    episode: true,
    opening: 'Hello.',
    signoff: 'Bye.',
    problems: [],
    cues: [
      { folder: 'a', title: 'A', brief: 'a brief', vignette: 'a vig' },
      { folder: 'b', title: 'B', brief: 'b brief', vignette: 'b vig' },
    ],
  };

  it('puts the two ends on the first and last rows of an episode-length playlist', () => {
    const scenes = {
      intro: sceneWith(textNode('t', 'x')),
      one: sceneWith(textNode('t', 'x')),
      two: sceneWith(textNode('t', 'x')),
      outro: sceneWith(textNode('t', 'x')),
    };
    const rows = ['intro', 'one', 'two', 'outro'].map((sceneId) => ({ sceneId, sceneName: sceneId }));
    const plan = planNarration(rows, (id) => scenes[id], folder);
    expect(plan.rows.map((row) => row.source)).toEqual(['opening', 'A', 'B', 'sign-off']);
    expect(plan.problems).toEqual([]);

    for (const row of plan.rows) applySceneTexts(scenes[row.sceneId].data, row.changes);
    expect(scenes.intro.data.nodes[1].params.text).toBe('Hello.');
    expect(scenes.two.data.nodes[1].params.text).toBe('b brief\n\nb vig');
    expect(scenes.outro.data.nodes[1].params.text).toBe('Bye.');
  });

  it('pairs in order, says when the counts differ, and never writes one scene twice', () => {
    const scenes = { s: sceneWith(textNode('t', 'x')) };
    const rows = [{ sceneId: 's' }, { sceneId: 's' }, { sceneId: 's' }];
    const plan = planNarration(rows, (id) => scenes[id], { ...folder, episode: false });
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[1].changes).toEqual([]);
    expect(plan.rows[1].note).toMatch(/same scene as row 1/);
    expect(plan.problems[0]).toMatch(/3 scenes and the folder 2 narrations/);
  });
});

describe('wrapText', () => {
  it('keeps paragraphs and never splits a word', () => {
    expect(wrapText('aaaa bbbb cccc dddd eeee ffff\n\nnext', 20)).toBe('aaaa bbbb cccc dddd\neeee ffff\n\nnext');
  });
});

describe('VJ panel: Narration from Folder', () => {
  it('writes the folder narration into the playlist scenes and saves them', async () => {
    const { vi } = await import('vitest');
    vi.doMock('../src/core/rhizomiumDB.js', async (importOriginal) => ({
      ...(await importOriginal()),
      runTransaction: async (_store, _mode, fn) => fn({ put: () => {}, get: () => undefined }),
    }));
    const { VJControlPanel } = await import('../src/vj/VJControlPanel.js');
    const panel = new VJControlPanel({
      graph: { nodes: [] },
      onChange: vi.fn(),
      saveLoadManager: { exportProject: vi.fn(), importProject: vi.fn(async () => true) },
    });
    await panel.ready;

    panel.sceneManager.addScene('s1', { nodes: [textNode('t', 'placeholder')] }, 'Ice');
    panel.playlistManager.addToPlaylist('s1');
    // On screen: the editor's live graph is a separate copy of the scene.
    const live = textNode('t', 'placeholder');
    panel.editor.graph.nodes.push(live);
    panel.sceneManager.activeSceneId = 's1';
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const result = await panel.applyNarrationEntries([
      { path: 'narration.md', file: file(narrationMd('Ice', 'New brief.', 'New vignette.')) },
    ]);

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(result.written).toBe(1);
    expect(panel.sceneManager.getScene('s1').data.nodes[0].params.text).toBe('New brief.\n\nNew vignette.');
    // ...and the live graph, so auto-override cannot save the old words back.
    expect(live.params.text).toBe('New brief.\n\nNew vignette.');
    confirmSpy.mockRestore();
    panel.container.remove();
  });
});
