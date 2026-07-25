/**
 * Field Visualization Example
 *
 * Demonstrates how to:
 * 1. Create a compute field from a compute shader
 * 2. Visualize it as point cloud or mesh
 * 3. Render it in the 3D scene
 * 4. Use reactive parameter updates for real-time visualization
 */

import { Scene } from '../scene/Scene.js';
import { ComputeFieldMapperNode } from '../scene/nodes/ComputeFieldMapperNode.js';
import { ComputeNodeBase } from '../gpu/ComputeNodeBase.js';
import { CameraNode } from '../scene/nodes/CameraNode.js';
import { FieldVisualizerManager } from '../scene/FieldVisualizerManager.js';

/**
 * Example: Visualize a noise field as a point cloud
 */
export async function exampleNoisePointCloud(device, canvas) {

    // Create scene
    const scene = new Scene();

    // Create camera
    const camera = new CameraNode('MainCamera');
    camera.setPerspective(60, canvas.width / canvas.height, 0.1, 100);
    camera.transform.position = [0, 0, 3];
    camera.lookAt([0, 0, 0], [0, 1, 0]);
    scene.addNode(camera);

    // Create compute noise node
    const computeNode = new ComputeNodeBase(device, {
        id: 'NoiseField_1',
        kind: 'ComputeNoise',
        params: {
            scale: 2.0,
            octaves: 4,
            lacunarity: 2.0,
            gain: 0.5,
            time: 0
        }
    });

    // Initialize with WGSL shader (simplified noise shader)
    const noiseShader = `
        struct Params {
            time: f32,
            scale: f32,
            octaves: u32,
            lacunarity: f32,
            gain: f32,
        }

        @group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, write>;
        @group(0) @binding(1) var<uniform> params: Params;

        // Simple noise function (placeholder)
        fn noise(p: vec2<f32>) -> f32 {
            return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
        }

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
            let texSize = textureDimensions(outputTexture);
            if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
                return;
            }

            let uv = vec2<f32>(f32(global_id.x), f32(global_id.y)) / vec2<f32>(f32(texSize.x), f32(texSize.y));
            let p = uv * params.scale + vec2<f32>(params.time * 0.1);

            // Multi-octave noise
            var value = 0.0;
            var amplitude = 1.0;
            var frequency = 1.0;

            for (var i = 0u; i < params.octaves; i++) {
                value += noise(p * frequency) * amplitude;
                frequency *= params.lacunarity;
                amplitude *= params.gain;
            }

            value = clamp(value, 0.0, 1.0);

            textureStore(outputTexture, vec2<i32>(global_id.xy), vec4<f32>(value, value, value, 1.0));
        }
    `;

    await computeNode.initialize(noiseShader, 256, 256, false);

    // Create compute field mapper node
    const fieldMapper = new ComputeFieldMapperNode('NoiseField', {
        dimensions: [256, 256, 1],
        mappingMode: 'points',
        fieldBounds: {
            min: [-2, -2, 0],
            max: [2, 2, 0]
        },
        isoThreshold: 0.5
    });

    // Link compute shader
    fieldMapper.setComputeShader(computeNode);

    // Set visualization parameters
    fieldMapper.setVisualizationParam('threshold', 0.3);
    fieldMapper.setVisualizationParam('pointSize', 0.01);
    fieldMapper.setVisualizationParam('colorMode', 'gradient');
    fieldMapper.setVisualizationParam('colorA', [0.1, 0.2, 0.8, 1.0]);
    fieldMapper.setVisualizationParam('colorB', [0.8, 0.2, 0.1, 1.0]);
    fieldMapper.setVisualizationParam('displacementScale', 0.5);
    fieldMapper.setVisualizationParam('displacementAxis', [0, 0, 1]);

    // Initialize visualizer
    await fieldMapper.initializeVisualizer(device);

    // Add to scene
    scene.addNode(fieldMapper);

    return { scene, camera, computeNode, fieldMapper };
}

/**
 * Example: Update and render the field visualization
 */
export async function updateFieldVisualization(fieldMapper, computeNode, device, time) {
    // Update compute shader parameters
    computeNode.setUniform('time', time);

    // Dispatch compute shader
    const encoder = device.createCommandEncoder();
    computeNode.dispatch(device, encoder, time);

    // Get output texture
    const fieldTexture = computeNode.getOutputTexture();

    // Generate visualization
    await fieldMapper.generateVisualization(fieldTexture);

    // Get geometry for rendering
    const geometry = fieldMapper.getGeometry();

    // Submit command buffer
    device.queue.submit([encoder.finish()]);

    return geometry;
}

/**
 * Example: Create a mesh visualization from a 3D field
 */
export async function exampleMeshVisualization(device, canvas) {

    // Create scene
    const scene = new Scene();

    // Create camera
    const camera = new CameraNode('MainCamera');
    camera.setPerspective(60, canvas.width / canvas.height, 0.1, 100);
    camera.transform.position = [0, 0, 5];
    camera.lookAt([0, 0, 0], [0, 1, 0]);
    scene.addNode(camera);

    // Create compute field mapper for mesh
    const fieldMapper = new ComputeFieldMapperNode('VolumeField', {
        dimensions: [64, 64, 64],
        mappingMode: 'surface',
        fieldBounds: {
            min: [-1, -1, -1],
            max: [1, 1, 1]
        },
        isoThreshold: 0.5
    });

    // Set visualization parameters
    fieldMapper.setVisualizationParam('colorMode', 'solid');
    fieldMapper.setVisualizationParam('solidColor', [0.8, 0.8, 0.9, 1.0]);

    // Add to scene
    scene.addNode(fieldMapper);

    return { scene, camera, fieldMapper };
}

/**
 * Example: Animated field with varying parameters
 */
export class AnimatedFieldExample {
    constructor(device, canvas) {
        this.device = device;
        this.canvas = canvas;
        this.time = 0;
        this.scene = null;
        this.camera = null;
        this.computeNode = null;
        this.fieldMapper = null;
    }

    async initialize() {
        const result = await exampleNoisePointCloud(this.device, this.canvas);
        this.scene = result.scene;
        this.camera = result.camera;
        this.computeNode = result.computeNode;
        this.fieldMapper = result.fieldMapper;
    }

    async update(deltaTime) {
        this.time += deltaTime;

        // Animate visualization parameters
        const threshold = 0.3 + Math.sin(this.time * 0.5) * 0.2;
        const displacementScale = 0.5 + Math.cos(this.time * 0.3) * 0.3;

        this.fieldMapper.setVisualizationParam('threshold', threshold);
        this.fieldMapper.setVisualizationParam('displacementScale', displacementScale);

        // Update field visualization
        await updateFieldVisualization(
            this.fieldMapper,
            this.computeNode,
            this.device,
            this.time
        );
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }
}

/**
 * Example: Using FieldVisualizerManager for automatic real-time updates
 */
export class ReactiveFieldExample {
    constructor(device, canvas) {
        this.device = device;
        this.canvas = canvas;
        this.time = 0;

        // Create field visualizer manager with event system
        this.manager = new FieldVisualizerManager(device);
        this.eventSystem = this.manager.getEventSystem();

        this.scene = null;
        this.camera = null;
        this.computeNode = null;
        this.fieldMapper = null;
    }

    async initialize() {

        // Create scene
        this.scene = new Scene();

        // Create camera
        this.camera = new CameraNode('MainCamera');
        this.camera.setPerspective(60, this.canvas.width / this.canvas.height, 0.1, 100);
        this.camera.transform.position = [0, 0, 3];
        this.camera.lookAt([0, 0, 0], [0, 1, 0]);
        this.scene.addNode(this.camera);

        // Create compute noise node
        this.computeNode = new ComputeNodeBase(this.device, {
            id: 'NoiseField_1',
            kind: 'ComputeNoise',
            params: {
                scale: 2.0,
                octaves: 4,
                lacunarity: 2.0,
                gain: 0.5,
                time: 0
            }
        });

        // Initialize with WGSL shader
        const noiseShader = `
            struct Params {
                time: f32,
                scale: f32,
                octaves: u32,
                lacunarity: f32,
                gain: f32,
            }

            @group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, write>;
            @group(0) @binding(1) var<uniform> params: Params;

            fn noise(p: vec2<f32>) -> f32 {
                return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
            }

            @compute @workgroup_size(8, 8)
            fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let texSize = textureDimensions(outputTexture);
                if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
                    return;
                }

                let uv = vec2<f32>(f32(global_id.x), f32(global_id.y)) / vec2<f32>(f32(texSize.x), f32(texSize.y));
                let p = uv * params.scale + vec2<f32>(params.time * 0.1);

                var value = 0.0;
                var amplitude = 1.0;
                var frequency = 1.0;

                for (var i = 0u; i < params.octaves; i++) {
                    value += noise(p * frequency) * amplitude;
                    frequency *= params.lacunarity;
                    amplitude *= params.gain;
                }

                value = clamp(value, 0.0, 1.0);
                textureStore(outputTexture, vec2<i32>(global_id.xy), vec4<f32>(value, value, value, 1.0));
            }
        `;

        await this.computeNode.initialize(noiseShader, 256, 256, false);

        // Create field mapper WITH event system
        this.fieldMapper = new ComputeFieldMapperNode('NoiseField', {
            dimensions: [256, 256, 1],
            mappingMode: 'points',
            fieldBounds: {
                min: [-2, -2, 0],
                max: [2, 2, 0]
            },
            isoThreshold: 0.5,
            eventSystem: this.eventSystem  // Important: pass event system!
        });

        // Link compute shader
        this.fieldMapper.setComputeShader(this.computeNode);

        // Set initial visualization parameters
        this.fieldMapper.setVisualizationParam('threshold', 0.3);
        this.fieldMapper.setVisualizationParam('pointSize', 0.01);
        this.fieldMapper.setVisualizationParam('colorMode', 'gradient');
        this.fieldMapper.setVisualizationParam('colorA', [0.1, 0.2, 0.8, 1.0]);
        this.fieldMapper.setVisualizationParam('colorB', [0.8, 0.2, 0.1, 1.0]);
        this.fieldMapper.setVisualizationParam('displacementScale', 0.5);
        this.fieldMapper.setVisualizationParam('displacementAxis', [0, 0, 1]);

        // Initialize visualizer
        await this.fieldMapper.initializeVisualizer(this.device);

        // Register with manager for automatic updates
        this.manager.registerFieldMapper('NoiseField', this.fieldMapper, this.computeNode);

        // Add to scene
        this.scene.addNode(this.fieldMapper);

    }

    async update(deltaTime) {
        this.time += deltaTime;

        // Update compute shader time uniform
        this.manager.updateComputeShader('NoiseField', { time: this.time });

        // Animate parameters using the event system
        // These will automatically trigger visualization regeneration!
        const threshold = 0.3 + Math.sin(this.time * 0.5) * 0.2;
        const displacementScale = 0.5 + Math.cos(this.time * 0.3) * 0.3;

        this.manager.updateParameter('NoiseField', 'threshold', threshold);
        this.manager.updateParameter('NoiseField', 'displacementScale', displacementScale);

        // Process pending updates - this will automatically regenerate
        // visualizations for any field mappers with changed parameters
        const updatedGeometries = await this.manager.processPendingUpdates(this.time);

        return updatedGeometries;
    }

    /**
     * Example: Update parameter via UI slider
     */
    handleSliderChange(parameterName, value) {
        // Simply update the parameter - the visualization will automatically regenerate!
        this.manager.updateParameter('NoiseField', parameterName, value);
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }

    getManager() {
        return this.manager;
    }

    dispose() {
        this.manager.dispose();
    }
}

/**
 * Example: Manual UI integration for parameter sliders
 */
export function setupUISliders(reactiveExample) {
    // Example slider setup (assuming HTML sliders exist)

    // Threshold slider
    const thresholdSlider = document.getElementById('threshold-slider');
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            reactiveExample.handleSliderChange('threshold', value);
        });
    }

    // Point size slider
    const pointSizeSlider = document.getElementById('pointsize-slider');
    if (pointSizeSlider) {
        pointSizeSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            reactiveExample.handleSliderChange('pointSize', value);
        });
    }

    // Displacement scale slider
    const displacementSlider = document.getElementById('displacement-slider');
    if (displacementSlider) {
        displacementSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            reactiveExample.handleSliderChange('displacementScale', value);
        });
    }

    // Color mode dropdown
    const colorModeSelect = document.getElementById('colormode-select');
    if (colorModeSelect) {
        colorModeSelect.addEventListener('change', (e) => {
            reactiveExample.handleSliderChange('colorMode', e.target.value);
        });
    }
}

/**
 * Usage example:
 *
 * // In your main application:
 * const device = await navigator.gpu.requestAdapter().then(a => a.requestDevice());
 * const canvas = document.querySelector('canvas');
 *
 * // Create and run the example (OLD WAY - manual updates)
 * const example = new AnimatedFieldExample(device, canvas);
 * await example.initialize();
 *
 * // Or use the NEW REACTIVE way with automatic updates:
 * const reactiveExample = new ReactiveFieldExample(device, canvas);
 * await reactiveExample.initialize();
 *
 * // Setup UI sliders (optional)
 * setupUISliders(reactiveExample);
 *
 * // In your render loop:
 * function animate(time) {
 *     // Reactive example - automatically handles parameter changes
 *     await reactiveExample.update(time * 0.001);
 *
 *     // Render the scene
 *     requestAnimationFrame(animate);
 * }
 * requestAnimationFrame(animate);
 *
 * // Now when you change parameters via UI or code, the 3D visualization
 * // will automatically regenerate in real-time!
 */
