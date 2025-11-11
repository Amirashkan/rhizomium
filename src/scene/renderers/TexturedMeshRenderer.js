/**
 * TexturedMeshRenderer
 *
 * Extends MeshRenderer to support texture mapping from node outputs
 * Allows rendering meshes with textures generated from the node graph
 */

export class TexturedMeshRenderer {
    /**
     * @param {GPUDevice} device - WebGPU device
     */
    constructor(device) {
        this.device = device;

        this.pipeline = null;
        this.bindGroupLayout = null;
        this.pipelineLayout = null;

        // GPU buffers
        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.colorBuffer = null;
        this.uvBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;

        // Texture resources
        this.texture = null;
        this.sampler = null;

        // Shader modules
        this.vertexShader = null;
        this.fragmentShader = null;

        this.initialized = false;
    }

    /**
     * Initialize renderer
     * @param {GPUTextureFormat} format - Render target format
     */
    async initialize(format = 'bgra8unorm') {
        if (this.initialized) {
            return;
        }

        // Create default sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat'
        });

        // Create shader modules
        this.vertexShader = this.device.createShaderModule({
            label: 'Textured Mesh Vertex Shader',
            code: this.getVertexShaderCode()
        });

        this.fragmentShader = this.device.createShaderModule({
            label: 'Textured Mesh Fragment Shader',
            code: this.getFragmentShaderCode()
        });

        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Textured Mesh Bind Group Layout',
            entries: [
                {
                    // Uniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                },
                {
                    // Texture
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' }
                },
                {
                    // Sampler
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });

        // Create pipeline layout
        this.pipelineLayout = this.device.createPipelineLayout({
            label: 'Textured Mesh Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout]
        });

        // Create render pipeline
        this.pipeline = this.device.createRenderPipeline({
            label: 'Textured Mesh Render Pipeline',
            layout: this.pipelineLayout,
            vertex: {
                module: this.vertexShader,
                entryPoint: 'main',
                buffers: [
                    {
                        // Position buffer
                        arrayStride: 12, // 3 floats
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: 'float32x3'
                            }
                        ]
                    },
                    {
                        // Normal buffer
                        arrayStride: 12, // 3 floats
                        attributes: [
                            {
                                shaderLocation: 1,
                                offset: 0,
                                format: 'float32x3'
                            }
                        ]
                    },
                    {
                        // UV buffer
                        arrayStride: 8, // 2 floats
                        attributes: [
                            {
                                shaderLocation: 2,
                                offset: 0,
                                format: 'float32x2'
                            }
                        ]
                    }
                ]
            },
            fragment: {
                module: this.fragmentShader,
                entryPoint: 'main',
                targets: [
                    {
                        format,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }
                ]
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw'
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less'
            }
        });

        // Create uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 256, // Enough for matrices and params
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.initialized = true;

    }

    /**
     * Set texture from node output
     * @param {GPUTexture} texture - Texture from node graph
     */
    setTexture(texture) {
        this.texture = texture;
    }

    /**
     * Render textured mesh
     * @param {GPURenderPassEncoder} passEncoder - Render pass encoder
     * @param {Object} geometry - Mesh geometry (must include uvs)
     * @param {Mat4} viewMatrix - Camera view matrix
     * @param {Mat4} projectionMatrix - Camera projection matrix
     * @param {Mat4} modelMatrix - Model transform matrix
     * @param {Object} options - Rendering options
     */
    render(passEncoder, geometry, viewMatrix, projectionMatrix, modelMatrix, options = {}) {
        if (!this.initialized) {

            return;
        }

        if (!geometry || !geometry.positions || geometry.vertexCount === 0) {
            return;
        }

        if (!geometry.uvs) {

            return;
        }

        if (!this.texture) {

            return;
        }

        // Update or create vertex buffer
        if (!this.vertexBuffer || this.vertexBuffer.size < geometry.positions.byteLength) {
            if (this.vertexBuffer) {
                this.vertexBuffer.destroy();
            }
            this.vertexBuffer = this.device.createBuffer({
                size: geometry.positions.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
        }
        this.device.queue.writeBuffer(this.vertexBuffer, 0, geometry.positions);

        // Update or create normal buffer (create default normals if missing)
        let normals = geometry.normals;
        if (!normals) {
            // Create default normals (pointing up)
            normals = new Float32Array(geometry.vertexCount * 3);
            for (let i = 0; i < geometry.vertexCount; i++) {
                normals[i * 3 + 0] = 0;
                normals[i * 3 + 1] = 1;
                normals[i * 3 + 2] = 0;
            }
        }

        if (!this.normalBuffer || this.normalBuffer.size < normals.byteLength) {
            if (this.normalBuffer) {
                this.normalBuffer.destroy();
            }
            this.normalBuffer = this.device.createBuffer({
                size: normals.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
        }
        this.device.queue.writeBuffer(this.normalBuffer, 0, normals);

        // Update or create UV buffer
        if (!this.uvBuffer || this.uvBuffer.size < geometry.uvs.byteLength) {
            if (this.uvBuffer) {
                this.uvBuffer.destroy();
            }
            this.uvBuffer = this.device.createBuffer({
                size: geometry.uvs.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
        }
        this.device.queue.writeBuffer(this.uvBuffer, 0, geometry.uvs);

        // Update or create index buffer
        if (geometry.indices && geometry.indexCount > 0) {
            if (!this.indexBuffer || this.indexBuffer.size < geometry.indices.byteLength) {
                if (this.indexBuffer) {
                    this.indexBuffer.destroy();
                }
                this.indexBuffer = this.device.createBuffer({
                    size: geometry.indices.byteLength,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
                });
            }
            this.device.queue.writeBuffer(this.indexBuffer, 0, geometry.indices);
        }

        // Update uniforms
        const uniformData = new Float32Array(64);
        uniformData.set(modelMatrix.elements, 0);
        uniformData.set(viewMatrix.elements, 16);
        uniformData.set(projectionMatrix.elements, 32);
        // Light direction
        uniformData.set([0.5, 0.7, 0.3], 48);
        // Texture blend factor
        uniformData[51] = options.textureBlend !== undefined ? options.textureBlend : 1.0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer }
                },
                {
                    binding: 1,
                    resource: this.texture.createView()
                },
                {
                    binding: 2,
                    resource: this.sampler
                }
            ]
        });

        // Render
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.normalBuffer);
        passEncoder.setVertexBuffer(2, this.uvBuffer);

        if (geometry.indices && geometry.indexCount > 0) {
            passEncoder.setIndexBuffer(this.indexBuffer, 'uint32');
            passEncoder.drawIndexed(geometry.indexCount, 1, 0, 0, 0);
        } else {
            passEncoder.draw(geometry.vertexCount, 1, 0, 0);
        }
    }

    /**
     * Get vertex shader WGSL code
     * @private
     */
    getVertexShaderCode() {
        return `
            struct Uniforms {
                modelMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                projectionMatrix: mat4x4<f32>,
                lightDir: vec3<f32>,
                textureBlend: f32,
            }

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldNormal: vec3<f32>,
                @location(1) uv: vec2<f32>,
                @location(2) worldPosition: vec3<f32>,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            @vertex
            fn main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;

                let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
                let viewPos = uniforms.viewMatrix * worldPos;
                output.position = uniforms.projectionMatrix * viewPos;

                // Transform normal to world space
                output.worldNormal = (uniforms.modelMatrix * vec4<f32>(input.normal, 0.0)).xyz;

                output.uv = input.uv;
                output.worldPosition = worldPos.xyz;

                return output;
            }
        `;
    }

    /**
     * Get fragment shader WGSL code
     * @private
     */
    getFragmentShaderCode() {
        return `
            struct Uniforms {
                modelMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                projectionMatrix: mat4x4<f32>,
                lightDir: vec3<f32>,
                textureBlend: f32,
            }

            struct FragmentInput {
                @location(0) worldNormal: vec3<f32>,
                @location(1) uv: vec2<f32>,
                @location(2) worldPosition: vec3<f32>,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var colorTexture: texture_2d<f32>;
            @group(0) @binding(2) var colorSampler: sampler;

            @fragment
            fn main(input: FragmentInput) -> @location(0) vec4<f32> {
                // Sample texture
                let texColor = textureSample(colorTexture, colorSampler, input.uv);

                // Normalize normal
                let normal = normalize(input.worldNormal);

                // Simple diffuse lighting
                let lightDir = normalize(uniforms.lightDir);
                let diffuse = max(dot(normal, lightDir), 0.0);

                // Ambient + diffuse
                let ambient = 0.3;
                let lighting = ambient + diffuse * 0.7;

                // Apply lighting to texture color
                let finalColor = texColor.rgb * lighting;

                return vec4<f32>(finalColor, texColor.a);
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

        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.uvBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this.texture = null;
        this.initialized = false;

    }
}
