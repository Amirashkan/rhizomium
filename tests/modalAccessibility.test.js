// Dialogs for keyboard and screen-reader users: every ModalManager dialog announces itself, takes
// focus, keeps Tab inside, presses the button that has focus, and gives focus back when it closes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModalManager } from '../src/ui/ModalManager.js';

function keydown(target, key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const buttonLabelled = (label) =>
  [...document.querySelectorAll('.modal-button')].find((b) => b.textContent === label);

describe('ModalManager accessibility', () => {
  let manager;
  let opener;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="launch-dialog">Open</button>';
    opener = document.getElementById('launch-dialog');
    opener.focus();
    manager = new ModalManager();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('marks a dialog up so a screen reader announces it', () => {
    manager.confirm('Delete 3 nodes?', 'Delete');
    const dialog = document.querySelector('.modal-dialog');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
    expect(title.textContent).toBe('Delete');
    const description = document.getElementById(dialog.getAttribute('aria-describedby'));
    expect(description.textContent).toBe('Delete 3 nodes?');
  });

  it('gives a custom dialog the plain dialog role and no blanket description', () => {
    const body = document.createElement('div');
    body.innerHTML = '<select><option>a</option></select>';
    manager.custom({ title: 'Connect Pins', body, buttons: [{ label: 'Close', onClick: () => {} }] });
    const dialog = document.querySelector('.modal-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  });

  it('moves focus into an alert so the keyboard is in the dialog, not behind it', () => {
    manager.alert('Saved.', 'Done');
    expect(document.activeElement).toBe(buttonLabelled('OK'));
  });

  it('lands on the safe answer of a destructive confirm', async () => {
    const answer = manager.confirm('Delete the patch?', 'Delete', { danger: true, confirmLabel: 'Delete' });
    expect(document.activeElement).toBe(buttonLabelled('Cancel'));

    // Enter presses the focused button — Cancel — not the dangerous primary.
    keydown(document.activeElement, 'Enter');
    document.activeElement.click(); // the browser's own activation of a focused button
    vi.advanceTimersByTime(400);
    await expect(answer).resolves.toBe(false);
  });

  it('keeps Tab inside the dialog', () => {
    manager.confirm('Continue?', 'Question');
    const cancel = buttonLabelled('Cancel');
    const ok = buttonLabelled('OK');

    ok.focus();
    const forward = keydown(ok, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    const back = keydown(cancel, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ok);
  });

  it('gives focus back to whatever had it before the dialog opened', () => {
    manager.alert('Saved.', 'Done');
    buttonLabelled('OK').click();
    expect(document.activeElement).toBe(opener);
  });

  it('honours an explicit return target', () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    manager.custom({
      title: 'Go to node',
      body: document.createElement('div'),
      returnFocus: () => elsewhere,
      buttons: [{ label: 'Close', onClick: () => {} }],
    });
    buttonLabelled('Close').click();
    expect(document.activeElement).toBe(elsewhere);
  });
});
