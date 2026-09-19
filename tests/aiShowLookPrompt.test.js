// The patch generator, asked for a look in a show rather than for a patch.
//
// The show block is optional and only the show builder sends it, so the two
// things worth pinning down are that it changes nothing when absent — that is
// every call the editor's own generator button makes — and that when it is
// there it asks for the things that make a patch performable rather than just
// good-looking.
//
// The second half of that grew. A look built from the general prompt alone
// came back as the graph a model can reason about end to end — noise, a colour
// ramp, the output — every time, which is correct and is also five looks that
// are one look in five tints. So the show block now also says what a look may
// be MADE of (the simulations, the 3D, the whole-image compute nodes) and what
// makes one playable rather than watchable. Those are claims about the editor,
// and the tests below hold each of them against the code that has to be true
// for it: the node registry, the expression system, and the parameter path the
// performer actually writes through.

import { describe, it, expect } from 'vitest';
import { buildUserMessage } from '../api/_lib/features.js';
import { NodeDefs } from '../src/data/NodeDefs.js';
import { unifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';
import { externalControlRefMapping } from '../src/utils/paramReferences.js';
import { applyControlValue } from '../src/parameters/ExternalParameterControl.js';
import { ActionExecutor } from '../src/performer/ActionExecutor.js';

const show = {
  context: 'Show: Night set\nTempo: 128 BPM, 4 beats to the bar.',
  look: 'Build',
  intensity: 0.6,
  drivable: ['how tight the structure is', 'contrast'],
  reactsTo: ['low', 'mid'],
};

/** The show half of the message: everything the block added. */
const blockFor = (payload = show) =>
  buildUserMessage('ai.patch_generator', { prompt: 'tightening', show: payload });

describe('ai.patch_generator with a show', () => {
  it('is byte-for-byte unchanged when there is no show', () => {
    expect(buildUserMessage('ai.patch_generator', { prompt: 'fog over black' }))
      .toBe('Build a patch: fog over black');
  });

  it('ignores a show block that is not an object', () => {
    for (const junk of [null, '', 0, 'a show']) {
      expect(buildUserMessage('ai.patch_generator', { prompt: 'x', show: junk }))
        .toBe('Build a patch: x');
    }
  });

  it('carries the rest of the set, so five looks are not five shows', () => {
    const message = buildUserMessage('ai.patch_generator', { prompt: 'tightening', show });
    expect(message).toContain('Show: Night set');
    expect(message).toContain('the look called "Build"');
    expect(message).toContain('intensity 0.6');
  });

  it('asks for named nodes and parameters with somewhere to travel', () => {
    const message = buildUserMessage('ai.patch_generator', { prompt: 'tightening', show });
    // A scenario addresses nodes by name and moves single parameters. A look
    // whose nodes are unnamed, or whose interesting parameter is already at
    // its maximum, is a look nothing can play.
    expect(message).toContain('how tight the structure is; contrast');
    expect(message).toMatch(/[Nn]ame every node/);
    expect(message).toMatch(/somewhere left to travel/);
    expect(message).toContain('low, mid');
  });

  it('still asks for something performable when the manifest named nothing', () => {
    const message = buildUserMessage('ai.patch_generator', {
      prompt: 'x',
      show: { context: 'Show: Y' },
    });
    expect(message).toMatch(/three or four parameters worth performing/);
  });

  it('still refuses a call with no prompt in it', () => {
    expect(() => buildUserMessage('ai.patch_generator', { show })).toThrow(/Describe the patch/);
  });
});

describe('what a look is told it may be made of', () => {
  it('names the families by what they are, not only by what they are called', () => {
    // The bridge that was missing. A brief says "smoke"; the registry says
    // ComputeFluidSim; nothing joined the two, so the model built smoke out of
    // noise and Math nodes because that is the path it could reason about.
    const message = blockFor();

    expect(message).toMatch(/Simulation/);
    expect(message).toContain('ComputeFluidSim');
    expect(message).toContain('ComputeFieldMapper');
    expect(message).toContain('ComputeKaleidoscope');
    expect(message).toMatch(/Two or three compute nodes/);
  });

  it('names only node kinds that exist', () => {
    // The same guard the shared prompt carries, for the same reason: a patch
    // naming a kind that is not in the registry is not degraded, it is
    // REFUSED by validateGeneratedPatch(), so a stale kind in this prose is
    // every look of every show failing outright. The renaming that proved it
    // was Audio Analysis becoming Audio + AudioValue.
    // Multi-hump CamelCase is how a kind is written, and unlike the shared
    // prompt this block has no code identifiers or proper nouns in it — every
    // such token in it is meant to be a node. So there is nothing to exclude,
    // and anything that needs excluding later is a sentence to reword rather
    // than a name to add here.
    const named = [...new Set(blockFor().match(/\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/g) || [])];

    expect(named).toContain('ComputeReactionDiffusion');
    expect(named).toContain('ComputeFieldMapper');
    for (const kind of named) {
      expect(NodeDefs, `the prompt tells the model to use "${kind}", which is not a node kind`)
        .toHaveProperty(kind);
    }
  });

  it('puts the 3D on the main screen and not only in the viewport', () => {
    // ComputeFieldMapper opens the floating viewport by itself. Its output is
    // also an ordinary colour texture, and a patch that does not carry that on
    // to the output is a look the audience never sees.
    expect(blockFor()).toContain('OutputFinal');
  });
});

describe('what a look is told makes it playable', () => {
  it('separates the audio an expression can hear from the audio that needs a node', () => {
    const message = blockFor();

    // Five names reach a parameter expression. Every other channel is an
    // AudioValue node or nothing, and "nothing" is silent: the identifier
    // fails and the parameter sits at zero for the length of the show.
    for (const name of ['audioEnvelope', 'audioEnvelopeBass', 'audioEnvelopeMids', 'audioEnvelopeHighs', 'audioEnvelopeFull']) {
      expect(message).toContain(name);
      expect(unifiedExpressionSystem.generateShader(`=${name}`)).not.toBe('0.0');
    }

    // And the claim about the ones it cannot hear, checked rather than trusted.
    expect(message).toMatch(/only way to reach the named channels/i);
    for (const channel of ['low', 'kickTrig']) {
      expect(unifiedExpressionSystem.generateShader(`=${channel}`)).toBe('0.0');
    }

    expect(message).toMatch(/base plus the audio/);
  });

  it('is right that a drive reaches an expression as `osc`', () => {
    // The rule the whole block turns on, and the one thing in it that is not
    // guessable from anywhere else in the prompt. ActionExecutor.writeParam()
    // goes through applyControlValue() with source 'osc', which leaves a
    // parameter holding an expression alone and records the reading where the
    // compiled formula reads it.
    const message = blockFor();
    expect(message).toContain('"=0.15+osc*0.7"');

    const node = { id: '7', params: { amount: '=0.15+osc*0.7' } };
    // The formula survives the write — that is what `false` means here.
    expect(applyControlValue(node, 'amount', 0.42, 'osc')).toBe(false);
    expect(node.params.amount).toBe('=0.15+osc*0.7');

    // And the reading it recorded is what `osc` compiles to: the parameter's
    // own uniform field, written every frame with no recompile.
    const uniforms = { uniformValues: new Map() };
    expect(externalControlRefMapping(node, '=0.15+osc*0.7', 'amount', uniforms))
      .toHaveProperty('osc');
    expect(uniforms.uniformValues.get('7.amount')).toBe(0.42);
  });

  it('is right that an expression without `osc` in it cannot be driven', () => {
    // The failure the warning exists for, and it is silent end to end: the
    // node is there, the parameter is there, unmetRequirements() is satisfied,
    // the drive loads — and nothing it writes is ever read.
    expect(blockFor()).toMatch(/NOTHING CAN MOVE/);

    const node = { id: '7', params: { amount: '=time*0.3' } };
    expect(applyControlValue(node, 'amount', 0.42, 'osc')).toBe(false);
    expect(externalControlRefMapping(node, '=time*0.3', 'amount', { uniformValues: new Map() }))
      .toEqual({});
  });

  it('says a handle has to be a numeric parameter', () => {
    expect(blockFor()).toMatch(/only a float, int or slider can be driven/);

    // Because writeParam() refuses anything that is not a finite number. A
    // select, a bool, a colour and a text parameter are not handles however
    // interesting they are to turn by hand, so a look whose one control is a
    // mode dropdown is a look the set cannot touch.
    const executor = new ActionExecutor({});
    const node = { id: '7', params: { amount: 0.2, colorMode: 'Dye' } };

    expect(executor.writeParam(node, 'amount', 0.6)).toBe(true);
    expect(executor.writeParam(node, 'colorMode', Number('Dye'))).toBe(false);
    expect(node.params.colorMode).toBe('Dye');
  });

  it('says a look is cut to, so a simulation has to be seeded', () => {
    // The tension the two blocks would otherwise leave: the Dynamics nodes are
    // what the brief means, and several of them are black for the first
    // seconds. Both halves are said, so neither is read as a ban on the other.
    expect(blockFor()).toMatch(/cut to, not faded up into/);
    expect(blockFor()).toMatch(/seeded rather than started from nothing/);
  });
});

describe('the two clocks a look is built against', () => {
  it('says how long the look is up for, when the manifest said', () => {
    expect(blockFor({ ...show, secondsUp: 60 })).toMatch(/up for about 60 seconds/);
    // And says nothing at all when it does not know, rather than guessing.
    expect(blockFor()).not.toMatch(/up for about/);
    expect(blockFor({ ...show, secondsUp: 0 })).not.toMatch(/up for about/);
  });

  it('gives an expression rate that really does cycle once a bar', () => {
    // The point of the line: a rate is what a model cannot guess, and a cycle
    // some fraction of a bar long is motion that reads as part of the music
    // rather than as something happening near it.
    const message = blockFor({ ...show, bar: 1.88 });
    expect(message).toContain('One bar of this show is 1.88s');

    const rate = Number(message.match(/once per bar at "=sin\(time\*([\d.]+)\)"/)[1]);
    // Period = 2*PI/rate, and it has to be a bar to well inside a frame at
    // 60fps — the two-decimal rounding everything else here uses is a fifth of
    // a bar adrift by the end of a thirty-two bar section.
    expect((2 * Math.PI) / rate).toBeCloseTo(1.88, 2);

    const four = Number(message.match(/once every four bars at "=sin\(time\*([\d.]+)\)"/)[1]);
    expect((2 * Math.PI) / four).toBeCloseTo(1.88 * 4, 1);
  });

  it('says nothing about bars for a show with no pulse', () => {
    // barSecondsOf() is zero for free-pulse music and the payload drops it. A
    // bar invented for a drone is a set timed to a beat nobody is playing.
    expect(blockFor()).not.toMatch(/One bar of this show/);
    expect(blockFor({ ...show, bar: 0 })).not.toMatch(/One bar of this show/);
  });
});
