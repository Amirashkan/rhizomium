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

  it('rejects non-object data', () => {
    expect(() => migrateProjectData(null)).toThrow(/Invalid project data/);
    expect(() => migrateProjectData('{}')).toThrow(/Invalid project data/);
  });
});
