import { describe, it, expect } from 'vitest';
import { Node } from '../../../src/scene/nodes/Node.js';

describe('Node', () => {
    describe('constructor', () => {
        it('should create a node with default values', () => {
            const node = new Node();
            expect(node.name).toBe('');
            expect(node.parent).toBe(null);
            expect(node.children.length).toBe(0);
            expect(node.visible).toBe(true);
        });

        it('should create a node with a name', () => {
            const node = new Node('TestNode');
            expect(node.name).toBe('TestNode');
        });
    });

    describe('addChild', () => {
        it('should add a child node', () => {
            const parent = new Node('Parent');
            const child = new Node('Child');
            parent.addChild(child);

            expect(parent.children.length).toBe(1);
            expect(parent.children[0]).toBe(child);
            expect(child.parent).toBe(parent);
        });

        it('should reparent a child node', () => {
            const parent1 = new Node('Parent1');
            const parent2 = new Node('Parent2');
            const child = new Node('Child');

            parent1.addChild(child);
            parent2.addChild(child);

            expect(parent1.children.length).toBe(0);
            expect(parent2.children.length).toBe(1);
            expect(child.parent).toBe(parent2);
        });

        it('should not add node as child of itself', () => {
            const node = new Node('Node');
            node.addChild(node);
            expect(node.children.length).toBe(0);
        });
    });

    describe('removeChild', () => {
        it('should remove a child node', () => {
            const parent = new Node('Parent');
            const child = new Node('Child');
            parent.addChild(child);
            parent.removeChild(child);

            expect(parent.children.length).toBe(0);
            expect(child.parent).toBe(null);
        });
    });

    describe('removeFromParent', () => {
        it('should remove node from its parent', () => {
            const parent = new Node('Parent');
            const child = new Node('Child');
            parent.addChild(child);
            child.removeFromParent();

            expect(parent.children.length).toBe(0);
            expect(child.parent).toBe(null);
        });
    });

    describe('getAllChildren', () => {
        it('should get all children recursively', () => {
            const root = new Node('Root');
            const child1 = new Node('Child1');
            const child2 = new Node('Child2');
            const grandchild = new Node('Grandchild');

            root.addChild(child1);
            root.addChild(child2);
            child1.addChild(grandchild);

            const allChildren = root.getAllChildren();
            expect(allChildren.length).toBe(3);
            expect(allChildren).toContain(child1);
            expect(allChildren).toContain(child2);
            expect(allChildren).toContain(grandchild);
        });
    });

    describe('findByName', () => {
        it('should find a node by name', () => {
            const root = new Node('Root');
            const child1 = new Node('Child1');
            const child2 = new Node('Child2');
            root.addChild(child1);
            root.addChild(child2);

            const found = root.findByName('Child2');
            expect(found).toBe(child2);
        });

        it('should return null if node not found', () => {
            const root = new Node('Root');
            const found = root.findByName('NotFound');
            expect(found).toBe(null);
        });
    });

    describe('traverse', () => {
        it('should traverse all nodes in hierarchy', () => {
            const root = new Node('Root');
            const child1 = new Node('Child1');
            const child2 = new Node('Child2');
            root.addChild(child1);
            root.addChild(child2);

            const visited = [];
            root.traverse(node => visited.push(node.name));

            expect(visited).toEqual(['Root', 'Child1', 'Child2']);
        });
    });

    describe('clone', () => {
        it('should clone a node without children', () => {
            const node = new Node('Original');
            node.transform.setPosition(1, 2, 3);
            node.visible = false;
            node.userData = { key: 'value' };

            const cloned = node.clone();
            expect(cloned.name).toBe('Original');
            expect(cloned.transform.position.x).toBe(1);
            expect(cloned.visible).toBe(false);
            expect(cloned.userData.key).toBe('value');
            expect(cloned.children.length).toBe(0);
        });
    });

    describe('deepClone', () => {
        it('should clone a node with all children', () => {
            const root = new Node('Root');
            const child = new Node('Child');
            root.addChild(child);

            const cloned = root.deepClone();
            expect(cloned.name).toBe('Root');
            expect(cloned.children.length).toBe(1);
            expect(cloned.children[0].name).toBe('Child');
            expect(cloned.children[0]).not.toBe(child);
        });
    });

    describe('getType', () => {
        it('should return node type', () => {
            const node = new Node();
            expect(node.getType()).toBe('Node');
        });
    });

    describe('toJSON', () => {
        it('should serialize node to JSON', () => {
            const node = new Node('TestNode');
            node.transform.setPosition(1, 2, 3);
            const json = node.toJSON();

            expect(json.name).toBe('TestNode');
            expect(json.type).toBe('Node');
            expect(json.transform.position).toEqual([1, 2, 3]);
        });
    });
});
