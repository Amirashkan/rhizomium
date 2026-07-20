import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the node's three keys registered (as the compiler's
// getParam() would).
function makeUniformManager(kickNodeIds = []) {
  const uniformValues = new Map();
  for (const id of kickNodeIds) {
    uniformValues.set(`${id}.level`, 0);
    uniformValues.set(`${id}.kick`, 0);
    uniformValues.set(`${id}.trig`, 0);
  }
  return { uniformValues };
}

function kickNode(params = {}) {
  return {
    id: 'k', kind: 'AudioAnalysis',
    params: { band: 'Bass', threshold: 0.15, sensitivity: 1.6, kickRelease: 140, refractory: 90, ...params },
    inputs: [],
  };
}

// The processor reads the shaped envelope (window._audioEnvelopeValue) as its analysis signal.
function setEnv(v) { window._audioEnvelopeValue = v; }

// Stub the audio engine so tests never touch the real singleton; capture pushed configs + ticks.
function stubClient() {
  const configs = [];
  let ticks = 0;
  return { configs, get ticks() { return ticks; }, tick() { ticks++; }, updateConfig(c) { configs.push(c); } };
}

describe('AudioAnalysisProcessor', () => {
  let proc;

  beforeEach(() => {
    proc = new AudioAnalysisProcessor();
    proc._audioClient = stubClient(); // isolate from the real BrowserAudioCapture singleton
    window._audioEnvelopeValue = 0;
  });

  afterEach(() => {
    delete window._audioEnvelopeValue;
  });

  it('fires a single-frame trig and a full kick envelope on a transient above threshold', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // Quiet baseline frame — no hit.
    setEnv(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);

    // Sudden transient — a kick.
    setEnv(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.6);

    // Sustained at the same level — trig is a single-frame pulse, so it clears.
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
    // ...but level keeps reporting the live continuous value.
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.6);
  });

  it('rejects a rise that stays below the absolute threshold', () => {
    const node = kickNode({ threshold: 0.3 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setEnv(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setEnv(0.2); // rises, but below the 0.3 floor
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
  });

  it('does not re-trigger while the signal is sustained (adaptive/rising-edge gate)', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setEnv(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setEnv(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um }); // hit
    expect(um.uniformValues.get('k.trig')).toBe(1);

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
      setEnv(0.0);
      proc.update(graph, { time: t, uniformManager: um });
      setEnv(0.6);
      proc.update(graph, { time: t + 0.008, uniformManager: um });
      return um.uniformValues.get('k.trig');
    };

    expect(kick(0.0)).toBe(1);       // first kick at ~0.008s
    expect(kick(0.03)).toBe(0);      // ~0.038s: within 100ms refractory -> suppressed
    expect(kick(0.20)).toBe(1);      // ~0.208s: past the window -> allowed
  });

  it('decays the kick envelope toward zero over the kick-release time', () => {
    const node = kickNode({ kickRelease: 100 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setEnv(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setEnv(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um }); // kick env -> 1.0
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);

    // Signal falls to silence; the kick envelope should monotonically decay and approach 0.
    setEnv(0.0);
    let prev = 1.0;
    for (let i = 2; i < 16; i++) {
      proc.update(graph, { time: 0.016 * i, uniformManager: um });
      const env = um.uniformValues.get('k.kick');
      expect(env).toBeLessThan(prev);
      prev = env;
    }
    expect(prev).toBeLessThan(0.2);
  });

  it('mirrors the live level onto node.__kickLevel for the CPU preview', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);
    setEnv(0.42);
    proc.update(graph, { time: 0.0, uniformManager: um });
    expect(node.__kickLevel).toBeCloseTo(0.42);
  });

  it('pushes the Band/Follower/ADSR/Shaping params to the audio engine, only when they change', () => {
    const node = kickNode({ band: 'Mids', attack: 30, envRelease: 250, gate: 0.2, curve: 'Sigmoid', normalize: false });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    proc.update(graph, { time: 0.0, uniformManager: um });
    expect(proc._audioClient.configs.length).toBe(1);
    const cfg = proc._audioClient.configs[0];
    expect(cfg.frequency.mode).toBe('mids');
    expect(cfg.follower.attack_ms).toBe(30);
    expect(cfg.follower.release_ms).toBe(250);
    expect(cfg.follower.threshold).toBe(0.2);
    expect(cfg.shaping.curve).toBe('sigmoid');
    expect(cfg.shaping.normalize).toBe(false);

    // Unchanged params -> no repeat push.
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(proc._audioClient.configs.length).toBe(1);

    // Change a param -> one more push.
    node.params.band = 'Highs';
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(proc._audioClient.configs.length).toBe(2);
    expect(proc._audioClient.configs[1].frequency.mode).toBe('highs');
  });

  it('drives the audio engine once per update so the envelope never freezes', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);
    proc.update(graph, { time: 0.0, uniformManager: um });
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(proc._audioClient.ticks).toBe(2);
  });

  it('prunes state for deleted nodes', () => {
    const node = kickNode();
    setEnv(0.6);
    proc.update(makeGraph([node]), { time: 0.0, uniformManager: makeUniformManager(['k']) });
    expect(proc._state.has('k')).toBe(true);

    const other = { id: 'x', kind: 'Time', params: {}, inputs: [] };
    proc.update(makeGraph([other]), { time: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('k')).toBe(false);
  });
});
