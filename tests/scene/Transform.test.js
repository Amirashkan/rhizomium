import { describe, it, expect } from 'vitest';
import { Transform } from '../../src/scene/Transform.js';

describe('Transform', () => {
    describe('constructor', () => {
        it('should create a transform with default values', () => {
            const transform = new Transform();
            expect(transform.position.x).toBe(0);
            expect(transform.position.y).toBe(0);
            expect(transform.position.z).toBe(0);
            expect(transform.scale.x).toBe(1);
            expect(transform.scale.y).toBe(1);
            expect(transform.scale.z).toBe(1);
        });
    });

    describe('setPosition', () => {
        it('should set position', () => {
            const transform = new Transform();
            transform.setPosition(1, 2, 3);
            expect(transform.position.x).toBe(1);
            expect(transform.position.y).toBe(2);
            expect(transform.position.z).toBe(3);
        });

        it('should mark matrix as needing update', () => {
            const transform = new Transform();
            transform.getLocalMatrix(); // Updates matrix
            expect(transform._matrixNeedsUpdate).toBe(false);
            transform.setPosition(1, 2, 3);
            expect(transform._matrixNeedsUpdate).toBe(true);
        });
    });

    describe('setScale', () => {
        it('should set scale', () => {
            const transform = new Transform();
            transform.setScale(2, 3, 4);
            expect(transform.scale.x).toBe(2);
            expect(transform.scale.y).toBe(3);
            expect(transform.scale.z).toBe(4);
        });
    });

    describe('setUniformScale', () => {
        it('should set uniform scale', () => {
            const transform = new Transform();
            transform.setUniformScale(2);
            expect(transform.scale.x).toBe(2);
            expect(transform.scale.y).toBe(2);
            expect(transform.scale.z).toBe(2);
        });
    });

    describe('translate', () => {
        it('should translate position', () => {
            const transform = new Transform();
            transform.setPosition(1, 2, 3);
            transform.translate(1, 1, 1);
            expect(transform.position.x).toBe(2);
            expect(transform.position.y).toBe(3);
            expect(transform.position.z).toBe(4);
        });
    });

    describe('getLocalMatrix', () => {
        it('should return a 4x4 matrix', () => {
            const transform = new Transform();
            const matrix = transform.getLocalMatrix();
            expect(matrix.elements.length).toBe(16);
        });

        it('should cache the matrix when not dirty', () => {
            const transform = new Transform();
            const matrix1 = transform.getLocalMatrix();
            const matrix2 = transform.getLocalMatrix();
            expect(matrix1).toBe(matrix2); // Same instance
        });
    });

    describe('clone', () => {
        it('should create a copy of the transform', () => {
            const t1 = new Transform();
            t1.setPosition(1, 2, 3);
            t1.setScale(2, 2, 2);

            const t2 = t1.clone();
            expect(t2.position.x).toBe(1);
            expect(t2.position.y).toBe(2);
            expect(t2.position.z).toBe(3);
            expect(t2.scale.x).toBe(2);
            expect(t2).not.toBe(t1);
        });
    });

    describe('reset', () => {
        it('should reset transform to identity', () => {
            const transform = new Transform();
            transform.setPosition(1, 2, 3);
            transform.setScale(2, 2, 2);
            transform.reset();

            expect(transform.position.x).toBe(0);
            expect(transform.position.y).toBe(0);
            expect(transform.position.z).toBe(0);
            expect(transform.scale.x).toBe(1);
            expect(transform.scale.y).toBe(1);
            expect(transform.scale.z).toBe(1);
        });
    });
});
