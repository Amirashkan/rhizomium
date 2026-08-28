#!/usr/bin/env python3
"""
collab_grant.py - verify a gallery-signed tier grant, in Python.

This is a line-for-line port of the checks in `api/_lib/grant.js`, and it
exists because the two things that have to refuse an unentitled caller are
written in different languages: the AI backend is a Node function, and the
collab room relay is this repo's Python. Both verify the same token, issued by
the same gallery, with the same secret.

Format, which must stay byte-compatible with the gallery's `signGrant()` and
with grant.js:

    <base64url(payload-json)>.<base64url(hmac-sha256(secret, first-part))>

Deliberately not a JWT: there is no algorithm field for a caller to argue
about, and the only accepted algorithm is the one written here.

`tests/collabRelayGrant.test.js` signs tokens in Node and verifies them through
this module, so the two implementations cannot drift apart quietly.

## What a grant means to the relay

For the AI backend a grant authorises one model call. For the relay it
authorises one *admission*: the peer presented a valid grant naming
`collab.space` when it joined, and it stays in the room until its socket
closes. Re-checking mid-session would mean throwing a paying artist out of a
live room the moment a five-minute token aged out, which is worse than the
thing it would prevent. A reconnecting editor asks the gallery for a fresh
grant and is admitted again on that one.
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Optional, Tuple

__all__ = [
    'COLLAB_FEATURE',
    'check_admission',
    'GRANT_MISSING_SECRET',
    'GRANT_MALFORMED',
    'GRANT_BAD_SIGNATURE',
    'GRANT_EXPIRED',
    'GRANT_WRONG_FEATURE',
    'GRANT_REPLAYED',
    'verify_grant',
    'GrantReplayGuard',
]

# Reasons a token is refused. These are for the operator's log, never for the
# caller: telling someone which check failed is free information for whoever is
# trying to forge one. The relay answers every failure with the same code.
GRANT_MISSING_SECRET = 'missing_secret'
GRANT_MALFORMED = 'malformed'
GRANT_BAD_SIGNATURE = 'bad_signature'
GRANT_EXPIRED = 'expired'
GRANT_WRONG_FEATURE = 'wrong_feature'
GRANT_REPLAYED = 'replayed'

# The entitlement a grant has to name to open a room. Mirrors `collab.space` in
# src/ai/tiers.js and in the gallery's catalogue. Feature keys are permanent —
# they end up in issued grants and usage rows — so this is a constant.
COLLAB_FEATURE = 'collab.space'

# What the relay says out loud. `grant_required` is separate from
# `grant_invalid` because it is nearly always an honest configuration mismatch
# with a different remedy, and it gives nothing away: whoever connected can
# already see that no grant was sent, having not sent one.
REFUSED_REQUIRED = 'grant_required'
REFUSED_INVALID = 'grant_invalid'

# Grants live five minutes at the gallery; anything older than this window can
# never be replayed because the expiry check has already refused it. Matches
# REPLAY_WINDOW_MS in grant.js.
REPLAY_WINDOW_SECONDS = 10 * 60


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def _b64url_decode(text: str) -> bytes:
    padding = '=' * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def verify_grant(
    token: Optional[str],
    secret: Optional[str],
    *,
    feature: Optional[str] = None,
    now: Optional[float] = None,
) -> Tuple[Optional[dict], Optional[str]]:
    """
    Check a grant and return `(payload, None)`, or `(None, reason)`.

    `feature` binds the token to one entitlement: a grant the gallery issued for
    an AI action is a valid signature and still not permission to join a room,
    so the relay passes `collab.space` here and a token naming anything else is
    refused.

    The reason is returned rather than raised because every failure has the same
    answer to the caller — a refusal — and differs only in what gets logged.
    """
    if not secret:
        return None, GRANT_MISSING_SECRET

    parts = str(token or '').split('.')
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None, GRANT_MALFORMED

    body, signature = parts
    expected = _b64url_encode(
        hmac.new(secret.encode('utf-8'), body.encode('utf-8'), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(expected, signature):
        return None, GRANT_BAD_SIGNATURE

    try:
        payload = json.loads(_b64url_decode(body).decode('utf-8'))
    except (ValueError, UnicodeDecodeError, base64.binascii.Error):
        return None, GRANT_MALFORMED

    if not isinstance(payload, dict):
        return None, GRANT_MALFORMED
    if not isinstance(payload.get('feature'), str):
        return None, GRANT_MALFORMED
    # `exp` is seconds since the epoch. A bool is an int in Python and would
    # sail through an isinstance check, so it is excluded explicitly.
    exp = payload.get('exp')
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return None, GRANT_MALFORMED

    moment = time.time() if now is None else now
    if exp <= int(moment):
        return None, GRANT_EXPIRED

    if feature is not None and payload['feature'] != feature:
        return None, GRANT_WRONG_FEATURE

    return payload, None


class GrantReplayGuard:
    """
    Remembers the grant ids it has admitted, so one grant admits one peer.

    A grant is a licence to join, and a licence that can be copied into eight
    browsers is a licence one subscriber can hand to a room full of people. The
    `jti` is in the payload for exactly this, and unlike the AI backend — which
    runs serverless, so an in-process set only catches replays that land on the
    same warm instance — the relay is one long-lived process, which is where
    remembering ids actually works.

    Ids are forgotten after the replay window, because a grant older than that
    is already refused by its own expiry.
    """

    def __init__(self, window_seconds: float = REPLAY_WINDOW_SECONDS):
        self.window_seconds = window_seconds
        self._seen = {}

    def claim(self, jti: Optional[str], *, now: Optional[float] = None) -> bool:
        """True when this id has not been admitted before."""
        if not jti:
            # Nothing to key on. The expiry check is the backstop, same as
            # grant.js: a grant without a jti is still short-lived.
            return True

        moment = time.time() if now is None else now
        for seen_id, seen_at in list(self._seen.items()):
            if moment - seen_at > self.window_seconds:
                del self._seen[seen_id]

        if jti in self._seen:
            return False
        self._seen[jti] = moment
        return True

    def forget_all(self):
        self._seen.clear()


def check_admission(
    token: Optional[str],
    secret: Optional[str],
    guard: Optional['GrantReplayGuard'] = None,
    *,
    feature: str = COLLAB_FEATURE,
    now: Optional[float] = None,
) -> Tuple[Optional[dict], Optional[str], Optional[str]]:
    """
    The whole admission decision for one hello, in one place.

    Returns `(payload, refusal_code, log_reason)`:

      - `(None, None, None)` — this relay is not checking grants. Everyone in.
      - `(payload, None, None)` — admitted, and this is what the gallery said.
      - `(None, code, reason)` — refused. `code` is what the peer is told and
        `reason` is what the operator's log gets, and they are deliberately
        different: every way of failing verification answers with one code, so
        that someone probing with forged tokens learns nothing from the
        difference between "wrong signature" and "expired".

    It lives here rather than in the relay so that the policy can be tested
    without a socket, an event loop, or aiohttp installed — see
    tests/collabRelayGrant.test.js.
    """
    if not secret:
        return None, None, None

    if not token:
        return None, REFUSED_REQUIRED, None

    payload, reason = verify_grant(token, secret, feature=feature, now=now)
    if payload is None:
        return None, REFUSED_INVALID, reason

    # One grant, one admission. The gallery issues a fresh one per join, so a
    # second peer arriving on the same token is a copied token.
    if guard is not None and not guard.claim(payload.get('jti'), now=now):
        return None, REFUSED_INVALID, GRANT_REPLAYED

    return payload, None, None
