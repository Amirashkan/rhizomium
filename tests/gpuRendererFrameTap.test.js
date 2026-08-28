// The frame tap feeds every live output the editor has: the second-monitor
// mirror and the NDI sender. It used to be a single slot, so switching one on
// silently unhooked the other — a projector going black when the artist started
// streaming. These cover the multi-consumer behaviour that replaced it, and the
// ownership rule that goes with it: every consumer gets a bitmap it must close,
// and no consumer may be handed one another has already closed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GPURenderer } from '../src/gpu/gpuRenderer.js';

// A bare object backed by the real prototype, so the actual method bodies run
// without standing up a WebGPU device. Matches gpuRendererStateTap.test.js.
function bare(props = {}) {
  return Object.assign(Object.create(GPURenderer.prototype), {
    _frameTap: null,
    _frameTaps: new Set(),
    _frameTapInFlight: false,
    canvas: { width: 320, height: 240 },
    ...props,
  });
}

/** A stand-in ImageBitmap that records whether it was closed. */
function fakeBitmap(id = 'bitmap') {
  return { id, width: 320, height: 240, closed: false, close() { this.closed = true; } };
}

describe('GPURenderer frame tap registration', () => {
  it('addFrameTap returns an unsubscribe that removes only that consumer', () => {
    const self = bare();
    const a = () => {};
    const b = () => {};

    const offA = self.addFrameTap(a);
    self.addFrameTap(b);
    expect(self._frameTapConsumers()).toEqual([a, b]);

    offA();
    expect(self._frameTapConsumers()).toEqual([b]);

    // Unsubscribing twice is harmless - teardown paths call it defensively.
    expect(() => offA()).not.toThrow();
    expect(self._frameTapConsumers()).toEqual([b]);
  });

  it('addFrameTap ignores a non-function and still returns a callable', () => {
    const self = bare();
    const off = self.addFrameTap(null);
    expect(self._hasFrameTap()).toBe(false);
    expect(() => off()).not.toThrow();
  });

  it('setFrameTap and addFrameTap coexist, with the slot consumer first', () => {
    const self = bare();
    const slot = () => {};
    const added = () => {};

    self.setFrameTap(slot);
    self.addFrameTap(added);

    // Both are live: this is the case that used to lose one of them.
    expect(self._hasFrameTap()).toBe(true);
    expect(self._frameTapConsumers()).toEqual([slot, added]);

    // Clearing the slot must not disturb the separately registered consumer.
    self.setFrameTap(null);
    expect(self._frameTapConsumers()).toEqual([added]);
  });

  it('_hasFrameTap is false only when nothing is attached', () => {
    const self = bare();
    expect(self._hasFrameTap()).toBe(false);
    const off = self.addFrameTap(() => {});
    expect(self._hasFrameTap()).toBe(true);
    off();
    expect(self._hasFrameTap()).toBe(false);
  });
});

describe('GPURenderer frame delivery', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('hands a single consumer the capture itself, without copying', async () => {
    const clone = vi.fn();
    vi.stubGlobal('createImageBitmap', clone);

    const got = [];
    const self = bare();
    self.addFrameTap((bitmap) => got.push(bitmap));

    const captured = fakeBitmap('original');
    await self._deliverTappedFrame(captured);

    expect(got).toEqual([captured]);
    // The common case must stay free: one output means no copy at all.
    expect(clone).not.toHaveBeenCalled();
    // Ownership passed to the consumer, so nothing closed it on the way.
    expect(captured.closed).toBe(false);
  });

  it('gives each of two consumers its own bitmap', async () => {
    const copy = fakeBitmap('copy');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => copy));

    const self = bare();
    const first = [];
    const second = [];
    self.setFrameTap((bitmap) => first.push(bitmap));
    self.addFrameTap((bitmap) => second.push(bitmap));

    const captured = fakeBitmap('original');
    await self._deliverTappedFrame(captured);

    // The first consumer gets the original, the second a copy - never the same
    // object, which either could close out from under the other.
    expect(first).toEqual([captured]);
    expect(second).toEqual([copy]);
    expect(first[0]).not.toBe(second[0]);
  });

  it('copies before handing the original over, so a consumer that closes immediately cannot break the others', async () => {
    const order = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async (source) => {
      order.push(`copy(source closed=${source.closed})`);
      return fakeBitmap('copy');
    }));

    const self = bare();
    // A consumer that closes the moment it is called - the documented contract.
    self.setFrameTap((bitmap) => { order.push('first'); bitmap.close(); });
    self.addFrameTap(() => { order.push('second'); });

    await self._deliverTappedFrame(fakeBitmap('original'));

    // The copy must be taken while the original is still open.
    expect(order).toEqual(['copy(source closed=false)', 'first', 'second']);
  });

  it('closes the capture when every consumer has gone', async () => {
    const self = bare();
    const captured = fakeBitmap();
    await self._deliverTappedFrame(captured);
    // Nobody wants it - dropping it without closing would leak the frame.
    expect(captured.closed).toBe(true);
  });

  it('closes the bitmap a throwing consumer never took ownership of', async () => {
    const self = bare();
    self.addFrameTap(() => { throw new Error('consumer blew up'); });

    const captured = fakeBitmap();
    await expect(self._deliverTappedFrame(captured)).resolves.toBeUndefined();
    expect(captured.closed).toBe(true);
  });

  it('keeps delivering to the other consumers when one throws', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap('copy')));

    const self = bare();
    const reached = [];
    self.setFrameTap(() => { throw new Error('first blew up'); });
    self.addFrameTap(() => reached.push('second'));

    await self._deliverTappedFrame(fakeBitmap());
    expect(reached).toEqual(['second']);
  });

  it('drops only the consumer whose copy failed', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed'); }));

    const self = bare();
    const first = [];
    const second = [];
    self.setFrameTap((bitmap) => first.push(bitmap));
    self.addFrameTap((bitmap) => second.push(bitmap));

    const captured = fakeBitmap('original');
    await self._deliverTappedFrame(captured);

    // The consumer holding the original is unaffected by the other's failure.
    expect(first).toEqual([captured]);
    expect(second).toEqual([]);
  });

  it('clears the in-flight flag after delivery, including when it fails', async () => {
    const self = bare({ _frameTapInFlight: true });
    self.addFrameTap(() => { throw new Error('nope'); });

    await self._deliverTappedFrame(fakeBitmap());
    // Left set, the renderer would never capture another frame.
    expect(self._frameTapInFlight).toBe(false);
  });
});

describe('GPURenderer frame capture', () => {
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap()));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not capture when nothing is attached', () => {
    const self = bare();
    self._captureTappedFrame();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('coalesces: no second capture while one is still being delivered', () => {
    const self = bare({ _frameTapInFlight: true });
    self.addFrameTap(() => {});
    self._captureTappedFrame();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('skips a canvas with no size rather than throwing', () => {
    const self = bare({ canvas: { width: 0, height: 0 } });
    self.addFrameTap(() => {});
    expect(() => self._captureTappedFrame()).not.toThrow();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('clears the in-flight flag when the capture itself rejects', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('context lost'))));
    const self = bare();
    self.addFrameTap(() => {});

    self._captureTappedFrame();
    expect(self._frameTapInFlight).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(self._frameTapInFlight).toBe(false);
  });
});
