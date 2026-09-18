// The live director's prompt, with the show's own direction in it.
//
// Two lines of direction can reach one call: the pre-direction written at the
// desk and anchored to this moment of the show, and the steer an artist just
// typed. The whole reason they are separate fields rather than one string is
// that they can disagree, so what is pinned down here is that the prompt keeps
// them apart and says which one wins — and that a set with no pre-directions
// asks exactly the question it always did.

import { describe, it, expect } from 'vitest';
import { buildUserMessage } from '../api/_lib/features.js';

/** The smallest state the builder will accept. */
const state = { now: { bar: 4 }, signals: {} };

const ask = (input) => buildUserMessage('ai.performer_live', { state, ...input });

describe('ai.performer_live with a pre-direction', () => {
  it('is unchanged when there is neither kind of direction', () => {
    const message = ask({});
    expect(message).not.toMatch(/plan for this moment/);
    expect(message).not.toMatch(/The artist/);
  });

  it('asks the same way it always did when only the artist has spoken', () => {
    // The set played by someone standing at the laptop. Naming a plan that is
    // not there would be an instruction to weigh the steer against nothing.
    const message = ask({ steer: 'keep it dark' });
    expect(message).toContain('The artist says: keep it dark');
    expect(message).not.toMatch(/plan/);
  });

  it('carries the show\'s line when nobody is there to type one', () => {
    const message = ask({ preDirection: 'patient and cold, never bright' });
    expect(message).toContain("The show's plan for this moment: patient and cold, never bright");
  });

  it('keeps the two apart, and says the live one wins', () => {
    const message = ask({ preDirection: 'keep it dark', steer: 'bring it up now' });

    expect(message).toContain("The show's plan for this moment: keep it dark");
    expect(message).toContain('bring it up now');
    expect(message).toMatch(/wins where it disagrees with the plan/);
    // The plan is stated before the person changing their mind about it.
    expect(message.indexOf('keep it dark')).toBeLessThan(message.indexOf('bring it up now'));
  });

  it('ignores a blank or junk pre-direction rather than sending an empty line', () => {
    for (const junk of ['', '   ', null, undefined, 0]) {
      expect(ask({ preDirection: junk })).not.toMatch(/plan for this moment/);
    }
  });

  it('still refuses a call with no state to act on', () => {
    expect(() => buildUserMessage('ai.performer_live', { preDirection: 'keep it dark' }))
      .toThrow(/No performance state/);
  });
});
