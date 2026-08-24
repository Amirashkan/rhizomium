// The viewer runtime's decisions that are not made on the GPU.
//
// Compiling and rendering need a real device, so what is checked here is the
// part that runs before one is involved: refusing a patch that has nothing to
// show, and telling a visitor when a patch is waiting on something the viewer
// has no way to give it (audio, a controller, the editor's 3D scene). A patch
// that looks frozen because the music is missing is a support question; a line
// under the render is the answer.

import { describe, it, expect } from 'vitest';
import { PatchRuntime, PatchRuntimeError, describeUnsupported } from '../src/viewer/PatchRuntime.js';
import { viewerUrl } from '../src/ui/openInWebViewer.js';

describe('describeUnsupported', () => {
  it('says nothing about a patch the viewer can play in full', () => {
    expect(
      describeUnsupported([
        { kind: 'ConstFloat' },
        { kind: 'Circle' },
        { kind: 'OutputFinal' },
      ]),
    ).toEqual([]);
  });

  it('flags audio reactivity, which is not published with a patch', () => {
    const notes = describeUnsupported([{ kind: 'AudioAnalysis' }, { kind: 'OutputFinal' }]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/audio/i);
  });

  it('flags a 3D field visualiser, which only renders in the editor', () => {
    const notes = describeUnsupported([{ kind: 'ComputeFieldMapper' }]);
    expect(notes[0]).toMatch(/3D field visualiser/i);
  });

  it('flags controller-driven patches', () => {
    expect(describeUnsupported([{ kind: 'MIDIInput' }])[0]).toMatch(/hardware controller/i);
    expect(describeUnsupported([{ kind: 'OSCInput' }])[0]).toMatch(/hardware controller/i);
  });

  it('says each thing once, however many nodes ask for it', () => {
    const notes = describeUnsupported([
      { kind: 'AudioAnalysis' },
      { kind: 'AudioEnvelope' },
      { type: 'AudioAnalysis' },
    ]);
    expect(notes).toHaveLength(1);
  });

  it('survives a document full of junk', () => {
    expect(describeUnsupported([null, undefined, {}, { kind: 42 }])).toEqual([]);
    expect(describeUnsupported(undefined)).toEqual([]);
  });
});

describe('a patch with nothing wired to its output', () => {
  function runtimeWithGraph(nodes) {
    const runtime = Object.create(PatchRuntime.prototype);
    runtime.graph = { nodes, connections: [] };
    return runtime;
  }

  it('is refused before any compilation is attempted', async () => {
    // No output node at all.
    await expect(runtimeWithGraph([{ id: '1', kind: 'Circle' }]).compile()).rejects.toThrow(
      PatchRuntimeError,
    );

    // An output node with an empty first input — the case a half-finished
    // patch actually arrives in.
    await expect(
      runtimeWithGraph([{ id: '2', kind: 'OutputFinal', inputs: [null] }]).compile(),
    ).rejects.toMatchObject({ code: 'no_output' });
  });
});

describe('the editor’s handoff link', () => {
  it('points at the viewer on whatever origin is serving the editor', () => {
    expect(viewerUrl('abc-123', 'Slow Bloom', 'https://studio.tenderworld.org')).toBe(
      'https://studio.tenderworld.org/viewer?handoff=abc-123&title=Slow+Bloom',
    );
    expect(viewerUrl('abc', '', 'http://127.0.0.1:5000')).toBe(
      'http://127.0.0.1:5000/viewer?handoff=abc',
    );
  });
});
