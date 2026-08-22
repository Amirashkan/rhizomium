// src/core/TextureManager.js

/** Containers a <video> can decode, for the cases where a dropped file carries no MIME type. */
const VIDEO_EXTENSION = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;

/**
 * Is this file a moving image rather than a still one? Type first, extension as the fallback:
 * files dragged from some file managers arrive with an empty `type`.
 */
export function isVideoSource(file) {
  if (!file) return false;
  if (typeof file.type === "string" && file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSION.test(file.name || "");
}

/** Parameter values arrive as booleans, numbers or the strings a saved patch round-trips. */
function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "on") return true;
  if (text === "false" || text === "0" || text === "off") return false;
  return fallback;
}

function toNumber(value, fallback) {
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class TextureManager {
  /**
   * Videos above this size are not inlined into the saved patch - see uploadVideo.
   * 24 MB of source becomes roughly 32 MB of base64 in the patch file.
   */
  static MAX_INLINE_VIDEO_BYTES = 24 * 1024 * 1024;

  constructor() {
    this.textures = new Map(); // nodeId -> texture info
    this.device = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
      this.textures = new Map(); // nodeId -> textureInfo
  this.gpuTextures = new Map(); // nodeId -> {texture, sampler}
  this.videos = new Map(); // nodeId -> {video, objectUrl, lastFrameTime} - playing video sources
  this.device = null;
  }
/**
 * Upload texture from file input.
 *
 * A video goes down its own path: it keeps a playing <video> element whose current frame is
 * copied into the same GPU texture every frame, so from the shader's side it stays an ordinary
 * `texture_2d<f32>` and every binding, codegen and save path treats it like an image.
 */
async uploadTexture(nodeId, file, node = null) {
  if (isVideoSource(file)) {
    return this.uploadVideo(nodeId, file, { node });
  }

  // Switching a node from a video back to a still: stop the old decoder first.
  this.releaseVideo(nodeId);

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
 * Load a video file into a node's texture slot.
 *
 * The element itself is the source of truth: it decodes and loops on its own, and
 * `updateVideoTextures()` copies whatever frame it is showing into the node's GPU texture once
 * per rendered frame. The GPU texture object is created once and reused, so bind groups built
 * around it stay valid while the video plays.
 *
 * @param {string} nodeId
 * @param {File|Blob} file
 * @param {{node?: Object, dataUrl?: string}} [options] - `node` supplies playback parameters;
 *        `dataUrl` skips re-encoding when the caller already holds the inline copy (patch load).
 */
async uploadVideo(nodeId, file, options = {}) {
  const { node = null } = options;

  // Whatever was here before - still or video - is being replaced.
  this.releaseVideo(nodeId);

  const objectUrl = URL.createObjectURL(file);
  let video;
  try {
    video = await this.loadVideo(objectUrl);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    window.errorHandler?.handleError?.(error, {
      component: 'video-loading',
      nodeId,
      fileName: file?.name,
    });
    throw error;
  }

  // A patch has to carry its own pixels to open anywhere, and the loader only accepts inline
  // data: URLs. Video files are big enough that inlining every one of them would produce patches
  // nobody can save or send, so past the cap the node keeps the filename and the artist re-drops
  // the file after loading.
  let dataUrl = options.dataUrl ?? null;
  if (!dataUrl && (file.size ?? 0) <= TextureManager.MAX_INLINE_VIDEO_BYTES) {
    try {
      dataUrl = await this.fileToDataUrl(file);
    } catch {
      dataUrl = null; // unsaveable, but perfectly playable in this session
    }
  }

  const entry = { video, objectUrl, lastFrameTime: -1 };
  this.videos.set(nodeId, entry);

  const textureInfo = {
    filename: file.name,
    dataUrl,
    isVideo: true,
    width: video.videoWidth,
    height: video.videoHeight,
    video, // second-monitor broadcast grabs the current frame from this
    file,
  };
  this.textures.set(nodeId, textureInfo);

  this.applyVideoParams(nodeId, node?.params);

  // Create the GPU texture and get frame one on screen without waiting for the next render tick.
  if (this.device) {
    this._ensureVideoTexture(nodeId, entry);
    this.updateVideoTextures();
  }

  this.bindGroup = null;
  return textureInfo;
}

/**
 * Helper: create a looping, muted, playing <video> for a source URL.
 * Resolves once the first frame is decoded, so dimensions are known and it can be sampled.
 */
loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;      // browsers only autoplay muted video; the Sound param can unmute later
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.autoplay = true;

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(video);
    };
    video.addEventListener("loadeddata", done, { once: true });
    video.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      reject(new Error(`Could not decode video: ${video.error?.message || "unsupported format"}`));
    }, { once: true });

    video.src = url;
    // A refused autoplay is not an error: the first frame still decodes, so the node shows a
    // still image and the Play parameter can start it from a user gesture.
    video.play?.().catch(() => {});
  });
}

/**
 * Push a node's playback parameters onto its video element. Called on upload and on every
 * recompile (i.e. whenever a parameter changed), so the controls act immediately.
 */
applyVideoParams(nodeId, params = null) {
  const entry = this.videos.get(nodeId);
  const video = entry?.video;
  if (!video) return;

  const p = params || {};
  video.muted = !toBool(p.sound, false);

  // Trim: play only the span between Trim Start and Trim End. Trim End 0 means "to the end of
  // the clip", which is how a range can be expressed before the duration is known.
  entry.loopWanted = toBool(p.loop, true);
  entry.trimStart = Math.max(0, toNumber(p.trimStart, 0));
  entry.trimEnd = Math.max(0, toNumber(p.trimEnd, 0));

  // Looping the trimmed span means jumping back to Trim Start, not to zero, so the element's own
  // loop is handed back to us whenever a span is in force (see _enforceTrim).
  video.loop = entry.loopWanted && !this._trimRange(entry);

  const rate = toNumber(p.playbackRate, 1);
  // Out-of-range rates throw on some browsers, and a rate of 0 is expressed as "not playing".
  const safeRate = Math.min(16, Math.max(0.0625, rate || 1));
  if (video.playbackRate !== safeRate) {
    try { video.playbackRate = safeRate; } catch { /* engine refused the rate */ }
  }

  // Play is re-applied on every recompile and preview update, not only when someone clicks it, so
  // it has to be read as a transition rather than an order. Re-asserting it would restart a clip
  // that had legitimately stopped - at the end of its trim span, or at the end of the file - the
  // instant anything else in the patch changed.
  const wantPlaying = toBool(p.playing, true);
  const pressedPlay = wantPlaying && entry.playRequested === false;
  entry.playRequested = wantPlaying;

  if (!wantPlaying) {
    entry.heldAtEnd = false;
    if (!video.paused) video.pause?.();
    return;
  }

  const range = this._trimRange(entry);

  if (pressedPlay) {
    // An explicit press of Play on a clip parked at the end starts it over.
    entry.heldAtEnd = false;
    if (range && video.currentTime >= range.end - 0.001) this._seek(video, range.start);
    if (video.paused) video.play?.().catch(() => {});
    return;
  }

  // Otherwise resume only what is paused for no reason of its own - not a clip holding on the last
  // frame of its span, and not one that has played out. Widening the span past where it stopped
  // releases the hold, and so does clearing the trim: with no span there is no end to be held at,
  // and a clip that genuinely ran out is caught by `ended` below instead.
  const parked = entry.heldAtEnd && !!range && video.currentTime >= range.end - 0.001;
  if (video.paused && !video.ended && !parked) {
    entry.heldAtEnd = false;
    video.play?.().catch(() => {});
  }
}

/**
 * The span this node plays, or null when the whole clip does.
 * A range that makes no sense (end before start, start past the end of the clip) is treated as
 * no trim at all - better the clip plays than that it freezes on a frame nobody chose.
 */
_trimRange(entry) {
  if (!entry) return null;
  const duration = Number.isFinite(entry.video?.duration) ? entry.video.duration : 0;
  const start = Math.max(0, entry.trimStart || 0);
  const declaredEnd = entry.trimEnd > 0 ? entry.trimEnd : duration;
  const end = duration > 0 ? Math.min(declaredEnd, duration) : declaredEnd;
  if (!(end > start)) return null;
  if (start <= 0 && (!duration || end >= duration)) return null; // the whole clip
  return { start, end };
}

/** Hold playback inside the trimmed span. Called once per frame, before the frame is copied. */
_enforceTrim(entry) {
  const range = this._trimRange(entry);
  if (!range) return;

  const video = entry.video;
  if (video.currentTime < range.start - 0.05) {
    this._seek(video, range.start);
    return;
  }
  if (video.currentTime < range.end) return;

  if (entry.loopWanted) {
    entry.heldAtEnd = false;
    this._seek(video, range.start);
  } else {
    // Hold on the last frame of the span, the way a non-looping clip holds on its final frame.
    // The flag is what stops the next recompile from pressing Play again (see applyVideoParams).
    entry.heldAtEnd = true;
    if (!video.paused) video.pause?.();
    this._seek(video, range.end);
  }
}

_seek(video, seconds) {
  try { video.currentTime = seconds; } catch { /* not seekable yet */ }
}

/**
 * Rewind a video to the start of its trimmed span - the start of the clip when there is no trim.
 * Both the panel's Reset button and the rising edge of its expression land here.
 *
 * A clip parked on the last frame of its span (or on the end of the file) is released, so Reset
 * starts a non-looping clip over rather than leaving it frozen; the hold flag has to be cleared
 * too, or the next recompile would read the clip as "stopped on purpose" and refuse to resume it.
 *
 * @returns {boolean} true when a video was actually rewound
 */
resetVideo(nodeId) {
  const entry = this.videos.get(nodeId);
  const video = entry?.video;
  if (!video) return false;

  const range = this._trimRange(entry);
  this._seek(video, range ? range.start : 0);
  entry.heldAtEnd = false;
  // The texture still holds the frame we just left. Clearing the marker forces the next pass to
  // copy, even if currentTime happens to land back on the value it already recorded.
  entry.lastFrameTime = -1;

  // Resume only what Play says should be running: a reset on a paused clip re-cues it, it does
  // not start it.
  if (entry.playRequested !== false && video.paused) video.play?.().catch(() => {});
  return true;
}

/**
 * Copy the current frame of every playing video into its GPU texture. Called once per rendered
 * frame, before bind groups are refreshed.
 */
updateVideoTextures() {
  if (!this.device || this.videos.size === 0) return;

  for (const [nodeId, entry] of this.videos) {
    const video = entry.video;
    // HAVE_CURRENT_DATA: there is a frame to copy.
    if (!video || (video.readyState ?? 0) < 2) continue;

    const info = this._ensureVideoTexture(nodeId, entry);
    if (!info) continue;

    this._enforceTrim(entry);

    // Paused, stalled, or simply not advanced yet: the texture already holds this frame, and the
    // copy is the expensive part.
    if (entry.lastFrameTime === video.currentTime) continue;
    entry.lastFrameTime = video.currentTime;

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: info.texture },
        { width: info.width, height: info.height },
      );
    } catch (error) {
      window.errorHandler?.handleError?.(error, { component: 'video-frame-upload', nodeId });
    }
  }
}

/**
 * The GPU texture a video's frames are copied into. Created once the decoder reports its
 * dimensions, and recreated only if those change (a different file in the same node).
 */
_ensureVideoTexture(nodeId, entry) {
  const video = entry.video;
  const width = Math.floor(video?.videoWidth || 0);
  const height = Math.floor(video?.videoHeight || 0);
  if (!this.device || width <= 0 || height <= 0) return null;

  const existing = this.gpuTextures.get(nodeId);
  if (existing && existing.width === width && existing.height === height) return existing;

  existing?.texture?.destroy?.();

  const texture = this.device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_DST |
           GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const sampler = this.device.createSampler({
    magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat',
  });
  const info = { texture, textureView: texture.createView(), sampler, width, height };
  this.gpuTextures.set(nodeId, info);

  const textureInfo = this.textures.get(nodeId);
  if (textureInfo) {
    Object.assign(textureInfo, { texture, textureView: info.textureView, sampler, width, height });
  }

  entry.lastFrameTime = -1; // the new texture holds nothing yet
  this.bindGroup = null;    // a different texture object means the renderer must rebind
  return info;
}

/**
 * Stop and free a node's video source. Without this the decoder keeps running (and holding the
 * object URL) after the node is deleted or given a different file.
 */
releaseVideo(nodeId) {
  const entry = this.videos.get(nodeId);
  if (!entry) return;
  this.videos.delete(nodeId);

  const video = entry.video;
  try {
    video?.pause?.();
    video?.removeAttribute?.('src');
    video?.load?.(); // drops the decoder's hold on the source
  } catch { /* element already torn down */ }

  if (entry.objectUrl) {
    try { URL.revokeObjectURL(entry.objectUrl); } catch { /* already revoked */ }
  }
}

/** Is this node's texture a video source? */
isVideoTexture(nodeId) {
  return this.videos.has(nodeId);
}

/**
 * Inject a texture broadcast from the editor (second-monitor mirror window).
 * Uploads the bitmap and registers it under nodeId in BOTH maps so the renderer's
 * _lookupTextureBinding resolves `texture_<id>` / `sampler_<id>` to it. Nulls the
 * bind group so the next frame rebinds.
 */
async injectExternalTexture(nodeId, bitmap) {
  if (!this.device || !bitmap) return;
  this.releaseVideo(nodeId); // a broadcast frame replaces whatever local source this node had
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
      this.releaseVideo(nodeId);
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
      for (const nodeId of [...this.videos.keys()]) {
        this.releaseVideo(nodeId);
      }
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
