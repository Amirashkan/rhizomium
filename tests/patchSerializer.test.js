import { describe, it, expect } from 'vitest';
import {
  serializePatch,
  serializePatchData,
  deserializePatch,
  scrubPrivateData,
  stableStringify,
  slugify,
  patchFilename,
  checkPatchSize,
  PATCH_SCHEMA_VERSION,
  PATCH_MAX_BYTES,
} from '../src/core/patchSerializer.js';
import { SAVE_FORMAT_VERSION, migrateProjectData } from '../src/core/projectMigrations.js';

// A project exercising the shapes exportProject() produces: every node kind
// family (value, texture-with-inlined-asset, compute, expression), connections,
// nested params, the optional timeline/MIDI/viewport sections and metadata.
function sampleProject() {
  return {
    app: 'Rhizomium-Web',
    version: SAVE_FORMAT_VERSION,
    format: 'rhizomium-project',
    savedAt: '2026-07-30T12:00:00.000Z',
    outputFormat: { width: 1920, height: 1080, simQuality: 'high' },
    nodes: [
      { id: 'node_1', kind: 'Float', position: { x: 10, y: 20 }, size: { width: 180, height: 60 }, value: 0.5, inputs: [] },
      {
        id: 'node_2',
        kind: 'Texture2D',
        position: { x: 200, y: 20 },
        size: { width: 180, height: 60 },
        filename: 'noise.png',
        inputs: [{ index: 0, connected: false }],
      },
      {
        id: 'node_3',
        kind: 'ComputeGradient',
        position: { x: 400, y: 20 },
        size: { width: 180, height: 60 },
        params: { type: 'Angular', colorMode: 'Grayscale', angle: 45, colorStops: [{ pos: 0, color: [0, 0, 0, 1] }] },
        inputs: [{ index: 0, connected: true, from: { nodeId: 'node_1', pin: 0 } }],
      },
      { id: 'node_4', kind: 'Expression', position: { x: 600, y: 20 }, size: { width: 180, height: 60 }, expr: 'sin(t * 2.0)', inputs: [] },
    ],
    connections: [{ from: { nodeId: 'node_1', pin: 0 }, to: { nodeId: 'node_3', pin: 0 } }],
    textures: {
      node_2: {
        filename: 'noise.png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 256,
        height: 256,
      },
    },
    timeline: { duration: 10, tracks: [] },
    midiBindings: null,
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    viewport3D: null,
    metadata: {
      created: '2026-07-30T12:00:00.000Z',
      nodeCount: 4,
      connectionCount: 1,
      editorVersion: '3.0',
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    },
  };
}

async function blobText(blob) {
  return typeof blob.text === 'function'
    ? await blob.text()
    : await new Response(blob).text();
}

describe('serializePatchData', () => {
  it('carries the graph through unchanged', () => {
    const project = sampleProject();
    const patch = serializePatchData(project);

    expect(patch.nodes).toEqual(project.nodes);
    expect(patch.connections).toEqual(project.connections);
    expect(patch.textures).toEqual(project.textures);
    expect(patch.timeline).toEqual(project.timeline);
    expect(patch.outputFormat).toEqual(project.outputFormat);
  });

  it('stamps the schema version and generator', () => {
    const patch = serializePatchData(sampleProject(), { generatorVersion: '1.4.2' });

    expect(patch.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(patch.version).toBe(PATCH_SCHEMA_VERSION);
    expect(patch.generator).toEqual({ app: 'rhizomium', version: '1.4.2' });
  });

  it('records a trimmed title, and omits it when blank', () => {
    expect(serializePatchData(sampleProject(), { title: '  Slow Bloom  ' }).title).toBe('Slow Bloom');
    expect(serializePatchData(sampleProject(), { title: '   ' })).not.toHaveProperty('title');
    expect(serializePatchData(sampleProject())).not.toHaveProperty('title');
  });

  it('does not mutate the project it was given', () => {
    const project = sampleProject();
    const before = JSON.stringify(project);
    serializePatchData(project, { title: 'Slow Bloom' });

    expect(JSON.stringify(project)).toBe(before);
  });

  it('rejects non-object input', () => {
    expect(() => serializePatchData(null)).toThrow(/must be an object/);
    expect(() => serializePatchData([])).toThrow(/must be an object/);
    expect(() => serializePatchData('{}')).toThrow(/must be an object/);
  });

  it('reports a cycle instead of blowing the stack', () => {
    const project = sampleProject();
    project.nodes[0].self = project.nodes[0];

    expect(() => serializePatchData(project)).toThrow(/cycle/);
  });
});

describe('determinism', () => {
  it('serializes the same document to identical bytes', async () => {
    const first = await blobText(serializePatch(sampleProject(), { title: 'Slow Bloom' }));
    const second = await blobText(serializePatch(sampleProject(), { title: 'Slow Bloom' }));

    expect(first).toBe(second);
  });

  it('is insensitive to key insertion order', () => {
    const a = { app: 'Rhizomium-Web', nodes: [], connections: [], metadata: { editorVersion: '3.0' } };
    const b = { metadata: { editorVersion: '3.0' }, connections: [], nodes: [], app: 'Rhizomium-Web' };

    expect(stableStringify(serializePatchData(a))).toBe(stableStringify(serializePatchData(b)));
  });

  it('drops the wall-clock fields that would differ on every export', () => {
    const patch = serializePatchData(sampleProject());

    expect(patch).not.toHaveProperty('savedAt');
    expect(patch.metadata).not.toHaveProperty('created');
    // The rest of the metadata still travels.
    expect(patch.metadata.nodeCount).toBe(4);
  });

  it('sorts keys at every depth', () => {
    const json = stableStringify({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } });

    expect(json).toBe(JSON.stringify({ a: { c: [{ e: 4, f: 3 }], d: 2 }, b: 1 }, null, 2));
  });

  it('keeps array order, which is meaningful for nodes and connections', () => {
    const patch = serializePatchData(sampleProject());

    expect(patch.nodes.map((n) => n.id)).toEqual(['node_1', 'node_2', 'node_3', 'node_4']);
  });
});

describe('scrubbing private data', () => {
  it('removes a credential field from a node', () => {
    const project = sampleProject();
    project.nodes[0].apiKey = 'sk-live-should-never-be-published';

    const patch = serializePatchData(project);

    expect(patch.nodes[0]).not.toHaveProperty('apiKey');
    expect(patch.nodes[0].value).toBe(0.5);
    expect(stableStringify(patch)).not.toContain('sk-live-should-never-be-published');
  });

  it('matches credential keys regardless of separators or case', () => {
    const scrubbed = scrubPrivateData({
      api_key: 'a', 'API-KEY': 'b', apiKey: 'c',
      accessToken: 'd', 'client_secret': 'e', Password: 'f',
      keep: 'kept',
    });

    expect(scrubbed).toEqual({ keep: 'kept' });
  });

  it('strips identity and machine fingerprinting from metadata', () => {
    const patch = serializePatchData(sampleProject());

    expect(patch.metadata).not.toHaveProperty('platform');
    expect(patch.metadata).not.toHaveProperty('userAgent');
  });

  it('scrubs nested and array-held credentials', () => {
    const scrubbed = scrubPrivateData({
      graph: { nodes: [{ id: 'n1', token: 'secret-token', value: 1 }] },
    });

    expect(scrubbed.graph.nodes[0]).toEqual({ id: 'n1', value: 1 });
  });

  it('reduces absolute local paths to a bare filename', () => {
    const scrubbed = scrubPrivateData({
      posix: '/Users/amira/Documents/patches/noise.png',
      windows: 'C:\\Users\\amira\\Desktop\\noise.png',
      unc: '\\\\studio-nas\\share\\noise.png',
      fileUrl: 'file:///home/amira/noise.png',
    });

    expect(scrubbed.posix).toBe('noise.png');
    expect(scrubbed.windows).toBe('noise.png');
    expect(scrubbed.unc).toBe('noise.png');
    expect(scrubbed.fileUrl).toBe('noise.png');
  });

  it('leaves inlined texture data and ordinary strings alone', () => {
    const patch = serializePatchData(sampleProject());

    expect(patch.textures.node_2.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(patch.textures.node_2.filename).toBe('noise.png');
    expect(patch.nodes[3].expr).toBe('sin(t * 2.0)');
  });

  it('does not mistake a relative path or an https URL for a local one', () => {
    const scrubbed = scrubPrivateData({
      relative: 'assets/noise.png',
      remote: 'https://art.tenderworld.org/img/noise.png',
      expr: 'a / b / c',
    });

    expect(scrubbed.relative).toBe('assets/noise.png');
    expect(scrubbed.remote).toBe('https://art.tenderworld.org/img/noise.png');
    expect(scrubbed.expr).toBe('a / b / c');
  });

  it('drops undefined values and functions rather than emitting null', () => {
    const scrubbed = scrubPrivateData({ a: 1, b: undefined, c: () => {}, d: null });

    expect(scrubbed).toEqual({ a: 1, d: null });
  });
});

describe('round trip', () => {
  it('deserialize(serialize(doc)) deep-equals the patch payload', async () => {
    const project = sampleProject();
    const patch = serializePatchData(project, { title: 'Slow Bloom' });
    const restored = deserializePatch(await blobText(serializePatch(project, { title: 'Slow Bloom' })));

    expect(restored).toEqual(patch);
  });

  it('is idempotent - re-serializing a patch yields identical bytes', async () => {
    const first = await blobText(serializePatch(sampleProject(), { title: 'Slow Bloom' }));
    const second = await blobText(serializePatch(deserializePatch(first), { title: 'Slow Bloom' }));

    expect(second).toBe(first);
  });

  it('produces a patch the normal project loader accepts', async () => {
    const patch = deserializePatch(await blobText(serializePatch(sampleProject())));
    const migrated = migrateProjectData(patch);

    expect(migrated.version).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.nodes).toHaveLength(4);
    expect(migrated.connections).toHaveLength(1);
  });

  it('serializes as application/json - the type the gallery maps .rz to', () => {
    expect(serializePatch(sampleProject()).type).toBe('application/json');
  });
});

describe('deserializePatch', () => {
  it('refuses a patch from a newer Rhizomium with an actionable message', () => {
    const patch = serializePatchData(sampleProject());
    patch.schemaVersion = PATCH_SCHEMA_VERSION + 1;

    expect(() => deserializePatch(JSON.stringify(patch))).toThrow(/newer version of Rhizomium/);
    expect(() => deserializePatch(JSON.stringify(patch))).toThrow(/update Rhizomium/i);
  });

  it('accepts a patch from an older Rhizomium', () => {
    const patch = { ...serializePatchData(sampleProject()), schemaVersion: 1, version: 1 };

    expect(() => deserializePatch(JSON.stringify(patch))).not.toThrow();
  });

  it('reports malformed JSON as an invalid patch, not a parse error', () => {
    expect(() => deserializePatch('{ not json')).toThrow(/not a valid Rhizomium patch/i);
    expect(() => deserializePatch('[]')).toThrow(/expected a JSON object/);
  });
});

describe('migrateProjectData with a patch schemaVersion', () => {
  it('refuses a newer schemaVersion even when `version` looks current', () => {
    const patch = {
      version: SAVE_FORMAT_VERSION,
      schemaVersion: SAVE_FORMAT_VERSION + 1,
      nodes: [],
      connections: [],
    };

    expect(() => migrateProjectData(patch)).toThrow(/newer version/);
  });

  it('brings schemaVersion up to date alongside version', () => {
    const migrated = migrateProjectData({ version: 1, schemaVersion: 1, nodes: [], connections: [] });

    expect(migrated.version).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.schemaVersion).toBe(SAVE_FORMAT_VERSION);
  });

  it('leaves a plain project file without a schemaVersion untouched', () => {
    const migrated = migrateProjectData({ version: SAVE_FORMAT_VERSION, nodes: [], connections: [] });

    expect(migrated).not.toHaveProperty('schemaVersion');
  });
});

describe('patch filenames', () => {
  it('slugifies a title into something a downloader wants to see', () => {
    expect(patchFilename('Slow Bloom')).toBe('slow-bloom.rz');
    // NFKD folds the accent off É and expands № to "No", so the slug stays
    // readable instead of losing those characters entirely.
    expect(patchFilename('Étude № 4 — "Drift"')).toBe('etude-no-4-drift.rz');
    expect(patchFilename('  Trailing/Slashes//  ')).toBe('trailing-slashes.rz');
  });

  it('falls back rather than emitting a bare extension', () => {
    expect(patchFilename('')).toBe('patch.rz');
    expect(patchFilename('!!!')).toBe('patch.rz');
    expect(patchFilename(null, 'rhizomium-patch')).toBe('rhizomium-patch.rz');
  });

  it('caps the length without leaving a trailing separator', () => {
    const slug = slugify('a'.repeat(200));

    expect(slug).toHaveLength(64);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugify(`${'a'.repeat(63)} bcd`)).not.toMatch(/-$/);
  });
});

describe('checkPatchSize', () => {
  it('passes a patch inside the limit', () => {
    expect(checkPatchSize({ size: PATCH_MAX_BYTES })).toBeNull();
    expect(checkPatchSize(serializePatch(sampleProject()))).toBeNull();
  });

  it('explains an oversize patch and names what to trim', () => {
    const message = checkPatchSize({ size: PATCH_MAX_BYTES + 1 });

    expect(message).toMatch(/5 MB/);
    expect(message).toMatch(/texture/i);
  });

  it('treats a missing blob as empty rather than throwing', () => {
    expect(checkPatchSize(null)).toBeNull();
  });
});
