// The panel. Mostly about the two things a performance surface gets wrong:
// repainting over what the artist is typing, and putting text from a scenario
// file into the DOM as markup.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PerformerPanel } from '../src/ui/PerformerPanel.js';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';
import { indexShowFolder } from '../src/performer/ShowFolder.js';

class QuietExecutor {
  constructor() { this.rules = null; this.performed = []; }
  execute(action) { this.performed.push(action); return { ok: true, cost: 1 }; }
  tick() {}
  clearDrives() {}
  status() { return { drives: [], ramps: [], blackedOut: false, transition: {}, sceneChangeInFlight: false }; }
}

function makePanel(scenario = { sections: [{ name: 'One' }] }, options = {}) {
  const engine = new PerformerEngine({
    clock: new PerformerClock({ now: () => 0 }),
    executor: new QuietExecutor(),
  });
  engine.loadScenario(scenario);
  const panel = new PerformerPanel(engine, options);
  return { engine, panel };
}

let made = [];
afterEach(() => {
  made.forEach((p) => p.destroy());
  made = [];
});

function build(...args) {
  const rig = makePanel(...args);
  made.push(rig.panel);
  return rig;
}

describe('PerformerPanel', () => {
  it('starts hidden and does not paint until it is shown', () => {
    const { panel } = build();
    expect(panel.visible).toBe(false);
    expect(panel.panel.style.display).toBe('none');
    expect(panel.frame).toBeNull();
  });

  it('shows, hides and toggles', () => {
    const { panel } = build();
    expect(panel.toggle()).toBe(true);
    expect(panel.panel.style.display).toBe('flex');
    expect(panel.toggle()).toBe(false);
    expect(panel.panel.style.display).toBe('none');
  });

  it('stops its frame loop when hidden, so a closed panel costs nothing', () => {
    const { panel } = build();
    panel.show();
    expect(panel.frame).not.toBeNull();
    panel.hide();
    expect(panel.frame).toBeNull();
  });

  it('lists the scenario\'s sections and cues', () => {
    const { panel } = build({
      sections: [{ name: 'Intro' }, { name: 'Drop' }],
      cues: [{ name: 'drop', do: [] }],
    });
    panel.show();

    const names = [...panel.sectionList.querySelectorAll('.rz-perf-section-name')]
      .map((n) => n.textContent);
    expect(names).toEqual(['Intro', 'Drop']);
    expect(panel.cueList.textContent).toContain('drop');
  });

  it('jumps when a section is clicked', () => {
    const { engine, panel } = build({
      rules: { minSectionBars: 0 },
      sections: [
        { name: 'Intro', transition: { quantize: 'off' } },
        { name: 'Drop', transition: { quantize: 'off' } },
      ],
    });
    panel.show();
    engine.start();

    panel.sectionList.children[1].dispatchEvent(new Event('click'));
    engine.tick();
    expect(engine.currentSection.name).toBe('Drop');
  });

  it('fires a cue when its button is clicked', () => {
    const { engine, panel } = build({
      sections: [{ name: 'One' }],
      cues: [{ name: 'lift', do: [{ type: 'master', to: 1 }] }],
    });
    panel.show();
    engine.start();

    panel.cueList.children[0].dispatchEvent(new Event('click'));
    engine.tick();
    expect(engine.executor.performed.some((a) => a.type === 'master')).toBe(true);
  });

  it('writes a scenario\'s text as text, never as markup', () => {
    const { panel } = build({
      sections: [{ name: '<img src=x onerror=alert(1)>' }],
      cues: [{ name: '<script>bad</script>', do: [] }],
    });
    panel.show();

    expect(panel.sectionList.querySelector('img')).toBeNull();
    expect(panel.panel.querySelector('script')).toBeNull();
    expect(panel.sectionList.textContent).toContain('<img src=x');
  });

  it('does not overwrite the editor while the artist is typing in it', () => {
    const { engine, panel } = build();
    panel.show();
    panel.showTab('scenario');

    panel.editor.value = '{ "half typed": ';
    panel.editor.dispatchEvent(new Event('focus'));

    engine.write('info', 'something happened');
    panel.paintStructure();

    expect(panel.editor.value).toBe('{ "half typed": ');
  });

  it('says so rather than throwing when the editor holds bad JSON', () => {
    const { panel } = build();
    panel.show();
    panel.showTab('scenario');

    panel.editor.value = '{ not json';
    panel.loadFromEditor();

    expect(panel.editorReport.dataset.level).toBe('error');
    expect(panel.editorReport.textContent).toMatch(/not valid JSON/);
  });

  it('loads a scenario from the editor and reports what it found', () => {
    const { engine, panel } = build();
    panel.show();
    panel.showTab('scenario');

    panel.editor.value = JSON.stringify({ name: 'Typed', sections: [{ name: 'A' }] });
    panel.loadFromEditor();

    expect(engine.scenario.name).toBe('Typed');
    expect(panel.editorReport.dataset.level).toBe('ok');
  });

  it('reports a scenario\'s errors in the editor rather than refusing it', () => {
    const { engine, panel } = build();
    panel.show();
    panel.showTab('scenario');

    panel.editor.value = JSON.stringify({ sections: [{ name: 'A', next: 'nowhere' }] });
    panel.loadFromEditor();

    expect(panel.editorReport.dataset.level).toBe('error');
    // Still loaded: a bad reference is an inert section, not a refusal.
    expect(engine.sections).toHaveLength(1);
  });

  describe('the AI author', () => {
    it('puts a draft in the editor rather than under a running set', async () => {
      const director = {
        authorScenario: vi.fn().mockResolvedValue({
          scenario: { name: 'Drafted', sections: [] },
          note: 'check the scene names',
        }),
        status: () => ({ enabled: false, thinking: false, calls: 0, steer: '', lastNote: '' }),
        setEnabled() {}, setSteer() {},
      };
      const { engine, panel } = build();
      engine.director = director;
      panel.show();
      panel.showTab('scenario');

      panel.briefInput.value = 'a dark techno set';
      await panel.authorScenario();

      expect(JSON.parse(panel.editor.value).name).toBe('Drafted');
      // The running scenario is untouched until the artist presses Load.
      expect(engine.scenario.name).not.toBe('Drafted');
      expect(panel.authorStatus.textContent).toMatch(/check the scene names/);
    });

    it('asks for a brief before spending a call', async () => {
      const director = {
        authorScenario: vi.fn(),
        status: () => ({ enabled: false, thinking: false, calls: 0, steer: '', lastNote: '' }),
        setEnabled() {}, setSteer() {},
      };
      const { engine, panel } = build();
      engine.director = director;
      panel.show();

      panel.briefInput.value = '   ';
      await panel.authorScenario();
      expect(director.authorScenario).not.toHaveBeenCalled();
    });

    it('shows the reason when the call is refused', async () => {
      const director = {
        authorScenario: vi.fn().mockRejectedValue(new Error('Out of actions for today.')),
        status: () => ({ enabled: false, thinking: false, calls: 0, steer: '', lastNote: '' }),
        setEnabled() {}, setSteer() {},
      };
      const { engine, panel } = build();
      engine.director = director;
      panel.show();

      panel.briefInput.value = 'a set';
      await panel.authorScenario();

      expect(panel.authorStatus.dataset.level).toBe('error');
      expect(panel.authorStatus.textContent).toMatch(/Out of actions/);
    });
  });

  describe('the log', () => {
    it('appends new lines rather than rebuilding the pane', () => {
      const { engine, panel } = build();
      panel.show();
      panel.showTab('log');

      const before = panel.logList.childElementCount;
      engine.write('info', 'one');
      engine.write('info', 'two');

      expect(panel.logList.childElementCount).toBe(before + 2);
      expect(panel.logList.textContent).toContain('two');
    });

    it('rebuilds when the engine has trimmed its log from the front', () => {
      const { engine, panel } = build();
      panel.show();
      panel.showTab('log');
      engine.write('info', 'one');

      engine.log.length = 0;
      engine.write('info', 'fresh');

      expect(panel.logList.textContent).toContain('fresh');
      expect(panel.logList.childElementCount).toBe(1);
    });
  });

  it('does not repaint into a panel that has been destroyed', () => {
    const { engine, panel } = makePanel();
    panel.show();
    panel.destroy();
    expect(() => engine.write('info', 'after')).not.toThrow();
  });

  // The readout that answers "is this thing hearing me at all?", which is a
  // question the BPM box cannot answer — it shows whatever was typed into it
  // whether or not any audio is arriving.
  describe('the listening readout', () => {
    it('says so when nothing is listening', () => {
      const { panel } = build();
      panel.show();
      panel.paintListening();
      expect(panel.listeningReadout.textContent).toBe('not listening');
      expect(panel.listeningReadout.dataset.state).toBe('off');
    });

    it('distinguishes hearing silence from not listening', () => {
      const { engine, panel } = build();
      panel.show();
      engine.listening = () => ({ dynamics: 'silent', pulse: { state: 'free', bpm: null }, summary: 'silence' });

      panel.paintListening();
      expect(panel.listeningReadout.textContent).toBe('silence');
      expect(panel.listeningReadout.dataset.state).toBe('silent');
    });

    it('prints a free pulse as FREE rather than as a tempo', () => {
      const { engine, panel } = build();
      panel.show();
      engine.listening = () => ({
        dynamics: 'building',
        pulse: { state: 'free', bpm: null },
        summary: 'building, no rhythm, free pulse',
      });

      panel.paintListening();
      expect(panel.listeningReadout.textContent).toBe('building · FREE');
      expect(panel.listeningReadout.dataset.state).toBe('free');
    });

    it('prints the tempo when there really is one', () => {
      const { engine, panel } = build();
      panel.show();
      engine.listening = () => ({
        dynamics: 'holding',
        pulse: { state: 'metered', bpm: 128 },
        summary: 'holding, 128 BPM',
      });

      panel.paintListening();
      expect(panel.listeningReadout.textContent).toBe('holding · 128');
      expect(panel.listeningReadout.dataset.state).toBe('metered');
    });
  });

  describe('the tempo seam', () => {
    it('sets the tempo through the engine, not straight at the clock', () => {
      const { engine, panel } = build();
      panel.show();
      const setBPM = vi.spyOn(engine, 'setBPM');

      panel.bpmInput.value = '96';
      panel.bpmInput.dispatchEvent(new Event('change'));

      expect(setBPM).toHaveBeenCalledWith(96, 'panel');
      expect(engine.clock.bpm).toBe(96);
    });
  });
});

describe('the Show tab', () => {
  // The tab used before a set exists. What matters here is the same thing that
  // matters everywhere else in this panel: nothing is loaded behind the
  // artist's back, and nothing from a manifest file reaches the DOM as markup.

  const MANIFEST = {
    show: 'Test set',
    looks: [
      { id: 'opening', name: 'Opening', brief: 'slow fog over near-black' },
      { id: 'drop', name: 'Drop', brief: 'hard, white, full frame' },
    ],
  };

  const patch = () => ({
    nodes: [{ id: 'a', kind: 'Noise', x: 0, y: 0, params: {} }],
    connections: [],
  });

  /** A director whose build does what the real one does, without a network. */
  function fakeDirector(overrides = {}) {
    return {
      buildShow: vi.fn(async (manifest, options) => {
        const built = [];
        for (const look of manifest.looks) {
          options.onProgress?.({ phase: 'look', status: 'start', message: `Building "${look.name}"…` });
          const scene = options.installScene(look.name, patch(), {});
          built.push({ lookId: look.id, sceneName: scene.name, generated: true });
          options.onProgress?.({ phase: 'look', status: 'ok', name: look.name, message: `"${look.name}" — 1 node.` });
        }
        return {
          scenario: { name: 'Test set', sections: [{ id: 'opening', look: { scene: 'Opening' } }] },
          built, note: '', wrote: 'model', problems: [], stopped: '',
          warnings: [], bound: built.map((b) => ({ ...b, sectionId: b.lookId })), unbound: [],
        };
      }),
      ...overrides,
    };
  }

  function showPanel(director) {
    const { engine, panel } = build();
    engine.director = director;
    engine.executor.sceneManager = { getAllScenes: () => [] };
    engine.executor.installPatchAsScene = vi.fn((name) => ({ id: `scene_${name}`, name }));
    panel.show();
    panel.showTab('show');
    return { engine, panel };
  }

  it('fills the editor with the example rather than an empty box', () => {
    const { panel } = showPanel(fakeDirector());
    expect(panel.manifestEditor.value).toContain('"looks"');
  });

  it('says what a build will cost before one is started', () => {
    const { panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify(MANIFEST);
    panel.checkManifest();
    expect(panel.showStatus.textContent).toMatch(/2 patch calls/);
  });

  it('reports what is wrong instead of building it', () => {
    const { panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify({ show: 'empty' });
    expect(panel.checkManifest()).toBeNull();
    expect(panel.showStatus.dataset.level).toBe('error');
  });

  it('says where broken JSON is broken', () => {
    const { panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = '{ looks: [';
    panel.checkManifest();
    expect(panel.showStatus.textContent).toMatch(/not valid JSON/);
  });

  it('puts the set in the Scenario tab without loading it', async () => {
    const { engine, panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify(MANIFEST);
    const before = engine.scenario.name;

    await panel.buildShow();

    expect(panel.editor.value).toContain('Test set');
    expect(panel.activeTab).toBe('scenario');
    // Nothing loaded: the engine is still running whatever it was.
    expect(engine.scenario.name).toBe(before);
  });

  it('keeps the built set while the artist looks at another tab', async () => {
    // A draft costs calls. Leaving the Scenario tab to check what scenes you
    // have and coming back to find the running scenario in its place loses an
    // answer that was paid for.
    const { panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify(MANIFEST);
    await panel.buildShow();

    panel.showTab('set');
    panel.showTab('scenario');
    expect(panel.editor.value).toContain('Test set');

    // Loading it makes it the running scenario, and the editor follows again.
    panel.loadFromEditor();
    expect(panel.editorHoldsDraft).toBe(false);
  });

  it('refuses to build when there is nowhere to put the looks', async () => {
    const { engine, panel } = showPanel(fakeDirector());
    engine.executor.sceneManager = null;
    panel.manifestEditor.value = JSON.stringify(MANIFEST);

    await panel.buildShow();
    expect(panel.showStatus.textContent).toMatch(/VJ panel/);
    expect(engine.director.buildShow).not.toHaveBeenCalled();
  });

  it('will not start a second build over the first', async () => {
    const { engine, panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify(MANIFEST);

    const first = panel.buildShow();
    await panel.buildShow();
    await first;

    expect(engine.director.buildShow).toHaveBeenCalledTimes(1);
  });

  it('shows progress as lines, not as a spinner', async () => {
    const { panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify(MANIFEST);

    await panel.buildShow();
    expect(panel.buildLog.children.length).toBeGreaterThan(2);
  });

  it('never puts a manifest\'s text into the DOM as markup', async () => {
    const { panel } = showPanel(fakeDirector());
    panel.manifestEditor.value = JSON.stringify({
      show: 'Test set',
      looks: [{ id: 'x', name: '<img src=x onerror=alert(1)>', brief: 'a look' }],
    });

    await panel.buildShow();
    expect(panel.buildLog.querySelector('img')).toBeNull();
    expect(panel.buildLog.textContent).toContain('<img');
  });

  it('reports a build that failed rather than looking like it worked', async () => {
    const director = fakeDirector({
      buildShow: vi.fn(async () => { throw new Error('Out of patch generations today.'); }),
    });
    const { panel } = showPanel(director);
    panel.manifestEditor.value = JSON.stringify(MANIFEST);

    await panel.buildShow();
    expect(panel.showStatus.dataset.level).toBe('error');
    expect(panel.showStatus.textContent).toMatch(/Out of patch generations/);
    expect(panel.buildButton.disabled).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * The show folder.
 *
 * A manifest naming `fog-loop.mp4` is half a document; the directory it sat in
 * is the other half. These are about the panel keeping the two together — and
 * about the one thing it must never do, which is throw away a manifest the
 * artist has been typing because they opened a folder to attach its footage.
 * ---------------------------------------------------------------------- */

describe('PerformerPanel: the show folder', () => {
  const file = (name, text = '', { type = '', size = 1024 } = {}) => ({
    name,
    type,
    size,
    text: async () => text,
    arrayBuffer: async () => new Uint8Array([1]).buffer,
  });

  const MANIFEST_TEXT = JSON.stringify({
    show: 'Night set',
    looks: [{ id: 'opening', name: 'Opening', brief: 'fog over the room', media: ['fog-loop'] }],
  });

  const entries = () => [
    { path: 'night.rzshow.json', file: file('night.rzshow.json', MANIFEST_TEXT) },
    { path: 'media/fog-loop.mp4', file: file('fog-loop.mp4', '', { type: 'video/mp4', size: 2 * 1024 * 1024 }) },
    { path: 'media/set.wav', file: file('set.wav', '', { type: 'audio/wav' }) },
  ];

  function folderPanel() {
    const { engine, panel } = build();
    engine.executor.sceneManager = { getAllScenes: () => [] };
    panel.show();
    panel.showTab('show');
    return { engine, panel };
  }

  /** What openShowFolder() would have got from the picker. */
  const open = (panel, list = entries()) =>
    panel.setShowFolder(indexShowFolder(list, { name: 'Night set' }));

  it('puts the folder\'s manifest in the editor and lists its clips', async () => {
    const { panel } = folderPanel();
    await open(panel);

    expect(panel.manifestEditor.value).toBe(MANIFEST_TEXT);
    expect(panel.folderLabel.textContent).toContain('night.rzshow.json');
    // One video, and the track — which is listed, because it is part of the
    // show, and greyed, because nothing in the editor plays a file.
    expect(panel.folderLabel.textContent).toContain('1 clip');
    expect(panel.folderList.textContent).toContain('fog-loop.mp4');
    expect(panel.folderList.textContent).toContain('set.wav');
  });

  it('never replaces a manifest the artist was typing', async () => {
    const { panel } = folderPanel();
    panel.manifestEditor.value = '{ "show": "mine, half-written"';

    await open(panel);

    expect(panel.manifestEditor.value).toBe('{ "show": "mine, half-written"');
    // The folder is still taken: they opened it to attach the footage.
    expect(panel.folder.media).toHaveLength(2);
    expect(panel.buildLog.textContent).toMatch(/left unopened/);
  });

  it('checks the manifest against the folder as soon as it is open', async () => {
    const { panel } = folderPanel();
    await open(panel, [
      { path: 'night.rzshow.json', file: file('night.rzshow.json', MANIFEST_TEXT) },
      { path: 'media/smoke.mp4', file: file('smoke.mp4', '', { type: 'video/mp4' }) },
    ]);

    // The manifest asks for fog-loop and the folder has smoke. Better said now
    // than after a patch call has been spent building the look without it.
    expect(panel.buildLog.textContent).toMatch(/Nothing in the folder is called "fog-loop"/);
  });

  it('says a folder with no manifest in it has no manifest in it', async () => {
    const { panel } = folderPanel();
    await open(panel, [{ path: 'media/fog-loop.mp4', file: file('fog-loop.mp4', '', { type: 'video/mp4' }) }]);

    expect(panel.folderLabel.textContent).toContain('no manifest');
    expect(panel.folderLabel.dataset.level).toBe('warn');
    // The clips are still indexed — a folder of footage with no manifest yet is
    // exactly where an artist starts.
    expect(panel.folder.media).toHaveLength(1);
  });

  it('hands the folder to the build, and forgets it when it is closed', async () => {
    const { engine, panel } = folderPanel();
    engine.director = {
      status: () => ({ enabled: false, calls: 0, failures: 0 }),
      buildShow: vi.fn(async () => ({
        scenario: { name: 'Night set', sections: [] },
        built: [], bound: [], problems: [], warnings: [], stopped: '', note: '', wrote: 'model',
      })),
    };
    await open(panel);

    await panel.buildShow();
    expect(engine.director.buildShow.mock.calls[0][1].folder).toBe(panel.folder);

    panel.closeShowFolder();
    expect(panel.folder).toBeNull();
    expect(panel.folderList.hidden).toBe(true);
    await panel.buildShow();
    expect(engine.director.buildShow.mock.calls[1][1].folder).toBeNull();
  });

  it('never puts a filename into the DOM as markup', async () => {
    const { panel } = folderPanel();
    await open(panel, [
      { path: '<img src=x onerror=alert(1)>.png', file: file('<img src=x onerror=alert(1)>.png', '', { type: 'image/png' }) },
    ]);

    expect(panel.folderList.querySelector('img')).toBeNull();
    expect(panel.folderList.textContent).toContain('<img');
  });
});
