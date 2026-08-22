/**
 * The tier catalogue, vendored from the gallery's `lib/tiers.ts`.
 *
 * The gallery (art.tenderworld.org) owns the accounts and is the authority on
 * tiers. That file is written with no server imports specifically so this
 * project can mirror it; this is that mirror, ported to plain JS because the
 * editor has no TypeScript build.
 *
 * Use it to decide **what to draw**. Never use it to decide what to *do* —
 * anything paid goes through `requestGrant()` in entitlements.js, which asks
 * the gallery, and then through the AI backend, which verifies the signed
 * answer. This file drifting costs a wrong-looking button, not a free upgrade.
 *
 * Source of truth: tenderworld-gallery `lib/tiers.ts`. When that changes, this
 * changes. See AI_TIER_INTEGRATION.md.
 */

export const TIERS = ['free', 'cloude', 'cloude_plus'];

/** Higher wins. Used for "at least this tier" comparisons. */
export const TIER_RANK = {
  free: 0,
  cloude: 1,
  cloude_plus: 2,
};

export const TIER_LABELS = {
  free: 'Free',
  cloude: 'Cloude',
  cloude_plus: 'Cloude Plus',
};

export const TIER_DESCRIPTIONS = {
  free: 'The open-source editor and the AI features that assist work already on the canvas.',
  cloude: 'Everything in Free, plus the web viewer, the pro artist panel, and the generative AI features.',
  cloude_plus: 'Everything in Cloude, plus live output, server-side rendering, and the AI creative director.',
};

export function isTier(value) {
  return typeof value === 'string' && TIERS.includes(value);
}

/**
 * Every capability the two projects gate on.
 *
 * Keys are namespaced and permanent: they end up in stored grants, usage rows
 * and both projects' source. Renaming one is a migration, so add rather than
 * rename.
 *
 * `surface` is 'editor', 'gallery' or 'output' — filter on it to build UI
 * without having to know about the gallery-only features.
 *
 * `metered` means a call spends quota. Unmetered features are flags: checking
 * access is free and costs nothing from the allowance.
 */
export const FEATURES = {
  // --- Free: AI that works on what the artist already made -----------------
  'ai.patch_review': {
    tier: 'free',
    surface: 'editor',
    label: 'Patch review',
    description: 'Reads an existing patch and reports problems, dead nodes and likely mistakes.',
    metered: true,
  },
  'ai.patch_refactor': {
    tier: 'free',
    surface: 'editor',
    label: 'Patch refactor',
    description: 'Rewrites and tidies an existing patch without changing what it renders.',
    metered: true,
  },
  'ai.canvas_assist': {
    tier: 'free',
    surface: 'editor',
    label: 'Canvas assist',
    description: 'Inline suggestions while editing: naming, wiring, parameter hints.',
    metered: true,
  },

  // --- Cloude: generative AI, and the paid gallery surfaces -----------------
  'ai.patch_generator': {
    tier: 'cloude',
    surface: 'editor',
    label: 'Patch generator',
    description: 'Builds a whole patch from a prompt.',
    metered: true,
  },
  'ai.node_generator': {
    tier: 'cloude',
    surface: 'editor',
    label: 'Node generator',
    description: 'Writes a new custom node, GLSL included, from a description.',
    metered: true,
  },
  'viewer.web': {
    tier: 'cloude',
    surface: 'gallery',
    label: 'Web viewer',
    description: 'Runs a published patch live in the browser instead of showing a rendered still.',
    metered: false,
  },
  'gallery.pro_artist_panel': {
    tier: 'cloude',
    surface: 'gallery',
    label: 'Pro artist panel',
    description: 'The extended artist tooling in the gallery: analytics, space controls, publishing options.',
    metered: false,
  },

  // --- Cloude Plus: structure in place, not fully operated yet --------------
  'output.ndi': {
    tier: 'cloude_plus',
    surface: 'output',
    label: 'NDI output',
    description: 'Sends the render out over NDI to other machines on the network.',
    metered: false,
  },
  'output.multiscreen': {
    tier: 'cloude_plus',
    surface: 'output',
    label: 'Multi-screen output',
    description: 'Drives several displays from one patch, with per-screen framing.',
    metered: false,
  },
  'render.server_side': {
    tier: 'cloude_plus',
    surface: 'output',
    label: 'Server-side rendering',
    description: 'Renders a patch on the server rather than on the artist’s machine.',
    metered: true,
  },
  'ai.creative_director': {
    tier: 'cloude_plus',
    surface: 'editor',
    label: 'AI creative director',
    description: 'Long-running direction over a whole piece: sequencing, variation, critique across sessions.',
    metered: true,
  },
};

export const FEATURE_KEYS = Object.keys(FEATURES);

export function isFeatureKey(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURES, value);
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Quota per tier, per window, for the metered features.
 *
 * A feature missing from a tier's table is not sold at that tier and resolves
 * to zero — the tier check would have refused it first, so the zero is a
 * backstop rather than the gate.
 *
 * These are the values as vendored. The live numbers come from
 * /api/entitlements — read `catalog[].quota` there rather than this table when
 * showing an artist what they have left.
 */
export const QUOTAS = {
  free: {
    'ai.patch_review': { limit: 15, windowSeconds: DAY },
    'ai.patch_refactor': { limit: 15, windowSeconds: DAY },
    'ai.canvas_assist': { limit: 60, windowSeconds: DAY },
  },
  cloude: {
    'ai.patch_review': { limit: 200, windowSeconds: DAY },
    'ai.patch_refactor': { limit: 200, windowSeconds: DAY },
    'ai.canvas_assist': { limit: 1000, windowSeconds: DAY },
    'ai.patch_generator': { limit: 100, windowSeconds: DAY },
    'ai.node_generator': { limit: 100, windowSeconds: DAY },
  },
  cloude_plus: {
    'ai.patch_review': { limit: 1000, windowSeconds: DAY },
    'ai.patch_refactor': { limit: 1000, windowSeconds: DAY },
    'ai.canvas_assist': { limit: 5000, windowSeconds: DAY },
    'ai.patch_generator': { limit: 500, windowSeconds: DAY },
    'ai.node_generator': { limit: 500, windowSeconds: DAY },
    'ai.creative_director': { limit: 100, windowSeconds: DAY },
    'render.server_side': { limit: 50, windowSeconds: DAY },
  },
};

/**
 * What a signed-out visitor gets: one third of the free column, rounded down,
 * minimum 1. They are on the free tier by definition — "free" here means
 * everyone who visits, not everyone with an account — but there is no account
 * to count against, so the allowance is smaller and the remedy for hitting it
 * is signing in, which is free.
 */
export const ANONYMOUS_QUOTA_DIVISOR = 3;

export function quotaFor(tier, feature) {
  if (!FEATURES[feature]?.metered) return null;
  return QUOTAS[tier]?.[feature] ?? { limit: 0, windowSeconds: HOUR };
}

/** True when `tier` is at least `required`. */
export function tierAtLeast(tier, required) {
  return (TIER_RANK[tier] ?? -1) >= (TIER_RANK[required] ?? Infinity);
}

export function hasFeature(tier, feature) {
  if (!isFeatureKey(feature)) return false;
  return tierAtLeast(tier, FEATURES[feature].tier);
}

export function featuresForTier(tier) {
  return FEATURE_KEYS.filter((key) => hasFeature(tier, key));
}

/** The tier a feature needs, for an upsell message. */
export function requiredTier(feature) {
  return FEATURES[feature]?.tier ?? 'cloude_plus';
}

export function featureLabel(feature) {
  return FEATURES[feature]?.label ?? feature;
}

export function tierLabel(tier) {
  return TIER_LABELS[tier] ?? TIER_LABELS.free;
}

/** The editor-surface features, in catalogue order — what this app draws. */
export function editorFeatures() {
  return FEATURE_KEYS.filter((key) => FEATURES[key].surface === 'editor');
}

/**
 * The tier actually in force, which is not always the one stored.
 *
 * Mirrors public.effective_tier() in the gallery's schema and resolveTier() in
 * its lib/tiers.ts. The editor rarely needs this — /api/entitlements has
 * already resolved it — but a cached `auth/check` payload carries the raw
 * columns, and an expired subscription should read as free here too.
 */
export function resolveTier(record, now = new Date()) {
  if (!record) return 'free';
  if (record.is_banned) return 'free';
  if (!isTier(record.tier)) return 'free';
  if (record.tier_expires_at) {
    const expires = new Date(record.tier_expires_at);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
      return 'free';
    }
  }
  return record.tier;
}
