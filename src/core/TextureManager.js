// src/core/TextureManager.js
export class TextureManager {
  constructor() {
    this.textures = new Map(); // nodeId -> texture info
    this.device = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
      this.textures = new Map(); // nodeId -> textureInfo
  this.gpuTextures = new Map(); // nodeId -> {texture, sampler}
  this.device = null;
  }
/**
 * Upload texture from file input
 */
async uploadTexture(nodeId, file) {
  // Read file as data URL for saving
  const dataUrl = await this.fileToDataUrl(file);
  
  // Load image
  const img = await this.loadImage(dataUrl);
  
  // Create bitmap for GPU
  const bitmap = await createImageBitmap(img);
  
  // Store texture info
  const textureInfo = {
    filename: file.name,
    dataUrl: dataUrl,
    width: img.width,
    height: img.height,
    bitmap: bitmap,
    file: file // Keep reference to original file
  };
  
  this.textures.set(nodeId, textureInfo);

  // Upload to GPU if device exists
  if (this.device) {
    await this.uploadToGPU(nodeId, bitmap);
  }

  // Invalidate bind group since we have new textures
  this.bindGroup = null;

  return textureInfo;
}

/**
 * Helper: Convert File to data URL
 */
fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Helper: Load image from URL or data URL
 */
loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Helper: Upload bitmap to GPU
 */
async uploadToGPU(nodeId, bitmap) {
  if (!this.device) return;
  
  // Create GPU texture
  const texture = this.device.createTexture({
    size: { width: bitmap.width, height: bitmap.height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | 
           GPUTextureUsage.COPY_DST | 
           GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Copy bitmap to GPU texture
  this.device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture: texture },
    { width: bitmap.width, height: bitmap.height }
  );

  // Create sampler
  const sampler = this.device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  const textureView = texture.createView();

  // Store GPU resources
  this.gpuTextures.set(nodeId, { texture, textureView, sampler });

}

/**
 * Inject a texture broadcast from the editor (second-monitor mirror window).
 * Uploads the bitmap and registers it under nodeId in BOTH maps so the renderer's
 * _lookupTextureBinding resolves `texture_<id>` / `sampler_<id>` to it. Nulls the
 * bind group so the next frame rebinds.
 */
async injectExternalTexture(nodeId, bitmap) {
  if (!this.device || !bitmap) return;
  const texture = this.device.createTexture({
    size: { width: bitmap.width, height: bitmap.height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  this.device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    { width: bitmap.width, height: bitmap.height },
  );
  const sampler = this.device.createSampler({
    magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat',
  });
  const textureView = texture.createView();
  this.gpuTextures.set(nodeId, { texture, textureView, sampler });
  this.textures.set(nodeId, { texture, textureView, sampler, width: bitmap.width, height: bitmap.height, bitmap });
  this.bindGroup = null; // force the renderer to rebind on the next frame
}

  async initialize(device) {
    try {
      if (!device) {
        throw new Error("WebGPU device is required");
      }
      this.device = device;

    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'texture-manager-init' 
      });
      throw error;
    }
  }

  async loadTexture(nodeId, imageFile) {
    if (!this.device) {
      const error = new Error("TextureManager not initialized with WebGPU device");
      window.errorHandler?.handleError(error, { 
        component: 'texture-loading',
        nodeId 
      });
      throw error;
    }

    try {

      // Validate file
      if (!imageFile || !imageFile.type.startsWith('image/')) {
        throw new Error("Invalid image file provided");
      }

      // Check file size (limit to 50MB)
      const maxSize = 50 * 1024 * 1024;
      if (imageFile.size > maxSize) {
        throw new Error(`Image file too large: ${(imageFile.size / 1024 / 1024).toFixed(1)}MB (max 50MB)`);
      }

      // Create image bitmap from file
      const imageBitmap = await createImageBitmap(imageFile);

      // Validate bitmap dimensions
      if (imageBitmap.width > 4096 || imageBitmap.height > 4096) {
        window.errorHandler?.handleError(
          new Error("Image resolution too high (max 4096x4096)"), 
          { component: 'texture-validation', nodeId, width: imageBitmap.width, height: imageBitmap.height }
        );
      }

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

      // Invalidate bind group since we have new textures
      this.bindGroup = null;

      return textureInfo;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'texture-loading',
        nodeId,
        fileName: imageFile?.name,
        type: 'texture-error'
      });
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
    try {
      // gpuTextures is the map the renderer resolves `texture_<id>` against, so a texture left
      // there outlives the node that owned it. Take both entries, and destroy whichever GPU
      // texture they name (they normally share one).
      const textureInfo = this.textures.get(nodeId);
      const gpuInfo = this.gpuTextures.get(nodeId);
      if (textureInfo || gpuInfo) {
        // Cleanup WebGPU resources
        for (const texture of new Set([textureInfo?.texture, gpuInfo?.texture])) {
          if (texture && texture.destroy) {
            texture.destroy();
          }
        }
        this.textures.delete(nodeId);
        this.gpuTextures.delete(nodeId);

        // Invalidate bind group
        this.bindGroup = null;

      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'texture-cleanup',
        nodeId 
      });
    }
  }

  // Create bind group layout that includes all current textures
  createBindGroupLayout(graph) {
    try {
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
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'bind-group-layout-creation' 
      });
      throw error;
    }
  }

  // Create bind group with current textures
  createBindGroup(graph, uniformBuffer) {
    try {
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
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'bind-group-creation' 
      });
      throw error;
    }
  }

  // Create a dummy 1x1 texture for missing textures
  createDummyTexture() {
    try {
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
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'dummy-texture-creation' 
      });
      throw error;
    }
  }

  // Check if bind group needs rebuilding
  needsBindGroupUpdate(_graph) {
    return this.bindGroup === null;
  }

  // Get texture count for debugging
  getTextureCount() {
    return this.textures.size;
  }

  // Clean up all resources
  destroy() {
    try {
      for (const [, textureInfo] of this.textures) {
        if (textureInfo.texture && textureInfo.texture.destroy) {
          textureInfo.texture.destroy();
        }
      }
      this.textures.clear();
      this.bindGroup = null;
      this.bindGroupLayout = null;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'texture-manager-cleanup' 
      });
    }
  }
}
