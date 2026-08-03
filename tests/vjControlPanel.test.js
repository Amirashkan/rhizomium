/**
 * Regression tests for the VJ control panel.
 *
 * Four things were broken in the panel as shipped:
 *   - applying a preset changed nothing (it wrote node.params only, then called
 *     editor.onGraphChanged(), a hook no editor defines, so nothing recompiled)
 *   - a playlist could only ever be given the scene that was already loaded, and
 *     a transition that threw left the manager latched so no scene would switch
 *   - the opacity and speed faders moved their labels and nothing else
 *   - the panel could not be dragged anywhere
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VJControlPanel } from '../src/vj/VJControlPanel.js';
import { PresetManager } from '../src/vj/PresetManager.js';
import { TransitionManager } from '../src/vj/TransitionManager.js';
import {
  resetOutputOpacity,
  getOutputOpacity,
  setMasterOpacity,
  setTransitionOpacity,
  onOutputOpacityChange,
} from '../src/vj/MasterOutput.js';

/**
 * Run frame callbacks inline against a virtual clock.
 *
 * The clock has to move with the frames: against the real one, a loop running
 * to a 10ms duration recurses thousands of times before it is done and blows
 * the stack on a fast machine. Stepping time per frame ends every loop here in
 * a handful of frames, deterministically.
 */
function runAnimationFramesInline({ stepMs = 8 } = {}) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);

  globalThis.requestAnimationFrame = (cb) => {
    now += stepMs;
    cb(now);
    return 0;
  };
  globalThis.cancelAnimationFrame = () => {};
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  }
}

function makeNode(id, kind, params = {}, extra = {}) {
  return { id, kind, params: { ...params }, inputs: [], ...extra };
}

function makeEditor(nodes = []) {
  return {
    graph: { nodes },
    onChange: vi.fn(),
    saveLoadManager: {
      exportProject: vi.fn(() => ({ nodes: [{ id: '1', kind: 'ConstFloat' }] })),
      importProject: vi.fn(async () => true)
    }
  };
}

function gpuCanvas() {
  let canvas = document.getElementById('gpu-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'gpu-canvas';
    document.body.appendChild(canvas);
  }
  return canvas;
}

function addScene(panel, name) {
  const id = `scene_${name}`;
  panel.sceneManager.addScene(id, { nodes: [] }, name);
  return id;
}

function buttonTitled(root, title) {
  return [...root.querySelectorAll('button')].find(b => b.title === title);
}

// The play/pause button renders a sprite icon, not a text glyph.
const playIcon = (panel) =>
  panel.playlistPlayBtn.querySelector('use')?.getAttribute('href');

// The beat indicator is four dots; the lit one is at full opacity. -1 = none lit.
const litBeat = (panel) =>
  [...panel.beatIndicator.children].findIndex((d) => d.style.opacity === '1');

describe('VJ panel stacking', () => {
  // happy-dom does not do stacking contexts, so assert the invariant at the
  // source: the panel has to out-rank the floating GPU preview. They were both
  // at 1000 and the preview - created after the panel - won the tie, covering
  // the VJ header so mousedown never reached it and the panel would not drag.
  const readSource = (relative) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  it('sits above the floating GPU preview but below open menus', () => {
    const css = readSource('../src/vj/vj-control-panel.css');
    const panelRule = css.slice(css.indexOf('.vj-control-panel {'));
    const panelZ = Number(/z-index:\s*(\d+)/.exec(panelRule)?.[1]);

    const preview = readSource('../src/ui/FloatingGPUPreview.js');
    const previewZ = Number(/z-index:\s*(\d+)/.exec(preview)?.[1]);

    expect(Number.isFinite(panelZ)).toBe(true);
    expect(Number.isFinite(previewZ)).toBe(true);
    expect(panelZ).toBeGreaterThan(previewZ);
    // .menu-dropdown.show lives at 1002 and must stay clickable over the panel.
    expect(panelZ).toBeLessThan(1002);
  });
});

describe('VJ presets', () => {
  beforeEach(() => {
    runAnimationFramesInline();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recompiles the shader when a preset is applied', () => {
    const node = makeNode('1', 'Noise', { scale: 1 });
    const editor = makeEditor([node]);
    const presets = new PresetManager(editor);

    const preset = presets.capturePreset('A');
    node.params.scale = 9;
    editor.onChange.mockClear();

    presets.applyPreset(preset.id, 0);

    expect(node.params.scale).toBe(1);
    expect(editor.onChange).toHaveBeenCalled();
  });

  it('captures and restores parameters that do not live in node.params', () => {
    // Scalar nodes keep their value on node.value and older graphs mirror into
    // node.props - capturing node.params alone skipped both.
    const scalar = makeNode('1', 'ConstFloat', {}, { value: 0.25 });
    const legacy = makeNode('2', 'Circle', {}, { props: { radius: 3 } });
    const editor = makeEditor([scalar, legacy]);
    const presets = new PresetManager(editor);

    const preset = presets.capturePreset('A');
    scalar.value = 99;
    legacy.props.radius = 99;

    presets.applyPreset(preset.id, 0);

    expect(scalar.value).toBe(0.25);
    expect(legacy.props.radius).toBe(3);
  });

  it('matches nodes whose ids are numbers against the preset string keys', () => {
    const node = makeNode(7, 'Noise', { scale: 1 });
    const editor = makeEditor([node]);
    const presets = new PresetManager(editor);

    const preset = presets.capturePreset('A');
    node.params.scale = 4;

    presets.applyPreset(preset.id, 0);

    expect(node.params.scale).toBe(1);
  });

  it('interpolates to the captured values and lands exactly on them', async () => {
    const node = makeNode('1', 'Noise', { scale: 0 });
    const editor = makeEditor([node]);
    const presets = new PresetManager(editor);

    const preset = presets.capturePreset('A');
    presets.presets.get(preset.id).parameterState['1'].params.scale = 10;

    await presets.applyPreset(preset.id, 0.01);

    expect(node.params.scale).toBe(10);
    expect(presets.activePresetId).toBe(preset.id);
  });

  it('falls back to window.rebuild when the editor has no onChange', () => {
    const node = makeNode('1', 'Noise', { scale: 1 });
    const editor = makeEditor([node]);
    delete editor.onChange;
    const rebuild = vi.fn();
    window.rebuild = rebuild;

    const presets = new PresetManager(editor);
    const preset = presets.capturePreset('A');
    node.params.scale = 5;
    presets.applyPreset(preset.id, 0);

    expect(node.params.scale).toBe(1);
    expect(rebuild).toHaveBeenCalled();
    delete window.rebuild;
  });
});

describe('VJ transitions', () => {
  beforeEach(() => {
    runAnimationFramesInline();
    resetOutputOpacity();
    gpuCanvas();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetOutputOpacity();
    document.body.innerHTML = '';
  });

  it('does not stay latched after a scene fails to load', async () => {
    const editor = makeEditor();
    editor.saveLoadManager.importProject = vi.fn(async () => {
      throw new Error('bad project');
    });
    const transitions = new TransitionManager(editor);

    await expect(transitions.startTransition({ nodes: [] }, 'cut', 0)).rejects.toThrow('bad project');
    expect(transitions.isTransitioning).toBe(false);

    // The next scene switch must still be allowed through.
    editor.saveLoadManager.importProject = vi.fn(async () => true);
    await expect(transitions.startTransition({ nodes: [] }, 'cut', 0)).resolves.toBe(true);
    expect(editor.saveLoadManager.importProject).toHaveBeenCalled();
  });

  it('lets a new transition take over from one already running', async () => {
    const editor = makeEditor();
    const transitions = new TransitionManager(editor);
    transitions.isTransitioning = true;

    await expect(transitions.startTransition({ nodes: [] }, 'cut', 0)).resolves.toBe(true);
    expect(transitions.isTransitioning).toBe(false);
  });

  it('leaves the master fader intact after a crossfade', async () => {
    const editor = makeEditor();
    const transitions = new TransitionManager(editor);
    const canvas = gpuCanvas();

    const panel = new VJControlPanel(makeEditor());
    panel.setMasterOpacity(0.4);

    await transitions.startTransition({ nodes: [] }, 'crossfade', 0.001);

    // Transition finished at full opacity, the fader is still at 40%.
    expect(getOutputOpacity()).toBeCloseTo(0.4, 5);
    expect(Number(canvas.style.opacity)).toBeCloseTo(0.4, 5);

    panel.container.remove();
  });
});

describe('VJ master fader reaching the second monitor', () => {
  // The mirror window renders its own frames from broadcast state, so the
  // editor's canvas opacity never applied to it - the fader stopped at the
  // editor. The level now travels over the channel.
  beforeEach(() => {
    runAnimationFramesInline();
    resetOutputOpacity();
    gpuCanvas();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetOutputOpacity();
    document.body.innerHTML = '';
  });

  it('notifies subscribers of the effective output level', () => {
    const seen = [];
    const unsubscribe = onOutputOpacityChange((v) => seen.push(v));

    setMasterOpacity(0.5);
    setTransitionOpacity(0.5);

    // Master × transition, not either one alone.
    expect(seen).toEqual([0.5, 0.25]);

    unsubscribe();
    setMasterOpacity(1);
    expect(seen).toHaveLength(2);
  });

  it('keeps notifying through a fade so the mirror tracks it frame by frame', () => {
    const seen = [];
    const unsubscribe = onOutputOpacityChange((v) => seen.push(v));

    setMasterOpacity(0.8);
    setTransitionOpacity(0);
    setTransitionOpacity(1);

    expect(seen).toEqual([0.8, 0, 0.8]);
    unsubscribe();
  });
});

describe('VJ control panel', () => {
  let panel;

  beforeEach(() => {
    // The beat clock is a rAF loop; inline frames would spin it forever, so
    // hand these tests a no-op scheduler and drive the clock explicitly.
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

    localStorage.clear();
    resetOutputOpacity();
    gpuCanvas();
    panel = new VJControlPanel(makeEditor());
    panel.show();
    // These cover playlist and transport behaviour, not fades - cut straight to
    // each scene so no frame-driven animation is involved. Fades have their own
    // describe above.
    panel.transitionDurationInput.value = '0';
  });

  afterEach(() => {
    panel.hide();
    localStorage.clear();
    resetOutputOpacity();
    delete window.renderLoop;
    delete window.floatingPreview;
    document.body.innerHTML = '';
  });

  it('queues any scene without loading it first', () => {
    const a = addScene(panel, 'A');
    const b = addScene(panel, 'B');
    panel.switchTab('scenes');

    // No active scene at all - this used to alert and refuse.
    expect(panel.sceneManager.activeSceneId).toBeNull();

    panel.addSceneToPlaylist(a);
    panel.addSceneToPlaylist(b);

    expect(panel.playlistManager.getPlaylist().map(i => i.sceneId)).toEqual([a, b]);
    expect(panel.editor.saveLoadManager.importProject).not.toHaveBeenCalled();
  });

  it('offers an add button on every scene card', () => {
    addScene(panel, 'A');
    addScene(panel, 'B');
    panel.switchTab('scenes');

    const cards = panel.scenesArea.querySelectorAll('.vj-scene-card');
    expect(cards).toHaveLength(2);

    cards.forEach(card => {
      buttonTitled(card, 'Add to playlist').click();
    });

    expect(panel.playlistManager.playlist).toHaveLength(2);
  });

  it('lists every scene in the playlist tab picker', () => {
    addScene(panel, 'A');
    addScene(panel, 'B');
    panel.switchTab('playlist');

    const options = [...panel.playlistSceneSelect.options].map(o => o.textContent);
    expect(options).toEqual(['A', 'B']);
    expect(panel.playlistSceneSelect.disabled).toBe(false);
  });

  it('keeps the transport honest when the playlist is empty', async () => {
    panel.switchTab('playlist');

    await panel.togglePlaylist();

    expect(panel.playlistManager.isPlaying).toBe(false);
    expect(playIcon(panel)).toBe('#icon-play');
    expect(panel.playlistPlayBtn.disabled).toBe(true);
  });

  it('rewinds on stop so play starts the sequence again', async () => {
    const a = addScene(panel, 'A');
    const b = addScene(panel, 'B');
    panel.addSceneToPlaylist(a);
    panel.addSceneToPlaylist(b);

    await panel.playlistManager.play(0);
    expect(panel.playlistManager.currentIndex).toBe(0);

    panel.stopPlaylist();
    expect(panel.playlistManager.currentIndex).toBe(-1);

    await panel.togglePlaylist();
    expect(panel.playlistManager.currentIndex).toBe(0);
  });

  it('drives the output opacity from the master fader', () => {
    const canvas = gpuCanvas();

    panel.opacitySlider.value = '35';
    panel.opacitySlider.oninput();

    expect(panel.masterOpacity).toBeCloseTo(0.35, 5);
    expect(Number(canvas.style.opacity)).toBeCloseTo(0.35, 5);
    expect(panel.opacityValue.textContent).toBe('35%');
  });

  it('drives the render loop time scale from the speed fader', () => {
    const setTimeScale = vi.fn();
    window.renderLoop = { setTimeScale, renderNow: vi.fn() };

    panel.speedSlider.value = '150';
    panel.speedSlider.oninput();

    expect(panel.playbackSpeed).toBeCloseTo(1.5, 5);
    expect(setTimeScale).toHaveBeenCalledWith(1.5);
    expect(window.timeScale).toBeCloseTo(1.5, 5);
    expect(panel.speedValue.textContent).toBe('1.50x');
  });

  it('prefers the preview settings path for speed when it exists', () => {
    const updateSetting = vi.fn();
    window.floatingPreview = { settings: { updateSetting } };

    panel.speedSlider.value = '50';
    panel.speedSlider.oninput();

    expect(updateSetting).toHaveBeenCalledWith('timeScale', 0.5);
  });

  it('moves when dragged by its header', () => {
    panel.container.style.left = '16px';
    panel.container.style.top = '100px';

    panel.header.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: 50, clientY: 120
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: 250, clientY: 320
    }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(panel.container.style.left).not.toBe('16px');
    expect(panel.container.style.top).not.toBe('100px');
  });

  it('sets a playlist item duration without jumping to that scene', () => {
    const a = addScene(panel, 'A');
    panel.addSceneToPlaylist(a);
    panel.switchTab('playlist');

    const row = panel.playlistItems.querySelector('.vj-playlist-item');
    const durationInput = row.querySelector('.vj-input-tiny');
    // Scenes carry their own duration; this one has no timeline, so 10.
    expect(durationInput.value).toBe('10');

    const jumpTo = vi.spyOn(panel.playlistManager, 'jumpTo');

    durationInput.value = '8';
    durationInput.dispatchEvent(new Event('change', { bubbles: true }));
    durationInput.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(panel.playlistManager.playlist[0].duration).toBe(8);
    expect(jumpTo).not.toHaveBeenCalled();
  });

  it('changes a playlist item transition without jumping to that scene', () => {
    const a = addScene(panel, 'A');
    panel.addSceneToPlaylist(a);
    panel.switchTab('playlist');

    const select = panel.playlistItems.querySelector('.vj-select-tiny');
    expect(select.value).toBe('crossfade');

    const jumpTo = vi.spyOn(panel.playlistManager, 'jumpTo');

    select.value = 'fade_black';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(panel.playlistManager.playlist[0].transitionType).toBe('fade_black');
    expect(jumpTo).not.toHaveBeenCalled();
  });

  it('rejects a nonsense duration and puts the field back', () => {
    const a = addScene(panel, 'A');
    panel.addSceneToPlaylist(a);
    panel.switchTab('playlist');

    const durationInput = panel.playlistItems.querySelector('.vj-input-tiny');
    durationInput.value = '-4';
    durationInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(panel.playlistManager.playlist[0].duration).toBe(10);
    expect(durationInput.value).toBe('10');
  });

  it('does not rebuild the rows while a field is being edited', () => {
    const a = addScene(panel, 'A');
    panel.addSceneToPlaylist(a);
    panel.switchTab('playlist');

    const durationInput = panel.playlistItems.querySelector('.vj-input-tiny');
    durationInput.focus();

    panel.syncPlaylistUI();

    // Same element, not a replacement built underneath the caret.
    expect(panel.playlistItems.querySelector('.vj-input-tiny')).toBe(durationInput);
  });

  it('runs the beat clock while open and stops it when closed', () => {
    expect(panel.beatSyncManager.isPlaying).toBe(true);

    panel.hide();
    expect(panel.beatSyncManager.isPlaying).toBe(false);

    panel.show();
    expect(panel.beatSyncManager.isPlaying).toBe(true);
  });

  it('lights the beat indicator from the clock', () => {
    panel.beatSyncManager.syncToBeat(2);
    expect(litBeat(panel)).toBe(2);
  });

  it('snaps the BPM field back when given an impossible tempo', () => {
    panel.bpmInput.value = '900';
    panel.bpmInput.onchange();

    expect(panel.beatSyncManager.bpm).toBe(120);
    expect(panel.bpmInput.value).toBe('120');
  });

  it('saves and restores presets and the playlist', () => {
    const a = addScene(panel, 'A');
    panel.addSceneToPlaylist(a);
    panel.playlistManager.updatePlaylistItem(0, { duration: 12 });
    panel.presetManager.capturePreset('Drop');
    panel.playlistManager.loop = false;

    expect(panel.saveToStorage()).toBe(true);

    // A fresh panel is what a page reload gives you.
    const reloaded = new VJControlPanel(makeEditor());

    expect(reloaded.presetManager.getAllPresets().map(p => p.name)).toEqual(['Drop']);
    expect(reloaded.playlistManager.getPlaylist().map(i => i.duration)).toEqual([12]);
    expect(reloaded.playlistManager.loop).toBe(false);
    expect(reloaded.playlistLoopCheck.checked).toBe(false);

    reloaded.container.remove();
  });

  it('keeps a note against each scene', () => {
    addScene(panel, 'A');
    addScene(panel, 'B');
    panel.switchTab('scenes');

    const cards = [...panel.scenesArea.querySelectorAll('.vj-scene-card')];
    const notes = cards.map(c => c.querySelector('.vj-scene-notes'));
    expect(notes.filter(Boolean)).toHaveLength(2);

    const switchToScene = vi.spyOn(panel, 'switchToScene');

    notes[0].value = 'build - drop at 2:10';
    notes[0].dispatchEvent(new Event('change', { bubbles: true }));
    notes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(panel.sceneManager.getScene('scene_A').notes).toBe('build - drop at 2:10');
    // Typing in the note must not load the scene the card belongs to.
    expect(switchToScene).not.toHaveBeenCalled();
  });

  it('shows a saved note when the scene list is redrawn', () => {
    const a = addScene(panel, 'A');
    panel.sceneManager.updateSceneMetadata(a, { notes: 'strobe heavy' });
    panel.switchTab('scenes');

    const note = panel.scenesArea.querySelector('.vj-scene-notes');
    expect(note.value).toBe('strobe heavy');
  });

  it('carries scene notes through a save and reload', () => {
    const a = addScene(panel, 'A');
    panel.sceneManager.updateSceneMetadata(a, { notes: 'opener' });
    expect(panel.saveToStorage()).toBe(true);

    const reloaded = new VJControlPanel(makeEditor());
    expect(reloaded.sceneManager.getScene(a).notes).toBe('opener');
    reloaded.container.remove();
  });

  it('stops the beat clock when beat sync is switched off', () => {
    expect(panel.beatSyncManager.isPlaying).toBe(true);

    panel.beatEnabledCheck.checked = false;
    panel.beatEnabledCheck.onchange();

    expect(panel.beatSyncManager.isPlaying).toBe(false);
    expect(panel.bpmInput.disabled).toBe(true);
    expect(panel.tapBtn.disabled).toBe(true);
    expect(litBeat(panel)).toBe(-1);
    expect(panel.beatIndicator.classList.contains('disabled')).toBe(true);
  });

  it('leaves the clock off across close and reopen while disabled', () => {
    panel.setBeatSyncEnabled(false);

    panel.hide();
    panel.show();

    expect(panel.beatSyncManager.isPlaying).toBe(false);
  });

  it('ignores tap tempo while beat sync is off', () => {
    panel.setBeatSyncEnabled(false);
    const tap = vi.spyOn(panel.beatSyncManager, 'tap');

    panel.tapTempo();

    expect(tap).not.toHaveBeenCalled();
  });

  it('brings the clock back when beat sync is switched on again', () => {
    panel.setBeatSyncEnabled(false);
    panel.setBeatSyncEnabled(true);

    expect(panel.beatSyncManager.isPlaying).toBe(true);
    expect(panel.bpmInput.disabled).toBe(false);
    expect(panel.beatIndicator.classList.contains('disabled')).toBe(false);
  });

  it('remembers the beat sync switch and tempo across a reload', () => {
    panel.bpmInput.value = '141';
    panel.bpmInput.onchange();
    panel.setBeatSyncEnabled(false);
    expect(panel.saveToStorage()).toBe(true);

    const reloaded = new VJControlPanel(makeEditor());
    reloaded.show();

    expect(reloaded.beatSyncEnabled).toBe(false);
    expect(reloaded.beatSyncManager.bpm).toBe(141);
    expect(reloaded.beatSyncManager.isPlaying).toBe(false);
    expect(reloaded.bpmInput.value).toBe('141');

    reloaded.hide();
    reloaded.container.remove();
  });

  it('does not start a drag from the close button', () => {
    const closeBtn = panel.container.querySelector('.vj-close-btn');
    panel.container.style.left = '16px';

    closeBtn.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: 50, clientY: 120
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: 250, clientY: 320
    }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(panel.container.style.left).toBe('16px');
  });
});
