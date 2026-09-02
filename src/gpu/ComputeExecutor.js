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
 * Execution Source:
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
import { controlInputPinIndices } from '../data/NodeDefs.js';
import { getDynamicInputSpec, getInputCount } from '../data/nodeInputs.js';
import { MAX_SIM_EDGE, fitToLongEdge, resolveResolution } from '../ui/OutputFormat.js';

// Node kinds whose output moves every frame on its own, with nothing wired in. The clock-driven
// Input nodes, plus Audio: its channel follows the live signal and is advanced on the CPU each
// frame by AudioAnalysisProcessor. This is the set Editor._hasIntrinsicTimeNodes keeps the render
// loop alive for, and a compute node that reads one from a parameter has to keep dispatching for
// the same reason — its uniforms are only re-evaluated when it dispatches, so an undispatched node
// renders whatever the reference held when something else last marked it dirty.
const LIVE_INPUT_KINDS = new Set(['Time', 'Wave', 'RandomValue', 'Audio']);

/**
 * Find a node by id. computeNodeRegistry only holds COMPUTE nodes, so anything else — the Input
 * nodes a parameter reference exists to reach — has to come from the graph.
 */
function resolveGraphNode(nodeId) {
  const id = String(nodeId);
  return window.computeNodeRegistry?.get(id)?.node
    || window.graph?.getNode?.(id)
    || window.editor?.graph?.nodes?.find((n) => String(n?.id) === id)
    || null;
}

/** Ids this node's parameter expressions reference (`=node_5`, `=clamp(node_5_1 * 20, 1, 40)`). */
function extractParamNodeReferences(node) {
  const ids = new Set();
  if (!node?.params) return ids;
  for (const value of Object.values(node.params)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\bnode_(\d+)/g)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/** Does this node carry an expression that reads the clock or the audio envelope? */
function hasTimeDependentParams(node) {
  if (!node?.params) return false;
  for (const value of Object.values(node.params)) {
    if (typeof value === 'string' && /time|audioEnvelope/i.test(value.trim())) {
      return true;
    }
  }
  return false;
}

/**
 * Does this node's output move on its own between frames?
 *
 * Answered for the whole upstream chain, not just the node itself: a Pattern whose scale is
 * `=node_<remap>` where that Remap is *wired* from an Audio node is exactly as live as one
 * referencing the analysis directly, and the wire is invisible to a params-only check. Reference
 * cycles and feedback loops are guarded by `visited`.
 */
function isNodeLive(node, visited = new Set()) {
  if (!node) return false;
  const id = String(node.id);
  if (visited.has(id)) return false;
  visited.add(id);

  if (LIVE_INPUT_KINDS.has(node.kind)) return true;
  if (ComputeExecutor.SELF_ANIMATED_KINDS.has(node.kind)) return true;
  if (hasTimeDependentParams(node)) return true;

  // Wired upstream: anything fed by a live node is live.
  if (Array.isArray(node.inputs)) {
    for (const inputId of node.inputs) {
      if (inputId === null || inputId === undefined) continue;
      if (isNodeLive(resolveGraphNode(inputId), visited)) return true;
    }
  }

  // Referenced upstream: the same question one parameter expression further up.
  for (const refId of extractParamNodeReferences(node)) {
    if (isNodeLive(resolveGraphNode(refId), visited)) return true;
  }

  return false;
}

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

  // Longest edge a compute texture may have. Shared with the resolution policy
  // so the settings window can report the size the sims actually get.
  static MAX_COMPUTE_RES = MAX_SIM_EDGE;

  /**
   * Cap a compute texture to MAX_COMPUTE_RES preserving its aspect ratio. Capping
   * the axes independently reshapes the sim - a 2560x1080 composition became a
   * 2048x1080 texture - and then the composite that samples it, and the second
   * viewer that frames itself from it, no longer agree with the composition.
   */
  static fitComputeSize(width, height) {
    const fitted = fitToLongEdge(
      { width: Math.round(width), height: Math.round(height) },
      ComputeExecutor.MAX_COMPUTE_RES,
    );
    return [Math.max(1, fitted.width), Math.max(1, fitted.height)];
  }

  // Compute kinds that evolve on their own every frame (time-based or
  // stateful feedback), used by isGraphAnimated()
  static SELF_ANIMATED_KINDS = new Set([
    'ComputeNoise', 'ComputeReactionDiffusion', 'ComputeFeedback',
    'ComputeFeedbackField', 'ComputeFluidSim', 'ComputeParticles',
    'ComputeCellular'
  ]);

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
    const registry = window.computeNodeRegistry;
    // Nothing registered AND nothing built: no work to do, and no teardown owed.
    // An empty registry with managers still standing is not that case — a graph
    // that lost its last compute node (an edit, or a project load that replaced
    // the whole graph) still has to reach the teardown below, or those managers
    // keep dispatching every frame into textures nothing reads any more.
    if (!registry?.size && !this.initialized) {
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
      // Preserve entries owned by an external producer (the 3D Field
      // Visualizer publishes its rendered scene texture here). These aren't
      // managed compute nodes, so a blanket clear would drop the mapper's
      // output binding until FieldMapperIntegration re-publishes on the next
      // frame — and a render firing in that gap samples nothing, blacking out
      // any downstream (e.g. mapper -> OutputFinal). Reference params trigger
      // frequent rebuilds, so that gap was hit constantly.
      if (this.externalOutputNodeIds && this.externalOutputNodeIds.size > 0) {
        for (const id of this.computeTextures.keys()) {
          if (!this.externalOutputNodeIds.has(id)) {
            this.computeTextures.delete(id);
          }
        }
      } else {
        this.computeTextures.clear();
      }
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

    for (const [nodeId, nodeData] of (registry || [])) {
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
    const { node, wgslCode, resolution, supportsFeedback } = nodeData;

    const DEFAULT_COMPUTE_RES = 1024;

    // Internal sim textures follow the 'sim' role: the output aspect at the
    // project's sim quality, independent of how cheaply the preview draws.
    const simRes = resolveResolution('sim');
    const baseWidth = simRes.width || DEFAULT_COMPUTE_RES;
    const baseHeight = simRes.height || DEFAULT_COMPUTE_RES;

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

    // Cap detail at the maximum supported size, never the shape.
    [width, height] = ComputeExecutor.fitComputeSize(width, height);

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
                                   'ComputeMorphology', 'ComputeWarp', 'ComputeKaleidoscope', 'ComputeGlitch', 'ComputeMix', 'ComputeTransform', 'ComputeChannels', 'ComputeHSV', 'ComputeHistogram', 'ComputeLuminance', 'ComputeGradient'].includes(node.kind);
    const needsInput = nodeDesignedForInput;

    // Reuse signature: a node can keep its existing manager (and its
    // accumulated feedback state) across a rebuild only if everything that
    // shapes the GPU pipeline/textures is identical. Parameters that map to
    // uniforms (decay, scale, offset, …) don't appear here because they don't
    // change the WGSL, so tweaking them no longer wipes the feedback buffer.
    // Input pins past the first two, for nodes whose inputs are expandable (ComputeMix). They add
    // bindings to the bind-group layout, so a change here has to rebuild the pipeline — hence its
    // presence in the reuse signature below.
    const extraInputCount = getDynamicInputSpec(node)
      ? Math.max(0, getInputCount(node) - 2)
      : 0;

    const initSignature = `${node.kind}|${width}x${height}|fb${supportsFeedback ? 1 : 0}|in${needsInput ? 1 : 0}|xin${extraInputCount}|${wgslCode}`;

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
    await manager.initialize(wgslCode, width, height, supportsFeedback, needsInput, extraInputCount);
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
      // The second-monitor viewer replicates feedback sims independently, so a
      // reset here must reach it too or its trail keeps accumulating. On the
      // receiver window (whose reset is driven BY that broadcast) the global is
      // absent, so this cannot loop.
      if (typeof window !== 'undefined') {
        try { window.secondMonitorViewer?.onFeedbackReset?.(nodeId); } catch { /* ignore */ }
      }
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
    } catch {
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
  async _renderFragmentNodeWithDependencies(fragmentNodeId, width, height, commandEncoder, time, audioContext, force = false) {
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
      commandEncoder,
      force
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

    // Set input textures if needed. Runs even when a pin is empty: a
    // just-disconnected pin must CLEAR the manager's stale texture reference,
    // otherwise the bind group keeps pointing at the upstream (possibly
    // destroyed fragment-bridge) texture and the next submit fails with
    // "Destroyed texture used in a submit".
    this._wireInputTextures(node, manager);

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
    } catch {
      // Silently handle errors
    }
  }

  // Compute node kinds whose second input pin binds at @binding(4) via
  // setWarpFieldTexture (ComputeWarp's warp field, ComputeMix's Input B,
  // ComputeParticles' Velocity Field).
  static SECOND_INPUT_KINDS = new Set(['ComputeWarp', 'ComputeMix', 'ComputeParticles']);

  /**
   * Point a manager's input texture bindings at the current upstream outputs.
   * Crucially this also handles the DISCONNECT case: when a pin is empty (or its
   * upstream output isn't available) but the manager still holds a texture from a
   * previous frame, that reference is cleared and the bind group recreated so it
   * falls back to the manager's 1x1 fallback texture. Without this, a node that
   * keeps dispatching after its input is unplugged (e.g. the self-animated
   * ComputeParticles) submits a bind group referencing the upstream fragment
   * bridge's texture after FragmentTextureRenderer has destroyed it -->
   * "Destroyed texture used in a submit".
   * @param {Object} node - Graph node being dispatched
   * @param {Object} manager - Its ComputeShaderManager
   */
  _wireInputTextures(node, manager) {
    if (!node || !manager) return;
    const inputs = Array.isArray(node.inputs) ? node.inputs : [];

    if (manager.setInputTexture) {
      const pin0 = inputs.length > 0 ? inputs[0] : null;
      const inputTexture = (pin0 !== null && pin0 !== undefined) ? this.nodeOutputs.get(pin0) : null;
      if (inputTexture) {
        manager.setInputTexture(inputTexture);
        if (manager.recreateBindGroup) {
          manager.recreateBindGroup();
        }
      } else if (manager.inputTexture) {
        manager.setInputTexture(null);
        if (manager.recreateBindGroup) {
          manager.recreateBindGroup();
        }
      }
    }

    if (ComputeExecutor.SECOND_INPUT_KINDS.has(node.kind) && manager.setWarpFieldTexture) {
      const pin1 = inputs.length > 1 ? inputs[1] : null;
      const secondTexture = (pin1 !== null && pin1 !== undefined) ? this.nodeOutputs.get(pin1) : null;
      if (secondTexture) {
        manager.setWarpFieldTexture(secondTexture);
      } else if (manager.warpFieldTexture) {
        manager.setWarpFieldTexture(null);
        if (manager.recreateBindGroup) {
          manager.recreateBindGroup();
        }
      }
    }

    // Third and later pins of an expandable-input node (ComputeMix's Input C, D, …). Same
    // disconnect handling as above: an emptied pin must clear its stale texture reference, which
    // setExtraInputTexture(null) does by falling the binding back to the 1x1 fallback.
    if (manager.setExtraInputTexture && manager.extraInputCount > 0) {
      let changed = false;
      const pinCount = getInputCount(node);
      for (let pin = 2; pin < pinCount; pin++) {
        const sourceId = inputs.length > pin ? inputs[pin] : null;
        const texture = (sourceId !== null && sourceId !== undefined)
          ? this.nodeOutputs.get(sourceId) || null
          : null;
        if (manager.extraInputTextures[pin - 2] !== texture) changed = true;
        manager.setExtraInputTexture(pin - 2, texture);
      }
      if (changed && manager.recreateBindGroup) {
        manager.recreateBindGroup();
      }
    }
  }

  /**
   * Render fragment node inputs to textures (auto-bridging)
   * This enables fragment nodes to be used as inputs to compute nodes
   * @param {GPUCommandEncoder} commandEncoder - Shared command encoder for synchronization
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values
   */
  /**
   * 3D Field Visualizer nodes whose source is a fragment (or mixed) subgraph
   * rather than a registered compute node. These sources are auto-wrapped:
   * rendered to a texture each frame exactly like fragment-fed compute inputs.
   * @returns {Array<{node: Object, sourceId: string|number}>}
   */
  _fieldMapperFragmentSources() {
    const consumers = [];
    const nodes = (typeof window !== 'undefined' && window.graph?.nodes) || [];
    for (const node of nodes) {
      if (!node || node.kind !== 'ComputeFieldMapper') continue;
      const sourceId = Array.isArray(node.inputs) ? node.inputs[0] : null;
      if (sourceId === null || sourceId === undefined) continue;
      if (this.computeManagers.has(sourceId)) continue; // real compute source
      const sanitized = String(sourceId).replace(/[^a-zA-Z0-9_]/g, '_');
      if (this.computeManagers.has(sanitized)) continue;
      // Another field mapper publishes its own output - never bridge it
      const sourceNode = window.graph?.getNode?.(sourceId);
      if (sourceNode && sourceNode.kind === 'ComputeFieldMapper') continue;
      consumers.push({ node, sourceId });
    }
    return consumers;
  }

  /**
   * Sources feeding a ProjectionMap node's surface pins.
   *
   * A mapping surface samples its source at the warped coordinate its quad
   * implies, which only a TEXTURE can answer - so every pin that is not already
   * a compute node is bridged through the fragment renderer, exactly as a field
   * mapper's source is. Each pin is a separate surface, so unlike the mapper
   * (whose source is pin 0) every pin is collected.
   */
  _projectionMapFragmentSources() {
    const consumers = [];
    const nodes = (typeof window !== 'undefined' && window.graph?.nodes) || [];
    for (const node of nodes) {
      if (!node || node.kind !== 'ProjectionMap') continue;
      if (!Array.isArray(node.inputs)) continue;
      for (const sourceId of node.inputs) {
        if (sourceId === null || sourceId === undefined) continue;
        if (this.computeManagers.has(sourceId)) continue; // real compute source
        const sanitized = String(sourceId).replace(/[^a-zA-Z0-9_]/g, '_');
        if (this.computeManagers.has(sanitized)) continue;
        // A field mapper publishes its own output - never bridge over it.
        const sourceNode = window.graph?.getNode?.(sourceId);
        if (sourceNode && sourceNode.kind === 'ComputeFieldMapper') continue;
        consumers.push({ node, sourceId });
      }
    }
    return consumers;
  }

  async _renderFragmentInputs(commandEncoder, time, audioContext) {
    if (!window.graph || !window.graph.nodes) {
      return;
    }

    // Both kinds of "consume ANY graph output" node bridge the same way.
    const mapperConsumers = this._fieldMapperFragmentSources()
      .concat(this._projectionMapFragmentSources());

    // PERFORMANCE: Early exit if no fragment inputs need rendering
    // This avoids expensive iteration when there are no fragment→compute connections
    let hasFragmentInputs = mapperConsumers.length > 0;
    for (const nodeId of this.executionOrder) {
      const nodeData = window.computeNodeRegistry?.get(nodeId);
      const node = nodeData?.node;
      if (node?.inputs && Array.isArray(node.inputs)) {
        const controlPins = controlInputPinIndices(node.kind);
        for (let pin = 0; pin < node.inputs.length; pin++) {
          if (controlPins.has(pin)) continue; // control pins (e.g. Reset) carry a scalar, not a texture
          const inputNodeId = node.inputs[pin];
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

      const controlPins = controlInputPinIndices(node.kind);

      // Check each input
      for (let pin = 0; pin < node.inputs.length; pin++) {
        // Control pins (e.g. the Feedback Reset pulse) feed a CPU-side processor, not a texture —
        // never auto-bridge their scalar source into a fragment texture.
        if (controlPins.has(pin)) continue;

        const inputNodeId = node.inputs[pin];
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

        // A 3D Field Visualizer already publishes its rendered view into
        // nodeOutputs every frame - bridging it through an isolated fragment
        // render would overwrite that texture with a degraded copy (this is
        // what washed the colors out of mapper -> ComputeMix chains)
        if (inputNode.kind === 'ComputeFieldMapper') {
          continue;
        }

        // This is a fragment node being used as compute input!
        try {
          // Match the CONSUMING compute node's texture dims so UV/texel math lines
          // up. In the editor those are the render resolution; the second-monitor
          // receiver registers its own dims and stays independent of the editor,
          // so the node's registration wins and the store is only the fallback.
          const resolution = nodeData.resolution || [];
          const simRes = resolveResolution('sim');
          let width = resolution[0] > 0 ? resolution[0] : (simRes.width || 1024);
          let height = resolution[1] > 0 ? resolution[1] : (simRes.height || 1024);


          [width, height] = ComputeExecutor.fitComputeSize(width, height);


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
        } catch {
          // Silently handle errors
        }
      }
    }

    // Auto-wrap fragment (or mixed) subgraphs feeding 3D Field Visualizer
    // nodes: render them to a texture exactly like fragment-fed compute
    // inputs, so the mapper can consume ANY graph output
    for (const { node: mapperNode, sourceId } of mapperConsumers) {
      if (this.renderedFragmentNodes.has(sourceId)) continue;

      const inputNode = window.graph.getNode(sourceId);
      if (!inputNode) continue;

      try {
        // Same rule as the fragment bridge above: the mapper's own registered
        // dims win, the shared render resolution is the fallback.
        const mapperDims = mapperNode?.computeResolution || [];
        const simRes = resolveResolution('sim');
        let width = mapperDims[0] > 0 ? mapperDims[0] : (simRes.width || 512);
        let height = mapperDims[1] > 0 ? mapperDims[1] : (simRes.height || 512);
        [width, height] = ComputeExecutor.fitComputeSize(width, height);

        // FORCE the render every frame. A field mapper wants a live view, and
        // its source may be animated only transitively - e.g. a Circle whose
        // radius references an audioEnvelope-driven float. The fragment
        // renderer's own change detection only sees literal time/audioEnvelope
        // in the node's OWN params, so it would cache the source and freeze
        // the animation. mark it changed so downstream compute consumers
        // re-dispatch too.
        const texture = await this._renderFragmentNodeWithDependencies(
          sourceId,
          width,
          height,
          commandEncoder,
          time,
          audioContext,
          true
        );

        if (texture) {
          this.nodeOutputs.set(sourceId, texture);
          this.renderedFragmentNodes.add(sourceId);
          this.fragmentNodesRenderedThisFrame.add(sourceId);
        }
      } catch {
        // Non-fatal: the mapper renders its bare shape until the source works
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

    // Step-lock hold: the second-monitor receiver replicates feedback sims 1:1 with
    // the editor's frames, so on a frame where no editor sim step arrived it sets
    // this flag to keep the sims (and every other dispatch) frozen at their last
    // state — otherwise a faster display would over-advance the simulation. The
    // output textures persist, so the fragment blit keeps presenting the last
    // result. The editor never sets this.
    if (this.holdDispatch) {
      return;
    }

    // Field mappers and projection-mapping surfaces with a fragment-node source
    // need the auto-bridge below even when there isn't a single registered
    // compute node in the graph. Without this a mapped surface fed by a pure
    // fragment source samples a texture nothing ever rendered into.
    const bridgeOnlySources = this._fieldMapperFragmentSources()
      .concat(this._projectionMapFragmentSources());

    if ((!this.initialized || this.computeManagers.size === 0) && bridgeOnlySources.length === 0) {
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
          'ComputeParticles',          // Time-based animation
          'ComputeCellular'            // Stateful generations (throttled in dispatch)
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

        // A 3D Field Visualizer input re-renders every frame (and its texture
        // identity changes when the render resolution switches), so consumers
        // must keep dispatching - the input hash can't see either change
        const hasFieldMapperInput = node?.inputs && Array.isArray(node.inputs) &&
          node.inputs.some(inputId => {
            if (inputId === null || inputId === undefined) return false;
            const inputNode = window.graph?.getNode?.(inputId);
            return !!inputNode && inputNode.kind === 'ComputeFieldMapper';
          });

        // PERFORMANCE: Only dispatch if node actually needs to update
        // This prevents unnecessary GPU work and maintains 60 FPS
        const needsDispatch = shouldUpdate || isTimeDependentNode || hasTimeDependentParams || hasNodeRefParams || hasUpdatedComputeInput || hasFieldMapperInput;
        
        if (needsDispatch) {
          // OPTIMIZATION: Only set input textures when we're actually dispatching
          // This avoids unnecessary setInputTexture() and recreateBindGroup() calls.
          // Also clears stale references for just-disconnected pins (see
          // _wireInputTextures).
          this._wireInputTextures(node, manager);

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
      } catch {
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
    } catch {
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
    return hasTimeDependentParams(node);
  }

  /**
   * Whether the current graph produces motion on its own (time/audio driven,
   * feedback sims, or a reference param that may animate). Used by the render
   * loop to keep such graphs rendering during interaction instead of reusing
   * a stale GPU frame — otherwise an audio-reactive chain visibly freezes
   * while you drag a node or a slider. Cheap: scans the registered compute
   * node params, memoized until the graph rebuilds (initialize() clears it).
   * @returns {boolean}
   */
  isGraphAnimated() {
    const graphNodes = (typeof window !== 'undefined' &&
      ((window.editor?.graph?.nodes) || (window.graph?.nodes))) || [];

    // Recomputed each call (a handful of regex tests over node params — cheap;
    // memoizing was the wrong call because the render loop polls this every
    // frame and a stale flag pinned it to false before the graph settled).
    const SELF_ANIMATED = ComputeExecutor.SELF_ANIMATED_KINDS;
    for (const node of graphNodes) {
      if (!node) continue;
      if (SELF_ANIMATED.has(node.kind)) return true;
      if (this.hasTimeDependentParameters(node) || this.hasNodeReferenceParameters(node)) {
        return true;
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
    // Anywhere in the expression, not only immediately after the `=`: mapping an audio meter onto
    // a parameter is usually written as a formula around the reference ("=clamp(node_28_1 * 20, 1,
    // 40)"), and an `=\s*node_` test sees no reference at all in one of those.
    return extractParamNodeReferences(node).size > 0;
  }

  /**
   * Check if any referenced nodes (via node reference parameters) are time-dependent
   * This helps avoid unnecessary dispatches when referenced values are static
   */
  hasTimeDependentReferencedNodes(node) {
    const referencedNodeIds = extractParamNodeReferences(node);
    if (referencedNodeIds.size === 0) return false;

    const visited = new Set();
    for (const refNodeId of referencedNodeIds) {
      if (isNodeLive(resolveGraphNode(refNodeId), visited)) return true;
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
    } catch {
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
  getBindGroupEntries(_startBinding = 100) {
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
    for (const [, node] of this.computeNodes) {
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
