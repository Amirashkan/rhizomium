/**
 * featureFlags.js — features that ship in the code but stay out of sight until
 * they are switched on.
 *
 * A flag's default is what every artist gets. To switch one on for yourself:
 *
 *   - in the URL:  ?flags=coPerformer        (comma-separate several)
 *   - persisted:   localStorage['rhizomium.flags'] = '{"coPerformer":true}'
 *                  or, from the console, setFeatureFlag('coPerformer', true)
 *
 * The URL wins over storage, so a link can show a flagged feature without
 * touching anyone's saved settings. Flags are read once per call and never
 * cached: they are checked at boot, not per frame.
 */

export const FEATURE_FLAG_DEFAULTS = Object.freeze({
  // The coPerformer panel (show builder, director, sets). The engine is still
  // built so scripts and window.performer keep working; only the panel and its
  // menu row are held back until the feature is ready to ship.
  coPerformer: false,
});

export const FEATURE_FLAGS_STORAGE_KEY = 'rhizomium.flags';

function readStoredFlags(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(FEATURE_FLAGS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readUrlFlags(search) {
  try {
    const raw = new URLSearchParams(search || '').get('flags');
    if (!raw) return {};
    const flags = {};
    for (const name of raw.split(',')) {
      const trimmed = name.trim();
      if (trimmed) flags[trimmed] = true;
    }
    return flags;
  } catch {
    return {};
  }
}

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Is this feature switched on? Unknown names are off.
 *
 * @param {string} name
 * @param {{ search?: string, storage?: Storage|null }} [env] for tests
 */
export function isFeatureEnabled(name, env = {}) {
  const search = env.search ?? (typeof window !== 'undefined' ? window.location?.search : '');
  const storage = 'storage' in env ? env.storage : defaultStorage();

  const fromUrl = readUrlFlags(search);
  if (name in fromUrl) return !!fromUrl[name];

  const stored = readStoredFlags(storage);
  if (name in stored) return !!stored[name];

  return !!FEATURE_FLAG_DEFAULTS[name];
}

/** Persist a flag for this browser. Takes effect on the next reload. */
export function setFeatureFlag(name, enabled, storage = defaultStorage()) {
  if (!storage) return false;
  const stored = readStoredFlags(storage);
  stored[name] = !!enabled;
  try {
    storage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}
