// The menu rows that carry their panel's state in their label.
//
// "Timeline ✓", "Hide Console", "Audio ✓" — each of these used to be written
// by the row's own click handler, which made it true only while the row was
// the only thing that moved the panel. It never is: the panel's own close
// button, a shortcut and Window → Layouts all move it too. These tests are
// what keeps the labels derived from the panels instead.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MENU_TOGGLE_ROWS,
  paintMenuToggleRows,
  installMenuToggleRowPainting,
} from '../src/ui/menuToggleRows.js';
import { LayoutManager, PANEL_REGISTRY } from '../src/ui/layoutManager.js';

const EDITOR_HTML = readFileSync(resolve(process.cwd(), 'editor/index.html'), 'utf8');

/** A manager over fake panels, one per row, all closed to start with. */
function fakeManager() {
  const panels = {};
  const registry = MENU_TOGGLE_ROWS.map((row) => {
    panels[row.key] = { visible: false };
    return {
      key: row.key,
      label: row.key,
      kind: 'workspace',
      get: () => panels[row.key],
    };
  });
  return { manager: new LayoutManager({ registry }), panels };
}

describe('menu toggle rows', () => {
  let manager;
  let panels;

  beforeEach(() => {
    document.body.innerHTML = MENU_TOGGLE_ROWS
      .map((row) => `<button id="${row.id}">${row.off}</button>`)
      .join('');
    ({ manager, panels } = fakeManager());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('names a row for every panel the layout registry knows', () => {
    for (const row of MENU_TOGGLE_ROWS) {
      const entry = PANEL_REGISTRY.find((item) => item.key === row.key);
      expect(entry, `no registry entry for ${row.id}`).toBeTruthy();
    }
  });

  it('points every row at a button that exists in the page', () => {
    for (const row of MENU_TOGGLE_ROWS) {
      expect(EDITOR_HTML).toContain(`id="${row.id}"`);
    }
  });

  it('writes the open label and the highlight when the panel is open', () => {
    panels.timeline.visible = true;
    paintMenuToggleRows(manager);

    const row = document.getElementById('btn-toggle-timeline');
    expect(row.textContent).toBe('Timeline ✓');
    expect(row.style.backgroundColor).toBeTruthy();

    const closed = document.getElementById('btn-toggle-vj');
    expect(closed.textContent).toBe('VJ Control');
    expect(closed.style.backgroundColor).toBe('');
  });

  it('drops the tick when something else closed the panel', () => {
    panels.timeline.visible = true;
    paintMenuToggleRows(manager);
    expect(document.getElementById('btn-toggle-timeline').textContent).toBe('Timeline ✓');

    // A Window → Layouts preset, the panel's own close button, a shortcut —
    // none of them go through the row.
    panels.timeline.visible = false;
    paintMenuToggleRows(manager);

    const row = document.getElementById('btn-toggle-timeline');
    expect(row.textContent).toBe('Timeline');
    expect(row.style.backgroundColor).toBe('');
  });

  it('leaves a row alone when its panel is not in the registry', () => {
    const bare = new LayoutManager({ registry: [] });
    document.getElementById('btn-toggle-timeline').textContent = 'Timeline ✓';

    paintMenuToggleRows(bare);

    // Unknown means closed, not untouched: a stale tick is the bug.
    expect(document.getElementById('btn-toggle-timeline').textContent).toBe('Timeline');
  });

  it('survives a page that is missing a row', () => {
    document.getElementById('btn-toggle-vj').remove();
    expect(() => paintMenuToggleRows(manager)).not.toThrow();
  });

  it('repaints when a menu is opened, whichever menu it is', () => {
    document.body.innerHTML = `
      <div id="top-menu-bar">
        <button class="menu-button" id="menu-view">View</button>
        <div class="menu-dropdown" id="dropdown-view">
          <button id="btn-toggle-timeline">Timeline</button>
        </div>
        <button class="menu-button" id="menu-tools">Tools</button>
        <div class="menu-dropdown" id="dropdown-tools"></div>
      </div>`;
    const stop = installMenuToggleRowPainting();

    // The real singleton reads real panels, none of which exist here, so every
    // row paints closed — enough to prove the wiring fires.
    document.getElementById('btn-toggle-timeline').textContent = 'Timeline ✓';
    document.getElementById('menu-tools').click();
    expect(document.getElementById('btn-toggle-timeline').textContent).toBe('Timeline');

    document.getElementById('btn-toggle-timeline').textContent = 'Timeline ✓';
    document.getElementById('dropdown-view').dispatchEvent(new window.Event('pointerenter'));
    expect(document.getElementById('btn-toggle-timeline').textContent).toBe('Timeline');

    stop();
    document.getElementById('btn-toggle-timeline').textContent = 'Timeline ✓';
    document.getElementById('menu-tools').click();
    expect(document.getElementById('btn-toggle-timeline').textContent).toBe('Timeline ✓');
  });

  it('installs only one set of listeners', () => {
    document.body.innerHTML = `
      <button class="menu-button" id="menu-view">View</button>
      <div class="menu-dropdown" id="dropdown-view"></div>`;
    const first = installMenuToggleRowPainting();
    const second = installMenuToggleRowPainting();
    expect(second).toBe(first);
    first();
  });
});
