export class ConstFloatNode {
  constructor(x, y, value = 1.0) {
    this.label = "ConstFloat";
    this.x = x;
    this.y = y;
    this.value = value;
    this.inputPins = []; // ورودی نداره
    this.outputPins = [null];
  }

  getInputPinPosition(i) {
    return null;
  }

  getOutputPinPosition(i) {
    return [this.x * 100 + 300 + 80, this.y * 100 + 300];
  }

  getGLSL(id) {
    return `let node${id} = ${this.value.toFixed(4)};`;
    console.log("Generating GLSL for ConstFloat", id, "value:", this.value);
  }
}
