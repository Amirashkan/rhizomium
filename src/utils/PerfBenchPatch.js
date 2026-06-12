// src/utils/PerfBenchPatch.js
//
// Reproducible benchmark patch generator for performance work.
//
// Builds deterministic graphs directly into the live editor so canvas and
// GPU costs can be measured against known node counts instead of ad-hoc
// hand-built patches.
//
// Usage from the browser console:
//   window.perfBench.mixedGraph(300)  // 300 cheap nodes in chained columns
//   window.perfBench.blurTower(6)     // ComputeNoise -> 6x ComputeBlur -> OutputFinal
//   window.perfBench.clear()
//
// Combine with window.perfReport() to capture before/after numbers.

import { makeNode } from "../data/NodeDefs.js";

const NODE_SPACING_X = 240;
const NODE_SPACING_Y = 140;
const CHAIN_LENGTH = 8; // nodes per column in mixedGraph

function getEditor() {
  const editor = typeof window !== "undefined" ? window.editor : null;
  if (!editor || !editor.graph) {
    throw new Error("[PerfBench] window.editor with a graph is required");
  }
  return editor;
}

function addNode(graph, kind, x, y) {
  const node = makeNode(kind, x, y);
  if (typeof graph.add === "function") {
    graph.add(node);
  } else {
    graph.nodes.push(node);
    graph.nodeMap?.set(node.id, node);
  }
  return node;
}

function connect(graph, fromNode, toNode, toPin = 0, fromPin = 0) {
  graph.connections.push({
    from: { nodeId: fromNode.id, pin: fromPin },
    to: { nodeId: toNode.id, pin: toPin },
  });
  if (!toNode.inputs) toNode.inputs = [];
  toNode.inputs[toPin] = fromNode.id;
}

function finalize(editor, label) {
  graphChanged(editor, label);
  console.log(
    `[PerfBench] ${label}: ${editor.graph.nodes.length} nodes, ` +
      `${editor.graph.connections.length} connections. ` +
      `Interact for ~10s, then call window.perfReport().`
  );
}

function graphChanged(editor, label) {
  editor.graph.markExecutionOrderDirty?.();
  try {
    editor.onChange?.(label);
  } catch (err) {
    console.warn("[PerfBench] onChange failed:", err);
  }
  try {
    window.rebuild?.();
  } catch (err) {
    console.warn("[PerfBench] shader rebuild failed:", err);
  }
  editor.markDirty?.(label, "full");
  editor.safeDraw?.(label);
}

export const perfBench = {
  /**
   * Build `count` cheap scalar nodes as chained columns
   * (ConstFloat -> Sin -> Sin -> ...). Pure canvas-side load: measures
   * node/wire rendering cost without GPU involvement.
   */
  mixedGraph(count = 300) {
    const editor = getEditor();
    const graph = editor.graph;
    graph.clear?.();

    let made = 0;
    let column = 0;
    while (made < count) {
      const x = 100 + column * NODE_SPACING_X;
      let prev = addNode(graph, "ConstFloat", x, 100);
      made++;
      for (let row = 1; row < CHAIN_LENGTH && made < count; row++) {
        const node = addNode(graph, "Sin", x, 100 + row * NODE_SPACING_Y);
        connect(graph, prev, node);
        prev = node;
        made++;
      }
      column++;
    }

    finalize(editor, "perf-bench-mixed");
    return { nodes: graph.nodes.length, connections: graph.connections.length };
  },

  /**
   * Build a GPU-heavy chain: ComputeNoise -> N x ComputeBlur -> OutputFinal.
   * ComputeNoise is time-dependent, so today the whole blur chain
   * re-dispatches every frame — this is the Phase 4 reproduction case.
   */
  blurTower(blurCount = 6) {
    const editor = getEditor();
    const graph = editor.graph;
    graph.clear?.();

    let prev = addNode(graph, "ComputeNoise", 100, 200);
    for (let i = 0; i < blurCount; i++) {
      const blur = addNode(graph, "ComputeBlur", 100 + (i + 1) * NODE_SPACING_X, 200);
      connect(graph, prev, blur);
      prev = blur;
    }
    const output = addNode(
      graph,
      "OutputFinal",
      100 + (blurCount + 1) * NODE_SPACING_X,
      200
    );
    connect(graph, prev, output);

    finalize(editor, "perf-bench-blur-tower");
    return { nodes: graph.nodes.length, connections: graph.connections.length };
  },

  clear() {
    const editor = getEditor();
    editor.graph.clear?.();
    graphChanged(editor, "perf-bench-clear");
  },
};

export function installPerfBench() {
  if (typeof window !== "undefined") {
    window.perfBench = perfBench;
  }
  return perfBench;
}
