// src/mapping/homography.js
//
// Projective (perspective) transform math for the projection-mapping tool.
//
// Corner-pinning a rendered frame onto a physical surface is a homography: the
// unique projective map taking one quad to another. Four point correspondences
// determine it, and unlike an affine map it can represent the keystone a
// projector throws at an off-axis wall — which is the whole point of the tool.
//
// Matrices here are 3x3 in ROW-MAJOR order, nine numbers, with m[8] normalised
// to 1 where the solve produces it. WebGL wants column-major, so
// `mat3ToColumnMajor` transposes on the way out rather than the storage order
// being flipped everywhere else to suit one consumer.

/** Anything below this and the quad has collapsed — no invertible map exists. */
const EPSILON = 1e-12;

/**
 * Solve the 8x8 linear system `A x = b` by Gauss-Jordan elimination with
 * partial pivoting. `A` is row-major and destroyed in place.
 *
 * @param {number[][]} A n rows of n coefficients
 * @param {number[]} b n right-hand-side terms
 * @returns {number[]|null} the solution vector, or null when A is singular
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    // Partial pivot: the largest remaining magnitude in this column becomes the
    // pivot row. Without it a legitimate quad whose first coefficient happens to
    // be 0 (a corner pinned at the origin) divides by zero.
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) < EPSILON) return null; // singular

    if (pivot !== col) {
      const tmpRow = A[pivot]; A[pivot] = A[col]; A[col] = tmpRow;
      const tmpVal = b[pivot]; b[pivot] = b[col]; b[col] = tmpVal;
    }

    const inv = 1 / A[col][col];
    for (let c = col; c < n; c++) A[col][c] *= inv;
    b[col] *= inv;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[row][c] -= factor * A[col][c];
      b[row] -= factor * b[col];
    }
  }
  return b;
}

/**
 * The homography mapping four source points onto four destination points.
 *
 * Each correspondence (x,y) -> (u,v) contributes two rows:
 *   h0·x + h1·y + h2 - h6·x·u - h7·y·u = u
 *   h3·x + h4·y + h5 - h6·x·v - h7·y·v = v
 * with h8 fixed at 1 (a homography is scale-invariant, so one degree of freedom
 * is free to pin down).
 *
 * @param {Array<{x:number,y:number}>} src exactly 4 source points
 * @param {Array<{x:number,y:number}>} dst exactly 4 destination points, in the
 *   same corner order as `src`
 * @returns {number[]|null} row-major 3x3, or null when either quad is degenerate
 *   (three points collinear, two coincident, a bow-tie that folds on itself)
 */
export function solveHomography(src, dst) {
  if (!Array.isArray(src) || !Array.isArray(dst)) return null;
  if (src.length !== 4 || dst.length !== 4) return null;

  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i];
    const d = dst[i];
    if (!s || !d) return null;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;

    A.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
    b.push(d.x);
    A.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
    b.push(d.y);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;
  if (!h.every(Number.isFinite)) return null;

  const m = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // The 8x8 system stays solvable for some degenerate quads — two coincident
  // corners, for instance — and hands back a SINGULAR matrix that flattens the
  // plane to a line. Nothing downstream can invert that, so reject it here
  // rather than letting a collapsed surface become a null-check further on.
  if (Math.abs(determinant3(m)) < EPSILON) return null;
  return m;
}

/**
 * Determinant of a row-major 3x3.
 * @param {number[]} m
 * @returns {number}
 */
function determinant3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
       + m[1] * (m[5] * m[6] - m[3] * m[8])
       + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/**
 * Invert a row-major 3x3 matrix.
 *
 * @param {number[]} m row-major 3x3
 * @returns {number[]|null} the inverse, or null when `m` is singular
 */
export function invertMat3(m) {
  if (!Array.isArray(m) || m.length !== 9) return null;
  const [a, b, c, d, e, f, g, h, i] = m;

  const cofA = e * i - f * h;
  const cofB = f * g - d * i;
  const cofC = d * h - e * g;

  const det = a * cofA + b * cofB + c * cofC;
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return null;
  const inv = 1 / det;

  const out = [
    cofA * inv,             (c * h - b * i) * inv, (b * f - c * e) * inv,
    cofB * inv,             (a * i - c * g) * inv, (c * d - a * f) * inv,
    cofC * inv,             (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
  return out.every(Number.isFinite) ? out : null;
}

/**
 * Apply a row-major 3x3 to a 2D point, dividing through by w.
 *
 * @param {number[]} m row-major 3x3
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}|null} the mapped point, or null when the point
 *   lands on the horizon (w = 0) and has no finite image
 */
export function applyMat3(m, x, y) {
  if (!Array.isArray(m) || m.length !== 9) return null;
  const w = m[6] * x + m[7] * y + m[8];
  if (!Number.isFinite(w) || Math.abs(w) < EPSILON) return null;
  const px = (m[0] * x + m[1] * y + m[2]) / w;
  const py = (m[3] * x + m[4] * y + m[5]) / w;
  return (Number.isFinite(px) && Number.isFinite(py)) ? { x: px, y: py } : null;
}

/**
 * Transpose a row-major 3x3 into the column-major Float32Array WebGL's
 * `uniformMatrix3fv` expects.
 *
 * @param {number[]} m row-major 3x3
 * @returns {Float32Array} nine floats, column-major
 */
export function mat3ToColumnMajor(m) {
  return new Float32Array([
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8],
  ]);
}
