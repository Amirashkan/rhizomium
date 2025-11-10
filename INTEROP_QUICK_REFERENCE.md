# Fragment & Compute Shader Interoperability - Quick Reference

**Key Findings:**
- Compute → Fragment: ✅ FULLY WORKING (80% of interoperability)
- Fragment → Compute: ❌ NOT IMPLEMENTED (20% missing)
- **Overall Compatibility:** ~80% - Can be unified with optional bridge nodes

---

## Current Working Flows

### Forward (Compute → Fragment) ✅
```
ComputeNoise (outputs texture)
    ↓
Fragment compiles bindings for compute textures
    ↓
Fragment shader samples compute output
    ↓
Result: ComputeNoise → Math Ops → Final Output
```

**Example in Code:**
```wgsl
@group(0) @binding(100) var compute_node_1: texture_2d<f32>;  // Compute texture
@group(0) @binding(101) var sampler_compute_node_1: sampler;

@fragment
fn main(in: FragmentInput) -> @location(0) vec4<f32> {
  let noise = textureSample(compute_node_1, sampler_compute_node_1, uv);
  let blended = mix(noise.rgb, vec3(1.0), 0.5);
  return vec4<f32>(blended, 1.0);
}
```

### Reverse (Fragment → Compute) ❌

**Problem:** Fragment nodes generate inline expressions, not textures
- Fragment node expression: `let output = sin(in.uv.x) * 0.5;`
- Compute shader needs: texture input
- **Solution:** Render fragment to texture first (bridge node)

---

## Architecture Overview

### Fragment Shader System
- **Execution:** Per-pixel in fragment shader
- **Compilation:** Dynamic WGSL generation from node DAG
- **Output:** Inline expressions → final canvas color
- **Nodes:** 129 total (Math, Field, Vector, Transform, etc.)
- **API:** Expression-based (indirect)

### Compute Shader System
- **Execution:** Pre-processing in compute workgroups
- **Output:** GPU textures (can be read by fragment)
- **Nodes:** 26 total (Noise, Blur, Effects, Simulation)
- **API:** ComputeNodeBase (direct, unified)
- **Support:** Feedback loops, multi-input, dynamic parameters

---

## How to Achieve Full Interoperability

### Option 1: Bridge Nodes (Recommended - 300 LOC)
```javascript
// FragmentBridge node: Fragment output → Texture
{
  kind: 'FragmentBridge',
  inputs: 1,
  pinsIn: ['Fragment'],
  pinsOut: ['Texture'],
  process: () => {
    // 1. Render fragment to texture
    // 2. Register as compute input
  }
}

// Usage: Fragment → FragmentBridge → ComputeBlur → Output
```

**Effort:** ~300 lines of code
**Performance:** +1 render pass per bridge

### Option 2: Full Compute Refactor (Not Recommended)
Convert all 129 fragment nodes to compute shaders
- Requires rewriting all node compilers
- Performance overhead on all operations
- Loses advantages of per-pixel parallelism
- Estimated: 2000+ LOC changes

### Option 3: Keep Separate (Current Design)
- Fragment for expressive per-pixel operations
- Compute for bulk GPU processing
- Use one direction (Compute → Fragment)

---

## Node Inventory

### Fragment Nodes (129 total)
| Category | Count |
|----------|-------|
| Math | 43 |
| Field | 20 |
| Vector | ~15 |
| Transform | 11 |
| Utility | 19 |
| Blend | 7 |
| Input | 13 |
| Output | 1 |

### Compute Nodes (26 total)
| Category | Count | Examples |
|----------|-------|----------|
| Generation | 3 | ComputeNoise, ComputeVoronoi |
| Image Processing | 11 | ComputeBlur, ComputeEdgeDetect |
| Effects | 5 | ComputeWarp, ComputeKaleidoscope |
| Simulation | 4 | ComputeReactionDiffusion, ComputeParticles |
| Advanced | 3 | ComputeHistogram, ComputeLuminance |

### Compute Nodes Supporting Multiple Inputs
```
ComputeWarp           // Input + warp field
ComputeMix            // Input A + Input B (blend two textures)
ComputeFluidSim       // Velocity input + pressure
ComputeParticles      // Force field + velocity field
ComputeFeedback       // Input + feedback buffer
ComputeFeedbackField  // Input + feedback buffer
```

---

## Key Implementation Details

### Fragment Compilation (glslBuilder.js)
```
Graph → GraphProcessor (topological sort)
     → NodeCompiler (compile each node)
     → TypeConverter (handle type conversions)
     → ShaderTemplate (wrap with bindings)
     → Final WGSL Fragment Shader
```

### Compute Execution (ComputeExecutor.js)
```
1. Initialize: Read window.computeNodeRegistry
2. Topological sort compute nodes
3. Each frame:
   - Dispatch in dependency order
   - Update output dictionary
   - Fragment shader samples results
```

### Texture Bindings (Auto-generated)
```wgsl
@group(0) @binding(100+) var compute_nodeId: texture_2d<f32>;
@group(0) @binding(101+) var sampler_compute_nodeId: sampler;
```

---

## File Locations Reference

**Core Systems:**
- Fragment compilation: `/src/codegen/glslBuilder.js`
- Compute execution: `/src/gpu/ComputeExecutor.js`
- Compute node base: `/src/gpu/ComputeNodeBase.js`
- Node definitions: `/src/data/NodeDefs.js`

**Node Definitions:**
- Fragment nodes: `/src/data/nodes/*.js` (FieldNodes, MathNodes, etc.)
- Compute nodes: `/src/data/nodes/ComputeNodes.js`
- Compute compilers: `/src/codegen/compilers/ComputeNodes.js`

**Type System:**
- Type compatibility: `/src/data/TypeSystem.js`
- Type conversion: `/src/codegen/processors/TypeConverter.js`

---

## Current Limitations & Solutions

| Limitation | Current | Workaround |
|-----------|---------|-----------|
| Fragment → Compute | ❌ Not supported | Use bridge nodes (recommend) |
| Compute → Fragment | ✅ Works | Use texture sampling |
| Multiple compute inputs | ✅ Works | ComputeWarp, ComputeMix |
| Feedback loops | ✅ Works | Ping-pong buffers |
| Dynamic parameters | ✅ Works | Uniform buffers |
| Parameter expressions | ✅ Works | `=node_14` syntax |

---

## Performance Notes

**Current Pipeline (Efficient)**
```
Compute shaders execute → Pre-process to texture
Fragment shader executes → Sample compute texture + per-pixel ops
Canvas render → Display result
Total cost: 1 compute pass + 1 render pass
```

**With Fragment Bridges (Adds Overhead)**
```
Fragment shader 1 executes → Render to intermediate texture
Compute shader executes → Read fragment texture
Fragment shader 2 executes → Per-pixel final operations
Total cost: 1 render pass + 1 compute pass + 1 render pass
```

**Recommendation:** Use bridge nodes sparingly, only when necessary

---

## Next Steps for Full Unification

If implementing fragment bridge nodes:

1. Create `/src/data/nodes/BridgeNodes.js`
2. Create `/src/gpu/FragmentBridgeExecutor.js`
3. Add bridge compiler to `/src/codegen/compilers/`
4. Update ComputeExecutor to recognize bridge outputs
5. Add tests in `/tests/`
6. Update documentation

**Estimated work:** 2-3 days for experienced developer

---

**For detailed analysis, see:** `/SHADER_INTEROP_ANALYSIS.md` (1056 lines)
