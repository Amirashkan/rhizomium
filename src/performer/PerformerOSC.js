/**
 * PerformerOSC.js - the musician's hands on the performer.
 *
 * Declared signals are polled (SignalBus reads OSCManager's last-value map
 * every frame, which is the right shape for a fader that streams). This file
 * is the other half: the MOMENTS. A cue, a section change, a tap, a panic —
 * things that happen once and must not be missed between two frames, so they
 * are taken from the message stream as it arrives rather than sampled.
 *
 * The address space is deliberately short enough to type into a Max object or
 * a Lemur button from memory at a soundcheck:
 *
 *   /rhizo/perf/start                  start, or resume from a pause
 *   /rhizo/perf/stop                   stop and rewind
 *   /rhizo/perf/pause                  hold where it is
 *   /rhizo/perf/panic                  kill the output, pause the set
 *
 *   /rhizo/perf/cue <name>             fire a cue by name
 *   /rhizo/perf/cue/<name>             …or as part of the address, for a
 *                                      sender that only sends bangs
 *   /rhizo/perf/section <name|index>   jump to a section
 *   /rhizo/perf/next                   move the set on
 *
 *   /rhizo/perf/bpm <f>                set the tempo
 *   /rhizo/perf/tap                    tap it instead
 *   /rhizo/perf/bar                    downbeat — realigns the grid
 *   /rhizo/perf/beat                   beat — realigns more finely
 *
 *   /rhizo/perf/energy <0-1>           how hard the music is going
 *   /rhizo/perf/signal/<name> <f>      drive any named signal directly
 *   /rhizo/perf/steer <text>           a line of direction for the director
 *   /rhizo/perf/director <0|1>         let the model in, or shut it out
 *   /rhizo/perf/master <0-1>           the master fader
 *   /rhizo/perf/blackout <0|1>
 *
 * ## Two rules that cost a set if they are missed
 *
 * **A button sends twice.** Most controllers send 1 on press and 0 on release,
 * so a cue bound to a button would fire twice — once for the drop and once a
 * fraction of a second later, cutting the drop. Every trigger here is
 * edge-triggered: it fires on a rising edge and ignores the release.
 *
 * **A bang is not a number.** OSC's `I` (impulse) and an empty argument list
 * both mean "now", and they arrive with no value at all. Treating a missing
 * argument as 0 would make every bang read as a release and nothing would ever
 * fire. Absence therefore means "fire", and only an explicit 0 means "off".
 */

const PREFIX = '/rhizo/perf';

/** Above this a reading is "pressed". Matches the OSC binding layer's habit. */
const EDGE_THRESHOLD = 0.5;

/**
 * A value that means "do it".
 *
 * @param {Array} args the message's arguments
 * @returns {boolean|null} true to fire, false for a release, null for "not a trigger"
 */
function triggerValue(args) {
  if (!args || args.length === 0) return true;

  const first = args[0];
  if (first === true) return true;
  if (first === false) return false;
  // An impulse decodes as null: OSC's way of writing a bang.
  if (first === null || first === undefined) return true;

  const n = Number(first);
  if (!Number.isFinite(n)) return true;
  return n >= EDGE_THRESHOLD;
}

/** First argument as a string, for the addresses that carry a name. */
function stringArg(args) {
  if (!args || !args.length) return '';
  const first = args[0];
  if (typeof first === 'string') return first.trim();
  if (typeof first === 'number' && Number.isFinite(first)) return String(first);
  return '';
}

function numberArg(args, fallback = 0) {
  const n = Number(args?.[0]);
  return Number.isFinite(n) ? n : fallback;
}

export class PerformerOSC {
  /**
   * @param {PerformerEngine} engine
   * @param {object} [options]
   * @param {object} [options.eventSystem] the editor's event bus
   * @param {string} [options.prefix] override the address root
   */
  constructor(engine, options = {}) {
    this.engine = engine;
    this.eventSystem = options.eventSystem || null;
    this.prefix = options.prefix || PREFIX;

    /** Last state per edge-triggered address, so a release does not re-fire. */
    this._edges = new Map();

    /** Addresses seen under our prefix, for the panel's "is it arriving" list. */
    this.seen = new Map();

    this._handler = (message) => this.handle(message);
    this._attached = false;
  }

  /** Start listening. Idempotent. */
  attach() {
    if (this._attached || !this.eventSystem?.on) return false;
    this.eventSystem.on('OSC_MESSAGE', this._handler);
    this._attached = true;
    return true;
  }

  detach() {
    if (!this._attached) return false;
    this.eventSystem?.off?.('OSC_MESSAGE', this._handler);
    this._attached = false;
    this._edges.clear();
    return true;
  }

  /**
   * Route one OSC message.
   *
   * @param {{address: string, args: Array}} message
   * @returns {string|null} what it did, for the log and for tests
   */
  handle(message) {
    const address = message?.address;
    if (typeof address !== 'string' || !address.startsWith(this.prefix)) return null;

    // '' for the prefix itself, '/cue' for a child.
    const path = address.slice(this.prefix.length);
    const args = Array.isArray(message.args) ? message.args : [];

    this.seen.set(address, { args, at: Date.now() });

    const engine = this.engine;
    if (!engine) return null;

    // Trailing-segment forms first: /cue/drop and /signal/bass carry their
    // name in the address, which is the only way a sender that emits bare
    // bangs can say which cue it means.
    if (path.startsWith('/cue/')) {
      const name = path.slice(5);
      return this.edge(address, args) ? this.fire(name) : null;
    }
    if (path.startsWith('/signal/')) {
      const name = path.slice(8);
      engine.signals.push(name, numberArg(args, 0));
      return `signal ${name}`;
    }

    switch (path) {
      case '/start':
        return this.edge(address, args) ? (engine.start(), 'start') : null;
      case '/stop':
        return this.edge(address, args) ? (engine.stop(), 'stop') : null;
      case '/pause':
        return this.edge(address, args) ? (engine.pause(), 'pause') : null;
      case '/panic':
        return this.edge(address, args) ? (engine.panic(), 'panic') : null;

      case '/cue': {
        const name = stringArg(args);
        if (!name) return null;
        // Named in the argument, so the edge is tracked per cue name rather
        // than per address — otherwise a controller sending /cue "a" then
        // /cue "b" would swallow the second as a repeat.
        return this.edge(`${address}#${name}`, args.slice(1)) ? this.fire(name) : null;
      }

      case '/section': {
        const reference = stringArg(args);
        if (!reference) return null;
        // A number is an index, a word is an id or a name. Both are common:
        // a grid controller sends indices, a script sends names.
        const asNumber = Number(reference);
        const target = Number.isInteger(asNumber) && String(asNumber) === reference
          ? asNumber
          : reference;
        engine.jumpToSection(target, 'osc');
        return `section ${reference}`;
      }

      case '/next':
        return this.edge(address, args) ? (engine.nextSection('osc'), 'next') : null;

      case '/bpm': {
        const bpm = numberArg(args, 0);
        return engine.clock.setBPM(bpm) ? `bpm ${bpm}` : null;
      }

      case '/tap':
        if (!this.edge(address, args)) return null;
        engine.clock.tap();
        return `tap ${engine.clock.bpm}`;

      case '/bar':
        if (!this.edge(address, args)) return null;
        engine.clock.syncToBar();
        return 'bar sync';

      case '/beat':
        if (!this.edge(address, args)) return null;
        engine.clock.syncToBeat();
        return 'beat sync';

      case '/energy':
        engine.signals.setEnergy(numberArg(args, 0));
        return null;

      case '/steer':
        engine.director?.setSteer?.(stringArg(args));
        return 'steer';

      case '/director': {
        const on = triggerValue(args);
        engine.director?.setEnabled?.(Boolean(on));
        return `director ${on ? 'on' : 'off'}`;
      }

      case '/master':
        engine.perform({ type: 'master', to: numberArg(args, 1), overSeconds: 0 }, 'osc');
        return 'master';

      case '/blackout': {
        const on = triggerValue(args);
        engine.perform({ type: 'blackout', on: Boolean(on) }, 'osc');
        return `blackout ${on ? 'on' : 'off'}`;
      }

      default:
        return null;
    }
  }

  /**
   * Whether this message is a rising edge.
   *
   * A bang (no argument) is always an edge: there is no release to pair it
   * with, and a sender that bangs twice in a row means it twice.
   */
  edge(key, args) {
    if (!args || args.length === 0) return true;

    const value = triggerValue(args);
    const previous = this._edges.get(key) ?? false;
    this._edges.set(key, value);
    return value && !previous;
  }

  fire(name) {
    if (!name) return null;
    this.engine.fireCue(name);
    return `cue ${name}`;
  }

  /** The addresses the panel lists, so an artist can see their sender arriving. */
  activity() {
    return [...this.seen.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 30)
      .map(([address, entry]) => ({ address, args: entry.args, at: entry.at }));
  }

  /** Every address this router answers, for the panel's help and the README. */
  static addresses(prefix = PREFIX) {
    return [
      { address: `${prefix}/start`, takes: 'bang', does: 'Start, or resume from a pause.' },
      { address: `${prefix}/stop`, takes: 'bang', does: 'Stop and rewind.' },
      { address: `${prefix}/pause`, takes: 'bang', does: 'Hold where it is.' },
      { address: `${prefix}/panic`, takes: 'bang', does: 'Kill the output and pause.' },
      { address: `${prefix}/cue`, takes: 'string', does: 'Fire a cue by name.' },
      { address: `${prefix}/cue/<name>`, takes: 'bang', does: 'Fire that cue.' },
      { address: `${prefix}/section`, takes: 'string or index', does: 'Jump to a section.' },
      { address: `${prefix}/next`, takes: 'bang', does: 'Move the set on.' },
      { address: `${prefix}/bpm`, takes: 'float', does: 'Set the tempo.' },
      { address: `${prefix}/tap`, takes: 'bang', does: 'Tap the tempo.' },
      { address: `${prefix}/bar`, takes: 'bang', does: 'Downbeat — realign the grid.' },
      { address: `${prefix}/beat`, takes: 'bang', does: 'Beat — realign the grid.' },
      { address: `${prefix}/energy`, takes: 'float 0-1', does: 'How hard the music is going.' },
      { address: `${prefix}/signal/<name>`, takes: 'float', does: 'Drive a named signal.' },
      { address: `${prefix}/steer`, takes: 'string', does: 'A line of direction for the AI.' },
      { address: `${prefix}/director`, takes: '0 or 1', does: 'Let the AI in, or shut it out.' },
      { address: `${prefix}/master`, takes: 'float 0-1', does: 'Master fader.' },
      { address: `${prefix}/blackout`, takes: '0 or 1', does: 'Kill or restore the output.' },
    ];
  }
}

export { PREFIX as PERFORMER_OSC_PREFIX };
export default PerformerOSC;
