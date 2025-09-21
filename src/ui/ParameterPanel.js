// src/ui/ParameterPanel.js
import { NodeDefs } from "../data/NodeDefs.js";
import { FileInputHandler } from "./components/FileInputHandler.js";
import { SelectInputHandler } from "./components/SelectInputHandler.js";
import { TextInputHandler } from "./components/TextInputHandler.js";
import { ParameterValueManager } from "./components/ParameterValueManager.js";

export class ParameterPanel {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.panel = null;
    this.currentNode = null;
    
    // Initialize input handlers
    this.fileHandler = new FileInputHandler(this.onChange);
    this.selectHandler = new SelectInputHandler();
    this.textHandler = new TextInputHandler();
    this.valueManager = new ParameterValueManager(this.graph);
  }

  hide() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.currentNode = null;
    }
  }

  contains(element) {
    return this.panel && this.panel.contains(element);
  }

  show(node, clientX, clientY) {
    console.log("ParameterPanel.show called for:", node.kind, "at", clientX, clientY);

    this.hide();
    const def = NodeDefs[node.kind];
    console.log("NodeDef found:", def);

    if (!def?.params || def.params.length === 0) {
      console.log("No parameters for this node type");
      return;
    }

    console.log("Creating panel with", def.params.length, "parameters");

    this.panel = this._createPanel(clientX, clientY);
    this._addHeader(def);
    this._addParameters(def, node);
    this._addCloseButton();

    document.body.appendChild(this.panel);
    this.currentNode = node;

    this._focusFirstInput();
  }

  _createPanel(clientX, clientY) {
    const panel = document.createElement("div");
    panel.className = "param-panel";
    panel.style.position = "fixed";
    panel.style.left = clientX + 20 + "px";
    panel.style.top = clientY + "px";
    panel.style.zIndex = "1000";

    // Prevent event bubbling
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("mousedown", (e) => e.stopPropagation());

    return panel;
  }

  _addHeader(def) {
    const header = document.createElement("div");
    header.className = "param-header";
    header.textContent = `${def.label} Parameters`;
    this.panel.appendChild(header);
  }

  _addParameters(def, node) {
    for (const param of def.params) {
      const paramDiv = this._createParameterInput(param, node);
      this.panel.appendChild(paramDiv);
    }
  }

  _addCloseButton() {
    const buttons = document.createElement("div");
    buttons.className = "param-buttons";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });

    buttons.appendChild(closeBtn);
    this.panel.appendChild(buttons);
  }

  _focusFirstInput() {
    setTimeout(() => {
      const firstInput = this.panel.querySelector(".param-input");
      if (firstInput) {
        firstInput.focus();
      }
    }, 10);
  }

  _createParameterInput(param, node) {
    const div = document.createElement("div");
    div.className = "param-input-group";

    const label = document.createElement("label");
    label.textContent = param.label;
    div.appendChild(label);

    // Delegate to appropriate handler
    switch (param.type) {
      case "file":
        return this.fileHandler.create(param, node, div, label, this.panel, this.currentNode);
      case "select":
        return this.selectHandler.create(param, node, div, label, this.valueManager, this.onChange);
      default:
        return this.textHandler.create(param, node, div, label, this.valueManager, this.onChange);
    }
  }
}