/**
 * PointCloudRenderer
 *
 * Renders point cloud geometry using WebGPU.
 *
 * WGSL has no point size control (point-list primitives are always one pixel),
 * so points are drawn as camera-facing quads: one 4-vertex triangle-strip
 * expanded in view space, instanced per point with position/color pulled from
 * per-instance vertex buffers.
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
                        // Per-instance point position
                        arrayStride: 12, // 3 floats
                        stepMode: 'instance',
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: 'float32x3'
                            }
                        ]
                    },
                    {
                        // Per-instance point color
                        arrayStride: 16, // 4 floats
                        stepMode: 'instance',
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
                topology: 'triangle-strip',
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
     * @param {number} pointSize - Point radius in world units
     */
    render(passEncoder, geometry, viewMatrix, projectionMatrix, modelMatrix, pointSize = 0.02) {
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

        // Update uniforms (matrices + point size)
        const uniformData = new Float32Array(52); // 3 matrices + pointSize + padding
        uniformData.set(modelMatrix.elements, 0);
        uniformData.set(viewMatrix.elements, 16);
        uniformData.set(projectionMatrix.elements, 32);
        uniformData[48] = pointSize;
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

        // Render: 4-vertex quad strip, one instance per point
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.colorBuffer);
        passEncoder.draw(4, geometry.vertexCount, 0, 0);
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
                pointSize: f32,
            }

            struct VertexInput {
                @builtin(vertex_index) vertexIndex: u32,
                @location(0) position: vec3<f32>,
                @location(1) color: vec4<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) color: vec4<f32>,
                @location(1) corner: vec2<f32>,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            @vertex
            fn main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;

                // Quad corners for a 4-vertex triangle strip
                var corners = array<vec2<f32>, 4>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>( 1.0, -1.0),
                    vec2<f32>(-1.0,  1.0),
                    vec2<f32>( 1.0,  1.0)
                );
                let corner = corners[input.vertexIndex];

                // Expand the quad in view space so it always faces the camera
                let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
                var viewPos = uniforms.viewMatrix * worldPos;
                viewPos = vec4<f32>(viewPos.xy + corner * uniforms.pointSize, viewPos.z, viewPos.w);
                output.position = uniforms.projectionMatrix * viewPos;

                output.color = input.color;
                output.corner = corner;

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
                @location(1) corner: vec2<f32>,
            }

            @fragment
            fn main(input: FragmentInput) -> @location(0) vec4<f32> {
                // Circular point shape with soft edges
                let dist = length(input.corner);

                if (dist > 1.0) {
                    discard;
                }

                let alpha = 1.0 - smoothstep(0.6, 1.0, dist);

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
