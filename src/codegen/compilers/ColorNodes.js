// src/codegen/compilers/ColorNodes.js
// Export this and import it in ShaderTemplate.js

export const COLOR_FUNCTIONS_WGSL = `
// ============================================================================
// COLOR SPACE CONVERSIONS
// ============================================================================

fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let maxC = max(max(rgb.r, rgb.g), rgb.b);
  let minC = min(min(rgb.r, rgb.g), rgb.b);
  let delta = maxC - minC;
  
  var h = 0.0;
  var s = 0.0;
  let v = maxC;
  
  if (delta > 0.00001) {
    s = delta / maxC;
    
    if (rgb.r >= maxC) {
      h = (rgb.g - rgb.b) / delta;
    } else if (rgb.g >= maxC) {
      h = 2.0 + (rgb.b - rgb.r) / delta;
    } else {
      h = 4.0 + (rgb.r - rgb.g) / delta;
    }
    
    h = h / 6.0;
    if (h < 0.0) {
      h = h + 1.0;
    }
  }
  
  return vec3<f32>(h, s, v);
}

fn hsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
  let h = hsv.x * 6.0;
  let s = hsv.y;
  let v = hsv.z;
  
  let i = floor(h);
  let f = h - i;
  
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));
  
  let iMod = i32(i) % 6;
  
  if (iMod == 0) {
    return vec3<f32>(v, t, p);
  } else if (iMod == 1) {
    return vec3<f32>(q, v, p);
  } else if (iMod == 2) {
    return vec3<f32>(p, v, t);
  } else if (iMod == 3) {
    return vec3<f32>(p, q, v);
  } else if (iMod == 4) {
    return vec3<f32>(t, p, v);
  } else {
    return vec3<f32>(v, p, q);
  }
}

fn rgbToHsl(rgb: vec3<f32>) -> vec3<f32> {
  let maxC = max(max(rgb.r, rgb.g), rgb.b);
  let minC = min(min(rgb.r, rgb.g), rgb.b);
  let delta = maxC - minC;
  
  var h = 0.0;
  var s = 0.0;
  let l = (maxC + minC) / 2.0;
  
  if (delta > 0.00001) {
    if (l < 0.5) {
      s = delta / (maxC + minC);
    } else {
      s = delta / (2.0 - maxC - minC);
    }
    
    if (rgb.r >= maxC) {
      h = (rgb.g - rgb.b) / delta;
    } else if (rgb.g >= maxC) {
      h = 2.0 + (rgb.b - rgb.r) / delta;
    } else {
      h = 4.0 + (rgb.r - rgb.g) / delta;
    }
    
    h = h / 6.0;
    if (h < 0.0) {
      h = h + 1.0;
    }
  }
  
  return vec3<f32>(h, s, l);
}

fn hueToRgb(p: f32, q: f32, t: f32) -> f32 {
  var tMod = t;
  if (tMod < 0.0) { tMod = tMod + 1.0; }
  if (tMod > 1.0) { tMod = tMod - 1.0; }
  
  if (tMod < 1.0 / 6.0) {
    return p + (q - p) * 6.0 * tMod;
  }
  if (tMod < 1.0 / 2.0) {
    return q;
  }
  if (tMod < 2.0 / 3.0) {
    return p + (q - p) * (2.0 / 3.0 - tMod) * 6.0;
  }
  return p;
}

fn hslToRgb(hsl: vec3<f32>) -> vec3<f32> {
  let h = hsl.x;
  let s = hsl.y;
  let l = hsl.z;
  
  if (s < 0.00001) {
    return vec3<f32>(l, l, l);
  }
  
  var q: f32;
  if (l < 0.5) {
    q = l * (1.0 + s);
  } else {
    q = l + s - l * s;
  }
  
  let p = 2.0 * l - q;
  
  let r = hueToRgb(p, q, h + 1.0 / 3.0);
  let g = hueToRgb(p, q, h);
  let b = hueToRgb(p, q, h - 1.0 / 3.0);
  
  return vec3<f32>(r, g, b);
}

// ============================================================================
// COLOR ADJUSTMENT FUNCTIONS
// ============================================================================

fn adjustHSV(rgb: vec3<f32>, hueShift: f32, saturation: f32, value: f32) -> vec3<f32> {
  var hsv = rgbToHsv(rgb);
  
  // Adjust hue (wrap around)
  hsv.x = hsv.x + hueShift;
  hsv.x = fract(hsv.x);
  
  // Adjust saturation and value
  hsv.y = clamp(hsv.y * saturation, 0.0, 1.0);
  hsv.z = clamp(hsv.z * value, 0.0, 1.0);
  
  return hsvToRgb(hsv);
}

fn adjustBrightnessContrast(color: vec3<f32>, brightness: f32, contrast: f32) -> vec3<f32> {
  // Apply brightness
  var result = color + vec3<f32>(brightness);
  
  // Apply contrast around 0.5
  result = (result - 0.5) * contrast + 0.5;
  
  return clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn adjustColorBalance(color: vec3<f32>, shadows: vec3<f32>, midtones: vec3<f32>, highlights: vec3<f32>) -> vec3<f32> {
  let luminance = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  
  // Calculate blend weights for shadows, midtones, highlights
  let shadowWeight = (1.0 - luminance) * (1.0 - luminance);
  let highlightWeight = luminance * luminance;
  let midtoneWeight = 1.0 - shadowWeight - highlightWeight;
  
  // Apply color balance
  var result = color;
  result = result + shadows * shadowWeight;
  result = result + midtones * midtoneWeight;
  result = result + highlights * highlightWeight;
  
  return clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
}

// ============================================================================
// BLEND MODES
// ============================================================================

fn blendMultiply(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return base * blend;
}

fn blendScreen(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(1.0) - (vec3<f32>(1.0) - base) * (vec3<f32>(1.0) - blend);
}

fn blendOverlay(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  var result: vec3<f32>;
  
  if (base.r < 0.5) {
    result.r = 2.0 * base.r * blend.r;
  } else {
    result.r = 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r);
  }
  
  if (base.g < 0.5) {
    result.g = 2.0 * base.g * blend.g;
  } else {
    result.g = 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g);
  }
  
  if (base.b < 0.5) {
    result.b = 2.0 * base.b * blend.b;
  } else {
    result.b = 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b);
  }
  
  return result;
}

fn blendAdd(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return clamp(base + blend, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn blendSubtract(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return clamp(base - blend, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn blendDivide(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return clamp(base / max(blend, vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn blendDifference(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return abs(base - blend);
}

fn blendDarken(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return min(base, blend);
}

fn blendLighten(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return max(base, blend);
}

fn blendExclusion(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return base + blend - 2.0 * base * blend;
}
`;