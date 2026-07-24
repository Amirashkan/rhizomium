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

// The `level` output is the shaped envelope (window._audioEnvelopeValue); onset detection runs on
// the band-limited SPECTRAL FLUX (window._audioFluxBass etc.) — the per-frame positive spectral
// change published by BrowserAudioCapture. Sustained loudness has ~0 flux; a hit spikes it.
function setLevel(v) {
  window._audioEnvelopeValue = v;
}
function setFlux(v) {
  window._audioFluxBass = v;
}

const AUDIO_GLOBALS = [
  '_audioEnvelopeValue', '_audioEnvelopeBass', '_audioEnvelopeMids', '_audioEnvelopeHighs',
  '_audioEnvelopeFull', '_audioFluxBass', '_audioFluxMids', '_audioFluxHighs', '_audioFluxFull',
  '_audioFluxCustom',
];

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
    for (const g of AUDIO_GLOBALS) window[g] = 0;
  });

  afterEach(() => {
    for (const g of AUDIO_GLOBALS) delete window[g];
  });

  it('fires a single-frame trig and a full kick envelope on a flux spike', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // Quiet baseline frame — no flux, no hit.
    setLevel(0.6);
    setFlux(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);

    // Sudden spectral change — a kick.
    setFlux(0.3);
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.6);

    // Flux sustained at the same value — trig is a single-frame pulse, so it clears.
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
    // ...but level keeps reporting the live continuous value.
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.6);
  });

  it('never fires on sustained loudness — only spectral change counts', () => {
    // The point of the flux detector: a held bass note keeps the band's LEVEL high but its
    // spectrum static, so flux stays ~0 and no threshold tuning is needed to reject it.
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    window._audioEnvelopeBass = 0.9; // loud, saturated band level
    setLevel(0.9);
    setFlux(0.0); // ...but nothing NEW is happening
    let fired = 0;
    for (let i = 0; i < 30; i++) {
      proc.update(graph, { time: 0.016 * i, uniformManager: um });
      fired += um.uniformValues.get('k.trig');
    }
    expect(fired).toBe(0);
  });

  it('rejects a weak hit below the absolute floor (relative to the recent peak)', () => {
    const node = kickNode({ threshold: 0.3 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // A strong kick sets the running flux peak...
    setFlux(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setFlux(0.5);
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);

    // ...quiet frames well past the refractory window...
    setFlux(0.0);
    for (let i = 2; i < 25; i++) proc.update(graph, { time: 0.016 * i, uniformManager: um });

    // ...then a weak blip: ~0.1/0.5 = ~0.2 of the recent peak, below the 0.3 floor -> rejected.
    setFlux(0.1);
    proc.update(graph, { time: 0.016 * 25, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
  });

  it('does not re-trigger while flux is sustained (rising-edge gate)', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setFlux(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setFlux(0.6);
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
      setFlux(0.0);
      proc.update(graph, { time: t, uniformManager: um });
      setFlux(0.6);
      proc.update(graph, { time: t + 0.008, uniformManager: um });
      return um.uniformValues.get('k.trig');
    };

    expect(kick(0.0)).toBe(1);       // first kick at ~0.008s
    expect(kick(0.03)).toBe(0);      // ~0.038s: within 100ms refractory -> suppressed
    expect(kick(0.20)).toBe(1);      // ~0.208s: past the window -> allowed
  });

  it('requires prominence over a busy passage (adaptive median+MAD threshold)', () => {
    // When onset-level flux is landing nearly every frame, a spike no bigger than the ambient
    // churn is not a distinct hit. The median+MAD threshold learned from the recent history
    // rejects it without any manual retuning.
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // Busy passage: strong, constantly varying flux.
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      setFlux(i % 2 ? 0.25 : 0.15);
      proc.update(graph, { time: 0.016 * i, uniformManager: um });
      fired += um.uniformValues.get('k.trig');
    }
    // A "spike" at the same magnitude as the ambient churn -> not prominent, no fire.
    setFlux(0.25);
    proc.update(graph, { time: 0.016 * 40, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);
    expect(fired).toBeLessThanOrEqual(1); // at most the initial edge, then the stats clamp down
  });

  it('decays the kick envelope toward zero over the kick-release time', () => {
    const node = kickNode({ kickRelease: 100 });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    setFlux(0.0);
    proc.update(graph, { time: 0.0, uniformManager: um });
    setFlux(0.6);
    proc.update(graph, { time: 0.016, uniformManager: um }); // kick env -> 1.0
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);

    // Flux falls back to silence; the kick envelope should monotonically decay and approach 0.
    setFlux(0.0);
    let prev = 1.0;
    for (let i = 2; i < 16; i++) {
      proc.update(graph, { time: 0.016 * i, uniformManager: um });
      const env = um.uniformValues.get('k.kick');
      expect(env).toBeLessThan(prev);
      prev = env;
    }
    expect(prev).toBeLessThan(0.2);
  });

  it('detects on the selected band\'s spectral flux, not the shaped level', () => {
    // The shaped level (follower/ADSR output) plateaus and must never drive detection; the flux
    // of the node's Band must. A Mids node ignores bass flux and fires on mids flux.
    const node = kickNode({ band: 'Mids' });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    // Shaped level high, bass flux spiking — the Mids node stays silent.
    window._audioEnvelopeValue = 0.9;
    window._audioFluxBass = 0.6;
    window._audioFluxMids = 0.0;
    proc.update(graph, { time: 0.0, uniformManager: um });
    window._audioFluxBass = 0.0;
    proc.update(graph, { time: 0.016, uniformManager: um });
    window._audioFluxBass = 0.6;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);

    // A flux spike on the Mids band -> a hit, and `level` still reports the shaped value.
    window._audioFluxMids = 0.5;
    proc.update(graph, { time: 0.048, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);
    expect(um.uniformValues.get('k.kick')).toBeCloseTo(1.0);
    expect(um.uniformValues.get('k.level')).toBeCloseTo(0.9);
  });

  it('uses the dedicated custom-band flux for Band: Custom', () => {
    const node = kickNode({ band: 'Custom' });
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);

    window._audioFluxFull = 0.6; // must be ignored — Custom no longer falls back to Full
    window._audioFluxCustom = 0.0;
    proc.update(graph, { time: 0.0, uniformManager: um });
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(0);

    window._audioFluxCustom = 0.5;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('k.trig')).toBe(1);
  });

  it('mirrors the live level onto node.__kickLevel for the CPU preview', () => {
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);
    setLevel(0.42);
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
    setFlux(0.6);
    proc.update(makeGraph([node]), { time: 0.0, uniformManager: makeUniformManager(['k']) });
    expect(proc._state.has('k')).toBe(true);

    const other = { id: 'x', kind: 'Time', params: {}, inputs: [] };
    proc.update(makeGraph([other]), { time: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('k')).toBe(false);
  });
});
