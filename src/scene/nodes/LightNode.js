import { Node } from './Node.js';

/**
 * Light node (placeholder for future lighting implementation)
 * This is a minimal implementation that can be extended with actual lighting properties
 */
export class LightNode extends Node {
    /**
     * @param {string} name
     * @param {Object} options
     * @param {string} options.lightType - 'directional', 'point', 'spot', or 'ambient'
     * @param {number[]} options.color - RGB color [r, g, b]
     * @param {number} options.intensity - light intensity
     */
    constructor(name = '', options = {}) {
        super(name);

        /**
         * Light type: 'directional', 'point', 'spot', or 'ambient'
         * @type {string}
         */
        this.lightType = options.lightType || 'point';

        /**
         * Light color (RGB, values 0-1)
         * @type {number[]}
         */
        this.color = options.color || [1, 1, 1];

        /**
         * Light intensity
         * @type {number}
         */
        this.intensity = options.intensity !== undefined ? options.intensity : 1.0;

        // Point/Spot light parameters
        /**
         * Range/distance of light effect (for point and spot lights)
         * @type {number}
         */
        this.range = options.range !== undefined ? options.range : 10;

        /**
         * Light decay factor
         * @type {number}
         */
        this.decay = options.decay !== undefined ? options.decay : 2;

        // Spot light parameters
        /**
         * Inner cone angle in radians (for spot lights)
         * @type {number}
         */
        this.innerConeAngle = options.innerConeAngle !== undefined ? options.innerConeAngle : Math.PI / 6;

        /**
         * Outer cone angle in radians (for spot lights)
         * @type {number}
         */
        this.outerConeAngle = options.outerConeAngle !== undefined ? options.outerConeAngle : Math.PI / 4;

        // Shadow parameters (placeholder)
        /**
         * Whether this light casts shadows
         * @type {boolean}
         */
        this.castShadows = options.castShadows !== undefined ? options.castShadows : false;

        /**
         * Shadow map size (placeholder)
         * @type {number}
         */
        this.shadowMapSize = options.shadowMapSize !== undefined ? options.shadowMapSize : 1024;
    }

    /**
     * Get node type
     * @returns {string}
     */
    getType() {
        return 'LightNode';
    }

    /**
     * Set light color
     * @param {number} r - red (0-1)
     * @param {number} g - green (0-1)
     * @param {number} b - blue (0-1)
     * @returns {LightNode} this
     */
    setColor(r, g, b) {
        this.color = [r, g, b];
        return this;
    }

    /**
     * Set light intensity
     * @param {number} intensity
     * @returns {LightNode} this
     */
    setIntensity(intensity) {
        this.intensity = intensity;
        return this;
    }

    /**
     * Set light range (for point and spot lights)
     * @param {number} range
     * @returns {LightNode} this
     */
    setRange(range) {
        this.range = range;
        return this;
    }

    /**
     * Set spot light angles
     * @param {number} innerAngle - inner cone angle in radians
     * @param {number} outerAngle - outer cone angle in radians
     * @returns {LightNode} this
     */
    setSpotAngles(innerAngle, outerAngle) {
        this.innerConeAngle = innerAngle;
        this.outerConeAngle = outerAngle;
        return this;
    }

    /**
     * Clone this light node
     * @returns {LightNode}
     */
    clone() {
        const cloned = new LightNode(this.name, {
            lightType: this.lightType,
            color: [...this.color],
            intensity: this.intensity,
            range: this.range,
            decay: this.decay,
            innerConeAngle: this.innerConeAngle,
            outerConeAngle: this.outerConeAngle,
            castShadows: this.castShadows,
            shadowMapSize: this.shadowMapSize
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
        json.lightType = this.lightType;
        json.color = this.color;
        json.intensity = this.intensity;
        json.range = this.range;
        json.decay = this.decay;
        json.innerConeAngle = this.innerConeAngle;
        json.outerConeAngle = this.outerConeAngle;
        json.castShadows = this.castShadows;
        json.shadowMapSize = this.shadowMapSize;
        return json;
    }
}
