// The panel. Mostly about the two things a performance surface gets wrong:
// repainting over what the artist is typing, and putting text from a scenario
// file into the DOM as markup.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PerformerPanel } from '../src/ui/PerformerPanel.js';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';

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
});
