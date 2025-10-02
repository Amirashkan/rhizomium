// src/core/PreviewComputer.js
export class PreviewComputer {
  constructor() {
    this.previewSize = 32;
    this.animationTime = 0;
    this.lastFrameTime = 0;
  }

  computePreviews(graph) {
    try {
      this.animationTime = performance.now() / 1000;

      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      const ordered = this._topologicalSort(graph.nodes, byId);
      const values = new Map();

      for (const node of ordered) {
        let result = null;

        try {
          switch (node.kind) {
            case "LinearGradient": {
  const angle = node.params?.angle ?? 0.0;
  const offset = node.params?.offset ?? 0.0;
  const scale = node.params?.scale ?? 1.0;
  const repeat = node.params?.repeat ?? false;
  
  // Simple UV evaluation at center
  const uv = [0.5, 0.5];
  const dir = [Math.cos(angle), Math.sin(angle)];
  const proj = (uv[0] - 0.5) * dir[0] + (uv[1] - 0.5) * dir[1];
  const t = proj * scale + offset;
  result = repeat ? (t - Math.floor(t)) : t;
  break;
}

case "RadialGradient": {
  const centerX = node.params?.centerX ?? 0.5;
  const centerY = node.params?.centerY ?? 0.5;
  const radius = node.params?.radius ?? 0.5;
  const falloff = node.params?.falloff ?? 1.0;
  const invert = node.params?.invert ?? false;
  
  const uv = [0.5, 0.5];
  const dx = uv[0] - centerX;
  const dy = uv[1] - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy) / radius;
  const field = Math.pow(dist, falloff);
  result = invert ? (1.0 - field) : field;
  result = Math.max(0, Math.min(1, result));
  break;
}

case "AngularGradient": {
  const centerX = node.params?.centerX ?? 0.5;
  const centerY = node.params?.centerY ?? 0.5;
  const rotation = node.params?.rotation ?? 0.0;
  const repeat = node.params?.repeat ?? 1.0;
  
  const uv = [0.5, 0.5];
  const dx = uv[0] - centerX;
  const dy = uv[1] - centerY;
  const angle = Math.atan2(dy, dx) + rotation;
  const t = (angle / (Math.PI * 2)) * repeat;
  result = t - Math.floor(t);
  break;
}
case "ColorRamp": {
  const t = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0.5;
  const stops = node.params?.stops || [
    { position: 0.0, color: [0, 0, 0, 1] },
    { position: 1.0, color: [1, 1, 1, 1] }
  ];
  const mode = node.params?.mode || "Linear";
  
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  const clampedT = Math.max(0, Math.min(1, t));
  
  // Find which segment we're in
  let resultColor = sortedStops[0].color;
  
  for (let i = 0; i < sortedStops.length - 1; i++) {
    const s1 = sortedStops[i];
    const s2 = sortedStops[i + 1];
    
    if (clampedT >= s1.position && clampedT <= s2.position) {
      const segmentT = (clampedT - s1.position) / (s2.position - s1.position);
      const c1 = s1.color;
      const c2 = s2.color;
      
      if (mode === "Step") {
        resultColor = clampedT >= (s1.position + s2.position) / 2 ? c2 : c1;
      } else if (mode === "Smooth") {
        const smoothT = segmentT * segmentT * (3 - 2 * segmentT);
        resultColor = [
          c1[0] * (1 - smoothT) + c2[0] * smoothT,
          c1[1] * (1 - smoothT) + c2[1] * smoothT,
          c1[2] * (1 - smoothT) + c2[2] * smoothT,
          1
        ];
      } else { // Linear
        resultColor = [
          c1[0] * (1 - segmentT) + c2[0] * segmentT,
          c1[1] * (1 - segmentT) + c2[1] * segmentT,
          c1[2] * (1 - segmentT) + c2[2] * segmentT,
          1
        ];
      }
      break;
    }
  }
  
  if (clampedT > sortedStops[sortedStops.length - 1].position) {
    resultColor = sortedStops[sortedStops.length - 1].color;
  }
  
  result = [resultColor[0], resultColor[1], resultColor[2]];
  break;
}
case "ConicGradient": {
  const centerX = node.params?.centerX ?? 0.5;
  const centerY = node.params?.centerY ?? 0.5;
  const startAngle = node.params?.startAngle ?? 0.0;
  const endAngle = node.params?.endAngle ?? 6.28318;
  
  const uv = [0.5, 0.5];
  const dx = uv[0] - centerX;
  const dy = uv[1] - centerY;
  const angle = Math.atan2(dy, dx);
  const t = (angle - startAngle) / (endAngle - startAngle);
  result = Math.max(0, Math.min(1, t));
  break;
}
            // Input Nodes
            case "UV":
              result = [0.5, 0.5];
              break;

            case "Time":
              result = this.animationTime;
              break;

            case "ConstFloat":
              result = typeof node.value === "number" ? node.value : (node.params?.value ?? 0);
              break;

            case "ConstVec2":
              result = [node.params?.x ?? 0, node.params?.y ?? 0];
              break;

            case "ConstVec3":
              result = [node.params?.x ?? 0, node.params?.y ?? 0, node.params?.z ?? 0];
              break;

            case "ConstVec4":
              result = [node.params?.x ?? 0, node.params?.y ?? 0, node.params?.z ?? 0, node.params?.w ?? 1];
              break;

            case "Mouse":
              result = [0.5, 0.5]; // Default mouse position
              break;

            case "Resolution":
              result = [1920, 1080]; // Default resolution
              break;

            case "Pi":
              result = Math.PI;
              break;

            // Math Nodes - Arithmetic
            case "Add": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              result = a + b;
              break;
            }

            case "Subtract": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              result = a - b;
              break;
            }

            case "Multiply": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 1;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              result = a * b;
              break;
            }

            case "Divide": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 1;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              result = b !== 0 ? a / b : 0;
              break;
            }

            case "Power": {
              const base = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 1;
              const exp = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 2;
              result = Math.pow(base, exp);
              break;
            }

            // Math Nodes - Trigonometry
            case "Sin": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.sin(x);
              break;
            }

            case "Cos": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.cos(x);
              break;
            }

            case "Tan": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.tan(x);
              break;
            }

            case "Asin": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.asin(Math.max(-1, Math.min(1, x)));
              break;
            }

            case "Acos": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.acos(Math.max(-1, Math.min(1, x)));
              break;
            }

            case "Atan": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.atan(x);
              break;
            }

            case "Atan2": {
              const y = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const x = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              result = Math.atan2(y, x);
              break;
            }

            // Math Nodes - Functions
            case "Floor": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.floor(x);
              break;
            }

            case "Ceil": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.ceil(x);
              break;
            }

            case "Round": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.round(x);
              break;
            }

            case "Fract": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = x - Math.floor(x);
              break;
            }

            case "Abs": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.abs(x);
              break;
            }

            case "Sqrt": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.sqrt(Math.max(0, x));
              break;
            }

            case "Sign": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.sign(x);
              break;
            }

            case "Mod": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const y = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              result = y !== 0 ? x % y : 0;
              break;
            }

            case "Exp": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.exp(x);
              break;
            }

            case "Exp2": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.pow(2, x);
              break;
            }

            case "Log": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 1;
              result = x > 0 ? Math.log(x) : 0;
              break;
            }

            case "Log2": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 1;
              result = x > 0 ? Math.log2(x) : 0;
              break;
            }

            // Math Nodes - Range/Comparison
            case "Min": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              result = Math.min(a, b);
              break;
            }

            case "Max": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              result = Math.max(a, b);
              break;
            }

            case "Clamp": {
              const value = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const min = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              const max = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 1;
              result = Math.max(min, Math.min(max, value));
              break;
            }

            // Math Nodes - Interpolation
            case "Smoothstep": {
              const edge0 = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const edge1 = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              const x = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 0.5;
              const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
              result = t * t * (3 - 2 * t);
              break;
            }

            case "Step": {
              const edge = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0.5;
              const x = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              result = x < edge ? 0 : 1;
              break;
            }

            case "Mix":
            case "Lerp": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              const t = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 0.5;
              result = a * (1 - t) + b * t;
              break;
            }

            case "InverseLerp": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              const value = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 0.5;
              result = b !== a ? (value - a) / (b - a) : 0;
              break;
            }

            case "Saturate": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = Math.max(0, Math.min(1, x));
              break;
            }

            // Math Nodes - Utilities
            case "OneMinus": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = 1.0 - x;
              break;
            }

            case "Negate": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              result = -x;
              break;
            }

            case "Reciprocal": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 1;
              result = x !== 0 ? 1.0 / x : 0;
              break;
            }

            // Vector Nodes
            case "Dot": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 1, 0];
              result = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
              break;
            }

            case "Cross": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 1, 0];
              result = [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
              ];
              break;
            }

            case "Normalize": {
              const vec = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, 0, 0];
              const length = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
              result = length > 1e-6 ? [vec[0] / length, vec[1] / length, vec[2] / length] : [0, 0, 0];
              break;
            }

            case "Length": {
              const vec = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [0, 0, 0];
              result = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
              break;
            }

            case "Distance": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [0, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 0, 0];
              const diff = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
              result = Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]);
              break;
            }

            case "Reflect": {
              const incident = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, -1, 0];
              const normal = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 1, 0];
              const nLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
              const n = nLength > 1e-6 ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength] : [0, 1, 0];
              const dotNI = n[0] * incident[0] + n[1] * incident[1] + n[2] * incident[2];
              result = [
                incident[0] - 2 * dotNI * n[0],
                incident[1] - 2 * dotNI * n[1],
                incident[2] - 2 * dotNI * n[2],
              ];
              break;
            }

            case "Refract": {
              const incident = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, -1, 0];
              const normal = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 1, 0];
              const eta = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 1.5;
              const nLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
              const n = nLength > 1e-6 ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength] : [0, 1, 0];
              const iLength = Math.sqrt(incident[0] * incident[0] + incident[1] * incident[1] + incident[2] * incident[2]);
              const i = iLength > 1e-6 ? [incident[0] / iLength, incident[1] / iLength, incident[2] / iLength] : [0, 0, 0];
              const dotNI = n[0] * i[0] + n[1] * i[1] + n[2] * i[2];
              const k = 1.0 - eta * eta * (1.0 - dotNI * dotNI);
              if (k < 0.0) {
                result = [0, 0, 0];
              } else {
                const sqrtK = Math.sqrt(k);
                result = [
                  eta * i[0] - (eta * dotNI + sqrtK) * n[0],
                  eta * i[1] - (eta * dotNI + sqrtK) * n[1],
                  eta * i[2] - (eta * dotNI + sqrtK) * n[2],
                ];
              }
              break;
            }

            case "Split2": {
              const v = node.inputs?.[0] ? this._toVec2(values.get(node.inputs[0])) : [0, 0];
              result = { type: "split", values: v };
              break;
            }

            case "Split3": {
              const v = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [0, 0, 0];
              result = { type: "split", values: v };
              break;
            }

            case "Split4": {
              const v = node.inputs?.[0] ? this._toVec4(values.get(node.inputs[0])) : [0, 0, 0, 1];
              result = { type: "split", values: v };
              break;
            }

            case "Combine2": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const y = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              result = [x, y];
              break;
            }

            case "Combine3": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const y = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              const z = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 0;
              result = [x, y, z];
              break;
            }

            case "Combine4": {
              const x = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const y = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              const z = node.inputs?.[2] ? this._toF32(values.get(node.inputs[2])) : 0;
              const w = node.inputs?.[3] ? this._toF32(values.get(node.inputs[3])) : 1;
              result = [x, y, z, w];
              break;
            }

            case "VectorAdd": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [0, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 0, 0];
              result = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
              break;
            }

            case "VectorSubtract": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [0, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [0, 0, 0];
              result = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
              break;
            }

            case "VectorMultiply": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, 1, 1];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [1, 1, 1];
              result = [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
              break;
            }

            case "VectorDivide": {
              const a = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, 1, 1];
              const b = node.inputs?.[1] ? this._toVec3(values.get(node.inputs[1])) : [1, 1, 1];
              result = [
                b[0] !== 0 ? a[0] / b[0] : 0,
                b[1] !== 0 ? a[1] / b[1] : 0,
                b[2] !== 0 ? a[2] / b[2] : 0,
              ];
              break;
            }

            case "VectorScale": {
              const vec = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [1, 1, 1];
              const scale = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 1;
              result = [vec[0] * scale, vec[1] * scale, vec[2] * scale];
              break;
            }

            case "Swizzle": {
              const vec = node.inputs?.[0] ? this._toVec3(values.get(node.inputs[0])) : [0, 0, 0];
              const pattern = node.params?.pattern || "xyz";
              const swizzled = [];
              for (const char of pattern) {
                switch (char) {
                  case 'x': swizzled.push(vec[0]); break;
                  case 'y': swizzled.push(vec[1]); break;
                  case 'z': swizzled.push(vec[2]); break;
                  default: swizzled.push(0);
                }
              }
              result = swizzled.slice(0, 3);
              break;
            }

            // Utility Nodes
            case "Expr": {
              const a = node.inputs?.[0] ? this._toF32(values.get(node.inputs[0])) : 0;
              const b = node.inputs?.[1] ? this._toF32(values.get(node.inputs[1])) : 0;
              const expr = (node.expr || "a").toString();

              try {
                if (this._isExpressionDangerous(expr)) {
                  throw new Error("Expression contains forbidden patterns");
                }

                const scope = {
                  a, b,
                  u_time: this.animationTime,
                  sin: Math.sin,
                  cos: Math.cos,
                  tan: Math.tan,
                  floor: Math.floor,
                  ceil: Math.ceil,
                  abs: Math.abs,
                  PI: Math.PI,
                  sqrt: Math.sqrt,
                  pow: Math.pow,
                  min: Math.min,
                  max: Math.max,
                };
                const func = new Function(...Object.keys(scope), `return (${expr});`);
                result = Number(func(...Object.values(scope)));
                if (!Number.isFinite(result)) result = 0;
              } catch (error) {
                window.errorHandler?.handleError(error, {
                  component: 'expression-evaluation',
                  nodeId: node.id,
                  expression: expr,
                });
                result = 0;
              }
              break;
            }

            // Field Nodes
            case "Circle": {
              const radius = node.params?.radius ?? 0.25;
              const epsilon = Math.max(0.0001, node.params?.epsilon ?? 0.02);
              result = { type: "circle", radius, epsilon };
              break;
            }

            // Output
            case "OutputFinal": {
              const c = node.inputs?.[0] ? values.get(node.inputs[0]) : [0, 0, 0];
              result = this._toVec3(c);
              break;
            }

            default:
              result = 0;
          }
        } catch (error) {
          window.errorHandler?.handleError(error, {
            component: 'node-computation',
            nodeType: node.kind,
            nodeId: node.id
          });
          result = 0;
        }

        values.set(node.id, result);
        node.__preview = result;
      }

      this._generateEnhancedThumbnails(graph.nodes, values);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-computation',
      });
    }
  }

  _isExpressionDangerous(expr) {
    const forbidden = [
      'import', 'require', 'eval', 'Function', 'constructor',
      'window', 'document', 'global', 'process', '__proto__',
      'prototype', 'valueOf', 'toString', 'hasOwnProperty'
    ];
    const lowerExpr = expr.toLowerCase();
    return forbidden.some(keyword => lowerExpr.includes(keyword));
  }

// In PreviewComputer.js, replace the _generateEnhancedThumbnails method:

_generateEnhancedThumbnails(nodes, values) {
  try {
    // Use topological sort to ensure dependencies are processed first
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ordered = this._topologicalSort(nodes, byId);
    
    // Process nodes in dependency order
    for (const node of ordered) {
      node.__thumb = this._createNodeThumbnail(node, values);
    }
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'thumbnail-generation'
    });
  }
}
// In PreviewComputer.js, update _createNodeThumbnail to pass the node to _renderOutputThumbnail:

_createNodeThumbnail(node, values) {
  try {
    const size = this.previewSize;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get 2D canvas context");
    }

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, size, size);

    switch (node.kind) {
      // ... other cases ...
      
      case "OutputFinal":
        this._renderOutputThumbnail(ctx, size, node.__preview, node); // Pass node here
        break;
        
      // ... rest of cases ...
    }

    return canvas;
  } catch (error) {
    // ... error handling ...
  }
}

// Then update _renderOutputThumbnail to accept and use the node parameter:

_renderOutputThumbnail(ctx, size, color, node) {
  console.log('=== OUTPUT THUMBNAIL DEBUG ===');
  console.log('Node:', node);
  console.log('Node inputs:', node?.inputs);
  console.log('Input[0]:', node?.inputs?.[0]);
  
  // If we have a connected input node, try to copy its thumbnail
  if (node && node.inputs && node.inputs[0]) {
    const inputNodeId = node.inputs[0];
    console.log('Looking for input node ID:', inputNodeId);
    
    // Find the input node
    if (window.editor && window.editor.graph && window.editor.graph.nodes) {
      const inputNode = window.editor.graph.nodes.find(n => n.id === inputNodeId);
      console.log('Found input node:', inputNode);
      console.log('Input node __thumb:', inputNode?.__thumb);
      console.log('__thumb type:', inputNode?.__thumb?.constructor?.name);
      
      if (inputNode && inputNode.__thumb) {
        try {
          if (inputNode.__thumb instanceof HTMLCanvasElement) {
            console.log('Drawing from canvas');
            ctx.drawImage(inputNode.__thumb, 0, 0, size, size);
          } else if (inputNode.__thumb instanceof ImageData) {
            console.log('Drawing from ImageData');
            ctx.putImageData(inputNode.__thumb, 0, 0);
          } else {
            console.log('Unknown thumb type, trying drawImage anyway');
            ctx.drawImage(inputNode.__thumb, 0, 0, size, size);
          }
          
          // Add green border
          ctx.strokeStyle = "rgba(76, 175, 80, 0.6)";
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, size - 2, size - 2);
          console.log('Successfully copied input thumbnail');
          return;
        } catch (err) {
          console.error('Failed to copy input thumbnail:', err);
        }
      } else {
        console.log('Input node or __thumb not found');
      }
    } else {
      console.log('Editor/graph/nodes not available');
    }
  } else {
    console.log('No node or inputs');
  }
  
  // Fallback
  console.log('Using fallback color rendering');
  this._renderColorThumbnail(ctx, size, color);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, size - 4, size - 4);
}

// Thumbnail rendering methods (continued)
  _renderUVThumbnail(ctx, size) {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "#ff0080");
    gradient.addColorStop(1, "#0080ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    const step = size / 4;
    for (let i = 0; i <= 4; i++) {
      const pos = i * step;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, size);
      ctx.moveTo(0, pos);
      ctx.lineTo(size, pos);
      ctx.stroke();
    }
  }

  _renderTimeThumbnail(ctx, size, time) {
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.3;

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#666";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    const angle = (time % 2) * Math.PI;
    const handLength = radius * 0.8;
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.sin(angle) * handLength,
      centerY - Math.cos(angle) * handLength
    );
    ctx.stroke();
  }

  _renderFloatThumbnail(ctx, size, value) {
    const normalizedValue = Math.max(0, Math.min(1, Math.abs(value)));
    const hue = value >= 0 ? 120 : 0;

    ctx.fillStyle = `hsl(${hue}, 70%, ${30 + normalizedValue * 40}%)`;
    ctx.fillRect(0, 0, size, size);

    const barHeight = size * normalizedValue;
    ctx.fillStyle = `hsl(${hue}, 90%, 60%)`;
    ctx.fillRect(size * 0.1, size - barHeight, size * 0.8, barHeight);

    ctx.fillStyle = "#fff";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(value.toFixed(2), size / 2, size / 2 + 3);
  }

  _renderVec2Thumbnail(ctx, size, vec) {
    const [x, y] = this._toVec2(vec);

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, `hsl(${x * 180}, 60%, 30%)`);
    gradient.addColorStop(1, `hsl(${y * 180 + 180}, 60%, 30%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const centerX = size / 2;
    const centerY = size / 2;
    const scale = size * 0.3;
    const endX = centerX + x * scale;
    const endY = centerY - y * scale;

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    const angle = Math.atan2(endY - centerY, endX - centerX);
    const headLength = 6;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle - 0.5),
      endY - headLength * Math.sin(angle - 0.5)
    );
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle + 0.5),
      endY - headLength * Math.sin(angle + 0.5)
    );
    ctx.stroke();
  }

  _renderColorThumbnail(ctx, size, color) {
    const [r, g, b] = this._toVec3(color);
    const clampedR = Math.max(0, Math.min(1, r)) * 255;
    const clampedG = Math.max(0, Math.min(1, g)) * 255;
    const clampedB = Math.max(0, Math.min(1, b)) * 255;

    ctx.fillStyle = `rgb(${clampedR}, ${clampedG}, ${clampedB})`;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    for (let i = 0; i < size; i += 4) {
      for (let j = 0; j < size; j += 4) {
        if ((i + j) % 8 === 0) {
          ctx.fillRect(i, j, 2, 2);
        }
      }
    }
  }

  _renderCircleThumbnail(ctx, size, circleData) {
    if (!circleData || typeof circleData !== "object") {
      this._renderDefaultThumbnail(ctx, size, circleData);
      return;
    }

    const { radius = 0.25, epsilon = 0.02 } = circleData;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);

    const imageData = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const dist = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5));
        const safeEpsilon = Math.max(epsilon, 0.0001);
        const field = 1.0 - this._smoothstep(radius - safeEpsilon, radius + safeEpsilon, dist);

        const intensity = Math.max(0, Math.min(1, field)) * 255;
        const idx = (y * size + x) * 4;
        imageData.data[idx + 0] = intensity;
        imageData.data[idx + 1] = intensity;
        imageData.data[idx + 2] = intensity;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  _renderWaveThumbnail(ctx, size, waveType) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const amplitude = size * 0.3;
    const frequency = 2;
    const centerY = size / 2;

    for (let x = 0; x < size; x++) {
      const t = (x / size) * frequency * Math.PI * 2;
      const y = waveType === "Sin"
        ? centerY - Math.sin(t) * amplitude
        : centerY - Math.cos(t) * amplitude;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _renderExpressionThumbnail(ctx, size, expr) {
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#fff";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";

    const shortExpr = expr.length > 6 ? expr.substring(0, 6) + "..." : expr;
    ctx.fillText(shortExpr, size / 2, size / 2 + 2);
  }

  _renderMathThumbnail(ctx, size, kind) {
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, size, size);

    const symbols = {
      'Multiply': '×',
      'Add': '+',
      'Subtract': '−',
      'Divide': '÷'
    };

    ctx.fillStyle = "#ffaa00";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.fillText(symbols[kind] || kind.substring(0, 3), size / 2, size / 2 + 5);
  }

  _renderMixThumbnail(ctx, size) {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, "#ff0000");
    gradient.addColorStop(1, "#0000ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("MIX", size / 2, size / 2 + 3);
  }

  _renderSplitThumbnail(ctx, size, splitData) {
    if (splitData && splitData.type === "split") {
      const values = splitData.values;
      const third = size / values.length;

      values.forEach((val, i) => {
        const brightness = Math.max(0, Math.min(255, val * 255));
        ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
        ctx.fillRect(i * third, 0, third, size);
      });
    } else {
      this._renderDefaultThumbnail(ctx, size, splitData);
    }
  }

  _renderCombineThumbnail(ctx, size) {
    const third = size / 3;

    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, third, size);

    ctx.fillStyle = "#00ff00";
    ctx.fillRect(third, 0, third, size);

    ctx.fillStyle = "#0000ff";
    ctx.fillRect(third * 2, 0, third, size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText("→", size / 2, size / 2 + 3);
  }

  _renderSaturateThumbnail(ctx, size) {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(0.5, "#888");
    gradient.addColorStop(1, "#fff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#ff0";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.fillText("SAT", size / 2, size / 2 + 2);
  }

_renderOutputThumbnail(ctx, size, color) {
  // Check if we have a connected input node with a thumbnail
  const node = Array.from(window.editor?.graph?.nodes || []).find(n => n.kind === 'OutputFinal');
  if (node && node.inputs && node.inputs[0]) {
    const inputNodeId = node.inputs[0];
    const inputNode = window.editor?.graph?.nodes?.find(n => n.id === inputNodeId);
    
    // If the input node has a thumbnail, copy it
    if (inputNode && inputNode.__thumb) {
      if (inputNode.__thumb instanceof HTMLCanvasElement) {
        ctx.drawImage(inputNode.__thumb, 0, 0, size, size);
      } else if (inputNode.__thumb instanceof ImageData) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = inputNode.__thumb.width;
        tempCanvas.height = inputNode.__thumb.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(inputNode.__thumb, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0, size, size);
      }
      
      // Add a subtle border to indicate this is an output
      ctx.strokeStyle = "rgba(76, 175, 80, 0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      return;
    }
  }
  
  // Fallback: render as color if we couldn't get the input thumbnail
  this._renderColorThumbnail(ctx, size, color);
  
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, size - 4, size - 4);
}

  _renderDefaultThumbnail(ctx, size, value) {
    const isVector = Array.isArray(value) && value.length >= 3;

    if (isVector) {
      this._renderColorThumbnail(ctx, size, value);
    } else {
      this._renderFloatThumbnail(ctx, size, typeof value === "number" ? value : 0);
    }
  }

  // Helper functions
  _topologicalSort(nodes, byId) {
    const visited = new Set();
    const result = [];

    const visit = (nodeId) => {
      if (!nodeId || visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = byId.get(nodeId);
      if (!node) return;

      for (const input of node.inputs || []) {
        if (input) visit(input);
      }

      result.push(node);
    };

    for (const node of nodes) {
      visit(node.id);
    }

    return result;
  }

  _toVec2(v) {
    if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];
    if (typeof v === "number") return [v, v];
    return [0, 0];
  }

  _toVec3(v) {
    if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2]];
    if (Array.isArray(v) && v.length === 2) return [v[0], v[1], 0];
    if (typeof v === "number") return [v, v, v];
    return [0, 0, 0];
  }

  _toVec4(v) {
    if (Array.isArray(v) && v.length >= 4) return [v[0], v[1], v[2], v[3]];
    if (Array.isArray(v) && v.length === 3) return [v[0], v[1], v[2], 1];
    if (Array.isArray(v) && v.length === 2) return [v[0], v[1], 0, 1];
    if (typeof v === "number") return [v, v, v, 1];
    return [0, 0, 0, 1];
  }

  _toF32(v) {
    if (typeof v === "number") return isNaN(v) ? 0 : v;
    if (Array.isArray(v) && v.length > 0) {
      const sum = v.reduce((a, b) => (typeof b === "number" ? a + b : a), 0);
      return sum / v.length;
    }
    return 0;
  }

  _smoothstep(edge0, edge1, x) {
    const denominator = Math.max(1e-4, edge1 - edge0);
    const t = Math.min(1, Math.max(0, (x - edge0) / denominator));
    return t * t * (3 - 2 * t);
  }
}