// The Window menu: layouts, the hide-everything toggle, and the reset.
//
// src/ui/layoutManager.js is the one place that knows which panels exist and
// how each is opened, closed and asked whether it is open — the panels
// themselves were written at different times and none of them agree on that
// API. These tests are what keeps a preset from opening a tool window nobody
// asked for, and Reset Layout from forgetting a panel's remembered size.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { rememberDefaultGeometry } from '../src/ui/utils/panelGeometry.js';
import {
  LayoutManager,
  LAYOUT_PRESETS,
  PANEL_REGISTRY,
  CUSTOM_LAYOUT_KEY,
} from '../src/ui/layoutManager.js';

/** A panel with a boolean `visible` — the timeline / VJ shape. */
function visiblePanel(id) {
  const container = document.createElement('div');
  container.id = id;
  document.body.appendChild(container);
  return {
    visible: false,
    show() { this.visible = true; },
    hide() { this.visible = false; },
    toggle() { this.visible ? this.hide() : this.show(); },
  };
}

/** A panel with `isVisible` as a boolean — the preview / 3D viewport shape. */
function isVisiblePanel(id) {
  const panel = visiblePanel(id);
  return {
    isVisible: false,
    show() { this.isVisible = true; },
    hide() { this.isVisible = false; },
    _container: panel,
  };
}

/** A tool window with `isOpen` and open()/close() — the screens panel shape. */
function openClosePanel(id) {
  const container = document.createElement('div');
  container.id = id;
  document.body.appendChild(container);
  return {
    isOpen: false,
    open() { this.isOpen = true; },
    close() { this.isOpen = false; },
  };
}

describe('layout manager', () => {
  let manager;
  let preview;
  let timeline;
  let screens;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage?.clear?.();

    preview = isVisiblePanel('preview-panel');
    timeline = visiblePanel('timeline-panel');
    screens = openClosePanel('screens-panel');

    manager = new LayoutManager({
      registry: [
        { key: 'preview', label: 'Preview', kind: 'workspace', selector: '#preview-panel', get: () => preview },
        { key: 'timeline', label: 'Timeline', kind: 'workspace', selector: '#timeline-panel', get: () => timeline },
        { key: 'screens', label: 'Output Screens', kind: 'tool', selector: '#screens-panel', get: () => screens },
        // Never built: no element in the page, and get() would throw if the
        // manager ever reached for it.
        { key: 'ghost', label: 'Ghost', kind: 'tool', selector: '#ghost-panel', get: () => { throw new Error('built a panel nobody opened'); } },
      ],
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage?.clear?.();
  });

  it('reads open state off whichever flag a panel happens to use', () => {
    expect(manager.snapshot()).toEqual({});

    preview.isVisible = true;
    timeline.visible = true;
    screens.isOpen = true;

    expect(manager.snapshot()).toEqual({ preview: true, timeline: true, screens: true });
  });

  it('treats a window that was never built as closed, without building it', () => {
    expect(manager.snapshot().ghost).toBeUndefined();
    expect(() => manager.applyLayout('minimal')).not.toThrow();
  });

  it('reports the layout the workspace is in, not the row last pressed', () => {
    manager.applyLayout('default');
    expect(manager.currentLayout()).toBe('default');

    // A panel opened by hand is no longer any named layout, and the menu must
    // stop claiming one.
    timeline.visible = true;
    expect(manager.currentLayout()).toBeNull();

    timeline.visible = false;
    expect(manager.currentLayout()).toBe('default');

    manager.applySnapshot({});
    expect(manager.currentLayout()).toBe('minimal');
  });

  it('keeps the tick on the row you pressed when two layouts look alike', () => {
    manager.applyLayout('default');
    manager.saveCustomLayout();   // Custom is now the default arrangement
    expect(manager.currentLayout()).toBe('custom');

    manager.applyLayout('default');
    expect(manager.currentLayout()).toBe('default');
  });

  it('opens what a preset names and closes everything else', () => {
    timeline.visible = true;

    const result = manager.applyLayout('default');

    expect(preview.isVisible).toBe(true);
    expect(timeline.visible).toBe(false);
    expect(result.opened).toContain('Preview');
    expect(result.closed).toContain('Timeline');
    expect(manager.activeLayout).toBe('default');
  });

  it('leaves nothing open in the minimal layout', () => {
    preview.isVisible = true;
    timeline.visible = true;
    screens.isOpen = true;

    manager.applyLayout('minimal');

    expect(manager.snapshot()).toEqual({});
  });

  it('never opens a tool window from a preset', () => {
    // A layout that names a tool window still may not start one: opening the
    // AI dock or a collab session is the artist's call, not a layout's.
    manager.applySnapshot({ screens: true });
    expect(screens.isOpen).toBe(false);

    manager.applySnapshot({ screens: true }, { openTools: true });
    expect(screens.isOpen).toBe(true);
  });

  it('writes the custom layout from the workspace the first time it is applied', () => {
    timeline.visible = true;

    const first = manager.applyLayout('custom');

    expect(first.savedFromCurrent).toBe(true);
    expect(manager.hasCustomLayout()).toBe(true);
    // Saving must not also rearrange anything.
    expect(timeline.visible).toBe(true);

    timeline.visible = false;
    preview.isVisible = true;

    const second = manager.applyLayout('custom');

    expect(second.savedFromCurrent).toBe(false);
    expect(timeline.visible).toBe(true);
    expect(preview.isVisible).toBe(false);
  });

  it('restores a saved custom layout including its tool windows', () => {
    screens.isOpen = true;
    manager.saveCustomLayout();
    screens.isOpen = false;

    manager.applyLayout('custom');

    expect(screens.isOpen).toBe(true);
  });

  it('drops panels the registry no longer knows from a stored layout', () => {
    window.localStorage.setItem(
      CUSTOM_LAYOUT_KEY,
      JSON.stringify({ preview: true, retiredPanel: true }),
    );

    expect(manager.loadCustomLayout()).toEqual({ preview: true });
  });

  it('survives a corrupt stored layout', () => {
    window.localStorage.setItem(CUSTOM_LAYOUT_KEY, 'not json');

    expect(manager.loadCustomLayout()).toBeNull();
    expect(manager.applyLayout('custom').savedFromCurrent).toBe(true);
  });

  it('hides every window and puts back exactly the same ones', () => {
    preview.isVisible = true;
    screens.isOpen = true;

    const hidden = manager.toggleFloatingWindows();

    expect(hidden).toEqual({ visible: false, count: 2 });
    expect(manager.areFloatingWindowsHidden()).toBe(true);
    expect(manager.snapshot()).toEqual({});

    const shown = manager.toggleFloatingWindows();

    expect(shown.visible).toBe(true);
    expect(manager.areFloatingWindowsHidden()).toBe(false);
    // The tool window came back: it was open before the toggle closed it.
    expect(manager.snapshot()).toEqual({ preview: true, screens: true });
  });

  it('brings back the current layout when there is nothing to hide', () => {
    const result = manager.toggleFloatingWindows();

    expect(result.visible).toBe(true);
    expect(preview.isVisible).toBe(true);
    expect(manager.areFloatingWindowsHidden()).toBe(false);
  });

  it('forgets dragged positions, remembered sizes and stray layouts on reset', () => {
    const container = document.getElementById('preview-panel');
    // The window opened anchored to its corner by the stylesheet, then was
    // dragged; makeDraggable recorded the former.
    rememberDefaultGeometry(container);
    container.style.left = '900px';
    container.style.top = '700px';
    container.style.width = '1200px';
    window.localStorage.setItem('rhizo.previewPanelSize', JSON.stringify({ floating: { width: 999, height: 999 } }));
    window.localStorage.setItem(
      'glsl-node-editor.ai-panel.prefs',
      JSON.stringify({ width: 900, scope: 'selection' }),
    );
    timeline.visible = true;

    manager.resetLayout();

    expect(container.style.left).toBe('');
    expect(container.style.top).toBe('');
    expect(container.style.width).toBe('');
    expect(window.localStorage.getItem('rhizo.previewPanelSize')).toBeNull();
    // The dock's width goes, its unrelated settings stay.
    expect(JSON.parse(window.localStorage.getItem('glsl-node-editor.ai-panel.prefs'))).toEqual({
      scope: 'selection',
    });
    // And it lands in the default arrangement.
    expect(manager.activeLayout).toBe('default');
    expect(timeline.visible).toBe(false);
    expect(preview.isVisible).toBe(true);
  });

  it('puts an inline-positioned window back on its anchor instead of stripping it', () => {
    // The 3D viewport, the profiler overlay and the preferences window write
    // their whole box in JS. Clearing that leaves a `position: fixed` window
    // with nothing to hang off, so the reset restores the recorded values.
    const container = document.getElementById('preview-panel');
    container.style.top = '60px';
    container.style.right = '16px';
    container.style.width = '560px';
    rememberDefaultGeometry(container);

    container.style.top = '400px';
    container.style.right = '';
    container.style.left = '30px';
    container.style.width = '1100px';

    manager.resetLayout();

    expect(container.style.top).toBe('60px');
    expect(container.style.right).toBe('16px');
    expect(container.style.width).toBe('560px');
    expect(container.style.left).toBe('');
  });

  it('leaves a window that was never moved alone', () => {
    // Nothing recorded means nothing draggable: its geometry is the
    // stylesheet's, and a reset has no business touching it.
    const container = document.getElementById('timeline-panel');
    container.style.height = '320px';

    manager.resetLayout();

    expect(container.style.height).toBe('320px');
  });

  it('lets a panel that owns its geometry reset itself', () => {
    let resets = 0;
    const own = new LayoutManager({
      registry: [
        { key: 'preview', label: 'Preview', kind: 'workspace', get: () => preview, reset: () => { resets += 1; } },
      ],
    });

    own.resetLayout();

    expect(resets).toBe(1);
  });
});

describe('the real registry', () => {
  it('describes every window the Window menu can act on', () => {
    for (const entry of PANEL_REGISTRY) {
      expect(entry.key).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(['workspace', 'tool']).toContain(entry.kind);
      // Either it can be found in the page or it can be asked for directly;
      // an entry with neither can never be read.
      expect(entry.selector || typeof entry.get === 'function').toBeTruthy();
    }
  });

  it('binds no key twice', () => {
    const keys = PANEL_REGISTRY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only ever leaves the graph in the minimal layout', () => {
    expect(LAYOUT_PRESETS.minimal).toEqual({});
    // The default arrangement is workspace panels only — a boot that opens a
    // tool window is a boot that starts network work.
    for (const key of Object.keys(LAYOUT_PRESETS.default)) {
      const entry = PANEL_REGISTRY.find((item) => item.key === key);
      expect(entry?.kind).toBe('workspace');
    }
  });
});
