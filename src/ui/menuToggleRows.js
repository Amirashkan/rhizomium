/**
 * menuToggleRows.js — the menu rows that say whether their panel is open.
 *
 * Eight rows across the View and Tools menus carry their panel's state in
 * their label: "Timeline ✓" when the timeline is up, "Hide Console" when the
 * console is. Each of them used to paint that label inside its own click
 * handler, which is true for exactly as long as the row is the only thing that
 * moves the panel — and it never is. A panel closed by its own close button,
 * by a keyboard shortcut, or by a Window → Layouts preset left the row still
 * claiming a tick it no longer had, and the next click on it then read as a
 * row that did nothing (it closed an already-closed panel, or opened one the
 * label said was open).
 *
 * So the labels are derived rather than remembered: whether a panel is open is
 * asked of the panel, through the same registry the Window menu drives
 * (layoutManager.js), and every row is repainted each time a menu is opened.
 * A row can then only be wrong for as long as nobody is looking at it.
 */

import { getLayoutManager } from './layoutManager.js';

/** Highlight for a row whose panel is open — the menus' existing "on" look. */
const ON_BACKGROUND = 'rgba(74, 74, 78, 0.8)';
const ON_BORDER = 'rgba(102, 170, 255, 0.4)';

/**
 * The rows, and what each reads in either state.
 *
 * `key` is the panel's key in the layout registry, which is what makes this
 * table and the Window menu agree about what "open" means.
 */
export const MENU_TOGGLE_ROWS = [
  // View
  { id: 'btn-toggle-console', key: 'console', on: 'Hide Console', off: 'Show Console' },
  { id: 'btn-toggle-timeline', key: 'timeline', on: 'Timeline ✓', off: 'Timeline' },
  { id: 'btn-toggle-vj', key: 'vj', on: 'VJ Control ✓', off: 'VJ Control' },
  { id: 'btn-toggle-profiler', key: 'profiler', on: 'Compute Profiler ✓', off: 'Compute Profiler' },
  // Tools
  { id: 'btn-mapping-tool', key: 'mapping', on: 'Projection Mapping ✓', off: 'Projection Mapping…' },
  { id: 'btn-audio-settings', key: 'audio', on: 'Audio ✓', off: 'Audio…' },
  { id: 'btn-midi-settings', key: 'midi', on: 'MIDI Settings ✓', off: 'MIDI Settings' },
  { id: 'btn-osc-settings', key: 'osc', on: 'OSC Receiver ✓', off: 'OSC Receiver' },
];

/**
 * Panels do not close the instant they are told to — the preview tears its
 * container down over 200ms and only then reports itself closed — so a row
 * painted on the click alone can still be reading the outgoing state.
 */
const PANEL_SETTLE_MS = 400;

/**
 * Read every row's panel and write the row.
 *
 * @param {object} [manager] - layout manager to read through (tests pass one)
 */
export function paintMenuToggleRows(manager = getLayoutManager()) {
  if (typeof document === 'undefined') return;

  for (const row of MENU_TOGGLE_ROWS) {
    const element = document.getElementById(row.id);
    if (!element) continue;

    const entry = manager.entry(row.key);
    const open = !!entry && manager.isOpen(entry);

    // The shortcut hint is an attribute (data-shortcut) drawn by CSS, so
    // rewriting the label here cannot wipe it — see shortcuts.js.
    element.textContent = open ? row.on : row.off;
    element.style.backgroundColor = open ? ON_BACKGROUND : '';
    element.style.borderColor = open ? ON_BORDER : '';
  }
}

/** Paint now, and again once the panels have finished opening or closing. */
export function repaintMenuToggleRows(manager = getLayoutManager()) {
  paintMenuToggleRows(manager);
  setTimeout(() => paintMenuToggleRows(manager), PANEL_SETTLE_MS);
}

/**
 * Keep the rows honest for the life of the page.
 *
 * Every menu repaints every row as it opens: which menu was opened does not
 * matter, the work is eight element reads, and a row is only ever seen while
 * some menu is open. Clicking the menu title is what opens the dropdown;
 * pointerenter covers a dropdown reopened without a fresh click.
 *
 * @returns {Function} cleanup, for tests and hot reloads
 */
let uninstall = null;

export function installMenuToggleRowPainting() {
  if (typeof document === 'undefined') return () => {};
  // The UI setup can run again over the same page; one set of listeners is
  // enough, and a second would only paint the same rows twice.
  if (uninstall) return uninstall;

  const paint = () => paintMenuToggleRows();
  const titles = [...document.querySelectorAll('.menu-button')];
  const dropdowns = [...document.querySelectorAll('.menu-dropdown')];

  for (const title of titles) title.addEventListener('click', paint);
  for (const dropdown of dropdowns) dropdown.addEventListener('pointerenter', paint);

  paint();

  uninstall = () => {
    for (const title of titles) title.removeEventListener('click', paint);
    for (const dropdown of dropdowns) dropdown.removeEventListener('pointerenter', paint);
    uninstall = null;
  };
  return uninstall;
}
