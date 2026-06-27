// Shared resolution source for the Resolution input node's "mode" param so the GPU codegen,
// the on-node pin labels, and the CPU preview value all report the same numbers.
//
//   Preview  -> the render canvas size (what g.resolution holds on the GPU; what you preview at).
//   Display  -> the actual display resolution: the monitor's native pixels
//               (screen size * devicePixelRatio).

const RESOLUTION_MODES = ['Preview', 'Display'];

/** True when the node's mode param selects the actual display resolution rather than preview size. */
export function isDisplayMode(node) {
  return String(node?.params?.mode ?? 'Preview').toLowerCase() === 'display';
}

/** Render canvas size, mirroring g.resolution (canvas.width/height written by the GPU renderer). */
export function getPreviewResolution() {
  const canvas = (typeof window !== 'undefined' && window.gpuRenderer?.canvas) || null;
  return {
    width: Math.max(1, (canvas && canvas.width) || 1),
    height: Math.max(1, (canvas && canvas.height) || 1),
  };
}

/** Native display resolution: the monitor's physical pixels (screen size * devicePixelRatio). */
export function getDisplayResolution() {
  if (typeof window === 'undefined') return { width: 1, height: 1 };
  const dpr = window.devicePixelRatio || 1;
  const screen = window.screen || {};
  const cssW = screen.width || window.innerWidth || 1;
  const cssH = screen.height || window.innerHeight || 1;
  return {
    width: Math.max(1, Math.round(cssW * dpr)),
    height: Math.max(1, Math.round(cssH * dpr)),
  };
}

/** Resolution {width, height} for a Resolution node, honoring its mode param. */
export function getResolutionForNode(node) {
  return isDisplayMode(node) ? getDisplayResolution() : getPreviewResolution();
}

export { RESOLUTION_MODES };
