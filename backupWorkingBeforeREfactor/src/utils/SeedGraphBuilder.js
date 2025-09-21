// src/utils/SeedGraphBuilder.js
import { makeNode, NodeDefs } from "../data/NodeDefs.js";

export class SeedGraphBuilder {
  static createSeedGraph(graph) {
    graph.nodes.length = 0;
    graph.connections.length = 0;

    // Create nodes
    const uv = makeNode("UV", 50, 50);
    const time = makeNode("Time", 60, 150);
    const radius = makeNode("ConstFloat", 260, 30);
    radius.value = 0.3;
    const epsilon = makeNode("ConstFloat", 260, 90);
    epsilon.value = 0.04;
    const expr = makeNode("Expr", 260, 150);
    expr.expr = "a + sin(u_time*0.8)*0.05";

    const circle = makeNode("CircleField", 480, 60);
    const multiply = makeNode("Multiply", 700, 60);
    const add = makeNode("Add", 920, 60);
    const saturate = makeNode("Saturate", 1140, 60);
    const output = makeNode("OutputFinal", 1360, 60);

    // Set up connections via inputs array
    circle.inputs[0] = radius.id;
    circle.inputs[1] = epsilon.id;
    multiply.inputs[0] = uv.id;
    multiply.inputs[1] = circle.id;
    expr.inputs[0] = circle.id;
    expr.inputs[1] = time.id;
    add.inputs[0] = multiply.id;
    add.inputs[1] = expr.id;
    saturate.inputs[0] = add.id;
    output.inputs[0] = saturate.id;

    // Add nodes to graph
    const allNodes = [
      uv,
      time,
      radius,
      epsilon,
      expr,
      circle,
      multiply,
      add,
      saturate,
      output,
    ];
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
