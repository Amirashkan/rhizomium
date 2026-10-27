// Screen-reader announcements: what an action sounds like when nobody can see the canvas.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { announce, installAnnouncer } from '../src/accessibility/announcer.js';

function settingsWith(level) {
  return { get: (key) => (key === 'announcements' ? level : undefined) };
}

const polite = () => document.getElementById('rz-a11y-live-polite');
const assertive = () => document.getElementById('rz-a11y-live-assertive');

describe('announce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('builds polite and assertive live regions that stay out of sight', () => {
    installAnnouncer(document);
    expect(polite().getAttribute('aria-live')).toBe('polite');
    expect(polite().getAttribute('role')).toBe('status');
    expect(assertive().getAttribute('aria-live')).toBe('assertive');
    expect(assertive().getAttribute('role')).toBe('alert');
    expect(polite().style.cssText).toContain('clip');
  });

  it('speaks through the polite region by default', () => {
    announce('Connected Time to Noise', { settings: settingsWith('normal') });
    vi.advanceTimersByTime(50);
    expect(polite().textContent).toBe('Connected Time to Noise');
  });

  it('re-announces an identical message by clearing first', () => {
    const settings = settingsWith('normal');
    announce('Moved', { settings });
    vi.advanceTimersByTime(50);
    announce('Moved', { settings });
    expect(polite().textContent).toBe('');
    vi.advanceTimersByTime(50);
    expect(polite().textContent).toBe('Moved');
  });

  it('uses the assertive region for urgent messages', () => {
    announce('Playback held', { priority: 'assertive', settings: settingsWith('normal') });
    vi.advanceTimersByTime(50);
    expect(assertive().textContent).toBe('Playback held');
  });

  it('stays silent when announcements are off, and keeps commentary for verbose', () => {
    expect(announce('Hello', { settings: settingsWith('off') })).toBe(false);
    expect(announce('x: 120', { verbose: true, settings: settingsWith('normal') })).toBe(false);
    expect(announce('x: 120', { verbose: true, settings: settingsWith('verbose') })).toBe(true);
    expect(announce('   ', { settings: settingsWith('verbose') })).toBe(false);
  });
});
