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

/**
 * Minimum node height that fits the header, the optional preview band and every socket row.
 * `extraRows` reserves further grid rows below the sockets — a node with expandable inputs uses one
 * for its "+ / −" chips, so those chips get their own row instead of overlapping the last pin.
 */
export function nodeMinHeight(node, inCount, outCount, previewH, extraRows = 0) {
  const rows = socketRowCount(inCount, outCount) + Math.max(0, extraRows);
  const headerAndPreview =
    previewH > 0
      ? HEADER_H + PREVIEW_TOP_GAP + previewH + ROW_GRID_TOP_GAP
      : HEADER_H + ROW_GRID_TOP_GAP;
  return headerAndPreview + rows * ROW_H + BOTTOM_PAD;
}

/** Left inset of the title text inside the header, and the width of the control-chip strip. */
export const TITLE_X_INSET = 10;
export const HEADER_CONTROLS_W = 65; // bypass / preview / size chips, measured from the right edge
export const HEADER_CONTROLS_GAP = 6; // gap between that strip and whatever sits left of it

/**
 * The clickable title area of a node: the header, minus the control-chip strip on its right.
 *
 * Double-clicking it opens the inline rename field, so the renderer (which clips the drawn title to
 * this width) and the event handler (which hit-tests it) have to agree on the same rectangle. It
 * stops short of the chips deliberately — a double-click that just misses the eye button should do
 * nothing, not rename the node.
 */
export function nodeTitleRect(node) {
  const x = node?.x || 0;
  const y = node?.y || 0;
  const w = node?.w || 160;
  return {
    x,
    y,
    w: Math.max(0, w - HEADER_CONTROLS_W - HEADER_CONTROLS_GAP),
    h: HEADER_H,
  };
}

/** Whether a point in node space is inside a node's title area. */
export function hitNodeTitle(node, x, y) {
  const rect = nodeTitleRect(node);
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * Full port geometry for a node. `inputs[i]` / `outputs[i]` are the {x, y} centres of the input /
 * output ports — input i and output i share row i, so they sit at the same height.
 */
/** Chip size for the expandable-input "+ / −" buttons, matching the title-bar control chips. */
export const IO_CHIP_W = 14;
export const IO_CHIP_H = 12;

/**
 * Hit/draw rectangles for a node's expandable-input controls. They occupy the grid row directly
 * below the last socket row (the row nodeMinHeight reserved via `extraRows`), left-aligned with the
 * input labels so they read as "…and one more pin here".
 *
 * Shared by the renderer and the event handler so the drawn chip and its click target are the same
 * rectangle by construction.
 */
export function dynamicInputButtons(node, inCount, outCount, previewH) {
  const cy = rowCenterY(node, previewH, socketRowCount(inCount, outCount));
  const top = Math.round(cy - IO_CHIP_H / 2);
  const left = (node.x || 0) + EDGE_INSET - 5;
  return {
    add: { x: left, y: top, w: IO_CHIP_W, h: IO_CHIP_H },
    remove: { x: left + IO_CHIP_W + 4, y: top, w: IO_CHIP_W, h: IO_CHIP_H },
    centerY: cy,
  };
}

/** Whether a point is inside one of the rectangles dynamicInputButtons returns. */
export function hitChip(chip, x, y) {
  return !!chip && x >= chip.x && x <= chip.x + chip.w && y >= chip.y && y <= chip.y + chip.h;
}

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
