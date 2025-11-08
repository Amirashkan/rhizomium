/**
 * Field Visualization Example
 *
 * Demonstrates how to:
 * 1. Create a compute field from a compute shader
 * 2. Visualize it as point cloud or mesh
 * 3. Render it in the 3D scene
 */

import { Scene } from '../scene/Scene.js';
import { ComputeFieldMapperNode } from '../scene/nodes/ComputeFieldMapperNode.js';
import { ComputeNodeBase } from '../gpu/ComputeNodeBase.js';
import { CameraNode } from '../scene/nodes/CameraNode.js';
import { MeshNode } from '../scene/nodes/MeshNode.js';

/**
 * Example: Visualize a noise field as a point cloud
 */
export async function exampleNoisePointCloud(device, canvas) {
    console.log('=== Example: Noise Field Point Cloud ===');

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

    console.log('Scene created with noise field point cloud');

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

    console.log(`Generated ${geometry.vertexCount} points`);

    // Submit command buffer
    device.queue.submit([encoder.finish()]);

    return geometry;
}

/**
 * Example: Create a mesh visualization from a 3D field
 */
export async function exampleMeshVisualization(device, canvas) {
    console.log('=== Example: 3D Field Mesh Visualization ===');

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

    console.log('Scene created with mesh visualization');

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
 * Usage example:
 *
 * // In your main application:
 * const device = await navigator.gpu.requestAdapter().then(a => a.requestDevice());
 * const canvas = document.querySelector('canvas');
 *
 * // Create and run the example
 * const example = new AnimatedFieldExample(device, canvas);
 * await example.initialize();
 *
 * // In your render loop:
 * function animate(time) {
 *     example.update(time * 0.001);
 *     // Render the scene
 *     requestAnimationFrame(animate);
 * }
 * requestAnimationFrame(animate);
 */
