/**
 * layoutManager.js — the Window menu: what is open, where it sits, and how to
 * get back to an arrangement you recognise.
 *
 * Every panel in the editor is its own little window with its own show/hide,
 * its own position and, for a few of them, its own remembered size. That is
 * fine while you are opening one panel at a time and useless the moment you
 * want the whole workspace in a known state — before a show, after an
 * experiment, or when a panel has been dragged somewhere you can no longer
 * reach it. The five Window rows are that missing level: they act on the
 * arrangement rather than on any one panel.
 *
 *   Layouts → Default   the arrangement the editor boots with
 *   Layouts → Custom    the arrangement you saved
 *   Layouts → Minimal   nothing but the node graph
 *   Floating Windows    hide everything / put back exactly what was there
 *   Reset Layout        default arrangement AND default positions and sizes
 *
 * One registry (PANEL_REGISTRY) is what makes that possible: it is the only
 * place that knows which windows exist and how each one is opened, closed,
 * asked whether it is open, and put back where it started. The panels
 * themselves are left alone — they were written at different times and their
 * APIs differ (`isVisible` is a boolean on one and a method on the next,
 * `visible`, `isOpen` and `open` all appear), so the probes below read
 * whichever shape a panel actually has instead of a normalising rewrite of a
 * dozen files.
 *
 * Two rules keep the presets honest:
 *
 *   - A layout never *opens* a tool window. Opening the AI dock or the collab
 *     panel starts network work and entitlement checks; a layout preset is a
 *     view of the workspace, not a reason to sign in. Presets close them, and
 *     Floating Windows re-opens whatever it hid — but nothing here opens a
 *     tool window you did not open yourself.
 *   - Reset Layout restores geometry that was *recorded*, never geometry it
 *     guessed. Half these panels are placed by a stylesheet and half write
 *     their whole box inline in JS, so "clear the inline styles" fixes one
 *     half and strands the other; utils/panelGeometry.js records what each
 *     window opened with instead.
 *   - A window that has never been built is left alone. A panel that exists
 *     only as a class nobody has instantiated is already closed, and
 *     constructing one to ask would build DOM for a window nobody opened, so
 *     the registry treats "no root element in the page" as closed.
 */

import { setRightDockWidth } from './dockLayout.js';
import { restoreDefaultGeometry } from './utils/panelGeometry.js';
import { getAIPanel } from './AIPanel.js';
import { getReviewPanel } from './ReviewPanel.js';
import { getCollabPanel } from './CollabPanel.js';
import { getShaderCompilerWindow } from './ShaderCompilerWindow.js';
import { getAudioSettingsPanel } from './AudioSettingsPanel.js';

/** The arrangement the user saved with Window → Layouts → Save Current. */
export const CUSTOM_LAYOUT_KEY = 'rhizo.layout.custom';

/**
 * Sizes a panel remembers for itself. The panels reset these themselves when
 * they are open (see their resetGeometry methods); this list is what clears
 * them for a panel that has not been built this session and so cannot be
 * asked.
 */
const PANEL_SIZE_KEYS = [
  'rhizo.previewPanelSize',
  'glsl-node-editor.parameter-panel.size',
];

/**
 * Docks remember a width inside a preferences blob that also holds settings a
 * layout has no business touching (the AI dock's scope switch, for one), so
 * Reset Layout deletes the width field rather than the key.
 */
const DOCK_PREF_KEYS = [
  'glsl-node-editor.ai-panel.prefs',
  'glsl-node-editor.review-panel.prefs',
];

const el = (selector) =>
  (typeof document !== 'undefined' && document.querySelector(selector)) || null;

/** An open() that returns a promise must not reject into a layout change. */
function settle(result) {
  if (result && typeof result.then === 'function') result.catch(() => {});
}

function forgetStorage(key) {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // A browser refusing storage has nothing stored to forget.
  }
}

/** Drop just the remembered width out of a panel's preferences blob. */
function forgetStoredWidth(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (!prefs || typeof prefs !== 'object' || !('width' in prefs)) return;
    delete prefs.width;
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Corrupt or unavailable storage: the next load falls back to defaults
    // anyway, which is exactly what a reset wants.
  }
}

// ---------------------------------------------------------------------------
// Reading and driving a panel whose API we did not choose
// ---------------------------------------------------------------------------

function readOpenFlag(panel) {
  if (!panel) return false;
  if (typeof panel.isVisible === 'function') return !!panel.isVisible();
  if (typeof panel.isVisible === 'boolean') return panel.isVisible;
  if (typeof panel.visible === 'boolean') return panel.visible;
  if (typeof panel.isOpen === 'boolean') return panel.isOpen;
  // `open` is a boolean on the collab panel and a method on the screens panel,
  // so it only counts as state when it is actually state.
  if (typeof panel.open === 'boolean') return panel.open;
  return false;
}

function callOpen(panel) {
  if (!panel) return;
  if (typeof panel.show === 'function') return settle(panel.show());
  if (typeof panel.open === 'function') return settle(panel.open());
  if (typeof panel.toggle === 'function') return settle(panel.toggle());
}

function callClose(panel) {
  if (!panel) return;
  if (typeof panel.hide === 'function') return settle(panel.hide());
  if (typeof panel.close === 'function') return settle(panel.close());
  if (typeof panel.toggle === 'function') return settle(panel.toggle());
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
//
// entry = {
//   key       stable name a saved layout is written in terms of
//   label     what the status line calls the window
//   kind      'workspace' — part of the arrangement a preset describes
//             'tool'      — opened for a task; presets close it, never open it
//   selector  the window's root element, and the proof it has been built
//   get()     the instance, or null when nothing has built it yet
//   isOpen()  overrides the probes above
//   open()    overrides the probes above
//   close()   overrides the probes above
//   reset()   put the window's own remembered geometry back to defaults
// }

/** The node selected right now, when exactly one is — the params panel's subject. */
function singleSelectedNode() {
  const editor = typeof window !== 'undefined' ? window.editor : null;
  const selected = editor?.selection?.getSelected?.();
  if (!selected || selected.size !== 1) return null;
  const nodeId = selected.values().next().value;
  return editor?.graph?.nodes?.find((node) => node.id === nodeId) || null;
}

export const PANEL_REGISTRY = [
  {
    key: 'preview',
    label: 'Preview',
    kind: 'workspace',
    get: () => window.floatingPreview || null,
    reset: () => window.floatingPreview?.resetGeometry?.(),
  },
  {
    key: 'params',
    label: 'ParamPanel',
    kind: 'workspace',
    // The live panel is the one ParameterPanel builds for itself. (The
    // `#param-panel` div in editor/index.html is a leftover nothing renders
    // into — reading it says every panel is open and closing it does nothing.)
    selector: '#parameter-panel',
    get: () => window.editor?.paramPanel || null,
    open: () => {
      const paramPanel = window.editor?.paramPanel;
      const node = singleSelectedNode();
      // With one node selected the panel opens onto it. With nothing selected
      // there are no parameters to show, but a layout still asked for the
      // panel, so it opens empty rather than not at all — the same thing
      // View → Toggle ParamPanel does.
      if (node && typeof paramPanel?.showNodeParameters === 'function') {
        paramPanel.showNodeParameters(node);
      } else if (paramPanel?.panel) {
        paramPanel.panel.style.display = 'flex';
      }
    },
    reset: () => window.editor?.paramPanel?.resetGeometry?.(),
  },
  {
    key: 'console',
    label: 'Console',
    kind: 'workspace',
    selector: '#code-console',
    isOpen: () => {
      const node = el('#code-console');
      return !!node && !node.classList.contains('closed');
    },
    // Driven through its menu row rather than the class: main.js owns the
    // row's label ("Show Console" / "Hide Console") and toggling the class
    // behind its back leaves the menu lying about the state.
    open: () => clickConsoleRowIf(false),
    close: () => clickConsoleRowIf(true),
  },
  {
    key: 'timeline',
    label: 'Timeline',
    kind: 'workspace',
    selector: '#timeline-panel',
    get: () => window.timelinePanel || null,
    // Docked across the bottom: its height is JS state, not inline geometry.
    reset: () => window.timelinePanel?.resetGeometry?.(),
  },
  {
    key: 'vj',
    label: 'VJ Control',
    kind: 'workspace',
    selector: '#vj-control-panel',
    get: () => window.vjControlPanel || null,
  },
  {
    key: 'viewport3d',
    label: '3D Viewport',
    kind: 'workspace',
    selector: '#viewport3d-panel',
    get: () => window.viewportPanel || null,
  },
  {
    key: 'profiler',
    label: 'Compute Profiler',
    kind: 'workspace',
    selector: '#compute-profiler-overlay',
    get: () => window.profilerOverlay || null,
  },
  {
    key: 'shaderCompiler',
    label: 'Shader Compiler',
    kind: 'tool',
    selector: '#shader-compiler-window',
    get: () => getShaderCompilerWindow(),
  },
  {
    key: 'previewExportSettings',
    label: 'Preview / Export Settings',
    kind: 'tool',
    selector: '#preview-export-settings-window',
    get: () => window.previewExportSettingsWindow || null,
  },
  {
    key: 'preferences',
    label: 'Preferences',
    kind: 'tool',
    selector: '#preferences-window',
    get: () => window.preferencesWindow || null,
  },
  {
    key: 'mapping',
    label: 'Projection Mapping',
    kind: 'tool',
    selector: '#mapping-panel',
    get: () => window.mappingPanel || null,
  },
  {
    key: 'screens',
    label: 'Output Screens',
    kind: 'tool',
    selector: '#screens-panel',
    get: () => window.screensPanel || null,
  },
  {
    key: 'audio',
    label: 'Audio',
    kind: 'tool',
    selector: '#audio-settings-panel',
    get: () => getAudioSettingsPanel(),
  },
  {
    key: 'midi',
    label: 'MIDI Settings',
    kind: 'tool',
    selector: '#midi-settings-panel',
    get: () => window.midiSettingsPanel || null,
  },
  {
    key: 'osc',
    label: 'OSC Receiver',
    kind: 'tool',
    selector: '#osc-settings-panel',
    get: () => window.oscSettingsPanel || null,
  },
  {
    key: 'ai',
    label: 'AI Assistant',
    kind: 'tool',
    selector: '.ai-dock',
    get: () => getAIPanel(),
  },
  {
    key: 'review',
    label: 'Patch Review',
    kind: 'tool',
    selector: '.review-dock',
    get: () => getReviewPanel(),
  },
  {
    key: 'collab',
    label: 'Collab Space',
    kind: 'tool',
    selector: '.rz-collab',
    get: () => getCollabPanel(),
  },
];

/** Click the console's menu row, but only when it would change the state. */
function clickConsoleRowIf(isOpenNow) {
  const node = el('#code-console');
  if (!node) return;
  if (node.classList.contains('closed') === isOpenNow) return;
  el('#btn-toggle-console')?.click();
}

/**
 * The arrangements the Layouts submenu offers, as the set of windows each one
 * leaves open. Anything absent is closed — a preset is the whole arrangement,
 * not a list of things to add to whatever was already there.
 */
export const LAYOUT_PRESETS = {
  // What the editor boots into: the render over the graph.
  //
  // Not the parameter panel, deliberately. That panel follows the selection —
  // EventHandler closes it on the next click anywhere unless a node is still
  // selected — so a preset that opened it would be undone by the click that
  // dismissed the menu. It is still in the registry: a layout can close it,
  // and a Custom layout saved while a node is selected restores it.
  default: { preview: true },
  // Nothing but the graph. For a projector, a screenshot, or a wide patch.
  minimal: {},
};

export class LayoutManager {
  constructor({ registry = PANEL_REGISTRY } = {}) {
    this.registry = registry;
    /** Which preset the workspace was last put into, for the menu's tick. */
    this.activeLayout = null;
    /** What Floating Windows hid, so the same windows come back. */
    this.hiddenByToggle = null;
  }

  entry(key) {
    return this.registry.find((item) => item.key === key) || null;
  }

  /** Has this window ever been built? A window that has not is closed. */
  isBuilt(entry) {
    if (!entry.selector) return !!entry.get?.();
    return !!el(entry.selector);
  }

  isOpen(entry) {
    if (typeof entry.isOpen === 'function') return !!entry.isOpen();
    if (!this.isBuilt(entry)) return false;
    return readOpenFlag(entry.get?.());
  }

  openPanel(entry) {
    if (this.isOpen(entry)) return;
    if (typeof entry.open === 'function') return entry.open();
    callOpen(entry.get?.());
  }

  closePanel(entry) {
    if (!this.isOpen(entry)) return;
    if (typeof entry.close === 'function') return entry.close();
    // Nothing built means nothing open, so this never constructs a panel just
    // to close it.
    if (!this.isBuilt(entry)) return;
    callClose(entry.get?.());
  }

  /**
   * Which named layout the workspace is actually in, or null once a panel has
   * been opened or closed by hand.
   *
   * The menu's tick is painted from this rather than from whichever row was
   * clicked last: panels are opened and closed from everywhere — their own
   * close buttons, the View menu, shortcuts — and a tick that survives all of
   * that is a tick that lies.
   *
   * The layout that was applied wins any tie, so saving the default
   * arrangement as your Custom layout does not move the tick off the row you
   * just pressed.
   */
  currentLayout() {
    const open = this.snapshot();
    const named = { ...LAYOUT_PRESETS };
    const custom = this.loadCustomLayout();
    if (custom) named.custom = custom;

    // A preset can name a panel this session does not have — the compute
    // profiler never exists without a GPU device — and a layout that opened
    // everything it could is still that layout.
    const known = new Set(this.registry.map((entry) => entry.key));
    const matches = (layout) => {
      const keys = Object.keys(layout).filter((key) => known.has(key));
      return keys.length === Object.keys(open).length && keys.every((key) => open[key]);
    };

    if (this.activeLayout && named[this.activeLayout] && matches(named[this.activeLayout])) {
      return this.activeLayout;
    }
    return Object.keys(named).find((name) => matches(named[name])) || null;
  }

  /** What is open right now, as a layout can be written down. */
  snapshot() {
    const state = {};
    for (const entry of this.registry) {
      if (this.isOpen(entry)) state[entry.key] = true;
    }
    return state;
  }

  /**
   * Make the workspace match `state`: open what it names, close what it does
   * not. Tool windows are only ever closed from here unless `openTools` says
   * otherwise — see the header.
   */
  applySnapshot(state, { openTools = false } = {}) {
    const opened = [];
    const closed = [];
    for (const entry of this.registry) {
      const wanted = !!state?.[entry.key];
      const isOpen = this.isOpen(entry);
      if (wanted === isOpen) continue;
      if (wanted) {
        if (entry.kind === 'tool' && !openTools) continue;
        this.openPanel(entry);
        opened.push(entry.label);
      } else {
        this.closePanel(entry);
        closed.push(entry.label);
      }
    }
    return { opened, closed };
  }

  // -- layouts --------------------------------------------------------------

  loadCustomLayout() {
    try {
      const raw = window.localStorage?.getItem(CUSTOM_LAYOUT_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      // Only keys the registry still knows about: a panel can be renamed or
      // removed between the save and the restore.
      const state = {};
      for (const entry of this.registry) {
        if (parsed[entry.key]) state[entry.key] = true;
      }
      return state;
    } catch {
      return null;
    }
  }

  saveCustomLayout(state = this.snapshot()) {
    try {
      window.localStorage?.setItem(CUSTOM_LAYOUT_KEY, JSON.stringify(state));
    } catch {
      // Private-mode storage refusals cost the artist the next session's
      // layout, not this one's.
    }
    this.activeLayout = 'custom';
    return state;
  }

  hasCustomLayout() {
    return this.loadCustomLayout() !== null;
  }

  /**
   * Put the workspace into a named layout.
   *
   * "Custom" with nothing saved yet saves the current arrangement instead of
   * applying an empty one — the first use of the row defines what it means,
   * which beats a row that silently does nothing.
   *
   * @returns {{layout: string, savedFromCurrent: boolean, opened: string[], closed: string[]}}
   */
  applyLayout(name) {
    if (name === 'custom') {
      const stored = this.loadCustomLayout();
      if (!stored) {
        this.saveCustomLayout();
        return { layout: 'custom', savedFromCurrent: true, opened: [], closed: [] };
      }
      const changed = this.applySnapshot(stored, { openTools: true });
      this.activeLayout = 'custom';
      this.hiddenByToggle = null;
      return { layout: 'custom', savedFromCurrent: false, ...changed };
    }

    const preset = LAYOUT_PRESETS[name];
    if (!preset) return null;
    const changed = this.applySnapshot(preset);
    this.activeLayout = name;
    this.hiddenByToggle = null;
    return { layout: name, savedFromCurrent: false, ...changed };
  }

  // -- floating windows -----------------------------------------------------

  areFloatingWindowsHidden() {
    return this.hiddenByToggle !== null;
  }

  /**
   * Clear the workspace, or put it back exactly as it was.
   *
   * Unlike Minimal — which is a destination — this remembers what it closed,
   * including tool windows, so the second press restores the same windows.
   * Pressed with nothing open and nothing remembered it brings back the
   * current layout, so the row is never a no-op.
   *
   * @returns {{visible: boolean, count: number}} the state it left behind
   */
  toggleFloatingWindows() {
    if (this.hiddenByToggle) {
      const restored = this.hiddenByToggle;
      this.hiddenByToggle = null;
      const changed = this.applySnapshot(restored, { openTools: true });
      return { visible: true, count: changed.opened.length };
    }

    const open = this.snapshot();
    const count = Object.keys(open).length;
    if (count === 0) {
      const result = this.applyLayout(this.activeLayout || 'default');
      return { visible: true, count: result?.opened.length ?? 0 };
    }

    this.hiddenByToggle = open;
    const changed = this.applySnapshot({});
    return { visible: false, count: changed.closed.length };
  }

  // -- reset ----------------------------------------------------------------

  /**
   * Everything back to how the editor ships: default arrangement, and every
   * window at the position and size its stylesheet gives it.
   *
   * The order matters. Geometry is reset first so a panel that stays open is
   * moved rather than left where it was, and the layout is applied afterwards
   * so anything the reset re-opened lands in the right state.
   */
  resetLayout() {
    for (const entry of this.registry) {
      if (typeof entry.reset === 'function') {
        entry.reset();
      } else if (entry.selector) {
        // Whatever the window opened with, recorded by makeDraggable /
        // makeResizable before the first drag (see utils/panelGeometry.js).
        // A window with nothing recorded cannot be moved in the first place,
        // and clearing its inline geometry would only strip the anchor it is
        // positioned by.
        restoreDefaultGeometry(el(entry.selector));
      }
    }

    for (const key of PANEL_SIZE_KEYS) forgetStorage(key);
    for (const key of DOCK_PREF_KEYS) forgetStoredWidth(key);

    this.hiddenByToggle = null;
    const changed = this.applyLayout('default');

    // Docks inset the canvases; with every dock closed the canvases get the
    // whole window back. Panels that are still open re-assert their own inset.
    setRightDockWidth(0);

    return changed;
  }
}

let instance = null;

/** The editor's one layout manager. */
export function getLayoutManager() {
  if (!instance) instance = new LayoutManager();
  return instance;
}

/** Tests build their own; this drops the singleton between them. */
export function resetLayoutManagerForTests() {
  instance = null;
}
