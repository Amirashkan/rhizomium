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

      // Scalar output: still a renderable per-pixel FIELD (not a uniform value) when it derives
      // from an input — e.g. Remap / Posterize of a noise field, or VoronoiNoise's F1 (which
      // takes UV) — or when it exposes multiple outputs (generator-like). Only plain source
      // scalars with no inputs (ConstFloat / Time) are uniform; those stay on the CPU path.
      const hasInputs = (def?.inputs > 0) ||
        (Array.isArray(def?.pinsIn) && def.pinsIn.length > 0);
      const multiOutput = Array.isArray(def?.pinsOut) && def.pinsOut.length > 1;
      return hasInputs || multiOutput;
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
   * Downscale a GPU texture to a thumbnail-sized canvas on the node and request a redraw.
   * Shared by the compute and fragment preview paths.
   * @param {GPUTexture} texture - Sampleable source texture (any size)
   * @param {object} node - Node to attach the thumbnail to (sets node.__thumb)
   * @private
   */
  async _textureToThumbnail(texture, node) {
    if (!texture || !node) return;

    // The source must be sampleable — we downscale it on the GPU rather than copying it out.
    const TEXTURE_BINDING = (typeof GPUTextureUsage !== 'undefined' && GPUTextureUsage.TEXTURE_BINDING) || 0x04;
    if (typeof texture.usage === 'number' && !(texture.usage & TEXTURE_BINDING)) {
      throw new Error('preview source texture is not sampleable');
    }

    const thumbSize = this.previewThumbSize || 128;
    const pixels = await this._renderThumbnailReadback(texture, thumbSize);
    const imageData = this.gpuRenderer.pixelsToImageData(pixels, thumbSize);

    const canvas = document.createElement('canvas');
    canvas.width = thumbSize;
    canvas.height = thumbSize;
    canvas.getContext('2d').putImageData(imageData, 0, 0);

    node.__thumb = canvas;

    if (window.editor?.markDirty) {
      window.editor.markDirty('node-thumbnail-update');
    }
  }

  /**
   * Lazily build the downscale blit pipeline (a fullscreen-triangle pass that box-filters a
   * source texture). Rebuilt if the GPU device changes (reinit).
   * @private
   */
  _ensureDownsampler() {
    if (this._downsamplePipeline && this._downsampleDevice === this.device) return;
    const device = this.device;
    const module = device.createShaderModule({
      label: 'preview-downsample',
      code: `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VsOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VsOut;
  let xy = p[vid];
  o.pos = vec4<f32>(xy, 0.0, 1.0);
  o.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return o;
}
@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // 4-tap box around the destination texel; with a linear sampler each tap averages a 2x2
  // source cluster, approximating a box downscale (antialiasing for large source -> thumb ratios).
  let t = 0.5 / vec2<f32>(textureDimensions(tex, 0));
  var c = textureSampleLevel(tex, samp, uv + vec2<f32>(-t.x, -t.y), 0.0);
  c += textureSampleLevel(tex, samp, uv + vec2<f32>( t.x, -t.y), 0.0);
  c += textureSampleLevel(tex, samp, uv + vec2<f32>(-t.x,  t.y), 0.0);
  c += textureSampleLevel(tex, samp, uv + vec2<f32>( t.x,  t.y), 0.0);
  return c * 0.25;
}`,
    });
    this._downsamplePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      // rgba8unorm so the readback bytes are RGBA (matching ImageData) regardless of canvas format.
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this._downsampleSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this._downsampleDevice = device;
  }

  /**
   * GPU-downscale a source texture into a size x size RGBA texture and read THAT back. Sampling
   * antialiases, and reading back only size² keeps the GPU->CPU transfer tiny — the dominant
   * per-preview cost — independent of the (often much larger) source resolution.
   * @private
   */
  async _renderThumbnailReadback(srcTexture, size) {
    const device = this.device;
    this._ensureDownsampler();

    const dst = device.createTexture({
      size: [size, size, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      label: 'preview-thumb',
    });
    const bindGroup = device.createBindGroup({
      layout: this._downsamplePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this._downsampleSampler },
        { binding: 1, resource: srcTexture.createView() },
      ],
    });

    const bytesPerRow = Math.ceil((size * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'preview-thumb-readback',
    });

    const encoder = device.createCommandEncoder({ label: 'preview-thumb' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: dst.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this._downsamplePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: dst },
      { buffer, bytesPerRow },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);

    // mapAsync already waits for the submitted copy, so no separate onSubmittedWorkDone sync.
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      pixels.set(new Uint8Array(mapped, y * bytesPerRow, size * 4), y * size * 4);
    }
    buffer.unmap();
    buffer.destroy();
    dst.destroy();

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
