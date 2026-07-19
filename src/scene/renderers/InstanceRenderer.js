/**
 * InstanceRenderer
 *
 * Instanced field mode: a grid of small meshes (cube/sphere/billboard quad),
 * one per field cell, entirely GPU-driven. The vertex shader derives each
 * instance's cell from @builtin(instance_index), samples the field texture
 * at that cell for height, size and color, and hides cells below the
 * threshold - no per-instance buffers and no CPU readback anywhere.
 */

export class InstanceRenderer {
    /**
     * @param {GPUDevice} device - WebGPU device
     */
    constructor(device) {
        this.device = device;

        this.pipeline = null;
        this.bindGroupLayout = null;

        // Instance mesh buffers (re-uploaded only when the mesh changes)
        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.uvBuffer = null;
        this.indexBuffer = null;
        this._meshRef = null;

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
            label: 'Instance Renderer Shader',
            code: this.getShaderCode()
        });

        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Instance Renderer Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    texture: { sampleType: 'float' }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX,
                    sampler: { type: 'filtering' }
                }
            ]
        });

        this.pipeline = this.device.createRenderPipeline({
            label: 'Instance Renderer Pipeline',
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
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        });

        this.initialized = true;
    }

    /**
     * @private
     */
    _syncMesh(mesh) {
        if (this._meshRef === mesh) {
            return;
        }

        const upload = (existing, data, usage) => {
            if (existing) existing.destroy();
            const buffer = this.device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
            this.device.queue.writeBuffer(buffer, 0, data);
            return buffer;
        };

        this.vertexBuffer = upload(this.vertexBuffer, mesh.positions, GPUBufferUsage.VERTEX);
        this.normalBuffer = upload(this.normalBuffer, mesh.normals, GPUBufferUsage.VERTEX);
        this.uvBuffer = upload(this.uvBuffer, mesh.uvs, GPUBufferUsage.VERTEX);
        this.indexBuffer = upload(this.indexBuffer, mesh.indices, GPUBufferUsage.INDEX);
        this._meshRef = mesh;
    }

    /**
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
                new Uint8Array([120, 128, 148, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1 }
            );
        }
        return this.defaultTexture;
    }

    /**
     * Render the instanced field.
     * @param {GPURenderPassEncoder} passEncoder
     * @param {Object} mesh - ShapeGeometry.getInstanceMesh() result
     * @param {Mat4} viewMatrix
     * @param {Mat4} projectionMatrix
     * @param {Mat4} modelMatrix
     * @param {Object} options - { texture, gridCount, instanceSize, sizeByField,
     *                             threshold, heightScale, textureAmount, billboard }
     */
    render(passEncoder, mesh, viewMatrix, projectionMatrix, modelMatrix, options = {}) {
        if (!this.initialized || !mesh || !mesh.vertexCount) {
            return;
        }

        this._syncMesh(mesh);

        const grid = Math.max(2, Math.min(160, Math.round(options.gridCount ?? 48)));

        const uniformData = new Float32Array(64);
        uniformData.set(modelMatrix.elements, 0);
        uniformData.set(viewMatrix.elements, 16);
        uniformData.set(projectionMatrix.elements, 32);
        uniformData.set([0.55, 0.75, 0.35], 48);        // lightDir
        uniformData[51] = options.instanceSize ?? 0.03;
        uniformData[52] = grid;                          // gridX
        uniformData[53] = grid;                          // gridY
        uniformData[54] = options.threshold ?? 0.15;
        uniformData[55] = options.sizeByField ?? 0.6;
        uniformData[56] = options.heightScale ?? 0.4;
        uniformData[57] = options.textureAmount ?? 1.0;
        uniformData[58] = options.billboard ? 1.0 : 0.0;
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
        passEncoder.drawIndexed(mesh.indexCount, grid * grid, 0, 0, 0);
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
                instanceSize: f32,
                grid: vec2<f32>,
                threshold: f32,
                sizeByField: f32,
                heightScale: f32,
                textureAmount: f32,
                billboard: f32,
                _pad: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var fieldTexture: texture_2d<f32>;
            @group(0) @binding(2) var fieldSampler: sampler;

            struct VertexInput {
                @builtin(instance_index) instanceIndex: u32,
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) color: vec3<f32>,
                @location(1) worldNormal: vec3<f32>,
                @location(2) local: vec2<f32>,
                @location(3) billboard: f32,
            }

            @vertex
            fn vs_main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;

                // Derive this instance's field cell from its index
                let gx = u32(uniforms.grid.x);
                let cell = vec2<f32>(f32(input.instanceIndex % gx), f32(input.instanceIndex / gx));
                let fuv = (cell + 0.5) / uniforms.grid;

                let s = textureSampleLevel(fieldTexture, fieldSampler, fuv, 0.0);
                let value = dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114));

                // Hide cells below the threshold by collapsing them
                let visible = select(0.0, 1.0, value >= uniforms.threshold);
                let size = uniforms.instanceSize * mix(1.0, value, uniforms.sizeByField) * visible;

                // Cell center on the XZ grid, lifted by the field value
                let center = vec3<f32>(fuv.x * 2.0 - 1.0, value * uniforms.heightScale, fuv.y * 2.0 - 1.0);

                if (uniforms.billboard > 0.5) {
                    // Camera-facing quad: expand in view space
                    let worldCenter = uniforms.modelMatrix * vec4<f32>(center, 1.0);
                    var viewPos = uniforms.viewMatrix * worldCenter;
                    viewPos = vec4<f32>(viewPos.xy + input.position.xy * size, viewPos.z, viewPos.w);
                    output.position = uniforms.projectionMatrix * viewPos;
                    output.worldNormal = vec3<f32>(0.0, 0.0, 1.0);
                } else {
                    let local = center + input.position * size;
                    let worldPos = uniforms.modelMatrix * vec4<f32>(local, 1.0);
                    output.position = uniforms.projectionMatrix * (uniforms.viewMatrix * worldPos);
                    output.worldNormal = normalize((uniforms.modelMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                }

                let base = vec3<f32>(0.62, 0.65, 0.72);
                output.color = mix(base, s.rgb, uniforms.textureAmount) + vec3<f32>(0.05, 0.055, 0.07);
                output.local = input.position.xy;
                output.billboard = uniforms.billboard;
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                if (input.billboard > 0.5) {
                    // Round, softly-shaded points
                    let dist = length(input.local);
                    if (dist > 1.0) {
                        discard;
                    }
                    let shade = 1.0 - 0.35 * dist * dist;
                    return vec4<f32>(input.color * shade, 1.0);
                }

                let normal = normalize(input.worldNormal);
                let diffuse = max(dot(normal, normalize(uniforms.lightDir)), 0.0);
                let lighting = 0.35 + 0.65 * diffuse;
                return vec4<f32>(input.color * lighting, 1.0);
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
        this._meshRef = null;
        this.initialized = false;
    }
}
