import { Node } from './nodes/Node.js';
import { MeshNode } from './nodes/MeshNode.js';
import { CameraNode } from './nodes/CameraNode.js';
import { LightNode } from './nodes/LightNode.js';
import { ComputeFieldMapperNode } from './nodes/ComputeFieldMapperNode.js';

/**
 * Scene class for managing a 3D scene graph
 */
export class Scene {
    constructor(name = 'Scene') {
        /**
         * Scene name
         * @type {string}
         */
        this.name = name;

        /**
         * Root node of the scene graph
         * @type {Node}
         */
        this.root = new Node('Root');

        /**
         * Active camera for rendering
         * @type {CameraNode|null}
         */
        this.activeCamera = null;

        /**
         * Background color or environment
         * @type {Object}
         */
        this.background = {
            type: 'color',      // 'color', 'skybox', 'environment'
            color: [0, 0, 0, 1] // RGBA
        };

        /**
         * Scene metadata
         * @type {Object}
         */
        this.metadata = {
            created: Date.now(),
            modified: Date.now(),
            author: '',
            description: ''
        };

        /**
         * Cached collections for quick access
         * @type {Object}
         */
        this._cache = {
            meshes: [],
            cameras: [],
            lights: [],
            computeFieldMappers: [],
            dirty: true
        };
    }

    /**
     * Add a node to the scene
     * @param {Node} node
     * @returns {Scene} this
     */
    addNode(node) {
        this.root.addChild(node);
        this._cache.dirty = true;
        return this;
    }

    /**
     * Remove a node from the scene
     * @param {Node} node
     * @returns {Scene} this
     */
    removeNode(node) {
        node.removeFromParent();
        this._cache.dirty = true;
        return this;
    }

    /**
     * Find a node by name
     * @param {string} name
     * @returns {Node|null}
     */
    findNodeByName(name) {
        return this.root.findByName(name);
    }

    /**
     * Get all nodes of a specific type
     * @param {Function} nodeType - Node constructor
     * @returns {Node[]}
     */
    getNodesByType(nodeType) {
        const nodes = [];
        this.root.traverse(node => {
            if (node instanceof nodeType) {
                nodes.push(node);
            }
        });
        return nodes;
    }

    /**
     * Get all mesh nodes
     * @returns {MeshNode[]}
     */
    getMeshNodes() {
        if (this._cache.dirty) {
            this._updateCache();
        }
        return this._cache.meshes;
    }

    /**
     * Get all camera nodes
     * @returns {CameraNode[]}
     */
    getCameraNodes() {
        if (this._cache.dirty) {
            this._updateCache();
        }
        return this._cache.cameras;
    }

    /**
     * Get all light nodes
     * @returns {LightNode[]}
     */
    getLightNodes() {
        if (this._cache.dirty) {
            this._updateCache();
        }
        return this._cache.lights;
    }

    /**
     * Get all compute field mapper nodes
     * @returns {ComputeFieldMapperNode[]}
     */
    getComputeFieldMapperNodes() {
        if (this._cache.dirty) {
            this._updateCache();
        }
        return this._cache.computeFieldMappers;
    }

    /**
     * Update cached node collections
     * @private
     */
    _updateCache() {
        this._cache.meshes = [];
        this._cache.cameras = [];
        this._cache.lights = [];
        this._cache.computeFieldMappers = [];

        this.root.traverse(node => {
            if (node instanceof MeshNode) {
                this._cache.meshes.push(node);
            } else if (node instanceof CameraNode) {
                this._cache.cameras.push(node);
            } else if (node instanceof LightNode) {
                this._cache.lights.push(node);
            } else if (node instanceof ComputeFieldMapperNode) {
                this._cache.computeFieldMappers.push(node);
            }
        });

        this._cache.dirty = false;
    }

    /**
     * Set active camera
     * @param {CameraNode} camera
     * @returns {Scene} this
     */
    setActiveCamera(camera) {
        if (!(camera instanceof CameraNode)) {
            console.warn('Scene.setActiveCamera: Provided node is not a CameraNode');
            return this;
        }
        this.activeCamera = camera;
        return this;
    }

    /**
     * Get active camera or first camera found
     * @returns {CameraNode|null}
     */
    getActiveCamera() {
        if (this.activeCamera) {
            return this.activeCamera;
        }

        // Try to find the first camera in the scene
        const cameras = this.getCameraNodes();
        if (cameras.length > 0) {
            this.activeCamera = cameras[0];
            return this.activeCamera;
        }

        return null;
    }

    /**
     * Set background color
     * @param {number} r - red (0-1)
     * @param {number} g - green (0-1)
     * @param {number} b - blue (0-1)
     * @param {number} a - alpha (0-1)
     * @returns {Scene} this
     */
    setBackgroundColor(r, g, b, a = 1) {
        this.background.type = 'color';
        this.background.color = [r, g, b, a];
        return this;
    }

    /**
     * Traverse all nodes in the scene
     * @param {Function} callback
     */
    traverse(callback) {
        this.root.traverse(callback);
    }

    /**
     * Update world matrices for all nodes
     */
    updateWorldMatrices() {
        this.root.traverse(node => {
            node.updateWorldMatrix();
        });
    }

    /**
     * Clear the scene
     * @returns {Scene} this
     */
    clear() {
        this.root.children = [];
        this.activeCamera = null;
        this._cache.dirty = true;
        return this;
    }

    /**
     * Clone the scene
     * @returns {Scene}
     */
    clone() {
        const cloned = new Scene(this.name);
        cloned.root = this.root.deepClone();
        cloned.background = { ...this.background };
        cloned.metadata = { ...this.metadata };
        cloned._cache.dirty = true;

        // Find and set active camera in cloned scene
        if (this.activeCamera) {
            const cameraName = this.activeCamera.name;
            const clonedCamera = cloned.findNodeByName(cameraName);
            if (clonedCamera instanceof CameraNode) {
                cloned.activeCamera = clonedCamera;
            }
        }

        return cloned;
    }

    /**
     * Serialize scene to JSON
     * @returns {Object}
     */
    toJSON() {
        return {
            name: this.name,
            root: this.root.toJSON(),
            activeCamera: this.activeCamera ? this.activeCamera.name : null,
            background: this.background,
            metadata: this.metadata
        };
    }

    /**
     * Load scene from JSON
     * @param {Object} json
     * @returns {Scene}
     */
    static fromJSON(json) {
        // This is a placeholder for JSON deserialization
        // Full implementation would require recursive node reconstruction
        const scene = new Scene(json.name);
        scene.background = json.background;
        scene.metadata = json.metadata;

        // TODO: Implement full node tree reconstruction from JSON
        console.warn('Scene.fromJSON: Full deserialization not yet implemented');

        return scene;
    }

    /**
     * Get scene statistics
     * @returns {Object}
     */
    getStatistics() {
        const stats = {
            totalNodes: 0,
            meshes: 0,
            cameras: 0,
            lights: 0,
            computeFieldMappers: 0,
            triangles: 0,
            vertices: 0
        };

        this.root.traverse(node => {
            stats.totalNodes++;

            if (node instanceof MeshNode) {
                stats.meshes++;
                if (node.geometry.indices) {
                    stats.triangles += node.geometry.indices.length / 3;
                }
                if (node.geometry.vertices) {
                    stats.vertices += node.geometry.vertices.length / 3;
                }
            } else if (node instanceof CameraNode) {
                stats.cameras++;
            } else if (node instanceof LightNode) {
                stats.lights++;
            } else if (node instanceof ComputeFieldMapperNode) {
                stats.computeFieldMappers++;
            }
        });

        return stats;
    }
}
