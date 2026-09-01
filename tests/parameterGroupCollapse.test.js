/**
 * Collapsible parameter groups, and dimming the parameters a node is not reading.
 *
 * Both are declared on the NodeDef (`group`, `activeWhen`) and both have to survive
 * getParameterDefinitions, which rebuilds definitions field by field and silently drops anything
 * it does not name — the reason the sections were invisible in the app despite the rendering code
 * being present. These tests drive a real ParameterPanel so the declaration, the copy and the
 * rendering are all exercised together.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';
import { NodeDefs } from '../src/data/NodeDefs.js';
import { optionValues } from '../src/utils/discreteParams.js';

const makePanel = () => new ParameterPanel({ on() {}, emit() {} }, null, { nodes: [] });

const sections = (panel) =>
  Array.from(panel.panelContent.querySelectorAll('.parameter-group')).map((section) => ({
    name: section.dataset.group,
    open: section.querySelector('.parameter-group-header').nextSibling.style.display !== 'none',
    inactive: section.classList.contains('parameter-group-inactive'),
    fields: Array.from(section.querySelectorAll('.parameter-container'))
      .map((el) => el.getAttribute('data-param'))
  }));

const headerFor = (panel, name) =>
  Array.from(panel.panelContent.querySelectorAll('.parameter-group'))
    .find((s) => s.dataset.group === name)
    .querySelector('.parameter-group-header');

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const render = (panel, kind, params = {}, inputs = []) => {
  const node = { kind, id: 'n1', params, inputs };
  panel.renderParameters(node);
  return node;
};

const dimmed = (panel) =>
  Array.from(panel.panelContent.querySelectorAll('.parameter-inactive'))
    .map((el) => el.getAttribute('data-param'));

describe('parameter group definitions', () => {
  let panel;
  beforeEach(() => { panel = makePanel(); });

  it('forwards group metadata from a NodeDef to the rendered definitions', () => {
    const defs = panel.getParameterDefinitions({ kind: 'AudioAnalysis', id: 'n1', params: {} });

    const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
    expect(byName.kickThresh.group).toBe('Triggers');
    expect(byName.attack.group).toBe('Meter Shape');
    expect(byName.attack.groupCollapsed).toBe(true);
  });

  it('forwards the conditions under which a parameter applies', () => {
    const defs = panel.getParameterDefinitions({ kind: 'ComputeFieldMapper', id: 'n1', params: {} });
    const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
    expect(byName.instanceCount.activeWhen).toEqual({ mode: 'instances' });

    const gradient = panel.getParameterDefinitions({ kind: 'ComputeGradient', id: 'n2', params: {} });
    expect(gradient.find((d) => d.name === 'inputMix').activeWhenConnected).toBe(0);
  });

  it('gives every Audio Analysis parameter a group so none floats loose', () => {
    const params = NodeDefs.AudioAnalysis.params;
    expect(params.length).toBeGreaterThan(0);
    for (const param of params) {
      expect(param.group, `${param.name} has no group`).toBeTruthy();
    }
  });

  it('leaves parameters without a group untouched', () => {
    const defs = panel.getParameterDefinitions({ kind: 'RandomValue', id: 'n2', params: {} });
    expect(defs.every((d) => d.group === undefined)).toBe(true);
  });
});

describe('collapsible parameter groups', () => {
  let panel;
  beforeEach(() => { panel = makePanel(); });

  it('renders one collapsible section per group, in declaration order', () => {
    render(panel, 'AudioAnalysis');
    expect(sections(panel).map((s) => s.name)).toEqual(['Triggers', 'Meter Shape']);
  });

  it('starts a group collapsed when its first parameter says so', () => {
    render(panel, 'AudioAnalysis');
    const [triggers, meter] = sections(panel);

    expect(triggers.open).toBe(true);
    expect(meter.open).toBe(false);
    // Collapsed only hides the controls; they are still rendered into the section.
    expect(meter.fields).toEqual(['attack', 'release', 'gain']);
  });

  it('toggles a section when its header is clicked', () => {
    render(panel, 'AudioAnalysis');
    const header = headerFor(panel, 'Triggers');

    // The caret is an icon-sprite <use> reference, not a text glyph.
    const caretIcon = () => header.firstChild.querySelector('use')?.getAttribute('href');

    click(header);
    expect(sections(panel)[0].open).toBe(false);
    expect(caretIcon()).toBe('#icon-chevron-right');

    click(header);
    expect(sections(panel)[0].open).toBe(true);
    expect(caretIcon()).toBe('#icon-chevron-down');
  });

  it('remembers collapsed state across the re-render that follows a parameter edit', () => {
    render(panel, 'AudioAnalysis');
    click(headerFor(panel, 'Triggers'));

    render(panel, 'AudioAnalysis');

    expect(sections(panel).map((s) => s.open)).toEqual([false, false]);
  });

  it('renders a mode switch above the sections it selects between', () => {
    // ComputeFieldMapper's `mode` chooses between the Surface and Instances sections, so it is
    // left ungrouped and has to land above both headings rather than inside one.
    render(panel, 'ComputeFieldMapper');

    const children = Array.from(panel.panelContent.children);
    const modeIndex = children.findIndex((el) => el.getAttribute?.('data-param') === 'mode');
    const firstSection = children.findIndex((el) => el.classList?.contains('parameter-group'));
    expect(modeIndex).toBeGreaterThanOrEqual(0);
    expect(modeIndex).toBeLessThan(firstSection);

    expect(sections(panel).map((s) => s.name))
      .toEqual(['Surface', 'Size & Field', 'Transform', 'Instances']);
  });

  it('renders ungrouped parameters directly in the panel, with no heading', () => {
    render(panel, 'RandomValue');

    expect(sections(panel)).toEqual([]);
    expect(panel.panelContent.querySelectorAll('.parameter-container').length).toBe(1);
  });
});

describe('parameters the node is not reading', () => {
  let panel;
  beforeEach(() => { panel = makePanel(); });

  it('dims the instancing controls while the 3D visualizer is in surface mode', () => {
    render(panel, 'ComputeFieldMapper', { mode: 'surface' });
    expect(dimmed(panel)).toEqual([
      'instanceShape', 'instanceCount', 'instanceSize', 'sizeByField', 'instanceThreshold'
    ]);
  });

  it('dims the surface controls instead once the mode is instances', () => {
    render(panel, 'ComputeFieldMapper', { mode: 'instances' });
    expect(dimmed(panel)).toEqual(['shape', 'resolution']);
  });

  it('dims a whole section heading when nothing under it applies', () => {
    render(panel, 'ComputeFieldMapper', { mode: 'surface' });
    expect(sections(panel).map((s) => [s.name, s.inactive])).toEqual([
      ['Surface', false], ['Size & Field', false], ['Transform', false], ['Instances', true]
    ]);
  });

  it('falls back to the declared default when the node carries no value yet', () => {
    render(panel, 'ComputeFieldMapper', {});
    expect(dimmed(panel)).toContain('instanceCount');
    expect(dimmed(panel)).not.toContain('shape');
  });

  it('matches any value in a list', () => {
    render(panel, 'ComputeThreshold', { mode: 'Binary' });
    expect(dimmed(panel)).toEqual(['thresholdMin', 'thresholdMax']);

    render(panel, 'ComputeThreshold', { mode: 'Adaptive' });
    expect(dimmed(panel)).toEqual(['thresholdMin', 'thresholdMax']);

    render(panel, 'ComputeThreshold', { mode: 'Range' });
    expect(dimmed(panel)).toEqual(['threshold']);
  });

  it('reads booleans, so Speed goes dim when Animate is off', () => {
    render(panel, 'ComputeKaleidoscope', { animate: false });
    expect(dimmed(panel)).toEqual(['speed']);

    render(panel, 'ComputeKaleidoscope', { animate: true });
    expect(dimmed(panel)).toEqual([]);
  });

  it('dims Texture 2D playback controls until the loaded file is a video', () => {
    render(panel, 'Texture2D', { sourceType: 'image' });
    expect(dimmed(panel)).toEqual(['playing', 'loop', 'playbackRate', 'sound', 'trimStart', 'trimEnd', 'reset']);

    render(panel, 'Texture2D', { sourceType: 'video' });
    expect(dimmed(panel)).toEqual([]);
  });

  it('renders no control for the parameter a node maintains for itself', () => {
    render(panel, 'Texture2D', { sourceType: 'video' });
    const fields = Array.from(panel.panelContent.querySelectorAll('.parameter-container'))
      .map((el) => el.getAttribute('data-param'));
    expect(fields).not.toContain('sourceType');
    expect(fields).toContain('playbackRate');
  });

  it('dims a parameter whose input pin has nothing wired to it', () => {
    render(panel, 'ComputeGradient', { colorMode: 'Grayscale' }, [null]);
    expect(dimmed(panel)).toContain('inputMix');

    render(panel, 'ComputeGradient', { colorMode: 'Grayscale' }, ['7']);
    expect(dimmed(panel)).not.toContain('inputMix');
  });

  it('leaves a parameter lit when an expression drives the value it depends on', () => {
    // "=time > 0.5" cannot be resolved at render time, and dimming a live control is worse than
    // leaving a dead one lit.
    render(panel, 'ComputeKaleidoscope', { animate: '=time > 0.5' });
    expect(dimmed(panel)).toEqual([]);
  });

  it('says why a control is dim', () => {
    render(panel, 'ComputeFieldMapper', { mode: 'surface' });
    expect(panel.panelContent.querySelector('[data-param="instanceCount"]').title)
      .toBe('Only applies when Mode is instances');

    render(panel, 'ComputeThreshold', { mode: 'Range' });
    expect(panel.panelContent.querySelector('[data-param="threshold"]').title)
      .toBe('Only applies when Mode is Binary or Adaptive');

    render(panel, 'ComputeGradient', {}, [null]);
    expect(panel.panelContent.querySelector('[data-param="inputMix"]').title)
      .toBe('Not used until something is connected to Value');
  });

  it('leaves nodes that declare no conditions entirely undimmed', () => {
    render(panel, 'ComputeBlur', {});
    expect(dimmed(panel)).toEqual([]);
  });

  it('redraws the panel when a parameter others key off changes', () => {
    const node = render(panel, 'ComputeFieldMapper', { mode: 'surface' });
    panel.selectedNode = node;
    let refreshed = false;
    panel.refreshParameterDisplays = () => { refreshed = true; };

    node.params.mode = 'instances';
    panel.handleParameterChange({ node, parameterName: 'mode', newValue: 'instances', source: 'user' });

    expect(dimmed(panel)).toEqual(['shape', 'resolution']);
    expect(refreshed).toBe(false);
  });

  it('takes the cheap path for a parameter nothing keys off', () => {
    const node = render(panel, 'ComputeFieldMapper', { mode: 'surface' });
    panel.selectedNode = node;
    let refreshed = false;
    panel.refreshParameterDisplays = () => { refreshed = true; };

    panel.handleParameterChange({ node, parameterName: 'scale', newValue: 2, source: 'user' });

    expect(refreshed).toBe(true);
  });
});

describe('declarations across every node', () => {
  // Sections are built from consecutive runs, so a group interrupted by another group renders as
  // two separate headings with the same name. Nothing catches that at author time.
  it('keeps each group contiguous within its node', () => {
    for (const [kind, def] of Object.entries(NodeDefs)) {
      const seen = [];
      let previous = null;
      for (const param of def.params || []) {
        const group = param.group || null;
        if (group !== previous) {
          expect(seen, `${kind}: group "${group}" is split by other parameters`).not.toContain(group);
          seen.push(group);
          previous = group;
        }
      }
    }
  });

  // Only the first parameter of a section is consulted for the initial state; setting it further
  // down is a silent no-op that reads as if it works.
  it('declares groupCollapsed only on the parameter that opens a group', () => {
    for (const [kind, def] of Object.entries(NodeDefs)) {
      let previous = null;
      for (const param of def.params || []) {
        const group = param.group || null;
        const opensGroup = group !== null && group !== previous;
        if (param.groupCollapsed !== undefined) {
          expect(opensGroup, `${kind}.${param.name}: groupCollapsed has no effect here`).toBe(true);
        }
        previous = group;
      }
    }
  });

  // A condition naming a parameter that does not exist, or a value outside that parameter's
  // options, can only ever dim the control forever - and looks correct in review.
  it('keys every activeWhen off a real parameter and a reachable value', () => {
    for (const [kind, def] of Object.entries(NodeDefs)) {
      for (const param of def.params || []) {
        for (const [name, expected] of Object.entries(param.activeWhen || {})) {
          const target = (def.params || []).find((p) => p.name === name);
          expect(target, `${kind}.${param.name} keys off missing parameter "${name}"`).toBeTruthy();
          if (!target.options) continue;
          // Through optionValues, since an option is either the value itself or a {value, label}
          // pair and both shapes are in the registry.
          const allowed = optionValues(target);
          for (const value of Array.isArray(expected) ? expected : [expected]) {
            expect(allowed, `${kind}.${param.name}: "${value}" is not an option of ${name}`)
              .toContain(String(value));
          }
        }
        if (param.activeWhenConnected !== undefined) {
          expect((def.pinsIn || []).length,
            `${kind}.${param.name} keys off input pin ${param.activeWhenConnected}, which does not exist`)
            .toBeGreaterThan(param.activeWhenConnected);
        }
      }
    }
  });
});
