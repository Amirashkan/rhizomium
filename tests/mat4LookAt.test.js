/**
 * Mat4.lookAt regression test
 *
 * The bug this pins down: lookAt stored the camera basis vectors as matrix
 * COLUMNS (a world-rotation layout) while using view-style translation. The
 * result was neither a view nor a world matrix - decomposing it oriented the
 * camera away from its target, so the 3D viewport never showed anything.
 *
 * A correct view matrix maps the look-at target onto the negative Z axis at
 * a distance equal to |eye - target|.
 */

import { describe, it, expect } from 'vitest';
import { Mat4 } from '../src/scene/math/Mat4.js';
import { Vec3 } from '../src/scene/math/Vec3.js';

const transformPoint = (m, p) => {
    const e = m.elements;
    const w = e[3] * p[0] + e[7] * p[1] + e[11] * p[2] + e[15];
    return [
        (e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]) / w,
        (e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]) / w,
        (e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]) / w
    ];
};

describe('Mat4.lookAt', () => {
    it('maps the target onto the negative Z axis at the eye distance', () => {
        const eye = new Vec3(3.062, 2.5, 3.062); // orbit: distance 5, az 45°, el 30°
        const target = new Vec3(0, 0, 0);
        const view = Mat4.lookAt(eye, target, new Vec3(0, 1, 0));

        const targetInView = transformPoint(view, [0, 0, 0]);
        expect(targetInView[0]).toBeCloseTo(0, 3);
        expect(targetInView[1]).toBeCloseTo(0, 3);
        expect(targetInView[2]).toBeCloseTo(-5, 2);
    });

    it('maps the eye position to the view-space origin', () => {
        const eye = new Vec3(1, 2, 3);
        const view = Mat4.lookAt(eye, new Vec3(0, 0, 0), new Vec3(0, 1, 0));

        const eyeInView = transformPoint(view, [1, 2, 3]);
        expect(eyeInView[0]).toBeCloseTo(0, 4);
        expect(eyeInView[1]).toBeCloseTo(0, 4);
        expect(eyeInView[2]).toBeCloseTo(0, 4);
    });

    it('keeps world +Y pointing upward in view space', () => {
        const view = Mat4.lookAt(new Vec3(0, 0, 5), new Vec3(0, 0, 0), new Vec3(0, 1, 0));
        const above = transformPoint(view, [0, 1, 0]);
        expect(above[1]).toBeCloseTo(1, 4);
    });
});
