// src/ui/secondMonitorScene3D.js
//
// The 3D Field Visualizer, redrawn natively in the second-monitor window.
//
// In the editor each 3D node renders its geometry through its own camera into a
// texture of its own (SceneRenderer3D), and FieldMapperIntegration publishes that
// texture into the compute executor's tables, so the output shader samples it as
// compute_node_<id>. That texture is rendered pixels — the receiver cannot get it
// from the compiled WGSL — so a 3D graph used to put the output window on the
// pixel-mirror path (a full-frame readback and copy every frame).
//
// None of the pixels are needed. The geometry is built from a field texture the
// receiver already reproduces (a compute node, or a fragment chain its executor
// bridges), and everything else is a handful of numbers: the node's camera, its
// transform and its shape settings. The editor streams those per frame (SCENE3D)
// and this module draws the same geometry with the same renderers into its own
// targets, then publishes them exactly where the editor does. From there the
// receiver's output shader and compute nodes find them like any other texture.

import { ShapeRenderer } from '../scene/renderers/ShapeRenderer.js';
import { InstanceRenderer } from '../scene/renderers/InstanceRenderer.js';
import { NodeCamera3D } from '../scene/NodeCamera3D.js';
import { drawFieldMapper } from '../scene/SceneRenderer3D.js';

// The editor caps its 3D targets the same way (SceneRenderer3D._getRenderResolution).
const MAX_TARGET_EDGE = 2048;
// Frames a replaced target stays alive: bind groups built against it are rebuilt
// on the next render, so a couple of seconds is ample.
const RETIRE_FRAMES = 120;
const TARGET_FORMAT = 'rgba8unorm';

/**
 * Fit a render size under the target cap, keeping its shape.
 * @param {number} width
 * @param {number} height
 * @returns {[number, number]}
 */
export function fitTargetSize(width, height) {
  let w = Math.max(1, Math.round(Number(width) || 0));
  let h = Math.max(1, Math.round(Number(height) || 0));
  const over = Math.max(w, h) / MAX_TARGET_EDGE;
  if (over > 1) {
    w = Math.max(1, Math.round(w / over));
    h = Math.max(1, Math.round(h / over));
  }
  return [w, h];
}

export class ReceiverScene3D {
  /** @param {GPUDevice} device */
  constructor(device) {
    this.device = device;
    /** @type {Map<string|number, {state: Object, camera: NodeCamera3D, renderers: Object|null, target: GPUTexture|null}>} */
    this.nodes = new Map();
    this.depth = null;
    this.width = 0;
    this.height = 0;
    this.sampler = null;
    this._retired = [];
  }

  /** Ids of the 3D nodes currently drawn. */
  get ids() {
    return [...this.nodes.keys()];
  }

  /**
   * Adopt the editor's latest SCENE3D list. Nodes no longer listed are dropped
   * (and unpublished from `exec`).
   * @param {Array<{id, sourceId, shapeParams, model, camera}>} list
   * @param {Object|null} exec - the receiver's ComputeExecutor
   */
  apply(list, exec) {
    const seen = new Set();
    for (const n of (Array.isArray(list) ? list : [])) {
      if (!n || n.id === null || n.id === undefined) continue;
      seen.add(n.id);
      let entry = this.nodes.get(n.id);
      if (!entry) {
        entry = { state: null, camera: new NodeCamera3D(), renderers: null, target: null };
        this.nodes.set(n.id, entry);
      }
      entry.state = n;
      // The editor already advanced any turntable spin; take the pose as sent.
      if (n.camera) entry.camera.setState({ ...n.camera, autoRotate: false });
    }
    for (const [id, entry] of [...this.nodes]) {
      if (seen.has(id)) continue;
      this._dropNode(id, entry, exec);
    }
  }

  /**
   * Draw every 3D node into its own target and publish it into `exec`'s tables
   * under the node's id — the same place FieldMapperIntegration.publishOutputs
   * puts the editor's. Encodes and submits its own command buffer, so it lands
   * on the queue ahead of the frame that samples it.
   * @param {Object|null} exec - the receiver's ComputeExecutor
   * @param {number} width - render size (the composition's shape)
   * @param {number} height
   */
  render(exec, width, height) {
    this._ageRetired();
    if (!this.device || this.nodes.size === 0) return;
    const [w, h] = fitTargetSize(width, height);
    if (w !== this.width || h !== this.height) this._resize(w, h);
    if (!this.sampler) {
      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    }

    const aspect = w / h;
    const encoder = this.device.createCommandEncoder({ label: 'second-monitor-3d' });
    for (const [id, entry] of this.nodes) {
      const state = entry.state || {};
      if (!entry.target) entry.target = this._createTarget(id);
      if (!entry.renderers) {
        entry.renderers = {
          shape: new ShapeRenderer(this.device),
          instances: new InstanceRenderer(this.device),
        };
        entry.renderers.shape.initialize(TARGET_FORMAT);
        entry.renderers.instances.initialize(TARGET_FORMAT);
      }
      entry.camera.setAspect(aspect);

      let texture = null;
      if (exec && state.sourceId !== null && state.sourceId !== undefined) {
        const out = typeof exec.getNodeOutput === 'function' ? exec.getNodeOutput(state.sourceId) : null;
        if (out && out !== exec.fallbackTexture) texture = out;
      }

      let pass = null;
      try {
        pass = encoder.beginRenderPass({
          label: `second-monitor-3d-${id}`,
          colorAttachments: [{
            view: entry.target.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
          depthStencilAttachment: {
            view: this.depth.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        });
        drawFieldMapper(pass, entry.renderers, {
          viewMatrix: entry.camera.getViewMatrix(),
          projectionMatrix: entry.camera.getProjectionMatrix(),
          modelMatrix: { elements: state.model && state.model.length === 16 ? state.model : IDENTITY },
          shapeParams: state.shapeParams,
          texture,
        });
      } catch {
        // One bad node must not cost the others their frame
      } finally {
        pass?.end();
      }
      this._publish(exec, id, entry.target);
    }
    try { this.device.queue.submit([encoder.finish()]); } catch { /* skip this frame */ }
  }

  /** Release every GPU resource and unpublish from `exec`. */
  dispose(exec) {
    for (const [id, entry] of [...this.nodes]) this._dropNode(id, entry, exec);
    this.depth?.destroy?.();
    this.depth = null;
    this.width = this.height = 0;
    for (const r of this._retired) r.texture.destroy?.();
    this._retired = [];
  }

  _publish(exec, id, texture) {
    if (!exec) return;
    if (!exec.externalOutputNodeIds) exec.externalOutputNodeIds = new Set();
    exec.externalOutputNodeIds.add(id);
    exec.nodeOutputs?.set?.(id, texture);
    const existing = exec.computeTextures?.get?.(id);
    if (existing) existing.texture = texture;
    else exec.computeTextures?.set?.(id, { texture, sampler: this.sampler });
  }

  _dropNode(id, entry, exec) {
    if (exec) {
      exec.externalOutputNodeIds?.delete?.(id);
      exec.nodeOutputs?.delete?.(id);
      exec.computeTextures?.delete?.(id);
    }
    entry.renderers?.shape?.destroy?.();
    entry.renderers?.instances?.destroy?.();
    this._retire(entry.target);
    this.nodes.delete(id);
  }

  _resize(w, h) {
    this.width = w;
    this.height = h;
    this.depth?.destroy?.();
    this.depth = this.device.createTexture({
      label: 'second-monitor-3d-depth',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // Colour targets may still be bound by the output's bind groups; retire them
    // and let render() create new ones at the new size.
    for (const entry of this.nodes.values()) {
      this._retire(entry.target);
      entry.target = null;
    }
  }

  _createTarget(id) {
    return this.device.createTexture({
      label: `second-monitor-3d-${id}`,
      size: { width: this.width, height: this.height, depthOrArrayLayers: 1 },
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  }

  _retire(texture) {
    if (texture) this._retired.push({ texture, age: 0 });
  }

  _ageRetired() {
    if (!this._retired.length) return;
    const keep = [];
    for (const r of this._retired) {
      r.age += 1;
      if (r.age > RETIRE_FRAMES) r.texture.destroy?.();
      else keep.push(r);
    }
    this._retired = keep;
  }
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
