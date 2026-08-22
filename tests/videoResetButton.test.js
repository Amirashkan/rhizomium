/**
 * Texture 2D's expressionable Reset control.
 *
 * The button rewinds the clip on click; the field under it holds an expression that
 * VideoResetProcessor fires on. These tests drive a real ParameterPanel so the declaration, the
 * click wiring and the stored expression are exercised together.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';
import { NodeDefs } from '../src/data/NodeDefs.js';

const makePanel = () => new ParameterPanel({ on() {}, emit() {} }, null, { nodes: [] });

const render = (panel, params) => {
  const node = { kind: 'Texture2D', id: 'n1', params, inputs: [] };
  panel.renderParameters(node);
  return node;
};

const resetContainer = (panel) =>
  Array.from(panel.panelContent.querySelectorAll('.parameter-container'))
    .find((el) => el.getAttribute('data-param') === 'reset');

describe('Texture 2D Reset control', () => {
  let panel;

  beforeEach(() => {
    panel = makePanel();
    window.textureManager = { resetVideo: vi.fn() };
    window.editor = { markDirty: vi.fn() };
  });

  afterEach(() => {
    delete window.textureManager;
    delete window.editor;
  });

  it('is declared on the node so a saved patch carries the expression', () => {
    const declared = NodeDefs.Texture2D.params.find((p) => p.name === 'reset');
    expect(declared).toMatchObject({ type: 'button', action: 'resetVideo', expressionable: true });
    expect(declared.activeWhen).toEqual({ sourceType: 'video' });
  });

  it('renders a button and an expression field for a video', () => {
    render(panel, { sourceType: 'video' });

    const container = resetContainer(panel);
    expect(container).toBeTruthy();
    expect(container.querySelector('button')).toBeTruthy();
    expect(container.querySelector('input.expression-capable')).toBeTruthy();
  });

  it('rewinds the node\'s video when the button is clicked', () => {
    const node = render(panel, { sourceType: 'video' });

    resetContainer(panel).querySelector('button')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.textureManager.resetVideo).toHaveBeenCalledWith(node.id);
    // The frame on screen is the one we just left until something asks for a redraw.
    expect(window.editor.markDirty).toHaveBeenCalled();
  });

  it('stores the typed expression on the node, where the processor reads it', () => {
    const node = render(panel, { sourceType: 'video' });
    const input = resetContainer(panel).querySelector('input');

    input.value = '  =audioEnvelopeBass > 0.6  ';
    input.dispatchEvent(new window.Event('change'));

    expect(node.params.reset).toBe('=audioEnvelopeBass > 0.6');
  });

  it('shows the stored expression again when the panel is reopened', () => {
    render(panel, { sourceType: 'video', reset: '=node_12' });

    expect(resetContainer(panel).querySelector('input').value).toBe('=node_12');
  });

  it('has no expression field on a button that is click-only', () => {
    const node = { kind: 'ComputeFeedback', id: 'n2', params: {}, inputs: [] };
    panel.renderParameters(node);

    const container = Array.from(panel.panelContent.querySelectorAll('.parameter-container'))
      .find((el) => el.getAttribute('data-param') === 'reset');
    expect(container.querySelector('button')).toBeTruthy();
    expect(container.querySelector('input.expression-capable')).toBeNull();
  });
});
