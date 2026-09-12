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
 * changes. See docs/internal/AI_TIER_INTEGRATION.md.
 */

/**
 * The tiers an account can be sold and stored on.
 *
 * `admin` is deliberately not here — it is not bought and never written to a
 * profile's tier column. Mirrors TIERS in the gallery's lib/tiers.ts.
 */
export const TIERS = ['free', 'cloude', 'cloude_plus'];

/** Higher wins. Used for "at least this tier" comparisons. */
export const TIER_RANK = {
  free: 0,
  cloude: 1,
  cloude_plus: 2,
  // Above everything, and not sold. See TIER_DESCRIPTIONS.admin.
  admin: 3,
};

/**
 * `cloude_plus` is labelled Studio, and was labelled Cloude Plus. Only the
 * label moved: the key is in stored grants, so renaming it is a migration.
 */
export const TIER_LABELS = {
  free: 'Free',
  cloude: 'Cloude',
  cloude_plus: 'Studio',
  admin: 'Admin',
};

export const TIER_DESCRIPTIONS = {
  free: 'The open-source editor, and AI that reads the patch you already have.',
  cloude: 'Everything in Free, plus refactoring, the generative AI features, the web viewer and the pro artist panel.',
  cloude_plus: 'Everything in Cloude, plus NDI and multi-screen output, and the AI creative director.',
  admin:
    'Everything, unmetered. Held by the people who run this — for building the features and ' +
    'supporting artists, not sold to anyone.',
};

/**
 * The tier nobody buys.
 *
 * `admin` exists because the people who build and support this app run its AI
 * features far harder than any artist does — testing a change means running it
 * a dozen times, and a plan's daily allowance is the wrong instrument for that.
 * It ranks above Studio, so every tier gate passes, and it is unmetered, so
 * `quotaFor()` returns nothing to count.
 *
 * **The gallery is the only thing that can put an account here.** Nothing in
 * this file, and nothing in the browser, decides who is an admin: the tier
 * arrives on `/api/entitlements` and inside grants the gallery signed, exactly
 * as every other tier does. A visitor who sets this in devtools gets a panel
 * with every button lit and a 401 from the backend on the first click, for the
 * same reason `cloude_plus` in devtools buys nothing — see
 * docs/internal/AI_TIER_INTEGRATION.md §Security.
 *
 * On the gallery's side it is not a subscription at all: an account is on it
 * because `profiles.role = 'admin'`, the same flag its admin dashboard
 * authorises on. That is why `resolveTier()` below reads a role, and why the
 * tier column claiming 'admin' promotes nobody.
 *
 * Nothing is *sold* at this tier, so no feature names it in `FEATURES` and
 * `requiredTier()` never returns it: an upsell that told an artist to upgrade
 * to Admin would be an offer nobody can take.
 */
export const ADMIN_TIER = 'admin';

/**
 * Whether this is a tier an account can be **put on**. `admin` fails it on
 * purpose: it comes from the account's role, and a path that could set it
 * would be a path that hands it out.
 */
export function isSubscriptionTier(value) {
  return typeof value === 'string' && TIERS.includes(value);
}

/**
 * Whether this is a tier that can be **in force** — the ones above, plus the
 * operators'. For a tier that has already been resolved: a payload from the
 * gallery, a grant. Never for one somebody is asking to set.
 */
export function isTier(value) {
  return isSubscriptionTier(value) || value === ADMIN_TIER;
}

/**
 * Every capability the two projects gate on.
 *
 * Keys are namespaced and permanent: they end up in stored grants, usage rows
 * and both projects' source. Renaming one is a migration, so add rather than
 * rename.
 *
 * `surface` is 'editor', 'gallery', 'output' or 'collab' — filter on it to
 * build UI without having to know about the gallery-only features. 'collab' is
 * its own surface rather than 'editor' because the editor-surface catalogue is
 * what the AI panel draws feature cards from, and the collab space is not an
 * AI action: it has a panel of its own (src/ui/CollabPanel.js).
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
  'ai.canvas_assist': {
    tier: 'free',
    surface: 'editor',
    label: 'Canvas assist',
    description: 'Inline suggestions while editing: naming, wiring, parameter hints.',
    metered: true,
  },

  // --- Cloude: the AI that writes, and the paid gallery surfaces ------------
  'ai.patch_refactor': {
    // Behind a subscription because it is the dearest call the editor makes —
    // its schema lets it write a whole 400-node patch back — and because it is
    // the only feature that rewrites the artist's document.
    tier: 'cloude',
    surface: 'editor',
    label: 'Patch refactor',
    description: 'Rewrites and tidies an existing patch without changing what it renders.',
    metered: true,
  },
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
  'collab.space': {
    tier: 'cloude',
    surface: 'collab',
    label: 'Collab space',
    // Says who runs the relay, because the gallery's copy does and the two
    // have to match: this text is what a locked panel shows an artist who is
    // deciding whether to pay for it.
    description:
      'Opens a patch to other artists: one shared canvas, live presence, edits as they happen. ' +
      'Runs over a relay you or a collaborator hosts — we do not host one yet.',
    metered: false,
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
    addon: 'addon.pro_artist_panel',
  },

  // --- Studio: structure in place, not fully operated yet -------------------
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
    // `tier` is inert: the add-on is the gate, and that add-on is bundled with
    // no plan and is unavailable. Studio listed this before and never served
    // it — the renderer behind the gate was never written.
    tier: 'cloude_plus',
    surface: 'output',
    label: 'Server-side rendering',
    description: 'Renders a patch on our machines rather than yours.',
    metered: true,
    addon: 'addon.server_side_rendering',
  },
  'ai.creative_director': {
    tier: 'cloude_plus',
    surface: 'editor',
    label: 'AI creative director',
    description: 'Long-running direction over a whole piece: sequencing, variation, critique across sessions.',
    metered: true,
  },
  'ai.performer_scenario': {
    // With the generative features, because it writes a document the artist
    // then performs from rather than commenting on one they made.
    tier: 'cloude',
    surface: 'editor',
    label: 'Performance scenario',
    description: 'Writes a scenario for the AI performer from a brief: sections, cues, and the signals that drive them.',
    metered: true,
  },
  'ai.performer_live': {
    // The one feature metered against a clock rather than an action: a set
    // asks every sixteen bars for as long as it runs, so its quota is a
    // number of CALLS and an artist reads it as "about this many hours of
    // set". Priced at the top tier because it is the only feature that bills
    // continuously while the artist is doing something else.
    tier: 'cloude_plus',
    surface: 'editor',
    label: 'Live performer',
    description: 'Improvises visuals inside a running scenario while you play, a few bars at a time.',
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
 *
 * `admin` is absent on purpose and is not the zero case: quotaFor() answers for
 * it before reading this table, because nothing counts an admin's usage.
 */
export const QUOTAS = {
  free: {
    'ai.patch_review': { limit: 2, windowSeconds: DAY },
    'ai.canvas_assist': { limit: 15, windowSeconds: DAY },
  },
  cloude: {
    'ai.patch_review': { limit: 5, windowSeconds: DAY },
    'ai.patch_refactor': { limit: 3, windowSeconds: DAY },
    'ai.canvas_assist': { limit: 50, windowSeconds: DAY },
    'ai.patch_generator': { limit: 1, windowSeconds: DAY },
    'ai.node_generator': { limit: 2, windowSeconds: DAY },
    'ai.performer_scenario': { limit: 2, windowSeconds: DAY },
  },
  cloude_plus: {
    'ai.patch_review': { limit: 12, windowSeconds: DAY },
    'ai.patch_refactor': { limit: 6, windowSeconds: DAY },
    'ai.canvas_assist': { limit: 150, windowSeconds: DAY },
    'ai.patch_generator': { limit: 3, windowSeconds: DAY },
    'ai.node_generator': { limit: 5, windowSeconds: DAY },
    'ai.creative_director': { limit: 1, windowSeconds: DAY },
    'ai.performer_scenario': { limit: 5, windowSeconds: DAY },
    // Per hour, not per day: this is the one feature whose spend tracks how
    // long the artist performs for rather than how many times they press a
    // button.
    //
    // The limit is still counted in CALLS, and that has stopped being a number
    // an artist can reason about. The cadence used to be fixed — one ask every
    // sixteen bars, so 40 calls was about two hours at 128 — but it now varies
    // with the music (see performer/DirectorCadence.js), which means counting
    // calls measures how eventful the set was rather than how long it ran. Two
    // artists performing the same hour can spend very different amounts of an
    // allowance that is supposed to be measured in hours.
    //
    // The client already sends what the honest number would be: every live
    // call carries `units`, the minutes of performance since the last one
    // (PerformerDirector._unitsToSpend). The gallery's grant issuer has to
    // charge those units before this line can become a minutes limit — until
    // it does, the field is ignored and one call costs one action, exactly as
    // before. Flipping this table first would only make the panel's "N left"
    // lie about a server still counting something else.
    'ai.performer_live': { limit: 40, windowSeconds: HOUR },
  },
};

/**
 * Add-ons: held on any tier, including Free, and gating a feature on their own.
 *
 * `available` is whether the thing can be SERVED and is the only flag that
 * gates access. `includedFrom` is the tier that grants it without buying it —
 * which is how the pro artist panel stays with Cloude while also being an
 * add-on. Server-side rendering is included from nothing and cannot be served,
 * so it is refused for everybody.
 */
export const ADDONS = {
  'addon.pro_artist_panel': {
    label: 'Pro artist panel',
    includedFrom: 'cloude',
    available: true,
  },
  'addon.server_side_rendering': {
    label: 'Server-side rendering',
    available: false,
    unavailableReason:
      'There is no render capacity behind it yet, and it is not yet settled whether this renders a file you download or streams a session that runs live.',
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
  // Unmetered rather than generous: a very large limit would still be a number
  // the panel counted down, and would still refuse on the day it ran out.
  // Nothing counts admin usage, so there is nothing to draw.
  if (tier === ADMIN_TIER) return null;
  // An add-on's allowance follows the add-on, not the plan, and there is no
  // add-on allowance to follow yet. Draw nothing rather than a plan's number.
  if (FEATURES[feature].addon) return { limit: 0, windowSeconds: HOUR };
  return QUOTAS[tier]?.[feature] ?? { limit: 0, windowSeconds: HOUR };
}

/** True when `tier` is at least `required`. */
export function tierAtLeast(tier, required) {
  return (TIER_RANK[tier] ?? -1) >= (TIER_RANK[required] ?? Infinity);
}

/**
 * Whether an account holds an add-on: bought outright, or included from a tier.
 *
 * Availability is checked first. An add-on nobody can be served is held by
 * nobody, so a Studio subscriber is refused for the same reason as a visitor
 * rather than being told to upgrade to something they already have.
 *
 * `held` defaults to none because nothing sells an add-on yet. When something
 * does, it arrives on the entitlements payload.
 */
export function holdsAddon(tier, addon, held = []) {
  const definition = ADDONS[addon];
  if (!definition || !definition.available) return false;
  if (held.includes(addon)) return true;
  return definition.includedFrom !== undefined && tierAtLeast(tier, definition.includedFrom);
}

/**
 * Whether an account may use a feature.
 *
 * `addons` defaults to none on purpose: a caller that has not been taught
 * about add-ons refuses an add-on feature rather than drawing it enabled and
 * then taking a 402.
 */
export function hasFeature(tier, feature, addons = []) {
  if (!isFeatureKey(feature)) return false;
  const definition = FEATURES[feature];
  if (definition.addon) return holdsAddon(tier, definition.addon, addons);
  return tierAtLeast(tier, definition.tier);
}

export function featuresForTier(tier, addons = []) {
  return FEATURE_KEYS.filter((key) => hasFeature(tier, key, addons));
}

/**
 * What stands between an account and a feature, and so what to say when it is
 * refused: buy a bigger plan, buy the add-on, or come back when we can do it.
 *
 * Prefer `catalog[].gate` from /api/entitlements over calling this — the
 * gallery is the authority and this mirror can be stale.
 */
export function gateFor(feature) {
  const addon = FEATURES[feature]?.addon;
  if (!addon) return { kind: 'tier', tier: FEATURES[feature]?.tier ?? 'cloude_plus' };

  const definition = ADDONS[addon];
  if (!definition.available) {
    return {
      kind: 'unavailable',
      addon,
      reason: definition.unavailableReason ?? 'Not available yet.',
    };
  }
  return { kind: 'addon', addon, includedFrom: definition.includedFrom };
}

/**
 * The tier a feature needs, for an upsell message.
 *
 * Only meaningful for a tier-gated feature. An add-on bundled with no plan is
 * not reachable by upgrading to anything, so the fallback names the highest
 * tier: it cannot understate what is needed, but it will name a plan that does
 * not unlock the feature. Use gateFor() where the difference matters.
 */
export function requiredTier(feature) {
  const addon = FEATURES[feature]?.addon;
  if (addon) return ADDONS[addon].includedFrom ?? 'cloude_plus';
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
 * Mirrors public.effective_tier() in the gallery's schema (add_admin_tier.sql)
 * and resolveTier() in its lib/tiers.ts. The editor rarely needs this —
 * /api/entitlements has already resolved it — but a cached `auth/check`
 * payload carries the raw columns, and an expired subscription should read as
 * free here too.
 *
 * `record` is a profile's raw columns: `tier`, `tier_expires_at`, `is_banned`
 * and `role`.
 */
export function resolveTier(record, now = new Date()) {
  if (!record) return 'free';
  if (record.is_banned) return 'free';
  // The role, ahead of the subscription columns: the admin tier does not
  // expire, and a lapsed subscription an operator also happens to have must
  // not take it away. A `tier` column claiming 'admin' promotes nobody —
  // isSubscriptionTier() refuses it, which is why this reads the role instead.
  if (record.role === ADMIN_TIER) return ADMIN_TIER;
  if (!isSubscriptionTier(record.tier)) return 'free';
  if (record.tier_expires_at) {
    const expires = new Date(record.tier_expires_at);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
      return 'free';
    }
  }
  return record.tier;
}
