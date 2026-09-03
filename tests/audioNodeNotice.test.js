// The Audio node's status strip.
//
// The complaint it answers: a deployed audio node "does nothing". With no track loaded every
// channel reads 0, and so does anything reading one — indistinguishable from a broken node unless
// something says otherwise. The strip says it where the artist is already looking, and is the way
// to the panel that fixes it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParameterPanel } from '../src/ui/ParameterPanel.js';
import * as audioPanel from '../src/ui/AudioSettingsPanel.js';

const makePanel = () => new ParameterPanel({ on() {}, emit() {} }, null, { nodes: [] });
const notice = (panel) => panel.panelContent.querySelector('.node-notice');

describe('the Audio node’s status strip', () => {
  let panel;
  let source;

  beforeEach(() => {
    panel = makePanel();
    source = { state: 'empty', label: 'No audio loaded', fileName: '', playing: false, hasFile: false };
    vi.spyOn(audioPanel, 'describeAudioSource').mockImplementation(() => source);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('says why the node reads zero when nothing is loaded', () => {
    panel.renderParameters({ kind: 'AudioValue', id: 'n1', params: { channel: 'level' }, inputs: [] });

    const strip = notice(panel);
    expect(strip).toBeTruthy();
    expect(strip.dataset.state).toBe('empty');
    expect(strip.textContent).toContain('No audio loaded');
    expect(strip.textContent).toContain('every channel reads 0');
  });

  it('opens the Audio panel when clicked', () => {
    const show = vi.fn();
    vi.spyOn(audioPanel, 'getAudioSettingsPanel').mockReturnValue({ show });
    panel.renderParameters({ kind: 'AudioValue', id: 'n1', params: { channel: 'level' }, inputs: [] });

    notice(panel).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(show).toHaveBeenCalled();
  });

  it('becomes a quiet confirmation, naming the track, once it is playing', () => {
    source = { state: 'playing', label: 'Playing', fileName: 'set.wav', playing: true, hasFile: true };
    panel.renderParameters({ kind: 'AudioValue', id: 'n1', params: { channel: 'kick' }, inputs: [] });

    const strip = notice(panel);
    expect(strip.dataset.state).toBe('playing');
    expect(strip.textContent).toContain('Playing');
    expect(strip.textContent).toContain('set.wav');
    expect(strip.textContent).not.toContain('reads 0');
  });

  it('follows the source without being re-rendered', () => {
    vi.useFakeTimers();
    panel.renderParameters({ kind: 'AudioValue', id: 'n1', params: { channel: 'level' }, inputs: [] });
    const strip = notice(panel);
    expect(strip.textContent).toContain('every channel reads 0');

    // A track starts playing from the panel, from another window, or a stopped one runs on: the
    // strip has to be right in all three, so it polls rather than waiting to be re-rendered.
    source = { state: 'playing', label: 'Playing', fileName: 'set.wav', playing: true, hasFile: true };
    vi.advanceTimersByTime(500);
    expect(strip.textContent).toContain('Playing');
  });

  it('stops polling once the panel has moved on to another node', () => {
    vi.useFakeTimers();
    panel.renderParameters({ kind: 'AudioValue', id: 'n1', params: { channel: 'level' }, inputs: [] });
    panel.renderParameters({ kind: 'ConstFloat', id: 'n2', params: { value: 1 }, inputs: [] });

    expect(notice(panel)).toBeNull();
    // The detached strip's timer clears itself rather than repainting forever.
    const calls = audioPanel.describeAudioSource.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(audioPanel.describeAudioSource.mock.calls.length).toBe(calls);
  });

  it('adds nothing to a node that does not depend on anything outside the graph', () => {
    panel.renderParameters({ kind: 'ConstFloat', id: 'n2', params: { value: 1 }, inputs: [] });
    expect(notice(panel)).toBeNull();
  });
});
