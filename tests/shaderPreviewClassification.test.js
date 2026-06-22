import { describe, it, expect } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';

// The constructor and the isComputeNode/isVisualNode helpers make no GPU calls, so stub
// objects for the editor and device are sufficient to test the preview routing logic.
function makeManager() {
  return new ShaderPreviewManager(/* editor */ {}, /* device */ {}, 'rgba8unorm');
}

describe('ShaderPreviewManager node classification', () => {
  const spm = makeManager();

  describe('isComputeNode', () => {
    it('detects compute nodes by the "Compute" kind prefix', () => {
      expect(spm.isComputeNode('ComputeNoise')).toBe(true);
      expect(spm.isComputeNode({ kind: 'ComputeBlur' })).toBe(true);
      expect(spm.isComputeNode('computenoise')).toBe(true); // case-insensitive
    });

    it('returns false for non-compute nodes and bad input', () => {
      expect(spm.isComputeNode('Add')).toBe(false);
      expect(spm.isComputeNode('SimplexNoise')).toBe(false);
      expect(spm.isComputeNode(null)).toBe(false);
      expect(spm.isComputeNode({})).toBe(false);
    });
  });

  describe('isVisualNode', () => {
    it('routes vector-typed and dynamic outputs to the GPU preview path', () => {
      expect(spm.isVisualNode('UV')).toBe(true);           // vec2
      expect(spm.isVisualNode('ConstVec3')).toBe(true);    // vec3
      expect(spm.isVisualNode('SimplexNoise')).toBe(true); // vec3
      expect(spm.isVisualNode('Add')).toBe(true);          // dynamic (follows inputs)
      expect(spm.isVisualNode('Multiply')).toBe(true);     // dynamic
    });

    it('routes string (per-pixel field/color) pins to the GPU preview path', () => {
      // cat here is "Generators" (function-based), so pin shape — not category — must drive this.
      expect(spm.isVisualNode('ColorRamp')).toBe(true);     // pinsOut: ["Color"]
      expect(spm.isVisualNode('ConicGradient')).toBe(true); // pinsOut: ["Value"]
    });

    it('keeps true scalar outputs on the CPU numeric path', () => {
      expect(spm.isVisualNode('ConstFloat')).toBe(false); // f32
      expect(spm.isVisualNode('Time')).toBe(false);       // f32
    });

    it('never treats compute nodes as visual fragment previews', () => {
      expect(spm.isVisualNode('ComputeNoise')).toBe(false);
      expect(spm.isVisualNode({ kind: 'ComputeBlur' })).toBe(false);
    });

    it('handles unknown / empty input safely', () => {
      expect(spm.isVisualNode(null)).toBe(false);
      expect(spm.isVisualNode('NotARealNodeKind')).toBe(false);
    });
  });
});
