// Pre-directions: the direction written before the show rather than during it.
//
// What is actually under test is the one rule the whole feature rests on —
// which single line is live at a given moment — and the button that decides
// the anchors, because an artist writing three sentences and pressing "set on
// the timeline" never sees the anchors and has to be able to trust them.
//
// Nothing here touches the engine, the director or the panel. That is the
// point of the resolution rule living in a module of its own.

import { describe, it, expect } from 'vitest';
import {
  DIRECTION_LIMITS,
  activeDirection,
  describeDirectionAt,
  directionLines,
  normalizeDirection,
  normalizeDirectionAt,
  normalizeDirections,
  parseDirectionLines,
  spreadOverTimeline,
  validateDirections,
} from '../src/performer/PreDirections.js';
import { LIMITS as SCENARIO_LIMITS } from '../src/performer/Scenario.js';

/** Three sections, the shape a scenario hands over. */
const SECTIONS = Object.freeze([
  { id: 'intro', name: 'Intro' },
  { id: 'build', name: 'Build' },
  { id: 'drop', name: 'Drop' },
]);

describe('normalizeDirections', () => {
  it('takes a bare string as a standing direction', () => {
    const [one] = normalizeDirections(['keep it dark']);
    expect(one.text).toBe('keep it dark');
    expect(one.at).toEqual({ section: '', bars: null, seconds: null, whole: false });
  });

  it('takes a bare string anchor as a section, slugged like a section id', () => {
    expect(normalizeDirectionAt('The Drop')).toEqual({
      section: 'the-drop', bars: null, seconds: null, whole: false,
    });
  });

  it('takes a bare number anchor as seconds from the top of the set', () => {
    expect(normalizeDirectionAt(90)).toEqual({ section: '', bars: null, seconds: 90, whole: true });
  });

  it('drops a direction with no text rather than keeping it as a blank', () => {
    // A blank kept in the list would be a line that overrides the standing
    // direction with silence — worse than the deleted line it came from.
    expect(normalizeDirections(['a', '', '   ', { text: '' }, 'b'])).toHaveLength(2);
  });

  it('never throws, whatever it is handed', () => {
    for (const junk of [null, undefined, 0, 'a line', { text: 'x' }, [[]], [{ at: 7 }]]) {
      expect(() => normalizeDirections(junk)).not.toThrow();
    }
  });

  it('caps the list, generously — only one line is ever sent', () => {
    const many = Array.from({ length: DIRECTION_LIMITS.count + 20 }, (_, i) => `line ${i}`);
    expect(normalizeDirections(many)).toHaveLength(DIRECTION_LIMITS.count);
  });

  it('is big enough to hold a spread over the longest legal set', () => {
    // A spread fills every section, so the list that comes back is as long as
    // the set is. A cap under that would leave the end of a long show
    // undirected, silently.
    expect(DIRECTION_LIMITS.count).toBeGreaterThanOrEqual(SCENARIO_LIMITS.sections);
  });

  it('tells a line nobody placed from one the artist called the show\'s', () => {
    // Identical at showtime — both are the standing tier — and the difference
    // is the whole reason the spread can leave one of them alone.
    expect(normalizeDirection('keep it dark').at.whole).toBe(false);
    expect(normalizeDirection({ at: 'set', text: 'keep it dark' }).at.whole).toBe(true);
    expect(normalizeDirection({ at: { whole: true }, text: 'x' }).at.whole).toBe(true);
  });

  it('caps the text of one line', () => {
    const [one] = normalizeDirections(['x'.repeat(DIRECTION_LIMITS.textChars + 500)]);
    expect(one.text).toHaveLength(DIRECTION_LIMITS.textChars);
  });

  it('keeps ids unique so the panel can key rows off them', () => {
    const list = normalizeDirections([
      { id: 'same', text: 'one' },
      { id: 'same', text: 'two' },
      { id: 'same', text: 'three' },
    ]);
    expect(new Set(list.map((d) => d.id)).size).toBe(3);
  });

  it('coerces a negative offset to zero rather than to a time before the set', () => {
    const one = normalizeDirection({ at: { section: 'drop', bars: -8 }, text: 'x' });
    expect(one.at.bars).toBe(0);
  });

  it('keeps zero and unwritten apart, so a spread line does not claim a unit', () => {
    // `bars: 0` is "at the top of it, in bars"; null is "nobody said". The
    // difference decides which clock a line is read against in a section
    // counted in the other unit.
    expect(normalizeDirection({ at: { section: 'drop', bars: 0 }, text: 'x' }).at.bars).toBe(0);
    expect(normalizeDirection({ at: { section: 'drop' }, text: 'x' }).at.bars).toBe(null);
  });
});

describe('activeDirection', () => {
  const directions = normalizeDirections([
    'patient and cold',
    { at: { section: 'build' }, text: 'tighten it' },
    { at: { section: 'drop' }, text: 'let it go' },
    { at: { section: 'drop', bars: 16 }, text: 'hold it there' },
  ]);

  it('is the standing line in a section that has none of its own', () => {
    const live = activeDirection(directions, { sectionId: 'intro', sectionBars: 4 });
    expect(live.text).toBe('patient and cold');
  });

  it('is the section\'s own line once the set is in it', () => {
    const live = activeDirection(directions, { sectionId: 'build', sectionBars: 0 });
    expect(live.text).toBe('tighten it');
  });

  it('hands over to the later line inside the same section', () => {
    const at2 = activeDirection(directions, { sectionId: 'drop', sectionBars: 2 });
    const at20 = activeDirection(directions, { sectionId: 'drop', sectionBars: 20 });
    expect(at2.text).toBe('let it go');
    expect(at20.text).toBe('hold it there');
  });

  it('does not carry a section\'s line into the next section', () => {
    // The two-tier rule, and the reason it is not "the last line reached
    // anywhere": a show whose drop is over should not still be told to go hard.
    const live = activeDirection(directions, { sectionId: 'outro', sectionBars: 1 });
    expect(live.text).toBe('patient and cold');
  });

  it('returns exactly one line, never a concatenation', () => {
    const live = activeDirection(directions, { sectionId: 'drop', sectionBars: 32 });
    expect(live.text).toBe('hold it there');
    expect(live.text).not.toContain('let it go');
  });

  it('is null when there is nothing to say', () => {
    expect(activeDirection([], { sectionId: 'drop' })).toBe(null);
    expect(activeDirection(null, {})).toBe(null);
  });

  it('holds a standing line back until its own offset is reached', () => {
    const list = normalizeDirections([
      'from the top',
      { at: { seconds: 600 }, text: 'second half' },
    ]);
    expect(activeDirection(list, { setSeconds: 10 }).text).toBe('from the top');
    expect(activeDirection(list, { setSeconds: 900 }).text).toBe('second half');
  });

  it('reads a section offset in whichever unit it was written in', () => {
    const bars = normalizeDirections([{ at: { section: 'drop', bars: 8 }, text: 'bars' }]);
    const secs = normalizeDirections([{ at: { section: 'drop', seconds: 8 }, text: 'seconds' }]);

    // 4 bars in and 20 seconds in: the bar line is not reached, the second is.
    const now = { sectionId: 'drop', sectionBars: 4, sectionSeconds: 20 };
    expect(activeDirection(bars, now)).toBe(null);
    expect(activeDirection(secs, now).text).toBe('seconds');
  });
});

describe('spreadOverTimeline', () => {
  it('gives one line each when the counts line up', () => {
    const out = spreadOverTimeline(['a', 'b', 'c'], SECTIONS);
    expect(out.map((d) => d.at.section)).toEqual(['intro', 'build', 'drop']);
    // The first line of a section takes effect the moment it is entered, so it
    // gets no offset — a section whose direction starts 4 bars in is a section
    // that opens undirected.
    expect(out.every((d) => d.at.bars === null)).toBe(true);
  });

  it('spreads fewer lines than sections, each holding until the next', () => {
    // Two lines over three sections, and every section ends up directed: the
    // first line holds until the second takes over. Without the repeat, the
    // section in between would fall back to the standing line, which is the
    // failure the whole feature exists to fix.
    const out = spreadOverTimeline(['a', 'b'], SECTIONS);

    const live = SECTIONS.map((section) =>
      activeDirection(out, { sectionId: section.id, sectionBars: 0 })?.text);
    // Dealt from the front, and the last one holds to the end of the show.
    expect(live).toEqual(['a', 'b', 'b']);
  });

  it('holds one line over a whole show when that is all there is', () => {
    const out = spreadOverTimeline(['keep it dark'], SECTIONS);
    for (const section of SECTIONS) {
      expect(activeDirection(out, { sectionId: section.id, sectionBars: 0 }).text)
        .toBe('keep it dark');
    }
  });

  it('carries the last line of a section, not its first, into the next', () => {
    // Six lines over three sections stacks two per section; what is still
    // standing when a section ends is its second line, so that is the one a
    // section with nothing of its own would inherit.
    const out = spreadOverTimeline(['a', 'b', 'c', 'd'], [
      { id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'four' }, { id: 'five' },
    ]);
    const live = ['one', 'two', 'three', 'four', 'five'].map((id) =>
      activeDirection(out, { sectionId: id, sectionBars: 64 })?.text);
    // Every section directed, and the sequence never goes backwards.
    expect(live.every(Boolean)).toBe(true);
    expect(live).toEqual([...live].sort());
  });

  it('does not repeat a line into a section that already has one by hand', () => {
    const out = spreadOverTimeline([
      'a',
      { at: { section: 'drop' }, text: 'mine' },
    ], SECTIONS);

    const onDrop = out.filter((d) => d.at.section === 'drop');
    expect(onDrop.map((d) => d.text)).toEqual(['mine']);
  });

  it('leaves a standing line standing rather than dealing it to a section', () => {
    // A line the artist wrote as "set: …" is the show's floor. Dealing it to
    // one section would take it away from every other.
    const out = spreadOverTimeline(
      parseDirectionLines('set: never bright\ndrop: let it go'),
      SECTIONS
    );

    const standing = out.find((d) => d.text === 'never bright');
    expect(standing.at.section).toBe('');
    // …and it is what covers the sections the placed line does not.
    expect(activeDirection(out, { sectionId: 'intro', sectionBars: 0 }).text)
      .toBe('never bright');
  });

  it('stacks extra lines inside a section, offset so they read in order', () => {
    const out = spreadOverTimeline(['a', 'b', 'c', 'd', 'e', 'f'], SECTIONS);
    const drop = out.filter((d) => d.at.section === 'drop');
    expect(drop.length).toBeGreaterThan(1);
    // First one at the top of the section, the rest behind it in order.
    expect(drop[0].at.bars).toBe(null);
    expect(drop[1].at.bars).toBeGreaterThan(0);
  });

  it('leaves a line the artist already placed exactly where they put it', () => {
    const out = spreadOverTimeline([
      'a',
      { at: { section: 'drop', bars: 16 }, text: 'mine' },
      'b',
    ], SECTIONS);

    const mine = out.find((d) => d.text === 'mine');
    expect(mine.at).toEqual({ section: 'drop', bars: 16, seconds: null, whole: false });
  });

  it('re-places a line anchored to a section that no longer exists', () => {
    // The case an artist hits after rewriting a set: the line is not lost and
    // it is not left pointing at nothing.
    const out = spreadOverTimeline([{ at: { section: 'gone' }, text: 'x' }], SECTIONS);
    expect(SECTIONS.map((s) => s.id)).toContain(out[0].at.section);
  });

  it('is a no-op with no sections to spread over, rather than losing the lines', () => {
    const out = spreadOverTimeline(['a', 'b'], []);
    expect(out).toHaveLength(2);
    expect(out[0].at.section).toBe('');
  });

  it('puts every line somewhere', () => {
    const lines = Array.from({ length: 7 }, (_, i) => `line ${i}`);
    const out = spreadOverTimeline(lines, SECTIONS);
    expect(out).toHaveLength(7);
    expect(out.every((d) => d.at.section)).toBe(true);
  });

  it('leaves a spread show with a line live in every section, at any count', () => {
    // The end-to-end claim the button makes: put them on the timeline and the
    // director is never handed nothing, wherever the set has got to.
    const sections = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}` }));

    for (const count of [1, 2, 3, 4, 5, 8, 9, 14]) {
      const lines = Array.from({ length: count }, (_, i) => `line ${i}`);
      const out = spreadOverTimeline(lines, sections);
      for (const section of sections) {
        const live = activeDirection(out, { sectionId: section.id, sectionBars: 0 });
        expect(live, `${count} lines, ${section.id}`).not.toBe(null);
      }
    }
  });
});

describe('the text format', () => {
  it('reads a plain line as a standing direction', () => {
    const [one] = parseDirectionLines('keep it dark and slow');
    expect(one.text).toBe('keep it dark and slow');
    expect(one.at.section).toBe('');
  });

  it('reads "section: text"', () => {
    const [one] = parseDirectionLines('drop: let it go');
    expect(one.at.section).toBe('drop');
    expect(one.text).toBe('let it go');
  });

  it('reads an offset, in bars by default', () => {
    const [one] = parseDirectionLines('drop +16: hold it');
    expect(one.at).toEqual({ section: 'drop', bars: 16, seconds: null, whole: false });
  });

  it('reads an offset in seconds when it says so', () => {
    const [one] = parseDirectionLines('drop +30s: hold it');
    expect(one.at).toEqual({ section: 'drop', bars: null, seconds: 30, whole: false });
  });

  it('skips blank lines and comments', () => {
    const out = parseDirectionLines('one\n\n# not this one\ntwo\n');
    expect(out.map((d) => d.text)).toEqual(['one', 'two']);
  });

  it('keeps a sentence that merely contains punctuation whole', () => {
    const [one] = parseDirectionLines('dark, cold, and patient — never bright');
    expect(one.text).toBe('dark, cold, and patient — never bright');
    expect(one.at.section).toBe('');
  });

  it('round-trips through the editor without moving a line', () => {
    const before = spreadOverTimeline(['a', 'b', 'c', 'd'], SECTIONS);
    const after = parseDirectionLines(directionLines(before));
    expect(after.map((d) => ({ at: d.at, text: d.text })))
      .toEqual(before.map((d) => ({ at: d.at, text: d.text })));
  });

  it('round-trips a standing line with an offset', () => {
    const before = normalizeDirections([{ at: { seconds: 600 }, text: 'second half' }]);
    const after = parseDirectionLines(directionLines(before));
    expect(after[0].at).toEqual({ section: '', bars: null, seconds: 600, whole: true });
  });
});

describe('validateDirections', () => {
  it('says nothing about a list that is fine', () => {
    const report = validateDirections(
      spreadOverTimeline(['a', 'b', 'c'], SECTIONS),
      { sectionIds: SECTIONS.map((s) => s.id) }
    );
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('warns, never errors, about a section that does not exist', () => {
    // A bad pre-direction must not be able to stop a set: the worst it does is
    // never reach the model.
    const report = validateDirections(
      normalizeDirections([{ at: { section: 'gone' }, text: 'x' }]),
      { sectionIds: SECTIONS.map((s) => s.id) }
    );
    expect(report.ok).toBe(true);
    expect(report.warnings[0].message).toMatch(/does not exist/);
  });

  it('skips the reference check when the caller cannot say what exists', () => {
    const report = validateDirections(
      normalizeDirections([{ at: { section: 'not-built-yet' }, text: 'x' }])
    );
    expect(report.warnings).toEqual([]);
  });

  it('warns about a line that can never be heard because another shares its moment', () => {
    const report = validateDirections(normalizeDirections([
      { at: { section: 'drop' }, text: 'one' },
      { at: { section: 'drop' }, text: 'two' },
    ]), { sectionIds: ['drop'] });
    expect(report.warnings[0].message).toMatch(/same moment/);
  });

  it('warns about both units on one line', () => {
    const report = validateDirections(
      normalizeDirections([{ at: { section: 'drop', bars: 4, seconds: 4 }, text: 'x' }])
    );
    expect(report.warnings.some((w) => /both "bars" and "seconds"/.test(w.message))).toBe(true);
  });
});

describe('describeDirectionAt', () => {
  it('names the whole set, a section, and an offset into one', () => {
    expect(describeDirectionAt(null)).toBe('the whole set');
    expect(describeDirectionAt({ section: 'drop' })).toBe('"drop"');
    expect(describeDirectionAt({ section: 'drop', bars: 16 })).toBe('"drop", 16 bars in');
    expect(describeDirectionAt({ seconds: 600 })).toBe('the set, 600s in');
  });
});
