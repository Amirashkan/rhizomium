// The top menu bar without a mouse: F10, arrows between menus and items, submenus that otherwise
// only open on hover, and Escape back out to where the keyboard came from.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMenuBarKeyboard } from '../src/accessibility/menuBarKeyboard.js';

function press(key, init = {}) {
  const target = document.activeElement || document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('menu bar keyboard', () => {
  let uninstall;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="elsewhere">Canvas stand-in</button>
      <div id="top-menu-bar">
        <div class="menu-section">
          <button class="menu-button" id="menu-file">File</button>
          <div class="menu-dropdown" id="dropdown-file">
            <button id="btn-new-project">New Project</button>
            <button id="btn-save">Save</button>
            <div class="menu-separator"></div>
            <div class="menu-item-with-submenu">
              <button class="menu-submenu-trigger">Publish</button>
              <div class="menu-submenu">
                <button id="btn-publish-image" class="submenu-button">Publish Image…</button>
                <button id="btn-publish-animation" class="submenu-button">Publish Animation…</button>
              </div>
            </div>
            <button id="btn-hidden" style="display:none">Not in this build</button>
            <button id="btn-exit">Exit</button>
          </div>
        </div>
        <div class="menu-section">
          <button class="menu-button" id="menu-edit">Edit</button>
          <div class="menu-dropdown" id="dropdown-edit">
            <button id="btn-undo">Undo</button>
            <label class="snap-size"><span>Grid Size:</span><input type="number" id="snap-size" value="20" /></label>
          </div>
        </div>
      </div>`;
    // What main.js does on a title click: close every dropdown, open this one if it was shut.
    for (const title of document.querySelectorAll('.menu-button')) {
      title.addEventListener('click', () => {
        const dropdown = document.getElementById(title.id.replace('menu-', 'dropdown-'));
        const wasOpen = dropdown.classList.contains('show');
        document.querySelectorAll('.menu-dropdown').forEach((d) => d.classList.remove('show'));
        if (!wasOpen) dropdown.classList.add('show');
      });
    }
    uninstall = installMenuBarKeyboard({ doc: document });
  });

  afterEach(() => {
    uninstall?.();
    document.body.innerHTML = '';
  });

  it('marks the titles up as menu buttons', () => {
    const bar = document.getElementById('top-menu-bar');
    expect(bar.getAttribute('role')).toBe('toolbar');
    const file = document.getElementById('menu-file');
    expect(file.getAttribute('aria-haspopup')).toBe('true');
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(file.getAttribute('aria-controls')).toBe('dropdown-file');
    expect(document.querySelector('.menu-submenu-trigger').getAttribute('aria-haspopup')).toBe('true');
  });

  it('reaches the bar with F10 and moves between menus with the arrows', () => {
    document.getElementById('elsewhere').focus();
    press('F10');
    expect(document.activeElement.id).toBe('menu-file');
    press('ArrowRight');
    expect(document.activeElement.id).toBe('menu-edit');
    press('ArrowRight');
    expect(document.activeElement.id).toBe('menu-file');
    press('End');
    expect(document.activeElement.id).toBe('menu-edit');
  });

  it('opens a menu with Down and walks its visible items, skipping hidden rows', async () => {
    document.getElementById('menu-file').focus();
    press('ArrowDown');
    expect(document.getElementById('dropdown-file').classList.contains('show')).toBe(true);
    expect(document.activeElement.id).toBe('btn-new-project');
    press('ArrowDown');
    expect(document.activeElement.id).toBe('btn-save');
    press('ArrowDown');
    expect(document.activeElement.textContent).toBe('Publish');
    press('ArrowDown');
    expect(document.activeElement.id).toBe('btn-exit');
    press('ArrowDown');
    expect(document.activeElement.id).toBe('btn-new-project');
    press('End');
    expect(document.activeElement.id).toBe('btn-exit');

    await flush();
    expect(document.getElementById('menu-file').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a submenu with Right and backs out with Left', () => {
    document.getElementById('menu-file').focus();
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    const trigger = document.activeElement;
    expect(trigger.textContent).toBe('Publish');

    press('ArrowRight');
    expect(document.activeElement.id).toBe('btn-publish-image');
    press('ArrowDown');
    expect(document.activeElement.id).toBe('btn-publish-animation');
    press('ArrowLeft');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.nextElementSibling.classList.contains('show')).toBe(false);
  });

  it('leaves a number field its own arrow keys', () => {
    document.getElementById('menu-edit').focus();
    press('ArrowDown');
    press('ArrowDown');
    expect(document.activeElement.id).toBe('snap-size');
    const event = press('ArrowUp');
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement.id).toBe('snap-size');
  });

  it('closes on Escape, then returns to where F10 came from', () => {
    const origin = document.getElementById('elsewhere');
    origin.focus();
    press('F10');
    press('ArrowDown');
    expect(document.activeElement.id).toBe('btn-new-project');

    press('Escape');
    expect(document.getElementById('dropdown-file').classList.contains('show')).toBe(false);
    expect(document.activeElement.id).toBe('menu-file');

    press('Escape');
    expect(document.activeElement).toBe(origin);
  });

  it('keeps F10 out of text fields', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    press('F10');
    expect(document.activeElement).toBe(field);
  });
});
