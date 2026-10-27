// Preferences → Accessibility: the controls write the shared settings store, every control has a
// real label, and the window itself behaves as a keyboard-operable dialog.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreferencesWindow } from '../src/ui/PreferencesWindow.js';
import { A11ySettings } from '../src/accessibility/a11ySettings.js';

function labelled(text) {
  const label = [...document.querySelectorAll('#preferences-window label')].find(
    (l) => l.textContent.trim() === text,
  );
  return label?.htmlFor ? document.getElementById(label.htmlFor) : label?.querySelector('input');
}

describe('Preferences → Accessibility', () => {
  let store;
  let prefs;
  let opener;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="prefs-opener">Edit</button>';
    opener = document.getElementById('prefs-opener');
    opener.focus();
    store = new A11ySettings({ storage: null, matchMedia: () => null });
    prefs = new PreferencesWindow({ a11y: store, onCheckMotion: vi.fn() });
    prefs.show({ section: 'accessibility' });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('is a labelled dialog that opens on its Accessibility section', () => {
    const win = document.getElementById('preferences-window');
    expect(win.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(win.getAttribute('aria-labelledby')).textContent).toBe('Preferences');
    expect(win.querySelector('[data-pref-section="accessibility"]')).toBeTruthy();
    expect(document.activeElement).toBe(labelled('Contrast'));
    expect(win.querySelector('button[aria-label="Close preferences"]')).toBeTruthy();
  });

  it('writes each control to the settings store', () => {
    const set = (text, value) => {
      const control = labelled(text);
      control.value = value;
      control.dispatchEvent(new Event('change'));
    };
    set('Contrast', 'maximum');
    set('Interface size', '1.5');
    set('Focus indicator', 'bold');
    set('Interface animation', 'reduce');
    set('Colour vision preview', 'tritanopia');
    set('Colour vision mode', 'correct');
    set('Screen reader announcements', 'verbose');
    set('Patch outline order', 'position');

    expect(store.all()).toMatchObject({
      contrast: 'maximum',
      uiScale: 1.5,
      focusRing: 'bold',
      reduceMotion: 'reduce',
      colorVision: 'tritanopia',
      colorVisionMode: 'correct',
      announcements: 'verbose',
      outlineOrder: 'position',
    });

    const warnings = labelled('Warn before playing fast motion or flashing');
    warnings.checked = true;
    warnings.dispatchEvent(new Event('change'));
    expect(store.motionWarningsEnabled()).toBe(true);
  });

  it('follows changes made elsewhere, and dims the mode while colour vision is off', () => {
    store.set('contrast', 'high');
    expect(labelled('Contrast').value).toBe('high');
    expect(labelled('Colour vision mode').disabled).toBe(true);
    store.set('colorVision', 'protanopia');
    expect(labelled('Colour vision mode').disabled).toBe(false);
  });

  it('closes on Escape and gives focus back to what opened it', () => {
    labelled('Contrast').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(opener);
  });

  it('keeps accessibility out of the general reset', () => {
    store.set('uiScale', 2);
    const reset = [...document.querySelectorAll('#preferences-window button')].find(
      (b) => b.textContent === 'Reset Preferences to Defaults',
    );
    reset.click();
    expect(store.get('uiScale')).toBe(2);

    const a11yReset = [...document.querySelectorAll('#preferences-window button')].find(
      (b) => b.textContent === 'Reset Accessibility Settings',
    );
    a11yReset.click();
    expect(store.get('uiScale')).toBe(1);
  });
});
