import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SECOND_MONITOR_CHANNEL,
  SecondMonitorMessage,
  openSecondMonitorChannel,
} from '../src/ui/secondMonitorFrameChannel.js';

describe('secondMonitorFrameChannel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes a stable channel name and message types', () => {
    expect(SECOND_MONITOR_CHANNEL).toBe('rhizomium:second-monitor');
    expect(SecondMonitorMessage).toMatchObject({
      FRAME: 'frame',
      CLOSE: 'close',
      CLOSED: 'closed',
      READY: 'ready',
    });
  });

  it('freezes the message-type map', () => {
    expect(Object.isFrozen(SecondMonitorMessage)).toBe(true);
  });

  it('opens a BroadcastChannel with the shared name when supported', () => {
    const created = [];
    class BC {
      constructor(name) { this.name = name; created.push(this); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', BC);

    const ch = openSecondMonitorChannel();
    expect(ch).toBeInstanceOf(BC);
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe(SECOND_MONITOR_CHANNEL);
  });

  it('returns null when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(openSecondMonitorChannel()).toBeNull();
  });
});
