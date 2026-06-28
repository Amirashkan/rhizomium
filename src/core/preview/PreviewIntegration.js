// src/core/preview/PreviewIntegration.js
// OPTIMIZED VERSION - Fixes timer spam and unnecessary updates

import { PRIORITY } from '../UnifiedRAFManager.js';

export class PreviewIntegration {
  constructor(editor, previewSystem) {
    this.editor = editor;
    this.previewSystem = previewSystem;
    this.timeUpdateInterval = null;
    this.lastTimeUpdate = 0;
    this._handlerName = 'previewIntegration'; // Handler name for UnifiedRAFManager

    // Debouncing for parameter changes
    this.parameterChangeTimeout = null;
    this.pendingParameterChanges = new Map(); // nodeId -> node

    // Initialize with delay to ensure everything is ready
    setTimeout(() => {
      this.initialize();
    }, 100);
  }

  initialize() {
    if (this.editor.isPreviewEnabled && this.previewSystem) {
      this.updateAllPreviews();
    }

    // Register handler with UnifiedRAFManager to use unified RAF loop
    // This consolidates all RAF-based updates into a single loop for better performance
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.registerHandler(
        this._handlerName,
        (frameInfo) => {
          // Convert realTime from seconds to milliseconds for timestamp comparison
          const timestamp = frameInfo.realTime * 1000;
          // OPTIMIZATION: Only update time nodes if enough time has passed
          // Limit to 60 FPS max for time updates (16.67ms between updates)
          if (timestamp - this.lastTimeUpdate >= 16.67) {
            this.updateTimeNodes();
            // Re-render real GPU thumbnails for animated visual nodes at the render cadence (the
            // 16.67ms gate above is the only frame cap; the GPU preview queue self-limits on load).
            this.updateAnimatedFragmentPreviews();
            this.lastTimeUpdate = timestamp;
          }
        },
        PRIORITY.NORMAL,
        {
          // Condition: only execute if preview is enabled, system exists, and not during parameter drag
          condition: (frameInfo) => {
            return (
              this.editor.isPreviewEnabled &&
              this.previewSystem &&
              !this.editor._parameterDragging &&
              !frameInfo.paused // Skip if render loop is paused
            );
          }
        }
      );
    }
  }

  updateAllPreviews() {
    if (!this.previewSystem) {

      return;
    }
    // Pass the nodes array to updateAllPreviews
    if (this.editor?.graph?.nodes) {
      this.previewSystem.updateAllPreviews(this.editor.graph.nodes);
    } else {

    }
  }

  generateNodePreview(node, skipCompute = false) {
    if (!this.previewSystem) {

      return;
    }

    // GPU-vs-CPU routing now lives in PreviewSystem.generateNodePreview (the single funnel that
    // every path reaches, including bulk updateAllPreviews on load). Here we only make sure the
    // numeric preview values are computed first, then delegate to that funnel.

    // OPTIMIZATION: Allow caller to skip compute if they already computed all values
    // Use async worker-based computation to avoid blocking canvas interactions
    if (!skipCompute && this.editor?.previewComputer && this.editor?.graph) {
      // Use async requestPreviewComputation instead of synchronous computePreviews
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate the preview
          this.previewSystem.generateNodePreview(node);
          
          // ENHANCEMENT: Force redraw after preview generation for real-time visibility
          if (this.editor.markDirty) {
            this.editor.markDirty('preview-update');
          }
        }
      );
      return; // Exit early, preview will be generated in callback
    }
    this.previewSystem.generateNodePreview(node);
    
    // ENHANCEMENT: Force redraw after preview generation for real-time visibility
    if (this.editor.markDirty) {
      this.editor.markDirty('preview-update');
    }
  }

updateTimeNodes() {
  if (!this.editor.graph?.nodes || !this.previewSystem) return;

  const now = performance.now();
  if (!this.lastSignificantUpdate) this.lastSignificantUpdate = 0;

  if (now - this.lastSignificantUpdate < 100) {
    return;
  }
  this.lastSignificantUpdate = now;

  // Nodes that advance with the clock come from two sources:
  //  1. Parameter expressions referencing time/frame/audioEnvelope, tracked by the expression
  //     system in timeAnimatedNodes.
  //  2. Intrinsic Time generator nodes, which have no such expression and are
  //     therefore never registered above. Including them here is what keeps their previews
  //     (and everything downstream of them) refreshing instead of freezing at a fixed value.
  const expressionSystem = window.editor?.paramPanel?.expressionSystem;
  const expressionTimeNodeIds = expressionSystem?.timeAnimatedNodes
    ? Array.from(expressionSystem.timeAnimatedNodes)
    : [];
  const intrinsicTimeNodeIds = this.editor.graph.nodes
    .filter(node => {
      const kind = node?.kind?.toLowerCase();
      // Hold (sample-and-hold) nodes carry CPU-side state that HoldNodeProcessor advances every
      // frame (node.__holdValue), so their output can change frame-to-frame without any param or
      // input edit and without a time/audio expression that timeAnimatedNodes would catch. Treat
      // them like intrinsic clock nodes here so the held value — and everything downstream that
      // consumes it, including a node that references it via `=node_<id>` (e.g. a Circle radius) —
      // keeps refreshing instead of freezing at the value it had when last marked dirty.
      //
      // Mouse is deliberately excluded here: it is input-driven, not clock-driven.
      // Refreshing it every frame on this shared path kept the scene permanently
      // "animated" and ran the heavy recompute continuously, which throttled the
      // final preview. Mouse previews are refreshed event-driven in
      // notifyMouseInput() instead, on a throttle separate from the render path.
      // Count carries the same kind of CPU-side state as Hold (advanced every frame by
      // CountNodeProcessor via node.__countValue), and Random Value is clock-driven, so both need
      // to be refreshed here alongside Time/Hold so their thumbnails and downstream consumers don't
      // freeze at a stale value.
      return kind === 'time' || kind === 'hold' || kind === 'count' || kind === 'randomvalue';
    })
    .map(node => node.id);

  const timeAnimatedNodeIds = Array.from(
    new Set([...expressionTimeNodeIds, ...intrinsicTimeNodeIds])
  );
  if (timeAnimatedNodeIds.length === 0) {
    return;
  }

  // Collect all nodes that need updates: time-animated nodes + their dependents
  const nodesToUpdate = new Set();

  // Add time-animated nodes themselves
  timeAnimatedNodeIds.forEach(nodeId => {
    nodesToUpdate.add(nodeId);
  });

  // A node can consume an animated node in two ways: through a wire, or through a parameter
  // expression that references it as `node_<id>` (e.g. a Float whose value is
  // `=node_5 > 0.5 ? 1 : 0`). Only the wired form is tracked by graph.connections, so an
  // expression-only dependent was never marked dirty here and its PreviewComputer value froze —
  // which is exactly what is shown beside the output pin. (The parameter panel re-evaluates
  // expressions on every refresh, which is why its green readout stayed correct.) Build a reverse
  // map of expression references so these dependents refresh alongside the wired ones.
  const expressionDependents = this._buildExpressionDependentsMap();

  // Find all downstream nodes that depend on time-animated nodes, following both wired
  // connections and `node_<id>` expression references.
  const connections = this.editor.graph.connections || [];
  const findDependents = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    connections
      .filter(conn => conn.from?.nodeId === nodeId)
      .forEach(conn => {
        nodesToUpdate.add(conn.to.nodeId);
        findDependents(conn.to.nodeId, visited);
      });

    const exprDeps = expressionDependents.get(String(nodeId));
    if (exprDeps) {
      exprDeps.forEach(depId => {
        nodesToUpdate.add(depId);
        findDependents(depId, visited);
      });
    }
  };

  timeAnimatedNodeIds.forEach(nodeId => {
    findDependents(nodeId);
  });

  if (nodesToUpdate.size === 0) {
    return;
  }

  // CRITICAL: Mark all time-dependent nodes and their downstream nodes as dirty
  // This ensures computePreviews() will recompute them with the new time value
  if (this.editor?.previewComputer) {
    nodesToUpdate.forEach(nodeId => {
      this.editor.previewComputer.markNodeDirty(nodeId, 'time-update');
    });
  }

  // CRITICAL: Actually recompute preview values, not just regenerate thumbnails
  // This ensures node.__preview gets updated with new numeric values for time-based expressions
  if (this.editor?.previewComputer && this.editor?.graph) {
    this.editor.previewComputer.requestPreviewComputation(
      this.editor.graph,
      { time: performance.now() / 1000 },
      {},
      () => {
        // CRITICAL: computePreviews() already called _generateEnhancedThumbnails()
        // which regenerated all thumbnails with updated numeric values.
        // DO NOT call generateNodePreview() here as it would overwrite the correctly
        // generated thumbnails with ones that don't handle scalar numeric outputs properly.

        // Refresh parameter panel displays to show updated values
        if (this.editor.paramPanel?.refreshParameterDisplays) {
          this.editor.paramPanel.refreshParameterDisplays();
        }

        // Mark dirty and redraw to show updated thumbnails with numeric values
        // The thumbnails (node.__thumb) were already regenerated by _generateEnhancedThumbnails()
        // and contain the updated numeric values from node.__preview
        if (this.editor.markDirty) {
          this.editor.markDirty('time-node-update');
        }
        this.editor.draw();
      }
    );
  } else {
    // Fallback: if no preview computer, at least try to regenerate thumbnails
    timeAnimatedNodeIds.forEach(nodeId => {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node);
      }
    });

    if (this.editor.markDirty) {
      this.editor.markDirty('time-node-update');
    }
    this.editor.draw();
  }
}

  // Event-driven refresh of Mouse node previews and everything downstream of them.
  // Called from the GPU renderer's pointer listeners (not the per-frame loop), so it
  // runs ONLY while the cursor is actually moving/clicking over the preview, and on
  // its own throttle — keeping the mouse value-update cost entirely separate from the
  // final GPU preview, which reads window._mousePosition every frame on its own.
  notifyMouseInput() {
    if (!this.editor?.graph?.nodes || !this.editor?.previewComputer) return;

    const now = performance.now();
    if (!this._lastMouseInputUpdate) this._lastMouseInputUpdate = 0;
    // Throttle the value/thumbnail recompute independently of the render loop.
    if (now - this._lastMouseInputUpdate < 50) return;
    this._lastMouseInputUpdate = now;

    const mouseNodeIds = this.editor.graph.nodes
      .filter(node => node?.kind?.toLowerCase() === 'mouse')
      .map(node => node.id);
    if (mouseNodeIds.length === 0) return;

    // Collect mouse nodes + transitive dependents (wired connections AND
    // node_<id> parameter-expression references), mirroring updateTimeNodes().
    const nodesToUpdate = new Set(mouseNodeIds);
    const expressionDependents = this._buildExpressionDependentsMap();
    const connections = this.editor.graph.connections || [];
    const findDependents = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      connections
        .filter(conn => conn.from?.nodeId === nodeId)
        .forEach(conn => {
          nodesToUpdate.add(conn.to.nodeId);
          findDependents(conn.to.nodeId, visited);
        });
      const exprDeps = expressionDependents.get(String(nodeId));
      if (exprDeps) {
        exprDeps.forEach(depId => {
          nodesToUpdate.add(depId);
          findDependents(depId, visited);
        });
      }
    };
    mouseNodeIds.forEach(nodeId => findDependents(nodeId));

    const pc = this.editor.previewComputer;
    nodesToUpdate.forEach(nodeId => pc.markNodeDirty(nodeId, 'mouse-input'));
    // Compute directly rather than via requestPreviewComputation: the latter skips
    // entirely while _interactionMode is set (e.g. right after adding/dragging a
    // node), which would freeze the Mouse readout. Moving the cursor over the
    // preview is precisely when live values are wanted, even mid-interaction, so
    // this path must not be gated. It is already throttled above and only the
    // mouse + its dependents are dirty, so the recompute stays cheap.
    try {
      pc.computePreviews(this.editor.graph, { time: performance.now() / 1000 });
    } catch (_) {}
    if (this.editor.paramPanel?.refreshParameterDisplays) {
      this.editor.paramPanel.refreshParameterDisplays();
    }
    // computePreviews only refreshes CPU-computed values (numeric pin labels). A fragment node
    // whose parameter references the Mouse (e.g. a Circle's radius = node_<mouse>_x) has a
    // GPU-rendered thumbnail that those values do not touch, so without this its node preview
    // freezes while the main render tracks the cursor. Re-render the real GPU thumbnail of every
    // mouse-dependent visual/compute node (already collected above; _refreshNodePreview is
    // visibility-culled and honors the per-node toggle).
    const spm = window.shaderPreviewManager;
    if (spm && spm.enableGPUPreview) {
      nodesToUpdate.forEach(nodeId => {
        const node = this.editor.graph.nodes.find(n => n.id === nodeId);
        if (node) this._refreshNodePreview(node);
      });
    }
    if (this.editor.markDirty) this.editor.markDirty('mouse-input');
    this.editor.draw();
  }

  /**
   * Build a reverse dependency map from node id -> set of node ids whose parameter expressions
   * reference it via `node_<id>`. Lets nodes that consume an animated node through an expression
   * (rather than a wire) refresh each frame alongside their wired counterparts.
   */
  _buildExpressionDependentsMap() {
    const map = new Map();
    const nodes = this.editor?.graph?.nodes;
    if (!Array.isArray(nodes)) return map;

    for (const node of nodes) {
      if (!node?.params || typeof node.params !== 'object') continue;
      const referencedIds = new Set();
      for (const value of Object.values(node.params)) {
        for (const refId of this._extractNodeReferences(value)) {
          referencedIds.add(refId);
        }
      }
      referencedIds.forEach(refId => {
        if (!map.has(refId)) map.set(refId, new Set());
        map.get(refId).add(node.id);
      });
    }
    return map;
  }

  /**
   * Extract referenced node ids (as strings) from a parameter expression.
   * Mirrors PreviewComputer._extractNodeReferences: "=node_5 > 0.5 ? 1 : 0" -> ["5"].
   */
  _extractNodeReferences(paramValue) {
    if (!paramValue || typeof paramValue !== 'string') return [];
    const trimmed = paramValue.trim();
    if (!trimmed.startsWith('=') && !trimmed.includes('node_')) return [];

    const nodeRefPattern = /node_(\d+)(?:_\w+)?/g;
    const ids = [];
    for (const match of trimmed.matchAll(nodeRefPattern)) {
      ids.push(match[1]);
    }
    return ids;
  }
  // Live-refresh GPU thumbnails each frame (throttled) for nodes whose output evolves on its
  // own: every compute node (feedback, reaction-diffusion, particles, fluid, animated noise) AND
  // everything downstream of them, plus fragment nodes that reference time/audio in their params
  // and everything downstream of those. Scalar/animated numeric nodes are handled by
  // updateTimeNodes() on the CPU path.
  updateAnimatedFragmentPreviews() {
    const spm = window.shaderPreviewManager;
    if (!spm || !spm.enableGPUPreview || !this.editor.graph?.nodes) return;

    // No internal frame cap here: the caller already runs this at most once per ~16.67ms (60 fps),
    // and the GPU preview queue self-limits when the GPU can't keep up. An extra ~30 fps cap on top
    // just made animated thumbnails refresh at half the render rate, so they visibly stuttered
    // behind the live output — let them ride the render cadence instead.

    // Collect every node whose thumbnail must be re-read this frame because its output is live.
    const toUpdate = new Set();
    const visited = new Set();
    // Built once and threaded through the recursion so downstream collection also follows
    // `node_<id>` parameter-expression references (e.g. a Switch's `select`), not just wires.
    const exprDeps = this._buildExpressionDependentsMap();

    // Compute nodes write a fresh output texture every frame. Re-read each one's own thumbnail
    // (via its dedicated texture-readback path) AND mark everything downstream of it for refresh —
    // the OutputFinal node, or a fragment node like ColorRamp sitting between the compute node and
    // the output. Without this, the compute node's thumbnail animates but its consumers (most
    // visibly the OutputFinal preview) freeze on the last frame they were edited, so the OutputFinal
    // thumbnail visibly diverges from the floating preview (which is the live main render).
    for (const node of this.editor.graph.nodes) {
      if (spm.isComputeNode(node)) {
        this._refreshNodePreview(node);
        this._collectWithDownstream(node.id, toUpdate, visited, exprDeps);
      }
    }

    // Fragment nodes that reference time/audio in their params, plus all transitive dependents.
    const animated = window.editor?.paramPanel?.expressionSystem?.timeAnimatedNodes;
    if (animated) {
      animated.forEach(id => this._collectWithDownstream(id, toUpdate, visited, exprDeps));
    }

    // Hold (sample-and-hold) nodes: their held value is advanced on the CPU every frame by
    // HoldNodeProcessor, so a fragment node that references one via `=node_<id>` (e.g. a Circle
    // whose radius is `=node_<hold>`) has a live GPU thumbnail that no param/input edit triggers.
    // Only collect a Hold's downstream when the held value actually CHANGED this frame: a Hold
    // holds, so most frames its value is steady, and a steady value needs no fresh GPU readback of
    // its consumers (the costly part). A continuously changing hold still refreshes every frame.
    // (The Hold node itself has no visual thumbnail; only its consumers need refreshing.)
    if (!this._lastHoldValues) this._lastHoldValues = new Map();
    const seenHold = new Set();
    for (const node of this.editor.graph.nodes) {
      if (node?.kind?.toLowerCase() !== 'hold') continue;
      seenHold.add(node.id);
      const held = node.__holdValue;
      if (held !== this._lastHoldValues.get(node.id)) {
        this._lastHoldValues.set(node.id, held);
        this._collectWithDownstream(node.id, toUpdate, visited, exprDeps);
      }
    }
    // Drop tracking for Hold nodes that were deleted so the map doesn't leak across edits.
    if (this._lastHoldValues.size > seenHold.size) {
      for (const id of this._lastHoldValues.keys()) {
        if (!seenHold.has(id)) this._lastHoldValues.delete(id);
      }
    }

    // Random Value nodes are clock-driven (their fract(sin(g.time...)) churns every frame), so a
    // fragment node that references one via a `=node_<id>` PARAMETER expression (e.g. a Circle
    // whose radius is `=node_<random>`) has a live GPU thumbnail that no param/input edit triggers —
    // without this it would freeze on a single random value, defeating the node. Seed the refresh
    // only from those expression dependents (then walk their downstream).
    //
    // Deliberately do NOT follow plain WIRES out of the Random Value here. A wired Random Value
    // already flows through the compiled shader to every downstream node's own render, so refreshing
    // a whole wired chain (e.g. RandomValue -> Count -> OutputFinal) would re-render+read-back every
    // visual node on it EVERY frame — that per-frame GPU work froze the editor when a Count (or any
    // node) was wired between a Random Value and the output. Wired clock->visual thumbnails stay on
    // the normal cadence, matching how wired Time references already behave
    // (see TIME_NODE_REFERENCE_NOTES.md). Only its visual consumers are re-rendered, via the
    // isVisualNode filter below.
    for (const node of this.editor.graph.nodes) {
      if (node?.kind?.toLowerCase() !== 'randomvalue') continue;
      const refs = exprDeps.get(String(node.id));
      if (refs) refs.forEach(depId => this._collectWithDownstream(depId, toUpdate, visited, exprDeps));
    }

    // Refresh the collected downstream visual nodes. Compute nodes were already refreshed above via
    // their texture-readback path (and isVisualNode is false for them anyway), so skip them here.
    for (const nodeId of toUpdate) {
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node && !spm.isComputeNode(node) && spm.isVisualNode(node)) this._refreshNodePreview(node);
    }
  }

  // Live-refresh the dragged node + its dependents (throttled). The full onParameterChange path
  // is skipped during a drag for perf, so without this previews only update once the value is
  // committed ("entered"). node.params is already live during the drag (the main canvas tracks
  // it), so the preview render/readback picks up the current value.
  _liveDragPreviewUpdate(node) {
    if (!node?.id || !this.editor.graph?.nodes) return;

    const now = performance.now();
    if (!this._lastDragPreview) this._lastDragPreview = 0;
    if (now - this._lastDragPreview < 33) return; // ~30 fps cap (queue self-limits under load)
    this._lastDragPreview = now;

    // Bindings aren't graph edges, so the dependency walk below can't see them and the bound
    // targets' node.params aren't touched mid-drag. Push the live drag value through each binding
    // first (updating target node.params + GPU uniforms) so the CPU label recompute and the GPU
    // thumbnail refresh below both pick up the driven values, instead of freezing until mouseup.
    let boundTargets = null;
    const bindingSystem = window.editor?.paramPanel?.bindingSystem;
    if (bindingSystem?.refreshLiveTargetsForSource) {
      boundTargets = bindingSystem.refreshLiveTargetsForSource(node);
    }

    // Refresh the CPU-computed node values that back the numeric pin-value labels. Those labels
    // read from previewComputer.lastComputedValues, which the main render loop only recomputes
    // when NOT dragging — so without this a computed downstream label (e.g. a Compare node's
    // output) stays frozen at its pre-drag value until mouseup, even though the GPU thumbnail
    // tracks the drag live. node.params is already updated by the drag handler, and
    // computePreviews only re-evaluates dirty nodes + their dependents (detected via the param
    // hash), so this stays cheap. markDirty so the canvas repaints the refreshed labels even
    // when GPU preview — which would otherwise flag the canvas via its thumbnail readback — is
    // disabled.
    const previewComputer = this.editor.previewComputer;
    if (previewComputer?.computePreviews) {
      try {
        previewComputer.computePreviews(this.editor.graph);
        this.editor.markDirty?.('drag-value-preview');
      } catch (e) {
        // Non-fatal: numeric labels just stay stale for this frame.
      }
    }

    // GPU thumbnail refresh — only when GPU preview is enabled.
    const spm = window.shaderPreviewManager;
    if (!spm || !spm.enableGPUPreview) return;

    const toUpdate = new Set();
    const exprDeps = this._buildExpressionDependentsMap();
    this._collectWithDownstream(node.id, toUpdate, new Set(), exprDeps);
    // Include bound targets (and their own downstream) so their thumbnails track the drag too.
    if (boundTargets) {
      for (const targetNode of boundTargets) {
        this._collectWithDownstream(targetNode.id, toUpdate, new Set(), exprDeps);
      }
    }
    for (const nodeId of toUpdate) {
      const n = this.editor.graph.nodes.find(x => x.id === nodeId);
      if (n) this._refreshNodePreview(n);
    }
  }

  // Refresh one node's real GPU thumbnail, honoring its per-node preview toggle.
  // Compute nodes read back their output texture; vector-output fragment nodes re-render.
  _refreshNodePreview(node) {
    const spm = window.shaderPreviewManager;
    if (!spm || !node?.id) return;
    // Hidden via the per-node toggle or the per-kind default (numeric nodes default off).
    if (this.editor.isNodePreviewEnabled && !this.editor.isNodePreviewEnabled(node)) return;
    // Skip nodes scrolled off-screen: their thumbnail isn't visible, so the per-frame GPU
    // render/readback would be wasted. They refresh on the next tick once panned back into view.
    if (!this._isNodeVisible(node)) return;
    if (spm.isComputeNode(node)) {
      spm.updateComputeNodePreview(node).catch(() => {});
    } else if (spm.isVisualNode(node)) {
      spm.updateFragmentNodePreview(node).catch(() => {});
    }
  }

  // Whether a node's box intersects the visible editor viewport (world-space bounds derived from
  // the pan offset, zoom scale and canvas size — same math as Renderer's culling). Conservative:
  // if the viewport/canvas can't be read, treat the node as visible so we never wrongly skip it.
  _isNodeVisible(node) {
    const vp = this.editor?.viewport;
    const canvas = this.editor?.canvas;
    if (!vp || !canvas || !node) return true;
    const scale = vp.scale || 1;
    const pad = 64; // keep nodes just outside the edge warm to avoid pop-in while panning
    const minX = -(vp.offsetX || 0) / scale - pad;
    const minY = -(vp.offsetY || 0) / scale - pad;
    const maxX = (canvas.width - (vp.offsetX || 0)) / scale + pad;
    const maxY = (canvas.height - (vp.offsetY || 0)) / scale + pad;
    const nx = node.x || 0;
    const ny = node.y || 0;
    const nw = node.w || 0;
    const nh = node.h || 0;
    return nx + nw >= minX && nx <= maxX && ny + nh >= minY && ny <= maxY;
  }

  // Collect a node id and all its transitive downstream node ids into `into`. Downstream means
  // both wired consumers (graph.connections) and expression consumers — a node whose parameter
  // references this one via `node_<id>` (e.g. a Switch whose `select` is `=node_28 > 0 ? 1 : 0`)
  // depends on it without a wire, so its thumbnail must refresh alongside the wired ones. Pass a
  // prebuilt expression-dependents map (from _buildExpressionDependentsMap) to avoid rebuilding it
  // on every recursive step; it is built lazily if omitted.
  _collectWithDownstream(nodeId, into, visited, exprDeps = null) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    into.add(nodeId);
    const deps = exprDeps || (exprDeps = this._buildExpressionDependentsMap());
    const connections = this.editor.graph?.connections || [];
    for (const c of connections) {
      if (c.from?.nodeId === nodeId) this._collectWithDownstream(c.to.nodeId, into, visited, deps);
    }
    const refDependents = deps.get(String(nodeId));
    if (refDependents) {
      refDependents.forEach(depId => this._collectWithDownstream(depId, into, visited, deps));
    }
  }

  onParameterChange(node, immediate = false) {
    // PERFORMANCE FIX: Skip ALL preview updates during parameter drag
    // Preview updates are expensive and cause frame drops. Only update uniforms during drag.
    // Preview updates will happen on mouseup via the normal parameter change flow.
    if (this.editor._parameterDragging) {
      // During a drag we skip the heavy CPU preview-computation worker path, but still push a
      // throttled GPU thumbnail refresh so previews track the slider/knob in real time instead
      // of only updating once the value is committed.
      if (node?.id && this.editor?.previewComputer?.markNodeDirty) {
        this.editor.previewComputer.markNodeDirty(node.id, 'parameter-change');
      }
      this._liveDragPreviewUpdate(node);
      return; // The committed value still runs the full path on release
    }

    if (node?.id && this.editor?.previewComputer?.markNodeDirty) {
      this.editor.previewComputer.markNodeDirty(node.id, 'parameter-change');
    }

    // OPTIMIZATION: Debounce rapid parameter changes (e.g., slider drag)
    // Unless immediate flag is set (e.g., discrete value changes)
    if (!immediate) {
      // For rapid changes, collect affected nodes and process in batch
      this.pendingParameterChanges.set(node.id, node);

      // Clear existing timeout
      if (this.parameterChangeTimeout) {
        clearTimeout(this.parameterChangeTimeout);
      }

      // Set new timeout to process batch - Reduced for more responsive updates
      this.parameterChangeTimeout = setTimeout(() => {
        this.processPendingParameterChanges();
      }, 8); // ~120fps debounce for smoother real-time updates

      return;
    }

    // Immediate update (no debounce)
    this.processParameterChange(node);
  }

  processPendingParameterChanges() {
    if (this.pendingParameterChanges.size === 0) return;

    // Get all affected nodes
    const changedNodes = Array.from(this.pendingParameterChanges.values());
    this.pendingParameterChanges.clear();

    // OPTIMIZATION: Compute all node values ONCE (async, non-blocking)
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate previews
          changedNodes.forEach(node => {
            // Generate preview for changed node (skip compute since we just did it)
            this.generateNodePreview(node, true);

            // Update dependent nodes (skip compute since we just did it)
            this.updateDependentNodes(node, true);
          });

          // Mark dirty and redraw once for all changes
          if (this.editor.markDirty) {
            this.editor.markDirty('parameter-change-batch');
          }
          this.editor.draw();
        }
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if no preview computer
    changedNodes.forEach(node => {
      this.generateNodePreview(node, true);
      this.updateDependentNodes(node, true);
    });

    if (this.editor.markDirty) {
      this.editor.markDirty('parameter-change-batch');
    }
    this.editor.draw();
  }

  processParameterChange(node) {
    // OPTIMIZATION: Compute all node values ONCE before generating any previews (async, non-blocking)
    if (this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate previews
          // Generate preview for changed node (skip compute since we just did it)
          this.generateNodePreview(node, true);

          // Update dependent nodes (skip compute since we just did it)
          this.updateDependentNodes(node, true);

          // Mark dirty and redraw to show updated output values
          if (this.editor.markDirty) {
            this.editor.markDirty('parameter-change');
          }
          this.editor.draw();
        }
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if no preview computer
    this.generateNodePreview(node, true);
    this.updateDependentNodes(node, true);

    if (this.editor.markDirty) {
      this.editor.markDirty('parameter-change');
    }
    this.editor.draw();
  }

  updateDependentNodes(changedNode, skipCompute = false) {
    if (!this.editor.graph?.connections) return;

    const dependents = this.editor.graph.connections
      .filter((conn) => conn.from.nodeId === changedNode.id)
      .map((conn) => conn.to.nodeId);

    if (dependents.length === 0) return;

    // OPTIMIZATION: Compute once if needed, then generate all previews (async, non-blocking)
    if (!skipCompute && this.editor?.previewComputer && this.editor?.graph) {
      this.editor.previewComputer.requestPreviewComputation(
        this.editor.graph,
        { time: performance.now() / 1000 },
        {},
        () => {
          // Preview computation completed, now generate dependent previews
          dependents.forEach((nodeId) => {
            const node = this.editor.graph.nodes.find((n) => n.id === nodeId);
            if (node) {
              this.generateNodePreview(node, true); // Skip compute since we already did it
            }
          });

          // Mark dirty and draw once after all dependents are updated
          if (this.editor.markDirty) {
            this.editor.markDirty('dependent-update');
          }
          this.editor.draw();
        }
      );
      return; // Exit early, processing will continue in callback
    }

    // Fallback: process synchronously if skipCompute is true
    dependents.forEach((nodeId) => {
      const node = this.editor.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.generateNodePreview(node, true);
      }
    });

    if (this.editor.markDirty) {
      this.editor.markDirty('dependent-update');
    }
    this.editor.draw();
  }

  onNodeAdded(node) {
    // Invalidate topological sort cache since graph structure changed
    if (this.previewSystem?.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    // Node creation does not otherwise trigger preview generation, and a structural change can
    // leave existing nodes' thumbnails stale. Regenerate the whole graph's previews (debounced,
    // to coalesce rapid adds and let the shader settle) so the new node gets a thumbnail and
    // nothing is left as a placeholder. updateAllPreviews routes through the GPU funnel.
    this._scheduleAllPreviewRefresh();
    if (this.editor.markDirty) {
      this.editor.markDirty('node-added');
    }
  }

  // Debounced "regenerate every node's preview". Used after structural changes (node add /
  // connection change) that aren't otherwise reflected in the per-node preview paths.
  _scheduleAllPreviewRefresh() {
    if (this._allPreviewRefreshTimer) clearTimeout(this._allPreviewRefreshTimer);
    this._allPreviewRefreshTimer = setTimeout(() => {
      this._allPreviewRefreshTimer = null;
      this.updateAllPreviews();
    }, 60);
  }

  onNodeRemoved(nodeId) {
    this.previewSystem.canvasManager.removeCanvas(nodeId);
    // Free the node's GPU preview texture so it doesn't linger after deletion.
    window.shaderPreviewManager?.destroyPreviewTexture(nodeId);
    // Invalidate topological sort cache since graph structure changed
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('node-removed');
    }
  }

  onConnectionChanged() {
    // Invalidate topological sort cache since graph structure changed
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('connection-changed');
    }
  }

  onGraphCleared() {
    if (!this.previewSystem) {

      return;
    }
    this.previewSystem.clearCache();
    // Free all GPU preview textures so cleared nodes don't leak GPU memory.
    window.shaderPreviewManager?.clearCache();
    // Invalidate topological sort cache since graph was cleared
    if (this.previewSystem.invalidateSortCache) {
      this.previewSystem.invalidateSortCache();
    }
    if (this.editor.markDirty) {
      this.editor.markDirty('graph-cleared');
    }
  }

  // OPTIMIZATION: Cleanup method with proper handler unregistration
  destroy() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }

    // Unregister handler from UnifiedRAFManager
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.unregisterHandler(this._handlerName);
    }

    if (this.parameterChangeTimeout) {
      clearTimeout(this.parameterChangeTimeout);
      this.parameterChangeTimeout = null;
    }

    if (this._allPreviewRefreshTimer) {
      clearTimeout(this._allPreviewRefreshTimer);
      this._allPreviewRefreshTimer = null;
    }

    this.pendingParameterChanges.clear();
  }

  // Expose preview system methods for backward compatibility
  renderTexture2D(node, size) {
    if (!this.previewSystem) {

      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    
    const textureRenderer = this.previewSystem.rendererRegistry.getRenderer('texture2d');
    if (textureRenderer) {
      textureRenderer(ctx, node);
    }
    
    return canvas;
  }

  // OPTIMIZATION: Add method to pause/resume animation for better control
  // Uses UnifiedRAFManager's enable/disable functionality
  pauseAnimation() {
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.setHandlerEnabled(this._handlerName, false);
    }
  }

  resumeAnimation() {
    if (window.renderLoop?.rafManager) {
      window.renderLoop.rafManager.setHandlerEnabled(this._handlerName, true);
    }
  }

  // OPTIMIZATION: Add method to temporarily disable time updates during heavy operations
  setTimeUpdatesEnabled(enabled) {
    this.timeUpdatesEnabled = enabled;
  }
}