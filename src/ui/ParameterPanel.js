// src/ui/ParameterPanel.js
import { NodeDefs } from "../data/NodeDefs.js";
import { FileInputHandler } from "./components/FileInputHandler.js";
import { SelectInputHandler } from "./components/SelectInputHandler.js";
import { TextInputHandler } from "./components/TextInputHandler.js";
import { ParameterValueManager } from "./components/ParameterValueManager.js";
import { ParameterEvents } from "../utils/ParameterEventSystem.js";

export class ParameterPanel {
  constructor(graph, onChange, undoManager = null, eventSystem = null) {
    this.graph = graph;
    this.onChange = onChange;
    this.undoManager = undoManager;
    this.eventSystem = eventSystem;
    this.panel = null;
    this.currentNode = null;
    this.eventUnsubscribers = [];
    
    // Create value manager with undo and event support
    this.valueManager = new ParameterValueManager(graph, undoManager, eventSystem);
    
    // Create input handlers with undo support
    this.textHandler = new TextInputHandler(undoManager);
    this.selectHandler = new SelectInputHandler(undoManager);
    this.fileHandler = new FileInputHandler(this.onChange.bind(this));

    // Subscribe to parameter events
    this.setupEventListeners();
  }

  setupEventListeners() {
    if (!this.eventSystem) return;

    // Listen for parameter changes from undo/redo
    const unsubscribeUndo = this.eventSystem.on(ParameterEvents.PARAMETER_UNDONE, (data) => {
      this.onParameterChanged(data);
    });

    const unsubscribeRedo = this.eventSystem.on(ParameterEvents.PARAMETER_REDONE, (data) => {
      this.onParameterChanged(data);
    });

    // Store unsubscribers for cleanup
    this.eventUnsubscribers.push(unsubscribeUndo, unsubscribeRedo);
  }

  onParameterChanged(data) {
    // Only update if the panel is open for this node
    if (!this.panel || !this.currentNode || this.currentNode.id !== data.node.id) {
      return;
    }

    console.log('Parameter panel updating for parameter change:', data);

    // Find and update the input element for this parameter
    const input = this.panel.querySelector(`[data-param="${data.parameterName}"]`);
    if (input) {
      input.value = data.newValue;
      console.log('Updated parameter panel input for', data.parameterName, '=', data.newValue);
      
      // Trigger visual feedback
      input.style.backgroundColor = data.source === 'undo' ? '#2a4a2a' : '#4a2a2a';
      setTimeout(() => {
        input.style.backgroundColor = '';
      }, 200);
    } else {
      console.warn('Could not find input element for parameter:', data.parameterName);
    }
  }

  hide() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.currentNode = null;
    }
  }

  // Cleanup when panel is destroyed
  destroy() {
    this.hide();
    
    // Unsubscribe from all events
    this.eventUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.eventUnsubscribers = [];
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

    // Use the handlers with undo support
    switch (param.type) {
      case "file":
        return this.fileHandler.create(param, node, div, label, this.panel, this.currentNode);
      case "select":
      case "enum":
        return this.selectHandler.create(param, node, div, label, this.valueManager, this.onChange);
      case "float":
      case "text":
      case "expression":
      default:
        return this.textHandler.create(param, node, div, label, this.valueManager, this.onChange);
    }
  }
}