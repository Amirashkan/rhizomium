/**
 * InterpolationSystem.js
 *
 * Provides interpolation functions for keyframe animation.
 * Supports various easing modes and value types.
 */

/**
 * Easing functions
 */
export const EasingFunctions = {
  /**
   * Linear interpolation (no easing)
   */
  linear: (t) => t,

  /**
   * Ease in (quadratic)
   */
  easeIn: (t) => t * t,

  /**
   * Ease out (quadratic)
   */
  easeOut: (t) => t * (2 - t),

  /**
   * Ease in-out (quadratic)
   */
  easeInOut: (t) => {
    return t < 0.5
      ? 2 * t * t
      : -1 + (4 - 2 * t) * t;
  },

  /**
   * Ease in (cubic)
   */
  easeInCubic: (t) => t * t * t,

  /**
   * Ease out (cubic)
   */
  easeOutCubic: (t) => {
    const t1 = t - 1;
    return t1 * t1 * t1 + 1;
  },

  /**
   * Ease in-out (cubic)
   */
  easeInOutCubic: (t) => {
    return t < 0.5
      ? 4 * t * t * t
      : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  },

  /**
   * Ease in (quartic)
   */
  easeInQuart: (t) => t * t * t * t,

  /**
   * Ease out (quartic)
   */
  easeOutQuart: (t) => {
    const t1 = t - 1;
    return 1 - t1 * t1 * t1 * t1;
  },

  /**
   * Ease in-out (quartic)
   */
  easeInOutQuart: (t) => {
    const t1 = t - 1;
    return t < 0.5
      ? 8 * t * t * t * t
      : 1 - 8 * t1 * t1 * t1 * t1;
  },

  /**
   * Ease in (quintic)
   */
  easeInQuint: (t) => t * t * t * t * t,

  /**
   * Ease out (quintic)
   */
  easeOutQuint: (t) => {
    const t1 = t - 1;
    return 1 + t1 * t1 * t1 * t1 * t1;
  },

  /**
   * Ease in-out (quintic)
   */
  easeInOutQuint: (t) => {
    const t1 = t - 1;
    return t < 0.5
      ? 16 * t * t * t * t * t
      : 1 + 16 * t1 * t1 * t1 * t1 * t1;
  },

  /**
   * Ease in (sine)
   */
  easeInSine: (t) => 1 - Math.cos(t * Math.PI / 2),

  /**
   * Ease out (sine)
   */
  easeOutSine: (t) => Math.sin(t * Math.PI / 2),

  /**
   * Ease in-out (sine)
   */
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  /**
   * Ease in (exponential)
   */
  easeInExpo: (t) => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),

  /**
   * Ease out (exponential)
   */
  easeOutExpo: (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),

  /**
   * Ease in-out (exponential)
   */
  easeInOutExpo: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5
      ? Math.pow(2, 20 * t - 10) / 2
      : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  /**
   * Ease in (circular)
   */
  easeInCirc: (t) => 1 - Math.sqrt(1 - t * t),

  /**
   * Ease out (circular)
   */
  easeOutCirc: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),

  /**
   * Ease in-out (circular)
   */
  easeInOutCirc: (t) => {
    return t < 0.5
      ? (1 - Math.sqrt(1 - 4 * t * t)) / 2
      : (Math.sqrt(1 - (-2 * t + 2) * (-2 * t + 2)) + 1) / 2;
  },

  /**
   * Step (no interpolation, instant change)
   */
  step: (t) => t < 1 ? 0 : 1,

  /**
   * Cubic bezier curve
   * @param {number} x1 - First control point x
   * @param {number} y1 - First control point y
   * @param {number} x2 - Second control point x
   * @param {number} y2 - Second control point y
   * @returns {Function} Easing function
   */
  bezier: (x1, y1, x2, y2) => {
    // Newton-Raphson iteration to solve for t given x
    const sampleCurveX = (t) => {
      return ((1 - 3 * x2 + 3 * x1) * t * t * t +
              (3 * x2 - 6 * x1) * t * t +
              (3 * x1) * t);
    };

    const sampleCurveY = (t) => {
      return ((1 - 3 * y2 + 3 * y1) * t * t * t +
              (3 * y2 - 6 * y1) * t * t +
              (3 * y1) * t);
    };

    const sampleCurveDerivativeX = (t) => {
      return (3 * (1 - 3 * x2 + 3 * x1) * t * t +
              2 * (3 * x2 - 6 * x1) * t +
              (3 * x1));
    };

    const solveCurveX = (x) => {
      let t = x;
      // Newton-Raphson iteration
      for (let i = 0; i < 8; i++) {
        const xError = sampleCurveX(t) - x;
        if (Math.abs(xError) < 0.001) break;
        const dx = sampleCurveDerivativeX(t);
        if (Math.abs(dx) < 0.000001) break;
        t -= xError / dx;
      }
      return t;
    };

    return (x) => {
      if (x === 0) return 0;
      if (x === 1) return 1;
      return sampleCurveY(solveCurveX(x));
    };
  }
};

/**
 * Get easing function by name
 * @param {string} name - Easing function name
 * @param {Array<number>} [bezierControlPoints] - For bezier: [x1, y1, x2, y2]
 * @returns {Function} Easing function
 */
export function getEasingFunction(name, bezierControlPoints) {
  if (name === 'bezier' && bezierControlPoints && bezierControlPoints.length === 4) {
    return EasingFunctions.bezier(...bezierControlPoints);
  }

  // Map common names to functions
  const mapping = {
    'linear': EasingFunctions.linear,
    'ease-in': EasingFunctions.easeInCubic,
    'ease-out': EasingFunctions.easeOutCubic,
    'ease-in-out': EasingFunctions.easeInOutCubic,
    'step': EasingFunctions.step,
    'easeIn': EasingFunctions.easeInCubic,
    'easeOut': EasingFunctions.easeOutCubic,
    'easeInOut': EasingFunctions.easeInOutCubic,
  };

  return mapping[name] || EasingFunctions.linear;
}

/**
 * InterpolationSystem - handles value interpolation between keyframes
 */
export class InterpolationSystem {
  /**
   * Interpolate between two values
   * @param {*} value1 - Start value
   * @param {*} value2 - End value
   * @param {number} t - Interpolation factor (0-1)
   * @param {string} interpolation - Interpolation type
   * @param {Array<number>} [bezierControlPoints] - For bezier curves
   * @returns {*} Interpolated value
   */
  static interpolate(value1, value2, t, interpolation = 'linear', bezierControlPoints) {
    // Clamp t to [0, 1]
    t = Math.max(0, Math.min(1, t));

    // Apply easing
    const easingFunc = getEasingFunction(interpolation, bezierControlPoints);
    const easedT = easingFunc(t);

    // Interpolate based on value type
    return this.interpolateValue(value1, value2, easedT);
  }

  /**
   * Interpolate values based on their type
   * @param {*} value1 - Start value
   * @param {*} value2 - End value
   * @param {number} t - Eased interpolation factor (0-1)
   * @returns {*} Interpolated value
   */
  static interpolateValue(value1, value2, t) {
    // Number
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      return value1 + (value2 - value1) * t;
    }

    // Array (vec2, vec3, vec4, color)
    if (Array.isArray(value1) && Array.isArray(value2)) {
      if (value1.length !== value2.length) {

        return value1;
      }
      return value1.map((v, i) => v + (value2[i] - v) * t);
    }

    // Object with x, y properties (vec2)
    if (value1 && typeof value1 === 'object' && 'x' in value1 && 'y' in value1) {
      return {
        x: value1.x + (value2.x - value1.x) * t,
        y: value1.y + (value2.y - value1.y) * t
      };
    }

    // Object with x, y, z properties (vec3)
    if (value1 && typeof value1 === 'object' && 'x' in value1 && 'y' in value1 && 'z' in value1) {
      return {
        x: value1.x + (value2.x - value1.x) * t,
        y: value1.y + (value2.y - value1.y) * t,
        z: value1.z + (value2.z - value1.z) * t
      };
    }

    // Object with x, y, z, w properties (vec4)
    if (value1 && typeof value1 === 'object' && 'x' in value1 && 'y' in value1 && 'z' in value1 && 'w' in value1) {
      return {
        x: value1.x + (value2.x - value1.x) * t,
        y: value1.y + (value2.y - value1.y) * t,
        z: value1.z + (value2.z - value1.z) * t,
        w: value1.w + (value2.w - value1.w) * t
      };
    }

    // Boolean - step at 0.5
    if (typeof value1 === 'boolean' && typeof value2 === 'boolean') {
      return t < 0.5 ? value1 : value2;
    }

    // String - no interpolation
    if (typeof value1 === 'string' || typeof value2 === 'string') {
      return t < 0.5 ? value1 : value2;
    }

    // Default: return start value
    return value1;
  }

  /**
   * Evaluate a track at a specific time
   * @param {Array<Keyframe>} keyframes - Sorted array of keyframes
   * @param {number} time - Time to evaluate at
   * @returns {*} Interpolated value or null if no keyframes
   */
  static evaluateTrack(keyframes, time) {
    if (!keyframes || keyframes.length === 0) {
      return null;
    }

    // Single keyframe - return its value
    if (keyframes.length === 1) {
      return keyframes[0].value;
    }

    // Before first keyframe - return first value
    if (time <= keyframes[0].time) {
      return keyframes[0].value;
    }

    // After last keyframe - return last value
    if (time >= keyframes[keyframes.length - 1].time) {
      return keyframes[keyframes.length - 1].value;
    }

    // Find surrounding keyframes
    let kf1, kf2;
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
        kf1 = keyframes[i];
        kf2 = keyframes[i + 1];
        break;
      }
    }

    if (!kf1 || !kf2) {
      return keyframes[0].value;
    }

    // Calculate interpolation factor
    const duration = kf2.time - kf1.time;
    const t = duration > 0 ? (time - kf1.time) / duration : 0;

    // Use interpolation from first keyframe (kf1)
    return this.interpolate(
      kf1.value,
      kf2.value,
      t,
      kf1.interpolation || 'linear',
      kf1.bezierControlPoints
    );
  }

  /**
   * Get all available interpolation types
   * @returns {Array<string>} Array of interpolation type names
   */
  static getInterpolationTypes() {
    return [
      'linear',
      'step',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'easeInSine',
      'easeOutSine',
      'easeInOutSine',
      'easeInExpo',
      'easeOutExpo',
      'easeInOutExpo',
      'easeInCirc',
      'easeOutCirc',
      'easeInOutCirc',
      'bezier'
    ];
  }
}
