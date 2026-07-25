/**
 * Collapsible parameter groups.
 *
 * The panel renders a parameter under a collapsible heading when its definition carries a `group`.
 * That only works if `group` survives the trip from the NodeDef through getParameterDefinitions,
 * which rebuilds definitions field by field and silently drops anything it does not name — the
 * reason the sections were invisible in the app despite the rendering code being present. These
 * tests cover both halves: the field surviving the copy, and the heading actually collapsing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';
import { NodeDefs } from '../src/data/NodeDefs.js';

/** A panel with no constructor side effects: only the grouping code is under test. */
function makePanel() {
  const panel = Object.create(ParameterPanel.prototype);
  panel.panelContent = document.createElement('div');
  panel.rendered = [];
  // Stand in for the real control rendering, which needs the whole binding/expression stack.
  panel.renderParameter = function (param) {
    const el = document.createElement('div');
    el.className = 'parameter-container';
    el.dataset.name = param.name;
    this.panelContent.appendChild(el);
    panel.rendered.push({ name: param.name, parent: this.panelContent });
  };
  panel.addExpressionHelp = () => {};
  return panel;
}

const groupHeaders = (root) =>
  Array.from(root.children)
    .map((section) => section.querySelector('span'))
    .filter(Boolean)
    .map((caret) => caret.parentElement);

describe('parameter group definitions', () => {
  it('forwards group metadata from a NodeDef to the rendered definitions', () => {
    const panel = makePanel();
    const defs = panel.getParameterDefinitions({ kind: 'AudioAnalysis', id: 'n1', params: {} });

    const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
    expect(byName.kickThresh.group).toBe('Triggers');
    expect(byName.attack.group).toBe('Meter Shape');
    expect(byName.attack.groupCollapsed).toBe(true);
  });

  it('gives every Audio Analysis parameter a group so none floats loose', () => {
    const params = NodeDefs.AudioAnalysis.params;
    expect(params.length).toBeGreaterThan(0);
    for (const param of params) {
      expect(param.group, `${param.name} has no group`).toBeTruthy();
    }
  });

  it('leaves parameters without a group untouched', () => {
    const panel = makePanel();
    const defs = panel.getParameterDefinitions({ kind: 'RandomValue', id: 'n2', params: {} });
    expect(defs.every((d) => d.group === undefined)).toBe(true);
  });
});

describe('collapsible parameter groups', () => {
  let panel;
  let node;

  beforeEach(() => {
    panel = makePanel();
    node = { kind: 'AudioAnalysis', id: 'n1', params: {} };
  });

  it('renders one collapsible section per group, in declaration order', () => {
    panel.renderParameters(node);

    const headers = groupHeaders(panel.panelContent);
    expect(headers.map((h) => h.textContent.replace(/[▸▾]/g, ''))).toEqual([
      'Triggers',
      'Meter Shape'
    ]);
  });

  it('starts a group collapsed when its first parameter says so', () => {
    panel.renderParameters(node);

    const [triggers, meter] = groupHeaders(panel.panelContent).map((h) => h.nextSibling);
    expect(triggers.style.display).toBe('block');
    expect(meter.style.display).toBe('none');
    // Collapsed only hides the controls; they are still rendered into the section.
    expect(meter.querySelectorAll('.parameter-container').length).toBe(3);
  });

  it('toggles a section when its header is clicked', () => {
    panel.renderParameters(node);

    const header = groupHeaders(panel.panelContent)[0];
    const body = header.nextSibling;

    header.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(body.style.display).toBe('none');
    expect(header.firstChild.textContent).toBe('▸');

    header.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(body.style.display).toBe('block');
    expect(header.firstChild.textContent).toBe('▾');
  });

  it('remembers collapsed state across the re-render that follows a parameter edit', () => {
    panel.renderParameters(node);
    groupHeaders(panel.panelContent)[0].dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );

    panel.renderParameters(node);

    const [triggers, meter] = groupHeaders(panel.panelContent).map((h) => h.nextSibling);
    expect(triggers.style.display).toBe('none');
    expect(meter.style.display).toBe('none');
  });

  it('renders ungrouped parameters directly in the panel, with no heading', () => {
    panel.renderParameters({ kind: 'RandomValue', id: 'n2', params: {} });

    expect(groupHeaders(panel.panelContent)).toEqual([]);
    expect(panel.panelContent.querySelectorAll('.parameter-container').length).toBe(1);
  });
});
