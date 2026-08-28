/**
 * collabGrant.js — the pass an editor shows at the door of a gated relay.
 *
 * `collabGate.js` decides what this editor *draws*. This decides what it can
 * *prove*, which is a different question with a different answer: the gate runs
 * in a browser the visitor controls, so a determined artist can turn it off and
 * open the panel anyway. What they cannot do is forge a token signed with a
 * secret that only the gallery and the relay hold. That is why the relay is the
 * boundary and this module is how the editor gets past it.
 *
 * ## One grant per hello, never cached
 *
 * The obvious optimisation here — keep the token, it lasts five minutes, reuse
 * it on the reconnect — is wrong, and quietly so. The relay claims each grant's
 * `jti` when it admits a peer (see `GrantReplayGuard` in collab_grant.py),
 * because a grant that admits any number of peers is a licence one subscriber
 * can paste into a room full of people. A reused token is therefore a *replayed*
 * token, and the second join is refused with an error that reads like a billing
 * problem and is not one. So every hello asks for its own.
 *
 * That is affordable because `collab.space` is unmetered (src/ai/tiers.js): a
 * grant request for it costs the artist nothing from any allowance. If that key
 * ever becomes metered, this file is where the cost lands.
 *
 * ## Failing to get one is not failing to join
 *
 * A relay on loopback wants no grant at all, and that is the configuration most
 * people run — a laptop and a second machine on the same desk. So a refusal
 * here is recorded and not thrown: the editor says hello without a pass, and
 * the relay decides. If it wanted one, its refusal is the message worth showing,
 * because it is the one that knows.
 */

import { entitlements, GrantError } from '../ai/entitlements.js';
import { COLLAB_FEATURE } from './collabGate.js';

/**
 * A source of admission tokens for one collab session.
 *
 * Scoped to a session rather than to the module so that a refusal is forgotten
 * when the artist gives up and rejoins — the next attempt should be judged on
 * its own, not on what the gallery said a quarter of an hour ago.
 */
export class CollabGrantSource {
  /**
   * @param {object} [options]
   * @param {(feature: string) => Promise<object>} [options.request] - injected
   *   for tests; defaults to the gallery call every paid action makes.
   */
  constructor({ request } = {}) {
    this.request = request || ((feature) => entitlements.requestGrant(feature));
    /** The last reason the gallery gave, for a panel that wants to explain. */
    this.lastError = null;
  }

  /**
   * Ask the gallery for a pass naming `collab.space`.
   *
   * @returns {Promise<string|null>} the token, or null when there is not one to
   *   be had — which is a fact about this editor's session, not a verdict on
   *   the relay.
   */
  async token() {
    try {
      const answer = await this.request(COLLAB_FEATURE);
      const token = answer?.grant || null;
      this.lastError = token ? null : 'The gallery answered without a pass.';
      return token;
    } catch (error) {
      this.lastError = error instanceof GrantError
        ? error.message
        : 'Could not reach the gallery for a collab pass.';
      return null;
    }
  }
}

/** The `getGrant` callback CollabSession expects, backed by a fresh source. */
export function collabGrantGetter(source = new CollabGrantSource()) {
  const getter = () => source.token();
  getter.source = source;
  return getter;
}
