// src/core/TextureManager.js
export class TextureManager {
  constructor() {
    this.textures = new Map(); // nodeId -> texture info
    this.device = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
  }

  async initialize(device) {
    this.device = device;
    console.log("TextureManager initialized with device:", device);
  }

  async loadTexture(nodeId, imageFile) {
    if (!this.device) {
      throw new Error("TextureManager not initialized with WebGPU device");
    }

    try {
      console.log("Loading texture for node:", nodeId, "file:", imageFile.name);

      // Create image bitmap from file
      const imageBitmap = await createImageBitmap(imageFile);
      console.log(
        "Created image bitmap:",
        imageBitmap.width,
        "x",
        imageBitmap.height,
      );

      // Create texture
      const texture = this.device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      // Copy image data to texture
      this.device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        [imageBitmap.width, imageBitmap.height, 1],
      );

      // Create texture view
      const textureView = texture.createView();

      // Create sampler - we'll make this configurable later
      const sampler = this.device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
      });

      // Store texture info
      const textureInfo = {
        texture,
        textureView,
        sampler,
        width: imageBitmap.width,
        height: imageBitmap.height,
        file: imageFile,
        bitmap: imageBitmap, // Keep for preview
      };

      this.textures.set(nodeId, textureInfo);
      console.log("Successfully loaded texture for node:", nodeId);

      // Invalidate bind group since we have new textures
      this.bindGroup = null;

      return textureInfo;
    } catch (error) {
      console.error("Failed to load texture for node", nodeId, ":", error);
      throw error;
    }
  }

  getTexture(nodeId) {
    return this.textures.get(nodeId);
  }

  hasTexture(nodeId) {
    return this.textures.has(nodeId);
  }

  removeTexture(nodeId) {
    const textureInfo = this.textures.get(nodeId);
    if (textureInfo) {
      // Cleanup WebGPU resources
      if (textureInfo.texture && textureInfo.texture.destroy) {
        textureInfo.texture.destroy();
      }
      this.textures.delete(nodeId);

      // Invalidate bind group
      this.bindGroup = null;

      console.log("Removed texture for node:", nodeId);
    }
  }

  // Create bind group layout that includes all current textures
  createBindGroupLayout(graph) {
    if (!this.device) throw new Error("Device not initialized");

    const entries = [
      // Binding 0: Uniforms (time, etc.)
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
        buffer: { type: "uniform" },
      },
    ];

    let bindingIndex = 1;

    if (graph.nodes) {
      for (const node of graph.nodes) {
        if (node.kind === "Texture2D") {
          // Texture binding
          entries.push({
            binding: bindingIndex,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" },
          });

          // Sampler binding
          entries.push({
            binding: bindingIndex + 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {},
          });

          bindingIndex += 2;
        } else if (node.kind === "TextureCube") {
          // Cube texture binding
          entries.push({
            binding: bindingIndex,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float", viewDimension: "cube" },
          });

          // Sampler binding
          entries.push({
            binding: bindingIndex + 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {},
          });

          bindingIndex += 2;
        }
      }
    }

    this.bindGroupLayout = this.device.createBindGroupLayout({ entries });
    return this.bindGroupLayout;
  }

  // Create bind group with current textures
  createBindGroup(graph, uniformBuffer) {
    if (!this.bindGroupLayout) {
      throw new Error("Bind group layout not created");
    }

    const entries = [
      // Binding 0: Uniforms
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ];

    let bindingIndex = 1;

    if (graph.nodes) {
      for (const node of graph.nodes) {
        const textureInfo = this.getTexture(node.id);

        if (node.kind === "Texture2D" && textureInfo) {
          // Texture binding
          entries.push({
            binding: bindingIndex,
            resource: textureInfo.textureView,
          });

          // Sampler binding
          entries.push({
            binding: bindingIndex + 1,
            resource: textureInfo.sampler,
          });

          bindingIndex += 2;
        } else if (node.kind === "TextureCube" && textureInfo) {
          // Cube texture binding
          entries.push({
            binding: bindingIndex,
            resource: textureInfo.textureView,
          });

          // Sampler binding
          entries.push({
            binding: bindingIndex + 1,
            resource: textureInfo.sampler,
          });

          bindingIndex += 2;
        } else if (node.kind === "Texture2D" || node.kind === "TextureCube") {
          // Missing texture - create dummy bindings
          console.warn(
            "Missing texture for node:",
            node.id,
            "creating dummy texture",
          );

          // Create a 1x1 dummy texture
          const dummyTexture = this.createDummyTexture();
          const dummySampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
          });

          entries.push({
            binding: bindingIndex,
            resource: dummyTexture.createView(),
          });

          entries.push({
            binding: bindingIndex + 1,
            resource: dummySampler,
          });

          bindingIndex += 2;
        }
      }
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries,
    });

    return this.bindGroup;
  }

  // Create a dummy 1x1 texture for missing textures
  createDummyTexture() {
    const texture = this.device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Fill with magenta to indicate missing texture
    const data = new Uint8Array([255, 0, 255, 255]); // Magenta
    this.device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: 4 },
      [1, 1, 1],
    );

    return texture;
  }

  // Check if bind group needs rebuilding
  needsBindGroupUpdate(graph) {
    return this.bindGroup === null;
  }

  // Get texture count for debugging
  getTextureCount() {
    return this.textures.size;
  }

  // Clean up all resources
  destroy() {
    for (const [nodeId, textureInfo] of this.textures) {
      if (textureInfo.texture && textureInfo.texture.destroy) {
        textureInfo.texture.destroy();
      }
    }
    this.textures.clear();
    this.bindGroup = null;
    this.bindGroupLayout = null;
  }
}
