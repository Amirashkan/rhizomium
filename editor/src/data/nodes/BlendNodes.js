// src/data/nodes/BlendNodes.js
// NEW FILE - Blend operations for combining distance fields

export const BlendNodes = {
  SDFUnion: {
    label: 'Union (Min)',
    cat: 'Blend',
    inputs: 2,
    pinsIn: [
      { label: 'A', type: 'float' },
      { label: 'B', type: 'float' }
    ],
    pinsOut: [
      { label: 'Result', type: 'float' }
    ],
    params: []
  },

  SDFIntersection: {
    label: 'Intersection (Max)',
    cat: 'Blend',
    inputs: 2,
    pinsIn: [
      { label: 'A', type: 'float' },
      { label: 'B', type: 'float' }
    ],
    pinsOut: [
      { label: 'Result', type: 'float' }
    ],
    params: []
  },

  SDFSmoothUnion: {
    label: 'Smooth Union',
    cat: 'Blend',
    inputs: 2,
    pinsIn: [
      { label: 'A', type: 'float' },
      { label: 'B', type: 'float' }
    ],
    pinsOut: [
      { label: 'Result', type: 'float' }
    ],
    params: [
      { name: 'smoothness', label: 'Smoothness', type: 'slider', default: 0.1, min: 0.0, max: 1.0 }
    ]
  },

  SDFSmoothIntersection: {
    label: 'Smooth Intersection',
    cat: 'Blend',
    inputs: 2,
    pinsIn: [
      { label: 'A', type: 'float' },
      { label: 'B', type: 'float' }
    ],
    pinsOut: [
      { label: 'Result', type: 'float' }
    ],
    params: [
      { name: 'smoothness', label: 'Smoothness', type: 'slider', default: 0.1, min: 0.0, max: 1.0 }
    ]
  },

  SDFSmoothSubtraction: {
    label: 'Smooth Subtraction',
    cat: 'Blend',
    inputs: 2,
    pinsIn: [
      { label: 'A', type: 'float' },
      { label: 'B', type: 'float' }
    ],
    pinsOut: [
      { label: 'Result', type: 'float' }
    ],
    params: [
      { name: 'smoothness', label: 'Smoothness', type: 'slider', default: 0.1, min: 0.0, max: 1.0 }
    ]
  }
};