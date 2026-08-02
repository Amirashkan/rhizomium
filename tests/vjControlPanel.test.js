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
import { resetOutputOpacity, getOutputOpacity } from '../src/vj/MasterOutput.js';

// happy-dom has no rAF budget of its own worth waiting on; run callbacks
// immediately so the fade/interpolation loops finish inside the test.
function runAnimationFramesInline() {
  globalThis.requestAnimationFrame = (cb) => {
    cb(performance.now());
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

describe('VJ control panel', () => {
  let panel;

  beforeEach(() => {
    runAnimationFramesInline();
    resetOutputOpacity();
    gpuCanvas();
    panel = new VJControlPanel(makeEditor());
    panel.show();
  });

  afterEach(() => {
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
    expect(panel.playlistPlayBtn.textContent).toBe('▶');
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
