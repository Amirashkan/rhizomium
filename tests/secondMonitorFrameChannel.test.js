import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SECOND_MONITOR_CHANNEL,
  SecondMonitorMessage,
  SecondMonitorTier,
  openSecondMonitorChannel,
} from '../src/ui/secondMonitorFrameChannel.js';

describe('secondMonitorFrameChannel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes a stable channel name and message types', () => {
    expect(SECOND_MONITOR_CHANNEL).toBe('rhizomium:second-monitor');
    expect(SecondMonitorMessage).toMatchObject({
      // native state path
      SHADER: 'shader',
      UNIFORMS: 'uniforms',
      CAPS: 'caps',
      // native compute / textures (Tier 2)
      COMPUTE_GRAPH: 'compute-graph',
      COMPUTE_UNIFORMS: 'compute-uniforms',
      TEXTURE: 'texture',
      // pixel fallback path
      FRAME: 'frame',
      // receiver → editor
      READY: 'ready',
      RESIZE: 'resize',
      NEED_FALLBACK: 'need-fallback',
      CLOSE: 'close',
      CLOSED: 'closed',
    });
  });

  it('exposes the native / native-compute / fallback tier names', () => {
    expect(SecondMonitorTier).toMatchObject({
      NATIVE: 'native',
      NATIVE_COMPUTE: 'native-compute',
      FALLBACK: 'fallback',
    });
    expect(Object.isFrozen(SecondMonitorTier)).toBe(true);
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
