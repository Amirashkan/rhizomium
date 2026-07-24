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

  it('strips obsolete ComputeFieldMapper parameters (v4 -> v5)', () => {
    const project = {
      ...baseProject(),
      version: 4,
      nodes: [
        {
          id: 'fm',
          kind: 'ComputeFieldMapper',
          params: {
            // Obsolete params removed in v5.
            width: 64,
            height: 64,
            depth: 64,
            boundsMinX: -1,
            boundsMaxZ: 1,
            colorMode: 'gradient',
            colorAR: 0.2,
            solidColorR: 1,
            colorScaleMax: 1,
            displacementAxisY: 1,
            pointSize: 0.02,
            // Params the node still honors -> kept.
            mappingMode: 'points',
            displacementScale: 0.4,
            resolution: 96,
            mode: 'surface',
          },
        },
        // A different compute node must not be touched even if it shares
        // generically-named params.
        { id: 'noise', kind: 'ComputeNoise', params: { width: 128, threshold: 0.5 } },
      ],
    };

    const result = migrateProjectData(project);

    expect(result.version).toBe(SAVE_FORMAT_VERSION);

    const fm = result.nodes.find((n) => n.id === 'fm');
    // Obsolete keys gone.
    for (const key of [
      'width', 'height', 'depth', 'boundsMinX', 'boundsMaxZ', 'colorMode',
      'colorAR', 'solidColorR', 'colorScaleMax', 'displacementAxisY', 'pointSize',
    ]) {
      expect(fm.params).not.toHaveProperty(key);
    }
    // Honored/current params preserved with their values.
    expect(fm.params.mappingMode).toBe('points');
    expect(fm.params.displacementScale).toBe(0.4);
    expect(fm.params.resolution).toBe(96);
    expect(fm.params.mode).toBe('surface');

    // Non-FieldMapper node left untouched.
    const noise = result.nodes.find((n) => n.id === 'noise');
    expect(noise.params).toEqual({ width: 128, threshold: 0.5 });
  });

  it('does not mutate a ComputeFieldMapper node with no obsolete params', () => {
    const clean = {
      id: 'fm',
      kind: 'ComputeFieldMapper',
      params: { mode: 'surface', shape: 'sphere', displacementScale: 0.4 },
    };
    const project = { ...baseProject(), version: 4, nodes: [clean] };

    const result = migrateProjectData(project);

    expect(result.nodes[0].params).toEqual(clean.params);
  });

  it('converts removed ColorRamp/ConicGradient nodes into ComputeGradient (v5 -> v6)', () => {
    const project = {
      ...baseProject(),
      version: 5,
      nodes: [
        { id: 'noise', kind: 'ComputeNoise', params: {} },
        {
          id: 'ramp',
          kind: 'ColorRamp',
          x: 100,
          y: 200,
          inputs: ['noise'],
          params: {
            mode: 'Smooth',
            stops: [
              { position: 0, color: [0, 0, 0, 1] },
              { position: 1, color: [1, 0.5, 0, 1] },
            ],
          },
        },
        {
          id: 'conic',
          kind: 'ConicGradient',
          inputs: ['uv'],
          params: { centerX: 0.4, centerY: 0.6, startAngle: Math.PI, endAngle: 5.2, smoothness: 0.1 },
        },
        { id: 'noise2', kind: 'ComputeNoise', params: { scale: 3 } },
      ],
      connections: [{ from: { nodeId: 'ramp', pin: 0 }, to: { nodeId: 'out', pin: 0 } }],
    };

    const result = migrateProjectData(project);
    expect(result.version).toBe(SAVE_FORMAT_VERSION);

    // ColorRamp -> input-driven Gradient, stops + interpolation carried over.
    const ramp = result.nodes.find((n) => n.id === 'ramp');
    expect(ramp.kind).toBe('ComputeGradient');
    expect(ramp.colorMode ?? ramp.params.colorMode).toBe('Gradient');
    expect(ramp.params.inputMix).toBe(1.0);
    expect(ramp.params.interpolation).toBe('Smooth');
    expect(ramp.params.colorStops).toEqual([
      { position: 0, color: [0, 0, 0, 1] },
      { position: 1, color: [1, 0.5, 0, 1] },
    ]);
    // Identity + wiring preserved.
    expect(ramp.x).toBe(100);
    expect(ramp.inputs).toEqual(['noise']);
    expect(result.connections[0].from.nodeId).toBe('ramp');

    // ConicGradient -> Angular grayscale Gradient that ignores its input.
    const conic = result.nodes.find((n) => n.id === 'conic');
    expect(conic.kind).toBe('ComputeGradient');
    expect(conic.params.type).toBe('Angular');
    expect(conic.params.colorMode).toBe('Grayscale');
    expect(conic.params.inputMix).toBe(0.0);
    expect(conic.params.centerX).toBe(0.4);
    expect(conic.params.angle).toBeCloseTo(180, 5); // startAngle PI rad -> 180 deg

    // Real ComputeGradient/other nodes untouched.
    expect(result.nodes.find((n) => n.id === 'noise2').params).toEqual({ scale: 3 });
  });

  it('leaves projects without ColorRamp/ConicGradient nodes unchanged (v5 -> v6)', () => {
    const project = {
      ...baseProject(),
      version: 5,
      nodes: [{ id: 'g', kind: 'ComputeGradient', params: { type: 'Radial' } }],
    };
    const result = migrateProjectData(project);
    expect(result.nodes[0]).toEqual({ id: 'g', kind: 'ComputeGradient', params: { type: 'Radial' } });
  });

  it('rejects non-object data', () => {
    expect(() => migrateProjectData(null)).toThrow(/Invalid project data/);
    expect(() => migrateProjectData('{}')).toThrow(/Invalid project data/);
  });
});
