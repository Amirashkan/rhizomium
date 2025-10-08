export class Connection {
  constructor(fromNode, fromPin, toNode, toPin) {
    this.fromNode = fromNode;
    this.fromPin = fromPin;
    this.toNode = toNode;
    this.toPin = toPin;
  }

  draw(ctx) {
    const [x1, y1] = this.fromNode.getOutputPinPosition(this.fromPin);
    const [x2, y2] = this.toNode.getInputPinPosition(this.toPin);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1 + 40, y1, x2 - 40, y2, x2, y2);
    ctx.strokeStyle = "gray";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
