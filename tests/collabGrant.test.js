// The pass an editor shows a gated relay.
//
// Two things here are worth a test and neither is visible in the panel:
//
//   - A grant is never reused. The relay spends one when it admits a peer, so
//     a cached token would be refused as a replay on the reconnect — the
//     failure would look like a billing problem and would not be one.
//   - Failing to get a grant is not failing to join. Most people run a relay
//     on loopback that asks for nothing; a gallery that cannot be reached must
//     not stop them, it must let the relay be the one to decide.

import { describe, it, expect, vi } from 'vitest';
import { CollabGrantSource, collabGrantGetter } from '../src/collab/collabGrant.js';
import { GrantError } from '../src/ai/entitlements.js';

describe('the collab grant source', () => {
  it('asks the gallery for a pass naming the collab feature', async () => {
    const request = vi.fn().mockResolvedValue({ granted: true, grant: 'tok-1' });
    const source = new CollabGrantSource({ request });

    await expect(source.token()).resolves.toBe('tok-1');
    expect(request).toHaveBeenCalledWith('collab.space');
    expect(source.lastError).toBeNull();
  });

  it('asks again every time rather than reusing a spent grant', async () => {
    let n = 0;
    const request = vi.fn(async () => ({ granted: true, grant: `tok-${++n}` }));
    const source = new CollabGrantSource({ request });

    expect(await source.token()).toBe('tok-1');
    expect(await source.token()).toBe('tok-2');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns nothing, and does not throw, when the gallery refuses', async () => {
    const request = vi.fn().mockRejectedValue(
      new GrantError('Collab space is part of Cloude.', { code: 'tier_required' })
    );
    const source = new CollabGrantSource({ request });

    await expect(source.token()).resolves.toBeNull();
    expect(source.lastError).toMatch(/part of Cloude/);
  });

  it('survives a gallery that answers without a grant', async () => {
    const source = new CollabGrantSource({ request: async () => ({ granted: true }) });
    await expect(source.token()).resolves.toBeNull();
    expect(source.lastError).toBeTruthy();
  });

  it('survives a network failure that is not a GrantError', async () => {
    const source = new CollabGrantSource({
      request: async () => { throw new TypeError('fetch failed'); },
    });
    await expect(source.token()).resolves.toBeNull();
    expect(source.lastError).toMatch(/could not reach the gallery/i);
  });

  it('hands the session a plain callback backed by one source', async () => {
    const source = new CollabGrantSource({ request: async () => ({ grant: 'tok' }) });
    const getter = collabGrantGetter(source);

    await expect(getter()).resolves.toBe('tok');
    expect(getter.source).toBe(source);
  });
});
