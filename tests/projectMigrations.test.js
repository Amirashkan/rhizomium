import { describe, it, expect } from 'vitest';
import {
  migrateProjectData,
  SAVE_FORMAT_VERSION,
} from '../src/core/projectMigrations.js';

const baseProject = () => ({
  app: 'Rhizomium-Web',
  format: 'rhizomium-project',
  nodes: [{ id: 'a', kind: 'Float' }],
  connections: [],
});

describe('migrateProjectData', () => {
  it('treats a missing version as v1 and migrates to the current format', () => {
    const result = migrateProjectData(baseProject());

    expect(result.version).toBe(SAVE_FORMAT_VERSION);
    expect(result.timeline).toBeNull();
    expect(result.midiBindings).toBeNull();
    expect(result.textures).toEqual({});
    expect(result.nodes).toEqual([{ id: 'a', kind: 'Float' }]);
  });

  it('migrates v2 projects and preserves existing sections', () => {
    const project = {
      ...baseProject(),
      version: 2,
      timeline: { tracks: [1] },
      midiBindings: { cc1: 'node_3' },
      textures: { node_5: { filename: 'x.png' } },
    };

    const result = migrateProjectData(project);

    expect(result.version).toBe(SAVE_FORMAT_VERSION);
    expect(result.timeline).toEqual({ tracks: [1] });
    expect(result.midiBindings).toEqual({ cc1: 'node_3' });
    expect(result.textures).toEqual({ node_5: { filename: 'x.png' } });
  });

  it('passes current-version projects through unchanged apart from normalization', () => {
    const project = { ...baseProject(), version: SAVE_FORMAT_VERSION };
    const result = migrateProjectData(project);

    expect(result.version).toBe(SAVE_FORMAT_VERSION);
    expect(result.nodes).toEqual(project.nodes);
  });

  it('does not mutate the input object', () => {
    const project = baseProject();
    migrateProjectData(project);
    expect(project.version).toBeUndefined();
  });

  it('rejects projects saved by a newer editor version', () => {
    const project = { ...baseProject(), version: SAVE_FORMAT_VERSION + 1 };
    expect(() => migrateProjectData(project)).toThrow(/newer version/);
  });

  it('remaps connections from collapsed channel pins to the Color pin (v3 -> v4)', () => {
    const project = {
      ...baseProject(),
      version: 3,
      nodes: [
        { id: 'tex', kind: 'Texture2D' },
        { id: 'noise', kind: 'ComputeNoise' },
        { id: 'split', kind: 'Split4' },
        { id: 'out', kind: 'OutputFinal' },
      ],
      connections: [
        // Channel pin (pin > 0) on collapsed kinds -> clamped to pin 0.
        { from: { nodeId: 'tex', pin: 2 }, to: { nodeId: 'out', pin: 0 } },
        { from: { nodeId: 'noise', pin: 5 }, to: { nodeId: 'split', pin: 0 } },
        // Already on the Color pin -> untouched.
        { from: { nodeId: 'tex', pin: 0 }, to: { nodeId: 'split', pin: 0 } },
        // Non-collapsed kind (Split4 genuinely has multiple outputs) -> untouched.
        { from: { nodeId: 'split', pin: 3 }, to: { nodeId: 'out', pin: 0 } },
      ],
    };

    const result = migrateProjectData(project);

    expect(result.version).toBe(SAVE_FORMAT_VERSION);
    expect(result.connections.map((c) => c.from.pin)).toEqual([0, 0, 0, 3]);
    // Targets are preserved.
    expect(result.connections[3].to).toEqual({ nodeId: 'out', pin: 0 });
  });

  it('rejects non-object data', () => {
    expect(() => migrateProjectData(null)).toThrow(/Invalid project data/);
    expect(() => migrateProjectData('{}')).toThrow(/Invalid project data/);
  });
});
