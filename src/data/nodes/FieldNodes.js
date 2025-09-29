// src/data/nodes/FieldNodes.js

import { NodeCategories, DataTypes, createParam, createPin } from './NodeTypes.js';

/**
 * Field generation node definitions for procedural patterns
 */
export const FieldNodes = {
  LinearGradient: {
    label: "Linear Gradient",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("angle", "float", { label: "Angle", default: 0.0 }),
      createParam("offset", "float", { label: "Offset", default: 0.0 }),
      createParam("scale", "float", { label: "Scale", default: 1.0 }),
      createParam("repeat", "bool", { label: "Repeat", default: false }),
    ],
  },

  RadialGradient: {
    label: "Radial Gradient",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("centerX", "float", { label: "Center X", default: 0.5 }),
      createParam("centerY", "float", { label: "Center Y", default: 0.5 }),
      createParam("radius", "float", { label: "Radius", default: 0.5 }),
      createParam("falloff", "float", { label: "Falloff", default: 1.0 }),
      createParam("invert", "bool", { label: "Invert", default: false }),
    ],
  },

  AngularGradient: {
    label: "Angular Gradient",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("centerX", "float", { label: "Center X", default: 0.5 }),
      createParam("centerY", "float", { label: "Center Y", default: 0.5 }),
      createParam("rotation", "float", { label: "Rotation", default: 0.0 }),
      createParam("repeat", "float", { label: "Repeat", default: 1.0 }),
    ],
  },

  ConicGradient: {
    label: "Conic Gradient",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("centerX", "float", { label: "Center X", default: 0.5 }),
      createParam("centerY", "float", { label: "Center Y", default: 0.5 }),
      createParam("startAngle", "float", { label: "Start Angle", default: 0.0 }),
      createParam("endAngle", "float", { label: "End Angle", default: 6.28318 }), // 2π
      createParam("smoothness", "float", { label: "Smoothness", default: 0.0 }),
    ],
  },

  Checker: {
    label: "Checker",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("scaleX", "float", { label: "Scale X", default: 8.0 }),
      createParam("scaleY", "float", { label: "Scale Y", default: 8.0 }),
      createParam("smoothness", "float", { label: "Smoothness", default: 0.0 }),
    ],
  },

  Stripe: {
    label: "Stripe",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("frequency", "float", { label: "Frequency", default: 5.0 }),
      createParam("angle", "float", { label: "Angle", default: 0.0 }),
      createParam("thickness", "float", { label: "Thickness", default: 0.5 }),
      createParam("smoothness", "float", { label: "Smoothness", default: 0.0 }),
    ],
  },

  Circle: {
    label: "Circle",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("centerX", "float", { label: "Center X", default: 0.5 }),
      createParam("centerY", "float", { label: "Center Y", default: 0.5 }),
      createParam("radius", "float", { label: "Radius", default: 0.25 }),
      createParam("smoothness", "float", { label: "Smoothness", default: 0.01 }),
      createParam("invert", "bool", { label: "Invert", default: false }),
    ],
  },

  Rectangle: {
    label: "Rectangle",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("centerX", "float", { label: "Center X", default: 0.5 }),
      createParam("centerY", "float", { label: "Center Y", default: 0.5 }),
      createParam("width", "float", { label: "Width", default: 0.5 }),
      createParam("height", "float", { label: "Height", default: 0.5 }),
      createParam("roundness", "float", { label: "Roundness", default: 0.0 }),
      createParam("smoothness", "float", { label: "Smoothness", default: 0.01 }),
      createParam("invert", "bool", { label: "Invert", default: false }),
    ],
  },

  Polygon: {
    label: "Polygon",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: DataTypes.F32 }],
    params: [
      createParam("centerX", "float", { label: "Center X", default: 0.5 }),
      createParam("centerY", "float", { label: "Center Y", default: 0.5 }),
      createParam("sides", "int", { label: "Sides", default: 6 }),
      createParam("radius", "float", { label: "Radius", default: 0.25 }),
      createParam("rotation", "float", { label: "Rotation", default: 0.0 }),
      createParam("smoothness", "float", { label: "Smoothness", default: 0.01 }),
      createParam("invert", "bool", { label: "Invert", default: false }),
    ],
  },

  Worley: {
    label: "Worley Noise",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "F1", type: DataTypes.F32 },
      { label: "F2", type: DataTypes.F32 },
      { label: "Combined", type: DataTypes.F32 },
    ],
    params: [
      createParam("scale", "float", { label: "Scale", default: 8.0 }),
      createParam("jitter", "float", { label: "Jitter", default: 1.0 }),
      createParam("distanceMetric", "select", { 
        label: "Distance Metric", 
        default: "euclidean",
        options: ["euclidean", "manhattan", "chebyshev", "minkowski"]
      }),
      createParam("minkowskiP", "float", { label: "Minkowski P", default: 2.0 }),
    ],
  },

  CellNoise: {
    label: "Cell Noise",
    cat: NodeCategories.FIELD,
    inputs: 1,
    pinsIn: ["UV"],
    pinsOut: [
      { label: "out", type: DataTypes.F32 },
      { label: "cellID", type: DataTypes.VEC2 },
    ],
    params: [
      createParam("scale", "float", { label: "Scale", default: 8.0 }),
      createParam("randomness", "float", { label: "Randomness", default: 1.0 }),
      createParam("smooth", "bool", { label: "Smooth", default: false }),
    ],
  },
};