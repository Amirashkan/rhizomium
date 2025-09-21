import { Connection } from "./Connection.js";

export class Canvas {
  constructor() {
    this.nodes = [];
    this.connections = [];
    this.isConnecting = false;
    this.fromNodeIndex = null;
    this.fromOutputX = 0;
    this.fromOutputY = 0;
    this.fromInputMode = false;
    this.draggingNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
  }

  addNode(node) {
    this.nodes.push(node);
  }

  getNode(index) {
    return this.nodes[index] || null;
  }

  draw(ctx) {
    // draw connections
    for (let conn of this.connections) {
      conn.draw(ctx);
      if (this.isConnecting && this.fromNodeIndex !== null) {
        const fromNode = this.getNode(this.fromNodeIndex);
        if (!fromNode) return;

        const [x1, y1] = fromNode.getOutputPinPosition(this.fromPinIndex);
        const x2 = this.mouseX;
        const y2 = this.mouseY;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + 40, y1, x2 - 40, y2, x2, y2);

        let color = "gray";
        const label = fromNode.label;

        if (label === "ConstFloat") color = "#1f77b4";
        else if (label === "Multiply") color = "#2ca02c";
        else if (label === "Add") color = "#ff7f0e";
        else if (label === "Expression") color = "#9467bd";
        else if (label === "UV") color = "#d62728";
        else if (label === "Circle") color = "#17becf";

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // draw nodes
    for (let node of this.nodes) {
      ctx.fillStyle = "white";
      ctx.fillRect(node.x * 100 + 300, node.y * 100 + 300, 80, 40);
      ctx.fillStyle = "black";
      ctx.fillText(node.label, node.x * 100 + 310, node.y * 100 + 320);
      if (node.outputPins[0] !== undefined) {
        ctx.fillStyle = "gray";
        ctx.fillText(
          `out: ${formatVal(node.outputPins[0])}`,
          node.x * 100 + 310,
          node.y * 100 + 335,
        );
        if (node.label === "ConstFloat") {
          ctx.fillStyle = "black";
          ctx.fillText(
            `value: ${node.value.toFixed(3)}`,
            node.x * 100 + 310,
            node.y * 100 + 330,
          );
        }
      }

      function formatVal(v) {
        if (v === null || v === undefined) return "null";
        if (Array.isArray(v))
          return v.map((x) => (isFinite(x) ? x.toFixed(2) : "NaN")).join(", ");
        return isFinite(v) ? v.toFixed(3) : "NaN";
      }

      // draw input pins
      node.inputPins.forEach((_, i) => {
        const [x, y] = node.getInputPinPosition(i);
        ctx.fillStyle = "blue";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // draw output pins
      node.outputPins.forEach((_, i) => {
        const [x, y] = node.getOutputPinPosition(i);
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  findOutputPinHit(mouseX, mouseY) {
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      for (let j = 0; j < node.outputPins.length; j++) {
        const [x, y] = node.getOutputPinPosition(j);
        const dx = mouseX - x;
        const dy = mouseY - y;
        if (dx * dx + dy * dy < 100) {
          return { nodeIndex: i, pinIndex: j };
        }
      }
    }
    return null;
  }
  findInputPinHit(mouseX, mouseY) {
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      for (let pinIndex = 0; pinIndex < node.inputPins.length; pinIndex++) {
        const [x, y] = node.getInputPinPosition(pinIndex);
        const dx = mouseX - x;
        const dy = mouseY - y;

        console.log(
          `🎯 Checking input pin ${pinIndex} of node ${i} at (${x.toFixed(1)}, ${y.toFixed(1)}), mouse at (${mouseX.toFixed(1)}, ${mouseY.toFixed(1)})`,
        );

        if (dx * dx + dy * dy < 225) {
          return { nodeIndex: i, pinIndex };
        }
      }
    }
    return null;
  }

  handleMouseDown(x, y) {
    const hit = this.findOutputPinHit(x, y);
    if (hit) {
      this.isConnecting = true;
      this.fromNodeIndex = hit.nodeIndex;
      this.fromPinIndex = hit.pinIndex;
      this.mouseX = x;
      this.mouseY = y;
    }

    for (let node of this.nodes) {
      const nodeX = node.x * 100 + 300;
      const nodeY = node.y * 100 + 300;

      if (x >= nodeX && x <= nodeX + 80 && y >= nodeY && y <= nodeY + 40) {
        if (node.label === "ConstFloat" && y > nodeY + 25) {
          this.draggingNode = null;
          const newVal = prompt("Enter new float value:", node.value);
          if (!isNaN(parseFloat(newVal))) {
            node.value = parseFloat(newVal);
          }
          return;
        }

        this.draggingNode = node;
        this.dragOffsetX = x - nodeX;
        this.dragOffsetY = y - nodeY;

        return; // نود پیدا شد، بقیه‌ی بررسی لازم نیست
      }
    }
  }

  handleMouseUp(x, y) {
    if (this.isConnecting) {
      const target = this.findInputPinHit(x, y);

      if (target) {
        const fromNode = this.getNode(this.fromNodeIndex);
        const toNode = this.getNode(target.nodeIndex);

        this.connections.push(
          new Connection(fromNode, this.fromPinIndex, toNode, target.pinIndex),
        );

        console.log(
          "✅ CONNECTION CREATED:",
          fromNode.label,
          "→",
          toNode.label,
        );
      } else {
        console.log("❌ No input pin hit.");
      }
    }

    // همیشه اینا رو ریست کن
    this.draggingNode = null;
    this.isConnecting = false;
    this.fromNodeIndex = null;
  }

  handleMouseMove(x, y) {
    this.mouseX = x;
    this.mouseY = y;

    if (this.draggingNode) {
      const newX = x - this.dragOffsetX;
      const newY = y - this.dragOffsetY;

      this.draggingNode.x = (newX - 300) / 100;
      this.draggingNode.y = (newY - 300) / 100;
    }
  }

  updateMouseInteraction(mouseX, mouseY) {
    // برای تعامل بعداً اضافه می‌شه
  }
}
