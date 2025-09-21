export class Node {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.label = "Node";
    this.inputPins = [];
    this.outputPins = [];
  }

  getInputPinPosition(index) {
    return [this.x * 100 + 300, this.y * 100 + 310 + index * 12];
  }

  getOutputPinPosition(index) {
    return [this.x * 100 + 380, this.y * 100 + 310 + index * 12];
  }

  getGLSL(id) {
    return "";
  }
}
