import { Node } from "./Node.js";

export class UVNode extends Node {
  constructor(x, y) {
    super(x, y);
    this.label = "UV";
  }

  getGLSL(id) {
    return `let node${id} = in.uv;`;
  }
}
