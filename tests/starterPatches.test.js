import { describe, it, expect, afterEach, vi } from 'vitest';
import { STARTER_PATCHES, starterPatchById } from '../src/data/starterPatches.js';
import { NodeDefs } from '../src/data/NodeDefs.js';
import { validateGeneratedPatch } from '../api/_lib/nodeCatalog.js';
import { optionValues } from '../src/utils/discreteParams.js';
import { WelcomeWindow } from '../src/ui/WelcomeWindow.js';

/**
 * The starter patches on the welcome screen.
 *
 * They are hand-written data against a registry that moves, which is the whole
 * risk: a node that loses a parameter, or a select that loses an option, turns
 * a starter patch into a first impression that opens wrong. So they are checked
 * against the same validator a generated patch goes through, plus the parameter
 * ranges the registry declares.
 */
describe('starter patches', () => {
  it('offers three of them, with unique ids', () => {
    expect(STARTER_PATCHES).toHaveLength(3);
    const ids = STARTER_PATCHES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('gives every one a title and a sentence saying what it does', () => {
    for (const entry of STARTER_PATCHES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.blurb.length).toBeGreaterThan(0);
    }
  });

  it('is looked up by id', () => {
    expect(starterPatchById('dot-bloom')?.title).toBe('Dot Bloom');
    expect(starterPatchById('nope')).toBeNull();
  });

  for (const entry of STARTER_PATCHES) {
    describe(entry.title, () => {
      it('passes the patch validator with nothing dropped', () => {
        const { patch, warnings } = validateGeneratedPatch(entry.patch);
        // A warning here means a wire or an id did not survive validation —
        // for a patch written by hand that is a bug in the patch, not a repair.
        expect(warnings).toEqual([]);
        expect(patch.nodes).toHaveLength(entry.patch.nodes.length);
        expect(patch.connections).toHaveLength(entry.patch.connections.length);
      });

      it('ends in exactly one Output node', () => {
        const outputs = entry.patch.nodes.filter((node) => NodeDefs[node.kind].cat === 'Output');
        expect(outputs).toHaveLength(1);
      });

      it('sets only parameters the registry knows, inside their range', () => {
        for (const node of entry.patch.nodes) {
          const specs = NodeDefs[node.kind].params || [];
          for (const [name, value] of Object.entries(node.params || {})) {
            const spec = specs.find((param) => param.name === name);
            expect(spec, `${node.kind}.${name}`).toBeTruthy();

            if (typeof value === 'number') {
              if (spec.min !== undefined) expect(value, `${node.kind}.${name}`).toBeGreaterThanOrEqual(spec.min);
              if (spec.max !== undefined) expect(value, `${node.kind}.${name}`).toBeLessThanOrEqual(spec.max);
            }
            if (spec.options) {
              expect(optionValues(spec), `${node.kind}.${name}`).toContain(value);
            }
          }
        }
      });

      it('wires every node into the signal path', () => {
        const ids = new Set(entry.patch.nodes.map((node) => node.id));
        const wired = new Set();
        for (const conn of entry.patch.connections) {
          expect(ids.has(conn.from.nodeId)).toBe(true);
          expect(ids.has(conn.to.nodeId)).toBe(true);
          wired.add(conn.from.nodeId);
          wired.add(conn.to.nodeId);
        }
        // A node whose output goes nowhere is dead weight in a patch meant to
        // be read as an example.
        expect([...ids].filter((id) => !wired.has(id))).toEqual([]);
      });

      it('feeds each input pin once, and only pins the node has', () => {
        const byId = new Map(entry.patch.nodes.map((node) => [node.id, node]));
        const taken = new Set();
        for (const conn of entry.patch.connections) {
          const target = byId.get(conn.to.nodeId);
          const inCount = NodeDefs[target.kind].pinsIn.length;
          const outCount = NodeDefs[byId.get(conn.from.nodeId).kind].pinsOut.length;

          expect(conn.to.pin, `${target.kind} input pin`).toBeLessThan(inCount);
          expect(conn.from.pin, `${byId.get(conn.from.nodeId).kind} output pin`).toBeLessThan(outCount);

          const slot = `${conn.to.nodeId}:${conn.to.pin}`;
          expect(taken.has(slot), `two wires into ${slot}`).toBe(false);
          taken.add(slot);
        }
      });

      it('gives every node its own place on the canvas', () => {
        const spots = entry.patch.nodes.map((node) => `${node.x},${node.y}`);
        expect(new Set(spots).size).toBe(spots.length);
      });
    });
  }
});

describe('welcome window starter patches', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.getElementById('welcome-window-styles')?.remove();
  });

  it('shows one card per starter patch', () => {
    const welcome = new WelcomeWindow({ onOpenStarter: vi.fn() });
    welcome.show({ force: true });

    const cards = document.querySelectorAll('.starter-card');
    expect(cards).toHaveLength(STARTER_PATCHES.length);
    expect(cards[0].textContent).toContain(STARTER_PATCHES[0].title);
  });

  it('offers none when nothing can open them', () => {
    const welcome = new WelcomeWindow({});
    welcome.show({ force: true });

    expect(document.querySelectorAll('.starter-card')).toHaveLength(0);
  });

  it('hands the clicked patch over and closes', async () => {
    const onOpenStarter = vi.fn().mockResolvedValue(undefined);
    const welcome = new WelcomeWindow({ onOpenStarter });
    welcome.show({ force: true });
    const hide = vi.spyOn(welcome, 'hide');

    await welcome.openStarter('mirror-cells');

    expect(onOpenStarter).toHaveBeenCalledTimes(1);
    expect(onOpenStarter.mock.calls[0][0].id).toBe('mirror-cells');
    expect(hide).toHaveBeenCalled();
  });

  it('stays open when the patch could not be loaded', async () => {
    const onOpenStarter = vi.fn().mockRejectedValue(new Error('no editor'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const welcome = new WelcomeWindow({ onOpenStarter });
    welcome.show({ force: true });
    const hide = vi.spyOn(welcome, 'hide');

    await welcome.openStarter('dot-bloom');

    expect(hide).not.toHaveBeenCalled();
    expect(welcome.overlay).not.toBeNull();
    warn.mockRestore();
  });

  it('ignores a starter id it does not have', async () => {
    const onOpenStarter = vi.fn();
    const welcome = new WelcomeWindow({ onOpenStarter });
    welcome.show({ force: true });

    await welcome.openStarter('not-a-patch');

    expect(onOpenStarter).not.toHaveBeenCalled();
  });
});
