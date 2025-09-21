import { Node } from "./Node.js";

let circlePos = { x: 0.0, y: 0.0 };

export class CircleFieldNode extends Node {
  constructor(x, y) {
    super(x, y);
    this.label = "Circle";
    this.radius = 0.3;
    this.input = null;
  }

  getPreviewValue() {
    return `r=${this.radius.toFixed(2)} @ (${circlePos.x.toFixed(2)}, ${circlePos.y.toFixed(2)})`;
  }

  getGLSL(id) {
    const cx = circlePos.x.toFixed(3);
    const cy = circlePos.y.toFixed(3);
    const inputExpr = this.input !== null ? `node${this.input}` : "in.uv";
    const r = this.radius;
    const edge0 = r - 0.02;
    const edge1 = r + 0.02;
    return `
      let dist${id} = distance(${inputExpr}, vec2<f32>(${cx}, ${cy}));
      let node${id} = 1.0 - smoothstep(${edge0}, ${edge1}, dist${id});
    `;
  }
}
