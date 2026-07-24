// src/gpu/computeUniformLayout.js
//
// Single source of truth for packing a compute node's uniform buffer.
//
// The editor's live renderer (src/gpu/ComputeShaderManager.js) calls this so
// every compute node type packs its uniforms in the exact WGSL struct order.
// Keeping the packing in one place stops the per-node packing switches from
// drifting out of sync with the generated WGSL.
//
// The float layout of each node mirrors the `struct Uniforms { ... }` that
// src/codegen/compilers/ComputeNodes.js generates for that node:
//   index 0,1 -> resolution (vec2<f32>)
//   index 2   -> time (f32)
//   index 3+  -> node-specific parameters, in struct declaration order.
//
// Keep this dependency-free: it must load unchanged in the editor (ES module
// graph) and in the standalone viewer document.

/**
 * ComputeChannels: map a channel source string to its shader index.
 * R=0, G=1, B=2, A=3, 0=4, 1=5 (matches the WGSL switch in ComputeNodes.js).
 */
export function channelSourceIndex(source) {
  const sources = { R: 0, G: 1, B: 2, A: 3, '0': 4, '1': 5 };
  return sources[source] || 0;
}

/**
 * ComputeParticles: coerce a color parameter to an [r,g,b,a] array.
 * Accepts the canonical array form, a '#rrggbb' hex string (from a color input
 * or a legacy text edit), or a comma-separated list like '1,0,0.5,1'.
 */
export function colorParamToArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const hex = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1.0];
    }
    const parts = value.split(',').map((s) => parseFloat(s));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1.0];
    }
  }
  return [1.0, 1.0, 1.0, 1.0];
}

/**
 * Pack a compute node's uniform values into a Float32Array(32).
 * (Was 16; expanded for parameter-rich nodes like ComputeParticles. The GPU
 * buffer in ComputeShaderManager is sized to match — WGSL structs smaller than
 * the buffer are fine.)
 *
 * @param {string|undefined} kind - node.kind, e.g. 'ComputeNoise'
 * @param {Object|undefined} params - node parameters. Either node.params, or the
 *   viewer's live-merged params during a parameter drag. Values may be numbers,
 *   booleans, enum strings (e.g. 'Horizontal'), or expression strings ('=time*2').
 * @param {Object} ctx
 * @param {number} ctx.width  - output texture width
 * @param {number} ctx.height - output texture height
 * @param {number} ctx.time   - current time in seconds
 * @param {(value:*, defaultValue:number)=>number} ctx.evaluate - resolves a
 *   numeric / boolean / expression parameter to a float. Injected by the caller
 *   so each side keeps its own clock, audio envelope and expression engine.
 * @returns {Float32Array} 32 floats laid out to match the node's WGSL Uniforms.
 */
export function packComputeUniforms(kind, params, ctx) {
  const u = new Float32Array(32);
  const p = params || {};
  const ev = ctx.evaluate;

  u[0] = ctx.width;
  u[1] = ctx.height;
  u[2] = ctx.time;

  switch (kind) {
    case 'ComputeNoise':
      u[3] = ev(p.scale, 8.0);
      u[4] = ev(p.octaves, 5);
      u[5] = ev(p.speed, 0.1);
      u[6] = p.colorize ? 1.0 : 0.0;
      u[7] = ev(p.seed, 0.0);
      break;

    case 'ComputeParticles': {
      u[3] = ev(p.particleCount, 10000);
      u[4] = ev(p.speed, 1.0);
      u[5] = ev(p.size, 2.0);
      u[6] = ev(p.lifetime, 5.0);
      // color is an [r,g,b,a] array (or a hex/CSV string from older saves); the
      // WGSL struct takes it as four scalar fields (colorR..colorA) to avoid
      // vec4 16-byte alignment padding.
      const color = colorParamToArray(p.color);
      u[7] = color[0] ?? 1.0;
      u[8] = color[1] ?? 1.0;
      u[9] = color[2] ?? 1.0;
      u[10] = color[3] ?? 1.0;
      u[11] = ev(p.depth, 0.0);
      u[12] = ev(p.driftAngle, 0.0);
      u[13] = ev(p.driftStrength, 0.0);
      u[14] = ev(p.scatter, 0.5);
      u[15] = ev(p.turbulence, 0.0);
      u[16] = ev(p.glow, 0.15);
      u[17] = ev(p.twinkle, 0.0);
      u[18] = ev(p.sizeVariation, 0.3);
      break;
    }

    case 'ComputeReactionDiffusion':
      u[3] = ev(p.feedRate, 0.055);
      u[4] = ev(p.killRate, 0.062);
      u[5] = ev(p.diffusionA, 1.0);
      u[6] = ev(p.diffusionB, 0.5);
      u[7] = ev(p.timestep, 1.0);
      break;

    case 'ComputeFeedback':
      u[3] = ev(p.decay, 0.95);
      u[4] = ev(p.scale, 1.01);
      u[5] = ev(p.rotation, 0.0);
      u[6] = ev(p.offsetX, 0.0);
      u[7] = ev(p.offsetY, 0.0);
      break;

    case 'ComputeBlur': {
      // quality / direction are baked enums passed as indices.
      let qualityValue = 1.0; // Medium
      if (p.quality === 'Low') qualityValue = 0.0;
      else if (p.quality === 'High') qualityValue = 2.0;
      let directionValue = 0.0; // Both
      if (p.direction === 'Horizontal') directionValue = 1.0;
      else if (p.direction === 'Vertical') directionValue = 2.0;
      u[3] = ev(p.radius, 5.0);
      u[4] = qualityValue;
      u[5] = directionValue;
      break;
    }

    case 'ComputeThreshold':
      u[3] = ev(p.threshold, 0.5);
      u[4] = ev(p.thresholdMin, 0.3);
      u[5] = ev(p.thresholdMax, 0.7);
      u[6] = ev(p.outputLow, 0.0);
      u[7] = ev(p.outputHigh, 1.0);
      break;

    case 'ComputeColorAdjust':
      u[3] = ev(p.brightness, 0.0);
      u[4] = ev(p.contrast, 1.0);
      u[5] = ev(p.saturation, 1.0);
      u[6] = ev(p.hue, 0.0);
      u[7] = ev(p.gamma, 1.0);
      u[8] = ev(p.exposure, 0.0);
      break;

    case 'ComputeConvolution':
      u[3] = ev(p.strength, 1.0);
      break;

    case 'ComputeEdgeDetect':
      u[3] = ev(p.threshold, 0.1);
      u[4] = ev(p.strength, 1.0);
      u[5] = ev(p.invertEdges, 0.0); // boolean -> 1/0 via evaluate
      break;

    case 'ComputeMorphology':
      u[3] = ev(p.strength, 1.0);
      break;

    case 'ComputeVoronoi':
      u[3] = ev(p.scale, 8.0);
      u[4] = ev(p.seed, 0.0);
      u[5] = ev(p.speed, 0.1);
      break;

    case 'ComputeGradient': {
      u[3] = ev(p.angle, 0.0);
      u[4] = ev(p.centerX, 0.5);
      u[5] = ev(p.centerY, 0.5);
      u[6] = ev(p.radius, 0.5);
      u[7] = ev(p.repeat, 1.0);
      u[8] = ev(p.saturation, 0.8);
      u[9] = ev(p.brightness, 1.0);
      const colorStops = gradientColorStops(p);
      u[10] = Math.min(colorStops.length, 8); // numStops
      u[11] = ev(p.inputMix, 1.0); // blend amount for a connected Value input
      // NOTE: the color stops themselves live in a separate storage buffer the
      // caller must update (ComputeShaderManager.updateColorStopsBuffer).
      break;
    }

    case 'ComputePattern':
      u[3] = 0.0; // _padding1
      u[4] = ev(p.scaleX, 8.0);
      u[5] = ev(p.scaleY, 8.0);
      u[6] = ev(p.rotation, 0.0);
      u[7] = ev(p.thickness, 0.5);
      u[8] = ev(p.smoothness, 0.01);
      break;

    case 'ComputeFeedbackField': {
      u[3] = ev(p.decay, 0.98);
      u[4] = ev(p.diffusion, 0.1);
      u[5] = ev(p.feedback, 0.5);
      u[6] = ev(p.speed, 1.0);
      let modeValue = 0.0; // Flow
      if (p.mode === 'Reaction-Diffusion') modeValue = 1.0;
      else if (p.mode === 'Accumulate') modeValue = 2.0;
      // 'Custom' is the legacy name for the 4th mode (now 'Swirl'); keep it mapped
      // so projects saved before the rename still select the 4th mode.
      else if (p.mode === 'Swirl' || p.mode === 'Custom') modeValue = 3.0;
      u[7] = modeValue;
      break;
    }

    case 'ComputeCellular': {
      // Struct order: speed, rule, density. `speed` is consumed on the CPU
      // (generation throttling in ComputeShaderManager.dispatch), not in WGSL,
      // but stays in the layout so `rule`/`density` land at the right offsets.
      u[3] = ev(p.speed, 10.0);
      const rules = { 'Conway Life': 0, 'Seeds': 1, "Brian's Brain": 2, 'Day & Night': 3 };
      u[4] = rules[p.rule] ?? 0;
      u[5] = ev(p.density, 0.3);
      break;
    }

    case 'ComputeFluidSim': {
      // Struct order shared by BOTH the sim shader (generateFluidSimShader)
      // and the visualization pass (fluidSimViz.js) — they read the same
      // uniform buffer, so keep all three in sync.
      u[3] = ev(p.viscosity, 0.0001);
      u[4] = ev(p.diffusion, 0.0);
      u[5] = ev(p.timestep, 0.1);
      u[6] = ev(p.iterations, 20);
      // 0=Dye, 1=Velocity, 2=Vorticity, 3=Pressure. Unset (nodes saved before
      // the node was implemented) falls back to the Dye default.
      const modes = { Dye: 0, Velocity: 1, Vorticity: 2, Pressure: 3 };
      u[7] = modes[p.colorMode] ?? 0;
      u[8] = ev(p.curl, 15.0);
      u[9] = ev(p.forceStrength, 1.0);
      u[10] = ev(p.dyeAmount, 1.0);
      break;
    }

    case 'ComputeWarp':
      u[3] = ev(p.strength, 0.5);
      u[4] = ev(p.centerX, 0.5);
      u[5] = ev(p.centerY, 0.5);
      u[6] = ev(p.radius, 0.5);
      u[7] = ev(p.frequency, 4.0);
      u[8] = ev(p.phase, 0.0);
      break;

    case 'ComputeGlitch':
      u[3] = ev(p.intensity, 0.5);
      u[4] = ev(p.frequency, 0.5);
      u[5] = 0.0; // _padding1
      u[6] = ev(p.blockSize, 0.05);
      u[7] = ev(p.seed, 0.0);
      break;

    case 'ComputeMix':
      u[3] = ev(p.amount, 0.5);
      u[4] = ev(p.opacity, 1.0);
      break;

    case 'ComputeKaleidoscope':
      u[3] = ev(p.segments, 6.0);
      u[4] = ev(p.rotation, 0.0);
      u[5] = ev(p.centerX, 0.5);
      u[6] = ev(p.centerY, 0.5);
      u[7] = ev(p.scale, 1.0);
      u[8] = ev(p.animate, 0.0); // boolean -> 1/0 via evaluate
      u[9] = ev(p.speed, 0.5);
      break;

    case 'ComputeTransform':
      u[3] = ev(p.translateX, 0.0);
      u[4] = ev(p.translateY, 0.0);
      u[5] = ev(p.rotation, 0.0);
      u[6] = ev(p.scaleX, 1.0);
      u[7] = ev(p.scaleY, 1.0);
      u[8] = ev(p.pivotX, 0.5);
      u[9] = ev(p.pivotY, 0.5);
      break;

    case 'ComputeChannels':
      u[3] = channelSourceIndex(p.redSource ?? 'R');
      u[4] = channelSourceIndex(p.greenSource ?? 'G');
      u[5] = channelSourceIndex(p.blueSource ?? 'B');
      u[6] = channelSourceIndex(p.alphaSource ?? 'A');
      break;

    case 'ComputeHSV': {
      const op = p.operation ?? 'Adjust HSV';
      u[3] = op === 'RGB to HSV' ? 0.0 : op === 'HSV to RGB' ? 1.0 : 2.0;
      u[4] = ev(p.hueShift, 0.0);
      u[5] = ev(p.saturationMult, 1.0);
      u[6] = ev(p.valueMult, 1.0);
      break;
    }

    case 'ComputeHistogram': {
      // struct order: operation, channel, bins, strength, _padding
      const operation = p.operation ?? 'Equalize';
      u[3] =
        operation === 'Equalize' ? 0.0
        : operation === 'Normalize' ? 1.0
        : operation === 'Stretch' ? 2.0
        : 3.0; // Visualize
      const channel = p.channel ?? 'Luminance';
      u[4] =
        channel === 'RGB' ? 0.0
        : channel === 'R' ? 1.0
        : channel === 'G' ? 2.0
        : channel === 'B' ? 3.0
        : 4.0; // Luminance
      u[5] = ev(p.bins, 16);
      u[6] = ev(p.strength, 1.0);
      break;
    }

    case 'ComputeLuminance': {
      const method = p.method ?? 'Rec709';
      u[3] =
        method === 'Rec709' ? 0.0
        : method === 'Rec601' ? 1.0
        : method === 'Average' ? 2.0
        : method === 'Max' ? 3.0
        : 4.0; // Min
      const outputMode = p.outputMode ?? 'Grayscale';
      u[4] =
        outputMode === 'Grayscale' ? 0.0
        : outputMode === 'Preserve Color' ? 1.0
        : 2.0; // Isoluminant
      u[5] = ev(p.threshold, 0.5);
      break;
    }

    default:
      // Unknown node type: resolution + time only, all params left at 0.
      // This matches the editor's default case.
      break;
  }

  return u;
}

/**
 * Resolve a ComputeGradient node's color stops, applying the same default
 * (black -> white) the editor uses when none are set.
 * @returns {Array<{position:number,color:number[]}>}
 */
export function gradientColorStops(params) {
  return (
    (params && params.colorStops) || [
      { position: 0.0, color: [0, 0, 0, 1] },
      { position: 1.0, color: [1, 1, 1, 1] }
    ]
  );
}
