// The socket-row grid: a node is laid out top-down as header → optional preview band → fixed-height
// rows. Inputs fill the left slots top-down, outputs fill the right slots top-down, and input i and
// output i share row i — so a port is always centred on its row and on the node edge, and
// port ↔ label ↔ value can never drift apart.

import { describe, it, expect } from 'vitest';
import {
  HEADER_H,
  ROW_H,
  ROW_GRID_TOP_GAP,
  PREVIEW_TOP_GAP,
  EDGE_INSET,
  rowsTop,
  rowCenterY,
  socketRowCount,
  nodeMinHeight,
  nodePinPositions,
} from '../src/core/pinLayout.js';

describe('socket-row grid layout', () => {
  it('starts the row grid just below the header when there is no preview', () => {
    expect(rowsTop({ y: 0 }, 0)).toBe(HEADER_H + ROW_GRID_TOP_GAP);
  });

  it('pushes the row grid below the preview band when one is present', () => {
    const previewH = 96;
    expect(rowsTop({ y: 0 }, previewH)).toBe(
      HEADER_H + PREVIEW_TOP_GAP + previewH + ROW_GRID_TOP_GAP,
    );
  });

  it('centres each row on the fixed grid step, top-down (never floating to node centre)', () => {
    const top = rowsTop({ y: 0 }, 0);
    expect(rowCenterY({ y: 0 }, 0, 0)).toBe(top + ROW_H / 2);
    expect(rowCenterY({ y: 0 }, 0, 1)).toBe(top + ROW_H / 2 + ROW_H);
    expect(rowCenterY({ y: 0 }, 0, 2)).toBe(top + ROW_H / 2 + 2 * ROW_H);
  });

  it('respects the node origin offset', () => {
    expect(rowCenterY({ y: 200 }, 0, 0)).toBe(200 + HEADER_H + ROW_GRID_TOP_GAP + ROW_H / 2);
  });

  it('renders max(inputs, outputs) rows, at least one', () => {
    expect(socketRowCount(0, 1)).toBe(1); // Vec3: 0 in / 1 out
    expect(socketRowCount(1, 1)).toBe(1); // Output: 1 in / 1 out
    expect(socketRowCount(3, 1)).toBe(3); // Color Mix: 3 in / 1 out
    expect(socketRowCount(0, 0)).toBe(1);
  });

  it('sizes node height to fit header, preview and every row', () => {
    // 3 inputs, 1 output, no preview -> 3 rows.
    expect(nodeMinHeight({ y: 0 }, 3, 1, 0)).toBe(
      HEADER_H + ROW_GRID_TOP_GAP + 3 * ROW_H + /* BOTTOM_PAD */ 8,
    );
  });

  it('puts input i and output i on the same row, on opposite edges', () => {
    const node = { x: 10, y: 0, w: 200 };
    const { inputs, outputs } = nodePinPositions(node, 3, 1, 0);
    // Same height for the shared row 0.
    expect(inputs[0].y).toBe(outputs[0].y);
    // Ports sit on the node edges (centre inset by EDGE_INSET).
    expect(inputs[0].x).toBe(node.x + EDGE_INSET);
    expect(outputs[0].x).toBe(node.x + node.w - EDGE_INSET);
    // Inputs continue top-down for rows the single output doesn't fill.
    expect(inputs[1].y).toBe(rowCenterY(node, 0, 1));
    expect(inputs[2].y).toBe(rowCenterY(node, 0, 2));
    expect(outputs).toHaveLength(1);
  });

  it('keeps a single output on the first row instead of floating to the node centre', () => {
    const node = { x: 0, y: 0, w: 160 };
    const { outputs } = nodePinPositions(node, 0, 1, 0);
    expect(outputs[0].y).toBe(rowsTop(node, 0) + ROW_H / 2);
  });
});
