import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { verifyGrant, grantsConfigured, claimGrantId, resetClaimedGrants } from '../api/_lib/grant.js';
import { validateGeneratedPatch, nodeCatalogText, isKnownKind } from '../api/_lib/nodeCatalog.js';
import { featureConfig, buildUserMessage, IMPLEMENTED_FEATURES } from '../api/_lib/features.js';

/**
 * The AI backend's gate.
 *
 * This is the half of the tier system that actually enforces anything — the
 * editor's buttons are a drawing, and the gallery's answer only matters
 * because this refuses to spend a model call without it. The tests below sign
 * grants exactly the way the gallery's lib/entitlements.ts does, so a drift in
 * either signer shows up here rather than in production.
 */

const SECRET = 'a'.repeat(64);

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Byte-for-byte the gallery's signGrant(). */
function signGrant({ feature = 'ai.patch_review', tier = 'free', sub = 'user-1', ttl = 300, secret = SECRET } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = { jti: randomUUID(), feature, tier, sub, iat, exp: iat + ttl };
  const body = b64url(JSON.stringify(payload));
  const signature = b64url(createHmac('sha256', secret).update(body).digest());
  return { token: `${body}.${signature}`, payload, body, signature };
}

describe('verifyGrant', () => {
  beforeEach(() => {
    process.env.TIER_GRANT_SECRET = SECRET;
    resetClaimedGrants();
  });

  afterEach(() => {
    delete process.env.TIER_GRANT_SECRET;
  });

  it('accepts a grant the gallery signed', () => {
    const { token, payload } = signGrant({ feature: 'ai.patch_generator', tier: 'cloude' });
    const verified = verifyGrant(token);

    expect(verified).not.toBeNull();
    expect(verified.feature).toBe('ai.patch_generator');
    expect(verified.tier).toBe('cloude');
    expect(verified.jti).toBe(payload.jti);
  });

  it('accepts a signed-out visitor, whose sub is null', () => {
    const { token } = signGrant({ sub: null });
    expect(verifyGrant(token).sub).toBeNull();
  });

  it('refuses a payload edited to claim a better feature', () => {
    const { payload, signature } = signGrant({ feature: 'ai.patch_review', tier: 'free' });
    const forged = b64url(
      JSON.stringify({ ...payload, feature: 'ai.creative_director', tier: 'cloude_plus' })
    );

    expect(verifyGrant(`${forged}.${signature}`)).toBeNull();
  });

  it('refuses a grant signed with a different secret', () => {
    const { token } = signGrant({ secret: 'b'.repeat(64) });
    expect(verifyGrant(token)).toBeNull();
  });

  it('refuses an expired grant', () => {
    const { token } = signGrant({ ttl: -1 });
    expect(verifyGrant(token)).toBeNull();
  });

  it('refuses a grant that is about to expire only once it has', () => {
    const { token } = signGrant({ ttl: 60 });
    expect(verifyGrant(token)).not.toBeNull();
    // Ninety seconds later, the same token is dead.
    expect(verifyGrant(token, { now: Date.now() + 90_000 })).toBeNull();
  });

  it('refuses malformed tokens without throwing', () => {
    for (const bad of ['', null, undefined, 'nodot', 'a.b.c', '.sig', 'body.', 'x'.repeat(500)]) {
      expect(verifyGrant(bad)).toBeNull();
    }
  });

  it('refuses a truncated signature rather than throwing on length mismatch', () => {
    const { body, signature } = signGrant();
    expect(verifyGrant(`${body}.${signature.slice(0, 8)}`)).toBeNull();
  });

  it('refuses everything when no secret is configured', () => {
    const { token } = signGrant();
    delete process.env.TIER_GRANT_SECRET;

    expect(grantsConfigured()).toBe(false);
    expect(verifyGrant(token)).toBeNull();
  });

  it('reports why it refused, for the log but not the caller', () => {
    const reasons = [];
    verifyGrant('rubbish', { onInvalid: (reason) => reasons.push(reason) });
    verifyGrant(signGrant({ ttl: -1 }).token, { onInvalid: (reason) => reasons.push(reason) });

    expect(reasons).toEqual(['malformed', 'expired']);
  });
});

describe('single-use grant ids', () => {
  beforeEach(() => resetClaimedGrants());

  it('lets a grant id through once', () => {
    const id = randomUUID();
    expect(claimGrantId(id)).toBe(true);
    expect(claimGrantId(id)).toBe(false);
  });

  it('does not block distinct grants', () => {
    expect(claimGrantId(randomUUID())).toBe(true);
    expect(claimGrantId(randomUUID())).toBe(true);
  });

  it('forgets ids once they are past any possible expiry', () => {
    const id = randomUUID();
    expect(claimGrantId(id, { now: 0 })).toBe(true);
    // Eleven minutes on, a five-minute grant cannot be replayed anyway.
    expect(claimGrantId(id, { now: 11 * 60 * 1000 })).toBe(true);
  });

  it('does not block when there is no id to key on', () => {
    expect(claimGrantId(undefined)).toBe(true);
    expect(claimGrantId(undefined)).toBe(true);
  });
});

describe('feature configuration', () => {
  it('serves every metered AI feature in the catalogue', () => {
    expect(IMPLEMENTED_FEATURES).toEqual([
      'ai.patch_review',
      'ai.patch_refactor',
      'ai.canvas_assist',
      'ai.patch_generator',
      'ai.node_generator',
      'ai.creative_director',
    ]);
  });

  it('has no config for a feature this backend does not serve', () => {
    expect(featureConfig('render.server_side')).toBeNull();
    expect(featureConfig('viewer.web')).toBeNull();
    expect(featureConfig('nonsense')).toBeNull();
  });

  it('marks the expensive feature single-use and the cheap one not', () => {
    expect(featureConfig('ai.creative_director').singleUse).toBe(true);
    expect(featureConfig('ai.canvas_assist').singleUse).toBe(false);
  });

  it('gives every feature a closed schema unless it carries free-form params', () => {
    for (const key of IMPLEMENTED_FEATURES) {
      const config = featureConfig(key);
      expect(config.tool.input_schema.additionalProperties).toBe(false);
      // Only the two patch-bearing tools opt out of strict mode.
      const expectStrict = key !== 'ai.patch_refactor' && key !== 'ai.patch_generator';
      expect(config.strict).toBe(expectStrict);
    }
  });

  it('refuses to build a message for a generator with nothing to go on', () => {
    expect(() => buildUserMessage('ai.patch_generator', {})).toThrow(/Describe the patch/);
    expect(() => buildUserMessage('ai.node_generator', { description: '   ' })).toThrow(/Describe the node/);
  });

  it('puts the selected nodes in front of canvas assist', () => {
    const message = buildUserMessage('ai.canvas_assist', {
      patch: { nodes: [] },
      selectedNodeIds: ['4', '7'],
    });
    expect(message).toContain('4, 7');
  });
});

describe('generated patch validation', () => {
  it('accepts a well-formed patch', () => {
    const { patch, warnings } = validateGeneratedPatch({
      nodes: [
        { id: '1', kind: 'UV', x: 0, y: 0, params: {} },
        { id: '2', kind: 'OutputFinal', x: 220, y: 0, params: {} },
      ],
      connections: [{ from: { nodeId: '1', pin: 0 }, to: { nodeId: '2', pin: 0 } }],
    });

    expect(patch.nodes).toHaveLength(2);
    expect(patch.connections).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('refuses a node kind that does not exist', () => {
    expect(() =>
      validateGeneratedPatch({
        nodes: [{ id: '1', kind: 'HallucinatedNode' }, { id: '2', kind: 'OutputFinal' }],
        connections: [],
      })
    ).toThrow(/does not exist/);
  });

  it('refuses a patch that would render nothing', () => {
    expect(() =>
      validateGeneratedPatch({ nodes: [{ id: '1', kind: 'UV' }], connections: [] })
    ).toThrow(/no output node/);
  });

  it('refuses a patch with no nodes at all', () => {
    expect(() => validateGeneratedPatch({ nodes: [], connections: [] })).toThrow(/no nodes/);
    expect(() => validateGeneratedPatch(null)).toThrow(/did not return a patch/);
  });

  it('refuses nodes that need a file the artist has to choose', () => {
    expect(() =>
      validateGeneratedPatch({
        nodes: [{ id: '1', kind: 'Texture2D' }, { id: '2', kind: 'OutputFinal' }],
        connections: [],
      })
    ).toThrow(/cannot be generated/);
  });

  it('drops a wire to a pin that does not exist rather than refusing the patch', () => {
    const { patch, warnings } = validateGeneratedPatch({
      nodes: [
        { id: '1', kind: 'UV', x: 0, y: 0 },
        { id: '2', kind: 'OutputFinal', x: 220, y: 0 },
      ],
      connections: [
        { from: { nodeId: '1', pin: 0 }, to: { nodeId: '2', pin: 0 } },
        { from: { nodeId: '1', pin: 0 }, to: { nodeId: '2', pin: 99 } },
        { from: { nodeId: '1', pin: 0 }, to: { nodeId: 'ghost', pin: 0 } },
      ],
    });

    expect(patch.connections).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });

  it('strips parameters the node does not declare', () => {
    const { patch } = validateGeneratedPatch({
      nodes: [
        { id: '1', kind: 'Add', x: 0, y: 0, params: { a: 2, invented: 'nonsense' } },
        { id: '2', kind: 'OutputFinal', x: 220, y: 0 },
      ],
      connections: [],
    });

    expect(patch.nodes[0].params).toEqual({ a: 2 });
  });

  it('renames duplicate ids instead of silently losing a node', () => {
    const { patch, warnings } = validateGeneratedPatch({
      nodes: [
        { id: '1', kind: 'UV' },
        { id: '1', kind: 'UV' },
        { id: '2', kind: 'OutputFinal' },
      ],
      connections: [],
    });

    expect(patch.nodes).toHaveLength(3);
    expect(new Set(patch.nodes.map((n) => n.id)).size).toBe(3);
    expect(warnings[0]).toMatch(/Duplicate node id/);
  });
});

describe('node catalogue prompt text', () => {
  it('lists real node kinds and nothing else', () => {
    const text = nodeCatalogText();
    expect(text).toContain('OutputFinal');
    expect(text).toContain('CustomGLSL');
    expect(isKnownKind('OutputFinal')).toBe(true);
    expect(isKnownKind('HallucinatedNode')).toBe(false);
  });

  it('renders every pin, whether it is a bare label or a typed object', () => {
    // Both shapes exist across the node files; neither may leak as [object Object].
    expect(nodeCatalogText()).not.toContain('[object Object]');
  });

  it('is byte-identical between calls, so it can sit behind a cache breakpoint', () => {
    expect(nodeCatalogText()).toBe(nodeCatalogText());
  });
});
