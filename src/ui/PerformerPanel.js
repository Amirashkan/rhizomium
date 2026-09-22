// src/ui/PerformerPanel.js

import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';
import { setIcon } from './iconSprite.js';
import { STATE } from '../performer/PerformerEngine.js';
import { PerformerOSC } from '../performer/PerformerOSC.js';
import { EXAMPLE_SCENARIO } from '../performer/Scenario.js';
import {
  EXAMPLE_MANIFEST,
  MANIFEST_LIMITS,
  parseManifest,
  validateManifest,
} from '../performer/ShowManifest.js';
import {
  folderPickerKind,
  indexShowFolder,
  readDirectoryHandle,
  readFileList,
} from '../performer/ShowFolder.js';
import {
  describeDirectionAt,
  directionLines,
  parseDirectionLines,
  spreadOverTimeline,
  validateDirections,
} from '../performer/PreDirections.js';
import { manifestFromScenario } from '../performer/ShowBuilder.js';
import { readFolderShow } from '../performer/ShowImport.js';
import { AUDIO_TAP_CHANNELS } from '../audio/audioAnalysisTaps.js';

/**
 * PerformerPanel - the surface for the coPerformer.
 *
 * It is a performance instrument before it is a settings window, and that
 * decides most of the layout. Five tabs, and the one that is up by default is
 * the one you look at with a mixer in front of you:
 *
 *   Set       where the performance is, and the buttons that move it
 *   Signals   what the performer is hearing, as meters
 *   Show      a manifest, the button that builds the looks from it, and the
 *             show's own pre-direction
 *   Scenario  the score, as editable text
 *   Log       what it did, and why
 *
 * Show and Scenario are the two halves of getting to a set, and they are in
 * that order because that is the order the work happens in: a manifest
 * describes looks that do not exist, building it makes them, and what lands in
 * Scenario is a score that names them. An artist who already has their scenes
 * skips the first tab entirely.
 *
 * The work also arrives the other way round, and more often after the first
 * show: a set the artist already has — written by hand, drafted here, opened
 * from someone else's machine — on a rig with none of its scenes on it. That
 * is what **Build the missing looks** on the Scenario tab is for. It reads the
 * set in the editor, works out which sections have nothing to show, and builds
 * a patch for each under the name that section already uses.
 *
 * The Show tab has one thing on it that is neither: **Pre-directions**, beside
 * the folder. The steer box on the Set tab is a line of direction typed while
 * the set runs, which only works while somebody is standing there. A show
 * handed entirely to the model has nobody to type, so its direction is written
 * here instead and put on the timeline — see PreDirections.js.
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
  { key: 'show', label: 'Show' },
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

/**
 * An episode, in the width of a label: which one it is and how long it runs.
 *
 * "Ep 1 · 4 cues · 12 min" rather than the filename, because an episode folder
 * always holds the same filename and the number is the thing the artist is
 * looking for when they have built four of them this week.
 */
function episodeLabel(read) {
  const ep = read?.episode || {};
  const cues = ep.cues || 0;

  const bits = [ep.number ? `Ep ${ep.number}` : 'Episode'];
  bits.push(`${cues} cue${cues === 1 ? '' : 's'}`);
  if (ep.minutes) bits.push(`${ep.minutes} min`);
  return bits.join(' · ');
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
   * @param {object} [options.timelinePanel] the editor's timeline, so a set
   *   that drives it can put it on screen. Panel to panel: the engine and the
   *   executor deal in the timeline MANAGER and know nothing about a window.
   */
  constructor(engine, options = {}) {
    this.engine = engine;
    this.oscManager = options.oscManager || null;
    this.vjPanel = options.vjPanel || null;
    this.timelinePanel = options.timelinePanel || null;

    this.visible = false;
    this.activeTab = 'set';

    /** Set while the artist is editing, so a repaint cannot wipe their typing. */
    this.editingScenario = false;
    this.editingManifest = false;
    /**
     * A scenario in the editor that is not the running one — drafted by the
     * model, or built from a manifest — and has not been loaded yet.
     *
     * `editingScenario` only covers the seconds the textarea has focus, which
     * is not the same question. A draft is left on screen while the artist
     * looks at the Set tab to see what they already have, and coming back to
     * find it replaced by the running scenario loses an answer they paid for.
     */
    this.editorHoldsDraft = false;
    this.authoring = false;
    /** A build in progress, and the flag the Cancel button sets. */
    this.building = false;
    this.cancelBuild = false;
    /**
     * The open show folder, from ShowFolder.indexShowFolder(), or null.
     *
     * It holds live File objects, so it is deliberately not persisted: a
     * reopened editor has no access to last night's directory and a folder
     * readout describing files nothing can read is worse than none.
     */
    this.folder = null;
    /** The manifest text as the folder gave it, so a repaint knows what is the artist's own. */
    this.manifestFromFolder = '';
    /**
     * What reading the folder's manifests found, from ShowImport.readFolderShow()
     * — a show, a set of transmissions, or nothing this can open. Null until a
     * folder has been read, and again as soon as one is closed.
     */
    this.folderShow = null;
    /** Which of the two builds is running, so the right button is the Stop. */
    this.buildingLooks = false;
    /**
     * The plan Build-the-missing-looks last described, waiting on a second
     * press. Keyed by what it was derived from, so editing the set in between
     * asks again rather than building the old plan.
     */
    this.pendingLooks = null;

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
    this.buildShowPane();
    this.buildScenarioPane();
    this.buildLogPane();

    document.body.appendChild(this.panel);
  }

  buildHeader() {
    const header = el('div', 'rz-perf-header');

    const title = el('div', 'rz-perf-title');
    setIcon(title, 'vj', { text: 'coPerformer', size: 16 });
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

    // What the SHOW is telling the model, as opposed to what the box above is.
    // On an unattended set this is the only direction there is, and the
    // question an artist checking in on one actually has is "is it still being
    // told anything?" — which nothing on the panel could answer before.
    // Written here rather than on the Show tab because this is the tab you
    // look at with a mixer in front of you.
    this.directorPlan = el('div', 'rz-perf-director-plan', '');
    this.directorPlan.title = 'The show\'s own direction for where the set is now. '
      + 'Write these on the Show tab; what you type above wins over them.';
    box.appendChild(this.directorPlan);

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

  // --- the Show pane -----------------------------------------------------
  //
  // The one tab that is used before a set exists rather than during one. A
  // manifest describes looks that have not been built; Build makes each one a
  // patch, installs it as a scene, writes the set that plays them, and drops
  // the result in the Scenario tab for the artist to read.
  //
  // It is deliberately the slowest thing in the panel and the only one that
  // spends several calls in a row, so two things are non-negotiable: it says
  // what it is doing at every step, and it can be stopped between steps.

  buildShowPane() {
    const pane = this.panes.show;

    const intro = el('div', 'rz-perf-help');
    intro.textContent =
      'A manifest describes the show before it exists: the looks, in order, in prose. ' +
      'Building it generates a patch for each one, installs them as scenes, and writes ' +
      'the set that plays them. Nothing starts playing — the scenario lands in the ' +
      'Scenario tab for you to read first.';
    pane.appendChild(intro);

    // The folder, above the manifest, because it is the thing you open first:
    // a show with footage in it is a directory, and picking it fills the
    // editor below and hands the build the clips in one go.
    const folderRow = el('div', 'rz-perf-row rz-perf-folder-row');
    folderRow.appendChild(button('Open folder…', 'Open a show folder: its manifest, and the media the looks are built on',
      () => this.openShowFolder(), 'rz-perf-btn rz-perf-folder-open'));
    this.folderClearButton = button('Close folder', 'Forget this folder. Looks that name clips are then built without them',
      () => this.closeShowFolder());
    this.folderClearButton.hidden = true;
    folderRow.appendChild(this.folderClearButton);
    // Beside the folder, because it belongs to the same moment: this is the
    // pane you are on before a set exists, and the direction for a show that
    // nobody will be standing over is written here, at the desk, with the
    // rest of the planning.
    this.preDirectionButton = button('Pre-directions…',
      'Write the direction for the show now, and put it on the timeline. '
        + 'This is what directs the set when nobody is at the laptop to type.',
      () => this.togglePreDirections(), 'rz-perf-btn rz-perf-predirections');
    folderRow.appendChild(this.preDirectionButton);

    this.folderLabel = el('div', 'rz-perf-folder-label', 'No folder open.');
    folderRow.appendChild(this.folderLabel);
    pane.appendChild(folderRow);

    pane.appendChild(this.buildPreDirectionBox());

    // What is actually in it, one line per clip. Named, because the names are
    // what a look writes in its "media" list.
    this.folderList = el('div', 'rz-perf-folder-list');
    this.folderList.hidden = true;
    pane.appendChild(this.folderList);

    this.manifestEditor = el('textarea', 'rz-perf-editor');
    this.manifestEditor.spellcheck = false;
    this.manifestEditor.placeholder = 'Press Example to see the shape of one.';
    this.manifestEditor.addEventListener('focus', () => { this.editingManifest = true; });
    this.manifestEditor.addEventListener('blur', () => { this.editingManifest = false; });
    pane.appendChild(this.manifestEditor);

    const actions = el('div', 'rz-perf-row');
    this.buildButton = button('Build the show', 'Generate a patch for every look, then write the set',
      () => this.buildShow(), 'rz-perf-btn rz-perf-primary');
    actions.appendChild(this.buildButton);

    this.cancelButton = button('Stop', 'Stop after the look being built now', () => {
      this.cancelBuild = true;
      this.showStatus.textContent = 'Stopping after this look…';
    });
    this.cancelButton.disabled = true;
    actions.appendChild(this.cancelButton);

    actions.appendChild(button('Check', 'Read the manifest and say what is wrong with it',
      () => this.checkManifest()));
    actions.appendChild(button('Example', 'Fill the editor with a worked manifest',
      () => { this.manifestEditor.value = JSON.stringify(EXAMPLE_MANIFEST, null, 2); this.checkManifest(); }));
    actions.appendChild(button('Save…', 'Save the manifest to a file', () => this.saveManifest()));
    actions.appendChild(button('Open…', 'Open a manifest file', () => this.openManifest()));
    pane.appendChild(actions);

    this.showStatus = el('div', 'rz-perf-author-status', '');
    pane.appendChild(this.showStatus);

    // One line per step, appended as it happens. A build is minutes long and a
    // spinner for that is indistinguishable from a hang.
    this.buildLog = el('div', 'rz-perf-report rz-perf-build-log', '');
    pane.appendChild(this.buildLog);
  }

  /* --- pre-directions ---------------------------------------------------
   *
   * The steer box on the Set tab is a line of direction typed while the set
   * runs, and it only works because somebody is standing there. Hand the whole
   * show to the model and that box holds whatever was in it when the doors
   * opened, for the length of the set.
   *
   * These are the same sentences, written here instead, and put on the
   * timeline — one per section, in the order they were written — so the
   * director is handed the line for wherever the set has got to. See
   * PreDirections.js for the resolution rule; this is only the surface.
   *
   * A textarea rather than a table, for the reason the scenario editor is one:
   * what is being written is three sentences of prose, not nine fields.
   */

  buildPreDirectionBox() {
    const box = el('div', 'rz-perf-predirection-box');
    box.hidden = true;
    this.preDirectionBox = box;

    box.appendChild(el('div', 'rz-perf-help',
      'One line of direction per line. Put it on the timeline and each one is handed '
      + 'to the AI for its stretch of the set. A line with no section in front of it '
      + 'stands for the whole show and holds wherever nothing else is said.'));

    this.preDirectionEditor = el('textarea', 'rz-perf-predirection-editor');
    this.preDirectionEditor.spellcheck = false;
    this.preDirectionEditor.rows = 5;
    this.preDirectionEditor.placeholder =
      'Patient and cold. Never bright until the drop.\n'
      + 'drop: let it go — hard, white, full frame\n'
      + 'drop +16: hold it there, do not add anything';
    // The same claim the scenario editor makes: a repaint while the artist is
    // typing would throw the edit away.
    this.preDirectionEditor.addEventListener('focus', () => { this.editingDirections = true; });
    this.preDirectionEditor.addEventListener('blur', () => { this.editingDirections = false; });
    box.appendChild(this.preDirectionEditor);

    const actions = el('div', 'rz-perf-row');
    actions.appendChild(button('Set on the timeline',
      'Put these on the set: one per section, in the order written, and each held '
        + 'until the next one starts',
      () => this.setDirectionsOnTimeline(), 'rz-perf-btn rz-perf-primary'));
    actions.appendChild(button('Revert', 'Go back to the direction the set is carrying',
      () => this.fillPreDirectionEditor(true)));
    actions.appendChild(button('Clear', 'Take all the pre-direction off the set',
      () => this.clearPreDirections()));
    box.appendChild(actions);

    this.preDirectionStatus = el('div', 'rz-perf-author-status', '');
    box.appendChild(this.preDirectionStatus);

    // Where each one landed, once it is on the timeline. The point of the
    // button is that it decides the anchors for you, so it has to say what it
    // decided — otherwise the set carries five lines and the artist has no way
    // to know which section is about to be handed which.
    this.preDirectionList = el('div', 'rz-perf-predirection-list');
    box.appendChild(this.preDirectionList);

    return box;
  }

  /** Open or close the box, filling it from the running set the first time. */
  togglePreDirections() {
    const open = this.preDirectionBox.hidden;
    this.preDirectionBox.hidden = !open;
    this.preDirectionButton.dataset.open = open ? 'true' : 'false';
    if (open) this.fillPreDirectionEditor();
    return open;
  }

  /** The direction the set is carrying, as lines. */
  fillPreDirectionEditor(force = false) {
    if (this.editingDirections && !force) return;
    this.preDirectionEditor.value = directionLines(this.engine.scenario.directions);
    this.preDirectionStatus.textContent = '';
    this.preDirectionStatus.dataset.level = 'ok';
    this.paintPreDirectionList();
  }

  /**
   * Put what is in the box on the set.
   *
   * Anchors are decided here rather than written by the artist: a line already
   * naming a section keeps its place, and the rest are dealt out across the
   * sections in order (PreDirections.spreadOverTimeline). Loading goes through
   * the engine's ordinary scenario load, so this is a live edit — the set does
   * not stop, and a section that survived it keeps its position.
   */
  setDirectionsOnTimeline() {
    const sections = this.engine.scenario.sections;
    const written = parseDirectionLines(this.preDirectionEditor.value);

    if (!sections.length) {
      this.preDirectionStatus.textContent =
        'There are no sections to put these on yet. Build the show, or load a set, first.';
      this.preDirectionStatus.dataset.level = 'warn';
      return;
    }

    const directions = spreadOverTimeline(written, sections);
    // Straight onto the running scenario. Pre-directions are never executed —
    // they are only what the director is told — so there is nothing here that
    // has to wait for a section boundary.
    this.engine.loadScenario({ ...this.engine.scenario, directions }, this.knownNames());

    // The editor is rewritten with the anchors that were just decided, so what
    // is in the box and what is on the set are the same document. Forced,
    // because the artist's cursor is almost certainly still in it.
    this.fillPreDirectionEditor(true);

    const report = validateDirections(directions, {
      sectionIds: sections.map((section) => section.id),
    });
    const lines = [
      ...report.errors.map((p) => `error — ${p.where}: ${p.message}`),
      ...report.warnings.map((p) => `warning — ${p.where}: ${p.message}`),
    ];

    this.preDirectionStatus.textContent = lines.length
      ? lines.join('\n')
      : directions.length
        ? `${directions.length} pre-direction${directions.length === 1 ? '' : 's'} on the timeline.`
        : 'No pre-directions — the set carries none.';
    this.preDirectionStatus.dataset.level = report.errors.length ? 'error'
      : report.warnings.length ? 'warn' : 'ok';

    this.paintStructure();
    return directions;
  }

  /** Take every pre-direction off the set, and out of the box. */
  clearPreDirections() {
    this.engine.loadScenario({ ...this.engine.scenario, directions: [] }, this.knownNames());
    this.preDirectionEditor.value = '';
    this.preDirectionStatus.textContent = 'The set carries no pre-direction. The AI improvises unled.';
    this.preDirectionStatus.dataset.level = 'ok';
    this.paintPreDirectionList();
    this.paintStructure();
  }

  /** One row per pre-direction: where it lands, and what it says. */
  paintPreDirectionList() {
    if (!this.preDirectionList) return;
    this.preDirectionList.replaceChildren();

    for (const direction of this.engine.scenario.directions) {
      const row = el('div', 'rz-perf-predirection');
      row.appendChild(el('span', 'rz-perf-predirection-at', describeDirectionAt(direction.at)));
      row.appendChild(el('span', 'rz-perf-predirection-text', direction.text));
      this.preDirectionList.appendChild(row);
    }
  }

  /* --- the show folder --------------------------------------------------
   *
   * A manifest that names `fog-loop.mp4` is half a document; the other half is
   * the directory it was sitting in. Opening the directory keeps the two
   * together — which is what makes a show portable to the rig's laptop, and
   * what lets the build put the artist's own footage into the looks it
   * generates rather than being told it may not have any.
   */

  /**
   * Pick a folder and read it.
   *
   * Two ways in, because there are two ways a browser hands over a directory.
   * The real picker names the folder; the `webkitdirectory` fallback does not,
   * so the name is taken off the first path instead. Everything after this
   * point works on the same index either way.
   */
  async openShowFolder() {
    try {
      const entries = folderPickerKind() === 'directory'
        ? await this.pickDirectory()
        : await this.pickDirectoryFallback();
      if (!entries) return; // cancelled — not a failure, and not worth a line

      this.setShowFolder(indexShowFolder(entries.files, { name: entries.name }));
    } catch (error) {
      // AbortError is the artist pressing Escape. Everything else is worth saying.
      if (error?.name === 'AbortError') return;
      this.showStatus.textContent = `Could not read that folder: ${error?.message || error}`;
      this.showStatus.dataset.level = 'error';
    }
  }

  async pickDirectory() {
    const handle = await window.showDirectoryPicker({ id: 'rhizo-show', mode: 'read' });
    return { name: handle?.name || '', files: await readDirectoryHandle(handle) };
  }

  /** The same, for a browser with no directory picker. */
  pickDirectoryFallback() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        if (!files.length) { resolve(null); return; }
        const first = String(files[0].webkitRelativePath || '').split('/')[0];
        resolve({ name: first, files: readFileList(files) });
      });
      // A cancelled file dialog fires nothing in most browsers, so this promise
      // is simply never settled — which is fine: nothing is waiting on it and
      // the artist can press the button again.
      input.click();
    });
  }

  /**
   * Take a folder, and put the show that is in it in the editor.
   *
   * What that show is takes reading the files: a `manifest.json` is as likely
   * to be another tool's document as it is to be a set, and a foreign one
   * loaded as a show is a page of validation errors about something the artist
   * never wrote. ShowImport.readFolderShow() is what decides — a show manifest
   * arrives as its own bytes, a folder of transmissions arrives as the manifest
   * they imply, and anything else is left where it is and said out loud.
   *
   * Either way it is only loaded over an editor that is empty or holds
   * something this panel put there. An artist who has been typing a manifest
   * for ten minutes and opens a folder to attach its footage should not have
   * that replaced — so in that one case the folder is taken and the file is
   * offered rather than applied.
   */
  async setShowFolder(folder) {
    this.folder = folder;
    // The beds, handed to the executor now rather than at build time: an
    // `audio` action resolves its file against this, and a set can be loaded
    // and played without anything ever being built.
    this.engine.executor?.setSounds?.(folder?.media || []);

    const read = await readFolderShow(folder);
    this.folderShow = read;
    folder.problems.push(...read.problems);

    let loaded = false;
    if (read.text) {
      const typed = this.manifestEditor.value.trim();
      const mine = !typed || this.manifestFromFolder === typed || typed === JSON.stringify(EXAMPLE_MANIFEST, null, 2);
      if (mine) {
        this.manifestEditor.value = read.text;
        this.manifestFromFolder = read.text.trim();
        loaded = true;
      }
    }

    this.paintFolder();
    this.showTab('show');

    const report = this.checkManifest();
    if (!loaded && read.text && report !== undefined) {
      this.noteBuild(
        `"${read.path}" was left unopened — the editor has a manifest in it already. Clear it and open the folder again to use the one on disk.`,
        'warn'
      );
    }
    if (loaded && read.kind === 'episode') {
      // The one thing worth saying out loud about an episode, because it is the
      // one way it differs from every other show the panel opens: it stops.
      const cues = read.episode?.cues || 0;
      this.noteBuild(
        `${episodeLabel(read)} read out of this folder into the manifest above: an opening, `
          + `${cues} transmission${cues === 1 ? '' : 's'}, and a sign-off. The two ends are the show's `
          + 'own words drawn on black — nothing is generated for them, so a build costs '
          + `${cues} call${cues === 1 ? '' : 's'}, not ${cues + 2}. It runs once and stops on the `
          + 'sign-off rather than returning to the top.',
        'ok'
      );
    }
    if (loaded && read.kind === 'transmissions') {
      // A manifest nobody wrote, so it says where it came from and what to do
      // with it. The briefs are the prompts each piece was generated from and
      // they are what the patches will be made of — which is worth a look
      // before six calls are spent on them.
      this.noteBuild(
        `${read.projects.length} transmission${read.projects.length === 1 ? '' : 's'} read out of this folder `
          + 'into the manifest above — the briefs, the clips each look is built on, the palette and the '
          + 'holds. Read it, edit anything that is not the show you want, then Build.',
        'ok'
      );
    }
  }

  closeShowFolder() {
    this.folder = null;
    this.folderShow = null;
    this.manifestFromFolder = '';
    this.engine.executor?.setSounds?.([]);
    this.paintFolder();
    this.checkManifest();
  }

  /** The folder as one line, and its clips as a list under it. */
  paintFolder() {
    const folder = this.folder;
    this.folderClearButton.hidden = !folder;
    this.folderList.replaceChildren();
    this.folderList.hidden = !folder;

    if (!folder) {
      this.folderLabel.textContent = 'No folder open.';
      this.folderLabel.dataset.level = '';
      return;
    }

    const usable = folder.media.filter((item) => item.kind !== 'audio');
    const read = this.folderShow;
    const projects = read?.projects.length || 0;

    const bits = [folder.name];
    bits.push(
      read?.kind === 'episode' ? episodeLabel(read)
        : read?.kind === 'transmissions' ? `${projects} transmission${projects === 1 ? '' : 's'}`
        : read?.kind === 'show' ? read.path
        // Two different answers: nothing here to open, or something here that
        // is not a show. The second one is the one with something to fix.
        : folder.manifests?.length ? 'no show manifest'
        : 'no manifest'
    );
    bits.push(`${usable.length} clip${usable.length === 1 ? '' : 's'}`);
    const beds = folder.media.length - usable.length;
    if (beds) bits.push(`${beds} sound${beds === 1 ? '' : 's'}`);
    if (folder.skipped.length) bits.push(`${folder.skipped.length} skipped`);

    this.folderLabel.textContent = bits.join(' · ');
    this.folderLabel.dataset.level = read && read.kind !== 'none' ? 'ok' : 'warn';

    for (const item of folder.media) {
      const row = el('div', 'rz-perf-folder-file');
      row.dataset.kind = item.kind;
      // The name, because that is the string a look writes in its media list.
      row.appendChild(el('span', 'rz-perf-folder-name', item.name));
      row.appendChild(el('span', 'rz-perf-folder-meta',
        `${item.kind} · ${(item.size / 1024 / 1024).toFixed(1)} MB${item.folder ? ` · ${item.folder}/` : ''}`));
      this.folderList.appendChild(row);
    }

    for (const item of folder.skipped) {
      const row = el('div', 'rz-perf-folder-file');
      row.dataset.kind = 'skipped';
      row.appendChild(el('span', 'rz-perf-folder-name', item.path));
      row.appendChild(el('span', 'rz-perf-folder-meta', item.reason));
      this.folderList.appendChild(row);
    }
  }

  /** Read the editor as a manifest, or say why it cannot be read. */
  readManifest() {
    const text = this.manifestEditor.value.trim();
    if (!text) throw new Error('Write a manifest first, or press Example.');
    return parseManifest(text);
  }

  checkManifest() {
    let manifest;
    try {
      manifest = this.readManifest();
    } catch (error) {
      this.showStatus.textContent = error.message;
      this.showStatus.dataset.level = 'error';
      return null;
    }

    const report = validateManifest(manifest, this.folder);
    const lines = [
      // The folder's own complaints first: a manifest naming a clip that is not
      // there reads as a manifest problem, and it is usually a folder problem.
      // A note is a note and says so — there is nothing to fix in it, and a line
      // that reads like a fault in a list of faults costs the artist a minute
      // working out which of them matter.
      ...(this.folder?.problems || []).map((p) =>
        `${p.level === 'note' ? 'note' : 'folder'} — ${p.where}: ${p.message}`),
      ...report.errors.map((p) => `error — ${p.where}: ${p.message}`),
      ...report.warnings.map((p) => `warning — ${p.where}: ${p.message}`),
    ];

    this.buildLog.textContent = lines.join('\n');

    const clips = this.folder
      ? manifest.looks.reduce((total, look) => total + (look.media.length ? 1 : 0), 0)
      : 0;
    const withMedia = clips
      ? `, ${clips} of them on your own footage`
      : '';

    this.showStatus.textContent = report.errors.length
      ? `${report.errors.length} thing${report.errors.length === 1 ? '' : 's'} to fix before this can be built.`
      : `${manifest.looks.length} looks${withMedia}, ${report.generated} to generate — ${report.generated} patch call${report.generated === 1 ? '' : 's'}, then one for the set.`;
    this.showStatus.dataset.level = report.errors.length ? 'error' : report.warnings.length ? 'warn' : 'ok';

    return report.errors.length ? null : manifest;
  }

  /** Append one line to the build log, the way the Log tab appends. */
  noteBuild(text, level = 'info') {
    const row = el('div', 'rz-perf-build-line', text);
    row.dataset.level = level;
    this.buildLog.appendChild(row);
    this.buildLog.scrollTop = this.buildLog.scrollHeight;
  }

  /**
   * Build the show.
   *
   * Everything the director needs that touches the editor is handed in from
   * here — installing a scene is the executor's job, and the executor is the
   * only file in the subsystem allowed to know what a scene is.
   */
  async buildShow() {
    const director = this.engine.director;
    if (!director) {
      this.showStatus.textContent = 'The AI is not available in this build.';
      this.showStatus.dataset.level = 'error';
      return;
    }
    if (this.building) return;

    const manifest = this.checkManifest();
    if (!manifest) return;

    const executor = this.engine.executor;
    if (!executor?.sceneManager) {
      this.showStatus.textContent =
        'There is nowhere to put the looks yet. Open the VJ panel (View → VJ Control) and try again.';
      this.showStatus.dataset.level = 'error';
      return;
    }

    this.building = true;
    this.cancelBuild = false;
    this.buildButton.disabled = true;
    this.cancelButton.disabled = false;
    // One build at a time: both spend the same allowance and install into the
    // same scene list.
    this.looksButton.disabled = true;
    this.buildLog.replaceChildren();
    this.showStatus.dataset.level = 'info';
    this.showStatus.textContent = 'Building…';

    try {
      const report = await director.buildShow(manifest, {
        context: this.rigContext(),
        // Null when no folder is open, which is every build that was possible
        // before folders existed — and those go down exactly the path they did.
        folder: this.folder,
        installScene: (name, patch, meta) => executor.installPatchAsScene(name, patch, meta),
        shouldStop: () => this.cancelBuild,
        onProgress: (event) => {
          if (event.phase === 'done') return;
          this.showStatus.textContent = event.message;
          this.noteBuild(
            event.phase === 'look' && event.status === 'ok' ? `✓ ${event.message}`
              : event.status === 'failed' ? `× ${event.name ? `${event.name}: ` : ''}${event.message}`
              : event.message,
            event.status === 'failed' ? 'error' : event.status === 'ok' ? 'ok' : 'info'
          );
        },
      });

      // The scenario goes into the Scenario tab, unloaded — the same rule as
      // a drafted one. A set that starts playing because a build finished is
      // the surprise this panel exists to avoid, and an artist who has just
      // spent six calls has every reason to read what came back.
      this.editor.value = JSON.stringify(report.scenario, null, 2);
      this.editingScenario = false;
      this.editorHoldsDraft = true;

      const madeLooks = report.built.filter((entry) => entry.generated).length;
      this.showStatus.textContent = report.stopped
        ? `Stopped: ${report.stopped}. ${madeLooks} look${madeLooks === 1 ? '' : 's'} built and kept.`
        : `${madeLooks} look${madeLooks === 1 ? '' : 's'} built, ${report.scenario.sections.length} sections. ` +
          'It is in the Scenario tab — read it, then press Load.';
      this.showStatus.dataset.level = report.stopped || report.problems.length ? 'warn' : 'ok';

      if (report.wrote === 'manifest' && !report.stopped) {
        this.noteBuild('The set was written from the manifest rather than by the model.', 'warn');
      }
      for (const problem of report.problems) this.noteBuild(`${problem.where}: ${problem.message}`, 'error');
      if (report.note) this.noteBuild(report.note, 'info');
      const clips = report.built.reduce((total, entry) => total + (entry.media?.length || 0), 0);
      if (clips) {
        this.noteBuild(
          `${clips} clip${clips === 1 ? '' : 's'} from the folder ${clips === 1 ? 'is' : 'are'} in the looks, and travel${clips === 1 ? 's' : ''} with them: the scenes carry their own media.`,
          'ok'
        );
      }

      const beds = manifest.looks.filter((look) => look.sound).length;
      if (beds) {
        this.noteBuild(
          `${beds} look${beds === 1 ? '' : 's'} play${beds === 1 ? 's' : ''} ${beds === 1 ? 'its' : 'their'} own sound: the performer loads `
            + `${beds === 1 ? 'it' : 'each'} into the Audio panel on the way into the section and the analysis hears `
            + `${beds === 1 ? 'it' : 'them'}. Your live input cannot run at the same time — the file takes the input over.`,
          'ok'
        );
      }

      // The direction the manifest carried, said once. A build that wrote it
      // means the Pre-directions box has nothing left to do — which is worth
      // knowing, because otherwise the obvious next move is to go and write
      // the same lines again by hand.
      const directions = report.scenario.directions?.length || 0;
      if (directions) {
        this.noteBuild(
          `${directions} pre-direction${directions === 1 ? '' : 's'} came with the set, from the manifest's `
            + '"direction" lines. The AI is handed the one for wherever the set has got to — '
            + 'press Load, then read them under Pre-directions.',
          'ok'
        );
      } else if (!report.stopped) {
        this.noteBuild(
          'No direction in this manifest, so the set carries none: the AI will improvise on the '
            + 'looks alone. Add "direction" to the show and to each look, or write them under '
            + 'Pre-directions.',
          'info'
        );
      }

      for (const entry of report.bound) {
        this.noteBuild(
          `"${entry.sceneName}" plays in section "${entry.sectionId}"${entry.inserted ? ' (a section was added for it)' : ''}.`,
          'ok'
        );
      }

      this.showTab('scenario');
    } catch (error) {
      this.showStatus.textContent = error?.message || String(error);
      this.showStatus.dataset.level = 'error';
    } finally {
      this.building = false;
      this.cancelBuild = false;
      this.buildButton.disabled = false;
      this.cancelButton.disabled = true;
      this.looksButton.disabled = false;
      this.paintStructure();
    }
  }

  saveManifest() {
    let manifest;
    try {
      manifest = this.readManifest();
    } catch (error) {
      this.showStatus.textContent = error.message;
      this.showStatus.dataset.level = 'error';
      return;
    }

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${(manifest.name || 'show').replace(/[^\w.-]+/g, '-')}.rzshow.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  openManifest() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.rzshow.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.manifestEditor.value = await file.text();
      this.showTab('show');
      this.checkManifest();
    });
    input.click();
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

    const authorRow = el('div', 'rz-perf-row');
    this.authorButton = button('Write a scenario', 'Ask the AI to draft a scenario from this brief',
      () => this.authorScenario(), 'rz-perf-btn rz-perf-author');
    authorRow.appendChild(this.authorButton);

    // The other direction: a set that exists, on a rig that has none of it.
    this.looksButton = button('Build the missing looks',
      'Generate a patch for every section with nothing to show, and install each one '
        + 'under the name the set already uses. What you have written above, if anything, '
        + 'is what ties them together.',
      () => this.buildMissingLooks(), 'rz-perf-btn rz-perf-author');
    authorRow.appendChild(this.looksButton);
    brief.appendChild(authorRow);
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
    this.paintDirector(status.director, status.directorHeldBy);
    this.paintMeterRows(status.signals);
    // Only when it is open: the rows are a read of the running scenario, and
    // nothing behind a hidden box is worth rebuilding on every change.
    if (this.preDirectionBox && !this.preDirectionBox.hidden) this.paintPreDirectionList();

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

    // The pre-directions, grouped by the section they are anchored to, in the
    // order they were written — which is the order they take effect in.
    const bySection = new Map();
    for (const direction of this.engine.scenario.directions) {
      if (!direction.at.section) continue;
      const list = bySection.get(direction.at.section);
      if (list) list.push(direction);
      else bySection.set(direction.at.section, [direction]);
    }

    this.engine.sections.forEach((section, index) => {
      const row = el('div', 'rz-perf-section');
      row.dataset.index = String(index);

      const name = el('div', 'rz-perf-section-name', section.name);
      row.appendChild(name);

      const enter = el('div', 'rz-perf-section-enter', describeEnter(section.enter));
      row.appendChild(enter);

      const look = el('div', 'rz-perf-section-look', describeLook(section.look));
      row.appendChild(look);

      // The pre-direction the AI is handed here, on the row for the section it
      // is anchored to. This is what "on the timeline" means from the front:
      // the set's direction is visible in the same list as its sections,
      // rather than only in the document.
      const directions = bySection.get(section.id);
      if (directions?.length) {
        const line = el('div', 'rz-perf-section-direction');
        line.textContent = directions.map((d) => d.text).join(' → ');
        line.title = directions
          .map((d) => `${describeDirectionAt(d.at)}: ${d.text}`)
          .join('\n');
        row.appendChild(line);
      }

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

  paintDirector(director, heldBy = null) {
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
    const why = cadence?.reason ? ` (${cadence.reason})` : '';
    // What the artist needs to see is which of the two is holding the next
    // question: the cadence, or the allowance. They mean different things —
    // one is the music being quiet, the other is the set running out of
    // budget — and only the second is worth doing anything about mid-set.
    const waitingOnBudget = cadence && cadence.budgetLeft < 1;
    const next = !cadence || !Number.isFinite(cadence.nextInSeconds)
      ? ''
      : waitingOnBudget
        ? `, allowance spent — next in ${cadence.budgetInSeconds}s`
        : `, next in ${cadence.nextInSeconds}s`;

    // `heldBy` outranks the cadence readout, because while something is
    // holding the director the cadence is describing a question that will
    // never be asked. "0 min, next in 0s" against a stopped transport is the
    // exact readout that made the switch look like it had worked.
    this.directorStatus.textContent = director.lastError
      ? director.lastError
      : !director.enabled
        ? 'off'
        : heldBy
          ? heldBy
          : director.thinking
            ? 'thinking…'
            : `${director.minutesSpent || 0} min${why}${next}`;
    this.directorStatus.dataset.error = director.lastError ? 'true' : 'false';
    this.directorStatus.dataset.held = heldBy ? 'true' : 'false';
    this.directorNote.textContent = director.lastNote || '';

    // Empty and hidden rather than a placeholder: a set with no pre-direction
    // is the ordinary case for someone standing at the laptop, and a line
    // saying so every night is a line nobody reads.
    const planned = director.preDirection || '';
    this.directorPlan.textContent = planned ? `Plan: ${planned}` : '';
    this.directorPlan.hidden = !planned;
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
    if (this.engine.state === STATE.RUNNING) {
      this.engine.pause();
      return;
    }
    if (!this.engine.start()) return;

    // The set drives the timeline from here on (PerformerEngine.enterSection
    // arms it, every tick moves it), and a transport that is moving behind a
    // closed panel is a transport nobody can read. Opened rather than
    // toggled: an artist who closed it during a set gets it back on the next
    // start, and nothing here ever closes it.
    if (this.engine.sections.some((section) => this.engine.sectionLengthSeconds(section) > 0)) {
      this.timelinePanel?.show?.();
    }
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
    if (key === 'scenario' && !this.editingScenario && !this.editorHoldsDraft) this.fillEditor(true);
    if (key === 'show' && !this.editingManifest && !this.manifestEditor.value) {
      this.manifestEditor.value = JSON.stringify(EXAMPLE_MANIFEST, null, 2);
    }
    // A set may have been loaded, or built, since the box was last looked at.
    if (key === 'show' && this.preDirectionBox && !this.preDirectionBox.hidden) {
      this.fillPreDirectionEditor();
    }
  }

  fillEditor(force = false) {
    if (this.editingScenario && !force) return;
    this.editor.value = JSON.stringify(this.engine.scenario, null, 2);
    this.editorReport.textContent = '';
    // Whatever was in there, it is the running scenario now.
    this.editorHoldsDraft = false;
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
    // Loaded: what is in the editor and what is running are the same document.
    this.editorHoldsDraft = false;
    // …including its direction, which a set built from a manifest arrives
    // carrying. Forced: nobody is typing in that box while pressing Load here.
    if (this.preDirectionBox) this.fillPreDirectionEditor(true);

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
      // How many beds the performer can reach. Zero is what makes "play the
      // bed" a line worth a warning rather than a line that will work.
      sounds: this.engine.executor?.sounds?.length ?? 0,
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
      this.editorHoldsDraft = true;
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

  /**
   * Build the looks this set is missing.
   *
   * The Show tab answers "I have the show in my head and an empty editor".
   * This answers the one that comes up after the first show and has had no
   * answer at all: "I have the set, and this rig has none of its scenes on
   * it." A scenario like that validates, loads and runs — and shows nothing,
   * section after section, because every look it names is a name and not a
   * patch.
   *
   * It is the same pipeline, entered from the other end. The set is read into
   * the manifest it implies (ShowBuilder.manifestFromScenario), a patch is
   * generated per section that has nothing to show, and each is installed
   * under the name that section already uses — so the set does not have to be
   * rewritten to play what was just built for it. The scenario is never
   * rewritten either: the artist's own drives, moves, cues and rules are the
   * reason they wrote it, and a look is not a reason to lose them.
   *
   * Two presses, deliberately. The Show tab has a Check button because a
   * manifest is typed and can be wrong; here the plan is derived from the
   * artist's own set and cannot be, so the button is its own Check. What it
   * cannot be is silent: this spends a patch-generator call per look, and a
   * misclick is a bad way to find out how many.
   */
  async buildMissingLooks() {
    const director = this.engine.director;
    if (!director) {
      this.authorStatus.textContent = 'The AI is not available in this build.';
      this.authorStatus.dataset.level = 'error';
      return;
    }

    // While this build is running, this button is the Stop for it. A call in
    // flight is already paid for, so it stops after the look being built now.
    if (this.building) {
      if (!this.buildingLooks) return;
      this.cancelBuild = true;
      this.authorStatus.textContent = 'Stopping after this look…';
      this.authorStatus.dataset.level = 'warn';
      return;
    }

    // What is in the editor, or the running set when the editor is empty —
    // the same thing Load acts on, so what is built is what can be read.
    const source = this.editor.value.trim();
    let scenario;
    try {
      scenario = source ? JSON.parse(source) : this.engine.scenario;
    } catch (error) {
      this.authorStatus.textContent = `That is not valid JSON: ${error.message}`;
      this.authorStatus.dataset.level = 'error';
      return;
    }

    const plan = manifestFromScenario(scenario, {
      sceneNames: this.rigSceneNames(),
      brief: this.briefInput.value.trim(),
    });

    if (!plan.missing.length) {
      this.pendingLooks = null;
      this.authorStatus.textContent = plan.satisfied.length || plan.skipped.length
        ? 'Every section already has a look. Nothing to build.'
        : 'This set has no sections to build looks for yet.';
      this.authorStatus.dataset.level = 'ok';
      return;
    }

    const signature = `${source}::${plan.missing.map((one) => one.lookId).join('|')}`;
    if (this.pendingLooks !== signature) {
      this.pendingLooks = signature;
      this.describePlan(plan);
      return;
    }
    this.pendingLooks = null;

    const executor = this.engine.executor;
    if (!executor?.sceneManager) {
      this.authorStatus.textContent =
        'There is nowhere to put the looks yet. Open the VJ panel (View → VJ Control) and try again.';
      this.authorStatus.dataset.level = 'error';
      return;
    }

    this.building = true;
    this.buildingLooks = true;
    this.cancelBuild = false;
    this.buildButton.disabled = true;
    this.authorButton.disabled = true;
    this.looksButton.textContent = 'Stop';

    const lines = [];
    const report = (level) => {
      this.editorReport.textContent = lines.join('\n');
      this.editorReport.dataset.level = level;
    };

    try {
      const built = await director.buildShow(plan.manifest, {
        // The set stays the artist's. Given one, the builder skips writing a
        // scenario entirely and only binds the looks into this.
        scenario,
        context: this.rigContext(),
        installScene: (name, patch, meta) => executor.installPatchAsScene(name, patch, meta),
        shouldStop: () => this.cancelBuild,
        onProgress: (event) => {
          this.authorStatus.textContent = event.message;
          this.authorStatus.dataset.level = 'info';
          if (event.phase !== 'look') return;
          if (event.status === 'ok') lines.push(`✓ ${event.message}`);
          else if (event.status === 'failed') lines.push(`× ${event.name}: ${event.message}`);
          report('info');
        },
      });

      // Into the editor as a draft, unloaded. Every other way of getting a
      // scenario in this panel lands here for the artist to read first, and a
      // set that starts playing because a build finished is exactly the
      // surprise this panel exists to avoid.
      this.editor.value = JSON.stringify(built.scenario, null, 2);
      this.editingScenario = false;
      this.editorHoldsDraft = true;

      const made = built.built.filter((entry) => entry.generated).length;
      const count = `${made} look${made === 1 ? '' : 's'}`;
      this.authorStatus.textContent = built.stopped
        ? `Stopped: ${built.stopped}. ${count} built and kept.`
        : `${count} built and bound into the set. Read it, then press Load.`;
      this.authorStatus.dataset.level = built.stopped || built.problems.length ? 'warn' : 'ok';

      for (const problem of built.problems) lines.push(`${problem.where}: ${problem.message}`);
      for (const entry of built.bound) {
        lines.push(`"${entry.sceneName}" plays in section "${entry.sectionId}".`);
      }
      report(built.problems.length ? 'warn' : 'ok');
    } catch (error) {
      this.authorStatus.textContent = error?.message || String(error);
      this.authorStatus.dataset.level = 'error';
    } finally {
      this.building = false;
      this.buildingLooks = false;
      this.cancelBuild = false;
      this.buildButton.disabled = false;
      this.authorButton.disabled = false;
      this.looksButton.textContent = 'Build the missing looks';
      this.paintStructure();
    }
  }

  /**
   * Every name a section's `scene` could resolve to, ids and names both.
   *
   * Read off the executor's scene manager rather than the VJ panel's. That is
   * the one ActionExecutor.resolveScene consults when a section is cut to at
   * showtime, so it is the only one that answers the question being asked
   * here: does this section have anything to show, or not.
   */
  rigSceneNames() {
    const manager = this.engine.executor?.sceneManager || this.vjPanel?.sceneManager;
    return (manager?.getAllScenes?.() || []).flatMap((scene) => [scene.id, scene.name]);
  }

  /** What the next press would spend, and on what. */
  describePlan(plan) {
    const n = plan.missing.length;
    this.authorStatus.textContent =
      `${n} look${n === 1 ? '' : 's'} to build: ${plan.missing.map((one) => `"${one.name}"`).join(', ')}. `
      + `That is ${n} patch call${n === 1 ? '' : 's'}. Press again to build.`;
    this.authorStatus.dataset.level = 'warn';

    this.editorReport.textContent = [
      ...plan.missing.map((one) => `"${one.name}" — section "${one.sectionId}" ${one.why}.`),
      ...plan.satisfied.map((one) => `"${one.name}" — already on the rig. Kept, and costs nothing.`),
      ...plan.skipped.map((one) => `"${one.name}" — skipped: it ${one.why}.`),
      ...plan.deferred.map((one) =>
        `"${one.name}" — not in this build: ${MANIFEST_LIMITS.looks} looks is as many as one build takes. `
        + 'Press again when this one is done.'),
    ].join('\n');
    this.editorReport.dataset.level = 'info';
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

/**
 * "on cue drop", "after 32 bars", "when energy > 0.7", and — where one is
 * written — the deadline that entry falls back to: "on cue “drop”, or by 24
 * bars".
 *
 * The deadline is shown rather than left in the JSON because it is the
 * difference between a section that might never be reached and one that will
 * be, and the section list is where an artist checks whether their set plays.
 */
function describeEnter(enter) {
  const by = enter?.by
    ? `, or by ${enter.by.bars !== null ? `${enter.by.bars} bars` : `${enter.by.seconds}s`}`
    : '';

  switch (enter?.kind) {
    case 'cue': return `on cue “${enter.cue}”${by}`;
    case 'bars': return `after ${enter.bars} bars`;
    case 'seconds': return `after ${enter.seconds}s`;
    case 'when': return `when ${enter.when}${by}`;
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
