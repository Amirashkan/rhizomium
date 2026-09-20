/**
 * EndCard.js — the two ends of an episode, as a patch nobody had to generate.
 *
 * An episode opens on about fifty words spoken over a dark screen and closes on
 * twenty more. The sound is the show's; the picture, until now, was nothing —
 * the ends of a set are written as sections with no transmission behind them,
 * so they name a scene that may not exist and hold in the dark.
 *
 * Dark is right. Words on the dark are better: a room with the sound down, a
 * stream someone opened muted, a recording watched with subtitles off — all of
 * them get the opening this way, and none of them got it before.
 *
 * What makes this worth doing is that it costs nothing. Every other look in a
 * show is a prompt and a model call; a card is a string, and the Text node
 * (src/data/nodes/TextNodes.js) rasterises a string into a texture that samples
 * exactly like an image. So the patch is built here, in code, and handed to
 * `installScene` like a generated one. No call, no key, no waiting, and the
 * same result every time — which for the first twenty-nine seconds of a show is
 * what you want.
 *
 * It is a plain scene once installed. An artist who wants the opening over
 * their own footage opens it in the editor and wires one in; the card is a
 * starting point, not a fixture.
 */

/** Node ids inside a card patch. Short, and namespaced so nothing collides. */
const TEXT_NODE = 'card-text';
const OUTPUT_NODE = 'card-output';

/**
 * White on black, and deliberately not the show's palette.
 *
 * A palette here is a line of prose — "near-black, sodium orange, bone white" —
 * and picking a colour out of it means guessing which words are colours and
 * which of those is light enough to read. A guess that goes wrong is an opening
 * nobody can read, at the one moment the audience is being told what the show
 * is. White on black is legible projected large, at any size, in any room.
 */
const INK = [1, 1, 1, 1];
const GROUND = [0, 0, 0, 1];

/** Longest card we will draw. Past this the text is the show, not a title. */
export const MAX_CARD_CHARS = 600;

/**
 * Pixels per side of the card's texture.
 *
 * The node's own default is 1024, which at 1080 output is already an upscale and
 * softens every glyph. A card is rasterised once and never touched again — it is
 * a string, not an animation — so this costs memory rather than frame time, and
 * 2048 covers a 1080p canvas with room over. 4096 is the node's ceiling and
 * worth it only for 4K: four times the bytes, inlined into the saved scene,
 * which makes the patch file large.
 */
export const RESOLUTION = 2048;

/** Line spacing, as a multiple of the font size. */
export const LINE_HEIGHT = 1.35;

/**
 * Roughly how wide a glyph is, as a fraction of the font size.
 *
 * Only used to decide how many characters go on a line before the text is handed
 * over; the rasteriser measures for real afterwards. Half the font size is the
 * usual figure for a sans-serif at mixed case.
 */
const GLYPH_ASPECT = 0.5;

/** No card is wrapped narrower than this, however short it is. */
const MIN_LINE_CHARS = 12;

/**
 * How large the words are drawn, as a fraction of the frame.
 *
 * `autoFit` shrinks whatever will not fit, so this is a ceiling rather than a
 * size: a four-word sign-off comes up large, a fifty-word opening settles to
 * whatever fits. Erring large is right — these are read once, from the back of
 * a room, while somebody is speaking them.
 *
 * It is also why turning this up by hand does nothing to a long card: the block
 * is already too wide to fit, so autoFit was scaling it down from here and
 * simply scales it down further from a bigger number. `wrapCard` is the thing
 * that makes a card bigger.
 */
const SIZE = 0.16;

/**
 * Break a card into lines that let it be read.
 *
 * The node lays out into a SQUARE texture, and `fit: "contain"` maps that square
 * to the frame's shorter side — so on 16:9 the words only ever use the middle
 * 56% of the width. Inside the square, autoFit shrinks the block until BOTH its
 * widest line and its total height fit, which means the longest line governs the
 * size of every glyph. An opening that arrives as one line per story has lines
 * of eighty-odd characters, and that is what made the words tiny: nothing to do
 * with the font size, which autoFit was already overriding.
 *
 * So: stop the width being the binding constraint. Writing the two limits
 * against the usable square, with `a` the glyph aspect and `h` the line height:
 *
 *     width-limited    fontPx = usable · R / (a · W)
 *     height-limited   fontPx = usable · R / (h · L)
 *
 * They are equal when `W = (h / a) · L`, and with `W · L ≈ N` characters that
 * settles at `W = sqrt(h / a · N)` — about 28 characters over 10 lines for a
 * fifty-word opening, 17 over 6 for a short sign-off. Short cards come up large
 * and long ones stay readable, with nothing to tune per episode.
 */
export function wrapCard(text, lineHeight = LINE_HEIGHT) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';

  const characters = words.join(' ').length;
  const target = Math.max(
    MIN_LINE_CHARS,
    Math.round(Math.sqrt((lineHeight / GLYPH_ASPECT) * characters)),
  );

  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length > target) {
      lines.push(line);
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line) lines.push(line);

  // One word alone on the last line reads as a mistake rather than as a line.
  // Two ways out, in order: put it back up if the line above can take it, or
  // else pull a word down to keep it company. A line above that is itself a
  // single word can still spare it — a lone word in the middle of a block is
  // ordinary, a lone word at the end of one looks like a fault.
  if (lines.length > 1 && !lines[lines.length - 1].includes(' ')) {
    const last = lines[lines.length - 1];
    const above = lines[lines.length - 2];

    if (above.length + 1 + last.length <= target) {
      lines[lines.length - 2] = `${above} ${last}`;
      lines.pop();
    } else {
      const words = above.split(' ');
      if (words.length >= 2) {
        lines[lines.length - 1] = `${words.pop()} ${last}`;
        lines[lines.length - 2] = words.join(' ');
      }
    }
  }

  return lines.join('\n');
}

/** A card's text, trimmed and tidied for drawing. */
export function cardText(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_CARD_CHARS) return clean;

  // Cut at a sentence if there is one in reach, never mid-word.
  const window = clean.slice(0, MAX_CARD_CHARS - 1);
  for (const separator of ['. ', '; ', ', ', ' ']) {
    const cut = window.lastIndexOf(separator);
    if (cut > MAX_CARD_CHARS * 0.6) return `${window.slice(0, cut).replace(/[ ,;]+$/, '')}…`;
  }
  return `${window.trimEnd()}…`;
}

/**
 * A patch that draws one string on black.
 *
 * @param {string} text the words to put up
 * @returns {{nodes: Array, connections: Array}|null} null when there is nothing to draw
 */
export function endCardPatch(text) {
  // Trimmed first, then wrapped: trimming after the wrap would cut a line off
  // rather than a clause.
  const words = wrapCard(cardText(text));
  if (!words) return null;

  return {
    nodes: [
      {
        id: TEXT_NODE,
        kind: 'Text',
        x: 0,
        y: 0,
        inputs: [],
        params: {
          text: words,
          // Every one of these is baked into the bitmap rather than sent as a
          // uniform, so the card is drawn once and costs nothing per frame.
          size: SIZE,
          autoFit: true,
          align: 'center',
          posX: 0.5,
          posY: 0.5,
          fit: 'contain',
          color: [...INK],
          // The whole point: alpha 1 behind the glyphs, so this is words on
          // black rather than words on whatever the last look left up.
          background: [...GROUND],
          lineHeight: LINE_HEIGHT,
          resolution: RESOLUTION,
        },
      },
      {
        id: OUTPUT_NODE,
        kind: 'OutputFinal',
        x: 320,
        y: 0,
        // The editor keeps both the connection list and each node's inputs
        // array; a patch that fills only one of them loads with a dead wire.
        inputs: [TEXT_NODE],
        params: {},
      },
    ],
    connections: [
      // Pin 0 out of Text is Color; pin 0 into Output is the colour it shows.
      { from: { nodeId: TEXT_NODE, pin: 0 }, to: { nodeId: OUTPUT_NODE, pin: 0 } },
    ],
  };
}

export default endCardPatch;
