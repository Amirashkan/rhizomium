/**
 * Controls that provably do nothing under the node's current settings.
 *
 * Two of them were reported as simply broken:
 *   - Transform's pivot / Transform 2D's centre cancel out exactly while there is no rotation and
 *     no scaling to turn around, which is every node's default state.
 *   - Warp's centre and radius are only read by the three radial modes; Displace (the default)
 *     takes its direction entirely from the Warp Field and Wave is a global sine.
 * Neither is a bug in the maths, so the fix is to say so in the panel: `activeUnless` covers the
 * first (inactive only when EVERY listed parameter is at rest), `activeWhen` the second.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';

const makePanel = () => new ParameterPanel({ on() {}, emit() {} }, null, { nodes: [] });

const render = (panel, kind, params = {}, inputs = []) => {
  const node = { kind, id: 'n1', params, inputs };
  panel.renderParameters(node);
  return node;
};

const dimmed = (panel) =>
  Array.from(panel.panelContent.querySelectorAll('.parameter-inactive'))
    .map((el) => el.getAttribute('data-param'));

const tooltipFor = (panel, name) =>
  panel.panelContent.querySelector(`.parameter-container[data-param="${name}"]`)?.title;

describe('transform pivot availability', () => {
  let panel;
  beforeEach(() => { panel = makePanel(); });

  it('dims the compute Transform pivot while rotation and scale are both at rest', () => {
    render(panel, 'ComputeTransform');
    expect(dimmed(panel)).toEqual(expect.arrayContaining(['pivotX', 'pivotY']));
  });

  it('brings the pivot back as soon as there is a rotation to turn around', () => {
    render(panel, 'ComputeTransform', { rotation: 45 });
    expect(dimmed(panel)).not.toEqual(expect.arrayContaining(['pivotX', 'pivotY']));
  });

  it('brings the pivot back for a non-unit scale on either axis', () => {
    render(panel, 'ComputeTransform', { scaleX: 2 });
    expect(dimmed(panel)).not.toContain('pivotX');

    panel = makePanel();
    render(panel, 'ComputeTransform', { scaleY: 0.5 });
    expect(dimmed(panel)).not.toContain('pivotY');
  });

  it('never dims the pivot when an expression drives the rotation', () => {
    // The value is resolved per frame and could be anything, so dimming would be a guess.
    render(panel, 'ComputeTransform', { rotation: '=time * 30' });
    expect(dimmed(panel)).not.toContain('pivotX');
  });

  it('reads a value typed as a string the same as a number', () => {
    render(panel, 'ComputeTransform', { rotation: '0', scaleX: '1.0', scaleY: '1' });
    expect(dimmed(panel)).toContain('pivotX');
  });

  it('explains why the pivot is doing nothing', () => {
    render(panel, 'ComputeTransform');
    expect(tooltipFor(panel, 'pivotX')).toMatch(/Only applies while/);
  });

  it('applies the same rule to the fragment transform centres', () => {
    render(panel, 'Transform2D');
    expect(dimmed(panel)).toEqual(expect.arrayContaining(['centerX', 'centerY']));

    panel = makePanel();
    render(panel, 'Rotate2D', { rotation: 30 });
    expect(dimmed(panel)).not.toContain('centerX');

    panel = makePanel();
    render(panel, 'Scale2D');
    expect(dimmed(panel)).toContain('centerX');
  });

  it('re-renders the panel when the parameter that governs the pivot changes', () => {
    const node = { kind: 'ComputeTransform', id: 'n1', params: {}, inputs: [] };
    expect(panel._controlsOtherParameters(node, 'rotation')).toBe(true);
    expect(panel._controlsOtherParameters(node, 'scaleX')).toBe(true);
    expect(panel._controlsOtherParameters(node, 'translateX')).toBe(false);
  });
});

describe('warp centre availability', () => {
  let panel;
  beforeEach(() => { panel = makePanel(); });

  it('dims centre, radius, frequency and phase in the default Displace mode', () => {
    render(panel, 'ComputeWarp');
    expect(dimmed(panel)).toEqual(
      expect.arrayContaining(['centerX', 'centerY', 'radius', 'frequency', 'phase'])
    );
  });

  it('offers centre and radius in the radial modes', () => {
    for (const mode of ['Twist', 'Bulge', 'Pinch']) {
      panel = makePanel();
      render(panel, 'ComputeWarp', { mode });
      expect(dimmed(panel), mode).not.toEqual(expect.arrayContaining(['centerX', 'centerY', 'radius']));
      expect(dimmed(panel), mode).toEqual(expect.arrayContaining(['frequency', 'phase']));
    }
  });

  it('offers frequency and phase in Wave, which reads neither centre nor radius', () => {
    render(panel, 'ComputeWarp', { mode: 'Wave' });
    expect(dimmed(panel)).not.toEqual(expect.arrayContaining(['frequency', 'phase']));
    expect(dimmed(panel)).toEqual(expect.arrayContaining(['centerX', 'centerY', 'radius']));
  });

  it('names the modes that would make the centre live', () => {
    render(panel, 'ComputeWarp');
    expect(tooltipFor(panel, 'centerX')).toBe('Only applies when Mode is Twist, Bulge or Pinch');
  });

  it('re-renders the panel when the mode changes', () => {
    const node = { kind: 'ComputeWarp', id: 'n1', params: {}, inputs: [] };
    expect(panel._controlsOtherParameters(node, 'mode')).toBe(true);
    expect(panel._controlsOtherParameters(node, 'strength')).toBe(false);
  });
});
