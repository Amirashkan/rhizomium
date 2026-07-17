/**
 * 3D Field Visualizer (ComputeFieldMapper) pipeline
 *
 * The 3D visualization node reads a compute shader's output texture back to
 * the CPU, converts it to point-cloud or heightmap geometry, and renders it in
 * the 3D viewport. These tests pin down the CPU side of that pipeline:
 *
 * - Texture readback decoding: compute textures are rgba8unorm (NOT
 *   rgba32float), rows are padded to 256-byte alignment, and the texture's
 *   real size rarely matches the node's sampling grid. The old readback
 *   assumed tightly-packed rgba32float and produced garbage.
 * - Point cloud generation from decoded field data.
 * - Heightmap surface mesh generation for 'surface'/'volume' modes on 2D
 *   fields (previously silently fell back to points).
 * - Graph source resolution: node.inputs holds source ids, while the
 *   connections array holds node OBJECTS - the old code compared objects to
 *   ids and never matched.
 */

import { describe, it, expect } from 'vitest';
import { PointCloudGenerator } from '../src/scene/generators/PointCloudGenerator.js';
import { FieldVisualizer } from '../src/scene/FieldVisualizer.js';
import { FieldMapperIntegration } from '../src/core/FieldMapperIntegration.js';

describe('PointCloudGenerator.getFormatInfo', () => {
    it('describes the compute pipeline output format (rgba8unorm)', () => {
        expect(PointCloudGenerator.getFormatInfo('rgba8unorm')).toEqual({
            bytesPerTexel: 4, kind: 'uint8', redOffset: 0
        });
    });

    it('reads red from offset 2 for bgra formats', () => {
        expect(PointCloudGenerator.getFormatInfo('bgra8unorm').redOffset).toBe(2);
    });

    it('supports float formats', () => {
        expect(PointCloudGenerator.getFormatInfo('rgba32float')).toEqual({
            bytesPerTexel: 16, kind: 'float32', redOffset: 0
        });
        expect(PointCloudGenerator.getFormatInfo('r32float').bytesPerTexel).toBe(4);
    });

    it('returns null for unsupported formats', () => {
        expect(PointCloudGenerator.getFormatInfo('depth24plus')).toBeNull();
    });
});

describe('PointCloudGenerator.extractFieldFromBytes', () => {
    const info8 = PointCloudGenerator.getFormatInfo('rgba8unorm');

    it('decodes rgba8unorm with 256-byte row padding', () => {
        // 3x2 texture: rows are 12 bytes of texels padded out to 256
        const bytesPerRow = 256;
        const bytes = new Uint8Array(bytesPerRow * 2);
        const reds = [[0, 51, 102], [153, 204, 255]];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 3; x++) {
                bytes[y * bytesPerRow + x * 4] = reds[y][x];
            }
        }

        const field = PointCloudGenerator.extractFieldFromBytes(bytes, 3, 2, bytesPerRow, info8, 3, 2);

        expect(field).toHaveLength(6);
        expect(field[0]).toBeCloseTo(0);
        expect(field[1]).toBeCloseTo(0.2);
        expect(field[2]).toBeCloseTo(0.4);
        expect(field[3]).toBeCloseTo(0.6);
        expect(field[4]).toBeCloseTo(0.8);
        expect(field[5]).toBeCloseTo(1.0);
    });

    it('nearest-samples a larger texture down onto the requested grid', () => {
        // 4x1 texture sampled onto a 2x1 grid: picks texels 1 and 3
        const bytesPerRow = 256;
        const bytes = new Uint8Array(bytesPerRow);
        const reds = [10, 20, 30, 40];
        reds.forEach((r, x) => { bytes[x * 4] = r; });

        const field = PointCloudGenerator.extractFieldFromBytes(bytes, 4, 1, bytesPerRow, info8, 2, 1);

        expect(field[0]).toBeCloseTo(20 / 255);
        expect(field[1]).toBeCloseTo(40 / 255);
    });

    it('reads the red channel from offset 2 for bgra8unorm', () => {
        const info = PointCloudGenerator.getFormatInfo('bgra8unorm');
        const bytes = new Uint8Array(256);
        bytes[0] = 11;  // blue
        bytes[1] = 22;  // green
        bytes[2] = 255; // red

        const field = PointCloudGenerator.extractFieldFromBytes(bytes, 1, 1, 256, info, 1, 1);
        expect(field[0]).toBeCloseTo(1.0);
    });

    it('decodes rgba32float texels', () => {
        const info = PointCloudGenerator.getFormatInfo('rgba32float');
        const buffer = new ArrayBuffer(256);
        const view = new DataView(buffer);
        view.setFloat32(0, 0.75, true);       // texel 0 red
        view.setFloat32(16, 0.25, true);      // texel 1 red

        const field = PointCloudGenerator.extractFieldFromBytes(buffer, 2, 1, 256, info, 2, 1);
        expect(field[0]).toBeCloseTo(0.75);
        expect(field[1]).toBeCloseTo(0.25);
    });
});

describe('PointCloudGenerator.generate', () => {
    it('emits points only where the field exceeds the threshold', () => {
        const field = new Float32Array([0.1, 0.9, 0.2, 0.8]);
        const geometry = PointCloudGenerator.generate(field, [2, 2, 1], { threshold: 0.5 });

        expect(geometry.vertexCount).toBe(2);
        expect(geometry.positions).toHaveLength(6);
        expect(geometry.colors).toHaveLength(8);
    });

    it('maps grid coordinates into the world bounds', () => {
        const field = new Float32Array([1.0]);
        const bounds = { min: [-2, -3, -4], max: [2, 3, 4] };
        const geometry = PointCloudGenerator.generate(field, [1, 1, 1], { threshold: 0.5, bounds });

        // Single cell at grid origin maps to bounds.min (2D field stays at z=min)
        expect(Array.from(geometry.positions)).toEqual([-2, -3, -4]);
    });

    it('applies displacement along the configured axis', () => {
        const field = new Float32Array([1.0]);
        const geometry = PointCloudGenerator.generate(field, [1, 1, 1], {
            threshold: 0.5,
            bounds: { min: [0, 0, 0], max: [1, 1, 1] },
            displacementScale: 2.0,
            displacementAxis: [0, 1, 0]
        });

        expect(geometry.positions[1]).toBeCloseTo(2.0);
    });
});

describe('FieldVisualizer.buildHeightmapMesh', () => {
    const bounds = { min: [-1, 0, -1], max: [1, 2, 1] };

    it('builds a full grid of vertices with two triangles per cell', () => {
        const field = new Float32Array(9).fill(0.5);
        const mesh = FieldVisualizer.buildHeightmapMesh(field, 3, 3, bounds);

        expect(mesh.vertexCount).toBe(9);
        expect(mesh.indexCount).toBe(2 * 2 * 6);
        expect(mesh.positions).toHaveLength(27);
        expect(mesh.normals).toHaveLength(27);
        expect(mesh.colors).toHaveLength(36);
        expect(mesh.uvs).toHaveLength(18);
        expect(mesh.indices).toBeInstanceOf(Uint32Array);
    });

    it('keeps all indices within the vertex range', () => {
        const field = new Float32Array(16).fill(0.25);
        const mesh = FieldVisualizer.buildHeightmapMesh(field, 4, 4, bounds);

        for (const index of mesh.indices) {
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(mesh.vertexCount);
        }
    });

    it('maps field values to heights within the Y bounds', () => {
        const field = new Float32Array([0, 1, 0.5, 0]);
        const mesh = FieldVisualizer.buildHeightmapMesh(field, 2, 2, bounds);

        expect(mesh.positions[0 * 3 + 1]).toBeCloseTo(0);   // value 0 -> min Y
        expect(mesh.positions[1 * 3 + 1]).toBeCloseTo(2);   // value 1 -> max Y
        expect(mesh.positions[2 * 3 + 1]).toBeCloseTo(1);   // value 0.5 -> midpoint
    });

    it('produces unit-length normals', () => {
        const field = new Float32Array([0, 1, 0.3, 0.7, 0.2, 0.9, 0.1, 0.5, 0.6]);
        const mesh = FieldVisualizer.buildHeightmapMesh(field, 3, 3, bounds);

        for (let i = 0; i < mesh.vertexCount; i++) {
            const nx = mesh.normals[i * 3];
            const ny = mesh.normals[i * 3 + 1];
            const nz = mesh.normals[i * 3 + 2];
            expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
            expect(ny).toBeGreaterThan(0); // heightmap normals always face up
        }
    });

    it('applies the color function per vertex', () => {
        const field = new Float32Array([0, 1]);
        const mesh = FieldVisualizer.buildHeightmapMesh(
            field, 2, 1, bounds,
            (value) => [value, 0, 1 - value, 1]
        );

        expect(mesh.colors[0]).toBeCloseTo(0);
        expect(mesh.colors[2]).toBeCloseTo(1);
        expect(mesh.colors[4]).toBeCloseTo(1);
        expect(mesh.colors[6]).toBeCloseTo(0);
    });
});

describe('FieldMapperIntegration source resolution', () => {
    const integration = new FieldMapperIntegration(null, null, null, null, null);

    it('resolves the source id from node.inputs', () => {
        const node = { id: 'mapper-1', inputs: ['noise-1'] };
        expect(integration.findSourceNodeId(node, [])).toBe('noise-1');
    });

    it('resolves the source id from connections holding node objects', () => {
        const source = { id: 'noise-2' };
        const mapper = { id: 'mapper-2', inputs: [] };
        const connections = [{ fromNode: source, toNode: mapper, fromPin: 0, toPin: 0 }];
        expect(integration.findSourceNodeId(mapper, connections)).toBe('noise-2');
    });

    it('returns null when nothing is connected', () => {
        const node = { id: 'mapper-3', inputs: [null] };
        expect(integration.findSourceNodeId(node, [])).toBeNull();
    });
});

describe('FieldMapperIntegration.getComputeTexture', () => {
    it('prefers the executor nodeOutputs entry and skips the fallback texture', () => {
        const fallback = { label: 'fallback' };
        const real = { label: 'real' };
        const executor = {
            fallbackTexture: fallback,
            computeManagers: new Map(),
            getNodeOutput: (id) => (id === 'noise-1' ? real : fallback)
        };
        const integration = new FieldMapperIntegration(null, null, executor, null, null);

        expect(integration.getComputeTexture('noise-1')).toBe(real);
        expect(integration.getComputeTexture('unknown')).toBeNull();
    });

    it('falls back to the manager output under the sanitized registry key', () => {
        const tex = { label: 'manager-output' };
        const executor = {
            fallbackTexture: null,
            getNodeOutput: () => null,
            computeManagers: new Map([['node_7', { getOutputTexture: () => tex }]])
        };
        const integration = new FieldMapperIntegration(null, null, executor, null, null);

        expect(integration.getComputeTexture('node-7')).toBe(tex);
    });
});
