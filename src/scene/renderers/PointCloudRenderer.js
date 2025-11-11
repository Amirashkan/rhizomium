/**
 * PointCloudRenderer
 *
 * Renders point cloud geometry using WebGPU
 */

export class PointCloudRenderer {
    /**
     * @param {GPUDevice} device - WebGPU device
     */
    constructor(device) {
        this.device = device;

        this.pipeline = null;
        this.bindGroupLayout = null;
        this.pipelineLayout = null;

        // GPU buffers for current point cloud
        this.vertexBuffer = null;
        this.colorBuffer = null;
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
            label: 'Point Cloud Vertex Shader',
            code: this.getVertexShaderCode()
        });

        this.fragmentShader = this.device.createShaderModule({
            label: 'Point Cloud Fragment Shader',
            code: this.getFragmentShaderCode()
        });

        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Point Cloud Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' }
                }
            ]
        });

        // Create pipeline layout
        this.pipelineLayout = this.device.createPipelineLayout({
            label: 'Point Cloud Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout]
        });

        // Create render pipeline
        this.pipeline = this.device.createRenderPipeline({
            label: 'Point Cloud Render Pipeline',
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
                        // Color buffer
                        arrayStride: 16, // 4 floats
                        attributes: [
                            {
                                shaderLocation: 1,
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
                topology: 'point-list',
                cullMode: 'none'
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
     * Render point cloud geometry
     * @param {GPURenderPassEncoder} passEncoder - Render pass encoder
     * @param {Object} geometry - Point cloud geometry
     * @param {Mat4} viewMatrix - Camera view matrix
     * @param {Mat4} projectionMatrix - Camera projection matrix
     * @param {Mat4} modelMatrix - Model transform matrix
     */
    render(passEncoder, geometry, viewMatrix, projectionMatrix, modelMatrix) {
        if (!this.initialized) {

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

        // Update or create color buffer
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

        // Update uniforms (matrices)
        const uniformData = new Float32Array(64); // 4 matrices of 16 floats
        uniformData.set(modelMatrix.elements, 0);
        uniformData.set(viewMatrix.elements, 16);
        uniformData.set(projectionMatrix.elements, 32);
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
        passEncoder.setVertexBuffer(1, this.colorBuffer);
        passEncoder.draw(geometry.vertexCount, 1, 0, 0);
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
            }

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) color: vec4<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) color: vec4<f32>,
                @builtin(point_size) pointSize: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            @vertex
            fn main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;

                let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
                let viewPos = uniforms.viewMatrix * worldPos;
                output.position = uniforms.projectionMatrix * viewPos;

                output.color = input.color;

                // Point size based on distance
                let distance = length(viewPos.xyz);
                output.pointSize = 5.0 / distance;

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
            struct FragmentInput {
                @location(0) color: vec4<f32>,
            }

            @fragment
            fn main(input: FragmentInput) -> @location(0) vec4<f32> {
                // Circular point shape
                let coord = vec2<f32>(0.5, 0.5) - gl_PointCoord;
                let dist = length(coord);

                if (dist > 0.5) {
                    discard;
                }

                // Soft edges
                let alpha = 1.0 - smoothstep(0.3, 0.5, dist);

                return vec4<f32>(input.color.rgb, input.color.a * alpha);
            }
        `;
    }

    /**
     * Destroy GPU resources
     */
    destroy() {
        if (this.vertexBuffer) this.vertexBuffer.destroy();
        if (this.colorBuffer) this.colorBuffer.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();

        this.vertexBuffer = null;
        this.colorBuffer = null;
        this.uniformBuffer = null;
        this.initialized = false;

    }
}
