import { describe, it, expect } from 'vitest';
import { isFeatureEnabled, setFeatureFlag, FEATURE_FLAGS_STORAGE_KEY } from '../src/core/featureFlags.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

describe('featureFlags', () => {
  it('keeps the coPerformer panel off by default', () => {
    expect(isFeatureEnabled('coPerformer', { search: '', storage: memoryStorage() })).toBe(false);
  });

  it('turns a flag on from the URL', () => {
    expect(isFeatureEnabled('coPerformer', { search: '?flags=foo,coPerformer', storage: null })).toBe(true);
  });

  it('turns a flag on from storage, and the URL wins over storage', () => {
    const storage = memoryStorage();
    expect(setFeatureFlag('coPerformer', true, storage)).toBe(true);
    expect(isFeatureEnabled('coPerformer', { search: '', storage })).toBe(true);
    expect(isFeatureEnabled('other', { search: '?flags=other', storage })).toBe(true);
  });

  it('treats unknown flags and corrupt storage as off', () => {
    const storage = memoryStorage({ [FEATURE_FLAGS_STORAGE_KEY]: '{not json' });
    expect(isFeatureEnabled('coPerformer', { search: '', storage })).toBe(false);
    expect(isFeatureEnabled('nope', { search: '', storage })).toBe(false);
  });
});
