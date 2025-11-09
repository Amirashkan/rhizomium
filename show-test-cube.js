/**
 * Helper script to show a test cube in the 3D viewport
 * This makes it easier to verify the viewport is working
 */

async function showTestCube() {
    console.log('=== Adding Test Cube ===');

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
        // Show viewport
        console.log('1. Showing 3D viewport...');
        window.viewportPanel.show();

        // Add test cube
        console.log('2. Adding test cube...');
        const cube = await window.addTestCubeToScene(window.systemIntegration.scene);
        console.log(`   ✓ Cube added: ${cube.geometry.vertexCount} vertices`);

        // Render
        console.log('3. Rendering scene...');
        window.sceneRenderer3D.render();
        console.log('   ✓ Rendered');

        console.log('\n✅ Done! You should see a rotating cube in the 3D viewport.');
        console.log('💡 If you don\'t see it, check that the viewport is visible (blue canvas area)');

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
