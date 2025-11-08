import { Node } from './Node.js';

/**
 * Mesh node for rendering 3D geometry
 */
export class MeshNode extends Node {
    /**
     * @param {string} name
     * @param {Object} options
     * @param {Object} options.geometry - geometry data (vertices, indices, etc.)
     * @param {Object} options.material - material properties
     */
    constructor(name = '', options = {}) {
        super(name);

        /**
         * Geometry data containing mesh information
         * @type {Object}
         */
        this.geometry = options.geometry || {
            vertices: null,      // Float32Array or array of vertex positions
            normals: null,       // Float32Array or array of vertex normals
            uvs: null,           // Float32Array or array of texture coordinates
            indices: null,       // Uint16Array or Uint32Array of indices
            attributes: {}       // Additional vertex attributes
        };

        /**
         * Material properties for rendering
         * @type {Object}
         */
        this.material = options.material || {
            color: [1, 1, 1, 1], // RGBA color
            shader: null,         // Reference to shader program
            textures: {},         // Texture maps (diffuse, normal, etc.)
            properties: {}        // Additional material properties
        };

        /**
         * Bounding box for culling (optional)
         * @type {Object|null}
         */
        this.boundingBox = options.boundingBox || null;

        /**
         * Whether to cast shadows
         * @type {boolean}
         */
        this.castShadows = options.castShadows !== undefined ? options.castShadows : true;

        /**
         * Whether to receive shadows
         * @type {boolean}
         */
        this.receiveShadows = options.receiveShadows !== undefined ? options.receiveShadows : true;
    }

    /**
     * Get node type
     * @returns {string}
     */
    getType() {
        return 'MeshNode';
    }

    /**
     * Set geometry
     * @param {Object} geometry
     * @returns {MeshNode} this
     */
    setGeometry(geometry) {
        this.geometry = geometry;
        return this;
    }

    /**
     * Set material
     * @param {Object} material
     * @returns {MeshNode} this
     */
    setMaterial(material) {
        this.material = material;
        return this;
    }

    /**
     * Update bounding box based on geometry
     * @returns {MeshNode} this
     */
    updateBoundingBox() {
        if (!this.geometry.vertices) {
            return this;
        }

        const vertices = this.geometry.vertices;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];
            const z = vertices[i + 2];

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);

            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        this.boundingBox = {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
            center: [
                (minX + maxX) / 2,
                (minY + maxY) / 2,
                (minZ + maxZ) / 2
            ],
            size: [
                maxX - minX,
                maxY - minY,
                maxZ - minZ
            ]
        };

        return this;
    }

    /**
     * Clone this mesh node
     * @returns {MeshNode}
     */
    clone() {
        const cloned = new MeshNode(this.name, {
            geometry: { ...this.geometry },
            material: { ...this.material },
            boundingBox: this.boundingBox ? { ...this.boundingBox } : null,
            castShadows: this.castShadows,
            receiveShadows: this.receiveShadows
        });
        cloned.transform.copy(this.transform);
        cloned.visible = this.visible;
        cloned.userData = { ...this.userData };
        return cloned;
    }

    /**
     * Serialize to JSON
     * @returns {Object}
     */
    toJSON() {
        const json = super.toJSON();
        json.geometry = this.geometry;
        json.material = this.material;
        json.boundingBox = this.boundingBox;
        json.castShadows = this.castShadows;
        json.receiveShadows = this.receiveShadows;
        return json;
    }
}
