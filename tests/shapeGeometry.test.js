/**
 * ShapeGeometry - parametric primitives for the 3D Field Visualizer's GPU
 * shape path. Geometry must be well-formed (indices in range, unit normals,
 * UVs in [0,1]) and cached per (shape, segments).
 */

import { describe, it, expect } from 'vitest';
import { ShapeGeometry } from '../src/scene/generators/ShapeGeometry.js';

const checkWellFormed = (geometry) => {
    expect(geometry.vertexCount).toBeGreaterThan(0);
    expect(geometry.positions).toHaveLength(geometry.vertexCount * 3);
    expect(geometry.normals).toHaveLength(geometry.vertexCount * 3);
    expect(geometry.uvs).toHaveLength(geometry.vertexCount * 2);
    expect(geometry.indices).toBeInstanceOf(Uint32Array);
    expect(geometry.indexCount).toBe(geometry.indices.length);
    expect(geometry.indexCount % 3).toBe(0);

    for (const index of geometry.indices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(geometry.vertexCount);
    }

    for (let i = 0; i < geometry.vertexCount; i++) {
        const nx = geometry.normals[i * 3];
        const ny = geometry.normals[i * 3 + 1];
        const nz = geometry.normals[i * 3 + 2];
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 3);

        expect(geometry.uvs[i * 2]).toBeGreaterThanOrEqual(0);
        expect(geometry.uvs[i * 2]).toBeLessThanOrEqual(1);
        expect(geometry.uvs[i * 2 + 1]).toBeGreaterThanOrEqual(0);
        expect(geometry.uvs[i * 2 + 1]).toBeLessThanOrEqual(1);
    }
};

describe('ShapeGeometry', () => {
    it.each(['plane', 'sphere', 'box', 'torus'])('builds well-formed %s geometry', (shape) => {
        checkWellFormed(ShapeGeometry.get(shape, 16));
    });

    it('keeps every shape within the unit box', () => {
        for (const shape of ShapeGeometry.SHAPES) {
            const geometry = ShapeGeometry.get(shape, 12);
            for (let i = 0; i < geometry.positions.length; i++) {
                expect(Math.abs(geometry.positions[i])).toBeLessThanOrEqual(1.0001);
            }
        }
    });

    it('sphere vertices sit on the unit sphere with outward normals', () => {
        const geometry = ShapeGeometry.get('sphere', 8);
        for (let i = 0; i < geometry.vertexCount; i++) {
            const x = geometry.positions[i * 3];
            const y = geometry.positions[i * 3 + 1];
            const z = geometry.positions[i * 3 + 2];
            expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
            // Normal equals position on a unit sphere
            expect(geometry.normals[i * 3]).toBeCloseTo(x, 4);
            expect(geometry.normals[i * 3 + 1]).toBeCloseTo(y, 4);
            expect(geometry.normals[i * 3 + 2]).toBeCloseTo(z, 4);
        }
    });

    it('plane is flat on Y with +Y normals', () => {
        const geometry = ShapeGeometry.get('plane', 4);
        for (let i = 0; i < geometry.vertexCount; i++) {
            expect(geometry.positions[i * 3 + 1]).toBe(0);
            expect(geometry.normals[i * 3 + 1]).toBe(1);
        }
    });

    it('caches by shape and segment count, clamping invalid segments', () => {
        const a = ShapeGeometry.get('torus', 24);
        expect(ShapeGeometry.get('torus', 24)).toBe(a);
        expect(ShapeGeometry.get('torus', 32)).not.toBe(a);
        // NaN/0 fall back to the default tessellation instead of exploding
        checkWellFormed(ShapeGeometry.get('plane', 0));
        checkWellFormed(ShapeGeometry.get('plane', NaN));
    });

    it('falls back to plane for unknown shapes', () => {
        const unknown = ShapeGeometry.get('dodecahedron', 8);
        const plane = ShapeGeometry.get('plane', 8);
        expect(unknown.vertexCount).toBe(plane.vertexCount);
    });

    it.each(['cube', 'sphere', 'quad'])('builds a well-formed %s instance mesh', (shape) => {
        checkWellFormed(ShapeGeometry.getInstanceMesh(shape));
    });

    it('caches instance meshes and falls back to cube', () => {
        const cube = ShapeGeometry.getInstanceMesh('cube');
        expect(ShapeGeometry.getInstanceMesh('cube')).toBe(cube);
        expect(ShapeGeometry.getInstanceMesh('mystery').vertexCount).toBe(cube.vertexCount);
    });

    it('quad instance mesh is a flat two-triangle unit quad', () => {
        const quad = ShapeGeometry.quad();
        expect(quad.vertexCount).toBe(4);
        expect(quad.indexCount).toBe(6);
        for (let i = 0; i < 4; i++) {
            expect(quad.positions[i * 3 + 2]).toBe(0);
        }
    });
});
