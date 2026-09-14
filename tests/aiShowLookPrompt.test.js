// The patch generator, asked for a look in a show rather than for a patch.
//
// The show block is optional and only the show builder sends it, so the two
// things worth pinning down are that it changes nothing when absent — that is
// every call the editor's own generator button makes — and that when it is
// there it asks for the things that make a patch performable rather than just
// good-looking.

import { describe, it, expect } from 'vitest';
import { buildUserMessage } from '../api/_lib/features.js';

const show = {
  context: 'Show: Night set\nTempo: 128 BPM, 4 beats to the bar.',
  look: 'Build',
  intensity: 0.6,
  drivable: ['how tight the structure is', 'contrast'],
  reactsTo: ['low', 'mid'],
};

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
