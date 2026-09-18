/**
 * PreDirections.js - the direction written before the show, not during it.
 *
 * The panel has always had one box for direction: a line the artist types
 * while the set runs — "keep it dark", "more strobe" — carried into the next
 * question the director asks. It works because someone is standing there. The
 * moment the whole show is handed to the model there is nobody to type into
 * it, and the director spends a forty-minute set with the one sentence that
 * was in the box when the doors opened, or with nothing at all.
 *
 * A pre-direction is the same sentence, written at the desk and anchored to a
 * moment of the show:
 *
 *   { at: { section: 'drop', bars: 16 }, text: 'let it go, full frame' }
 *
 * So the set carries its own direction the way it already carries its own
 * sections, and an unattended show is directed rather than merely improvised.
 *
 * ## Two anchors, and why both
 *
 * `at.section` names the section the line belongs to, and `at.bars` /
 * `at.seconds` is an offset INTO that section — the same unit a move in that
 * section is written in (Scenario.normalizeMove), for the same reason: a
 * section is the unit a show is planned in, and a section entered by a cue has
 * no position on any clock until it is entered.
 *
 * A line with no section is a standing direction, offset from the top of the
 * set. That is the one an artist writes first ("patient, cold, never bright"),
 * and it is what holds for any section that has no line of its own.
 *
 * ## What is live, at a moment
 *
 * `activeDirection()` answers with exactly one line, under a two-tier rule:
 *
 *   the show's standing direction, overridden by the section's own
 *
 * Within a tier the latest one reached wins, which is what makes several lines
 * inside one long section read as a sequence rather than a contradiction.
 * Nothing here interpolates or concatenates: two sentences handed to a model as
 * one instruction is how a director gets told to keep it dark and go bright in
 * the same breath.
 *
 * ## The discipline
 *
 * Exactly Scenario.js's: `normalizeDirections()` coerces anything and throws
 * nothing, `validateDirections()` is the separate strict pass that reports ALL
 * the problems at once. Pre-directions are hand-written, spread over a timeline
 * by a button, round-tripped through a saved scenario and read back by a model,
 * so all four writers get to be sloppy.
 *
 * It knows nothing about the engine, the director or the panel — which is what
 * makes the resolution rule above testable without standing any of them up.
 */

/**
 * Ceilings.
 *
 * `count` is generous because only ONE line is ever sent: the director is
 * handed whichever is live, never the list, so a long list costs a prompt
 * nothing. What it has to be big enough for is a spread — putting a handful of
 * lines on the timeline fills every section, so the list that comes back out
 * is as long as the set is, and a cap under that would silently leave the end
 * of a long show undirected.
 *
 * So: one line per section of the longest legal set (Scenario.LIMITS.sections,
 * 128), the standing lines that sit under them, and room for a few stacked
 * inside one section. A set exported by `transmissions` writes exactly
 * sections + 1 and was the case that found the old ceiling.
 *
 * `textChars` is the one that matters, and it is per line: a direction is a
 * sentence, and something longer than this is a brief in the wrong box.
 */
export const DIRECTION_LIMITS = Object.freeze({
  count: 160,
  textChars: 240,
});

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const str = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

/** The same slug rule section ids use, so `at.section` can be written as a name. */
function slug(value) {
  return str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The reserved anchor name for the top of the show, rather than a section. */
export const WHOLE_SHOW = 'set';

/**
 * Where a line takes effect.
 *
 * `bars` and `seconds` are null rather than 0 when unwritten, so "at the top"
 * and "nobody said" stay distinguishable — the second is what a line spread
 * over the timeline by the panel gets, and it must not read as a deliberate
 * choice of unit when the section it lands in is counted in the other one.
 *
 * `whole` is the same distinction one level up, and it exists for
 * `spreadOverTimeline()`. Two different lines both have no section on them:
 *
 *   "keep it dark"       nobody has placed this yet — deal it out
 *   "set: keep it dark"  this one is the SHOW's, and holds under everything
 *
 * At showtime they behave identically (no section means the standing tier), so
 * nothing but the spread reads this. But the spread has to tell them apart: it
 * deals the first onto a section, and dealing the second there would take the
 * show's floor away from every other section of it.
 */
export function normalizeDirectionAt(raw) {
  const nowhere = { section: '', bars: null, seconds: null, whole: false };
  if (raw === undefined || raw === null) return nowhere;

  // A bare string is a section: the shorthand a hand-written scenario reaches
  // for, and what `spreadOverTimeline()` would otherwise have to spell out.
  if (typeof raw === 'string') {
    const named = slug(raw);
    if (!named) return nowhere;
    if (named === WHOLE_SHOW) return { ...nowhere, whole: true };
    return { section: named, bars: null, seconds: null, whole: false };
  }
  // A bare number is an offset from the top of the set, in seconds. Seconds
  // rather than bars because a number with no unit on it is only ever written
  // by someone reading a clock.
  if (typeof raw === 'number') {
    return { section: '', bars: null, seconds: Math.max(0, num(raw, 0)), whole: true };
  }
  if (typeof raw !== 'object') return nowhere;

  const named = slug(raw.section ?? raw.sectionId ?? raw.id);
  const section = named === WHOLE_SHOW ? '' : named;
  const bars = raw.bars === undefined || raw.bars === null
    ? null : Math.max(0, num(raw.bars, 0));
  const seconds = raw.seconds === undefined || raw.seconds === null
    ? null : Math.max(0, num(raw.seconds, 0));

  return {
    section,
    bars,
    seconds,
    // Said outright, said by naming the show, or implied: an offset with no
    // section on it is a time measured from the top of the set, which nobody
    // writes by accident.
    whole: !section && (raw.whole === true || named === WHOLE_SHOW
      || bars !== null || seconds !== null),
  };
}

/** Coerce one direction. Never throws. */
export function normalizeDirection(raw, index = 0) {
  // A bare string is the whole point of the shorthand: a list of lines, in
  // order, is what an artist types before anyone has decided where they land.
  const input = raw && typeof raw === 'object' ? raw : { text: str(raw) };

  return {
    id: slug(input.id) || `direction${index + 1}`,
    at: normalizeDirectionAt(input.at ?? input.section ?? input.when),
    text: str(input.text ?? input.direction ?? input.say)
      .trim()
      .slice(0, DIRECTION_LIMITS.textChars),
  };
}

/**
 * Coerce a list of directions, in the order they were written.
 *
 * Empty lines are dropped rather than kept as blanks: a direction with no text
 * is not a direction that says nothing to the model, it is a line the artist
 * deleted, and carrying it would let it override the standing line with
 * silence.
 */
export function normalizeDirections(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const taken = new Set();

  return list
    .slice(0, DIRECTION_LIMITS.count)
    .map((entry, index) => normalizeDirection(entry, index))
    .filter((entry) => Boolean(entry.text))
    .map((entry, index) => {
      // Ids only have to be unique, and only so the panel can key rows off
      // them. Nothing in the show refers to a direction by id.
      let id = entry.id;
      if (taken.has(id)) id = `${id}-${index + 1}`;
      taken.add(id);
      return { ...entry, id };
    });
}

/**
 * Report everything wrong with a list of directions, without changing it.
 *
 * Warnings, almost entirely. A pre-direction cannot break a set — the worst a
 * bad one does is never reach the model — and a show that stops because line
 * nine names a section that was renamed is a show that stops in front of an
 * audience. Same rule as a section whose scene is missing.
 *
 * @param {Array} directions NORMALISED directions
 * @param {{sectionIds?: string[]}} [known] the sections that exist, when the
 *   caller can say. Skipped when not passed: a direction written before its
 *   sections is not wrong yet.
 * @returns {{ok: boolean, errors: Array, warnings: Array}}
 */
export function validateDirections(directions, known = {}) {
  const errors = [];
  const warnings = [];
  const at = (where, message) => ({ where, message });
  const list = Array.isArray(directions) ? directions : [];

  if (list.length >= DIRECTION_LIMITS.count) {
    warnings.push(at('directions', `Only the first ${DIRECTION_LIMITS.count} pre-directions are kept.`));
  }

  const ids = Array.isArray(known.sectionIds) ? new Set(known.sectionIds) : null;
  const seen = new Map();

  list.forEach((direction, index) => {
    const where = `pre-direction ${index + 1}`;

    if (direction.at.section && ids && !ids.has(direction.at.section)) {
      warnings.push(at(where, `Anchored to section "${direction.at.section}", which does not exist. The line will never be reached — put it on the timeline again.`));
    }

    if (direction.at.bars !== null && direction.at.seconds !== null) {
      warnings.push(at(where, 'Has both "bars" and "seconds". Bars wins on metered material, seconds otherwise — write one.'));
    }

    // Two lines at the same instant is not an error, but only one of them can
    // ever be live, and which one is an ordering detail nobody chose.
    const key = `${direction.at.whole ? WHOLE_SHOW : direction.at.section}`
      + `@${direction.at.bars}/${direction.at.seconds}`;
    if (seen.has(key)) {
      warnings.push(at(where, `Lands at the same moment as pre-direction ${seen.get(key) + 1}. The later one wins; the other is never heard.`));
    } else {
      seen.set(key, index);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Has this line been reached, given where the show is?
 *
 * The offset is read in whichever unit the line was written in, against the
 * matching clock. A line with neither is reached the moment its anchor is —
 * which is what a line spread over the timeline wants, and what "the standing
 * direction" means for a line with no section at all.
 */
function reached(direction, now) {
  const { section, bars, seconds } = direction.at;

  if (section) {
    if (section !== now.sectionId) return false;
    if (bars !== null) return num(now.sectionBars, 0) >= bars;
    if (seconds !== null) return num(now.sectionSeconds, 0) >= seconds;
    return true;
  }

  if (bars !== null) return num(now.setBars, 0) >= bars;
  if (seconds !== null) return num(now.setSeconds, 0) >= seconds;
  return true;
}

/**
 * The one line that is live right now, or null.
 *
 * Two tiers: the show's standing direction, overridden by one anchored to the
 * section the set is actually in. Within a tier the last one reached wins, so
 * several lines inside one section play out as a sequence.
 *
 * Cheap on purpose — the engine calls this every time it offers the director a
 * state, which is every frame the director is on.
 *
 * @param {Array} directions NORMALISED directions
 * @param {object} now where the show is
 * @param {string|null} [now.sectionId]
 * @param {number} [now.sectionBars] bars since this section was entered
 * @param {number} [now.sectionSeconds] seconds since this section was entered
 * @param {number} [now.setBars] bars since the set started
 * @param {number} [now.setSeconds] seconds since the set started
 * @returns {object|null} the direction, as it appears in the list
 */
export function activeDirection(directions, now = {}) {
  const list = Array.isArray(directions) ? directions : [];

  let standing = null;
  let inSection = null;

  for (const direction of list) {
    if (!direction?.text) continue;
    if (!reached(direction, now)) continue;
    if (direction.at.section) inSection = direction;
    else standing = direction;
  }

  return inSection || standing;
}

/**
 * Put a list of lines on the timeline: one per section, in the order written.
 *
 * This is what the panel's **Set on the timeline** does, and it is the whole
 * reason the anchors above are optional. An artist directing a show writes the
 * arc as a handful of sentences — that is the natural act — and what they mean
 * by the third sentence is the third part of the set, not a bar number they
 * would have to go and count.
 *
 * Three cases, and the middle one is the interesting one:
 *
 *   as many lines as sections   one each, in order
 *   fewer lines than sections   dealt out in order, and then REPEATED into the
 *                               sections between them, so each one holds until
 *                               the next takes over
 *   more lines than sections    the extras stack up inside the section they
 *                               reach, offset so they read in order
 *
 * The repeat in the middle case is the whole difference between this button
 * working and not. `activeDirection()` deliberately does not carry a section's
 * line into the next section — a drop that is over should not still be telling
 * the model to go hard — so without materialising the coverage here, three
 * lines spread over six sections would leave every other section of the show
 * undirected, which is the exact failure the feature exists to fix. The
 * carry-forward belongs to the act of spreading, which knows it is covering a
 * show, rather than to the rule, which cannot tell coverage from a line
 * written for one section on purpose.
 *
 * A line already anchored to a section that exists is left exactly where the
 * artist put it: this is a way to lay out the ones that have no place yet, not
 * a way to lose the ones that do. A section that has one of those needs no
 * repeat into it either — it is already directed.
 *
 * Pure. It takes the sections it should spread over and returns a new list.
 *
 * @param {Array} directions NORMALISED directions
 * @param {Array} sections the scenario's sections, in order
 * @returns {Array} a new normalised list, anchored
 */
export function spreadOverTimeline(directions, sections = []) {
  const list = normalizeDirections(directions);
  const ids = (Array.isArray(sections) ? sections : [])
    .map((section) => slug(section?.id ?? section?.name))
    .filter(Boolean);

  if (!ids.length || !list.length) return list;

  const known = new Set(ids);
  // The ones the artist has already placed keep their anchor; only the rest
  // are dealt out, and they are dealt out among themselves — so a placed line
  // does not use up a section the loose ones were going to be spread across.
  const loose = list
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.at.whole
      && (!entry.at.section || !known.has(entry.at.section)));
  if (!loose.length) return list;

  /** index in `list` -> the section that line lands on, and how many preceded it there. */
  const placement = new Map();
  const countPer = new Map();

  loose.forEach(({ index }, nth) => {
    // Floor rather than round: four lines over three sections gives 0,0,1,2 —
    // the extra line early, where a build is, rather than stacked on the last
    // section where there is nothing left to say.
    const position = Math.min(ids.length - 1, Math.floor((nth * ids.length) / loose.length));
    const id = ids[position];
    const before = countPer.get(id) || 0;
    countPer.set(id, before + 1);
    placement.set(index, { section: id, nth: before });
  });

  const anchored = list.map((entry, index) => {
    const spot = placement.get(index);
    if (!spot) return entry;
    return {
      ...entry,
      at: {
        section: spot.section,
        // The first line of a section is its direction from the moment it is
        // entered; a second is a change of mind partway through. Offsetting
        // the first would leave the top of the section with no direction at
        // all, which is the gap this whole feature exists to close. Four bars
        // apart after that — a phrase's worth of distance at any tempo.
        bars: spot.nth === 0 ? null : spot.nth * 4,
        seconds: null,
        whole: false,
      },
    };
  });

  return fillTimelineGaps(anchored, sections);
}

/**
 * Repeat each line into the sections after it that have none of their own.
 *
 * Both ways of getting direction onto a timeline end here: the panel's **Set
 * on the timeline** (which deals unplaced lines out first) and a show built
 * from a manifest (where every look already named its own line, and the
 * sections the model added between them did not).
 *
 * The reason it has to be written out rather than inferred is
 * `activeDirection()`: it deliberately does not carry a section's line into
 * the next section, because a drop that is over should not still be telling
 * the model to go hard. That is right for a line written for one section on
 * purpose and wrong for a line meant to cover a stretch of show, and only the
 * caller knows which it has. So the callers that are covering a show say so,
 * here, by materialising it.
 *
 * Sections are walked in order, so "the line before it" means the right thing
 * on a set whose lines were placed by different hands. A section with any line
 * of its own is left alone. Nothing is repeated before the first line — the
 * top of a show with no direction until section three has none, rather than
 * borrowing from the future.
 *
 * Pure.
 *
 * @param {Array} directions NORMALISED directions, already anchored
 * @param {Array} sections the scenario's sections, in order
 * @returns {Array} a new list: the standing lines, then one or more per section
 */
export function fillTimelineGaps(directions, sections = []) {
  const list = normalizeDirections(directions);
  const ids = (Array.isArray(sections) ? sections : [])
    .map((section) => slug(section?.id ?? section?.name))
    .filter(Boolean);

  if (!ids.length) return list;

  const filled = [];
  let holding = null;

  for (const id of ids) {
    // In this section's own order: the lines that belong to it, then the
    // repeat for any section after it that has none.
    const mine = list.filter((entry) => entry.at.section === id);
    if (mine.length) {
      filled.push(...mine);
      // The last line of the section is the one still standing when it ends,
      // so it is the one that carries.
      holding = mine[mine.length - 1];
      continue;
    }
    if (!holding) continue;
    filled.push({
      ...holding,
      // A copy, so the panel can key its rows off ids that are actually unique.
      id: `${holding.id}-${id}`,
      at: { section: id, bars: null, seconds: null, whole: false },
    });
  }

  // The show's own lines hold across everything and keep their place at the
  // front, where they read as the floor the rest sits on. A line anchored to a
  // section that is not in this set comes too: it is the artist's, it is only
  // inert, and dropping it here would delete it on the next round trip.
  const known = new Set(ids);
  const standing = list.filter(
    (entry) => !entry.at.section || !known.has(entry.at.section)
  );
  const out = [...standing, ...filled];

  // Belt and braces against a set at the section ceiling: the cap is matched
  // to it, so this only ever bites if one of them moves.
  return out.length > DIRECTION_LIMITS.count ? out.slice(0, DIRECTION_LIMITS.count) : out;
}

/**
 * Directions from a block of text, one line each.
 *
 * The panel's editor is a textarea rather than a table for the same reason the
 * scenario's is: the thing being written is prose, and the act is typing three
 * sentences, not filling in nine fields. A line may name its section with a
 * leading `section:` — which is what `directionLines()` writes back — so a
 * layout survives the round trip through the box.
 *
 *   patient, cold, never bright        a standing direction
 *   drop: let it go, full frame        anchored to the section "drop"
 *   drop +16: and hold it there        16 bars into it
 *
 * A `#` line is a comment, so an artist can keep a line they are not using
 * without the model being handed it.
 */
export function parseDirectionLines(text) {
  const lines = str(text).split(/\r?\n/);
  const out = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // `section +offset: text`. The colon is the separator because a direction
    // is a sentence and a sentence may contain anything else.
    const match = /^([^:+]{1,80}?)\s*(?:\+\s*(\d+(?:\.\d+)?)\s*(b|bars?|s|sec|secs|seconds?)?)?\s*:\s*(.+)$/i
      .exec(line);

    if (!match) {
      out.push({ at: null, text: line });
      continue;
    }

    const [, where, amount, unit, body] = match;
    // `set` is the reserved word for the top of the show, and the one
    // `directionLines()` writes for a standing line that has an offset. Read
    // back as a section it would anchor the line to a section nobody has, so
    // the round trip through the box would quietly break the only line whose
    // whole job is to hold for the whole set.
    const named = slug(where);
    const whole = named === WHOLE_SHOW;
    const at = { section: whole ? '' : named, bars: null, seconds: null, whole };
    if (amount !== undefined) {
      // Bars unless it says otherwise: the unit a set is counted in, and the
      // one the spread above writes.
      if (unit && /^s/i.test(unit)) at.seconds = Number(amount);
      else at.bars = Number(amount);
    }
    out.push({ at, text: body.trim() });
  }

  return normalizeDirections(out);
}

/** One line per direction, in the format `parseDirectionLines()` reads back. */
export function directionLines(directions) {
  return normalizeDirections(directions)
    .map((direction) => {
      const { section, bars, seconds, whole } = direction.at;
      // A line nobody has placed is a bare line, which is how it was typed and
      // what tells the spread it is still free to place it.
      if (!section && !whole && bars === null && seconds === null) return direction.text;

      const offset = bars !== null ? ` +${bars}b` : seconds !== null ? ` +${seconds}s` : '';
      // `set` for the show's own lines: the reserved name, and the one thing
      // that survives the round trip as "this holds everywhere" rather than
      // being dealt to whichever section came first.
      return `${section || WHOLE_SHOW}${offset}: ${direction.text}`;
    })
    .join('\n');
}

/** Where a line lands, in the words the panel uses. */
export function describeDirectionAt(at) {
  const anchor = normalizeDirectionAt(at);
  const offset = anchor.bars !== null ? `${anchor.bars} bars in`
    : anchor.seconds !== null ? `${anchor.seconds}s in`
    : '';

  // Said the same way for a line the artist called the show's and one nobody
  // has placed, because at showtime they are the same thing: the standing
  // direction. The difference only matters to the spread.
  if (!anchor.section) return offset ? `the set, ${offset}` : 'the whole set';
  return offset ? `"${anchor.section}", ${offset}` : `"${anchor.section}"`;
}

export default normalizeDirections;
