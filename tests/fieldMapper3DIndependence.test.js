/**
 * 3D Field Visualizer nodes are INDEPENDENT of each other
 *
 * Every 3D node used to render into one shared scene texture, and that single
 * texture was published as the output of every 3D node in the graph. Two 3D
 * nodes therefore emitted identical images (the combined scene) and shared one
 * camera, so orbiting for one re-framed all of them.
 *
 * These tests pin the independence down:
 * - each node publishes its OWN rendered texture as its graph output
 * - each node owns a camera; orbiting the focused node leaves the others alone
 * - focus switching hands the interactive controller from one node's camera to
 *   the next without either losing its framing
 * - camera state round-trips onto the graph node, so it saves with the project
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeCamera3D } from '../src/scene/NodeCamera3D.js';
import { FieldMapperIntegration } from '../src/core/FieldMapperIntegration.js';
import { fieldMapperNodeId } from '../src/scene/SceneRenderer3D.js';
import { Transform } from '../src/scene/Transform.js';

/** Scene-side field mapper stub: a transform and its own camera */
function stubMapper(cameraState = null) {
    return { transform: new Transform(), camera3D: new NodeCamera3D(cameraState) };
}

/**
 * Minimal stand-in for Viewport3D + CameraController: holds the orbit state
 * the real controller holds and nothing else.
 */
function stubViewport(state = {}) {
    const camera = {
        fov: state.fov ?? 60,
        aspect: 1,
        near: 0.1,
        far: 1000,
        top: state.orthoSize ?? 10,
        cameraType: state.type ?? 'perspective',
        setPerspective(fov) { this.fov = fov; this.cameraType = 'perspective'; },
        setOrthographic(left, right, top) { this.top = top; this.cameraType = 'orthographic'; }
    };
    return {
        autoRotate: state.autoRotate ?? false,
        autoRotateSpeed: state.autoRotateSpeed ?? 0.25,
        cameraController: {
            azimuth: state.azimuth ?? 0,
            elevation: state.elevation ?? 0,
            distance: state.distance ?? 5,
            target: { x: 0, y: 0, z: 0 },
            getAngles() { return { azimuth: this.azimuth, elevation: this.elevation }; },
            getTarget() { return { ...this.target }; },
            getDistance() { return this.distance; },
            setAngles(azimuth, elevation) { this.azimuth = azimuth; this.elevation = elevation; },
            setDistance(distance) { this.distance = distance; },
            setTarget(x, y, z) { this.target = { x, y, z }; }
        },
        getCamera() { return camera; },
        getCameraType() { return camera.cameraType; },
        setCameraType(type) { camera.cameraType = type; }
    };
}

/** Scene stub that just collects nodes */
function stubScene() {
    const nodes = [];
    return {
        nodes,
        addNode(node) { nodes.push(node); },
        removeNode(node) {
            const i = nodes.indexOf(node);
            if (i !== -1) nodes.splice(i, 1);
        }
    };
}

/** ComputeExecutor stub exposing only what publishOutputs touches */
function stubExecutor() {
    return {
        nodeOutputs: new Map(),
        computeTextures: new Map(),
        externalOutputNodeIds: new Set(),
        computeManagers: new Map(),
        fallbackTexture: null,
        getNodeOutput() { return null; }
    };
}

/** SceneRenderer3D stub handing out a distinct texture per node id */
function stubRenderer(textures = {}) {
    return {
        focusedNodeId: null,
        rendered: 0,
        setFocusedNodeId(id) { this.focusedNodeId = id; },
        getNodeTexture(nodeId) { return textures[nodeId] || null; },
        render() { this.rendered += 1; }
    };
}

describe('NodeCamera3D', () => {
    it('starts from the default three-quarter framing', () => {
        const camera = new NodeCamera3D();
        expect(camera.azimuth).toBeCloseTo(Math.PI / 4);
        expect(camera.elevation).toBeCloseTo(Math.PI / 6);
        expect(camera.distance).toBe(5);
        expect(camera.type).toBe('perspective');
    });

    it('round-trips its state', () => {
        const state = {
            azimuth: 1.2, elevation: 0.4, distance: 8, target: [1, 2, 3],
            type: 'orthographic', fov: 45, orthoSize: 4,
            autoRotate: true, autoRotateSpeed: 0.75
        };
        expect(new NodeCamera3D(state).getState()).toEqual(state);
    });

    it('rejects non-finite state rather than poisoning the projection', () => {
        const camera = new NodeCamera3D({ distance: NaN, azimuth: 'nope', fov: undefined });
        expect(camera.distance).toBe(5);
        expect(camera.azimuth).toBeCloseTo(Math.PI / 4);
        expect(Number.isFinite(camera.fov)).toBe(true);

        for (const value of camera.getProjectionMatrix().elements) {
            expect(Number.isFinite(value)).toBe(true);
        }
    });

    it('clamps elevation and distance to the controller limits', () => {
        const camera = new NodeCamera3D({ elevation: 99, distance: 10000 });
        expect(camera.elevation).toBeLessThan(Math.PI / 2);
        expect(camera.distance).toBe(100);
    });

    it('produces a different view matrix for a different viewpoint', () => {
        const a = new NodeCamera3D({ azimuth: 0 }).getViewMatrix().elements.slice();
        const b = new NodeCamera3D({ azimuth: Math.PI / 2 }).getViewMatrix().elements.slice();
        expect(a).not.toEqual(Array.from(b));
    });

    it('advances the spin only while auto-rotate is on', () => {
        const spinning = new NodeCamera3D({ autoRotate: true, autoRotateSpeed: 1 });
        spinning.update(1000);
        spinning.update(1050);
        expect(spinning.azimuth).toBeGreaterThan(Math.PI / 4);

        const still = new NodeCamera3D({ autoRotate: false });
        still.update(1000);
        still.update(1050);
        expect(still.azimuth).toBeCloseTo(Math.PI / 4);
    });
});

describe('fieldMapperNodeId', () => {
    it('reads the graph id a scene-side mapper was built with', () => {
        expect(fieldMapperNodeId({ graphNodeId: '7' })).toBe('7');
        expect(fieldMapperNodeId({ name: '9' })).toBe('9');
        expect(fieldMapperNodeId(null)).toBe('');
    });
});

describe('FieldMapperIntegration per-node outputs', () => {
    let integration;
    let executor;

    const textureA = { label: 'node-a-frame' };
    const textureB = { label: 'node-b-frame' };

    beforeEach(() => {
        executor = stubExecutor();
        integration = new FieldMapperIntegration(
            null, stubScene(), executor,
            stubRenderer({ a: textureA, b: textureB }),
            null
        );
        integration.fieldMappers.set('a', stubMapper());
        integration.fieldMappers.set('b', stubMapper());
    });

    it('publishes each node its OWN texture, not one shared frame', () => {
        integration.publishOutputs();

        expect(executor.nodeOutputs.get('a')).toBe(textureA);
        expect(executor.nodeOutputs.get('b')).toBe(textureB);
        expect(executor.nodeOutputs.get('a')).not.toBe(executor.nodeOutputs.get('b'));
        expect(executor.computeTextures.get('a').texture).toBe(textureA);
        expect(executor.computeTextures.get('b').texture).toBe(textureB);
    });

    it('marks every published node as externally owned', () => {
        integration.publishOutputs();
        expect(executor.externalOutputNodeIds.has('a')).toBe(true);
        expect(executor.externalOutputNodeIds.has('b')).toBe(true);
    });

    it('rebinds an existing entry in place so downstream bindings survive', () => {
        executor.computeTextures.set('a', { texture: { label: 'stale' }, sampler: 'keep-me' });
        integration.publishOutputs();

        const entry = executor.computeTextures.get('a');
        expect(entry.texture).toBe(textureA);
        expect(entry.sampler).toBe('keep-me');
    });

    it('skips a node whose first frame has not been rendered yet', () => {
        integration.fieldMappers.set('c', stubMapper());
        integration.publishOutputs();
        expect(executor.nodeOutputs.has('c')).toBe(false);
    });
});

describe('FieldMapperIntegration camera focus', () => {
    let integration;
    let viewport;
    let renderer;

    beforeEach(() => {
        viewport = stubViewport({ azimuth: 0.5, elevation: 0.2, distance: 6 });
        renderer = stubRenderer();
        integration = new FieldMapperIntegration(null, stubScene(), stubExecutor(), renderer, { viewport3D: viewport });

        integration._graphNodes = [
            { id: 'a', kind: 'ComputeFieldMapper', params: {} },
            { id: 'b', kind: 'ComputeFieldMapper', params: {} }
        ];
        integration.fieldMappers.set('a', stubMapper({ azimuth: 0.5, elevation: 0.2, distance: 6 }));
        integration.fieldMappers.set('b', stubMapper({ azimuth: 3.0, elevation: 0.9, distance: 20 }));
        integration.focusedNodeId = 'a';
    });

    it('captures an orbit into the focused node only', () => {
        viewport.cameraController.setAngles(1.75, 0.33);
        integration.captureFocusedCamera();

        expect(integration.fieldMappers.get('a').camera3D.azimuth).toBeCloseTo(1.75);
        // The unfocused node keeps the framing it was left with
        expect(integration.fieldMappers.get('b').camera3D.azimuth).toBeCloseTo(3.0);
        expect(integration.fieldMappers.get('b').camera3D.distance).toBe(20);
    });

    it('persists the focused camera onto the graph node so it saves', () => {
        viewport.cameraController.setAngles(1.1, 0.25);
        viewport.cameraController.setDistance(9);
        integration.captureFocusedCamera();

        const saved = integration._graphNodes[0].camera3D;
        expect(saved.azimuth).toBeCloseTo(1.1);
        expect(saved.distance).toBe(9);
        expect(integration._graphNodes[1].camera3D).toBeUndefined();
    });

    it('hands the controller over on focus change without losing either framing', () => {
        viewport.cameraController.setAngles(1.25, 0.4);

        expect(integration.setFocus('b')).toBe(true);

        // A kept its last framing...
        expect(integration.fieldMappers.get('a').camera3D.azimuth).toBeCloseTo(1.25);
        // ...and the controller now drives B's stored viewpoint
        expect(viewport.cameraController.azimuth).toBeCloseTo(3.0);
        expect(viewport.cameraController.distance).toBe(20);
        expect(renderer.focusedNodeId).toBe('b');
    });

    it('restores per-node projection and spin settings on focus change', () => {
        integration.fieldMappers.get('b').camera3D.setState({
            type: 'orthographic', orthoSize: 3, autoRotate: true, autoRotateSpeed: 1.5
        });

        integration.setFocus('b');

        expect(viewport.getCameraType()).toBe('orthographic');
        expect(viewport.getCamera().top).toBe(3);
        expect(viewport.autoRotate).toBe(true);
        expect(viewport.autoRotateSpeed).toBe(1.5);
    });

    it('ignores focus requests for nodes that are not 3D mappers', () => {
        expect(integration.setFocus('does-not-exist')).toBe(false);
        expect(integration.focusedNodeId).toBe('a');
    });

    it('moves focus to a surviving node when the focused one is deleted', () => {
        integration.fieldMappers.delete('a');
        integration.ensureValidFocus();

        expect(integration.focusedNodeId).toBe('b');
        expect(renderer.focusedNodeId).toBe('b');
    });

    it('drops focus when the last 3D node is deleted', () => {
        integration.fieldMappers.clear();
        integration.ensureValidFocus();

        expect(integration.focusedNodeId).toBeNull();
        expect(renderer.focusedNodeId).toBeNull();
    });

    it('spins unfocused nodes on their own clock, and never double-spins the focused one', () => {
        const a = integration.fieldMappers.get('a').camera3D;
        const b = integration.fieldMappers.get('b').camera3D;
        a.setState({ autoRotate: true, autoRotateSpeed: 1 });
        b.setState({ autoRotate: true, autoRotateSpeed: 1 });
        const startA = a.azimuth;
        const startB = b.azimuth;

        integration.updateFrame();
        integration.updateFrame();

        // B advances under its own steam; A's spin arrives via the viewport
        // (which this stub never advances), so it must NOT have moved here
        expect(b.azimuth).toBeGreaterThan(startB);
        expect(a.azimuth).toBeCloseTo(startA);
    });
});

describe('FieldMapperIntegration focus follows selection', () => {
    let integration;

    beforeEach(() => {
        integration = new FieldMapperIntegration(
            null, stubScene(), stubExecutor(), stubRenderer(), { viewport3D: stubViewport() }
        );
        integration._graphNodes = [
            { id: 'a', kind: 'ComputeFieldMapper', params: {} },
            { id: 'b', kind: 'ComputeFieldMapper', params: {} }
        ];
        integration.fieldMappers.set('a', stubMapper());
        integration.fieldMappers.set('b', stubMapper());
        integration.focusedNodeId = 'a';
        window.editor = { selection: { getSelected: () => new Set() }, paramPanel: {} };
    });

    afterEach(() => {
        delete window.editor;
    });

    it('switches the viewport to a newly selected 3D node', () => {
        window.editor.paramPanel.selectedNode = { id: 'b', kind: 'ComputeFieldMapper' };
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('b');
    });

    it('follows a single-node graph selection too', () => {
        window.editor.selection.getSelected = () => new Set(['b']);
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('b');
    });

    it('leaves a manual viewport pick alone until the selection changes', () => {
        window.editor.paramPanel.selectedNode = { id: 'a', kind: 'ComputeFieldMapper' };
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('a');

        // User picks B from the viewport's own selector; the graph selection
        // has not moved, so following it must not drag focus back to A
        integration.setFocus('b');
        integration.followSelection();
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('b');

        // ...until the selection actually moves again - clicking empty canvas
        // and then back onto A
        window.editor.paramPanel.selectedNode = null;
        integration.followSelection();
        window.editor.paramPanel.selectedNode = { id: 'a', kind: 'ComputeFieldMapper' };
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('a');
    });

    it('ignores multi-node and non-3D selections', () => {
        window.editor.selection.getSelected = () => new Set(['a', 'b']);
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('a');

        window.editor.paramPanel.selectedNode = { id: 'z', kind: 'ComputeNoise' };
        integration.followSelection();
        expect(integration.focusedNodeId).toBe('a');
    });
});

describe('FieldMapperIntegration viewport state restore', () => {
    let integration;
    let viewport;

    beforeEach(() => {
        // The panel restores its saved camera block AFTER the graph rebuild
        // that creates the mappers, so it lands on the controller last
        viewport = stubViewport({ azimuth: 2.75, elevation: 0.6, distance: 15 });
        integration = new FieldMapperIntegration(
            null, stubScene(), stubExecutor(), stubRenderer(), { viewport3D: viewport }
        );
        integration._graphNodes = [
            { id: 'a', kind: 'ComputeFieldMapper', params: {} },
            { id: 'b', kind: 'ComputeFieldMapper', params: {} }
        ];
        integration.focusedNodeId = 'a';
    });

    it('keeps per-node cameras from being clobbered by the panel block', () => {
        const a = stubMapper({ azimuth: 0.25, distance: 4 });
        a._cameraRestored = true;
        integration.fieldMappers.set('a', a);

        integration.onViewportStateRestored();

        // The node's own saved viewpoint survives...
        expect(a.camera3D.azimuth).toBeCloseTo(0.25);
        expect(a.camera3D.distance).toBe(4);
        // ...and takes the controller back over
        expect(viewport.cameraController.azimuth).toBeCloseTo(0.25);
        expect(viewport.cameraController.distance).toBe(4);
    });

    it('lets a legacy project keep its single saved camera on every node', () => {
        const a = stubMapper();
        const b = stubMapper();
        integration.fieldMappers.set('a', a);
        integration.fieldMappers.set('b', b);

        integration.onViewportStateRestored();

        for (const mapper of [a, b]) {
            expect(mapper.camera3D.azimuth).toBeCloseTo(2.75);
            expect(mapper.camera3D.distance).toBe(15);
        }
        expect(integration._graphNodes[0].camera3D.distance).toBe(15);
    });

    it('does not overwrite a node that already carries its own camera', () => {
        const a = stubMapper({ azimuth: 0.25 });
        a._cameraRestored = true;
        const b = stubMapper({ azimuth: 1.5 });
        integration.fieldMappers.set('a', a);
        integration.fieldMappers.set('b', b);
        integration.focusedNodeId = 'b';

        integration.onViewportStateRestored();

        expect(b.camera3D.azimuth).toBeCloseTo(2.75); // legacy node adopts it
        expect(a.camera3D.azimuth).toBeCloseTo(0.25); // saved node keeps its own
    });
});

describe('FieldMapperIntegration camera adoption', () => {
    afterEach(() => {
        delete window.editor;
    });

    it('gives a new node the viewpoint the user is currently looking through', () => {
        const viewport = stubViewport({ azimuth: 2.5, elevation: 0.3, distance: 12 });
        const integration = new FieldMapperIntegration(
            null, stubScene(), stubExecutor(), stubRenderer(), { viewport3D: viewport }
        );

        const state = integration.readViewportCamera();
        expect(state.azimuth).toBeCloseTo(2.5);
        expect(state.distance).toBe(12);

        // Which is what a camera-less node is seeded with
        expect(new NodeCamera3D(state).azimuth).toBeCloseTo(2.5);
    });

    it('works with no viewport at all (headless / panel not built yet)', () => {
        const integration = new FieldMapperIntegration(null, stubScene(), stubExecutor(), stubRenderer(), null);
        expect(integration.readViewportCamera()).toBeNull();
        expect(() => integration.captureFocusedCamera()).not.toThrow();
    });
});
