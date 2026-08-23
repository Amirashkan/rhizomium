// src/mapping/MappingCompositor.js
//
// Draws the rendered output warped onto each mapped surface.
//
// The composition is produced somewhere else — the editor's WebGPU canvas, the
// second-monitor window's own renderer, a 2D fallback canvas — and arrives here
// as an ordinary texture source. That keeps the mapping stage completely
// decoupled from how the frame was made: it uploads whatever canvas it is given
// and re-projects it, so the same code maps a WebGPU render and a mirrored
// bitmap without knowing the difference.
//
// The warp is exact, not a subdivided approximation. Each surface draws its
// destination quad as two triangles and the FRAGMENT shader runs the inverse
// homography per pixel, so a hard keystone stays straight-edged and correctly
// foreshortened where a mesh approximation would visibly bow. Homographies
// compose by matrix multiplication, so the dst -> unit -> src chain would fold
// into one matrix; it is kept as two because the unit-square coordinate is also
// what the edge feather and the alignment grid are measured in.
//
// WebGL2 rather than WebGPU on purpose: this runs in the output window
// alongside a WebGPU renderer that owns the device and the canvas it presents
// to. A second, independent GL context on its own canvas cannot contend with
// that device, and it works unchanged in the browser build where the second
// monitor is a plain popup.

import { solveHomography, invertMat3, mat3ToColumnMajor, applyMat3 } from './homography.js';
import { rectQuad } from './MappingModel.js';

const VERTEX_SRC = `#version 300 es
precision highp float;
// Destination position in normalised OUTPUT space (0,0 top-left .. 1,1 of the
// composition's frame).
in vec2 aPos;
// Where that frame sits on this canvas, as (x, y, w, h) in canvas fractions.
// The canvas is usually larger than the frame — the projector's whole field, or
// the editor stage's padded view — so that a corner pinned outside the frame
// still draws instead of being clipped at its edge.
uniform vec4 uFrame;
out vec2 vPos;
void main() {
  vPos = aPos;
  vec2 c = uFrame.xy + aPos * uFrame.zw;
  // Output space is y-down; clip space is y-up.
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2 vPos;
out vec4 fragColor;

uniform sampler2D uSource;
uniform mat3 uDstToUnit;   // output space -> this surface's unit square
uniform mat3 uUnitToSrc;   // unit square -> the crop of the composition to show
uniform float uOpacity;
uniform float uSoftEdge;   // feather width as a fraction of the surface, per edge
uniform float uTestPattern;
uniform vec3 uTestTint;

/** Alignment grid drawn in the surface's own space, so it keystones with it. */
vec4 testPattern(vec2 q) {
  // Lines of constant screen width regardless of how far the surface is warped.
  vec2 grid = abs(fract(q * 8.0 - 0.5) - 0.5) / fwidth(q * 8.0);
  float line = 1.0 - min(min(grid.x, grid.y), 1.0);

  vec2 edge = min(q, 1.0 - q) / fwidth(q);
  float border = 1.0 - min(min(edge.x, edge.y), 1.0);

  // A single diagonal disambiguates a surface that has been flipped or rotated
  // by a quarter turn, which a symmetric grid alone cannot show.
  float diag = 1.0 - min(abs(q.x - q.y) / fwidth(q.x - q.y), 1.0);

  vec3 color = uTestTint * (0.25 + 0.75 * max(line, diag)) + vec3(border);
  return vec4(color, max(max(line, diag) * 0.9, border));
}

void main() {
  vec3 unitH = uDstToUnit * vec3(vPos, 1.0);
  if (abs(unitH.z) < 1e-6) discard;
  vec2 q = unitH.xy / unitH.z;
  // The two triangles do not tile a concave or self-crossing quad exactly, so
  // the surface's real boundary is enforced here rather than by the geometry.
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;

  float alpha = uOpacity;
  if (uSoftEdge > 0.0) {
    alpha *= smoothstep(0.0, uSoftEdge, q.x) * smoothstep(0.0, uSoftEdge, 1.0 - q.x)
           * smoothstep(0.0, uSoftEdge, q.y) * smoothstep(0.0, uSoftEdge, 1.0 - q.y);
  }

  if (uTestPattern > 0.5) {
    vec4 pattern = testPattern(q);
    fragColor = vec4(pattern.rgb, pattern.a * alpha);
    return;
  }

  vec3 srcH = uUnitToSrc * vec3(q, 1.0);
  if (abs(srcH.z) < 1e-6) discard;
  vec2 uv = srcH.xy / srcH.z;
  vec4 texel = texture(uSource, uv);
  fragColor = vec4(texel.rgb, texel.a * alpha);
}`;

/** Distinct hues so neighbouring surfaces stay tellable apart in test mode. */
const TEST_TINTS = [
  [0.78, 0.95, 0.31], [0.35, 0.78, 1.0], [1.0, 0.55, 0.32],
  [0.72, 0.55, 1.0], [0.36, 0.95, 0.72], [1.0, 0.84, 0.35],
];

const UNIT_QUAD = rectQuad(0, 0, 1, 1);

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Mapping shader failed to compile: ${log}`);
  }
  return shader;
}

/**
 * Per-surface matrices for the warp. Exported so the geometry can be checked
 * without a GL context.
 *
 * @param {object} surface
 * @returns {{dstToUnit:number[], unitToSrc:number[]}|null} null when the
 *   surface's quad has collapsed and no projective map exists
 */
export function surfaceMatrices(surface) {
  const unitToDst = solveHomography(UNIT_QUAD, surface.dst);
  if (!unitToDst) return null;
  const dstToUnit = invertMat3(unitToDst);
  if (!dstToUnit) return null;
  const unitToSrc = solveHomography(UNIT_QUAD, surface.src);
  if (!unitToSrc) return null;
  return { dstToUnit, unitToSrc };
}

/**
 * Map a point in output space back to the composition it samples — the
 * inspector's "what is under the cursor" answer, and the inverse of what the
 * fragment shader does.
 *
 * @param {object} surface
 * @param {number} x output-space x
 * @param {number} y output-space y
 * @returns {{x:number,y:number}|null} null when the point is off the surface
 */
export function outputToSource(surface, x, y) {
  const matrices = surfaceMatrices(surface);
  if (!matrices) return null;
  const unit = applyMat3(matrices.dstToUnit, x, y);
  if (!unit) return null;
  if (unit.x < 0 || unit.x > 1 || unit.y < 0 || unit.y > 1) return null;
  return applyMat3(matrices.unitToSrc, unit.x, unit.y);
}

/**
 * MappingCompositor — owns a WebGL2 context on the presentation canvas and
 * re-projects a source canvas through a {@link MappingModel} each frame.
 */
export class MappingCompositor {
  /**
   * @param {HTMLCanvasElement} canvas the canvas to present the warp on
   * @param {object} [opts]
   * @param {WebGL2RenderingContext} [opts.gl] pre-made context (tests)
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.texture = null;
    this.vao = null;
    this.buffer = null;
    this.uniforms = null;
    this.failed = false;
    this._contextLost = false;
    /** Whether the texture holds a frame worth redrawing when a read fails. */
    this._hasFrame = false;
    this._vertices = new Float32Array(8);
    this._onContextLost = null;
    this._onContextRestored = null;

    const gl = opts.gl || this._createContext(canvas);
    if (!gl) {
      this.failed = true;
      return;
    }
    this.gl = gl;
    try {
      this._initGL();
    } catch (error) {
      // A compositor that cannot start must not take the output window with it;
      // callers fall back to presenting the unmapped source.
      console.warn('[MappingCompositor] disabled:', error && error.message);
      this.failed = true;
    }
    this._watchContextLoss();
  }

  _createContext(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
      return canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
    } catch {
      return null;
    }
  }

  _initGL() {
    const gl = this.gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Mapping program failed to link: ${log}`);
    }
    this.program = program;

    this.uniforms = {
      source: gl.getUniformLocation(program, 'uSource'),
      dstToUnit: gl.getUniformLocation(program, 'uDstToUnit'),
      unitToSrc: gl.getUniformLocation(program, 'uUnitToSrc'),
      opacity: gl.getUniformLocation(program, 'uOpacity'),
      softEdge: gl.getUniformLocation(program, 'uSoftEdge'),
      testPattern: gl.getUniformLocation(program, 'uTestPattern'),
      frame: gl.getUniformLocation(program, 'uFrame'),
      testTint: gl.getUniformLocation(program, 'uTestTint'),
    };

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._vertices.byteLength, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // CLAMP_TO_EDGE, not REPEAT: a src crop pushed a hair past the frame should
    // smear the edge pixel, never wrap the opposite side of the composition in.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * A lost context leaves every GL object invalid. Mark the compositor dormant
   * so `render` reports failure (the caller shows the unmapped source) and
   * rebuild once the driver hands the context back.
   */
  _watchContextLoss() {
    const canvas = this.canvas;
    if (!canvas || typeof canvas.addEventListener !== 'function') return;
    this._onContextLost = (event) => {
      event.preventDefault();
      this._contextLost = true;
    };
    this._onContextRestored = () => {
      this._contextLost = false;
      // The old texture died with the context, so there is nothing to hold.
      this._hasFrame = false;
      try {
        this._initGL();
        this.failed = false;
      } catch {
        this.failed = true;
      }
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);
  }

  /** @returns {boolean} whether this compositor can draw. */
  isReady() {
    return !!this.gl && !!this.program && !this.failed && !this._contextLost;
  }

  /**
   * Match the drawing buffer to a device-pixel size.
   * @returns {boolean} whether the size changed
   */
  resize(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (!this.canvas || (this.canvas.width === w && this.canvas.height === h)) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /**
   * Upload `source` and draw every enabled surface.
   *
   * @param {CanvasImageSource} source the rendered composition
   * @param {import('./MappingModel.js').MappingModel} model
   * @param {object} [opts]
   * @param {boolean} [opts.testPattern] draw the alignment grid instead of the frame
   * @param {string} [opts.only] restrict drawing to one surface id
   * @param {{x:number,y:number,w:number,h:number}} [opts.frame] where the
   *   composition's frame sits on this canvas, in canvas fractions; defaults to
   *   the whole canvas
   * @returns {boolean} whether a frame was drawn
   */
  render(source, model, opts = {}) {
    if (!this.isReady() || !model) return false;
    const gl = this.gl;

    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 0 || height <= 0) return false;

    gl.viewport(0, 0, width, height);
    // Unmapped areas of the projector's field must be black, not transparent —
    // a projector shows black as "off", which is exactly what a surface's
    // surroundings should be.
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const uploaded = this._uploadSource(source);
    // Without a frame there is nothing to warp, but the alignment grid is
    // synthetic and still worth drawing — it is how a surface gets lined up on
    // the physical object before any content is playing.
    if (!uploaded && !opts.testPattern) return true;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.source, 0);

    const frame = opts.frame;
    if (frame && frame.w > 0 && frame.h > 0) {
      gl.uniform4f(this.uniforms.frame, frame.x, frame.y, frame.w, frame.h);
    } else {
      gl.uniform4f(this.uniforms.frame, 0, 0, 1, 1);
    }

    let drawn = 0;
    for (let i = 0; i < model.surfaces.length; i++) {
      const surface = model.surfaces[i];
      if (!surface.enabled) continue;
      if (opts.only && surface.id !== opts.only) continue;
      if (this._drawSurface(surface, i, opts)) drawn++;
    }

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.BLEND);
    return drawn > 0;
  }

  _drawSurface(surface, index, opts) {
    const gl = this.gl;
    const matrices = surfaceMatrices(surface);
    if (!matrices) return false; // collapsed quad mid-drag; skip this frame

    const quad = surface.dst;
    const v = this._vertices;
    for (let c = 0; c < 4; c++) {
      v[c * 2] = quad[c].x;
      v[c * 2 + 1] = quad[c].y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);

    gl.uniformMatrix3fv(this.uniforms.dstToUnit, false, mat3ToColumnMajor(matrices.dstToUnit));
    gl.uniformMatrix3fv(this.uniforms.unitToSrc, false, mat3ToColumnMajor(matrices.unitToSrc));
    gl.uniform1f(this.uniforms.opacity, surface.opacity);
    gl.uniform1f(this.uniforms.softEdge, surface.softEdge);
    gl.uniform1f(this.uniforms.testPattern, opts.testPattern ? 1 : 0);
    const tint = TEST_TINTS[index % TEST_TINTS.length];
    gl.uniform3f(this.uniforms.testTint, tint[0], tint[1], tint[2]);

    // TL, TR, BR, BL as a fan is the quad's two triangles.
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    return true;
  }

  /**
   * Upload the current frame. Canvases with a zero dimension (a preview that has
   * not been laid out yet) are skipped rather than throwing.
   * @returns {boolean} whether the texture holds a usable frame
   */
  _uploadSource(source) {
    // No source at all is a deliberate "show nothing" — preview turned off, or a
    // mapping with nothing assigned. That must go black, so it never falls back
    // to the held frame below.
    if (!source) return false;
    const gl = this.gl;
    const w = source.width || source.videoWidth || source.displayWidth || 0;
    const h = source.height || source.videoHeight || source.displayHeight || 0;
    if (w > 0 && h > 0) {
      try {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        // Uploaded UNFLIPPED, so the source's top row lands at t=0. Source UVs are
        // y-down like the rest of this file's coordinates, so they then index the
        // texture directly. Flipping here as well would invert the warp — every
        // surface would show its composition upside down.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        this._hasFrame = true;
        return true;
      } catch { /* unreadable this frame; fall through to the one being held */ }
    }
    // A source that is there but cannot be read RIGHT NOW is a gap, not a black
    // frame: a canvas mid-resize, a video that has not decoded yet, or — the
    // common one — the editor's WebGPU canvas caught between presents, since
    // the stage runs its own animation frame and beats against the render loop.
    // Redrawing the frame already in the texture holds the picture steady.
    // Clearing to black on those frames is what makes the stage strobe, and it
    // strobes hardest with nothing mapped yet, which is when someone is staring
    // at the empty stage wondering what to do.
    return this._hasFrame;
  }

  /** Release GL resources and detach listeners. */
  dispose() {
    const gl = this.gl;
    if (this.canvas && typeof this.canvas.removeEventListener === 'function') {
      if (this._onContextLost) this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
      if (this._onContextRestored) this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    }
    this._onContextLost = null;
    this._onContextRestored = null;
    if (!gl) return;
    try {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    } catch { /* context already gone */ }
    this.texture = null;
    this.buffer = null;
    this.vao = null;
    this.program = null;
    this.gl = null;
    this.failed = true;
    this._hasFrame = false;
  }
}

export default MappingCompositor;
