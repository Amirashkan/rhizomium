import { describe, it, expect } from 'vitest';
import { Vec3 } from '../../../src/scene/math/Vec3.js';

describe('Vec3', () => {
    describe('constructor', () => {
        it('should create a zero vector by default', () => {
            const v = new Vec3();
            expect(v.x).toBe(0);
            expect(v.y).toBe(0);
            expect(v.z).toBe(0);
        });

        it('should create a vector with specified values', () => {
            const v = new Vec3(1, 2, 3);
            expect(v.x).toBe(1);
            expect(v.y).toBe(2);
            expect(v.z).toBe(3);
        });
    });

    describe('clone', () => {
        it('should create a copy of the vector', () => {
            const v1 = new Vec3(1, 2, 3);
            const v2 = v1.clone();
            expect(v2.x).toBe(1);
            expect(v2.y).toBe(2);
            expect(v2.z).toBe(3);
            expect(v2).not.toBe(v1);
        });
    });

    describe('set', () => {
        it('should set vector components', () => {
            const v = new Vec3();
            v.set(4, 5, 6);
            expect(v.x).toBe(4);
            expect(v.y).toBe(5);
            expect(v.z).toBe(6);
        });
    });

    describe('add', () => {
        it('should add two vectors', () => {
            const v1 = new Vec3(1, 2, 3);
            const v2 = new Vec3(4, 5, 6);
            v1.add(v2);
            expect(v1.x).toBe(5);
            expect(v1.y).toBe(7);
            expect(v1.z).toBe(9);
        });
    });

    describe('subtract', () => {
        it('should subtract two vectors', () => {
            const v1 = new Vec3(5, 7, 9);
            const v2 = new Vec3(4, 5, 6);
            v1.subtract(v2);
            expect(v1.x).toBe(1);
            expect(v1.y).toBe(2);
            expect(v1.z).toBe(3);
        });
    });

    describe('multiplyScalar', () => {
        it('should multiply vector by scalar', () => {
            const v = new Vec3(1, 2, 3);
            v.multiplyScalar(2);
            expect(v.x).toBe(2);
            expect(v.y).toBe(4);
            expect(v.z).toBe(6);
        });
    });

    describe('dot', () => {
        it('should calculate dot product', () => {
            const v1 = new Vec3(1, 2, 3);
            const v2 = new Vec3(4, 5, 6);
            const result = v1.dot(v2);
            expect(result).toBe(32); // 1*4 + 2*5 + 3*6 = 32
        });
    });

    describe('cross', () => {
        it('should calculate cross product', () => {
            const v1 = new Vec3(1, 0, 0);
            const v2 = new Vec3(0, 1, 0);
            v1.cross(v2);
            expect(v1.x).toBe(0);
            expect(v1.y).toBe(0);
            expect(v1.z).toBe(1);
        });
    });

    describe('length', () => {
        it('should calculate vector length', () => {
            const v = new Vec3(3, 4, 0);
            expect(v.length()).toBe(5);
        });
    });

    describe('normalize', () => {
        it('should normalize vector to unit length', () => {
            const v = new Vec3(3, 4, 0);
            v.normalize();
            expect(v.length()).toBeCloseTo(1, 5);
        });
    });

    describe('distanceTo', () => {
        it('should calculate distance between two vectors', () => {
            const v1 = new Vec3(0, 0, 0);
            const v2 = new Vec3(3, 4, 0);
            expect(v1.distanceTo(v2)).toBe(5);
        });
    });

    describe('static methods', () => {
        it('should create zero vector', () => {
            const v = Vec3.zero();
            expect(v.x).toBe(0);
            expect(v.y).toBe(0);
            expect(v.z).toBe(0);
        });

        it('should create unit X vector', () => {
            const v = Vec3.unitX();
            expect(v.x).toBe(1);
            expect(v.y).toBe(0);
            expect(v.z).toBe(0);
        });

        it('should create unit Y vector', () => {
            const v = Vec3.unitY();
            expect(v.x).toBe(0);
            expect(v.y).toBe(1);
            expect(v.z).toBe(0);
        });

        it('should create unit Z vector', () => {
            const v = Vec3.unitZ();
            expect(v.x).toBe(0);
            expect(v.y).toBe(0);
            expect(v.z).toBe(1);
        });
    });
});
