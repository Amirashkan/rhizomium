import { Transform } from '../Transform.js';
import { Vec3 } from '../math/Vec3.js';

/**
 * Base class for all scene graph nodes
 */
export class Node {
    /**
     * @param {string} name - optional name for the node
     */
    constructor(name = '') {
        this.name = name;
        this.transform = new Transform();
        this.parent = null;
        this.children = [];
        this.visible = true;
        this.userData = {};
        this._worldMatrixNeedsUpdate = true;
    }

    /**
     * Add a child node
     * @param {Node} child
     * @returns {Node} this
     */
    addChild(child) {
        if (child === this) {
            console.warn('Node.addChild: Cannot add node as child of itself');
            return this;
        }

        if (child.parent !== null) {
            child.parent.removeChild(child);
        }

        child.parent = this;
        this.children.push(child);
        child._worldMatrixNeedsUpdate = true;

        return this;
    }

    /**
     * Remove a child node
     * @param {Node} child
     * @returns {Node} this
     */
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            child.parent = null;
            this.children.splice(index, 1);
            child._worldMatrixNeedsUpdate = true;
        }
        return this;
    }

    /**
     * Remove this node from its parent
     * @returns {Node} this
     */
    removeFromParent() {
        if (this.parent !== null) {
            this.parent.removeChild(this);
        }
        return this;
    }

    /**
     * Get all children recursively
     * @returns {Node[]}
     */
    getAllChildren() {
        const result = [];
        const traverse = (node) => {
            for (const child of node.children) {
                result.push(child);
                traverse(child);
            }
        };
        traverse(this);
        return result;
    }

    /**
     * Find a node by name in the hierarchy
     * @param {string} name
     * @returns {Node|null}
     */
    findByName(name) {
        if (this.name === name) {
            return this;
        }

        for (const child of this.children) {
            const found = child.findByName(name);
            if (found) {
                return found;
            }
        }

        return null;
    }

    /**
     * Traverse the node hierarchy
     * @param {Function} callback - function to call for each node
     */
    traverse(callback) {
        callback(this);
        for (const child of this.children) {
            child.traverse(callback);
        }
    }

    /**
     * Get world transformation matrix
     * @returns {import('../math/Mat4.js').Mat4}
     */
    getWorldMatrix() {
        const parentWorldMatrix = this.parent ? this.parent.getWorldMatrix() : null;
        return this.transform.getWorldMatrix(parentWorldMatrix);
    }

    /**
     * Get world position
     * @returns {import('../math/Vec3.js').Vec3}
     */
    getWorldPosition() {
        const worldMatrix = this.getWorldMatrix();
        const e = worldMatrix.elements;
        return new Vec3(e[12], e[13], e[14]);
    }

    /**
     * Update world matrix and propagate to children
     */
    updateWorldMatrix() {
        if (this.parent) {
            this.parent.updateWorldMatrix();
        }

        this.transform.markMatrixNeedsUpdate();
        this._worldMatrixNeedsUpdate = false;

        for (const child of this.children) {
            child._worldMatrixNeedsUpdate = true;
        }
    }

    /**
     * Clone this node (shallow copy, does not clone children)
     * @returns {Node}
     */
    clone() {
        const cloned = new this.constructor(this.name);
        cloned.transform.copy(this.transform);
        cloned.visible = this.visible;
        cloned.userData = { ...this.userData };
        return cloned;
    }

    /**
     * Deep clone this node and all children
     * @returns {Node}
     */
    deepClone() {
        const cloned = this.clone();
        for (const child of this.children) {
            cloned.addChild(child.deepClone());
        }
        return cloned;
    }

    /**
     * Get node type (override in subclasses)
     * @returns {string}
     */
    getType() {
        return 'Node';
    }

    /**
     * Serialize node to JSON
     * @returns {Object}
     */
    toJSON() {
        return {
            type: this.getType(),
            name: this.name,
            visible: this.visible,
            transform: {
                position: this.transform.position.toArray(),
                rotation: this.transform.rotation.toArray(),
                scale: this.transform.scale.toArray()
            },
            userData: this.userData,
            children: this.children.map(child => child.toJSON())
        };
    }
}
