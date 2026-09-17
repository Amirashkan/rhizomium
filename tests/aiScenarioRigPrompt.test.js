// What the scenario call is told about the rig it is writing for.
//
// A scenario is the one document that addresses the rig by name — scenes,
// nodes, parameters, OSC addresses — and the prompt tells the model to name
// only what it was given. So what it was given is the whole of whether the set
// plays: a parameter that was never listed is a drive the model either invents
// or leaves out, and both of those are a section that loads its look and then
// moves nothing for four minutes.

import { describe, it, expect } from 'vitest';
import { buildUserMessage } from '../api/_lib/features.js';

const message = (input) => buildUserMessage('ai.performer_scenario', { brief: 'a set', ...input });

describe('the rig a scenario is written for', () => {
  it('lists each scene with the parameters a section looking at it can drive', () => {
    const text = message({
      scenes: [
        { id: 's1', name: 'Opening', notes: 'cold', parameters: ['ComputeNoise.scale', 'Blur.radius'] },
      ],
    });

    expect(text).toContain('Opening — s1 — cold');
    expect(text).toContain('a drive in its section can reach: ComputeNoise.scale, Blur.radius');
  });

  it('leaves a scene that came with none exactly as it was', () => {
    // The panel's own list of loaded scenes carries no parameters: it cannot
    // know what is in a scene without loading it. Only the show builder knows,
    // because it just made the patch.
    const text = message({ scenes: [{ id: 's1', name: 'Opening', notes: 'cold' }] });
    expect(text).toContain('  Opening — s1 — cold\n');
    expect(text).not.toContain('a drive in its section can reach');
  });

  it('says the flat parameter list is the open patch, not the scenes', () => {
    // These two lists are different graphs, and a model that reads them as one
    // writes drives for the section that happens to be loaded now.
    const text = message({ parameters: ['Warp.amount'] });
    expect(text).toContain('Parameters in the patch that is open right now');
    expect(text).toContain('"node" and "param"');
  });

  it('still says plainly when there is nothing to drive', () => {
    const text = message({});
    expect(text).toContain('No scenes are loaded.');
    expect(text).toContain('No patch is open');
  });
});

describe('the scenario prompt itself', () => {
  it('shows the shape of a drive, which is the one the model kept getting wrong', async () => {
    const { AI_FEATURES } = await import('../api/_lib/features.js');
    const system = AI_FEATURES['ai.performer_scenario'].system();

    // Two fields, demonstrated. The rig is printed as "node.param" because
    // that is how a parameter reads; a drive carrying it as one string drives
    // nothing, and until this was in the prompt nothing said so.
    expect(system).toContain('"node":"Warp","param":"amount"');
    expect(system).toContain('"atSeconds"');
    // The verbs an action may use. An invented one is dropped on the way in
    // (Scenario.normalizeActionList), so a cue written out of them is a cue
    // the musician fires into silence.
    expect(system).toContain('"type":"undrive"');
    expect(system).toContain('"type":"blackout"');
  });
});
