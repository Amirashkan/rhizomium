// The panel. Mostly about the two things a performance surface gets wrong:
// repainting over what the artist is typing, and putting text from a scenario
// file into the DOM as markup.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PerformerPanel } from '../src/ui/PerformerPanel.js';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';
import { indexShowFolder } from '../src/performer/ShowFolder.js';

class QuietExecutor {
  constructor() { this.rules = null; this.performed = []; this.sounds = []; }
  execute(action) { this.performed.push(action); return { ok: true, cost: 1 }; }
  tick() {}
  clearDrives() {}
  // What the panel hands over when a folder is opened: the beds a set can
  // play. Kept, rather than ignored, because that handover is the point.
  setSounds(items) { this.sounds = items.filter((item) => item?.kind === 'audio'); return this.sounds.length; }
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

  it('opens the timeline when a set that drives it starts', () => {
    // The set moves the playhead every frame from here on, and a transport
    // moving behind a closed panel is one nobody can read.
    const timelinePanel = { shown: 0, show() { this.shown++; } };
    const { panel } = build({ sections: [{ name: 'One', hold: { seconds: 40 } }] }, { timelinePanel });

    panel.toggleRun();
    expect(timelinePanel.shown).toBe(1);

    // And never closes it: pausing is not a reason to take it away.
    panel.toggleRun();
    expect(timelinePanel.shown).toBe(1);
  });

  it('leaves the timeline alone for a set with no lengths in it', () => {
    const timelinePanel = { shown: 0, show() { this.shown++; } };
    const { panel } = build({ sections: [{ name: 'One' }] }, { timelinePanel });

    panel.toggleRun();
    expect(timelinePanel.shown).toBe(0);
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

  // "Let the AI improvise live" does nothing until the set is running, because
  // the director is only consulted from tick(). The readout used to say
  // "0 min, next in 0s" regardless — a countdown to a question that would never
  // be asked, which reads as a switch that worked.
  describe('the live director switch', () => {
    /** A director that reports itself on, with a cadence ready to spend. */
    function litDirector() {
      return {
        enabled: false,
        setEnabled(v) { this.enabled = v; return v; },
        setSteer() {}, setListener() {},
        status() {
          return {
            enabled: this.enabled,
            thinking: false,
            calls: 0,
            minutesSpent: 0,
            steer: '',
            lastNote: '',
            lastError: null,
            cadence: { reason: null, nextInSeconds: 0, budgetLeft: 6, budgetInSeconds: 0 },
          };
        },
      };
    }

    it('says it is waiting for the set rather than counting down to nothing', () => {
      const { engine, panel } = build();
      engine.director = litDirector();
      panel.show();

      panel.directorToggle.checked = true;
      panel.directorToggle.dispatchEvent(new Event('change'));

      expect(panel.directorStatus.textContent).toBe('waiting for the set to start');
      expect(panel.directorStatus.dataset.held).toBe('true');
      // Not an error — the switch is fine, the transport is what is missing.
      expect(panel.directorStatus.dataset.error).toBe('false');
    });

    it('goes back to the cadence readout once the set is running', () => {
      const { engine, panel } = build();
      engine.director = litDirector();
      panel.show();

      engine.start();
      panel.directorToggle.checked = true;
      panel.directorToggle.dispatchEvent(new Event('change'));

      expect(panel.directorStatus.dataset.held).toBe('false');
      expect(panel.directorStatus.textContent).toMatch(/0 min/);
    });

    it('names the scenario\'s own rule when that is what is holding it', () => {
      const { engine, panel } = build({
        sections: [{ name: 'One' }],
        rules: { director: { enabled: false } },
      });
      engine.director = litDirector();
      panel.show();

      engine.start();
      panel.directorToggle.checked = true;
      panel.directorToggle.dispatchEvent(new Event('change'));

      expect(panel.directorStatus.textContent).toBe('off in this scenario');
    });

    it('still reads "off" when the switch is off', () => {
      const { engine, panel } = build();
      engine.director = litDirector();
      panel.show();

      expect(panel.directorStatus.textContent).toBe('off');
      expect(panel.directorStatus.dataset.held).toBe('false');
    });
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

  // --- the other direction: a set that exists, and an empty rig -----------

  describe('building the looks a set is missing', () => {
    /** A set whose three sections have nothing to show on this rig. */
    const SET = {
      name: 'Night set',
      sections: [
        { id: 'opening', name: 'Opening', mood: 'cold', look: { scene: 'Deep Fog' } },
        { id: 'drop', name: 'Drop' },
      ],
    };

    const scenarioPanel = (director) => {
      const rig = showPanel(director);
      rig.panel.showTab('scenario');
      rig.panel.editor.value = JSON.stringify(SET);
      return rig;
    };

    it('says what it would cost before it spends anything', async () => {
      const { panel } = scenarioPanel(fakeDirector());

      await panel.buildMissingLooks();

      expect(panel.engine.director.buildShow).not.toHaveBeenCalled();
      expect(panel.authorStatus.textContent).toMatch(/2 looks to build/);
      expect(panel.authorStatus.textContent).toMatch(/2 patch calls/);
      expect(panel.editorReport.textContent).toMatch(/not on the rig/);
    });

    it('builds on the second press, and binds what it built into the set', async () => {
      const director = fakeDirector();
      const { panel } = scenarioPanel(director);

      await panel.buildMissingLooks();
      await panel.buildMissingLooks();

      expect(director.buildShow).toHaveBeenCalledTimes(1);
      const [manifest, options] = director.buildShow.mock.calls[0];
      // Named after the scene the set already asks for, so nothing is renamed.
      expect(manifest.looks.map((look) => look.name)).toEqual(['Deep Fog', 'Drop']);
      // And the artist's own set goes in, to be bound rather than rewritten.
      expect(options.scenario.name).toBe('Night set');
    });

    it('asks again when the set changed between the two presses', async () => {
      const director = fakeDirector();
      const { panel } = scenarioPanel(director);

      await panel.buildMissingLooks();
      panel.editor.value = JSON.stringify({
        ...SET, sections: [{ id: 'opening', name: 'Opening' }],
      });
      await panel.buildMissingLooks();

      expect(director.buildShow).not.toHaveBeenCalled();
      expect(panel.authorStatus.textContent).toMatch(/1 look to build/);
    });

    it('spends nothing when every section already has a look', async () => {
      const director = fakeDirector();
      const { engine, panel } = scenarioPanel(director);
      engine.executor.sceneManager = { getAllScenes: () => [{ id: 's1', name: 'Deep Fog' }] };
      panel.editor.value = JSON.stringify({
        sections: [{ id: 'opening', name: 'Opening', look: { scene: 'Deep Fog' } }],
      });

      await panel.buildMissingLooks();

      expect(director.buildShow).not.toHaveBeenCalled();
      expect(panel.authorStatus.dataset.level).toBe('ok');
      expect(panel.authorStatus.textContent).toMatch(/Nothing to build/);
    });

    it('puts the bound set in the editor rather than under the running one', async () => {
      const director = fakeDirector();
      const { engine, panel } = scenarioPanel(director);

      await panel.buildMissingLooks();
      await panel.buildMissingLooks();

      expect(JSON.parse(panel.editor.value).name).toBe('Test set');
      expect(panel.editorHoldsDraft).toBe(true);
      // Nothing started playing because a build finished.
      expect(engine.scenario.name).not.toBe('Test set');
      expect(panel.authorStatus.textContent).toMatch(/press Load/);
    });

    it('is the Stop for its own build while one is running', async () => {
      let release;
      const director = fakeDirector({
        buildShow: vi.fn(() => new Promise((resolve) => {
          release = () => resolve({
            scenario: SET, built: [], note: '', wrote: 'given',
            problems: [], stopped: 'cancelled', warnings: [], bound: [], unbound: [],
          });
        })),
      });
      const { panel } = scenarioPanel(director);

      await panel.buildMissingLooks();
      const building = panel.buildMissingLooks();
      expect(panel.looksButton.textContent).toBe('Stop');

      await panel.buildMissingLooks();
      expect(panel.cancelBuild).toBe(true);
      expect(director.buildShow).toHaveBeenCalledTimes(1);

      release();
      await building;
      expect(panel.looksButton.textContent).toBe('Build the missing looks');
      expect(panel.buildButton.disabled).toBe(false);
    });

    it('says where to put the looks when there is nowhere yet', async () => {
      const director = fakeDirector();
      const { engine, panel } = scenarioPanel(director);
      engine.executor.sceneManager = null;

      await panel.buildMissingLooks();
      await panel.buildMissingLooks();

      expect(director.buildShow).not.toHaveBeenCalled();
      expect(panel.authorStatus.dataset.level).toBe('error');
      expect(panel.authorStatus.textContent).toMatch(/VJ panel/);
    });

    it('says where broken JSON is broken instead of building it', async () => {
      const director = fakeDirector();
      const { panel } = scenarioPanel(director);
      panel.editor.value = '{ sections: [';

      await panel.buildMissingLooks();

      expect(director.buildShow).not.toHaveBeenCalled();
      expect(panel.authorStatus.textContent).toMatch(/not valid JSON/);
    });
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
    // One video, and the track — listed separately from the clips, because it
    // is played rather than put on a texture node.
    expect(panel.folderLabel.textContent).toContain('1 clip');
    expect(panel.folderList.textContent).toContain('fog-loop.mp4');
    expect(panel.folderList.textContent).toContain('set.wav');
  });

  it('hands the folder\'s sound to the executor, so a set can play it', async () => {
    const { engine, panel } = folderPanel();
    await open(panel);

    // The beds go over as soon as the folder is opened rather than at build
    // time: a set can be loaded and played without anything being built.
    expect(engine.executor.sounds.map((item) => item.name)).toEqual(['set.wav']);

    panel.closeShowFolder();
    expect(engine.executor.sounds).toEqual([]);
  });

  it('counts the sound in the folder line, now that it is something a look can use', async () => {
    const { panel } = folderPanel();
    await open(panel);
    expect(panel.folderLabel.textContent).toContain('1 sound');
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

  it('reads a folder of transmission projects into a manifest', async () => {
    // What the other tool writes: one folder per piece, a manifest.json in each
    // and the media beside it. Opening it used to fill the editor with the
    // first manifest.json it found — a document with no looks in it — and hand
    // the artist a page of errors about a show they never wrote.
    const project = (slug, title) => JSON.stringify({
      manifest_version: 1,
      slug,
      title,
      copy: { narration: 'a line of narration' },
      media_briefs: {
        image: { prompt: 'frost on dark glass' },
        music: { mood: 'hushed', bpm: 62, duration_seconds: 45 },
        video: { prompt: 'fringes drifting over grain' },
      },
      performance: { energy: 2, key: 'D dorian', palette: ['near-black'], texture: 'coarse grain' },
      assets: [{ kind: 'video', path: 'video.mp4', status: 'ok' }, { kind: 'music', path: 'bed.mp3', status: 'ok' }],
    });

    const { panel } = folderPanel();
    await open(panel, [
      { path: '2026-09-14-first/manifest.json', file: file('manifest.json', project('first', 'First')) },
      { path: '2026-09-14-first/media/video.mp4', file: file('video.mp4', '', { type: 'video/mp4' }) },
      { path: '2026-09-14-first/media/bed.mp3', file: file('bed.mp3', '', { type: 'audio/mpeg' }) },
      { path: '2026-09-15-second/manifest.json', file: file('manifest.json', project('second', 'Second')) },
      { path: '2026-09-15-second/media/video.mp4', file: file('video.mp4', '', { type: 'video/mp4' }) },
    ]);

    const manifest = JSON.parse(panel.manifestEditor.value);
    expect(manifest.looks.map((look) => look.name)).toEqual(['First', 'Second']);
    expect(manifest.looks[0].media).toEqual(['2026-09-14-first/media/video.mp4']);

    expect(panel.folderLabel.textContent).toContain('2 transmissions');
    expect(panel.folderLabel.dataset.level).toBe('ok');
    expect(panel.buildLog.textContent).toMatch(/2 transmissions read out of this folder/);

    // And it is buildable as it stands: nothing to fix before pressing Build.
    expect(panel.showStatus.dataset.level).not.toBe('error');
    expect(panel.showStatus.textContent).toContain('2 looks');
  });

  it('leaves a manifest that is not a show where it is, rather than loading it', async () => {
    const { panel } = folderPanel();
    await open(panel, [
      { path: 'manifest.json', file: file('manifest.json', JSON.stringify({ name: 'something else', icons: [] })) },
      { path: 'media/fog-loop.mp4', file: file('fog-loop.mp4', '', { type: 'video/mp4' }) },
    ]);

    // The editor keeps what it had — here the worked example the Show tab
    // starts with — rather than being filled with somebody else's document.
    expect(panel.manifestEditor.value).toContain('three-look club set');
    expect(panel.manifestEditor.value).not.toContain('something else');
    expect(panel.folderLabel.textContent).toContain('no show manifest');
    expect(panel.buildLog.textContent).toMatch(/is not a show/);
  });

  it('marks the audio line a note, and says what a look can do with the file', async () => {
    const { panel } = folderPanel();
    await open(panel);

    // A note rather than a warning: nothing here is broken. What it says
    // changed when a look gained a `sound` — the file is usable now, and the
    // line is the one place the artist finds out how.
    expect(panel.buildLog.textContent).toMatch(/note — the folder: 1 audio file here/);
    expect(panel.buildLog.textContent).toMatch(/"sound": "set\.wav"/);
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
