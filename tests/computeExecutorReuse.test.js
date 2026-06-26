/**
 * ComputeExecutor reuse / re-entrancy guard
 *
 * Feedback nodes (ComputeFeedback, ComputeFeedbackField, reaction-diffusion)
 * accumulate state in ping-pong textures owned by their ComputeShaderManager.
 * initialize() clears the manager map up front and rebuilds asynchronously,
 * reusing a node's existing manager when its WGSL/resolution/feedback config is
 * unchanged so the accumulated state survives unrelated graph edits.
 *
 * The bug these tests pin down: graph edits (param drags, node moves, selection)
 * funnel through updateShaderFromGraph -> initialize(), which is async. Two calls
 * that overlapped would let the second snapshot an already-cleared manager map,
 * defeat reuse, and recreate every manager from scratch — wiping feedback state.
 * The re-entrancy guard coalesces overlapping calls so reuse always holds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputeExecutor } from '../src/gpu/ComputeExecutor.js';

const FEEDBACK_WGSL = `
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;
@group(0) @binding(4) var feedbackTexture: texture_2d<f32>;

struct Uniforms { resolution: vec2<f32>, time: f32, decay: f32 }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  textureStore(outputTexture, vec2<i32>(gid.xy), vec4<f32>(0.0));
}`;

function registerFeedbackNode(decay) {
  // Same registry shape registerComputeNode() produces. The wgslCode is stable
  // across decay changes (decay is a uniform), so the reuse signature matches.
  window.computeNodeRegistry = new Map([
    ['7', {
      node: { id: 7, kind: 'ComputeFeedback', params: { decay } },
      getInput: () => null,
      resolution: [256, 256],
      wgslCode: FEEDBACK_WGSL,
      supportsFeedback: true,
      lastInputHash: null,
    }],
  ]);
}

describe('ComputeExecutor reuse + re-entrancy guard', () => {
  let device;
  let prevRegistry;
  let prevFloatingPreview;

  beforeEach(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter.requestDevice();
    prevRegistry = window.computeNodeRegistry;
    prevFloatingPreview = window.floatingPreview;
    // Pin a stable preview resolution so the reuse signature doesn't drift.
    window.floatingPreview = { settings: { settings: { resolution: { width: 256, height: 256 } } } };
  });

  afterEach(() => {
    window.computeNodeRegistry = prevRegistry;
    window.floatingPreview = prevFloatingPreview;
    if (device) device.destroy();
  });

  it('reuses the feedback manager across a normal rebuild (state preserved)', async () => {
    const exec = new ComputeExecutor(device);

    registerFeedbackNode(0.95);
    await exec.initialize();
    const first = exec.computeManagers.get('7');
    expect(first).toBeTruthy();

    // A subsequent edit that only changes a uniform-backed param must keep the
    // same manager instance (so its ping-pong textures, i.e. accumulated state,
    // are not wiped).
    registerFeedbackNode(0.20);
    await exec.initialize();
    const second = exec.computeManagers.get('7');
    expect(second).toBe(first);
  });

  it('coalesces overlapping initialize() calls so reuse is not defeated', async () => {
    const exec = new ComputeExecutor(device);

    registerFeedbackNode(0.95);
    await exec.initialize();
    const original = exec.computeManagers.get('7');
    expect(original).toBeTruthy();

    // Fire two rebuilds without awaiting the first — this is what rapid graph
    // edits do. Before the guard, the second call snapshotted an already-cleared
    // manager map and recreated the manager, wiping feedback state.
    registerFeedbackNode(0.50);
    const a = exec.initialize();
    const b = exec.initialize();
    await Promise.all([a, b]);

    const after = exec.computeManagers.get('7');
    expect(after).toBe(original);
  });

  it('never runs two initialize passes concurrently', async () => {
    const exec = new ComputeExecutor(device);
    registerFeedbackNode(0.95);

    let active = 0;
    let maxConcurrent = 0;
    const realOnce = exec._initializeOnce.bind(exec);
    exec._initializeOnce = async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      try {
        await realOnce();
        // Yield so an unguarded second pass would interleave here.
        await Promise.resolve();
      } finally {
        active--;
      }
    };

    await Promise.all([exec.initialize(), exec.initialize(), exec.initialize()]);
    expect(maxConcurrent).toBe(1);
  });
});
