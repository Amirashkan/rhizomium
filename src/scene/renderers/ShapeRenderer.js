/**
 * ShapeRenderer
 *
 * Renders a parametric shape with the compute texture applied directly on the
 * GPU: the fragment shader colors the surface from the texture, and the
 * vertex shader displaces vertices along their normals by the texture's
 * luminance. No CPU readback anywhere — the visualization is always live and
 * exactly as fast as the compute pipeline itself.
 */

export class ShapeRenderer {
    /**
     * @param {GPUDevice} device - WebGPU device
     */
    constructor(device) {
        this.device = device;

        this.pipeline = null;
        this.bindGroupLayout = null;

        // Static geometry buffers (re-uploaded only when the geometry changes)
        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.uvBuffer = null;
        this.indexBuffer = null;
        this._geometryRef = null;

        this.uniformBuffer = null;
        this.sampler = null;
        this.defaultTexture = null;

        this.initialized = false;
    }

    /**
     * Initialize renderer
     * @param {GPUTextureFormat} format - Render target format
     */
    initialize(format = 'bgra8unorm') {
        if (this.initialized) {
            return;
        }

        const module = this.device.createShaderModule({
            label: 'Shape Renderer Shader',
            code: this.getShaderCode()
        });

        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Shape Renderer Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                },
                {
                    // Field texture, sampled in BOTH stages (displacement + color)
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });

        this.pipeline = this.device.createRenderPipeline({
            label: 'Shape Renderer Pipeline',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
            vertex: {
                module,
                entryPoint: 'vs_main',
                buffers: [
                    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, // position
                    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }, // normal
                    { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }  // uv
                ]
            },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{ format }]
            },
            primitive: {
                topology: 'triangle-list',
                // Displaced surfaces are viewed from all sides in the orbit
                // viewport; culling just makes shapes vanish at odd angles
                cullMode: 'none'
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less'
            }
        });

        this.uniformBuffer = this.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat'
        });

        this.initialized = true;
    }

    /**
     * Upload geometry buffers when the (cached, immutable) geometry changes.
     * @private
     */
    _syncGeometry(geometry) {
        if (this._geometryRef === geometry) {
            return;
        }

        const upload = (existing, data, usage) => {
            if (existing) existing.destroy();
            const buffer = this.device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
            this.device.queue.writeBuffer(buffer, 0, data);
            return buffer;
        };

        this.vertexBuffer = upload(this.vertexBuffer, geometry.positions, GPUBufferUsage.VERTEX);
        this.normalBuffer = upload(this.normalBuffer, geometry.normals, GPUBufferUsage.VERTEX);
        this.uvBuffer = upload(this.uvBuffer, geometry.uvs, GPUBufferUsage.VERTEX);
        this.indexBuffer = upload(this.indexBuffer, geometry.indices, GPUBufferUsage.INDEX);
        this._geometryRef = geometry;
    }

    /**
     * Lazily create the 1x1 fallback texture used when no compute input is
     * connected (renders the bare lit shape instead of nothing).
     * @private
     */
    _getDefaultTexture() {
        if (!this.defaultTexture) {
            this.defaultTexture = this.device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });
            this.device.queue.writeTexture(
                { texture: this.defaultTexture },
                new Uint8Array([110, 118, 138, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1 }
            );
        }
        return this.defaultTexture;
    }

    /**
     * Render the shape.
     * @param {GPURenderPassEncoder} passEncoder
     * @param {Object} geometry - ShapeGeometry.get() result
     * @param {Mat4} viewMatrix
     * @param {Mat4} projectionMatrix
     * @param {Mat4} modelMatrix
     * @param {Object} options - { texture, displacementScale, textureAmount }
     */
    render(passEncoder, geometry, viewMatrix, projectionMatrix, modelMatrix, options = {}) {
        if (!this.initialized || !geometry || !geometry.vertexCount) {
            return;
        }

        this._syncGeometry(geometry);

        const uniformData = new Float32Array(64);
        uniformData.set(modelMatrix.elements, 0);
        uniformData.set(viewMatrix.elements, 16);
        uniformData.set(projectionMatrix.elements, 32);
        // Light direction + displacement scale
        uniformData.set([0.55, 0.75, 0.35], 48);
        uniformData[51] = options.displacementScale ?? 0.4;
        // How strongly the texture colors the surface (0 = plain lit shape)
        uniformData[52] = options.textureAmount ?? 1.0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        const texture = options.texture || this._getDefaultTexture();

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: texture.createView() },
                { binding: 2, resource: this.sampler }
            ]
        });

        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.normalBuffer);
        passEncoder.setVertexBuffer(2, this.uvBuffer);
        passEncoder.setIndexBuffer(this.indexBuffer, 'uint32');
        passEncoder.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
    }

    /**
     * @private
     */
    getShaderCode() {
        return `
            struct Uniforms {
                modelMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                projectionMatrix: mat4x4<f32>,
                lightDir: vec3<f32>,
                displacementScale: f32,
                textureAmount: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var fieldTexture: texture_2d<f32>;
            @group(0) @binding(2) var fieldSampler: sampler;

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldNormal: vec3<f32>,
                @location(1) uv: vec2<f32>,
                @location(2) height: f32,
            }

            fn fieldValue(uv: vec2<f32>) -> f32 {
                let s = textureSampleLevel(fieldTexture, fieldSampler, uv, 0.0);
                return dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114));
            }

            @vertex
            fn vs_main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;

                let value = fieldValue(input.uv);
                let displaced = input.position + input.normal * (value * uniforms.displacementScale);

                let worldPos = uniforms.modelMatrix * vec4<f32>(displaced, 1.0);
                output.position = uniforms.projectionMatrix * (uniforms.viewMatrix * worldPos);

                // Approximate the displaced normal from neighboring samples so
                // lighting shows the field's relief (exact for the plane,
                // a good local estimate for curved shapes)
                let e = vec2<f32>(1.0, 0.0) / 128.0;
                let dhdu = (fieldValue(input.uv + e.xy) - fieldValue(input.uv - e.xy)) * uniforms.displacementScale;
                let dhdv = (fieldValue(input.uv + e.yx) - fieldValue(input.uv - e.yx)) * uniforms.displacementScale;
                let bent = normalize(input.normal - vec3<f32>(dhdu, 0.0, dhdv) * 24.0);
                output.worldNormal = normalize((uniforms.modelMatrix * vec4<f32>(bent, 0.0)).xyz);

                output.uv = input.uv;
                output.height = value;
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                let texColor = textureSample(fieldTexture, fieldSampler, input.uv);

                let normal = normalize(input.worldNormal);
                let diffuse = max(dot(normal, normalize(uniforms.lightDir)), 0.0);
                let lighting = 0.35 + 0.65 * diffuse;

                // Blend between a neutral lit surface and the field's colors;
                // the small ambient lift keeps the silhouette visible even
                // when the field is black
                let base = vec3<f32>(0.62, 0.65, 0.72);
                var color = mix(base, texColor.rgb, uniforms.textureAmount);
                color = (color + vec3<f32>(0.05, 0.055, 0.07)) * lighting;

                return vec4<f32>(color, 1.0);
            }
        `;
    }

    /**
     * Destroy GPU resources
     */
    destroy() {
        if (this.vertexBuffer) this.vertexBuffer.destroy();
        if (this.normalBuffer) this.normalBuffer.destroy();
        if (this.uvBuffer) this.uvBuffer.destroy();
        if (this.indexBuffer) this.indexBuffer.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        if (this.defaultTexture) this.defaultTexture.destroy();

        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.uvBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this.defaultTexture = null;
        this._geometryRef = null;
        this.initialized = false;
    }
}
