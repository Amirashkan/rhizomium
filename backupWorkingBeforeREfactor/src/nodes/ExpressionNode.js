import { Node } from "./Node.js";

export class ExpressionNode extends Node {
  constructor(x, y, expression = "a + b") {
    super(x, y);
    this.label = "Expr";
    this.inputPins = [null, null]; // فرضاً 'a' و 'b'
    this.outputPins = [null];
    this.expression = expression;
  }

  getGLSL(id) {
    const a = `node${this.inputs?.[0] ?? 0}`;
    const b = `node${this.inputs?.[1] ?? 1}`;
    const expr = this.expression.replace(/a/g, a).replace(/b/g, b);
    return `let node${id} = ${expr};`;
  }
}
