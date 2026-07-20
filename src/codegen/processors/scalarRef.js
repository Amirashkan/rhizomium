// Shared scalar coercion for `node_<id>` references used in *scalar* (f32) parameter slots.
//
// Shape parameters (Circle radius, ...) and scalar input nodes (ConstFloat value, ...) are f32.
// A reference to a vector node, or to a Mouse (vec4) global, must be reduced to one scalar rather
// than passed straight in — otherwise the shader fails with "type mismatch ... expected 'f32',
// got 'vecN<f32>'" and the whole module is rejected (black render). This mirrors the wired-node
// coercion in TypeConverter so a *referenced* node behaves like a *connected* one.

import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';

// Normalize a reference suffix to a vector component letter (x/y/z/w), or null. Accepts the xyzw
// and rgba names plus a numeric output-pin/component index (0=x, 1=y, 2=z, 3=w) — the editor stores
// a vector node's channel reference as a numeric suffix, e.g. "node_27_1".
export function suffixToComponent(suffix) {
  if (!suffix) return null;
  if (/^[xyzw]$/.test(suffix)) return suffix;
  const rgba = { r: 'x', g: 'y', b: 'z', a: 'w' };
  if (/^[rgba]$/.test(suffix)) return rgba[suffix];
  if (/^\d+$/.test(suffix)) return ['x', 'y', 'z', 'w'][Number(suffix)] ?? null;
  return null;
}

export function componentCount(type) {
  if (type === 'vec2') return 2;
  if (type === 'vec3') return 3;
  if (type === 'vec4') return 4;
  return 1;
}

// Reduce a WGSL expression of the given type to a scalar (f32).
export function toScalar(expr, type) {
  switch (type) {
    case 'vec2': return `((${expr}).x + (${expr}).y) * 0.5`;
    case 'vec3': return `((${expr}).x + (${expr}).y + (${expr}).z) / 3.0`;
    case 'vec4': return `dot((${expr}).xyz, vec3<f32>(0.299, 0.587, 0.114))`;
    default: return expr; // f32 / unknown
  }
}

// Resolve a single `node_<id>` / `node_<id>_<comp>` identifier to a scalar WGSL expression, or
// null if it cannot be resolved (incomplete/unknown id -> caller falls back to default), or
// undefined if the identifier is not a node reference at all (e.g. `time`, `PI`).
//
// Handles three sources, in order:
//   1. Mouse/Time input nodes  -> their GPU global (Mouse reduced to one channel).
//   2. A node already compiled in this pass -> its variable, with component access or scalar
//      coercion based on the type recorded by the TypeConverter.
//   3. Anything else (id not in the graph, or present but not compiled) -> null.
export function resolveScalarRef(name, graph, typeConverter) {
  // Lenient suffix capture so a half-typed component (e.g. "node_28_") still resolves instead of
  // falling through to the generator's vec4 default.
  const match = /^node_(\d+)(?:_(.*))?$/.exec(name);
  if (!match) return undefined; // not a node reference
  const id = match[1];
  const suffix = match[2];

  const nodes = graph?.nodes || [];
  const node = nodes.find((n) => String(n.id) === id);

  // 1. Live input nodes -> GPU globals.
  const kind = node?.kind?.toLowerCase();
  if (kind === 'time') return 'g.time';
  if (kind === 'mouse') {
    // g.mouse is a vec4; a scalar parameter needs one channel (default .x).
    const channel = suffixToComponent(suffix) || 'x';
    return `g.mouse.${channel}`;
  }

  // 2a. Multi-output node (Audio Analysis, Resolution, Split, ...): a numeric suffix is an OUTPUT
  //     PIN index, not a vector component. Resolve it to that pin's expression, scalar-coerced.
  const pins = typeConverter?.outputPins?.get(id);
  if (pins && pins.length > 1 && suffix != null && /^\d+$/.test(suffix)) {
    const pin = pins[Number(suffix)] || pins[0];
    return toScalar(pin.expression, pin.type);
  }

  // 2. Regular node already compiled in this pass.
  if (typeConverter?.expressions?.has(id)) {
    const expr = typeConverter.expressions.get(id);
    const type = typeConverter.types.get(id);
    const component = suffixToComponent(suffix);
    if (component) {
      if (type === 'f32') return expr; // scalar node: ignore the component suffix
      // Only emit member access the type actually has; otherwise reduce to a scalar rather than
      // producing invalid WGSL like a vec2's `.w`.
      if (['x', 'y', 'z', 'w'].indexOf(component) < componentCount(type)) {
        return `(${expr}).${component}`;
      }
    }
    return toScalar(expr, type);
  }

  // 3. Unknown id (still being typed) or referenced node not compiled in this pass.
  return null;
}

// Build a variable mapping for every `node_<id>` reference in the expression, scalar-coerced for a
// scalar parameter slot. Returns null if any reference cannot be resolved, signalling the caller to
// fall back to the parameter default instead of emitting invalid WGSL.
export function buildScalarRefMapping(expression, graph, typeConverter) {
  const mapping = {};
  let identifiers;
  try {
    identifiers = unifiedExpressionSystem.extractIdentifiers(expression);
  } catch {
    return mapping;
  }
  for (const name of identifiers) {
    const resolved = resolveScalarRef(name, graph, typeConverter);
    if (resolved === undefined) continue; // not a node reference (time/PI/etc.)
    if (resolved === null) return null;    // incomplete/unknown -> fall back to default
    mapping[name] = resolved;
  }
  return mapping;
}
