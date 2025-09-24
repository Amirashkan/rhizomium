import { Node } from "./Node.js";

export class AddNode extends Node {
  constructor(x, y) {
    super(x, y);
    this.label = "Add";
    this.inputPins = [null, null];
    this.outputPins = [null];
  }

  getGLSL(id) {
    const a = this.inputs?.[0];
    const b = this.inputs?.[1];

    if (a == null || b == null || a === id || b === id) return "";

    return `let node${id} = node${a} + node${b};`;
  }
}
