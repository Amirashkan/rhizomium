// tests/mappingPersistence.test.js
//
// A mapping is part of the staging of a piece — a rig is aligned once and has to
// come back aligned. These cover the project file's side of that: what the save
// writes and what the load restores.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import { MappingModel, rectQuad, resetSurfaceIdCounter } from '../src/mapping/MappingModel.js';

const P = SaveLoadManager.prototype;

describe('projection mapping persistence', () => {
  beforeEach(() => {
    resetSurfaceIdCounter(1);
    vi.stubGlobal('window', {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('exports the live mapping', () => {
    const model = new MappingModel();
    model.setEnabled(true);
    const surface = model.addSurface({ dst: rectQuad(0.1, 0.1, 0.5, 0.5) });
    model.updateSurface(surface.id, { name: 'Column', softEdge: 0.08 });
    window.mappingModel = model;

    const exported = P.exportProjectionMapping.call({});
    expect(exported.enabled).toBe(true);
    expect(exported.surfaces).toHaveLength(1);
    expect(exported.surfaces[0]).toMatchObject({ name: 'Column', softEdge: 0.08 });
  });

  it('exports null when there is no mapping model to ask', () => {
    expect(P.exportProjectionMapping.call({})).toBeNull();
  });

  it('restores a saved mapping onto the live model', () => {
    const model = new MappingModel();
    window.mappingModel = model;

    P.importProjectionMapping.call({}, {
      enabled: true,
      surfaces: [{ id: 'surface-4', name: 'Arch', dst: rectQuad(0.2, 0, 0.4, 1) }],
    });

    expect(model.enabled).toBe(true);
    expect(model.surfaces).toHaveLength(1);
    expect(model.surfaces[0].name).toBe('Arch');
    expect(model.surfaces[0].dst[0]).toEqual({ x: 0.2, y: 0 });
  });

  it('reports a malformed mapping rather than failing the whole load', () => {
    const handleError = vi.fn();
    window.mappingModel = {
      deserialize: () => { throw new Error('bad mapping'); },
    };
    window.errorHandler = { handleError };

    expect(() => P.importProjectionMapping.call({}, { enabled: true })).not.toThrow();
    expect(handleError).toHaveBeenCalledWith(
      expect.any(Error),
      { component: 'mapping-import' },
    );
  });

  it('is a no-op when the mapping tool never came up', () => {
    expect(() => P.importProjectionMapping.call({}, { enabled: true })).not.toThrow();
  });

  it('round-trips a mapping through a serialized project', () => {
    const saved = new MappingModel();
    saved.setEnabled(true);
    const a = saved.addSurface({ dst: rectQuad(0, 0, 0.5, 1) });
    saved.updateSurface(a.id, { name: 'Left', opacity: 0.9, softEdge: 0.05 });
    const b = saved.addSurface({ dst: rectQuad(0.5, 0, 0.5, 1) });
    saved.moveCorner(b.id, 1, 1.15, -0.05); // pinned past the frame, as a real rig is
    saved.updateSurface(b.id, { name: 'Right', locked: true });

    window.mappingModel = saved;
    const projectData = { projectionMapping: P.exportProjectionMapping.call({}) };
    const onDisk = JSON.parse(JSON.stringify(projectData));

    const loaded = new MappingModel();
    window.mappingModel = loaded;
    P.importProjectionMapping.call({}, onDisk.projectionMapping);

    expect(loaded.serialize()).toEqual(saved.serialize());
    expect(loaded.surfaces[1].dst[1]).toEqual({ x: 1.15, y: -0.05 });
    expect(loaded.surfaces[1].locked).toBe(true);
  });
});
