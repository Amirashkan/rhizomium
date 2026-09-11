// The performer's slot in the shared RAF.
//
// This exists because the wiring got it wrong once in a way nothing else would
// have caught: window.renderLoop does not exist yet at the point in boot where
// the performer is built, and the loop is rebuilt whenever the preview config
// changes. Both mistakes are silent — optional chaining skips the
// registration, and a set then simply never advances.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnifiedRAFManager, PRIORITY } from '../src/core/UnifiedRAFManager.js';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';

// From the working directory rather than from import.meta.url: under the
// happy-dom environment these tests run in, import.meta.url is an http: URL
// and fileURLToPath refuses it. Vitest runs from the repo root.
const readMain = () => readFileSync(join(process.cwd(), 'main.js'), 'utf8');

describe('main.js wiring', () => {
  it('registers the handler where the render loop is built, not where the performer is', () => {
    const mainSource = readMain();
    // The call must appear after `window.renderLoop = renderLoopController`,
    // which is the only point at which there is a manager to register on.
    const assignment = mainSource.indexOf('window.renderLoop = renderLoopController;');
    const calls = [...mainSource.matchAll(/registerPerformerFrameHandler\(\);/g)].map((m) => m.index);

    expect(assignment).toBeGreaterThan(-1);
    expect(calls.some((at) => at > assignment)).toBe(true);
  });

  it('re-registers rather than registering once at boot', () => {
    // Two call sites: one when the performer is built (for a loop that already
    // exists), one when the loop is rebuilt (for a performer that already does).
    const calls = readMain().match(/registerPerformerFrameHandler\(\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the handler itself', () => {
  let manager;
  let engine;
  let clock;
  let now;

  beforeEach(() => {
    now = 0;
    clock = new PerformerClock({ now: () => now });
    engine = new PerformerEngine({
      clock,
      executor: {
        rules: null,
        execute: () => ({ ok: true, cost: 1 }),
        tick() {},
        clearDrives() {},
        status: () => ({ drives: [], ramps: [], blackedOut: false, transition: {}, sceneChangeInFlight: false }),
      },
    });
    engine.loadScenario({ sections: [{ name: 'One' }] });

    manager = new UnifiedRAFManager();
    manager.registerHandler(
      'ai-performer',
      (frameInfo) => engine.tick(frameInfo?.timestamp),
      PRIORITY.LOW,
      { condition: () => engine.state === 'running' }
    );
  });

  it('does not run while nothing is being performed', () => {
    manager.processFrame({ timestamp: 16 });
    expect(manager.getHandlers().find((h) => h.name === 'ai-performer').skipCount)
      .toBeGreaterThan(0);
  });

  it('advances the clock once running', () => {
    engine.start(); // anchors the clock at now = 0
    now = 500;
    manager.processFrame({ timestamp: 500 });
    now = 1000;
    manager.processFrame({ timestamp: 1000 });

    // One second at 120 BPM is two beats.
    expect(engine.clock.beats).toBeCloseTo(2, 1);
  });

  it('replaces rather than doubles when registered twice', () => {
    manager.registerHandler('ai-performer', () => {}, PRIORITY.LOW);
    const named = manager.getHandlers().filter((h) => h.name === 'ai-performer');
    expect(named).toHaveLength(1);
  });
});
