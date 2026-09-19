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
 * How large the words are drawn, as a fraction of the frame.
 *
 * `autoFit` shrinks whatever will not fit, so this is a ceiling rather than a
 * size: a four-word sign-off comes up large, a fifty-word opening settles to
 * whatever fits. Erring large is right — these are read once, from the back of
 * a room, while somebody is speaking them.
 */
const SIZE = 0.16;

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
  const words = cardText(text);
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
          lineHeight: 1.35,
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
