/**
 * MeshRenderer
 *
 * Renders mesh geometry with vertex colors using WebGPU
 */

export class MeshRenderer {
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
        this.indexBuffer = null;
        this.uniformBuffer = null;

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

        // Create shader modules
        this.vertexShader = this.device.createShaderModule({
            label: 'Mesh Vertex Shader',
            code: this.getVertexShaderCode()
        });

        this.fragmentShader = this.device.createShaderModule({
            label: 'Mesh Fragment Shader',
            code: this.getFragmentShaderCode()
        });

        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Mesh Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                }
            ]
        });

        // Create pipeline layout
        this.pipelineLayout = this.device.createPipelineLayout({
            label: 'Mesh Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout]
        });

        // Create render pipeline
        this.pipeline = this.device.createRenderPipeline({
            label: 'Mesh Render Pipeline',
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
                        // Color buffer
                        arrayStride: 16, // 4 floats
                        attributes: [
                            {
                                shaderLocation: 2,
                                offset: 0,
                                format: 'float32x4'
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
            size: 256, // Enough for matrices and lighting params
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.initialized = true;
        console.log('[MeshRenderer] Initialized');
    }

    /**
     * Render mesh geometry
     * @param {GPURenderPassEncoder} passEncoder - Render pass encoder
     * @param {Object} geometry - Mesh geometry
     * @param {Mat4} viewMatrix - Camera view matrix
     * @param {Mat4} projectionMatrix - Camera projection matrix
     * @param {Mat4} modelMatrix - Model transform matrix
     */
    render(passEncoder, geometry, viewMatrix, projectionMatrix, modelMatrix) {
        if (!this.initialized) {
            console.warn('[MeshRenderer] Not initialized');
            return;
        }

        if (!geometry || !geometry.positions || geometry.vertexCount === 0) {
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

        // Update or create normal buffer
        if (geometry.normals) {
            if (!this.normalBuffer || this.normalBuffer.size < geometry.normals.byteLength) {
                if (this.normalBuffer) {
                    this.normalBuffer.destroy();
                }
                this.normalBuffer = this.device.createBuffer({
                    size: geometry.normals.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
            }
            this.device.queue.writeBuffer(this.normalBuffer, 0, geometry.normals);
        }

        // Update or create color buffer
        if (geometry.colors) {
            if (!this.colorBuffer || this.colorBuffer.size < geometry.colors.byteLength) {
                if (this.colorBuffer) {
                    this.colorBuffer.destroy();
                }
                this.colorBuffer = this.device.createBuffer({
                    size: geometry.colors.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
            }
            this.device.queue.writeBuffer(this.colorBuffer, 0, geometry.colors);
        }

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
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer }
                }
            ]
        });

        // Render
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        if (this.normalBuffer) {
            passEncoder.setVertexBuffer(1, this.normalBuffer);
        }
        if (this.colorBuffer) {
            passEncoder.setVertexBuffer(2, this.colorBuffer);
        }

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
            }

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) color: vec4<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldNormal: vec3<f32>,
                @location(1) color: vec4<f32>,
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

                output.color = input.color;

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
            }

            struct FragmentInput {
                @location(0) worldNormal: vec3<f32>,
                @location(1) color: vec4<f32>,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            @fragment
            fn main(input: FragmentInput) -> @location(0) vec4<f32> {
                // Normalize normal
                let normal = normalize(input.worldNormal);

                // Simple diffuse lighting
                let lightDir = normalize(uniforms.lightDir);
                let diffuse = max(dot(normal, lightDir), 0.0);

                // Ambient + diffuse
                let ambient = 0.3;
                let lighting = ambient + diffuse * 0.7;

                return vec4<f32>(input.color.rgb * lighting, input.color.a);
            }
        `;
    }

    /**
     * Destroy GPU resources
     */
    destroy() {
        if (this.vertexBuffer) this.vertexBuffer.destroy();
        if (this.normalBuffer) this.normalBuffer.destroy();
        if (this.colorBuffer) this.colorBuffer.destroy();
        if (this.indexBuffer) this.indexBuffer.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();

        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.colorBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this.initialized = false;

        console.log('[MeshRenderer] Destroyed');
    }
}
