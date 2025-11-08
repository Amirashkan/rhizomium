import { describe, it, expect } from 'vitest';
import { Scene } from '../../src/scene/Scene.js';
import { Node } from '../../src/scene/nodes/Node.js';
import { MeshNode } from '../../src/scene/nodes/MeshNode.js';
import { CameraNode } from '../../src/scene/nodes/CameraNode.js';
import { LightNode } from '../../src/scene/nodes/LightNode.js';
import { ComputeFieldMapperNode } from '../../src/scene/nodes/ComputeFieldMapperNode.js';

describe('Scene', () => {
    describe('constructor', () => {
        it('should create a scene with default values', () => {
            const scene = new Scene();
            expect(scene.name).toBe('Scene');
            expect(scene.root).toBeInstanceOf(Node);
            expect(scene.activeCamera).toBe(null);
        });

        it('should create a scene with a custom name', () => {
            const scene = new Scene('MyScene');
            expect(scene.name).toBe('MyScene');
        });
    });

    describe('addNode', () => {
        it('should add a node to the scene', () => {
            const scene = new Scene();
            const node = new Node('TestNode');
            scene.addNode(node);

            expect(scene.root.children.length).toBe(1);
            expect(scene.root.children[0]).toBe(node);
        });
    });

    describe('removeNode', () => {
        it('should remove a node from the scene', () => {
            const scene = new Scene();
            const node = new Node('TestNode');
            scene.addNode(node);
            scene.removeNode(node);

            expect(scene.root.children.length).toBe(0);
            expect(node.parent).toBe(null);
        });
    });

    describe('findNodeByName', () => {
        it('should find a node by name', () => {
            const scene = new Scene();
            const node = new Node('TestNode');
            scene.addNode(node);

            const found = scene.findNodeByName('TestNode');
            expect(found).toBe(node);
        });
    });

    describe('getNodesByType', () => {
        it('should get all nodes of a specific type', () => {
            const scene = new Scene();
            const mesh1 = new MeshNode('Mesh1');
            const mesh2 = new MeshNode('Mesh2');
            const camera = new CameraNode('Camera');

            scene.addNode(mesh1);
            scene.addNode(mesh2);
            scene.addNode(camera);

            const meshes = scene.getNodesByType(MeshNode);
            expect(meshes.length).toBe(2);
            expect(meshes).toContain(mesh1);
            expect(meshes).toContain(mesh2);
        });
    });

    describe('getMeshNodes', () => {
        it('should get all mesh nodes', () => {
            const scene = new Scene();
            const mesh = new MeshNode('Mesh');
            scene.addNode(mesh);

            const meshes = scene.getMeshNodes();
            expect(meshes.length).toBe(1);
            expect(meshes[0]).toBe(mesh);
        });

        it('should cache mesh nodes', () => {
            const scene = new Scene();
            const mesh = new MeshNode('Mesh');
            scene.addNode(mesh);

            const meshes1 = scene.getMeshNodes();
            const meshes2 = scene.getMeshNodes();
            expect(meshes1).toBe(meshes2); // Same array instance
        });
    });

    describe('getCameraNodes', () => {
        it('should get all camera nodes', () => {
            const scene = new Scene();
            const camera = new CameraNode('Camera');
            scene.addNode(camera);

            const cameras = scene.getCameraNodes();
            expect(cameras.length).toBe(1);
            expect(cameras[0]).toBe(camera);
        });
    });

    describe('getLightNodes', () => {
        it('should get all light nodes', () => {
            const scene = new Scene();
            const light = new LightNode('Light');
            scene.addNode(light);

            const lights = scene.getLightNodes();
            expect(lights.length).toBe(1);
            expect(lights[0]).toBe(light);
        });
    });

    describe('getComputeFieldMapperNodes', () => {
        it('should get all compute field mapper nodes', () => {
            const scene = new Scene();
            const mapper = new ComputeFieldMapperNode('Mapper');
            scene.addNode(mapper);

            const mappers = scene.getComputeFieldMapperNodes();
            expect(mappers.length).toBe(1);
            expect(mappers[0]).toBe(mapper);
        });
    });

    describe('setActiveCamera', () => {
        it('should set the active camera', () => {
            const scene = new Scene();
            const camera = new CameraNode('Camera');
            scene.addNode(camera);
            scene.setActiveCamera(camera);

            expect(scene.activeCamera).toBe(camera);
        });

        it('should warn when setting non-camera node as active camera', () => {
            const scene = new Scene();
            const node = new Node('NotACamera');
            scene.setActiveCamera(node);

            expect(scene.activeCamera).not.toBe(node);
        });
    });

    describe('getActiveCamera', () => {
        it('should return the active camera', () => {
            const scene = new Scene();
            const camera = new CameraNode('Camera');
            scene.addNode(camera);
            scene.setActiveCamera(camera);

            expect(scene.getActiveCamera()).toBe(camera);
        });

        it('should return first camera if no active camera set', () => {
            const scene = new Scene();
            const camera = new CameraNode('Camera');
            scene.addNode(camera);

            expect(scene.getActiveCamera()).toBe(camera);
        });
    });

    describe('setBackgroundColor', () => {
        it('should set background color', () => {
            const scene = new Scene();
            scene.setBackgroundColor(0.5, 0.6, 0.7, 0.8);

            expect(scene.background.type).toBe('color');
            expect(scene.background.color).toEqual([0.5, 0.6, 0.7, 0.8]);
        });
    });

    describe('traverse', () => {
        it('should traverse all nodes in the scene', () => {
            const scene = new Scene();
            const node1 = new Node('Node1');
            const node2 = new Node('Node2');
            scene.addNode(node1);
            scene.addNode(node2);

            const visited = [];
            scene.traverse(node => visited.push(node.name));

            expect(visited).toContain('Node1');
            expect(visited).toContain('Node2');
        });
    });

    describe('clear', () => {
        it('should clear the scene', () => {
            const scene = new Scene();
            const node = new Node('TestNode');
            const camera = new CameraNode('Camera');
            scene.addNode(node);
            scene.setActiveCamera(camera);

            scene.clear();

            expect(scene.root.children.length).toBe(0);
            expect(scene.activeCamera).toBe(null);
        });
    });

    describe('clone', () => {
        it('should clone the scene', () => {
            const scene = new Scene('Original');
            const node = new Node('TestNode');
            scene.addNode(node);

            const cloned = scene.clone();

            expect(cloned.name).toBe('Original');
            expect(cloned.root.children.length).toBe(1);
            expect(cloned.root.children[0]).not.toBe(node);
        });
    });

    describe('getStatistics', () => {
        it('should return scene statistics', () => {
            const scene = new Scene();
            scene.addNode(new MeshNode('Mesh1'));
            scene.addNode(new MeshNode('Mesh2'));
            scene.addNode(new CameraNode('Camera'));
            scene.addNode(new LightNode('Light'));
            scene.addNode(new ComputeFieldMapperNode('Mapper'));

            const stats = scene.getStatistics();

            expect(stats.meshes).toBe(2);
            expect(stats.cameras).toBe(1);
            expect(stats.lights).toBe(1);
            expect(stats.computeFieldMappers).toBe(1);
            expect(stats.totalNodes).toBeGreaterThan(5); // Includes root
        });
    });

    describe('toJSON', () => {
        it('should serialize scene to JSON', () => {
            const scene = new Scene('TestScene');
            const node = new Node('TestNode');
            scene.addNode(node);

            const json = scene.toJSON();

            expect(json.name).toBe('TestScene');
            expect(json.root).toBeDefined();
            expect(json.background).toBeDefined();
            expect(json.metadata).toBeDefined();
        });
    });
});
