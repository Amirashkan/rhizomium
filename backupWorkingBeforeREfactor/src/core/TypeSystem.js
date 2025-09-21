// src/core/TypeSystem.js - Complete WGSL type system
export const WGSLTypes = {
  F32: "f32",
  VEC2: "vec2<f32>",
  VEC3: "vec3<f32>",
  VEC4: "vec4<f32>",
  BOOL: "bool",
  INT: "i32",
};

export class TypeConverter {
  static toF32(expr, inputType) {
    switch (inputType) {
      case WGSLTypes.F32:
        return expr;
      case WGSLTypes.VEC2:
        return `((${expr}).x + (${expr}).y) * 0.5`;
      case WGSLTypes.VEC3:
        return `((${expr}).x + (${expr}).y + (${expr}).z) / 3.0`;
      case WGSLTypes.VEC4:
        return `(${expr}).w`; // Extract alpha
      default:
        return `f32(${expr})`;
    }
  }

  static toVec2(expr, inputType) {
    switch (inputType) {
      case WGSLTypes.VEC2:
        return expr;
      case WGSLTypes.VEC3:
        return `vec2<f32>((${expr}).x, (${expr}).y)`;
      case WGSLTypes.VEC4:
        return `vec2<f32>((${expr}).x, (${expr}).y)`;
      case WGSLTypes.F32:
        return `vec2<f32>(${expr})`;
      default:
        return `vec2<f32>(0.0)`;
    }
  }

  static toVec3(expr, inputType) {
    switch (inputType) {
      case WGSLTypes.VEC3:
        return expr;
      case WGSLTypes.VEC2:
        return `vec3<f32>((${expr}).x, (${expr}).y, 0.0)`;
      case WGSLTypes.VEC4:
        return `vec3<f32>((${expr}).x, (${expr}).y, (${expr}).z)`;
      case WGSLTypes.F32:
        return `vec3<f32>(${expr})`;
      default:
        return `vec3<f32>(${expr})`;
    }
  }

  static toVec4(expr, inputType) {
    switch (inputType) {
      case WGSLTypes.VEC4:
        return expr;
      case WGSLTypes.VEC3:
        return `vec4<f32>(${expr}, 1.0)`;
      case WGSLTypes.VEC2:
        return `vec4<f32>((${expr}).x, (${expr}).y, 0.0, 1.0)`;
      case WGSLTypes.F32:
        return `vec4<f32>(${expr})`;
      default:
        return `vec4<f32>(${expr}, 1.0)`;
    }
  }

  static convert(expr, fromType, toType) {
    if (fromType === toType) return expr;

    switch (toType) {
      case WGSLTypes.F32:
        return this.toF32(expr, fromType);
      case WGSLTypes.VEC2:
        return this.toVec2(expr, fromType);
      case WGSLTypes.VEC3:
        return this.toVec3(expr, fromType);
      case WGSLTypes.VEC4:
        return this.toVec4(expr, fromType);
      default:
        return expr;
    }
  }

  static inferType(value) {
    if (typeof value === "number") return WGSLTypes.F32;
    if (Array.isArray(value)) {
      switch (value.length) {
        case 2:
          return WGSLTypes.VEC2;
        case 3:
          return WGSLTypes.VEC3;
        case 4:
          return WGSLTypes.VEC4;
        default:
          return WGSLTypes.F32;
      }
    }
    return WGSLTypes.F32;
  }
}

export class NodeTypes {
  static getOutputType(nodeKind) {
    const typeMap = {
      // Input nodes
      ConstFloat: WGSLTypes.F32,
      ConstVec2: WGSLTypes.VEC2,
      ConstVec3: WGSLTypes.VEC3,
      UV: WGSLTypes.VEC2,
      Time: WGSLTypes.F32,

      // Math nodes - scalar
      Sin: WGSLTypes.F32,
      Cos: WGSLTypes.F32,
      Tan: WGSLTypes.F32,
      Floor: WGSLTypes.F32,
      Fract: WGSLTypes.F32,
      Abs: WGSLTypes.F32,
      Sqrt: WGSLTypes.F32,
      Pow: WGSLTypes.F32,
      Min: WGSLTypes.F32,
      Max: WGSLTypes.F32,
      Clamp: WGSLTypes.F32,
      Smoothstep: WGSLTypes.F32,
      Step: WGSLTypes.F32,
      Sign: WGSLTypes.F32,
      Mod: WGSLTypes.F32,
      Expr: WGSLTypes.F32,

      // Math nodes - vector
      Add: WGSLTypes.VEC3,
      Subtract: WGSLTypes.VEC3,
      Multiply: WGSLTypes.VEC3,
      Divide: WGSLTypes.VEC3,
      Mix: WGSLTypes.VEC3,
      Saturate: WGSLTypes.VEC3,

      // Vector operations
      Dot: WGSLTypes.F32,
      Cross: WGSLTypes.VEC3,
      Normalize: WGSLTypes.VEC3,
      Length: WGSLTypes.F32,
      Distance: WGSLTypes.F32,
      Reflect: WGSLTypes.VEC3,
      Refract: WGSLTypes.VEC3,

      // Field nodes
      CircleField: WGSLTypes.F32,

      // Texture nodes
      Texture2D: WGSLTypes.VEC4,
      TextureCube: WGSLTypes.VEC4,

      // Noise nodes
      Random: WGSLTypes.VEC3,
      ValueNoise: WGSLTypes.VEC3,
      FBMNoise: WGSLTypes.VEC3,
      SimplexNoise: WGSLTypes.VEC3,
      VoronoiNoise: WGSLTypes.VEC3,
      RidgedNoise: WGSLTypes.VEC3,
      WarpNoise: WGSLTypes.VEC3,

      // Utility nodes
      Combine3: WGSLTypes.VEC3,
      Split3: WGSLTypes.VEC3, // Note: Split3 has multiple outputs

      // Output
      OutputFinal: WGSLTypes.VEC3,
    };

    return typeMap[nodeKind] || WGSLTypes.F32;
  }
}

export function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}
