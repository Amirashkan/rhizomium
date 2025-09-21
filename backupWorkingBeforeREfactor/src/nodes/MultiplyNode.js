export class MultiplyNode {
  constructor(x, y) {
    this.label = "Multiply";
    this.x = x;
    this.y = y;
    this.inputPins = [null, null];
    this.outputPins = [null];
  }

  getInputPinPosition(i) {
    return [this.x * 100 + 300, this.y * 100 + 300 + i * 15];
  }

  getOutputPinPosition(i) {
    return [this.x * 100 + 300 + 80, this.y * 100 + 300 + i * 15];
  }

  getGLSL(id) {
    const a = this.inputs?.[0];
    const b = this.inputs?.[1];

    if (a == null || b == null || a === id || b === id) return "";

    return `let node${id} = node${a} * node${b};`;
  }
}
