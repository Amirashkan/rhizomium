import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioKickProcessor } from '../src/core/AudioKickProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the kick node's three keys registered (as the
// compiler's getParam() would).
function makeUniformManager(kickNodeIds = []) {
  const uniformValues = new Map();
  for (const id of kickNodeIds) {
    uniformValues.set(`${id}.kick`, 0);
    uniformValues.set(`${id}.trig`, 0);
    uniformValues.set(`${id}.level`, 0);
  }
  return { uniformValues };
}

function kickNode(params = {}) {
  return {
    id: 'k', kind: 'AudioKick',
    params: { band: 'Bass', threshold: 0.15, sensitivity: 1.6, release: 140, refractory: 90, ...params },
    inputs: [],
  };
}

// Drive the live bass energy the processor reads from window.
function setBass(v) { window._audioEnvelopeBass = v; }

describe('AudioKickProcessor', () => {
  let proc;

  beforeEach(() => {
    proc = new AudioKickProcessor();
    window._audioEnvelopeBass = 0;
    window._audioEnvelopeMids = 0;
    window._audioEnvelopeHighs = 0;
    window._audioEnvelopeFull = 0;
    window._audioEnvelopeValue = 0;
  });

  afterEach(() => {
    delete window._audioEnvelopeBass;
    delete window._audioEnvelopeMids;
    delete window._audioEnvelopeHighs;
    delete window._audioEnvelopeFull;
    delete window._audioEnvelopeValue;
  });

  it('fires a single-frame trig and a full envelope on a bass transient above threshold', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // Quiet baseline frame — no hit.
    setBass(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);

    // Sudden bass transient — a kick.
    setBass(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.6);

    // Sustained at the same level — trig is a single-frame pulse, so it clears.
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
  });

  it('rejects a rise that stays below the absolute threshold', () => {
    const node = kickNode({ threshold: 0.3 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setBass(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setBass(0.2); // rises, but below the 0.3 floor
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
  });

  it('does not re-trigger while the bass is sustained (adaptive/rising-edge gate)', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setBass(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setBass(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um }); // hit
    expect(um.uniformValues.get('k.trig')).toBe(1);

    // Hold at the same level for several frames — no new detection.
    let retriggers = 0;
    for (let i = 2; i < 20; i++) {
      proc.update(graph, { time: 0.016 * i, uniformManager: um });
      retriggers += um.uniformValues.get('k.trig');
    }
    expect(retriggers).toBe(0);
  });

  it('suppresses a second kick inside the refractory window, then allows one after it', () => {
    const node = kickNode({ refractory: 100 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    const kick = (t) => {
      setBass(0.0);
      proc.update(graph, { time: t, uniformManager: um });
      setBass(0.6);
      proc.update(graph, { time: t + 0.008, uniformManager: um });
      return um.uniformValues.get('k.trig');
    };

    expect(kick(0.0)).toBe(1);       // first kick at ~0.008s
    expect(kick(0.03)).toBe(0);      // ~0.038s: within 100ms refractory -> suppressed
    expect(kick(0.20)).toBe(1);      // ~0.208s: past the window -> allowed
  });

  it('decays the kick envelope toward zero over the release time', () => {
    const node = kickNode({ release: 100 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setBass(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setBass(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um }); // env -> 1.0
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);

    // Bass falls to silence; envelope should monotonically decay and approach 0.
    setBass(0.0);
    let prev = 1.0;
    for (let i = 2; i < 16; i++) {
      proc.update(graph, { time: 0.016 * i, uniformManager: um });
      const env = um.uniformValues.get('k.kick');
      expect(env).toBeLessThan(prev);
      prev = env;
    }
    expect(prev).toBeLessThan(0.2);
  });

  it('mirrors the kick envelope onto node.__kickValue for the CPU preview', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);
    setBass(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setBass(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(node.__kickValue).toBeCloseTo(1.0);
  });

  it('reads the selected band', () => {
    const node = kickNode({ band: 'Highs' });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // Bass is loud but Highs is silent -> no kick on the Highs band.
    setBass(0.9);
    window._audioEnvelopeHighs = 0.0;
    proc.update(graph, { time: 0.0, uniformManager: um });
    window._audioEnvelopeHighs = 0.0;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);

    // Now a highs transient -> kick.
    window._audioEnvelopeHighs = 0.6;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.6);
  });

  it('prunes state for deleted kick nodes', () => {
    const node = kickNode();
    setBass(0.6);
    proc.update(makeGraph([node]), { time: 0.0, uniformManager: makeUniformManager(['k']) });
    expect(proc._state.has('k')).toBe(true);

    // A later frame where the kick node is gone (but the graph still has other nodes) prunes it.
    const other = { id: 'x', kind: 'Time', params: {}, inputs: [] };
    proc.update(makeGraph([other]), { time: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('k')).toBe(false);
  });
});
