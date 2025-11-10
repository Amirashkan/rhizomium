// src/data/nodes/ComputeNodes.js

/**
 * Compute shader node definitions for GPU-accelerated effects
 * Each compute node generates its own WGSL compute shader and stores results in a texture
 */
export const ComputeNodes = {
  ComputeNoise: {
    label: "Compute Noise",
    cat: "Compute",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
    params: [
      { name: 'scale', type: 'float', default: 8.0, min: 0.1, max: 50.0 },
      { name: 'octaves', type: 'int', default: 5, min: 1, max: 8 },
      { name: 'speed', type: 'float', default: 0.1, min: 0.0, max: 2.0 },
      { name: 'colorize', type: 'boolean', default: true },
      { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' }
    ],
    description: "Generate procedural noise using compute shader",
    workgroupSize: [8, 8, 1]
  },

  ComputeBlur: {
    label: "Compute Blur",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 2,
    pinsIn: ["Force Field", "Velocity Field"],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'particleCount', type: 'int', default: 10000, min: 1000, max: 100000 },
      { name: 'speed', type: 'float', default: 1.0, min: 0.0, max: 5.0 },
      { name: 'size', type: 'float', default: 2.0, min: 0.5, max: 10.0 },
      { name: 'lifetime', type: 'float', default: 5.0, min: 1.0, max: 20.0 },
      { name: 'color', type: 'color', default: [1.0, 1.0, 1.0, 1.0] }
    ],
    description: "GPU particle system with physics",
    workgroupSize: [64, 1, 1]
  },

  ComputeFeedback: {
    label: "Compute Feedback",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'decay', type: 'float', default: 0.95, min: 0.0, max: 1.0 },
      { name: 'scale', type: 'float', default: 1.01, min: 0.9, max: 1.1 },
      { name: 'rotation', type: 'float', default: 0.0, min: -180.0, max: 180.0 },
      { name: 'offsetX', type: 'float', default: 0.0, min: -0.1, max: 0.1 },
      { name: 'offsetY', type: 'float', default: 0.0, min: -0.1, max: 0.1 }
    ],
    description: "Feedback loop with transformation",
    workgroupSize: [8, 8, 1]
  },

  ComputeReactionDiffusion: {
    label: "Reaction Diffusion",
    cat: "Compute",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture", "RGB"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Velocity Input"],
    pinsOut: ["Texture", "Velocity", "Pressure"],
    params: [
      { name: 'viscosity', type: 'float', default: 0.0001, min: 0.0, max: 0.01 },
      { name: 'diffusion', type: 'float', default: 0.0, min: 0.0, max: 0.1 },
      { name: 'timestep', type: 'float', default: 0.1, min: 0.01, max: 1.0 },
      { name: 'iterations', type: 'int', default: 20, min: 1, max: 50 },
      { name: 'colorMode', type: 'select', options: ['Velocity', 'Vorticity', 'Pressure'], default: 'Velocity' }
    ],
    description: "Navier-Stokes fluid dynamics",
    workgroupSize: [8, 8, 1]
  },

  ComputeConvolution: {
    label: "Compute Convolution",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'kernel', type: 'select', options: ['Sharpen', 'Edge Detect', 'Emboss', 'Custom'], default: 'Sharpen' },
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 2.0 }
    ],
    description: "Image convolution filter",
    workgroupSize: [8, 8, 1]
  },

  ComputeCellular: {
    label: "Cellular Automata",
    cat: "Compute",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'rule', type: 'select', options: ['Conway Life', 'Seeds', 'Brian\'s Brain', 'Day & Night'], default: 'Conway Life' },
      { name: 'speed', type: 'float', default: 10.0, min: 1.0, max: 60.0 },
      { name: 'density', type: 'float', default: 0.3, min: 0.0, max: 1.0 },
      { name: 'reset', type: 'boolean', default: false }
    ],
    description: "Cellular automata simulation (Game of Life, etc.)",
    workgroupSize: [8, 8, 1]
  },

  ComputeFeedbackField: {
    label: "Feedback Field",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
    params: [
      { name: 'mode', type: 'select', options: ['Flow', 'Reaction-Diffusion', 'Accumulate', 'Custom'], default: 'Flow' },
      { name: 'decay', type: 'float', default: 0.98, min: 0.0, max: 1.0 },
      { name: 'diffusion', type: 'float', default: 0.1, min: 0.0, max: 1.0 },
      { name: 'feedback', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'speed', type: 'float', default: 1.0, min: 0.0, max: 5.0 },
      { name: 'reset', type: 'boolean', default: false },
      { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' }
    ],
    description: "Persistent feedback field for simulations using FeedbackManager",
    workgroupSize: [8, 8, 1]
  },

  ComputeFieldMapper: {
    label: "3D Field Visualizer",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Field Input"],
    pinsOut: ["3D Geometry"],
    params: [
      // Field dimensions
      { name: 'width', type: 'int', default: 64, min: 8, max: 256 },
      { name: 'height', type: 'int', default: 64, min: 8, max: 256 },
      { name: 'depth', type: 'int', default: 64, min: 1, max: 256 },

      // Visualization mode
      { name: 'mappingMode', type: 'select', options: ['points', 'surface', 'volume'], default: 'points' },
      { name: 'updateFrequency', type: 'int', default: 0, min: 0, max: 60, description: 'Update every N frames (0 = every frame)' },

      // Field bounds in world space
      { name: 'boundsMinX', type: 'float', default: -1.0, min: -10.0, max: 10.0 },
      { name: 'boundsMinY', type: 'float', default: -1.0, min: -10.0, max: 10.0 },
      { name: 'boundsMinZ', type: 'float', default: -1.0, min: -10.0, max: 10.0 },
      { name: 'boundsMaxX', type: 'float', default: 1.0, min: -10.0, max: 10.0 },
      { name: 'boundsMaxY', type: 'float', default: 1.0, min: -10.0, max: 10.0 },
      { name: 'boundsMaxZ', type: 'float', default: 1.0, min: -10.0, max: 10.0 },

      // Visualization parameters
      { name: 'threshold', type: 'float', default: 0.5, min: 0.0, max: 1.0, description: 'Point generation threshold' },
      { name: 'isoThreshold', type: 'float', default: 0.5, min: 0.0, max: 1.0, description: 'Surface isosurface threshold' },
      { name: 'pointSize', type: 'float', default: 0.02, min: 0.001, max: 0.5, description: 'Point size in world units' },
      { name: 'sampleRate', type: 'int', default: 1, min: 1, max: 10, description: 'Sample every N cells' },

      // Color settings
      { name: 'colorMode', type: 'select', options: ['solid', 'gradient', 'field'], default: 'gradient' },
      { name: 'colorAR', type: 'float', default: 0.2, min: 0.0, max: 1.0, description: 'Gradient start R' },
      { name: 'colorAG', type: 'float', default: 0.4, min: 0.0, max: 1.0, description: 'Gradient start G' },
      { name: 'colorAB', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Gradient start B' },
      { name: 'colorAA', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Gradient start A' },
      { name: 'colorBR', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Gradient end R' },
      { name: 'colorBG', type: 'float', default: 0.4, min: 0.0, max: 1.0, description: 'Gradient end G' },
      { name: 'colorBB', type: 'float', default: 0.2, min: 0.0, max: 1.0, description: 'Gradient end B' },
      { name: 'colorBA', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Gradient end A' },
      { name: 'solidColorR', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Solid color R' },
      { name: 'solidColorG', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Solid color G' },
      { name: 'solidColorB', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Solid color B' },
      { name: 'solidColorA', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Solid color A' },
      { name: 'colorScaleMin', type: 'float', default: 0.0, min: 0.0, max: 1.0, description: 'Color mapping min' },
      { name: 'colorScaleMax', type: 'float', default: 1.0, min: 0.0, max: 1.0, description: 'Color mapping max' },

      // Displacement
      { name: 'displacementScale', type: 'float', default: 0.0, min: 0.0, max: 2.0, description: 'Displacement amount' },
      { name: 'displacementAxisX', type: 'float', default: 0.0, min: -1.0, max: 1.0 },
      { name: 'displacementAxisY', type: 'float', default: 1.0, min: -1.0, max: 1.0 },
      { name: 'displacementAxisZ', type: 'float', default: 0.0, min: -1.0, max: 1.0 }
    ],
    description: "Visualize compute field data as 3D points, surfaces, or volumes",
    workgroupSize: [8, 8, 1]
  },

  // === IMAGE PROCESSING ===

  ComputeThreshold: {
    label: "Threshold",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
    params: [
      { name: 'type', type: 'select', options: ['Linear', 'Radial', 'Angular', 'Diamond'], default: 'Linear' },
      { name: 'angle', type: 'float', default: 0.0, min: 0.0, max: 360.0 },
      { name: 'centerX', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'centerY', type: 'float', default: 0.5, min: 0.0, max: 1.0 },
      { name: 'radius', type: 'float', default: 0.5, min: 0.0, max: 2.0 },
      { name: 'repeat', type: 'int', default: 1, min: 1, max: 20 },
      { name: 'reverse', type: 'boolean', default: false }
    ],
    description: "Generate linear, radial, angular, and diamond gradients",
    workgroupSize: [8, 8, 1]
  },

  ComputePattern: {
    label: "Pattern",
    cat: "Compute",
    inputs: 0,
    pinsIn: [],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 2,
    pinsIn: ["Input", "Warp Field"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 2,
    pinsIn: ["Input A", "Input B"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
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
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'operation', type: 'select', options: ['Equalize', 'Normalize', 'Stretch', 'Visualize'], default: 'Equalize' },
      { name: 'channel', type: 'select', options: ['RGB', 'R', 'G', 'B', 'Luminance'], default: 'Luminance' },
      { name: 'bins', type: 'int', default: 256, min: 16, max: 256 },
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 1.0 }
    ],
    description: "Histogram-based image analysis and equalization",
    workgroupSize: [8, 8, 1]
  },

  ComputeLuminance: {
    label: "Luminance",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
    params: [
      { name: 'method', type: 'select', options: ['Rec709', 'Rec601', 'Average', 'Max', 'Min'], default: 'Rec709' },
      { name: 'outputMode', type: 'select', options: ['Grayscale', 'Preserve Color', 'Isoluminant'], default: 'Grayscale' },
      { name: 'threshold', type: 'float', default: 0.5, min: 0.0, max: 1.0 }
    ],
    description: "Luminance extraction and operations",
    workgroupSize: [8, 8, 1]
  }
};
