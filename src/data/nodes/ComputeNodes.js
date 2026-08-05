// src/data/nodes/ComputeNodes.js

/**
 * Compute shader node definitions for GPU-accelerated effects
 * Each compute node generates its own WGSL compute shader and stores results in a texture
 *
 * Categories (function-based):
 * - Generators: Procedural generation (noise, gradients, patterns)
 * - Modifiers: Image processing (blur, threshold, edge detect, color adjustment, etc.)
 * - Effects: Visual effects (warp, kaleidoscope, glitch, feedback)
 * - Simulation: Physics-based systems (particles, fluids, cellular automata)
 * - Utility: Compositing and transformation helpers
 */
export const ComputeNodes = {
  ComputeNoise: {
    label: "Compute Noise",
    cat: "Generators",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture"],
    params: [
      { name: 'scale', type: 'float', default: 8.0, min: 0.1, max: 50.0 },
      { name: 'octaves', type: 'int', default: 5, min: 1, max: 8 },
      { name: 'speed', type: 'float', default: 0.1, min: 0.0, max: 2.0 },
      { name: 'seed', type: 'float', default: 0.0, min: 0.0, max: 100.0 },
      { name: 'colorize', type: 'boolean', default: true },
      { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' }
    ],
    description: "Generate procedural noise using compute shader",
    workgroupSize: [8, 8, 1]
  },

  ComputeBlur: {
    label: "Compute Blur",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'radius', type: 'float', default: 5.0, min: 0.0, max: 20.0 },
      { name: 'quality', type: 'select', options: ['Low', 'Medium', 'High'], default: 'Medium' },
      { name: 'direction', type: 'select', options: ['Both', 'Horizontal', 'Vertical'], default: 'Both' }
    ],
    description: "Gaussian blur using compute shader",
    workgroupSize: [8, 8, 1]
  },

  ComputeParticles: {
    label: "Compute Particles",
    cat: "Simulation",
    inputs: 2,
    pinsIn: ["Force Field", "Velocity Field"],
    pinsOut: ["Texture"],
    params: [
      // Thirteen parameters covering three unrelated questions: what the particles are, what they
      // look like, and where they go. Grouping them that way needed one change of order —
      // `glow`/`twinkle` sat after the drift controls, away from the other appearance controls.
      // Order here is display order only: uniforms are packed by name in computeUniformLayout.js
      // and the WGSL struct is written out by hand, so neither depends on the position of a
      // parameter in this list.
      { name: 'particleCount', type: 'int', default: 10000, min: 1000, max: 100000, group: 'Basics' },
      { name: 'speed', type: 'float', default: 1.0, min: 0.0, max: 5.0, group: 'Basics' },
      { name: 'size', type: 'float', default: 2.0, min: 0.5, max: 10.0, group: 'Basics' },
      { name: 'sizeVariation', type: 'float', default: 0.3, min: 0.0, max: 1.0, description: 'Random per-particle size spread', group: 'Basics' },
      { name: 'lifetime', type: 'float', default: 5.0, min: 1.0, max: 20.0, group: 'Basics' },

      { name: 'color', type: 'color', default: [1.0, 1.0, 1.0, 1.0], description: 'Particle tint; alpha scales overall intensity', group: 'Appearance' },
      { name: 'depth', type: 'float', default: 0.0, min: 0.0, max: 1.0, displayName: '3D Depth', description: 'Pseudo-3D: near particles are bigger, brighter and faster (parallax)', group: 'Appearance' },
      { name: 'glow', type: 'float', default: 0.15, min: 0.0, max: 1.0, description: 'Soft halo around each particle', group: 'Appearance' },
      { name: 'twinkle', type: 'float', default: 0.0, min: 0.0, max: 1.0, description: 'Per-particle brightness flicker', group: 'Appearance' },

      // Directed drift and wander, all off by default — the section has nothing to show until it
      // is opened deliberately. Overall rate lives above as a basic, since it is reached for far
      // more often than the drift shaping down here.
      { name: 'driftAngle', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Direction of the shared drift, in degrees', group: 'Motion', groupCollapsed: true },
      { name: 'driftStrength', type: 'float', default: 0.0, min: 0.0, max: 2.0, description: 'How strongly all particles drift in the drift direction', group: 'Motion' },
      { name: 'scatter', type: 'float', default: 0.5, min: 0.0, max: 1.0, description: 'Random per-particle wander amount', group: 'Motion' },
      { name: 'turbulence', type: 'float', default: 0.0, min: 0.0, max: 2.0, description: 'Time-varying wobble along the path', group: 'Motion' }
    ],
    description: "GPU particle system with physics",
    workgroupSize: [64, 1, 1]
  },

  ComputeFeedback: {
    label: "Compute Feedback",
    cat: "Effects",
    inputs: 2,
    // Pin 1 (Reset) is a CPU-only control pin: a rising edge on it clears the feedback trail
    // (FeedbackResetProcessor watches it). `control: true` keeps the texture pipeline from
    // mistaking its scalar source (e.g. a Trigger) for a fragment input to auto-bridge.
    pinsIn: ["Input", { label: "Reset", type: "f32", control: true }],
    pinsOut: ["Texture"],
    params: [
      { name: 'decay', type: 'float', default: 0.95, min: 0.0, max: 1.0 },
      { name: 'scale', type: 'float', default: 1.01, min: 0.9, max: 1.1 },
      { name: 'rotation', type: 'float', default: 0.0, min: -180.0, max: 180.0 },
      { name: 'offsetX', type: 'float', default: 0.0, min: -0.1, max: 0.1 },
      { name: 'offsetY', type: 'float', default: 0.0, min: -0.1, max: 0.1 },
      { name: 'reset', type: 'button', displayName: 'Reset Feedback', action: 'resetFeedback', description: 'Clear the accumulated feedback trail (or wire a Trigger to the Reset pin)' }
    ],
    description: "Feedback loop with transformation",
    workgroupSize: [8, 8, 1]
  },

  ComputeReactionDiffusion: {
    label: "Reaction Diffusion",
    cat: "Simulation",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture"],
    params: [
      { name: 'pattern', type: 'select', options: ['Coral', 'Spots', 'Stripes', 'Waves', 'Mitosis', 'Worms', 'Spirals'], default: 'Coral' },
      { name: 'feedRate', type: 'float', default: 0.0545, min: 0.0, max: 0.1 },
      { name: 'killRate', type: 'float', default: 0.062, min: 0.0, max: 0.1 },
      { name: 'diffusionA', type: 'float', default: 1.0, min: 0.5, max: 2.0 },
      { name: 'diffusionB', type: 'float', default: 0.5, min: 0.1, max: 1.0 },
      { name: 'timestep', type: 'float', default: 1.0, min: 0.01, max: 5.0, step: 0.01 },
      { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' }
    ],
    description: "Gray-Scott reaction-diffusion simulation with pattern presets",
    workgroupSize: [8, 8, 1]
  },

  ComputeFluidSim: {
    label: "Fluid Simulation",
    cat: "Simulation",
    inputs: 1,
    pinsIn: ["Velocity Input"],
    pinsOut: ["Texture"],
    params: [
      // Five knobs tune the solver and two decide what gets pushed into it — a distinction worth
      // drawing, since a fluid that looks wrong is usually being fed wrong rather than solved
      // wrong. Both sections stay open: unlike the folded sections elsewhere, these defaults are
      // starting points rather than "off". `colorMode` and the reset button are ungrouped and
      // render below, as they belong to neither.
      { name: 'viscosity', type: 'float', default: 0.0001, min: 0.0, max: 0.01, description: 'Velocity diffusion — higher = thicker, syrupy motion', group: 'Solver' },
      { name: 'diffusion', type: 'float', default: 0.0, min: 0.0, max: 0.1, description: 'How quickly the dye spreads and fades', group: 'Solver' },
      { name: 'timestep', type: 'float', default: 0.1, min: 0.01, max: 1.0, description: 'Simulation speed', group: 'Solver' },
      { name: 'iterations', type: 'int', default: 20, min: 1, max: 50, description: 'Pressure-solve strength — higher = stiffer, more incompressible flow', group: 'Solver' },
      { name: 'curl', type: 'float', default: 15.0, min: 0.0, max: 50.0, description: 'Vorticity confinement — accentuates small swirls and turbulence', group: 'Solver' },

      { name: 'forceStrength', type: 'float', default: 1.0, min: 0.0, max: 5.0, description: 'How strongly the Velocity Input (or the built-in emitters) stirs the fluid', group: 'Injection' },
      { name: 'dyeAmount', type: 'float', default: 1.0, min: 0.0, max: 5.0, description: 'How much dye the injectors emit', group: 'Injection' },

      { name: 'colorMode', type: 'select', options: ['Dye', 'Velocity', 'Vorticity', 'Pressure'], default: 'Dye' },
      { name: 'reset', type: 'button', displayName: 'Reset Fluid', action: 'resetFeedback', description: 'Return the fluid to rest and clear all dye' }
    ],
    description: "Navier-Stokes fluid dynamics: dye advected through a self-stirring (or input-driven) velocity field",
    workgroupSize: [8, 8, 1]
  },

  ComputeConvolution: {
    label: "Compute Convolution",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'kernel', type: 'select', options: ['Sharpen', 'Edge Detect', 'Emboss', 'Custom'], default: 'Sharpen' },
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 2.0 }
    ],
    description: "Image convolution filter",
    workgroupSize: [8, 8, 1]
  },

  ComputeCellular: {
    label: "Cellular Automata",
    cat: "Simulation",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture"],
    params: [
      { name: 'rule', type: 'select', options: ['Conway Life', 'Seeds', 'Brian\'s Brain', 'Day & Night'], default: 'Conway Life' },
      { name: 'speed', type: 'float', default: 10.0, min: 1.0, max: 60.0, description: 'Generations per second' },
      { name: 'density', type: 'float', default: 0.3, min: 0.0, max: 1.0, description: 'Fraction of live cells when (re)seeded — click Reset after changing' },
      { name: 'reset', type: 'button', displayName: 'Reset / Reseed', action: 'resetFeedback', description: 'Reseed the grid with a fresh random field at the current density' }
    ],
    description: "Cellular automata simulation: Conway's Life, Seeds, Brian's Brain, Day & Night",
    workgroupSize: [8, 8, 1]
  },

  ComputeFeedbackField: {
    label: "Feedback Field",
    cat: "Simulation",
    inputs: 2,
    // Pin 1 (Reset) is a CPU-only control pin — see ComputeFeedback above.
    pinsIn: ["Input", { label: "Reset", type: "f32", control: true }],
    pinsOut: ["Texture"],
    params: [
      { name: 'mode', type: 'select', options: ['Flow', 'Reaction-Diffusion', 'Accumulate', 'Swirl'], default: 'Flow' },
      { name: 'decay', type: 'float', default: 0.98, min: 0.0, max: 1.0 },
      { name: 'diffusion', type: 'float', default: 0.1, min: 0.0, max: 1.0 },
      { name: 'feedback', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'speed', type: 'float', default: 1.0, min: 0.0, max: 5.0 },
      { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' },
      { name: 'reset', type: 'button', displayName: 'Reset Field', action: 'resetFeedback', description: 'Clear the accumulated feedback field (or wire a Trigger to the Reset pin)' }
    ],
    description: "Persistent feedback field for flow, reaction-diffusion and accumulation simulations",
    workgroupSize: [8, 8, 1]
  },

  ComputeFieldMapper: {
    label: "3D Field Visualizer",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["Field Input"],
    pinsOut: ["3D Geometry"],
    params: [
      // Seventeen parameters, of which at most twelve apply at once: the Surface and Instances
      // sections are alternatives selected by `mode`, and the two that are always live sit at
      // opposite ends of the list. The `group` fields below put each section under its own
      // collapsible heading in the parameter panel, so the mode you are not in stays folded away.
      // `mode` itself is deliberately ungrouped: it decides which section matters, so it renders
      // at the top of the panel above every heading.
      { name: 'mode', type: 'select', options: ['surface', 'instances'], default: 'surface', description: 'Surface shape or instanced field' },

      // Surface mode
      { name: 'shape', type: 'select', options: ['plane', 'sphere', 'box', 'torus'], default: 'plane', description: 'Surface: shape the field is mapped onto', group: 'Surface', activeWhen: { mode: 'surface' } },
      { name: 'resolution', type: 'int', default: 96, min: 8, max: 256, description: 'Surface: tessellation (segments)', group: 'Surface', activeWhen: { mode: 'surface' } },

      // Shared between both modes: overall size, and how much of the field reaches the result.
      { name: 'scale', type: 'float', default: 1.5, min: 0.1, max: 5.0, description: 'Size in the viewport', group: 'Size & Field' },
      { name: 'displacementScale', type: 'float', default: 0.4, min: 0.0, max: 2.0, description: 'Field-driven displacement / instance height', group: 'Size & Field' },
      { name: 'textureAmount', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'How strongly the field colors the result', group: 'Size & Field' },

      // Transform: position and rotation of the 3D object in the scene. Six fields that default to
      // a centred, unrotated object, so the section starts folded.
      { name: 'translateX', type: 'float', default: 0.0, min: -5.0, max: 5.0, description: 'Move the object along X', group: 'Transform', groupCollapsed: true },
      { name: 'translateY', type: 'float', default: 0.0, min: -5.0, max: 5.0, description: 'Move the object along Y', group: 'Transform' },
      { name: 'translateZ', type: 'float', default: 0.0, min: -5.0, max: 5.0, description: 'Move the object along Z', group: 'Transform' },
      { name: 'rotateX', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Rotate around X (degrees)', group: 'Transform' },
      { name: 'rotateY', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Rotate around Y (degrees)', group: 'Transform' },
      { name: 'rotateZ', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Rotate around Z (degrees)', group: 'Transform' },

      // Instanced mode. Inert in the default surface mode, so it starts folded too.
      { name: 'instanceShape', type: 'select', options: ['cube', 'sphere', 'quad'], default: 'cube', description: 'Instances: mesh drawn per field cell', group: 'Instances', groupCollapsed: true, activeWhen: { mode: 'instances' } },
      { name: 'instanceCount', type: 'int', default: 48, min: 4, max: 160, description: 'Instances: grid per axis (count x count cells)', group: 'Instances', activeWhen: { mode: 'instances' } },
      { name: 'instanceSize', type: 'float', default: 0.03, min: 0.002, max: 0.2, description: 'Instances: base size in world units', group: 'Instances', activeWhen: { mode: 'instances' } },
      { name: 'sizeByField', type: 'float', default: 0.6, min: 0.0, max: 1.0, description: 'Instances: how much the field scales each instance', group: 'Instances', activeWhen: { mode: 'instances' } },
      { name: 'instanceThreshold', type: 'float', default: 0.15, min: 0.0, max: 1.0, description: 'Instances: hide cells below this field value', group: 'Instances', activeWhen: { mode: 'instances' } }
    ],
    description: "Map field data onto a live 3D surface (plane, sphere, box, torus) or an instanced grid (cubes, spheres, points)",
    workgroupSize: [8, 8, 1]
  },

  // === IMAGE PROCESSING ===

  ComputeThreshold: {
    label: "Threshold",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'mode', type: 'select', options: ['Binary', 'Range', 'Adaptive'], default: 'Binary' },
      // Binary and Adaptive read `threshold`; Range reads the min/max pair instead. Whichever
      // set the current mode ignores is dimmed — it is inert, not merely unused.
      { name: 'threshold', type: 'float', default: 0.5, min: 0.0, max: 1.0, activeWhen: { mode: ['Binary', 'Adaptive'] } },
      { name: 'thresholdMin', type: 'float', default: 0.3, min: 0.0, max: 1.0, activeWhen: { mode: 'Range' } },
      { name: 'thresholdMax', type: 'float', default: 0.7, min: 0.0, max: 1.0, activeWhen: { mode: 'Range' } },
      { name: 'outputLow', type: 'float', default: 0.0, min: 0.0, max: 1.0 },
      { name: 'outputHigh', type: 'float', default: 1.0, min: 0.0, max: 1.0 }
    ],
    description: "Image thresholding operations (binary, range, adaptive)",
    workgroupSize: [8, 8, 1]
  },

  ComputeColorAdjust: {
    label: "Color Adjust",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'brightness', type: 'float', default: 0.0, min: -1.0, max: 1.0 },
      { name: 'contrast', type: 'float', default: 1.0, min: 0.0, max: 3.0 },
      { name: 'saturation', type: 'float', default: 1.0, min: 0.0, max: 3.0 },
      { name: 'hue', type: 'float', default: 0.0, min: -180.0, max: 180.0 },
      { name: 'gamma', type: 'float', default: 1.0, min: 0.1, max: 3.0 },
      { name: 'exposure', type: 'float', default: 0.0, min: -3.0, max: 3.0 }
    ],
    description: "Adjust brightness, contrast, saturation, hue, gamma, and exposure",
    workgroupSize: [8, 8, 1]
  },

  ComputeEdgeDetect: {
    label: "Edge Detect",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'method', type: 'select', options: ['Sobel', 'Scharr', 'Prewitt', 'Roberts'], default: 'Sobel' },
      { name: 'threshold', type: 'float', default: 0.1, min: 0.0, max: 1.0 },
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 5.0 },
      { name: 'invertEdges', type: 'boolean', default: false }
    ],
    description: "Edge detection using various gradient operators",
    workgroupSize: [8, 8, 1]
  },

  ComputeMorphology: {
    label: "Morphology",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'operation', type: 'select', options: ['Dilate', 'Erode', 'Open', 'Close'], default: 'Dilate' },
      { name: 'kernelSize', type: 'select', options: ['3x3', '5x5', '7x7'], default: '3x3' },
      { name: 'iterations', type: 'int', default: 1, min: 1, max: 10 },
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 1.0 }
    ],
    description: "Morphological operations (dilate, erode, open, close)",
    workgroupSize: [8, 8, 1]
  },

  // === GENERATION ===

  ComputeVoronoi: {
    label: "Voronoi",
    cat: "Generators",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture"],
    params: [
      { name: 'mode', type: 'select', options: ['Cells', 'Distance', 'Borders', 'Worley'], default: 'Cells' },
      { name: 'scale', type: 'float', default: 8.0, min: 0.1, max: 50.0 },
      { name: 'pointCount', type: 'int', default: 16, min: 4, max: 64 },
      { name: 'distanceMetric', type: 'select', options: ['Euclidean', 'Manhattan', 'Chebyshev', 'Minkowski'], default: 'Euclidean' },
      { name: 'seed', type: 'float', default: 0.0, min: 0.0, max: 100.0 },
      { name: 'animate', type: 'boolean', default: true },
      { name: 'speed', type: 'float', default: 0.1, min: 0.0, max: 2.0, activeWhen: { animate: true } }
    ],
    description: "Voronoi diagrams and Worley noise patterns",
    workgroupSize: [8, 8, 1]
  },

  ComputeGradient: {
    label: "Gradient",
    cat: "Generators",
    inputs: 1,
    pinsIn: ["Value"],
    pinsOut: ["Texture"],
    params: [
      // When a node is wired to the "Value" input, its luminance is blended into the
      // gradient position by this amount: 0 = ignore the input (pure built-in gradient),
      // 1 = the input fully drives the gradient (acts like the old Color Ramp).
      //
      // It leads the list, and is ungrouped so it renders above both headings: it decides whether
      // the gradient's own geometry means anything at all, which makes it the first thing to check
      // when a wired-up Gradient does not look like the shape below says it should.
      { name: 'inputMix', type: 'float', default: 1.0, min: 0.0, max: 1.0, activeWhenConnected: 0 },

      // The remaining twelve split cleanly in two: where the gradient runs, and what colors it
      // takes. Both stay open — either is a normal thing to reach for.
      { name: 'type', type: 'select', options: ['Linear', 'Radial', 'Angular', 'Diamond'], default: 'Linear', group: 'Shape' },
      { name: 'angle', type: 'float', default: 0.0, min: 0.0, max: 360.0, group: 'Shape', activeWhen: { type: ['Linear', 'Angular'] } },
      // Linear runs across the whole image from a fixed midpoint; only the other three are centred.
      { name: 'centerX', type: 'float', default: 0.5, min: 0.0, max: 1.0, group: 'Shape', activeWhen: { type: ['Radial', 'Angular', 'Diamond'] } },
      { name: 'centerY', type: 'float', default: 0.5, min: 0.0, max: 1.0, group: 'Shape', activeWhen: { type: ['Radial', 'Angular', 'Diamond'] } },
      { name: 'radius', type: 'float', default: 0.5, min: 0.0, max: 2.0, group: 'Shape', activeWhen: { type: ['Radial', 'Diamond'] } },
      { name: 'repeat', type: 'int', default: 1, min: 1, max: 20, group: 'Shape' },
      { name: 'reverse', type: 'boolean', default: false, group: 'Shape' },

      { name: 'colorMode', type: 'select', options: ['Grayscale', 'Rainbow', 'Gradient'], default: 'Grayscale', group: 'Color' },
      // Rainbow builds its color in HSV; Grayscale scales by brightness alone; Gradient takes its
      // color from the stops and reads neither.
      { name: 'saturation', type: 'float', default: 0.8, min: 0.0, max: 1.0, group: 'Color', activeWhen: { colorMode: 'Rainbow' } },
      { name: 'brightness', type: 'float', default: 1.0, min: 0.0, max: 2.0, group: 'Color', activeWhen: { colorMode: ['Grayscale', 'Rainbow'] } },
      {
        name: 'colorStops',
        type: 'colorstops',
        group: 'Color',
        activeWhen: { colorMode: 'Gradient' },
        default: [
          { position: 0.0, color: [0, 0, 0, 1] },
          { position: 1.0, color: [1, 1, 1, 1] }
        ]
      },
      { name: 'interpolation', type: 'select', options: ['Linear', 'Step', 'Smooth'], default: 'Linear', group: 'Color', activeWhen: { colorMode: 'Gradient' } }
    ],
    description: "Generate linear, radial, angular, and diamond gradients with visual color picker. Wire a value/mask into the input to drive the gradient (replaces Color Ramp).",
    workgroupSize: [8, 8, 1]
  },

  ComputePattern: {
    label: "Pattern",
    cat: "Generators",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture"],
    params: [
      { name: 'type', type: 'select', options: ['Checkerboard', 'Stripes', 'Dots', 'Grid', 'Hexagon', 'Brick'], default: 'Checkerboard' },
      { name: 'scaleX', type: 'float', default: 8.0, min: 0.1, max: 100.0 },
      { name: 'scaleY', type: 'float', default: 8.0, min: 0.1, max: 100.0 },
      { name: 'rotation', type: 'float', default: 0.0, min: 0.0, max: 360.0 },
      { name: 'thickness', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'smoothness', type: 'float', default: 0.01, min: 0.0, max: 0.5 }
    ],
    description: "Procedural patterns (checkerboard, stripes, dots, grid, hexagon, brick)",
    workgroupSize: [8, 8, 1]
  },

  // === EFFECTS ===

  ComputeWarp: {
    label: "Warp",
    cat: "Effects",
    inputs: 2,
    pinsIn: ["Input", "Warp Field"],
    pinsOut: ["Texture"],
    params: [
      { name: 'mode', type: 'select', options: ['Displace', 'Twist', 'Bulge', 'Pinch', 'Wave'], default: 'Displace' },
      { name: 'strength', type: 'float', default: 0.5, min: 0.0, max: 5.0 },
      { name: 'centerX', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'centerY', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'radius', type: 'float', default: 0.5, min: 0.0, max: 2.0 },
      { name: 'frequency', type: 'float', default: 4.0, min: 0.1, max: 20.0 },
      { name: 'phase', type: 'float', default: 0.0, min: 0.0, max: 360.0 }
    ],
    description: "UV distortion and displacement effects",
    workgroupSize: [8, 8, 1]
  },

  ComputeKaleidoscope: {
    label: "Kaleidoscope",
    cat: "Effects",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'segments', type: 'int', default: 6, min: 2, max: 24 },
      { name: 'rotation', type: 'float', default: 0.0, min: 0.0, max: 360.0 },
      { name: 'centerX', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'centerY', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'scale', type: 'float', default: 1.0, min: 0.1, max: 5.0 },
      { name: 'animate', type: 'boolean', default: false },
      { name: 'speed', type: 'float', default: 0.5, min: 0.0, max: 5.0, activeWhen: { animate: true } }
    ],
    description: "Kaleidoscope symmetry and mirroring effects",
    workgroupSize: [8, 8, 1]
  },

  ComputeGlitch: {
    label: "Glitch",
    cat: "Effects",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'type', type: 'select', options: ['RGB Shift', 'Block', 'Scanline', 'Pixelate', 'Corrupt'], default: 'RGB Shift' },
      { name: 'intensity', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'frequency', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'blockSize', type: 'float', default: 0.05, min: 0.01, max: 0.5 },
      { name: 'seed', type: 'float', default: 0.0, min: 0.0, max: 100.0 }
    ],
    description: "Digital glitch and artifact effects",
    workgroupSize: [8, 8, 1]
  },

  // === UTILITY ===

  ComputeMix: {
    label: "Mix",
    cat: "Utility",
    inputs: 2,
    pinsIn: ["Input A", "Input B"],
    pinsOut: ["Texture"],
    // Extra texture pins continue the A/B naming ("Input C", …). Each one is blended onto the
    // running result in pin order, so Mix composites a whole stack in a single node.
    dynamicInputs: { min: 2, max: 8, labelStyle: "upperLetter", labelPrefix: "Input " },
    params: [
      { name: 'mode', type: 'select', options: ['Mix', 'Add', 'Multiply', 'Screen', 'Overlay', 'Difference', 'Exclusion', 'Lighten', 'Darken'], default: 'Mix' },
      { name: 'amount', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'opacity', type: 'float', default: 1.0, min: 0.0, max: 1.0 }
    ],
    description: "Blend and composite multiple textures with various blend modes",
    workgroupSize: [8, 8, 1]
  },

  ComputeTransform: {
    label: "Transform",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'translateX', type: 'float', default: 0.0, min: -1.0, max: 1.0 },
      { name: 'translateY', type: 'float', default: 0.0, min: -1.0, max: 1.0 },
      { name: 'rotation', type: 'float', default: 0.0, min: -180.0, max: 180.0 },
      { name: 'scaleX', type: 'float', default: 1.0, min: 0.1, max: 5.0 },
      { name: 'scaleY', type: 'float', default: 1.0, min: 0.1, max: 5.0 },
      { name: 'pivotX', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'pivotY', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'wrapMode', type: 'select', options: ['Repeat', 'Clamp', 'Mirror'], default: 'Repeat' }
    ],
    description: "Translate, rotate, and scale textures",
    workgroupSize: [8, 8, 1]
  },

  ComputeChannels: {
    label: "Channels",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'operation', type: 'select', options: ['Swap', 'Extract', 'Combine', 'Remap'], default: 'Swap' },
      { name: 'redSource', type: 'select', options: ['R', 'G', 'B', 'A', '0', '1'], default: 'R' },
      { name: 'greenSource', type: 'select', options: ['R', 'G', 'B', 'A', '0', '1'], default: 'G' },
      { name: 'blueSource', type: 'select', options: ['R', 'G', 'B', 'A', '0', '1'], default: 'B' },
      { name: 'alphaSource', type: 'select', options: ['R', 'G', 'B', 'A', '0', '1'], default: 'A' }
    ],
    description: "Channel operations (swap, extract, combine, remap)",
    workgroupSize: [8, 8, 1]
  },

  ComputeHSV: {
    label: "HSV",
    cat: "Utility",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'operation', type: 'select', options: ['RGB to HSV', 'HSV to RGB', 'Adjust HSV'], default: 'Adjust HSV' },
      { name: 'hueShift', type: 'float', default: 0.0, min: -180.0, max: 180.0 },
      { name: 'saturationMult', type: 'float', default: 1.0, min: 0.0, max: 3.0 },
      { name: 'valueMult', type: 'float', default: 1.0, min: 0.0, max: 3.0 }
    ],
    description: "HSV color space operations and conversions",
    workgroupSize: [8, 8, 1]
  },

  // === ANALYSIS ===

  ComputeHistogram: {
    label: "Histogram",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'operation', type: 'select', options: ['Equalize', 'Normalize', 'Stretch', 'Visualize'], default: 'Equalize' },
      { name: 'channel', type: 'select', options: ['RGB', 'R', 'G', 'B', 'Luminance'], default: 'Luminance' },
      { name: 'bins', type: 'int', default: 16, min: 8, max: 32 },
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 1.0 }
    ],
    description: "Histogram-based image analysis and equalization",
    workgroupSize: [8, 8, 1]
  },

  ComputeLuminance: {
    label: "Luminance",
    cat: "Modifiers",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture"],
    params: [
      { name: 'method', type: 'select', options: ['Rec709', 'Rec601', 'Average', 'Max', 'Min'], default: 'Rec709' },
      { name: 'outputMode', type: 'select', options: ['Grayscale', 'Preserve Color', 'Isoluminant'], default: 'Grayscale' },
      { name: 'threshold', type: 'float', default: 0.5, min: 0.0, max: 1.0 }
    ],
    description: "Luminance extraction and operations",
    workgroupSize: [8, 8, 1]
  }
};
