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
      { name: 'timestep', type: 'float', default: 2.0, min: 0.1, max: 10.0, step: 0.1 },
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
  }
};
