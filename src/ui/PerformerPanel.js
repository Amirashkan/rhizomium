// src/ui/PerformerPanel.js

import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';
import { setIcon } from './iconSprite.js';
import { STATE } from '../performer/PerformerEngine.js';
import { PerformerOSC } from '../performer/PerformerOSC.js';
import { EXAMPLE_SCENARIO } from '../performer/Scenario.js';
import { AUDIO_TAP_CHANNELS } from '../audio/audioAnalysisTaps.js';

/**
 * PerformerPanel - the surface for the AI performer.
 *
 * It is a performance instrument before it is a settings window, and that
 * decides most of the layout. Four tabs, and the one that is up by default is
 * the one you look at with a mixer in front of you:
 *
 *   Set       where the performance is, and the buttons that move it
 *   Signals   what the performer is hearing, as meters
 *   Scenario  the score, as editable text
 *   Log       what it did, and why
 *
 * Two rules about painting run through it.
 *
 * **The live half repaints on a frame; the rest repaints on a change.** Meters,
 * the bar counter and the section's progress have to move at frame rate or they
 * are lying. The section list, the scenario text and the validation report only
 * change when something happens, and rebuilding them every frame would throw
 * away a half-typed scenario sixty times a second. So the two are separate
 * methods and only the first is on the RAF.
 *
 * **Nothing from outside is written as HTML.** Section names, cue names and
 * OSC addresses all come from a scenario file or off the network, and a
 * scenario is a document the editor opens from other people's machines. Every
 * one of them goes in through textContent.
 */

const TABS = [
  { key: 'set', label: 'Set' },
  { key: 'signals', label: 'Signals' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'log', label: 'Log' },
];

/** Log levels that get their own colour, because they are the ones you scan for. */
const LEVEL_COLOURS = {
  error: '#ff7a6b',
  warn: '#ffc86b',
  cue: '#8ecbff',
  section: '#9cf0b4',
  director: '#d9a6ff',
  action: '#cabfb0',
  info: '#8b8175',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, title, onClick, className = 'rz-perf-btn') {
  const node = el('button', className, label);
  node.title = title;
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export class PerformerPanel {
  /**
   * @param {PerformerEngine} engine
   * @param {object} [options]
   * @param {object} [options.oscManager]
   * @param {object} [options.vjPanel]
   * @param {object} [options.eventSystem]
   */
  constructor(engine, options = {}) {
    this.engine = engine;
    this.oscManager = options.oscManager || null;
    this.vjPanel = options.vjPanel || null;

    this.visible = false;
    this.activeTab = 'set';

    /** Set while the artist is editing, so a repaint cannot wipe their typing. */
    this.editingScenario = false;
    this.authoring = false;

    this.router = new PerformerOSC(engine, { eventSystem: options.eventSystem });
    this.router.attach();

    this.build();

    // Structural repaints follow the engine; the live half follows the frame.
    this.unsubscribe = engine.on((kind) => {
      if (kind === 'log') this.appendLog();
      else this.paintStructure();
    });

    this.frame = null;
    this.paintStructure();
  }

  // --- construction ------------------------------------------------------

  build() {
    this.panel = el('div', 'rz-perf-panel');
    this.panel.id = 'performer-panel';
    this.panel.style.display = 'none';

    this.buildHeader();
    this.buildTransport();
    this.buildTabs();

    this.body = el('div', 'rz-perf-body');
    this.panel.appendChild(this.body);

    this.panes = {};
    for (const tab of TABS) {
      const pane = el('div', 'rz-perf-pane');
      pane.hidden = tab.key !== this.activeTab;
      this.panes[tab.key] = pane;
      this.body.appendChild(pane);
    }

    this.buildSetPane();
    this.buildSignalsPane();
    this.buildScenarioPane();
    this.buildLogPane();

    document.body.appendChild(this.panel);
  }

  buildHeader() {
    const header = el('div', 'rz-perf-header');

    const title = el('div', 'rz-perf-title');
    setIcon(title, 'vj', { text: 'AI Performer', size: 16 });
    header.appendChild(title);

    this.stateChip = el('span', 'rz-perf-chip', 'stopped');
    header.appendChild(this.stateChip);

    const close = button('×', 'Close', () => this.hide(), 'rz-perf-close');
    header.appendChild(close);

    this.panel.appendChild(header);
    this.cleanupDraggable = makeDraggable(this.panel, header);
  }

  /**
   * The transport. Everything here is reachable without reading a label,
   * because it is used in the dark.
   */
  buildTransport() {
    const bar = el('div', 'rz-perf-transport');

    this.playButton = button('▶', 'Start or resume (Space)', () => this.toggleRun(), 'rz-perf-btn rz-perf-play');
    bar.appendChild(this.playButton);
    bar.appendChild(button('■', 'Stop and rewind', () => this.engine.stop()));
    bar.appendChild(button('⏭', 'Move the set on', () => this.engine.nextSection('panel')));

    // Deliberately the widest, reddest thing on the panel.
    bar.appendChild(button('PANIC', 'Kill the output and pause', () => this.engine.panic(), 'rz-perf-btn rz-perf-panic'));

    const tempo = el('div', 'rz-perf-tempo');
    this.bpmInput = el('input', 'rz-perf-bpm');
    this.bpmInput.type = 'number';
    this.bpmInput.min = '20';
    this.bpmInput.max = '300';
    this.bpmInput.step = '0.1';
    this.bpmInput.title = 'Tempo';
    this.bpmInput.addEventListener('change', () => {
      this.engine.setBPM(Number(this.bpmInput.value), 'panel');
    });
    tempo.appendChild(this.bpmInput);
    tempo.appendChild(el('span', 'rz-perf-unit', 'BPM'));
    tempo.appendChild(button('TAP', 'Tap the tempo', () => {
      this.engine.tapTempo('panel');
      this.bpmInput.value = String(this.engine.clock.bpm);
    }));
    bar.appendChild(tempo);

    // What the performer is hearing, in three words.
    //
    // Mid-set, the question an artist actually has is "is this thing listening
    // to me at all?", and until now nothing on the panel could answer it: the
    // BPM box shows what was typed into it whether or not any audio is
    // arriving. This shows the room.
    this.listeningReadout = el('div', 'rz-perf-listening');
    this.listeningReadout.title = 'What the performer hears';
    this.listeningReadout.textContent = '—';
    bar.appendChild(this.listeningReadout);

    // A bar counter and four beat dots: the readout that says the clock is
    // alive and where the downbeat is.
    this.position = el('div', 'rz-perf-position');
    this.barReadout = el('span', 'rz-perf-bar', '0');
    this.position.appendChild(this.barReadout);
    this.beatDots = el('div', 'rz-perf-beats');
    this.position.appendChild(this.beatDots);
    bar.appendChild(this.position);

    this.panel.appendChild(bar);
  }

  buildTabs() {
    const strip = el('div', 'rz-perf-tabs');
    this.tabButtons = {};

    for (const tab of TABS) {
      const node = button(tab.label, tab.label, () => this.showTab(tab.key), 'rz-perf-tab');
      this.tabButtons[tab.key] = node;
      strip.appendChild(node);
    }

    this.panel.appendChild(strip);
  }

  // --- the Set pane ------------------------------------------------------

  buildSetPane() {
    const pane = this.panes.set;

    this.scenarioName = el('div', 'rz-perf-scenario-name', '—');
    pane.appendChild(this.scenarioName);

    this.problems = el('div', 'rz-perf-problems');
    pane.appendChild(this.problems);

    this.sectionList = el('div', 'rz-perf-sections');
    pane.appendChild(this.sectionList);

    pane.appendChild(el('div', 'rz-perf-label', 'Cues'));
    this.cueList = el('div', 'rz-perf-cues');
    pane.appendChild(this.cueList);

    pane.appendChild(this.buildDirectorControls());
  }

  /**
   * The director's controls, on the Set tab rather than behind a settings
   * window: whether a model is touching the show is the sort of thing you want
   * to be able to see and switch off without hunting for it.
   */
  buildDirectorControls() {
    const box = el('div', 'rz-perf-director');

    const row = el('div', 'rz-perf-row');
    this.directorToggle = el('input');
    this.directorToggle.type = 'checkbox';
    this.directorToggle.id = 'rz-perf-director-toggle';
    this.directorToggle.addEventListener('change', () => {
      this.engine.setDirectorEnabled(this.directorToggle.checked);
      this.paintStructure();
    });
    row.appendChild(this.directorToggle);

    const label = el('label', 'rz-perf-director-label', 'Let the AI improvise live');
    label.htmlFor = this.directorToggle.id;
    row.appendChild(label);

    this.directorStatus = el('span', 'rz-perf-director-status', '');
    row.appendChild(this.directorStatus);
    box.appendChild(row);

    this.steerInput = el('input', 'rz-perf-steer');
    this.steerInput.type = 'text';
    this.steerInput.placeholder = 'A line of direction — "keep it dark", "more strobe"';
    this.steerInput.addEventListener('change', () => {
      this.engine.director?.setSteer(this.steerInput.value);
    });
    box.appendChild(this.steerInput);

    this.directorNote = el('div', 'rz-perf-director-note', '');
    box.appendChild(this.directorNote);

    return box;
  }

  // --- the Signals pane --------------------------------------------------

  buildSignalsPane() {
    const pane = this.panes.signals;

    const energyRow = el('div', 'rz-perf-energy');
    energyRow.appendChild(el('span', 'rz-perf-label', 'Energy'));
    this.energySlider = el('input', 'rz-perf-energy-slider');
    this.energySlider.type = 'range';
    this.energySlider.min = '0';
    this.energySlider.max = '100';
    this.energySlider.value = '0';
    this.energySlider.title = 'What the musician sends on /rhizo/perf/energy — draggable here for rehearsal.';
    this.energySlider.addEventListener('input', () => {
      this.engine.signals.setEnergy(Number(this.energySlider.value) / 100);
    });
    energyRow.appendChild(this.energySlider);
    pane.appendChild(energyRow);

    this.meterList = el('div', 'rz-perf-meters');
    pane.appendChild(this.meterList);
    /** name -> { fill, readout } so the frame loop writes rather than rebuilds. */
    this.meters = new Map();

    pane.appendChild(el('div', 'rz-perf-label', 'The musician\'s addresses'));
    const help = el('div', 'rz-perf-help');
    for (const entry of PerformerOSC.addresses()) {
      const row = el('div', 'rz-perf-address');
      row.appendChild(el('code', null, entry.address));
      row.appendChild(el('span', 'rz-perf-address-takes', entry.takes));
      row.appendChild(el('span', 'rz-perf-address-does', entry.does));
      help.appendChild(row);
    }
    pane.appendChild(help);
  }

  // --- the Scenario pane -------------------------------------------------

  buildScenarioPane() {
    const pane = this.panes.scenario;

    const brief = el('div', 'rz-perf-brief');
    this.briefInput = el('textarea', 'rz-perf-brief-input');
    this.briefInput.rows = 2;
    this.briefInput.placeholder =
      'Describe the set and let the AI write the scenario — "90 minutes of dark techno, ' +
      'slow build, drop at the halfway point, I fire it by hand"';
    brief.appendChild(this.briefInput);

    this.authorButton = button('Write a scenario', 'Ask the AI to draft a scenario from this brief',
      () => this.authorScenario(), 'rz-perf-btn rz-perf-author');
    brief.appendChild(this.authorButton);
    pane.appendChild(brief);

    this.authorStatus = el('div', 'rz-perf-author-status', '');
    pane.appendChild(this.authorStatus);

    this.editor = el('textarea', 'rz-perf-editor');
    this.editor.spellcheck = false;
    // A repaint while the artist is typing would throw their edit away, so the
    // editor claims the text for as long as it has focus.
    this.editor.addEventListener('focus', () => { this.editingScenario = true; });
    this.editor.addEventListener('blur', () => { this.editingScenario = false; });
    pane.appendChild(this.editor);

    const actions = el('div', 'rz-perf-row');
    actions.appendChild(button('Load', 'Load what is in the editor, checking it first',
      () => this.loadFromEditor(), 'rz-perf-btn rz-perf-primary'));
    actions.appendChild(button('Revert', 'Go back to the running scenario',
      () => this.fillEditor(true)));
    actions.appendChild(button('Example', 'Fill the editor with a worked example',
      () => { this.editor.value = JSON.stringify(EXAMPLE_SCENARIO, null, 2); }));
    actions.appendChild(button('Save…', 'Save the scenario to a file', () => this.saveToFile()));
    actions.appendChild(button('Open…', 'Open a scenario file', () => this.openFile()));
    pane.appendChild(actions);

    this.editorReport = el('div', 'rz-perf-report', '');
    pane.appendChild(this.editorReport);
  }

  // --- the Log pane ------------------------------------------------------

  buildLogPane() {
    const pane = this.panes.log;
    this.logList = el('div', 'rz-perf-log');
    pane.appendChild(this.logList);
    /** How many entries are already drawn, so a repaint appends rather than rebuilds. */
    this.logDrawn = 0;
  }

  // --- painting: structure -----------------------------------------------

  /** Everything that only changes when something happens. */
  paintStructure() {
    if (!this.visible) return;

    const status = this.engine.status();

    this.stateChip.textContent = status.state;
    this.stateChip.dataset.state = status.state;
    this.playButton.textContent = status.state === STATE.RUNNING ? '❚❚' : '▶';
    this.scenarioName.textContent = status.scenarioName;

    if (this.bpmInput !== document.activeElement) {
      this.bpmInput.value = String(Math.round(status.clock.bpm * 10) / 10);
    }

    this.paintProblems(status.validation);
    this.paintSections();
    this.paintCues();
    this.paintDirector(status.director);
    this.paintMeterRows(status.signals);

    if (!this.editingScenario && !this.editor.value) this.fillEditor(true);
  }

  paintProblems(validation) {
    this.problems.replaceChildren();
    if (!validation) return;

    for (const problem of validation.errors.slice(0, 6)) {
      const row = el('div', 'rz-perf-problem rz-perf-problem-error');
      row.textContent = `${problem.where}: ${problem.message}`;
      this.problems.appendChild(row);
    }
    for (const problem of validation.warnings.slice(0, 6)) {
      const row = el('div', 'rz-perf-problem rz-perf-problem-warn');
      row.textContent = `${problem.where}: ${problem.message}`;
      this.problems.appendChild(row);
    }
  }

  paintSections() {
    this.sectionList.replaceChildren();
    this.sectionRows = [];

    this.engine.sections.forEach((section, index) => {
      const row = el('div', 'rz-perf-section');
      row.dataset.index = String(index);

      const name = el('div', 'rz-perf-section-name', section.name);
      row.appendChild(name);

      const enter = el('div', 'rz-perf-section-enter', describeEnter(section.enter));
      row.appendChild(enter);

      const look = el('div', 'rz-perf-section-look', describeLook(section.look));
      row.appendChild(look);

      const progress = el('div', 'rz-perf-section-progress');
      const fill = el('div', 'rz-perf-section-fill');
      progress.appendChild(fill);
      row.appendChild(progress);

      // Clicking a section is a jump. It is the panel's version of a cue, and
      // it is how the set is driven when nobody has wired up a controller yet.
      row.addEventListener('click', () => this.engine.jumpToSection(index, 'panel'));
      row.title = section.notes || `Jump to ${section.name}`;

      this.sectionList.appendChild(row);
      this.sectionRows.push({ row, fill });
    });
  }

  paintCues() {
    this.cueList.replaceChildren();
    const cues = this.engine.scenario.cues;

    if (!cues.length) {
      this.cueList.appendChild(el('div', 'rz-perf-empty', 'No cues in this scenario.'));
      return;
    }

    for (const cue of cues) {
      this.cueList.appendChild(
        button(cue.name, `Fire "${cue.name}"`, () => this.engine.fireCue(cue.name), 'rz-perf-cue')
      );
    }
  }

  paintDirector(director) {
    if (!director) {
      this.directorStatus.textContent = 'not available in this build';
      this.directorToggle.disabled = true;
      return;
    }

    this.directorToggle.checked = director.enabled;

    if (this.steerInput !== document.activeElement && this.steerInput.value !== director.steer) {
      this.steerInput.value = director.steer;
    }

    // The cadence is no longer a bar count anyone can read off the transport,
    // so it has to be shown: how it will next be spent, and why it was last
    // spent. Otherwise a director that is thinking about the music is
    // indistinguishable from one that has quietly stopped.
    const cadence = director.cadence;
    const next = cadence && Number.isFinite(cadence.nextInSeconds)
      ? `, next in ${cadence.nextInSeconds}s`
      : '';
    const why = cadence?.reason ? ` (${cadence.reason})` : '';

    this.directorStatus.textContent = director.lastError
      ? director.lastError
      : director.thinking
        ? 'thinking…'
        : director.enabled
          ? `${director.calls} call${director.calls === 1 ? '' : 's'}${why}${next}`
          : 'off';
    this.directorStatus.dataset.error = director.lastError ? 'true' : 'false';
    this.directorNote.textContent = director.lastNote || '';
  }

  /**
   * What the room sounds like, for the artist rather than for the model.
   *
   * Three states worth telling apart, and the middle one is the whole reason
   * this exists: OFF (nobody is listening), a dash (listening and hearing
   * nothing, which means a routing problem, not quiet music), and the
   * description. A free pulse is printed as FREE rather than as a tempo,
   * because on this material that is the correct answer and not a failure.
   */
  paintListening() {
    if (!this.listeningReadout) return;

    const heard = this.engine.listening?.();
    if (!heard) {
      this.listeningReadout.textContent = 'not listening';
      this.listeningReadout.dataset.state = 'off';
      this.listeningReadout.title = 'Turn the director on to listen to the room';
      return;
    }

    if (heard.dynamics === 'silent') {
      this.listeningReadout.textContent = 'silence';
      this.listeningReadout.dataset.state = 'silent';
      this.listeningReadout.title = 'Listening, but nothing is arriving';
      return;
    }

    const pulse = heard.pulse.state === 'metered' ? `${heard.pulse.bpm}` : 'FREE';
    this.listeningReadout.textContent = `${heard.dynamics} · ${pulse}`;
    this.listeningReadout.dataset.state = heard.pulse.state === 'metered' ? 'metered' : 'free';
    this.listeningReadout.title = heard.summary || '';
  }

  /** Build a meter row per signal, once per scenario rather than per frame. */
  paintMeterRows(signals) {
    const names = Object.keys(signals);
    const current = [...this.meters.keys()];
    if (names.length === current.length && names.every((n, i) => n === current[i])) return;

    this.meterList.replaceChildren();
    this.meters.clear();

    for (const name of names) {
      const row = el('div', 'rz-perf-meter');
      row.appendChild(el('span', 'rz-perf-meter-name', name));

      const track = el('div', 'rz-perf-meter-track');
      const fill = el('div', 'rz-perf-meter-fill');
      track.appendChild(fill);
      row.appendChild(track);

      const readout = el('span', 'rz-perf-meter-value', '0.00');
      row.appendChild(readout);

      this.meterList.appendChild(row);
      this.meters.set(name, { fill, readout, row });
    }
  }

  // --- painting: the live half -------------------------------------------

  /**
   * Runs on its own frame loop while the panel is open.
   *
   * It deliberately does not go through UnifiedRAFManager: that loop is the
   * render path's, and a panel repaint is not worth a slot in it. It also does
   * nothing at all while the panel is hidden.
   */
  paintLive() {
    if (!this.visible) return;

    const clock = this.engine.clock;

    this.barReadout.textContent = String(clock.bar);
    this.paintBeats(clock);
    this.paintListening();

    if (this.activeTab === 'set') {
      const index = this.engine.sectionIndex;
      const section = this.engine.currentSection;
      const holdBars = Math.max(
        this.engine.scenario.rules.minSectionBars,
        section?.hold?.bars ?? 0
      );
      const bars = this.engine.sectionBars;

      this.sectionRows?.forEach((entry, i) => {
        const active = i === index;
        entry.row.dataset.active = active ? 'true' : 'false';
        entry.fill.style.width = active && holdBars > 0
          ? `${Math.min(100, (bars / holdBars) * 100)}%`
          : active ? '100%' : '0%';
      });
    }

    if (this.activeTab === 'signals') {
      const snapshot = this.engine.signals.snapshot();
      for (const [name, meter] of this.meters) {
        const signal = snapshot[name];
        if (!signal) continue;
        meter.fill.style.width = `${Math.round(signal.value * 100)}%`;
        meter.readout.textContent = signal.value.toFixed(2);
        // A signal nothing has ever sent reads differently from one at zero.
        meter.row.dataset.silent = signal.seen ? 'false' : 'true';
      }
      if (this.energySlider !== document.activeElement) {
        this.energySlider.value = String(Math.round(this.engine.signals.energy * 100));
      }
    }
  }

  paintBeats(clock) {
    const wanted = clock.beatsPerBar;
    if (this.beatDots.childElementCount !== wanted) {
      this.beatDots.replaceChildren();
      for (let i = 0; i < wanted; i++) this.beatDots.appendChild(el('span', 'rz-perf-beat'));
    }

    const beat = Math.floor(clock.beats) % wanted;
    const running = this.engine.state === STATE.RUNNING;
    [...this.beatDots.children].forEach((dot, i) => {
      dot.dataset.on = running && i === beat ? 'true' : 'false';
    });
  }

  /** Append only what is new, so the log does not flicker or lose its scroll. */
  appendLog() {
    if (!this.visible || this.activeTab !== 'log') return;

    const entries = this.engine.log;
    // The engine trims its log from the front, so a count that went backwards
    // means entries were dropped and the pane has to be rebuilt.
    if (entries.length < this.logDrawn) {
      this.logList.replaceChildren();
      this.logDrawn = 0;
    }

    const atBottom = this.logList.scrollTop + this.logList.clientHeight
      >= this.logList.scrollHeight - 40;

    for (let i = this.logDrawn; i < entries.length; i++) {
      const entry = entries[i];
      const row = el('div', 'rz-perf-log-row');
      row.appendChild(el('span', 'rz-perf-log-bar', String(entry.bar)));

      const message = el('span', 'rz-perf-log-message', entry.message);
      message.style.color = LEVEL_COLOURS[entry.level] || LEVEL_COLOURS.info;
      row.appendChild(message);

      if (entry.why) row.appendChild(el('span', 'rz-perf-log-why', entry.why));
      this.logList.appendChild(row);
    }
    this.logDrawn = entries.length;

    // Follow the tail only when the artist was already there — scrolling back
    // to read why something happened should not be undone by the next line.
    if (atBottom) this.logList.scrollTop = this.logList.scrollHeight;
  }

  // --- actions -----------------------------------------------------------

  toggleRun() {
    if (this.engine.state === STATE.RUNNING) this.engine.pause();
    else this.engine.start();
  }

  showTab(key) {
    this.activeTab = key;
    for (const tab of TABS) {
      this.panes[tab.key].hidden = tab.key !== key;
      this.tabButtons[tab.key].dataset.active = tab.key === key ? 'true' : 'false';
    }
    if (key === 'log') {
      this.logList.replaceChildren();
      this.logDrawn = 0;
      this.appendLog();
    }
    if (key === 'scenario' && !this.editingScenario) this.fillEditor(true);
  }

  fillEditor(force = false) {
    if (this.editingScenario && !force) return;
    this.editor.value = JSON.stringify(this.engine.scenario, null, 2);
    this.editorReport.textContent = '';
  }

  loadFromEditor() {
    let parsed;
    try {
      parsed = JSON.parse(this.editor.value);
    } catch (error) {
      this.editorReport.textContent = `That is not valid JSON: ${error.message}`;
      this.editorReport.dataset.level = 'error';
      return;
    }

    const report = this.engine.loadScenario(parsed, this.knownNames());
    const lines = [
      ...report.errors.map((p) => `error — ${p.where}: ${p.message}`),
      ...report.warnings.map((p) => `warning — ${p.where}: ${p.message}`),
    ];

    this.editorReport.textContent = lines.length
      ? lines.join('\n')
      : 'Loaded. Nothing to report.';
    this.editorReport.dataset.level = report.errors.length ? 'error'
      : report.warnings.length ? 'warn' : 'ok';
  }

  /** What exists right now, so validation can check a scenario's references. */
  knownNames() {
    const sceneManager = this.vjPanel?.sceneManager;
    const presetManager = this.vjPanel?.presetManager;

    const scenes = sceneManager?.getAllScenes?.() || [];
    const presets = presetManager?.getAllPresets?.() || [];

    return {
      // Both ids and names, because a scenario is written with whichever the
      // artist had in front of them.
      sceneIds: scenes.flatMap((s) => [s.id, s.name]),
      presetIds: presets.flatMap((p) => [p.id, p.name]),
    };
  }

  async authorScenario() {
    const director = this.engine.director;
    if (!director) {
      this.authorStatus.textContent = 'The AI is not available in this build.';
      return;
    }
    if (this.authoring) return;

    const brief = this.briefInput.value.trim();
    if (!brief) {
      this.authorStatus.textContent = 'Describe the set first.';
      return;
    }

    this.authoring = true;
    this.authorButton.disabled = true;
    this.authorStatus.textContent = 'Writing a scenario…';
    this.authorStatus.dataset.level = 'info';

    try {
      const { scenario, note } = await director.authorScenario(brief, this.rigContext());
      // Into the editor, not into the engine. A scenario is a document the
      // artist reads and edits before playing it — loading it under a running
      // set unread is exactly the surprise this panel exists to avoid.
      this.editor.value = JSON.stringify(scenario, null, 2);
      this.authorStatus.textContent = note
        ? `${note} — read it, then press Load.`
        : 'Drafted. Read it, then press Load.';
      this.authorStatus.dataset.level = 'ok';
    } catch (error) {
      this.authorStatus.textContent = error?.message || String(error);
      this.authorStatus.dataset.level = 'error';
    } finally {
      this.authoring = false;
      this.authorButton.disabled = false;
    }
  }

  /** Everything the model needs to write a scenario against this rig. */
  rigContext() {
    const scenes = (this.vjPanel?.sceneManager?.getAllScenes?.() || [])
      .map((s) => ({ id: s.id, name: s.name, notes: s.notes }));
    const presets = (this.vjPanel?.presetManager?.getAllPresets?.() || [])
      .map((p) => ({ id: p.id, name: p.name }));

    // Parameters as "node.param", named the way a scenario refers to them.
    const parameters = [];
    for (const node of this.engine.editor?.graph?.nodes || []) {
      const label = node.name || node.kind;
      for (const [key, value] of Object.entries(node.params || {})) {
        if (typeof value === 'number') parameters.push(`${label}.${key}`);
      }
    }

    return {
      scenes,
      presets,
      parameters,
      oscAddresses: (this.oscManager?.getAddresses?.() || []).map((entry) => entry.address),
      audioChannels: [...AUDIO_TAP_CHANNELS],
      bpm: this.engine.clock.bpm,
    };
  }

  saveToFile() {
    const text = JSON.stringify(this.engine.scenario, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${(this.engine.scenario.name || 'scenario').replace(/[^\w.-]+/g, '-')}.rzperf.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.rzperf.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.editor.value = await file.text();
      this.showTab('scenario');
      this.loadFromEditor();
    });
    input.click();
  }

  // --- visibility --------------------------------------------------------

  show() {
    if (this.visible) return;
    this.visible = true;
    this.panel.style.display = 'flex';

    if (!this.cleanupResizable) {
      // Resizing is set up on first show rather than at build time: the helper
      // measures the panel, and a display:none element measures as nothing.
      this.cleanupResizable = makeResizable(this.panel, { minWidth: 360, minHeight: 320 });
    }

    this.paintStructure();
    this.showTab(this.activeTab);
    this.startPainting();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.panel.style.display = 'none';
    this.stopPainting();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
    return this.visible;
  }

  isVisible() { return this.visible; }

  startPainting() {
    if (this.frame !== null) return;
    const step = () => {
      this.frame = requestAnimationFrame(step);
      this.paintLive();
    };
    this.frame = requestAnimationFrame(step);
  }

  stopPainting() {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  destroy() {
    this.hide();
    this.unsubscribe?.();
    this.router.detach();
    this.cleanupDraggable?.();
    this.cleanupResizable?.();
    this.panel?.remove();
    this.panel = null;
  }
}

/** "on cue drop", "after 32 bars", "when energy > 0.7". */
function describeEnter(enter) {
  switch (enter?.kind) {
    case 'cue': return `on cue “${enter.cue}”`;
    case 'bars': return `after ${enter.bars} bars`;
    case 'seconds': return `after ${enter.seconds}s`;
    case 'when': return `when ${enter.when}`;
    default: return 'by hand';
  }
}

function describeLook(look) {
  switch (look?.kind) {
    case 'scene': return `scene: ${look.scene}`;
    case 'preset': return `preset: ${look.preset}`;
    case 'patch': return 'a patch of its own';
    default: return 'no look';
  }
}

let instance = null;

/** The panel, built once. */
export function getPerformerPanel(engine, options) {
  if (!instance && engine) instance = new PerformerPanel(engine, options);
  return instance;
}

export default PerformerPanel;
