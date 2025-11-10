/**
 * Helper script to show a test cube in the 3D viewport
 * This makes it easier to verify the viewport is working
 */

async function showTestCube() {
    // Check prerequisites
    if (!window.systemIntegration?.scene) {
        console.error('❌ Scene not available');
        return;
    }

    if (!window.addTestCubeToScene) {
        console.error('❌ addTestCubeToScene function not available');
        return;
    }

    if (!window.sceneRenderer3D) {
        console.error('❌ sceneRenderer3D not available');
        return;
    }

    if (!window.viewportPanel) {
        console.error('❌ viewportPanel not available');
        return;
    }

    try {
        window.viewportPanel.show();

        const device = window.gpuRenderer?.device;
        if (!device) {
            console.error('❌ WebGPU device not available');
            return;
        }

        const cube = await window.addTestCubeToScene(window.systemIntegration.scene, device);
        console.log(`✓ Cube added (${cube.geometry.vertexCount} vertices)`);

        window.sceneRenderer3D.render();
        console.log('✓ Rendered');

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

// Auto-expose
if (typeof window !== 'undefined') {
    window.showTestCube = showTestCube;
    console.log('Test cube helper loaded. Run: showTestCube()');
}

export { showTestCube };
