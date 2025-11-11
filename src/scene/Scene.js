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
        const scene = new Scene(json.name || 'Scene');
        scene.background = json.background || { type: 'color', color: [0, 0, 0, 1] };
        scene.metadata = json.metadata || {
            created: Date.now(),
            modified: Date.now(),
            author: '',
            description: ''
        };

        // Reconstruct node tree
        if (json.root) {
            scene.root = Scene._reconstructNode(json.root);
        }

        // Find and set active camera
        if (json.activeCamera) {
            const camera = scene.findNodeByName(json.activeCamera);
            if (camera instanceof CameraNode) {
                scene.activeCamera = camera;
            }
        }

        scene._cache.dirty = true;

        return scene;
    }

    /**
     * Reconstruct a node from JSON (recursive)
     * @param {Object} nodeData - Node JSON data
     * @returns {Node}
     * @private
     */
    static _reconstructNode(nodeData) {
        if (!nodeData || !nodeData.type) {

            return new Node('Unknown');
        }

        let node;

        // Create node based on type
        switch (nodeData.type) {
            case 'Node':
                node = new Node(nodeData.name);
                break;

            case 'MeshNode':
                node = new MeshNode(nodeData.name);
                // Restore geometry and material if present
                if (nodeData.geometry) {
                    node.geometry = nodeData.geometry;
                }
                if (nodeData.material) {
                    node.material = nodeData.material;
                }
                break;

            case 'CameraNode':
                node = new CameraNode(nodeData.name);
                // Restore camera properties
                if (nodeData.projection) {
                    node.projection = nodeData.projection;
                }
                if (nodeData.fov !== undefined) {
                    node.fov = nodeData.fov;
                }
                if (nodeData.near !== undefined) {
                    node.near = nodeData.near;
                }
                if (nodeData.far !== undefined) {
                    node.far = nodeData.far;
                }
                if (nodeData.orthographicSize !== undefined) {
                    node.orthographicSize = nodeData.orthographicSize;
                }
                break;

            case 'LightNode':
                node = new LightNode(nodeData.name);
                // Restore light properties
                if (nodeData.lightType) {
                    node.lightType = nodeData.lightType;
                }
                if (nodeData.color) {
                    node.color = nodeData.color;
                }
                if (nodeData.intensity !== undefined) {
                    node.intensity = nodeData.intensity;
                }
                break;

            case 'ComputeFieldMapperNode':
                node = new ComputeFieldMapperNode(nodeData.name);
                // Restore compute field mapper properties
                if (nodeData.sourceNodeId) {
                    node.sourceNodeId = nodeData.sourceNodeId;
                }
                if (nodeData.fieldBounds) {
                    node.fieldBounds = nodeData.fieldBounds;
                }
                if (nodeData.resolution) {
                    node.resolution = nodeData.resolution;
                }
                if (nodeData.visualizationMode) {
                    node.visualizationMode = nodeData.visualizationMode;
                }
                if (nodeData.threshold !== undefined) {
                    node.threshold = nodeData.threshold;
                }
                if (nodeData.color) {
                    node.color = nodeData.color;
                }
                break;

            default:

                node = new Node(nodeData.name || 'Unknown');
                break;
        }

        // Restore common properties
        if (nodeData.visible !== undefined) {
            node.visible = nodeData.visible;
        }

        if (nodeData.userData) {
            node.userData = nodeData.userData;
        }

        // Restore transform
        if (nodeData.transform) {
            if (nodeData.transform.position) {
                node.transform.position.fromArray(nodeData.transform.position);
            }
            if (nodeData.transform.rotation) {
                node.transform.rotation.fromArray(nodeData.transform.rotation);
            }
            if (nodeData.transform.scale) {
                node.transform.scale.fromArray(nodeData.transform.scale);
            }
        }

        // Recursively reconstruct children
        if (nodeData.children && Array.isArray(nodeData.children)) {
            for (const childData of nodeData.children) {
                const child = Scene._reconstructNode(childData);
                node.addChild(child);
            }
        }

        return node;
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
