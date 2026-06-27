// Shared node anatomy + socket-row layout. Single source of truth for the renderer (drawing) and
// the connection manager (hit-testing) so ports, labels and value tags never drift apart.
//
// A node is laid out top-down as one shared anatomy:
//
//     header  →  optional preview band  →  a fixed-height socket-row grid
//
// Inputs fill the left slots top-down; outputs fill the right slots top-down. A node renders
// max(inputCount, outputCount) rows. Because a port is always centred on its row and on the node
// edge, port ↔ label ↔ value stay aligned regardless of how many inputs/outputs a node has — they
// can never float independently toward the node's vertical centre again.

export const HEADER_H = 26;          // title bar: title + #id + control chips
export const ROW_H = 18;             // fixed socket-row height (the grid step)
export const ROW_GRID_TOP_GAP = 6;   // gap above the first socket row
export const PREVIEW_TOP_GAP = 4;    // gap between header bottom and the preview band
export const PREVIEW_SIDE_MARGIN = 6;// preview band inset from the node's left/right edge
export const BOTTOM_PAD = 8;         // padding below the last socket row
export const EDGE_INSET = 8;         // port-circle centre, inset from the node's left/right edge

// Legacy aliases — kept so older references keep working after the row-grid switch. The first row's
// centre sits ROW_H/2 below the grid top, which matches the old "first pin below the title" intent.
export const PIN_TOP = HEADER_H + ROW_GRID_TOP_GAP;
export const PIN_SPACING = ROW_H;
export const PIN_BOTTOM_MARGIN = BOTTOM_PAD;

/**
 * Preview band height for a node, or 0 when it has no visible preview thumbnail. Reads the editor's
 * current S/M/L size for the node so the renderer and the hit-tester always agree on where the
 * socket grid starts.
 */
export function nodePreviewHeight(node) {
  if (!node || !node.__thumb) return 0;
  const editor = typeof window !== "undefined" ? window.editor : null;
  if (!editor || typeof editor.getPreviewSize !== "function") return 0;
  // Only reserve the band when previews are actually shown for this node.
  if (typeof editor.shouldShowPreview === "function" && !editor.shouldShowPreview(node)) return 0;
  const h = editor.getPreviewSize(node.id);
  return typeof h === "number" && h > 0 ? h : 0;
}

/** Y of the top of the socket-row grid (below the header and the optional preview band). */
export function rowsTop(node, previewH) {
  const top = node.y || 0;
  if (previewH > 0) {
    return top + HEADER_H + PREVIEW_TOP_GAP + previewH + ROW_GRID_TOP_GAP;
  }
  return top + HEADER_H + ROW_GRID_TOP_GAP;
}

/** Vertical centre of socket row `i` (0-based, top-down). */
export function rowCenterY(node, previewH, i) {
  return rowsTop(node, previewH) + ROW_H / 2 + i * ROW_H;
}

/** Number of socket rows a node renders: max(inputs, outputs), at least 1. */
export function socketRowCount(inCount, outCount) {
  return Math.max(inCount || 0, outCount || 0, 1);
}

/** Minimum node height that fits the header, the optional preview band and every socket row. */
export function nodeMinHeight(node, inCount, outCount, previewH) {
  const rows = socketRowCount(inCount, outCount);
  const headerAndPreview =
    previewH > 0
      ? HEADER_H + PREVIEW_TOP_GAP + previewH + ROW_GRID_TOP_GAP
      : HEADER_H + ROW_GRID_TOP_GAP;
  return headerAndPreview + rows * ROW_H + BOTTOM_PAD;
}

/**
 * Full port geometry for a node. `inputs[i]` / `outputs[i]` are the {x, y} centres of the input /
 * output ports — input i and output i share row i, so they sit at the same height.
 */
export function nodePinPositions(node, inCount, outCount, previewH) {
  const x = node.x || 0;
  const w = node.w || 100;
  const inputs = [];
  for (let i = 0; i < (inCount || 0); i++) {
    inputs.push({ x: x + EDGE_INSET, y: rowCenterY(node, previewH, i) });
  }
  const outputs = [];
  for (let i = 0; i < (outCount || 0); i++) {
    outputs.push({ x: x + w - EDGE_INSET, y: rowCenterY(node, previewH, i) });
  }
  return { inputs, outputs };
}
