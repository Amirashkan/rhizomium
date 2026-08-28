// One grant format, two verifiers, in two languages.
//
// `api/_lib/grant.js` guards the AI backend and `collab_grant.py` guards the
// collab room relay. They check tokens the same gallery signed, with the same
// secret, and they were written months apart in different languages — which is
// exactly the arrangement where a padding rule or an encoding choice drifts and
// nobody notices until a paying artist is refused at a door that should have
// opened.
//
// So this signs tokens in Node the way the gallery does, and runs every one of
// them through BOTH verifiers, asserting they agree. A change to either side
// that breaks the format fails here rather than in production.

import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyGrant, resetClaimedGrants } from '../api/_lib/grant.js';

// vitest runs from the repo root, which is where collab_grant.py lives. Other
// tests reading repo files (desktopAccount, aiRequestTimeout) do the same.
const REPO_ROOT = process.cwd();
const SECRET = 'a-shared-secret-the-browser-never-sees';
const FEATURE = 'collab.space';

/** Is there a python3 to run the other half against? */
function pythonAvailable() {
  try {
    execFileSync('python3', ['-c', 'import sys'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_PYTHON = pythonAvailable();

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign a grant the way the gallery's `signGrant()` does.
 *
 * Duplicated here rather than imported because the point of the test is to
 * check the two verifiers against the *format*, and a signer shared with either
 * of them would move whenever it moved.
 */
function sign(payload, secret = SECRET) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${base64url(createHmac('sha256', secret).update(body).digest())}`;
}

function grantPayload(overrides = {}) {
  return {
    feature: FEATURE,
    tier: 'cloude',
    jti: `jti-${Math.random().toString(36).slice(2)}`,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

/**
 * Run one hello's grant through the relay's whole admission decision.
 *
 * `check_admission` is what collab_room_server.py calls; testing it directly is
 * what makes the gate testable at all from here, since the relay itself needs
 * aiohttp and an event loop and this suite has neither.
 */
function admit(token, { secret = SECRET, guard = false } = {}) {
  const script = [
    'import json, sys',
    'from collab_grant import GrantReplayGuard, check_admission',
    'guard = GrantReplayGuard() if sys.argv[3] == "1" else None',
    'tokens = json.loads(sys.argv[1])',
    'out = []',
    'for tok in tokens:',
    '    payload, code, reason = check_admission(tok, sys.argv[2] or None, guard)',
    '    out.append({"ok": code is None, "code": code, "reason": reason, "payload": payload})',
    'print(json.dumps(out))',
  ].join('\n');

  const tokens = Array.isArray(token) ? token : [token];
  const out = execFileSync(
    'python3',
    ['-c', script, JSON.stringify(tokens), secret ?? '', guard ? '1' : '0'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  const answers = JSON.parse(out);
  return Array.isArray(token) ? answers : answers[0];
}

/** Run one token through collab_grant.py and report what it decided. */
function verifyInPython(token, { secret = SECRET, feature = FEATURE } = {}) {
  const script = [
    'import json, sys',
    'from collab_grant import verify_grant',
    'payload, reason = verify_grant(sys.argv[1] or None, sys.argv[2] or None,',
    '                               feature=(sys.argv[3] or None))',
    'print(json.dumps({"ok": payload is not None, "reason": reason, "payload": payload}))',
  ].join('\n');

  const out = execFileSync('python3', ['-c', script, token ?? '', secret ?? '', feature ?? ''], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/** Run the same token through the Node verifier the AI backend uses. */
function verifyInNode(token, { secret = SECRET } = {}) {
  const before = process.env.TIER_GRANT_SECRET;
  process.env.TIER_GRANT_SECRET = secret;
  let reason = null;
  try {
    const payload = verifyGrant(token, { onInvalid: (r) => { reason = r; } });
    return { ok: payload !== null, reason, payload };
  } finally {
    if (before === undefined) delete process.env.TIER_GRANT_SECRET;
    else process.env.TIER_GRANT_SECRET = before;
  }
}

describe.skipIf(!HAS_PYTHON)('the relay and the AI backend read the same grant', () => {
  beforeEach(() => resetClaimedGrants());

  it('both accept a grant the gallery signed', () => {
    const payload = grantPayload();
    const token = sign(payload);

    const fromPython = verifyInPython(token);
    const fromNode = verifyInNode(token);

    expect(fromPython.ok).toBe(true);
    expect(fromNode.ok).toBe(true);
    // Not just "accepted" — the same payload came back out of both.
    expect(fromPython.payload).toEqual(payload);
    expect(fromNode.payload).toEqual(payload);
  });

  it('both refuse a payload edited after signing', () => {
    const token = sign(grantPayload({ tier: 'free' }));
    const [, signature] = token.split('.');
    const forged = `${base64url(JSON.stringify(grantPayload({ tier: 'cloude_plus' })))}.${signature}`;

    expect(verifyInPython(forged).ok).toBe(false);
    expect(verifyInNode(forged).ok).toBe(false);
    expect(verifyInPython(forged).reason).toBe('bad_signature');
  });

  it('both refuse a grant signed with somebody else’s secret', () => {
    const token = sign(grantPayload(), 'not-the-gallery');
    expect(verifyInPython(token).ok).toBe(false);
    expect(verifyInNode(token).ok).toBe(false);
  });

  it('both refuse an expired grant', () => {
    const token = sign(grantPayload({ exp: Math.floor(Date.now() / 1000) - 1 }));
    expect(verifyInPython(token)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyInNode(token)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('both refuse a token that is not two parts', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.sig', 'body.']) {
      expect(verifyInPython(bad).ok).toBe(false);
      expect(verifyInNode(bad).ok).toBe(false);
    }
  });

  it('agrees on a payload with characters that encode awkwardly', () => {
    // Non-ASCII and padding-length edges are where two base64url
    // implementations part company, so put both in one payload.
    const payload = grantPayload({ tier: 'cloude', note: 'Ada — Ångström ✎ 好' });
    const token = sign(payload);

    expect(verifyInPython(token).payload).toEqual(payload);
    expect(verifyInNode(token).payload).toEqual(payload);
  });

  it('the relay additionally refuses a valid grant for a different feature', () => {
    // The one check the AI backend makes elsewhere (api/ai/run.js compares the
    // grant's feature against what it serves) and the relay makes inline: a
    // signature is proof the gallery issued the token, not proof it issued it
    // for this door.
    const token = sign(grantPayload({ feature: 'ai.node_generator' }));

    expect(verifyInNode(token).ok).toBe(true); // signature is genuine
    expect(verifyInPython(token)).toMatchObject({ ok: false, reason: 'wrong_feature' });
  });
});

describe.skipIf(!HAS_PYTHON)('one grant admits one peer', () => {
  it('refuses the second peer arriving on a copied token', () => {
    const script = [
      'from collab_grant import GrantReplayGuard',
      'guard = GrantReplayGuard()',
      'print(guard.claim("jti-1"), guard.claim("jti-1"), guard.claim("jti-2"))',
    ].join('\n');
    const out = execFileSync('python3', ['-c', script], { cwd: REPO_ROOT, encoding: 'utf8' });

    expect(out.trim()).toBe('True False True');
  });

  it('forgets an id once it is too old to be replayed anyway', () => {
    const script = [
      'from collab_grant import GrantReplayGuard',
      'guard = GrantReplayGuard(window_seconds=60)',
      'guard.claim("jti-1", now=0)',
      // Past the window the id is dropped — but a grant that old is already
      // refused by its own expiry, so nothing is being let through here.
      'print(guard.claim("jti-1", now=30), guard.claim("jti-1", now=1000))',
    ].join('\n');
    const out = execFileSync('python3', ['-c', script], { cwd: REPO_ROOT, encoding: 'utf8' });

    expect(out.trim()).toBe('False True');
  });

  it('lets a grant with no id through, leaving expiry as the backstop', () => {
    const script = [
      'from collab_grant import GrantReplayGuard',
      'guard = GrantReplayGuard()',
      'print(guard.claim(None), guard.claim(None), guard.claim(""))',
    ].join('\n');
    const out = execFileSync('python3', ['-c', script], { cwd: REPO_ROOT, encoding: 'utf8' });

    expect(out.trim()).toBe('True True True');
  });
});

describe.skipIf(!HAS_PYTHON)('what the relay lets through the door', () => {
  it('admits a peer carrying a grant for this feature', () => {
    const answer = admit(sign(grantPayload()));
    expect(answer).toMatchObject({ ok: true, code: null });
    expect(answer.payload.tier).toBe('cloude');
  });

  it('lets everyone in when no secret is configured', () => {
    // The loopback default. A relay with nothing to check must not start
    // refusing people because they did not bring a pass it never wanted.
    expect(admit(null, { secret: '' })).toMatchObject({ ok: true, payload: null });
    expect(admit(sign(grantPayload()), { secret: '' })).toMatchObject({ ok: true, payload: null });
  });

  it('tells a peer with no pass apart from a peer with a bad one', () => {
    // Different problems, different remedies: the first is usually an editor
    // that could not reach the gallery, the second is a token that did not
    // verify. Only the second is worth being cagey about.
    expect(admit(null)).toMatchObject({ code: 'grant_required' });
    expect(admit(sign(grantPayload(), 'wrong-secret'))).toMatchObject({ code: 'grant_invalid' });
  });

  it('gives every failed check the same answer, and only the log the reason', () => {
    const refusals = admit([
      sign(grantPayload(), 'wrong-secret'),
      sign(grantPayload({ exp: Math.floor(Date.now() / 1000) - 1 })),
      sign(grantPayload({ feature: 'ai.node_generator' })),
      'not-a-token',
    ]);

    expect(refusals.map((r) => r.code)).toEqual(Array(4).fill('grant_invalid'));
    // The operator still gets to see which one it was.
    expect(refusals.map((r) => r.reason))
      .toEqual(['bad_signature', 'expired', 'wrong_feature', 'malformed']);
  });

  it('admits the first peer on a grant and refuses the copy', () => {
    const token = sign(grantPayload());
    const [first, second] = admit([token, token], { guard: true });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ code: 'grant_invalid', reason: 'replayed' });
  });
});
