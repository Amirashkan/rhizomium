// The editor's keymap: every menu row has a shortcut, every shortcut is unique,
// and pressing one runs the row it is printed on.
//
// src/ui/shortcuts.js is the single table behind the menu hints, the global key
// dispatcher and the Help → Shortcuts dialog. These tests are what keeps a new
// menu entry from shipping without a key, and two entries from claiming the
// same one.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SHORTCUT_SECTIONS,
  allShortcutItems,
  comboList,
  parseCombo,
  formatCombo,
  eventMatchesCombo,
  applyMenuShortcutHints,
  installShortcutDispatcher,
  showShortcutsDialog,
  hideShortcutsDialog,
} from '../src/ui/shortcuts.js';

// vitest runs from the repo root; happy-dom rewrites import.meta.url, so read
// the page relative to the working directory rather than to this module.
const EDITOR_HTML = readFileSync(resolve(process.cwd(), 'editor/index.html'), 'utf8');

/** The ids of every clickable row in the top menu bar, straight from the page. */
function menuRowIdsFromHtml() {
  const menuBar = EDITOR_HTML.slice(
    EDITOR_HTML.indexOf('<div id="top-menu-bar">'),
    EDITOR_HTML.indexOf('<canvas id="gpu-canvas">'),
  );
  const ids = [];
  const re = /<button[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(menuBar))) {
    // The eight top-level menu titles open a dropdown; they are not commands.
    if (!m[1].startsWith('menu-')) ids.push(m[1]);
  }
  // Checkbox rows are labels, not buttons, and carry a row id of their own.
  for (const id of ['row-view-show-grid', 'row-snap-toggle']) {
    if (menuBar.includes(`id="${id}"`)) ids.push(id);
  }
  return ids;
}

// A keydown that looks like the real thing: `code` is what the matcher reads.
function keyEvent(code, { mod = false, shift = false, alt = false, key } = {}) {
  return new window.KeyboardEvent('keydown', {
    code,
    key: key ?? code,
    ctrlKey: mod,
    metaKey: false,
    shiftKey: shift,
    altKey: alt,
    bubbles: true,
    cancelable: true,
  });
}

describe('shortcut table', () => {
  it('gives every menu row in editor/index.html a shortcut', () => {
    const covered = new Set(allShortcutItems().map((i) => i.id).filter(Boolean));
    const missing = menuRowIdsFromHtml().filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  it('binds no combo twice', () => {
    const seen = new Map();
    const clashes = [];
    for (const item of allShortcutItems()) {
      // An alias is the same command listed under a second menu (Delete lives
      // in both Edit and Node); it shares its key on purpose.
      if (item.alias) continue;
      for (const combo of comboList(item)) {
        if (combo === 'Arrows') continue; // documentation-only
        const previous = seen.get(combo);
        if (previous) clashes.push(`${combo}: ${previous} vs ${item.label}`);
        seen.set(combo, item.label);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('points every row id at an element that exists in the page', () => {
    for (const item of allShortcutItems()) {
      if (!item.id) continue;
      expect(EDITOR_HTML).toContain(`id="${item.id}"`);
      if (item.target) expect(EDITOR_HTML).toContain(`id="${item.target}"`);
    }
  });

  it('labels and keys every entry', () => {
    for (const section of SHORTCUT_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.label).toBeTruthy();
        expect(item.keys).toBeTruthy();
      }
    }
  });
});

describe('combo parsing and formatting', () => {
  it('reads modifiers and key out of a combo', () => {
    expect(parseCombo('Mod+Shift+S')).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: 's',
    });
    expect(parseCombo('F1')).toEqual({ mod: false, shift: false, alt: false, key: 'f1' });
    // The plus key itself, not a separator.
    expect(parseCombo('Mod++').key).toBe('+');
  });

  it('writes Ctrl on Windows and the glyphs on macOS', () => {
    expect(formatCombo('Mod+Shift+S', { mac: false })).toBe('Ctrl+Shift+S');
    expect(formatCombo('Mod+Alt+P', { mac: false })).toBe('Ctrl+Alt+P');
    expect(formatCombo('Mod+Shift+S', { mac: true })).toBe('⌘⇧S');
    expect(formatCombo('Delete', { mac: false })).toBe('Del');
    expect(formatCombo('Mod+`', { mac: false })).toBe('Ctrl+`');
  });
});

describe('combo matching', () => {
  const opts = { mac: false };

  it('matches the exact modifier set', () => {
    expect(eventMatchesCombo(keyEvent('KeyS', { mod: true }), 'Mod+S', opts)).toBe(true);
    expect(eventMatchesCombo(keyEvent('KeyS', { mod: true, shift: true }), 'Mod+S', opts)).toBe(false);
    expect(eventMatchesCombo(keyEvent('KeyS', { mod: true, alt: true }), 'Mod+S', opts)).toBe(false);
    expect(eventMatchesCombo(keyEvent('KeyS'), 'Mod+S', opts)).toBe(false);
  });

  it('reads the physical key, so Alt combos survive macOS key rewriting', () => {
    // ⌥S arrives with key "ß"; code stays KeyS.
    const e = keyEvent('KeyS', { mod: true, alt: true, key: 'ß' });
    expect(eventMatchesCombo(e, 'Mod+Alt+S', opts)).toBe(true);
  });

  it('treats Mod++ and Mod+= as the same physical key', () => {
    expect(eventMatchesCombo(keyEvent('Equal', { mod: true }), 'Mod+=', opts)).toBe(true);
    expect(
      eventMatchesCombo(keyEvent('Equal', { mod: true, shift: true }), 'Mod++', opts),
    ).toBe(true);
  });

  it('never matches the documentation-only Arrows entry', () => {
    expect(eventMatchesCombo(keyEvent('ArrowLeft'), 'Arrows', opts)).toBe(false);
  });
});

describe('menu annotation and dispatch', () => {
  let removeDispatcher;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="top-menu-bar">
        <div class="menu-dropdown" id="dropdown-file">
          <button id="btn-save">Save</button>
          <button id="btn-save-as">Save As…</button>
          <button id="btn-undo" title="Undo last action" disabled>Undo</button>
        </div>
        <div class="menu-dropdown" id="dropdown-view">
          <label class="submenu-toggle" id="row-snap-toggle">
            <input type="checkbox" id="snap-toggle" />
            Snap to Grid
          </label>
          <button id="btn-second-monitor" style="display:none">Second Monitor Viewer</button>
        </div>
      </div>
      <div id="code-console" class="closed">
        <button id="btn-select-code">Select All</button>
      </div>
    `;
  });

  afterEach(() => {
    removeDispatcher?.();
    removeDispatcher = undefined;
    hideShortcutsDialog();
    document.body.innerHTML = '';
  });

  it('prints the combo on the row and keeps a hand-written title', () => {
    applyMenuShortcutHints(document);

    expect(document.getElementById('btn-save').getAttribute('data-shortcut')).toBe(
      formatCombo('Mod+S'),
    );
    const undoTitle = document.getElementById('btn-undo').getAttribute('title');
    expect(undoTitle).toContain('Undo last action');
    expect(undoTitle).toContain(formatCombo('Mod+Z'));
  });

  it('fires the menu row the shortcut is printed on', () => {
    const clicked = [];
    for (const id of ['btn-save', 'btn-save-as']) {
      document.getElementById(id).addEventListener('click', () => clicked.push(id));
    }
    removeDispatcher = installShortcutDispatcher({ root: document, mac: false });

    window.dispatchEvent(keyEvent('KeyS', { mod: true }));
    window.dispatchEvent(keyEvent('KeyS', { mod: true, shift: true }));

    expect(clicked).toEqual(['btn-save', 'btn-save-as']);
  });

  it('fires the checkbox behind a toggle row', () => {
    let changes = 0;
    const box = document.getElementById('snap-toggle');
    box.addEventListener('change', () => (changes += 1));
    removeDispatcher = installShortcutDispatcher({ root: document, mac: false });

    window.dispatchEvent(keyEvent('KeyG', { mod: true }));

    expect(box.checked).toBe(true);
    expect(changes).toBe(1);
  });

  it('leaves a keystroke alone while the user is typing', () => {
    let clicks = 0;
    document.getElementById('btn-save').addEventListener('click', () => (clicks += 1));
    removeDispatcher = installShortcutDispatcher({
      root: document,
      shouldIgnore: () => true,
    });

    window.dispatchEvent(keyEvent('KeyS', { mod: true }));

    expect(clicks).toBe(0);
  });

  it('does not fire a row this build hides', () => {
    let clicks = 0;
    document.getElementById('btn-second-monitor').addEventListener('click', () => (clicks += 1));
    removeDispatcher = installShortcutDispatcher({ root: document });

    window.dispatchEvent(keyEvent('Digit2', { mod: true, shift: true }));

    expect(clicks).toBe(0);
  });

  it('holds console commands until the console is open', () => {
    let clicks = 0;
    document.getElementById('btn-select-code').addEventListener('click', () => (clicks += 1));
    removeDispatcher = installShortcutDispatcher({ root: document });

    window.dispatchEvent(keyEvent('KeyE', { mod: true, alt: true }));
    expect(clicks).toBe(0);

    document.getElementById('code-console').classList.remove('closed');
    window.dispatchEvent(keyEvent('KeyE', { mod: true, alt: true }));
    expect(clicks).toBe(1);
  });

  it('stays out of the way of a handler that already claimed the key', () => {
    let clicks = 0;
    document.getElementById('btn-save').addEventListener('click', () => (clicks += 1));
    removeDispatcher = installShortcutDispatcher({ root: document });

    const event = keyEvent('KeyS', { mod: true });
    event.preventDefault(); // e.g. the VJ panel or an open palette got there first
    window.dispatchEvent(event);

    expect(clicks).toBe(0);
  });
});

describe('Help → Shortcuts dialog', () => {
  afterEach(() => {
    hideShortcutsDialog();
    document.body.innerHTML = '';
  });

  it('prints every entry in the table', () => {
    const overlay = showShortcutsDialog(document);

    expect(overlay).toBeTruthy();
    expect(overlay.querySelectorAll('.keymap-row').length).toBe(allShortcutItems().length);
    expect(overlay.querySelectorAll('.keymap-section').length).toBe(SHORTCUT_SECTIONS.length);
    expect(overlay.textContent).toContain('Save As…');
  });

  it('toggles: a second call closes it', () => {
    showShortcutsDialog(document);
    expect(document.querySelectorAll('.keymap-overlay').length).toBe(1);

    showShortcutsDialog(document);
    expect(document.querySelectorAll('.keymap-overlay').length).toBe(0);
  });
});
