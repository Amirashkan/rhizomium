/**
 * Regression tests for the Publish → Animation prompts (FPS, then duration).
 *
 * Two bugs met in that dialog: Backspace deleted the selected node instead of a
 * digit of the value being typed, and the dialog itself would vanish mid-flow,
 * silently abandoning the publish. Both were ModalManager's: keys typed in the
 * dialog reached the editor's global shortcuts, and a click that merely ended on
 * the backdrop counted as a dismissal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModalManager } from '../src/ui/ModalManager.js';

function keydown(target, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function click(target, { mousedownOn = target } = {}) {
  mousedownOn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const overlays = () => document.querySelectorAll('.modal-overlay');
const buttonLabelled = (label) =>
  [...document.querySelectorAll('.modal-button')].find((b) => b.textContent === label);

describe('ModalManager keyboard isolation', () => {
  let manager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ModalManager();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('keeps keys typed in a prompt away from the editor shortcuts', () => {
    const globalKeys = vi.fn();
    window.addEventListener('keydown', globalKeys);

    manager.prompt('Frames per second?', 'Animation Settings', '60', { inputType: 'number' });

    const input = document.querySelector('.modal-input');
    keydown(input, 'Backspace');
    keydown(input, '3');

    expect(globalKeys).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalKeys);
  });

  it('reports an open modal so shortcuts can stand down before focus lands', () => {
    expect(manager.isModalOpen()).toBe(false);

    manager.prompt('Duration in seconds?', 'Animation Settings', '5');
    expect(manager.isModalOpen()).toBe(true);

    // A modal on its way out no longer owns the keyboard.
    manager.closeModal(overlays()[0]);
    expect(manager.isModalOpen()).toBe(false);
  });

  it('focuses and selects the suggested value so typing replaces it', () => {
    manager.prompt('Frames per second?', 'Animation Settings', '60');

    const input = document.querySelector('.modal-input');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });

  it('only lets the topmost modal answer Enter', async () => {
    const first = manager.prompt('Frames per second?', 'Animation Settings', '60');
    const firstInput = document.querySelector('.modal-input');

    // Confirm the first prompt, then open the second while the first fades out.
    buttonLabelled('OK').click();
    await expect(first).resolves.toBe('60');

    const second = manager.prompt('Duration in seconds?', 'Animation Settings', '5');
    const secondInput = [...document.querySelectorAll('.modal-input')].at(-1);
    expect(secondInput).not.toBe(firstInput);

    secondInput.value = '12';
    keydown(secondInput, 'Enter');
    await expect(second).resolves.toBe('12');
  });
});

describe('ModalManager dismissal', () => {
  let manager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ModalManager();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not abandon a prompt when a click lands on the backdrop', () => {
    const resolved = vi.fn();
    manager.prompt('Frames per second?', 'Animation Settings', '60').then(resolved);

    const overlay = overlays()[0];
    click(overlay);
    vi.advanceTimersByTime(400);

    expect(overlays()).toHaveLength(1);
    expect(resolved).not.toHaveBeenCalled();
  });

  it('still cancels a prompt on Escape', async () => {
    const pending = manager.prompt('Frames per second?', 'Animation Settings', '60');

    keydown(document.querySelector('.modal-input'), 'Escape');
    vi.advanceTimersByTime(400);

    await expect(pending).resolves.toBeNull();
    expect(overlays()).toHaveLength(0);
  });

  it('ignores a backdrop release that began inside the dialog', () => {
    const resolved = vi.fn();
    manager.confirm('Publish the artwork without the patch?', 'Patch Too Large').then(resolved);

    const overlay = overlays()[0];
    // Drag out of the dialog and release on the backdrop: the resulting click
    // targets the overlay, but the user never meant to dismiss anything.
    click(overlay, { mousedownOn: overlay.querySelector('.modal-dialog') });
    vi.advanceTimersByTime(400);

    expect(overlays()).toHaveLength(1);
    expect(resolved).not.toHaveBeenCalled();
  });

  it('still dismisses a confirm on a genuine backdrop click', async () => {
    const pending = manager.confirm('Publish the artwork without the patch?', 'Patch Too Large');

    click(overlays()[0]);
    vi.advanceTimersByTime(400);

    await expect(pending).resolves.toBe(false);
    expect(overlays()).toHaveLength(0);
  });
});
