/**
 * Test script to verify 3D viewport and mesh generation
 * Run this in the browser console after the editor loads
 */

import { MarchingCubes } from './src/scene/algorithms/MarchingCubes.js';

async function test3DVisualization() {
    console.log('=== Testing 3D Visualization System ===');

    // Check prerequisites
    const checks = {
        'GPURenderer': window.gpuRenderer,
        'Scene': window.systemIntegration?.scene,
        'Viewport3D': window.viewport3D,
        'ViewportPanel': window.viewportPanel,
        'SceneRenderer3D': window.sceneRenderer3D,
        'FieldMapperIntegration': window.fieldMapperIntegration
    };

    let allGood = true;
    for (const [name, obj] of Object.entries(checks)) {
        const status = obj ? '✓' : '✗';
        console.log(`   ${status} ${name}`);
        if (!obj) allGood = false;
    }

    if (!allGood) {
        console.error('❌ Some components are missing');
        return;
    }

    window.viewportPanel.show();

    try {
        const device = window.gpuRenderer?.device;
        if (!device) {
            console.error('   ✗ WebGPU device not available');
        } else {
            const cube = await window.addTestCubeToScene(window.systemIntegration.scene, device);
            console.log(`   ✓ Test cube added (${cube.geometry.vertexCount} vertices)`);
        }
    } catch (error) {
        console.error('   ✗ Failed to add test cube:', error);
    }

    try {
        window.sceneRenderer3D.render();
        console.log('   ✓ Scene rendered');
    } catch (error) {
        console.error('   ✗ Render failed:', error);
    }
    try {
        // Create a simple sphere field
        const dims = [16, 16, 16];
        const fieldData = new Float32Array(dims[0] * dims[1] * dims[2]);

        const center = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
        const radius = 5;

        for (let z = 0; z < dims[2]; z++) {
            for (let y = 0; y < dims[1]; y++) {
                for (let x = 0; x < dims[0]; x++) {
                    const dx = x - center[0];
                    const dy = y - center[1];
                    const dz = z - center[2];
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const idx = x + y * dims[0] + z * dims[0] * dims[1];
                    fieldData[idx] = radius - dist;
                }
            }
        }

        const mesh = MarchingCubes.generateMesh(
            fieldData,
            dims,
            0.0,
            { min: [-1, -1, -1], max: [1, 1, 1] }
        );

        console.log(`   ✓ Generated mesh (${mesh.vertexCount} vertices, ${mesh.indices.length / 3} triangles)`);
    } catch (error) {
        console.error('   ✗ Marching cubes test failed:', error);
    }

    console.log('=== Test Complete ===');
}

// Auto-run if loaded as module
if (typeof window !== 'undefined') {
    console.log('3D Visualization Test loaded. Run: test3DVisualization()');
    window.test3DVisualization = test3DVisualization;
}

export { test3DVisualization };
