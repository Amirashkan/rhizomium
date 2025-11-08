/**
 * PointCloudGenerator
 *
 * Generates point cloud geometry from 2D/3D field data
 */

export class PointCloudGenerator {
    /**
     * Generate point cloud from field data
     * @param {Float32Array|Uint8Array} fieldData - Field data
     * @param {number[]} dimensions - [width, height, depth] (depth=1 for 2D)
     * @param {Object} options - Generation options
     * @returns {Object} Point cloud geometry
     */
    static generate(fieldData, dimensions, options = {}) {
        const {
            threshold = 0.5,
            sampleRate = 1,
            bounds = { min: [-1, -1, -1], max: [1, 1, 1] },
            colorMode = 'gradient',
            colorScale = [0.0, 1.0],
            colorA = [0.2, 0.4, 1.0, 1.0],
            colorB = [1.0, 0.4, 0.2, 1.0],
            solidColor = [1.0, 1.0, 1.0, 1.0],
            displacementScale = 0.0,
            displacementAxis = [0, 1, 0],
            is3D = false
        } = options;

        const [w, h, d = 1] = dimensions;
        const positions = [];
        const colors = [];

        const { min, max } = bounds;

        // Generate points
        for (let z = 0; z < d; z += sampleRate) {
            for (let y = 0; y < h; y += sampleRate) {
                for (let x = 0; x < w; x += sampleRate) {
                    const idx = is3D
                        ? (x + y * w + z * w * h)
                        : (x + y * w);

                    let value = fieldData[idx];

                    // Normalize if Uint8Array
                    if (fieldData instanceof Uint8Array) {
                        value = value / 255.0;
                    }

                    if (value > threshold) {
                        // Map to world space
                        const tx = x / w;
                        const ty = y / h;
                        const tz = is3D ? z / d : 0;

                        let worldX = min[0] + tx * (max[0] - min[0]);
                        let worldY = min[1] + ty * (max[1] - min[1]);
                        let worldZ = min[2] + tz * (max[2] - min[2]);

                        // Apply displacement
                        if (displacementScale !== 0) {
                            const disp = value * displacementScale;
                            worldX += displacementAxis[0] * disp;
                            worldY += displacementAxis[1] * disp;
                            worldZ += displacementAxis[2] * disp;
                        }

                        positions.push(worldX, worldY, worldZ);

                        // Calculate color
                        const color = this.calculateColor(
                            value,
                            colorMode,
                            colorScale,
                            colorA,
                            colorB,
                            solidColor
                        );
                        colors.push(...color);
                    }
                }
            }
        }

        return {
            positions: new Float32Array(positions),
            colors: new Float32Array(colors),
            vertexCount: positions.length / 3
        };
    }

    /**
     * Calculate color based on field value
     * @private
     */
    static calculateColor(value, mode, scale, colorA, colorB, solidColor) {
        if (mode === 'solid') {
            return solidColor;
        }

        // Normalize value to 0-1 range
        const t = (value - scale[0]) / (scale[1] - scale[0]);
        const clamped = Math.max(0, Math.min(1, t));

        if (mode === 'gradient' || mode === 'field') {
            // Interpolate between colorA and colorB
            return [
                colorA[0] + (colorB[0] - colorA[0]) * clamped,
                colorA[1] + (colorB[1] - colorA[1]) * clamped,
                colorA[2] + (colorB[2] - colorA[2]) * clamped,
                colorA[3] + (colorB[3] - colorA[3]) * clamped
            ];
        }

        return [1, 1, 1, 1];
    }

    /**
     * Generate point cloud from texture (requires GPU texture readback)
     * @param {GPUTexture} texture - Input texture
     * @param {GPUDevice} device - WebGPU device
     * @param {number[]} dimensions - [width, height]
     * @param {Object} options - Generation options
     * @returns {Promise<Object>} Point cloud geometry
     */
    static async generateFromTexture(texture, device, dimensions, options = {}) {
        const [w, h] = dimensions;

        // Create readback buffer
        const bytesPerRow = Math.ceil(w * 4 * 4 / 256) * 256; // RGBA32Float, aligned to 256
        const buffer = device.createBuffer({
            size: bytesPerRow * h,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        // Copy texture to buffer
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
            { texture },
            { buffer, bytesPerRow },
            { width: w, height: h }
        );
        device.queue.submit([encoder.finish()]);

        // Read data
        await buffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(buffer.getMappedRange());

        // Extract channel data (use red channel)
        const fieldData = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            fieldData[i] = data[i * 4]; // Red channel
        }

        buffer.unmap();
        buffer.destroy();

        // Generate point cloud from field data
        return this.generate(fieldData, [w, h, 1], options);
    }
}
