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
      { name: 'particleCount', type: 'int', default: 10000, min: 1000, max: 100000 },
      { name: 'speed', type: 'float', default: 1.0, min: 0.0, max: 5.0 },
      { name: 'size', type: 'float', default: 2.0, min: 0.5, max: 10.0 },
      { name: 'sizeVariation', type: 'float', default: 0.3, min: 0.0, max: 1.0, description: 'Random per-particle size spread' },
      { name: 'lifetime', type: 'float', default: 5.0, min: 1.0, max: 20.0 },
      { name: 'color', type: 'color', default: [1.0, 1.0, 1.0, 1.0], description: 'Particle tint; alpha scales overall intensity' },
      { name: 'depth', type: 'float', default: 0.0, min: 0.0, max: 1.0, displayName: '3D Depth', description: 'Pseudo-3D: near particles are bigger, brighter and faster (parallax)' },
      { name: 'driftAngle', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Direction of the shared drift, in degrees' },
      { name: 'driftStrength', type: 'float', default: 0.0, min: 0.0, max: 2.0, description: 'How strongly all particles drift in the drift direction' },
      { name: 'scatter', type: 'float', default: 0.5, min: 0.0, max: 1.0, description: 'Random per-particle wander amount' },
      { name: 'turbulence', type: 'float', default: 0.0, min: 0.0, max: 2.0, description: 'Time-varying wobble along the path' },
      { name: 'glow', type: 'float', default: 0.15, min: 0.0, max: 1.0, description: 'Soft halo around each particle' },
      { name: 'twinkle', type: 'float', default: 0.0, min: 0.0, max: 1.0, description: 'Per-particle brightness flicker' }
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
      { name: 'viscosity', type: 'float', default: 0.0001, min: 0.0, max: 0.01, description: 'Velocity diffusion — higher = thicker, syrupy motion' },
      { name: 'diffusion', type: 'float', default: 0.0, min: 0.0, max: 0.1, description: 'How quickly the dye spreads and fades' },
      { name: 'timestep', type: 'float', default: 0.1, min: 0.01, max: 1.0, description: 'Simulation speed' },
      { name: 'iterations', type: 'int', default: 20, min: 1, max: 50, description: 'Pressure-solve strength — higher = stiffer, more incompressible flow' },
      { name: 'curl', type: 'float', default: 15.0, min: 0.0, max: 50.0, description: 'Vorticity confinement — accentuates small swirls and turbulence' },
      { name: 'forceStrength', type: 'float', default: 1.0, min: 0.0, max: 5.0, description: 'How strongly the Velocity Input (or the built-in emitters) stirs the fluid' },
      { name: 'dyeAmount', type: 'float', default: 1.0, min: 0.0, max: 5.0, description: 'How much dye the injectors emit' },
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
      // What to render (GPU-driven, always live)
      { name: 'mode', type: 'select', options: ['surface', 'instances'], default: 'surface', description: 'Surface shape or instanced field' },

      // Surface mode
      { name: 'shape', type: 'select', options: ['plane', 'sphere', 'box', 'torus'], default: 'plane', description: 'Surface: shape the field is mapped onto' },
      { name: 'resolution', type: 'int', default: 96, min: 8, max: 256, description: 'Surface: tessellation (segments)' },

      // Shared
      { name: 'scale', type: 'float', default: 1.5, min: 0.1, max: 5.0, description: 'Size in the viewport' },
      { name: 'displacementScale', type: 'float', default: 0.4, min: 0.0, max: 2.0, description: 'Field-driven displacement / instance height' },
      { name: 'textureAmount', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'How strongly the field colors the result' },

      // Transform: position and rotation of the 3D object in the scene
      { name: 'translateX', type: 'float', default: 0.0, min: -5.0, max: 5.0, description: 'Move the object along X' },
      { name: 'translateY', type: 'float', default: 0.0, min: -5.0, max: 5.0, description: 'Move the object along Y' },
      { name: 'translateZ', type: 'float', default: 0.0, min: -5.0, max: 5.0, description: 'Move the object along Z' },
      { name: 'rotateX', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Rotate around X (degrees)' },
      { name: 'rotateY', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Rotate around Y (degrees)' },
      { name: 'rotateZ', type: 'float', default: 0.0, min: -180.0, max: 180.0, description: 'Rotate around Z (degrees)' },

      // Instanced mode
      { name: 'instanceShape', type: 'select', options: ['cube', 'sphere', 'quad'], default: 'cube', description: 'Instances: mesh drawn per field cell' },
      { name: 'instanceCount', type: 'int', default: 48, min: 4, max: 160, description: 'Instances: grid per axis (count x count cells)' },
      { name: 'instanceSize', type: 'float', default: 0.03, min: 0.002, max: 0.2, description: 'Instances: base size in world units' },
      { name: 'sizeByField', type: 'float', default: 0.6, min: 0.0, max: 1.0, description: 'Instances: how much the field scales each instance' },
      { name: 'instanceThreshold', type: 'float', default: 0.15, min: 0.0, max: 1.0, description: 'Instances: hide cells below this field value' }
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
      { name: 'threshold', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'thresholdMin', type: 'float', default: 0.3, min: 0.0, max: 1.0 },
      { name: 'thresholdMax', type: 'float', default: 0.7, min: 0.0, max: 1.0 },
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
      { name: 'speed', type: 'float', default: 0.1, min: 0.0, max: 2.0 }
    ],
    description: "Voronoi diagrams and Worley noise patterns",
    workgroupSize: [8, 8, 1]
  },

  ComputeGradient: {
    label: "Gradient",
    cat: "Generators",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture"],
    params: [
      { name: 'type', type: 'select', options: ['Linear', 'Radial', 'Angular', 'Diamond'], default: 'Linear' },
      { name: 'angle', type: 'float', default: 0.0, min: 0.0, max: 360.0 },
      { name: 'centerX', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'centerY', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'radius', type: 'float', default: 0.5, min: 0.0, max: 2.0 },
      { name: 'repeat', type: 'int', default: 1, min: 1, max: 20 },
      { name: 'reverse', type: 'boolean', default: false },
      { name: 'colorMode', type: 'select', options: ['Grayscale', 'Rainbow', 'Gradient'], default: 'Grayscale' },
      { name: 'saturation', type: 'float', default: 0.8, min: 0.0, max: 1.0 },
      { name: 'brightness', type: 'float', default: 1.0, min: 0.0, max: 2.0 },
      {
        name: 'colorStops',
        type: 'colorstops',
        default: [
          { position: 0.0, color: [0, 0, 0, 1] },
          { position: 1.0, color: [1, 1, 1, 1] }
        ]
      },
      { name: 'interpolation', type: 'select', options: ['Linear', 'Step', 'Smooth'], default: 'Linear' }
    ],
    description: "Generate linear, radial, angular, and diamond gradients with visual color picker",
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
      { name: 'speed', type: 'float', default: 0.5, min: 0.0, max: 5.0 }
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
