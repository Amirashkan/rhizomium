// src/utils/SeedGraphBuilder.js
import { makeNode, NodeDefs } from "../data/NodeDefs.js";

export class SeedGraphBuilder {
  static createSeedGraph(graph) {
    graph.nodes.length = 0;
    graph.connections.length = 0;

    // A compute-domain showcase for the GPU Gradient node's new input: procedural
    // noise drives the gradient's color stops (what Color Ramp used to do), fully on
    // the GPU so editing the colours updates live.
    const noise = makeNode("ComputeNoise", 240, 160);
    noise.params.scale = 5.0;
    noise.params.octaves = 5;
    noise.params.speed = 0.05;
    noise.params.colorize = false; // grayscale value field to drive the gradient

    const gradient = makeNode("ComputeGradient", 620, 160);
    gradient.inputs[0] = noise.id;
    gradient.params.type = "Linear";
    gradient.params.colorMode = "Gradient";
    gradient.params.interpolation = "Smooth";
    gradient.params.inputMix = 1.0; // let the noise fully drive the ramp
    gradient.params.colorStops = [
      { position: 0.0, color: [0.08, 0.05, 0.15, 1] },
      { position: 0.35, color: [0.16, 0.22, 0.45, 1] },
      { position: 0.65, color: [0.15, 0.45, 0.55, 1] },
      { position: 1.0, color: [0.98, 0.78, 0.45, 1] },
    ];

    const output = makeNode("OutputFinal", 980, 160);
    output.inputs[0] = gradient.id;

    // Add nodes to graph
    const allNodes = [noise, gradient, output];
    allNodes.forEach((node) => graph.add(node));

    // Create connections array from inputs
    for (const node of graph.nodes) {
      const inputs = NodeDefs[node.kind]?.pinsIn || [];
      for (let i = 0; i < inputs.length; i++) {
        const sourceId = node.inputs[i];
        if (sourceId) {
          graph.connections.push({
            from: { nodeId: sourceId, pin: 0 },
            to: { nodeId: node.id, pin: i },
          });
        }
      }
    }
  }
}
