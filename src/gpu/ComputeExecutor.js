/**
 * ComputeExecutor
 * Manages execution of compute shader nodes in the node graph with dependency-aware execution
 *
 * Features:
 * - Topological sort: Executes compute nodes in dependency order (inputs before outputs)
 * - Output dictionary: Maintains a map of node outputs for propagation to dependent nodes
 * - Fallback values: Provides default textures for nodes that haven't been computed yet
 * - Change detection: Only re-dispatches nodes when inputs or parameters change
 * - Flexible API: Supports both ComputeNodeBase (unified API) and legacy ComputeShaderManager
 *
 * Execution Flow:
 * 1. Initialize: Create fallback texture, load compute nodes, compute execution order
 * 2. Execute: Dispatch nodes in topological order, update output dictionary after each dispatch
 * 3. Propagate: Provide computed outputs (or fallbacks) to dependent nodes
 *
 * Data Structures:
 * - nodeOutputs: Map<nodeId, GPUTexture> - Stores computed outputs for propagation
 * - executionOrder: Array<nodeId> - Topologically sorted node IDs for execution
 * - fallbackTexture: GPUTexture - 1x1 black texture used when dependencies aren't ready
 * - inputHashes: Map<nodeId, string> - Tracks input/parameter changes for selective updates
 */

import { ComputeShaderManager } from './ComputeShaderManager.js';
import { ComputeNodeBase } from './ComputeNodeBase.js';
import { FragmentTextureRenderer } from './FragmentTextureRenderer.js';
import { getPerfProbe } from '../utils/PerfProbe.js';

export class ComputeExecutor {
  constructor(device) {
    this.device = device;

    // Map of nodeId -> ComputeShaderManager or ComputeNodeBase
    this.computeManagers = new Map();

    // Map of nodeId -> ComputeNodeBase (for unified API nodes)
    this.computeNodes = new Map();

    // Map of nodeId -> { texture, sampler, bindGroup }
    this.computeTextures = new Map();

    // Map of nodeId -> input hash for detecting changes
    this.inputHashes = new Map();

    // Output dictionary for propagation (nodeId -> output texture)
    this.nodeOutputs = new Map();

    // Fallback texture for uncomputed nodes
    this.fallbackTexture = null;

    // Cached execution order
    this.executionOrder = [];

    // Track initialization state
    this.initialized = false;

    // Profiler reference (injected)
    this.profiler = null;

    // Fragment texture renderer for auto-bridging fragment→compute connections
    this.fragmentRenderer = new FragmentTextureRenderer(device);

    // Track which fragment nodes have been rendered this frame
    this.renderedFragmentNodes = new Set();

    // Track which compute nodes have been dispatched this frame (during _renderFragmentInputs)
    this.dispatchedThisFrame = new Set();

    // Re-entrancy guard: Prevent execute() from being called while already executing
    // This prevents infinite loops when auto-bridging or other side effects trigger renders
    this._isExecuting = false;

    // Callbacks flushed after GPU finishes the current frame via onSubmittedWorkDone().then().
    this._pendingDestroys = [];

    // Set true while initialize() is rebuilding managers so gpuRenderer won't flush
    // _pendingDestroys until the new textures are ready and bound.
    this._reinitializing = false;

    // Set for the duration of a reinitialize() pass. Lets initializeComputeNode
    // reuse an unchanged node's existing manager (preserving feedback ping-pong
    // state) instead of tearing it down and recreating it on every rebuild.
    this._reuseContext = null;

    // Serializes overlapping initialize() calls. initialize() clears
    // computeManagers up front and rebuilds asynchronously; if a second call
    // started mid-rebuild it would snapshot an already-empty manager map, defeat
    // the reuse path, and wipe every feedback node's accumulated state. _initInFlight
    // holds the running rebuild promise; _initQueued requests one more pass after it.
    this._initInFlight = null;
    this._initQueued = false;
  }

  _deferDestroy(fn) {
    this._pendingDestroys = this._pendingDestroys || [];
    this._pendingDestroys.push(fn);
  }

  // PERFORMANCE: Maximum resolution for compute nodes
  // For full HD preview (1920x1080), we use full resolution for compute nodes
  // Quality is maintained - optimizations come from smarter caching and dispatch logic
  static MAX_COMPUTE_RES = 2048; // High enough to support full HD and beyond

  /**
   * Clear fragment render cache
   * Call this when graph structure changes (nodes added/removed, connections changed)
   */
  clearFragmentCache() {
    this.renderedFragmentNodes.clear();
    if (this.fragmentRenderer) {
      // Use the new clearCache method which also clears parameter hashes
      if (this.fragmentRenderer.clearCache) {
        this.fragmentRenderer.clearCache();
      } else {
        // Fallback for older versions
        if (this.fragmentRenderer.textureCache) {
          this.fragmentRenderer.textureCache.clear();
        }
        if (this.fragmentRenderer.shaderCache) {
          this.fragmentRenderer.shaderCache.clear();
        }
        if (this.fragmentRenderer.parameterHashes) {
          this.fragmentRenderer.parameterHashes.clear();
        }
      }
    }
  }

  /**
   * Initialize compute nodes from registry.
   *
   * Re-entrancy guard: graph edits (param drags, node moves, selection changes)
   * funnel through updateShaderFromGraph -> initialize(), which is async and can
   * span several frames while GPU pipelines build. If a second call landed while
   * the first was still awaiting, it would snapshot an already-cleared manager
   * map and rebuild every node from scratch — wiping the ping-pong state of every
   * feedback node (ComputeFeedback, ComputeFeedbackField, reaction-diffusion).
   * Overlapping calls are coalesced into the in-flight pass plus at most one
   * follow-up pass, so reuse always sees the previous managers.
   */
  async initialize() {
    if (this._initInFlight) {
      // A rebuild is already running; ask it to run once more when it finishes so
      // the latest registry state is picked up, then share its completion.
      this._initQueued = true;
      return this._initInFlight;
    }

    const run = (async () => {
      do {
        this._initQueued = false;
        await this._initializeOnce();
      } while (this._initQueued);
    })();

    this._initInFlight = run;
    try {
      await run;
    } finally {
      this._initInFlight = null;
    }
  }

  /**
   * Perform a single initialize pass. Always invoked through initialize(), which
   * serializes overlapping calls — never call this directly.
   */
  async _initializeOnce() {
    if (!window.computeNodeRegistry || window.computeNodeRegistry.size === 0) {
      return;
    }

    // Clean up old resources if reinitializing
    let reuseContext = null;
    let oldFallback = null;
    if (this.initialized) {
      // Hold old textures alive until the new managers are ready and bound.
      // gpuRenderer checks _reinitializing before flushing _pendingDestroys, so
      // the old GPUTextures won't be destroyed until after _reinitializing = false.
      this._reinitializing = true;

      // Snapshot the previous managers/textures so nodes whose generated WGSL,
      // resolution and feedback/input config are unchanged can keep their
      // existing manager. This is what stops feedback nodes (ComputeFeedback,
      // ComputeFeedbackField, reaction-diffusion, etc.) from losing their
      // accumulated ping-pong state every time an unrelated canvas edit triggers
      // a rebuild. Only managers that are NOT reused get destroyed below.
      reuseContext = {
        previousManagers: new Map(this.computeManagers),
        previousTextures: new Map(this.computeTextures),
        reused: new Set(),
      };
      oldFallback = this.fallbackTexture;

      this.fallbackTexture = null;
      this.computeManagers.clear();
      this.computeNodes.clear();
      this.computeTextures.clear();
      this.inputHashes.clear();
      // nodeOutputs is intentionally NOT cleared here. Old entries keep the
      // previous output textures alive so _lookupTextureBinding continues
      // returning the last-dispatched (visually correct) texture while new
      // managers initialise. As each new manager dispatches for the first
      // time it calls nodeOutputs.set(nodeId, newTexture), which is then
      // detected as a change by _updateComputeTextureBindings → bind groups
      // are rebuilt, and the fence safely destroys the old texture afterward.
      this.executionOrder = [];

      // Invalidate fragment renderer caches so all fragment nodes re-render at
      // the new resolution/state. Without this, stale cached textures (rendered
      // before the resize) are returned to downstream compute nodes because
      // _checkFragmentNodeNeedsRender sees an unchanged parameter hash and skips
      // the render — producing "wrong visual" until a parameter change triggers
      // a forced re-render. clearFragmentCache() defers old texture destruction
      // via _deferDestroy, so it is safe to call while _reinitializing = true.
      this.clearFragmentCache();
    }

    // Expose the reuse snapshot to initializeComputeNode for the duration of
    // this pass only.
    this._reuseContext = reuseContext;

    // Create fallback texture
    this.createFallbackTexture();

    for (const [nodeId, nodeData] of window.computeNodeRegistry) {
      await this.initializeComputeNode(nodeId, nodeData);
    }

    this._reuseContext = null;

    // Tear down the previous resources that were NOT reused this pass. Deferred
    // so the old textures stay alive until the freshly built/reused bind groups
    // are bound (gpuRenderer waits on _reinitializing before flushing).
    if (reuseContext) {
      const { previousManagers, previousTextures, reused } = reuseContext;
      const staleOutputs = new Set();
      for (const [id, m] of previousManagers) {
        if (reused.has(id)) continue;
        const tex = typeof m.getOutputTexture === 'function' ? m.getOutputTexture() : null;
        if (tex) staleOutputs.add(tex);
      }
      this._deferDestroy(() => {
        // Before destroying the old textures, repoint any nodeOutputs entries
        // still referencing a destroyed (non-reused) manager's output at the new
        // manager's output. Nodes that never re-dispatch after reinit (static
        // inputs, dispatch errors) would otherwise keep feeding destroyed
        // textures into bind groups, failing every submit.
        for (const [id, tex] of this.nodeOutputs) {
          if (staleOutputs.has(tex)) {
            const fresh = this.computeTextures.get(id)?.texture;
            if (fresh) {
              this.nodeOutputs.set(id, fresh);
            } else {
              this.nodeOutputs.delete(id);
            }
          }
        }
        for (const [id, m] of previousManagers) {
          if (reused.has(id)) continue;
          m.destroy();
        }
        oldFallback?.destroy();
        // Drop snapshot references so the reused/destroyed managers aren't
        // pinned alive by this closure after it runs.
        previousManagers.clear();
        previousTextures.clear();
      });
    }

    this.updateExecutionOrder();
    this.initialized = true;
    this._reinitializing = false;
  }

  /**
   * Initialize a single compute node
   */
  async initializeComputeNode(nodeId, nodeData) {
    try {
      const { node, wgslCode, resolution, supportsFeedback } = nodeData;

      // Use preview resolution setting to maintain full quality
      // Resolution follows the preview settings - optimizations come from smart caching
      const MAX_COMPUTE_RES = ComputeExecutor.MAX_COMPUTE_RES;
      const DEFAULT_COMPUTE_RES = 1024;

      // Get preview resolution from settings
      let baseWidth = DEFAULT_COMPUTE_RES;
      let baseHeight = DEFAULT_COMPUTE_RES;

      if (window.floatingPreview?.settings?.settings?.resolution) {
        const previewRes = window.floatingPreview.settings.settings.resolution;
        baseWidth = previewRes.width || DEFAULT_COMPUTE_RES;
        baseHeight = previewRes.height || DEFAULT_COMPUTE_RES;
      }

      let width = baseWidth;
      let height = baseHeight;

      // If the node has a custom resolution setting, use it
      if (node.computeResolution) {
        width = node.computeResolution[0] || baseWidth;
        height = node.computeResolution[1] || baseHeight;
      } else if (resolution && resolution[0] > 0 && resolution[1] > 0) {
        // Use node's specified resolution if provided
        width = resolution[0];
        height = resolution[1];
      }

      // Cap at maximum supported resolution only (no quality reduction)
      width = Math.min(width, MAX_COMPUTE_RES);
      height = Math.min(height, MAX_COMPUTE_RES);

      // Ensure we have valid dimensions before initializing
      if (!width || !height || width <= 0 || height <= 0) {
        width = DEFAULT_COMPUTE_RES;
        height = DEFAULT_COMPUTE_RES;
      }

      // Detect if this node needs input textures from other compute nodes
      // Check both the node definition (how many inputs it's designed for) and actual connections
      // Nodes like ComputeBlur and ComputeFeedback are designed to take inputs
      //
      // IMPORTANT: When adding a new compute node that requires input textures,
      // you MUST add its name to this list. Otherwise, the bind group layout won't
      // include bindings for @binding(2) inputTexture and @binding(3) texSampler,
      // causing WebGPU validation errors like "Binding doesn't exist in BindGroupLayoutInternal"
      const nodeDesignedForInput = ['ComputeBlur', 'ComputeFeedback', 'ComputeFeedbackField',
                                     'ComputeConvolution', 'ComputeFluidSim', 'ComputeParticles',
                                     'ComputeThreshold', 'ComputeColorAdjust', 'ComputeEdgeDetect',
                                     'ComputeMorphology', 'ComputeWarp', 'ComputeKaleidoscope', 'ComputeGlitch', 'ComputeMix', 'ComputeTransform', 'ComputeChannels', 'ComputeHSV', 'ComputeHistogram', 'ComputeLuminance'].includes(node.kind);
      const needsInput = nodeDesignedForInput;

      // Reuse signature: a node can keep its existing manager (and its
      // accumulated feedback state) across a rebuild only if everything that
      // shapes the GPU pipeline/textures is identical. Parameters that map to
      // uniforms (decay, scale, offset, …) don't appear here because they don't
      // change the WGSL, so tweaking them no longer wipes the feedback buffer.
      const initSignature = `${node.kind}|${width}x${height}|fb${supportsFeedback ? 1 : 0}|in${needsInput ? 1 : 0}|${wgslCode}`;

      // Reuse an unchanged node's manager during a reinitialize() pass.
      const reuseContext = this._reuseContext;
      if (reuseContext && !reuseContext.reused.has(nodeId)) {
        const prev = reuseContext.previousManagers.get(nodeId);
        if (prev && prev._initSignature === initSignature) {
          prev.node = node; // keep the live node reference current for params
          reuseContext.reused.add(nodeId);
          this.computeManagers.set(nodeId, prev);
          const prevTex = reuseContext.previousTextures.get(nodeId);
          if (prevTex) {
            this.computeTextures.set(nodeId, prevTex);
          }
          return;
        }
      }

      // Create compute shader manager with node reference for parameters
      const manager = new ComputeShaderManager(this.device, node);
      await manager.initialize(wgslCode, width, height, supportsFeedback, needsInput);
      manager._initSignature = initSignature;

      // Store manager
      this.computeManagers.set(nodeId, manager);

      // Create sampler for this texture
      const sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat'
      });

      // Get output texture
      const outputTexture = manager.getOutputTexture();
      if (!outputTexture) {
        throw new Error(`Manager failed to create output texture for ${nodeId}`);
      }

      // Store texture and sampler
      this.computeTextures.set(nodeId, {
        texture: outputTexture,
        sampler,
        manager
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Clear the feedback/ping-pong state for a single node (Feedback node reset
   * button). nodeId is the raw graph id; managers are keyed by the sanitized
   * registry key, so sanitize the same way registerComputeNode does.
   * @param {string|number} nodeId
   * @returns {boolean} true if a feedback manager was found and cleared
   */
  resetNodeFeedback(nodeId) {
    const key = String(nodeId).replace(/[^a-zA-Z0-9_]/g, '_');
    const manager = this.computeManagers.get(key) || this.computeManagers.get(nodeId);
    if (manager && typeof manager.clearFeedback === 'function') {
      manager.clearFeedback();
      return true;
    }
    return false;
  }

  /**
   * Create fallback texture for uncomputed nodes
   */
  createFallbackTexture() {
    // Create a small 1x1 black texture as fallback
    const fallbackData = new Uint8Array([0, 0, 0, 255]); // Black pixel

    this.fallbackTexture = this.device.createTexture({
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    this.device.queue.writeTexture(
      { texture: this.fallbackTexture },
      fallbackData,
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );
  }

  /**
   * Update execution order using topological sort
   */
  updateExecutionOrder() {
    if (!window.graph || !window.graph.nodes) {
      this.executionOrder = Array.from(this.computeManagers.keys());
      return;
    }

    try {
      // Filter to only compute nodes
      const computeNodeIds = new Set(this.computeManagers.keys());
      const computeNodes = window.graph.nodes.filter(node =>
        node && node.id && computeNodeIds.has(node.id)
      );

      if (computeNodes.length === 0) {
        this.executionOrder = [];
        return;
      }

      // Build dependency graph
      const byId = new Map();
      for (const node of computeNodes) {
        byId.set(node.id, node);
      }

      // Topological sort using DFS
      const visited = new Set();
      const visiting = new Set();
      const result = [];

      const visit = (id) => {
        if (!id || visited.has(id)) return;

        if (visiting.has(id)) {
          return;
        }

        visiting.add(id);

        const node = byId.get(id);
        if (!node) {
          visiting.delete(id);
          return;
        }

        // Visit dependencies first (inputs)
        if (node.inputs && Array.isArray(node.inputs)) {
          for (const inputId of node.inputs) {
            if (inputId !== null && inputId !== undefined && computeNodeIds.has(inputId)) {
              visit(inputId);
            }
          }
        }

        visiting.delete(id);
        visited.add(id);
        result.push(id);
      };

      // Visit all compute nodes
      for (const node of computeNodes) {
        visit(node.id);
      }

      this.executionOrder = result;
    } catch (error) {
      this.executionOrder = Array.from(this.computeManagers.keys());
    }
  }

  /**
   * Set profiler for performance tracking
   */
  setProfiler(profiler) {
    this.profiler = profiler;
  }

  /**
   * Render a fragment node to texture, ensuring its compute dependencies are dispatched first
   * @param {string} fragmentNodeId - Fragment node to render
   * @param {number} width - Texture width
   * @param {number} height - Texture height
   * @param {GPUCommandEncoder} commandEncoder - Shared command encoder
   * @param {number} time - Current time
   * @param {Object} audioContext - Audio context
   * @private
   */
  async _renderFragmentNodeWithDependencies(fragmentNodeId, width, height, commandEncoder, time, audioContext) {
    // Get the fragment node
    const fragmentNode = window.graph?.getNode(fragmentNodeId);
    if (!fragmentNode) return null;

    // Check if this fragment node has compute node inputs
    if (fragmentNode.inputs && Array.isArray(fragmentNode.inputs)) {
      for (const inputId of fragmentNode.inputs) {
        if (inputId === null || inputId === undefined) continue;

        // If this input is a compute node, ensure it's been dispatched first
        if (this.computeManagers.has(inputId)) {
          await this._dispatchComputeNodeIfNeeded(inputId, commandEncoder, time, audioContext);
        }
      }
    }

    // Now render the fragment node to a texture
    const texture = await this.fragmentRenderer.renderNodeToTexture(
      fragmentNodeId,
      width,
      height,
      time,
      audioContext,
      commandEncoder
    );

    return texture;
  }

  /**
   * Dispatch a compute node if it hasn't been dispatched yet this frame
   * @param {string} nodeId - Compute node ID
   * @param {GPUCommandEncoder} commandEncoder - Command encoder
   * @param {number} time - Current time
   * @param {Object} audioContext - Audio context
   * @private
   */
  async _dispatchComputeNodeIfNeeded(nodeId, commandEncoder, time, audioContext) {
    // Check if already dispatched during this execute() call
    if (this.dispatchedThisFrame.has(nodeId)) {
      return; // Already dispatched this frame
    }

    const manager = this.computeManagers.get(nodeId);
    if (!manager) return;

    const nodeData = window.computeNodeRegistry?.get(nodeId);
    const node = nodeData?.node;
    if (!node) return;

    // Recursively dispatch compute dependencies first
    if (node.inputs && Array.isArray(node.inputs)) {
      for (const inputId of node.inputs) {
        if (inputId !== null && inputId !== undefined && this.computeManagers.has(inputId)) {
          await this._dispatchComputeNodeIfNeeded(inputId, commandEncoder, time, audioContext);
        }
      }
    }

    // Set input textures if needed
    if (node.inputs && Array.isArray(node.inputs) && node.inputs.length > 0) {
      const inputNodeId = node.inputs[0];
      if (inputNodeId !== null && inputNodeId !== undefined) {
        const inputTexture = this.nodeOutputs.get(inputNodeId);
        if (inputTexture && manager.setInputTexture) {
          manager.setInputTexture(inputTexture);
          if (manager.recreateBindGroup) {
            manager.recreateBindGroup();
          }
        }
      }

      // Handle second input for ComputeWarp and ComputeMix
      if ((node.kind === 'ComputeWarp' || node.kind === 'ComputeMix') && node.inputs.length > 1) {
        const secondInputId = node.inputs[1];
        if (secondInputId !== null && secondInputId !== undefined) {
          const secondTexture = this.nodeOutputs.get(secondInputId);
          if (secondTexture && manager.setWarpFieldTexture) {
            manager.setWarpFieldTexture(secondTexture);
          }
        }
      }
    }

    // Dispatch the compute node
    try {
      if (manager instanceof ComputeNodeBase) {
        manager.dispatch(this.device, commandEncoder, time, audioContext);
      } else {
        manager.dispatch(commandEncoder, time, this.profiler, audioContext);
      }

      // Update output dictionary
      this.updateNodeOutput(nodeId, manager);

      // Mark as dispatched this frame
      this.dispatchedThisFrame.add(nodeId);
    } catch (error) {
      // Silently handle errors
    }
  }

  /**
   * Render fragment node inputs to textures (auto-bridging)
   * This enables fragment nodes to be used as inputs to compute nodes
   * @param {GPUCommandEncoder} commandEncoder - Shared command encoder for synchronization
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values
   */
  async _renderFragmentInputs(commandEncoder, time, audioContext) {
    if (!window.graph || !window.graph.nodes) {
      return;
    }

    // PERFORMANCE: Early exit if no fragment inputs need rendering
    // This avoids expensive iteration when there are no fragment→compute connections
    let hasFragmentInputs = false;
    for (const nodeId of this.executionOrder) {
      const nodeData = window.computeNodeRegistry?.get(nodeId);
      const node = nodeData?.node;
      if (node?.inputs && Array.isArray(node.inputs)) {
        for (const inputNodeId of node.inputs) {
          if (inputNodeId !== null && inputNodeId !== undefined && !this.computeManagers.has(inputNodeId)) {
            hasFragmentInputs = true;
            break;
          }
        }
        if (hasFragmentInputs) break;
      }
    }
    
    if (!hasFragmentInputs) {
      this.fragmentNodesRenderedThisFrame = new Set();
      return;
    }

    // Track which compute nodes need their input hashes invalidated
    const computeNodesToClearHash = new Set();
    
    // Track which fragment nodes were actually re-rendered this frame (changed)
    // This is used to determine if compute nodes depending on them need to dispatch
    this.fragmentNodesRenderedThisFrame = new Set();

    // Check each compute node for fragment inputs
    for (const nodeId of this.executionOrder) {
      const manager = this.computeManagers.get(nodeId);
      if (!manager) continue;

      const nodeData = window.computeNodeRegistry?.get(nodeId);
      const node = nodeData?.node;
      if (!node || !node.inputs || !Array.isArray(node.inputs)) continue;

      // Check each input
      for (const inputNodeId of node.inputs) {
        if (inputNodeId === null || inputNodeId === undefined) continue;

        // Skip if already rendered this frame
        if (this.renderedFragmentNodes.has(inputNodeId)) continue;

        // Check if this input is a fragment node (not a compute node)
        const isComputeNode = this.computeManagers.has(inputNodeId);
        if (isComputeNode) continue;

        // Check if the node exists in the graph
        const inputNode = window.graph.getNode(inputNodeId);
        if (!inputNode) {
          continue;
        }

        // This is a fragment node being used as compute input!
        try {
          // Use the same resolution as the compute node (follows preview settings)
          const resolution = nodeData.resolution || [1024, 1024];
          // Get preview resolution if available
          let width = resolution[0] || 1024;
          let height = resolution[1] || 1024;
          
          if (window.floatingPreview?.settings?.settings?.resolution) {
            const previewRes = window.floatingPreview.settings.settings.resolution;
            width = previewRes.width || width;
            height = previewRes.height || height;
          }
          
          const MAX_COMPUTE_RES = ComputeExecutor.MAX_COMPUTE_RES;
          width = Math.min(width, MAX_COMPUTE_RES);
          height = Math.min(height, MAX_COMPUTE_RES);


          // Render the fragment node WITH its compute dependencies dispatched first
          const texture = await this._renderFragmentNodeWithDependencies(
            inputNodeId,
            width,
            height,
            commandEncoder,
            time,
            audioContext
          );

          if (texture) {
            // Store in nodeOutputs so ComputeExecutor can find it
            this.nodeOutputs.set(inputNodeId, texture);
            this.renderedFragmentNodes.add(inputNodeId);
            // Mark that this fragment node was rendered this frame (changed)
            this.fragmentNodesRenderedThisFrame.add(inputNodeId);

            // Mark this compute node's hash for invalidation
            computeNodesToClearHash.add(nodeId);
          }
        } catch (error) {
          // Silently handle errors
        }
      }
    }

    // Invalidate input hashes for compute nodes that had fragment inputs re-rendered
    for (const nodeId of computeNodesToClearHash) {
      this.inputHashes.delete(nodeId);
    }
  }

  /**
   * Execute all compute shaders
   * Should be called before fragment shader execution
   * @param {GPUCommandEncoder} commandEncoder - WebGPU command encoder
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values for expression evaluation
   */
  async execute(commandEncoder, time = 0, audioContext = {}) {
    // CRITICAL: Re-entrancy guard to prevent infinite loops
    // If execute() is called while already executing (e.g., from auto-bridging side effects),
    // skip this call to break the infinite loop
    if (this._isExecuting) {
      return;
    }

    if (!this.initialized || this.computeManagers.size === 0) {
      return;
    }

    // Set the executing flag
    this._isExecuting = true;

    // PerfProbe: wall time of the execute pass. This is mostly synchronous
    // main-thread work (encoding dispatches, hashing params); awaited
    // sub-steps can add microtask latency, so treat spikes as upper bounds.
    const probe = getPerfProbe();
    const probeToken = probe.begin("computeExecWall");

    try {
      // Clear the dispatched-this-frame tracking
      this.dispatchedThisFrame.clear();
      // Clear fragment nodes rendered this frame (will be repopulated by _renderFragmentInputs)
      this.fragmentNodesRenderedThisFrame = new Set();

      // STEP 1: Render fragment node inputs to textures (auto-bridging)
      // Pass the shared command encoder so fragment renders and compute dispatches
      // are in the same GPU command buffer submission (proper synchronization!)
      await this._renderFragmentInputs(commandEncoder, time, audioContext);

    // STEP 2: Execute compute nodes in topological order (dependencies first)
    for (const nodeId of this.executionOrder) {
      // Skip if already dispatched during _renderFragmentInputs
      if (this.dispatchedThisFrame.has(nodeId)) {
        continue;
      }

      const manager = this.computeManagers.get(nodeId);
      if (!manager) {
        continue;
      }

      try {
        // Get node data to check if it's time-dependent
        const nodeData = window.computeNodeRegistry?.get(nodeId);
        const node = nodeData?.node;

        // BYPASS: a bypassed compute node passes its first input straight through. Alias its
        // output texture to the input's texture and skip the dispatch (saving the GPU work).
        // Mark it dispatched so downstream nodes pick up the aliased input. (A generator with no
        // input has nothing to pass through, so it falls through and runs normally.)
        if (node?.bypassed) {
          const inputId = Array.isArray(node.inputs) ? node.inputs.find((i) => i != null) : null;
          const inputTexture = inputId != null ? this.nodeOutputs.get(inputId) : null;
          if (inputTexture) {
            this.nodeOutputs.set(nodeId, inputTexture);
            const info = this.computeTextures.get(nodeId);
            if (info) info.texture = inputTexture;
            else this.computeTextures.set(nodeId, { texture: inputTexture });
            this.dispatchedThisFrame.add(nodeId);
            continue;
          }
        }

        // Check if inputs have changed (for optimization)
        // PERFORMANCE: Only mark fragment inputs as needing update if fragment node actually changed
        // Fragment nodes are cached, so we only need to update when their inputs/params change
        const hasFragmentInput = node?.inputs && Array.isArray(node.inputs) && node.inputs.some(inputId => {
          if (inputId === null || inputId === undefined) return false;
          const inputNode = window.graph?.getNode(inputId);
          return inputNode && !inputNode.kind.startsWith('Compute');
        });
        
        // Only update if fragment input was re-rendered this frame (indicating it changed)
        // fragmentNodesRenderedThisFrame is set in _renderFragmentInputs before execute() processes nodes
        const fragmentInputChanged = hasFragmentInput && node?.inputs && Array.isArray(node.inputs) &&
          node.inputs.some(inputId => {
            if (inputId === null || inputId === undefined) return false;
            return this.fragmentNodesRenderedThisFrame && this.fragmentNodesRenderedThisFrame.has(inputId);
          });
        
        const shouldUpdate = fragmentInputChanged || this.checkInputsChanged(nodeId);

        // ONLY dispatch truly time-dependent compute nodes every frame
        // Time-dependent nodes have animation or evolve over time without input changes
        // Most compute nodes (ColorAdjust, Blur, Threshold, etc.) should ONLY run when inputs change
        const TIME_DEPENDENT_NODES = [
          'ComputeNoise',              // Has time parameter
          'ComputeReactionDiffusion',  // Time-based evolution
          'ComputeFeedback',           // Needs every-frame feedback
          'ComputeFeedbackField',      // Needs every-frame feedback
          'ComputeFluidSim',           // Time-based physics
          'ComputeParticles'           // Time-based animation
        ];
        const isTimeDependentNode = node?.kind && TIME_DEPENDENT_NODES.includes(node.kind);

        // Check if node has time-dependent parameters (expressions with time or audioEnvelope)
        // This ensures nodes with expressions like "=time" are dispatched every frame
        const hasTimeDependentParams = this.hasTimeDependentParameters(node);

        // Check if node has node reference parameters (expressions like =node_5 or =node_5.x)
        // PERFORMANCE: Only dispatch if referenced nodes are time-dependent or have been updated
        // This prevents unnecessary dispatches when referenced values are static
        const hasNodeRefParams = this.hasNodeReferenceParameters(node) && 
          this.hasTimeDependentReferencedNodes(node);

        // Check if node has compute inputs that were DISPATCHED this frame
        // CRITICAL FIX: Only re-dispatch if upstream compute nodes actually ran this frame
        // This prevents cascading updates when upstream nodes are static, but allows
        // propagation when upstream nodes update (even if texture reference stays same)
        const hasUpdatedComputeInput = node?.inputs && Array.isArray(node.inputs) &&
          node.inputs.some(inputId => {
            if (inputId === null || inputId === undefined) return false;
            if (!this.computeManagers.has(inputId)) return false;
            // Check if this compute input was dispatched this frame
            return this.dispatchedThisFrame.has(inputId);
          });

        // PERFORMANCE: Only dispatch if node actually needs to update
        // This prevents unnecessary GPU work and maintains 60 FPS
        const needsDispatch = shouldUpdate || isTimeDependentNode || hasTimeDependentParams || hasNodeRefParams || hasUpdatedComputeInput;
        
        if (needsDispatch) {
          // OPTIMIZATION: Only set input textures when we're actually dispatching
          // This avoids unnecessary setInputTexture() and recreateBindGroup() calls
          if (node?.inputs && Array.isArray(node.inputs) && node.inputs.length > 0) {
            const inputNodeId = node.inputs[0];
            if (inputNodeId !== null && inputNodeId !== undefined) {
              const inputTexture = this.nodeOutputs.get(inputNodeId);
              if (inputTexture) {
                if (manager.setInputTexture) {
                  manager.setInputTexture(inputTexture);
                  // Recreate bind group with new input texture
                  if (manager.recreateBindGroup) {
                    manager.recreateBindGroup();
                  }
                }
              }
            }

            // Special case: ComputeWarp has a second input (warp field)
            if (node.kind === 'ComputeWarp' && node.inputs.length > 1) {
              const warpFieldNodeId = node.inputs[1];
              if (warpFieldNodeId !== null && warpFieldNodeId !== undefined) {
                const warpFieldTexture = this.nodeOutputs.get(warpFieldNodeId);
                if (warpFieldTexture && manager.setWarpFieldTexture) {
                  manager.setWarpFieldTexture(warpFieldTexture);
                }
              }
            }

            // Special case: ComputeMix has a second input (Input B for blending)
            if (node.kind === 'ComputeMix' && node.inputs.length > 1) {
              const inputBNodeId = node.inputs[1];
              if (inputBNodeId !== null && inputBNodeId !== undefined) {
                const inputBTexture = this.nodeOutputs.get(inputBNodeId);
                if (inputBTexture && manager.setWarpFieldTexture) {
                  // Reuse setWarpFieldTexture for the second input (binding 4)
                  manager.setWarpFieldTexture(inputBTexture);
                }
              }
            }
          }

          // Check if this is a ComputeNodeBase instance or legacy ComputeShaderManager
          if (manager instanceof ComputeNodeBase) {
            manager.dispatch(this.device, commandEncoder, time, audioContext);
          } else {
            manager.dispatch(commandEncoder, time, this.profiler, audioContext);
          }

          // Update output dictionary after successful dispatch
          this.updateNodeOutput(nodeId, manager);

          // CRITICAL: Mark node as dispatched so downstream nodes know to update
          this.dispatchedThisFrame.add(nodeId);
        }
        // Skipping dispatch is normal behavior when inputs haven't changed
      } catch (error) {
        // Drop the recorded input hash so this node retries next frame.
        // checkInputsChanged() records the hash BEFORE dispatch, so a failed
        // dispatch would otherwise leave the node stuck serving its stale
        // output texture — which the deferred-destroy flush later destroys,
        // producing endless "Destroyed texture used in a submit" errors.
        this.inputHashes.delete(nodeId);
      }
    }
    } finally {
      // CRITICAL: Always reset the executing flag, even if there was an error
      this._isExecuting = false;

      probe.end(probeToken);
      if (this.dispatchedThisFrame.size > 0) {
        probe.count("computeDispatches", this.dispatchedThisFrame.size);
      }

      // Clear rendered fragment nodes for the next frame
      // This allows time-dependent fragment nodes (like SimplexNoise) to re-render
      this.renderedFragmentNodes.clear();
    }
  }

  /**
   * Update node output in the dictionary after successful dispatch
   */
  updateNodeOutput(nodeId, manager) {
    try {
      const outputTexture = manager.getOutputTexture();
      if (outputTexture) {
        this.nodeOutputs.set(nodeId, outputTexture);
      }
    } catch (error) {
      // Silently handle errors
    }
  }

  /**
   * Get output texture for a node (with fallback)
   * @param {string} nodeId - Node ID
   * @returns {GPUTexture} Output texture or fallback
   */
  getNodeOutput(nodeId) {
    const output = this.nodeOutputs.get(nodeId);
    if (output) {
      return output;
    }

    // Return fallback texture for uncomputed nodes
    return this.fallbackTexture;
  }

  /**
   * Check if a node has time-dependent parameters (expressions with time or audioEnvelope)
   * @param {Object} node - The node to check
   * @returns {boolean} True if node has time-dependent parameters
   */
  hasTimeDependentParameters(node) {
    if (!node || !node.params) return false;

    // Check all parameter values for time-dependent expressions
    for (const [key, value] of Object.entries(node.params)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Check if parameter contains time or audio envelope references
        if (/time|audioEnvelope/i.test(trimmed)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a node has node reference parameters (expressions like =node_5 or =node_5.x)
   * @param {Object} node - The node to check
   * @returns {boolean} True if node has node reference parameters
   */
  hasNodeReferenceParameters(node) {
    if (!node || !node.params) return false;

    // Check all parameter values for node reference expressions
    for (const value of Object.values(node.params)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Check if parameter contains node reference (=node_X or =node_X.component)
        if (/=\s*node_\d+/.test(trimmed)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if any referenced nodes (via node reference parameters) are time-dependent
   * This helps avoid unnecessary dispatches when referenced values are static
   */
  hasTimeDependentReferencedNodes(node) {
    if (!node || !node.params) return false;

    // Extract node IDs from parameter expressions
    const referencedNodeIds = new Set();
    for (const value of Object.values(node.params)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Match =node_X or =node_X.component patterns
        const matches = trimmed.match(/=\s*node_(\d+)/g);
        if (matches) {
          for (const match of matches) {
            const nodeId = match.replace(/=\s*node_/, '');
            referencedNodeIds.add(nodeId);
          }
        }
      }
    }

    // Check if any referenced nodes are time-dependent
    if (referencedNodeIds.size === 0) return false;

    // Check if any referenced node is time-dependent
    for (const refNodeId of referencedNodeIds) {
      const refNodeData = window.computeNodeRegistry?.get(refNodeId);
      const refNode = refNodeData?.node;
      if (refNode) {
        // Check if referenced node has time-dependent parameters
        if (this.hasTimeDependentParameters(refNode)) {
          return true;
        }
        // Check if referenced node is a time-dependent compute node type
        const TIME_DEPENDENT_NODES = [
          'ComputeNoise', 'ComputeReactionDiffusion', 'ComputeFeedback',
          'ComputeFeedbackField', 'ComputeFluidSim', 'ComputeParticles'
        ];
        if (refNode.kind && TIME_DEPENDENT_NODES.includes(refNode.kind)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if inputs to a compute node have changed
   * Returns true if node should be re-dispatched
   */
  checkInputsChanged(nodeId) {
    const nodeData = window.computeNodeRegistry?.get(nodeId);
    if (!nodeData) return true;

    try {
      const node = nodeData.node;
      if (!node || !node.inputs) return true;

      // Build hash of inputs and parameters
      let hash = '';

      // Hash input node outputs
      for (const inputId of node.inputs) {
        if (inputId !== null && inputId !== undefined) {
          const inputTexture = this.nodeOutputs.get(inputId);
          // Use texture memory address as part of hash
          hash += inputTexture ? `${inputId}:computed;` : `${inputId}:missing;`;
        }
      }

      // Hash parameters
      if (node.params) {
        hash += JSON.stringify(node.params);
      }

      // Check if hash changed
      const previousHash = this.inputHashes.get(nodeId);
      const changed = hash !== previousHash;

      if (changed) {
        this.inputHashes.set(nodeId, hash);
      }

      return changed;
    } catch (error) {
      return true; // Update on error to be safe
    }
  }

  /**
   * Get texture bindings for all compute nodes
   * Returns array of { binding, resource } for WGSL @group(0) @binding(N)
   * NOTE: Binding indices MUST match those in glslBuilder.js
   */
  getTextureBindings() {
    const bindings = [];
    let bindingIndex = 100; // Start at high index to avoid conflicts

    for (const [nodeId, textureData] of this.computeTextures) {
      const { texture, sampler } = textureData;
      const sanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");

      // Add texture binding
      bindings.push({
        nodeId: sanitizedId,
        name: `compute_${sanitizedId}`,
        textureBinding: bindingIndex++,
        samplerBinding: bindingIndex++,
        texture,
        sampler
      });
    }

    return bindings;
  }

  /**
   * Generate WGSL binding declarations for compute textures
   */
  generateBindingDeclarations() {
    let wgsl = '\n// Compute Shader Texture Bindings\n';

    const bindings = this.getTextureBindings();

    for (const binding of bindings) {
      wgsl += `@group(0) @binding(${binding.textureBinding}) var ${binding.name}: texture_2d<f32>;\n`;
      wgsl += `@group(0) @binding(${binding.samplerBinding}) var sampler_${binding.name}: sampler;\n`;
    }

    return wgsl;
  }

  /**
   * Get all compute texture for creating bind groups
   */
  getBindGroupEntries(startBinding = 100) {
    const entries = [];

    for (const binding of this.getTextureBindings()) {
      entries.push({
        binding: binding.textureBinding,
        resource: binding.texture.createView()
      });
      entries.push({
        binding: binding.samplerBinding,
        resource: binding.sampler
      });
    }

    return entries;
  }

  /**
   * Clear all compute nodes and resources
   */
  clear() {
    const oldManagers = [...this.computeManagers.values()];
    const oldFallback = this.fallbackTexture;
    this.fallbackTexture = null;
    this.computeManagers.clear();
    this.computeNodes.clear();
    this.computeTextures.clear();
    this.inputHashes.clear();
    this.nodeOutputs.clear();
    this.executionOrder = [];
    this.initialized = false;

    // Clear registry
    if (window.computeNodeRegistry) {
      window.computeNodeRegistry.clear();
    }

    // Defer GPU resource destruction to start of next render frame
    this._deferDestroy(() => {
      for (const m of oldManagers) m.destroy();
      oldFallback?.destroy();
    });
  }

  /**
   * Update a compute node (when parameters change)
   */
  async updateNode(nodeId) {
    const nodeData = window.computeNodeRegistry?.get(nodeId);
    if (!nodeData) {
      return;
    }

    // Destroy existing manager (deferred to avoid destroying textures mid-submit)
    if (this.computeManagers.has(nodeId)) {
      const oldManager = this.computeManagers.get(nodeId);
      this._deferDestroy(() => oldManager.destroy());
      this.computeManagers.delete(nodeId);
    }

    // Clean up output dictionary and hashes
    this.nodeOutputs.delete(nodeId);
    this.inputHashes.delete(nodeId);

    // Reinitialize
    await this.initializeComputeNode(nodeId, nodeData);

    // Recompute execution order
    this.updateExecutionOrder();
  }

  /**
   * Resize compute textures
   */
  resize(nodeId, width, height) {
    const manager = this.computeManagers.get(nodeId);
    if (manager) {
      manager.resize(width, height);

      // Update texture reference
      const textureData = this.computeTextures.get(nodeId);
      if (textureData) {
        textureData.texture = manager.getOutputTexture();
      }
    }
  }

  /**
   * Get info about active compute nodes
   */
  getInfo() {
    return {
      nodeCount: this.computeManagers.size,
      initialized: this.initialized,
      nodes: Array.from(this.computeManagers.keys()),
      unifiedApiNodes: Array.from(this.computeNodes.keys()),
      executionOrder: [...this.executionOrder],
      computedOutputs: Array.from(this.nodeOutputs.keys()),
      hasFallbackTexture: this.fallbackTexture !== null
    };
  }

  /**
   * Add a ComputeNodeBase instance directly (unified API)
   * This allows creating compute nodes with the unified API outside of the registry
   *
   * @param {ComputeNodeBase} computeNode - Initialized ComputeNodeBase instance
   */
  addComputeNode(computeNode) {
    if (!(computeNode instanceof ComputeNodeBase)) {
      throw new Error('[ComputeExecutor] addComputeNode requires a ComputeNodeBase instance');
    }

    const nodeId = computeNode.id;

    // Store node in both maps
    this.computeNodes.set(nodeId, computeNode);
    this.computeManagers.set(nodeId, computeNode);

    // Create sampler for this texture
    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat'
    });

    // Store texture and sampler
    this.computeTextures.set(nodeId, {
      texture: computeNode.getOutputTexture(),
      sampler,
      manager: computeNode
    });

    // Recompute execution order
    this.updateExecutionOrder();

    return computeNode;
  }

  /**
   * Remove a compute node
   * @param {string} nodeId - Node ID to remove
   */
  removeComputeNode(nodeId) {
    // Also drop the registry entry, otherwise the next initialize() recreates a manager for a node
    // that no longer exists. This matters more now that disconnected compute nodes are registered
    // for per-node previews (registerDisconnectedComputeNodes): without this, adding and deleting
    // such nodes would leak a manager each time. Compute nodes register under a sanitized id, so
    // remove both the raw and sanitized keys.
    if (window.computeNodeRegistry) {
      window.computeNodeRegistry.delete(nodeId);
      const sanitized = String(nodeId).replace(/[^a-zA-Z0-9_]/g, "_");
      if (sanitized !== nodeId) window.computeNodeRegistry.delete(sanitized);
    }

    const node = this.computeManagers.get(nodeId);
    if (node) {
      this._deferDestroy(() => { if (typeof node.destroy === 'function') node.destroy(); });

      this.computeManagers.delete(nodeId);
      this.computeNodes.delete(nodeId);
      this.computeTextures.delete(nodeId);
      this.inputHashes.delete(nodeId);
      this.nodeOutputs.delete(nodeId);

      // Recompute execution order
      this.updateExecutionOrder();
    }
  }

  /**
   * Get a compute node by ID
   * @param {string} nodeId - Node ID
   * @returns {ComputeNodeBase|null} The compute node or null
   */
  getComputeNode(nodeId) {
    return this.computeNodes.get(nodeId) || null;
  }

  /**
   * Set a uniform on a compute node (unified API convenience method)
   * @param {string} nodeId - Node ID
   * @param {string} uniformName - Uniform parameter name
   * @param {any} value - Parameter value
   */
  setUniform(nodeId, uniformName, value) {
    const node = this.computeNodes.get(nodeId);
    if (node) {
      node.setUniform(uniformName, value);
    }
  }

  /**
   * Serialize all compute nodes
   * @returns {Array<Object>} Array of serialized node data
   */
  serializeAll() {
    const serialized = [];
    for (const [nodeId, node] of this.computeNodes) {
      serialized.push(node.serialize());
    }
    return serialized;
  }

  /**
   * Deserialize and add compute nodes
   * Note: Nodes must be initialized with WGSL after deserialization
   *
   * @param {Array<Object>} data - Array of serialized node data
   * @returns {Array<ComputeNodeBase>} Array of deserialized nodes
   */
  deserializeAll(data) {
    const nodes = [];
    for (const nodeData of data) {
      const node = ComputeNodeBase.deserialize(this.device, nodeData);
      nodes.push(node);
      // Note: Caller must initialize nodes with WGSL before adding to executor
    }
    return nodes;
  }
}
