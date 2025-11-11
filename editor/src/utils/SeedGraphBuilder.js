// src/utils/SeedGraphBuilder.js
import { makeNode, NodeDefs } from "../data/NodeDefs.js";

export class SeedGraphBuilder {
  static createSeedGraph(graph) {
    graph.nodes.length = 0;
    graph.connections.length = 0;

    // Create nodes
    const uv = makeNode("UV", 80, 160);

    const tile = makeNode("TileAndOffset", 280, 120);
    tile.inputs[0] = uv.id;
    tile.params.tilingX = 3.5;
    tile.params.tilingY = 3.5;
    tile.params.offsetX = 0.1;
    tile.params.offsetY = -0.15;

    const fbm = makeNode("FBMNoise", 500, 60);
    fbm.inputs[0] = tile.id;
    fbm.params.scale = 4.0;
    fbm.params.octaves = 5;
    fbm.params.persistence = 0.55;
    fbm.params.lacunarity = 2.3;
    fbm.params.amplitude = 1.1;
    fbm.params.gain = 0.6;
    fbm.params.warp = 0.25;

    const voronoi = makeNode("VoronoiNoise", 500, 200);
    voronoi.inputs[0] = tile.id;
    voronoi.params.scale = 6.0;
    voronoi.params.randomness = 0.8;
    voronoi.params.smoothness = 0.35;
    voronoi.params.cellType = 1;
    voronoi.params.outputType = 0;

    const voronoiRemap = makeNode("Remap", 720, 200);
    voronoiRemap.inputs[0] = voronoi.id;
    voronoiRemap.params.inMin = 0.05;
    voronoiRemap.params.inMax = 0.6;
    voronoiRemap.params.outMin = 0.0;
    voronoiRemap.params.outMax = 1.0;
    voronoiRemap.params.clamp = true;

    const noiseMultiply = makeNode("Multiply", 940, 120);
    noiseMultiply.inputs[0] = fbm.id;
    noiseMultiply.inputs[1] = voronoiRemap.id;

    const noiseSaturate = makeNode("Saturate", 1160, 120);
    noiseSaturate.inputs[0] = noiseMultiply.id;

    const colorRamp = makeNode("ColorRamp", 1380, 120);
    colorRamp.inputs[0] = noiseSaturate.id;
    colorRamp.params.mode = "Smooth";
    colorRamp.params.stops = [
      { position: 0.0, color: [0.08, 0.05, 0.15, 1] },
      { position: 0.35, color: [0.16, 0.22, 0.45, 1] },
      { position: 0.65, color: [0.15, 0.45, 0.55, 1] },
      { position: 1.0, color: [0.98, 0.78, 0.45, 1] },
    ];

    const highlightColor = makeNode("ConstVec3", 1380, 280);
    highlightColor.params.x = 1.0;
    highlightColor.params.y = 0.93;
    highlightColor.params.z = 0.75;

    const gradient = makeNode("ConicGradient", 720, 320);
    gradient.inputs[0] = uv.id;
    gradient.params.centerX = 0.5;
    gradient.params.centerY = 0.5;
    gradient.params.startAngle = -1.0;
    gradient.params.endAngle = 5.28318;
    gradient.params.smoothness = 0.1;

    const gradientRemap = makeNode("Remap", 940, 320);
    gradientRemap.inputs[0] = gradient.id;
    gradientRemap.params.inMin = 0.1;
    gradientRemap.params.inMax = 0.75;
    gradientRemap.params.outMin = 0.0;
    gradientRemap.params.outMax = 1.0;
    gradientRemap.params.clamp = true;

    const colorMix = makeNode("ColorMix", 1600, 200);
    colorMix.inputs[0] = colorRamp.id;
    colorMix.inputs[1] = highlightColor.id;
    colorMix.inputs[2] = gradientRemap.id;
    colorMix.params.mode = "screen";

    const output = makeNode("OutputFinal", 1820, 200);
    output.inputs[0] = colorMix.id;

    // Add nodes to graph
    const allNodes = [
      uv,
      tile,
      fbm,
      voronoi,
      voronoiRemap,
      gradient,
      gradientRemap,
      noiseMultiply,
      noiseSaturate,
      colorRamp,
      highlightColor,
      colorMix,
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
