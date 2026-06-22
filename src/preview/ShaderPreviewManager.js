// src/preview/ShaderPreviewManager.js
// Main coordinator for real-time shader preview with GPU compute and throttling

import { PreviewThrottler } from './PreviewThrottler.js';
import { GPUPreviewRenderer } from './GPUPreviewRenderer.js';
import { FragmentTextureRenderer } from '../gpu/FragmentTextureRenderer.js';
import { NodeDefs } from '../data/NodeDefs.js';

export class ShaderPreviewManager {
  constructor(editor, device, format) {
    this.editor = editor;
    this.device = device;
    this.format = format;

    // Initialize subsystems
    this.throttler = new PreviewThrottler();
    this.gpuRenderer = new GPUPreviewRenderer(device, format);

    // Renders the real shader output of any non-compute node's subgraph to a texture.
    // Dedicated instance (NOT shared with ComputeExecutor) so preview render bookkeeping
    // — textureCache / shaderCache / parameterHashes — can't interfere with the compute
    // auto-bridge path. WGSL module compilation is still de-duped via the global
    // device-keyed shaderModuleCache that FragmentTextureRenderer uses internally.
    this.fragmentRenderer = new FragmentTextureRenderer(device);

    // Preview mode settings
    this.enableGPUPreview = true;  // Use GPU for previews
    this.enableCPUReadback = true; // Readback to CPU for thumbnails
    this.previewSize = 128;        // Default preview size
    // Thumbnail canvas resolution. Kept >= the largest on-node preview size (128) so the
    // displayed thumbnail downscales (smooth) instead of upscaling a 64px image (blurry).
    this.previewThumbSize = 128;
    // Fragment previews render supersampled, then downscale into the thumbnail canvas, which
    // antialiases the result (compute previews are already larger than the thumbnail).
    this.previewRenderSize = 256;

    // Track nodes pending preview update
    this.pendingNodes = new Set();

    // Cache for compiled preview shaders (nodeId -> shader code for change detection)
    this.shaderCache = new Map();
  }

  /**
   * Request preview update for a node
   * @param {object} node - The node to preview
   * @param {boolean} immediate - If true, bypass throttling
   */
  requestNodePreview(node, immediate = false) {
    if (!node || !node.id) {
      return;
    }

    this.pendingNodes.add(node.id);

    this.throttler.requestUpdate(() => {
      this.updatePendingPreviews();
    }, immediate);
  }

  /**
   * Request preview updates for multiple nodes
   * @param {Array<object>} nodes - Nodes to preview
   * @param {boolean} immediate - If true, bypass throttling
   */
  requestNodesPreviews(nodes, immediate = false) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return;
    }

    for (const node of nodes) {
      if (node && node.id) {
        this.pendingNodes.add(node.id);
      }
    }

    this.throttler.requestUpdate(() => {
      this.updatePendingPreviews();
    }, immediate);
  }

  /**
   * Update all pending node previews
   */
  async updatePendingPreviews() {
    if (this.pendingNodes.size === 0) {
      return;
    }

    const nodeIds = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    for (const nodeId of nodeIds) {
      const node = this.editor.graph?.nodes?.find(n => n.id === nodeId);

      if (!node) {
        continue;
      }

      try {
        await this.updateNodePreview(node);
      } catch (error) {

      }
    }
  }

  /**
   * Update preview for a single node
   * @param {object} node - The node to preview
   */
  async updateNodePreview(node) {
    if (!this.enableGPUPreview) {
      // Fall back to existing preview system
      if (this.editor.previewSystem) {
        this.editor.previewSystem.generateNodePreview(node);
      }
      return;
    }

    try {
      // For compute nodes, use their output texture directly
      if (this.isComputeNode(node)) {
        await this.updateComputeNodePreview(node);
        return;
      }

      // For fragment nodes, compile and render
      await this.updateFragmentNodePreview(node);
    } catch (error) {

      // Fall back to CPU preview on error
      if (this.editor.previewSystem) {
        this.editor.previewSystem.generateNodePreview(node);
      }
    }
  }

  /**
   * Check if a node is a compute node.
   * Compute nodes are identified by their kind prefix ("ComputeNoise", "ComputeBlur", ...),
   * matching the convention used in ParameterUniformManager / ParameterExpressionSystem.
   * Accepts either a node object or a kind string.
   * @param {object|string} nodeOrKind
   * @returns {boolean}
   */
  isComputeNode(nodeOrKind) {
    const kind = typeof nodeOrKind === 'string' ? nodeOrKind : nodeOrKind?.kind;
    return !!kind && kind.toLowerCase().startsWith('compute');
  }

  /**
   * Decide whether a node should get a real GPU-rendered thumbnail (vector output) vs.
   * the CPU numeric/approximation path (scalar output). Compute nodes are handled separately.
   * Vector outputs (vec2/3/4 — UV, colors, noise fields, patterns, transforms, gradients)
   * render to a meaningful image; scalar f32 nodes (Math results, Time, ConstFloat) are better
   * served by the existing numeric overlay than a flat gray swatch.
   * @param {object|string} nodeOrKind
   * @returns {boolean}
   */
  isVisualNode(nodeOrKind) {
    const kind = typeof nodeOrKind === 'string' ? nodeOrKind : nodeOrKind?.kind;
    if (!kind || this.isComputeNode(kind)) return false;

    const def = NodeDefs[kind];
    const out = def?.pinsOut?.[0];
    if (!out) return false; // nothing to render (e.g. terminal Output nodes)

    // Typed pin: render vector outputs (colors / UV / fields) and 'dynamic' (Math whose type
    // follows its inputs — commonly a vector in the color pipeline, e.g. Multiply / Mix).
    if (typeof out === 'object') {
      const t = out.type;
      if (t === 'vec2' || t === 'vec3' || t === 'vec4' || t === 'dynamic') return true;

      // Scalar output: still worth rendering when it's a per-pixel FIELD rather than a uniform
      // value — e.g. VoronoiNoise's F1 distance (typed f32 but varies across UV). Treat a scalar
      // node as visual when it consumes a UV input or exposes multiple outputs (generator-like);
      // plain scalars (ConstFloat / Time / math results) stay on the CPU numeric path.
      const pinsIn = def?.pinsIn;
      const takesUV = Array.isArray(pinsIn) &&
        pinsIn.some(p => /uv/i.test(typeof p === 'string' ? p : (p?.label || '')));
      const multiOutput = Array.isArray(def?.pinsOut) && def.pinsOut.length > 1;
      return takesUV || multiOutput;
    }

    // Bare string pin (e.g. "Color", "Value", "Texture", "UV"): fragment nodes that produce a
    // per-pixel field or color, so a real render is the right preview. (Categories here are
    // function-based — "Generators"/"Modifiers"/... — so pin shape, not `cat`, is the signal.)
    return true;
  }

  /**
   * Current animation time in seconds. Prefer the render loop's sim clock so previews animate
   * on the same timeline (and pause/scrub) as the main canvas; fall back to wall-clock.
   * @private
   */
  _currentTime() {
    const sim = window.renderLoop?._simTime;
    return typeof sim === 'number' ? sim : (performance.now() / 1000);
  }

  /**
   * Build the audio-envelope context the fragment renderer expects, from the same globals
   * the main GPURenderer reads when writing its `g` uniform.
   * @private
   */
  _currentAudioContext() {
    return {
      audioEnvelope: window._audioEnvelopeValue || 0,
      audioEnvelopeBass: window._audioEnvelopeBass || 0,
      audioEnvelopeMids: window._audioEnvelopeMids || 0,
      audioEnvelopeHighs: window._audioEnvelopeHighs || 0,
      audioEnvelopeFull: window._audioEnvelopeFull || 0,
    };
  }

  /**
   * Keep our renderer bound to the live GPU device. A project load / device reinit creates a
   * brand-new device and window.gpuRenderer, orphaning the device this manager captured at
   * construction — every render/readback on the stale device would then fail and fall back to
   * the CPU placeholder. Rebuild the fragment renderer on the current device when it changes.
   * @private
   */
  _syncDevice() {
    const live = window.gpuRenderer?.device;
    if (live && live !== this.device) {
      this.device = live;
      this.format = window.gpuRenderer?.format || this.format;
      this.fragmentRenderer = new FragmentTextureRenderer(live);
    }
  }

  /**
   * Update preview for a compute node by reading back its already-rendered output texture.
   * @param {object} node - The compute node
   */
  async updateComputeNodePreview(node) {
    this._syncDevice();
    const computeExecutor = window.computeExecutor;
    const computeInfo = computeExecutor?.computeTextures?.get(node.id);
    if (!computeInfo || !computeInfo.texture) {
      // Output texture not ready yet (e.g. compute hasn't dispatched on first load) —
      // show the CPU approximation so the node isn't blank; it upgrades on the next update.
      this.fallbackToLegacyPreview(node);
      return;
    }

    try {
      await this._textureToThumbnail(computeInfo.texture, node);
    } catch (error) {
      // Fallback: mark GPU preview available even if readback fails
      node.__gpuPreview = computeInfo;
      this.fallbackToLegacyPreview(node);
    }
  }

  /**
   * Read back a (square) GPU texture and store it as a 64x64 thumbnail canvas on the node,
   * then request a redraw. Shared by the compute and fragment preview paths.
   * @param {GPUTexture} texture - Square source texture (must allow COPY_SRC)
   * @param {object} node - Node to attach the thumbnail to (sets node.__thumb)
   * @private
   */
  async _textureToThumbnail(texture, node) {
    if (!texture || !node) return;

    // Guard: copyTextureToBuffer requires COPY_SRC. Some textures (e.g. older compute outputs)
    // may not have it; throw so the caller falls back to the CPU preview instead of emitting a
    // GPU validation error on every frame.
    const COPY_SRC = (typeof GPUTextureUsage !== 'undefined' && GPUTextureUsage.COPY_SRC) || 0x10;
    if (typeof texture.usage === 'number' && !(texture.usage & COPY_SRC)) {
      throw new Error('preview texture is not readable (missing COPY_SRC)');
    }

    const pixels = await this.readbackComputeTexture(texture);
    const imageData = this.gpuRenderer.pixelsToImageData(pixels, texture.width);

    const thumbSize = this.previewThumbSize || 128;
    const canvas = document.createElement('canvas');
    canvas.width = thumbSize;
    canvas.height = thumbSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Stage the raw pixels, then scale into the thumbnail with high-quality filtering.
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, thumbSize, thumbSize);

    node.__thumb = canvas;

    if (window.editor?.markDirty) {
      window.editor.markDirty('node-thumbnail-update');
    }
  }

  /**
   * Readback a compute texture to CPU
   * @param {GPUTexture} texture - The texture to readback
   * @returns {Promise<Uint8Array>} Pixel data
   */
  async readbackComputeTexture(texture) {
    const size = texture.width;
    const bytesPerRow = Math.ceil((size * 4) / 256) * 256;
    const bufferSize = bytesPerRow * size;

    const buffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'compute-texture-readback'
    });

    const encoder = this.device.createCommandEncoder({
      label: 'compute-texture-readback-encoder'
    });

    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone?.();

    await buffer.mapAsync(GPUMapMode.READ);
    const mappedRange = buffer.getMappedRange();

    // Copy data with row padding handled
    const pixels = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * size * 4;
      const rowData = new Uint8Array(mappedRange, srcOffset, size * 4);
      pixels.set(rowData, dstOffset);
    }

    buffer.unmap();
    buffer.destroy();

    return pixels;
  }

  /**
   * Update preview for a non-compute node by rendering the real output of its subgraph
   * (this node + all upstream dependencies) to a small texture and reading it back.
   *
   * Delegates the heavy lifting to FragmentTextureRenderer, which already extracts the
   * subgraph, appends a fake OutputFinal, compiles it via buildWGSL({ skipCacheClear: true }),
   * builds the correct bind groups (u / g / u_params / textures / compute / samplers) and
   * caches per node. We force a re-render: preview updates are event-driven, and the
   * renderer's own change-detection only hashes the node's OWN params (so it would skip a
   * node whose upstream input changed). On any failure we fall back to the CPU approximation.
   * @param {object} node - The node to preview
   */
  async updateFragmentNodePreview(node) {
    if (!node?.id) return;
    this._syncDevice();

    try {
      const size = this.previewRenderSize || 256;
      const time = this._currentTime();
      const audioContext = this._currentAudioContext();

      const texture = await this.fragmentRenderer.renderNodeToTexture(
        node.id, size, size, time, audioContext, null, /* force */ true
      );

      if (!texture) {
        this.fallbackToLegacyPreview(node);
        return;
      }

      await this._textureToThumbnail(texture, node);
    } catch (error) {
      this.fallbackToLegacyPreview(node);
    }
  }

  /**
   * Fall back to legacy preview system
   * @param {object} node - The node
   */
  fallbackToLegacyPreview(node) {
    const ps = this.editor.previewSystem;
    if (!ps) return;
    // Use the CPU-only path directly so we don't re-enter the GPU router in
    // generateNodePreview() (which would loop back here on failure).
    if (typeof ps._generateCPUPreview === 'function') {
      ps._generateCPUPreview(node);
    } else {
      ps.generateNodePreview(node);
    }
  }

  /**
   * Set preview mode (enable/disable GPU preview and CPU readback)
   * @param {object} options - Preview mode options
   */
  setPreviewMode(options = {}) {
    if (options.enableGPUPreview !== undefined) {
      this.enableGPUPreview = options.enableGPUPreview;
    }

    if (options.enableCPUReadback !== undefined) {
      this.enableCPUReadback = options.enableCPUReadback;
    }

    if (options.previewSize !== undefined) {
      this.previewSize = options.previewSize;
    }
  }

  /**
   * Begin interaction (drag, edit, compile)
   * @param {string} type - Interaction type
   */
  beginInteraction(type) {
    switch (type) {
      case 'drag':
        this.throttler.beginDrag();
        break;
      case 'edit':
        this.throttler.beginEdit();
        break;
      case 'compile':
        this.throttler.beginCompile();
        break;
    }
  }

  /**
   * End interaction
   * @param {string} type - Interaction type
   */
  endInteraction(type) {
    switch (type) {
      case 'drag':
        this.throttler.endDrag();
        break;
      case 'edit':
        this.throttler.endEdit();
        break;
      case 'compile':
        this.throttler.endCompile();
        break;
    }

    // Trigger immediate update after interaction ends
    this.requestNodesPreviews(
      Array.from(this.pendingNodes).map(id =>
        this.editor.graph?.nodes?.find(n => n.id === id)
      ).filter(Boolean),
      true // immediate
    );
  }

  /**
   * Destroy preview texture for a specific node
   * @param {string} nodeId - Node ID
   */
  destroyPreviewTexture(nodeId) {
    if (this.gpuRenderer && typeof this.gpuRenderer.destroyPreviewTexture === 'function') {
      this.gpuRenderer.destroyPreviewTexture(nodeId);
    }
    // Free the per-node GPU preview texture so it is rebuilt at the right size next time.
    this.fragmentRenderer?.invalidateNode(nodeId);
    this.shaderCache.delete(nodeId);
    this.pendingNodes.delete(nodeId);
  }

  /**
   * Clear all preview caches. Call when the graph structure changes (nodes/connections),
   * so stale per-node preview textures don't linger.
   */
  clearCache() {
    this.gpuRenderer.clearCache();
    this.fragmentRenderer?.clearCache();
    this.shaderCache.clear();
  }

  /**
   * Dispose of the preview manager
   */
  dispose() {
    this.throttler.dispose();
    this.gpuRenderer.dispose();
    this.fragmentRenderer?.clearCache();
    this.shaderCache.clear();
    this.pendingNodes.clear();
  }
}
