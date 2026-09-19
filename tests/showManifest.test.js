// The show manifest: the document a show is planned in before anything exists.
//
// Same split as the scenario's own tests, because the file has the same
// contract — normalize never throws whatever it is handed, and validate
// reports everything at once rather than the first thing it trips on.

import { describe, it, expect } from 'vitest';
import {
  normalizeManifest,
  parseManifest,
  validateManifest,
  showContext,
  lookPrompt,
  scenarioBrief,
  slugId,
  MANIFEST_LIMITS,
  EXAMPLE_MANIFEST,
} from '../src/performer/ShowManifest.js';
import { AUDIO_TAP_CHANNELS } from '../src/audio/audioAnalysisTaps.js';
import { unifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';

describe('normalizeManifest', () => {
  it('survives anything', () => {
    for (const junk of [null, undefined, 0, '', 'nonsense', [], { looks: 'no' }]) {
      const show = normalizeManifest(junk);
      expect(show.name).toBeTruthy();
      expect(Array.isArray(show.looks)).toBe(true);
    }
  });

  it('takes a look written as a bare string', () => {
    const show = normalizeManifest({ looks: ['slow fog over near-black'] });
    expect(show.looks).toHaveLength(1);
    expect(show.looks[0].brief).toBe('slow fog over near-black');
    expect(show.looks[0].name).toBe('Look 1');
  });

  it('gives every look an id, derived from its name', () => {
    const show = normalizeManifest({ looks: [{ name: 'The Drop!' }, { name: 'Cool Down' }] });
    expect(show.looks.map((look) => look.id)).toEqual(['the-drop', 'cool-down']);
  });

  it('never lets two looks share an id', () => {
    // Two looks with one id would have the second section load the first
    // one's patch, silently, and only at showtime.
    const show = normalizeManifest({ looks: [{ name: 'Drop' }, { name: 'Drop' }, { id: 'drop' }] });
    expect(new Set(show.looks.map((look) => look.id)).size).toBe(3);
  });

  it('caps the number of looks, because every one of them is a paid call', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `L${i}`, brief: 'x' }));
    expect(normalizeManifest({ looks: many }).looks).toHaveLength(MANIFEST_LIMITS.looks);
  });

  it('reads a length written as bars, as seconds, or as a bare number', () => {
    const show = normalizeManifest({
      looks: [{ hold: { bars: 32 } }, { hold: { seconds: 90 } }, { hold: 45 }, { hold: 'soon' }],
    });
    expect(show.looks[0].hold).toEqual({ bars: 32 });
    expect(show.looks[1].hold).toEqual({ seconds: 90 });
    expect(show.looks[2].hold).toEqual({ seconds: 45 });
    expect(show.looks[3].hold).toBeNull();
  });

  it('clamps a tempo and an intensity rather than carrying nonsense forward', () => {
    const show = normalizeManifest({ bpm: 99999, looks: [{ intensity: 40 }, { intensity: -3 }] });
    expect(show.bpm).toBe(400);
    expect(show.looks[0].intensity).toBe(1);
    expect(show.looks[1].intensity).toBe(0);
  });

  it('takes "show", "name" or "title" for the show name', () => {
    expect(normalizeManifest({ show: 'A' }).name).toBe('A');
    expect(normalizeManifest({ name: 'B' }).name).toBe('B');
    expect(normalizeManifest({ title: 'C' }).name).toBe('C');
  });

  it('round-trips through JSON unchanged', () => {
    const once = normalizeManifest(EXAMPLE_MANIFEST);
    expect(normalizeManifest(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('parseManifest', () => {
  it('says where the JSON is broken rather than throwing a SyntaxError', () => {
    expect(() => parseManifest('{ looks: [')).toThrow(/not valid JSON/);
  });

  it('reads a good one', () => {
    expect(parseManifest(JSON.stringify(EXAMPLE_MANIFEST)).looks).toHaveLength(3);
  });
});

describe('validateManifest', () => {
  it('passes the worked example with nothing to say', () => {
    const report = validateManifest(EXAMPLE_MANIFEST);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.generated).toBe(3);
  });

  it('refuses a show with no looks in it', () => {
    expect(validateManifest({ show: 'x' }).errors[0].where).toBe('looks');
  });

  it('refuses a look that says nothing about what it should be', () => {
    const report = validateManifest({ looks: [{ name: 'Mystery' }] });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toMatch(/brief/);
  });

  it('counts only the looks that cost a call', () => {
    const report = validateManifest({
      looks: [{ name: 'A', brief: 'a long enough brief here' }, { name: 'B', scene: 'already-have-it' }],
    });
    expect(report.generated).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it('reports every problem at once, not the first', () => {
    const report = validateManifest({ looks: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    expect(report.errors).toHaveLength(3);
  });

  it('warns that bars mean nothing in a show with no pulse', () => {
    const report = validateManifest({
      pulse: 'free',
      looks: [{ name: 'Drone', brief: 'a long slow drone image', hold: { bars: 32 } }],
    });
    expect(report.warnings.some((w) => /no pulse/.test(w.message))).toBe(true);
  });

  it('warns before a build big enough to run someone out of allowance', () => {
    const looks = Array.from({ length: 8 }, (_, i) => ({ name: `L${i}`, brief: 'a brief long enough to pass' }));
    expect(validateManifest({ looks }).warnings.some((w) => w.where === 'looks')).toBe(true);
  });

  it('warns about a "next" that points nowhere, without blocking the build', () => {
    const report = validateManifest({
      looks: [{ name: 'A', brief: 'a brief long enough', next: 'nowhere' }],
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => /next/.test(w.message))).toBe(true);
  });
});

describe('the prompts', () => {
  it('tells every look about the rest of the show', () => {
    const show = normalizeManifest(EXAMPLE_MANIFEST);
    const prompt = lookPrompt(show, show.looks[1]);

    expect(prompt).toContain(show.looks[1].brief);
    expect(prompt).toContain('Opening');
    expect(prompt).toContain('Drop');
    expect(prompt).toContain(show.palette);
  });

  it('asks for a patch that can actually be performed', () => {
    const show = normalizeManifest(EXAMPLE_MANIFEST);
    const prompt = lookPrompt(show, show.looks[0]);

    // The three things that separate a look from an image.
    expect(prompt).toMatch(/[Nn]ame every node/);
    expect(prompt).toMatch(/somewhere to travel/);
    expect(prompt).toMatch(/first frame/i);
    expect(prompt).toContain('how fast the fog drifts');
  });

  it('says there is no pulse rather than inventing a tempo', () => {
    const text = showContext({ pulse: 'free', looks: [{ brief: 'x' }] });
    expect(text).toMatch(/no steady pulse/);
    expect(text).not.toMatch(/BPM/);
  });

  // `reactsTo` is written in the tap vocabulary, which is the right vocabulary
  // for it — the same strings bind the scenario's audio signals. But only some
  // of those readings reach a parameter expression, they are spelled
  // differently there, and an expression naming one of the others compiles to
  // 0.0 and stays there for the length of the show. Nothing warns: the patch
  // loads, the section runs, and the one thing the look was built to do never
  // happens. So the prompt routes each channel, and these hold the routing
  // against the two things that decide it.
  describe('routing a look to the audio it has to answer', () => {
    it('gives the expression name for a channel an expression can hear', () => {
      const show = normalizeManifest({
        looks: [{ name: 'A', brief: 'fog', reactsTo: ['low', 'mid', 'high', 'level'] }],
      });
      const prompt = lookPrompt(show, show.looks[0]);

      expect(prompt).toContain('low is "audioEnvelopeBass"');
      expect(prompt).toContain('mid is "audioEnvelopeMids"');
      expect(prompt).toContain('high is "audioEnvelopeHighs"');
      expect(prompt).toContain('level is "audioEnvelope"');
      expect(prompt).not.toMatch(/only through an AudioValue node/);
    });

    it('sends the rest to a node, because no expression can name them', () => {
      const show = normalizeManifest({
        looks: [{ name: 'A', brief: 'hits', reactsTo: ['kickTrig', 'centroid'] }],
      });
      const prompt = lookPrompt(show, show.looks[0]);

      expect(prompt).toContain('kickTrig, centroid are reachable only through an AudioValue node');
      expect(prompt).toMatch(/compile to zero/);
    });

    it('routes a mixed look both ways at once', () => {
      const show = normalizeManifest(EXAMPLE_MANIFEST);
      // The drop answers "low" and "kickTrig" — one of each.
      const prompt = lookPrompt(show, show.looks[2]);

      expect(prompt).toContain('low is "audioEnvelopeBass"');
      expect(prompt).toContain('kickTrig is reachable only through an AudioValue node');
    });

    it('is right about which names an expression really resolves', () => {
      // The claim, checked rather than trusted, against the expression system
      // and the tap list themselves. A renamed channel or a dropped identifier
      // fails here rather than in a show.
      //
      // Eight at a time, because normalizeLook() caps `reactsTo` at eight and
      // a look asked for all fifteen is a look told about the first eight.
      for (let from = 0; from < AUDIO_TAP_CHANNELS.length; from += 8) {
        const batch = AUDIO_TAP_CHANNELS.slice(from, from + 8);
        const show = normalizeManifest({ looks: [{ name: 'A', brief: 'x', reactsTo: batch }] });
        const prompt = lookPrompt(show, show.looks[0]);

        for (const channel of batch) {
          // Whatever the prompt offered as this channel's expression name, if
          // it offered one, has to be an identifier the generator resolves.
          const offered = prompt.match(new RegExp(`\\b${channel} is "([a-zA-Z]+)"`));
          if (offered) {
            expect(unifiedExpressionSystem.generateShader(`=${offered[1]}`), offered[1])
              .not.toBe('0.0');
          } else {
            // And a channel sent to a node is named in the prompt as one.
            expect(prompt).toContain(channel);
          }
          // Either way the channel's own name is never an expression: that is
          // the whole reason the routing has to be spelled out.
          expect(unifiedExpressionSystem.generateShader(`=${channel}`), channel).toBe('0.0');
        }
      }
    });

    it('says nothing at all when the look answers nothing', () => {
      const show = normalizeManifest({ looks: [{ name: 'A', brief: 'still' }] });
      const prompt = lookPrompt(show, show.looks[0]);

      expect(prompt).not.toMatch(/AudioValue/);
      expect(prompt).not.toMatch(/Inside a parameter expression/);
    });
  });

  it('names the scenes that were actually built, and admits the ones that were not', () => {
    const brief = scenarioBrief(EXAMPLE_MANIFEST, [
      { lookId: 'opening', sceneName: 'Opening' },
      { lookId: 'build', sceneName: 'Build' },
    ]);

    expect(brief).toContain('the scene "Opening"');
    expect(brief).toContain('the scene "Build"');
    // The drop was not built, and the brief has to say so rather than let the
    // model name a scene that is not there.
    expect(brief).toMatch(/nothing was built for this one/);
  });

  it('carries the cues and the signals into the set', () => {
    const brief = scenarioBrief(EXAMPLE_MANIFEST, []);
    expect(brief).toContain('drop, blackout');
    expect(brief).toContain('/rhizo/perf/energy');
  });

  it('tells an unmetered set to stay out of bars', () => {
    const brief = scenarioBrief({ pulse: 'free', looks: [{ name: 'A', brief: 'x' }] }, []);
    expect(brief).toMatch(/no bars/);
  });
});

describe('the names a set already reaches for', () => {
  const look = (requires) => normalizeManifest({ looks: [{ name: 'A', brief: 'x', requires }] }).looks[0];

  it('reads both the pair and the "Node.param" shorthand a scenario prints', () => {
    expect(look([{ node: 'Warp', param: 'amount' }, 'Colour.hue']))
      .toMatchObject({ requires: [{ node: 'Warp', param: 'amount' }, { node: 'Colour', param: 'hue' }] });
  });

  it('splits on the last dot, so a node with a dot in its name survives', () => {
    expect(look(['Warp.2.amount']).requires).toEqual([{ node: 'Warp.2', param: 'amount' }]);
  });

  it('names a parameter once however many times the section reaches for it', () => {
    // A section that drives a parameter and also moves it names it twice.
    expect(look(['Warp.amount', { node: 'warp', param: 'AMOUNT' }]).requires).toHaveLength(1);
  });

  it('drops what is not a parameter at all, rather than asking for half of one', () => {
    expect(look(['Warp', { node: 'Warp' }, { param: 'amount' }, 42, null]).requires).toEqual([]);
  });

  it('holds the cap, so one strange set cannot write an unbounded prompt', () => {
    const many = Array.from({ length: MANIFEST_LIMITS.requires + 5 }, (_, i) => `Node${i}.amount`);
    expect(look(many).requires).toHaveLength(MANIFEST_LIMITS.requires);
  });

  it('asks the model for those names exactly, and says why', () => {
    const manifest = normalizeManifest({
      looks: [{ name: 'A', brief: 'fog', requires: ['Warp.amount'] }],
    });
    const prompt = lookPrompt(manifest, manifest.looks[0]);

    expect(prompt).toContain('a node named exactly "Warp", with a parameter named exactly "amount"');
    expect(prompt).toMatch(/not suggestions/);
  });

  it('says nothing about them when a look is being written for no set', () => {
    const manifest = normalizeManifest({ looks: [{ name: 'A', brief: 'fog' }] });
    const prompt = lookPrompt(manifest, manifest.looks[0]);

    expect(prompt).not.toMatch(/named exactly/);
    expect(prompt).toMatch(/three or four parameters worth performing/);
  });
});

describe('slugId', () => {
  it('makes something usable out of anything', () => {
    expect(slugId('The Drop!')).toBe('the-drop');
    expect(slugId('  ')).toBe('look');
    expect(slugId('***', 'fallback')).toBe('fallback');
    expect(slugId('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

// Direction in the manifest: the plan for what the live AI should be going
// for, which the build turns into the set's pre-directions.
describe('direction', () => {
  it('is read off the show and off each look', () => {
    const show = normalizeManifest({
      show: 'x',
      direction: 'never bright',
      looks: [{ id: 'drop', brief: 'hard', direction: 'let it go' }],
    });
    expect(show.direction).toBe('never bright');
    expect(show.looks[0].direction).toBe('let it go');
  });

  it('is empty rather than absent when nothing said', () => {
    const show = normalizeManifest({ show: 'x', looks: [{ id: 'a', brief: 'y' }] });
    expect(show.direction).toBe('');
    expect(show.looks[0].direction).toBe('');
  });

  it('is capped to a sentence, not a brief', () => {
    const show = normalizeManifest({
      show: 'x',
      direction: 'y'.repeat(MANIFEST_LIMITS.directionChars + 200),
      looks: [{ id: 'a', brief: 'z', direction: 'y'.repeat(MANIFEST_LIMITS.directionChars + 200) }],
    });
    expect(show.direction).toHaveLength(MANIFEST_LIMITS.directionChars);
    expect(show.looks[0].direction).toHaveLength(MANIFEST_LIMITS.directionChars);
  });

  it('warns when a show the model will play has no direction anywhere', () => {
    const report = validateManifest({
      show: 'x',
      looks: [{ id: 'a', name: 'A', brief: 'a long enough brief' }],
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => w.where === 'direction')).toBe(true);
  });

  it('says nothing when the show has direction', () => {
    const report = validateManifest({
      show: 'x',
      direction: 'never bright',
      looks: [{ id: 'a', name: 'A', brief: 'a long enough brief' }],
    });
    expect(report.warnings.some((w) => w.where === 'direction')).toBe(false);
  });

  it('says nothing about a show nobody is handing to the model', () => {
    // A set with the director off is a set somebody is performing. Telling
    // them to write pre-directions for it is telling them to write for nobody.
    const report = validateManifest({
      show: 'x',
      looks: [{ id: 'a', name: 'A', brief: 'a long enough brief' }],
      rules: { director: { enabled: false } },
    });
    expect(report.warnings.some((w) => w.where === 'direction')).toBe(false);
  });

  it('is in the worked example, on the show and on every look', () => {
    const show = normalizeManifest(EXAMPLE_MANIFEST);
    expect(show.direction).toBeTruthy();
    expect(show.looks.every((look) => look.direction)).toBe(true);
  });
});
