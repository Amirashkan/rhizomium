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
     * Describe how to read the red channel out of a texture format.
     * @param {string} format - GPUTextureFormat
     * @returns {{bytesPerTexel: number, kind: 'uint8'|'float32', redOffset: number}|null}
     */
    static getFormatInfo(format) {
        switch (format) {
            case 'rgba8unorm':
            case 'rgba8unorm-srgb':
                return { bytesPerTexel: 4, kind: 'uint8', redOffset: 0 };
            case 'bgra8unorm':
            case 'bgra8unorm-srgb':
                return { bytesPerTexel: 4, kind: 'uint8', redOffset: 2 };
            case 'r32float':
                return { bytesPerTexel: 4, kind: 'float32', redOffset: 0 };
            case 'rg32float':
                return { bytesPerTexel: 8, kind: 'float32', redOffset: 0 };
            case 'rgba32float':
                return { bytesPerTexel: 16, kind: 'float32', redOffset: 0 };
            default:
                return null;
        }
    }

    /**
     * Extract a normalized [0,1] field grid from raw texture readback bytes.
     * Handles the 256-byte bytesPerRow alignment padding and nearest-samples
     * the texture down (or up) to the requested grid size.
     *
     * @param {ArrayBuffer|Uint8Array} rawBytes - Mapped readback bytes
     * @param {number} texWidth - Actual texture width in texels
     * @param {number} texHeight - Actual texture height in texels
     * @param {number} bytesPerRow - Row stride used for the copy (256-aligned)
     * @param {Object} formatInfo - Result of getFormatInfo()
     * @param {number} gridW - Output grid width
     * @param {number} gridH - Output grid height
     * @returns {Float32Array} gridW * gridH field values in [0,1]
     */
    static extractFieldFromBytes(rawBytes, texWidth, texHeight, bytesPerRow, formatInfo, gridW, gridH) {
        const buffer = rawBytes instanceof Uint8Array
            ? rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength)
            : rawBytes;
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        const { bytesPerTexel, kind, redOffset } = formatInfo;

        const fieldData = new Float32Array(gridW * gridH);

        for (let gy = 0; gy < gridH; gy++) {
            // Nearest sampling from the texture grid onto the requested grid
            const ty = Math.min(texHeight - 1, Math.floor(((gy + 0.5) * texHeight) / gridH));
            const rowOffset = ty * bytesPerRow;

            for (let gx = 0; gx < gridW; gx++) {
                const tx = Math.min(texWidth - 1, Math.floor(((gx + 0.5) * texWidth) / gridW));
                const byteOffset = rowOffset + tx * bytesPerTexel + redOffset;

                let value;
                if (kind === 'uint8') {
                    value = bytes[byteOffset] / 255.0;
                } else {
                    value = view.getFloat32(byteOffset, true);
                }

                fieldData[gy * gridW + gx] = value;
            }
        }

        return fieldData;
    }

    /**
     * Read one 2D texture (or one slice of a 3D texture) back to the CPU and
     * extract its red channel as a normalized field grid.
     *
     * @param {GPUTexture} texture - Source texture
     * @param {GPUDevice} device - WebGPU device
     * @param {number} gridW - Output grid width
     * @param {number} gridH - Output grid height
     * @param {number} sliceZ - Depth slice to read (for 3D textures)
     * @returns {Promise<Float32Array|null>} Field data, or null for unsupported formats
     */
    static async readFieldSlice(texture, device, gridW, gridH, sliceZ = 0) {
        const formatInfo = this.getFormatInfo(texture.format);
        if (!formatInfo) {
            return null;
        }

        const texW = texture.width;
        const texH = texture.height;
        const bytesPerRow = Math.ceil((texW * formatInfo.bytesPerTexel) / 256) * 256;

        const buffer = device.createBuffer({
            size: bytesPerRow * texH,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        try {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer(
                { texture, origin: { x: 0, y: 0, z: sliceZ } },
                { buffer, bytesPerRow },
                { width: texW, height: texH, depthOrArrayLayers: 1 }
            );
            device.queue.submit([encoder.finish()]);

            await buffer.mapAsync(GPUMapMode.READ);
            const mapped = new Uint8Array(buffer.getMappedRange());
            const fieldData = this.extractFieldFromBytes(
                mapped, texW, texH, bytesPerRow, formatInfo, gridW, gridH
            );
            buffer.unmap();
            return fieldData;
        } finally {
            buffer.destroy();
        }
    }

    /**
     * Generate point cloud from texture (requires GPU texture readback)
     * @param {GPUTexture} texture - Input texture
     * @param {GPUDevice} device - WebGPU device
     * @param {number[]} dimensions - [width, height] sampling grid
     * @param {Object} options - Generation options
     * @returns {Promise<Object>} Point cloud geometry
     */
    static async generateFromTexture(texture, device, dimensions, options = {}) {
        const [w, h] = dimensions;

        const fieldData = await this.readFieldSlice(texture, device, w, h);
        if (!fieldData) {
            return { positions: new Float32Array(0), colors: new Float32Array(0), vertexCount: 0 };
        }

        // Generate point cloud from field data
        return this.generate(fieldData, [w, h, 1], { ...options, is3D: false });
    }

    /**
     * Generate point cloud from 3D texture (requires GPU texture readback)
     * @param {GPUTexture} texture - Input 3D texture
     * @param {GPUDevice} device - WebGPU device
     * @param {number[]} dimensions - [width, height, depth] sampling grid
     * @param {Object} options - Generation options
     * @returns {Promise<Object>} Point cloud geometry
     */
    static async generateFromTexture3D(texture, device, dimensions, options = {}) {
        const [w, h, d] = dimensions;

        const fieldData = await this.readTextureData3D(texture, device, [w, h, d]);
        if (!fieldData) {
            return { positions: new Float32Array(0), colors: new Float32Array(0), vertexCount: 0 };
        }

        // Generate point cloud from 3D field data
        return this.generate(fieldData, [w, h, d], { ...options, is3D: true });
    }

    /**
     * Read field data from 3D texture into a Float32Array
     * @param {GPUTexture} texture - Input 3D texture
     * @param {GPUDevice} device - WebGPU device
     * @param {number[]} dimensions - [width, height, depth] sampling grid
     * @returns {Promise<Float32Array|null>} Field data, or null for unsupported formats
     */
    static async readTextureData3D(texture, device, dimensions) {
        const [w, h, d] = dimensions;
        const texDepth = texture.depthOrArrayLayers || 1;

        const fieldData = new Float32Array(w * h * d);

        for (let z = 0; z < d; z++) {
            const sliceZ = Math.min(texDepth - 1, Math.floor(((z + 0.5) * texDepth) / d));
            const slice = await this.readFieldSlice(texture, device, w, h, sliceZ);
            if (!slice) {
                return null;
            }
            fieldData.set(slice, z * w * h);
        }

        return fieldData;
    }
}
