// src/ui/ParameterPanel.js - ErrorHandler-enhanced
import { NodeDefs } from "../data/NodeDefs.js";
import { FileInputHandler } from "./components/FileInputHandler.js";
import { SelectInputHandler } from "./components/SelectInputHandler.js";
import { TextInputHandler } from "./components/TextInputHandler.js";
import { ParameterValueManager } from "./components/ParameterValueManager.js";
import { ParameterEvents } from "../utils/ParameterEventSystem.js";

export class ParameterPanel {
  constructor(graph, onChange, undoManager = null, eventSystem = null) {
    try {
      this.graph = graph;
      this.onChange = onChange;
      this.undoManager = undoManager;
      this.eventSystem = eventSystem;
      this.panel = null;
      this.currentNode = null;
      this.eventUnsubscribers = [];

      this.valueManager = new ParameterValueManager(graph, undoManager, eventSystem);
      this.textHandler = new TextInputHandler(undoManager);
      this.selectHandler = new SelectInputHandler(undoManager);
      this.fileHandler = new FileInputHandler(this.onChange.bind(this));

      this.setupEventListeners();
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-constructor" });
    }
  }

  setupEventListeners() {
    try {
      if (!this.eventSystem) return;
      const unsubscribeUndo = this.eventSystem.on(ParameterEvents.PARAMETER_UNDONE, (data) => {
        try { this.onParameterChanged(data); } 
        catch(e) { window.errorHandler?.handleError(e, { component: 'parameter-panel-undo-callback', data }); }
      });
      const unsubscribeRedo = this.eventSystem.on(ParameterEvents.PARAMETER_REDONE, (data) => {
        try { this.onParameterChanged(data); } 
        catch(e) { window.errorHandler?.handleError(e, { component: 'parameter-panel-redo-callback', data }); }
      });
      this.eventUnsubscribers.push(unsubscribeUndo, unsubscribeRedo);
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-setup-events" });
    }
  }

  onParameterChanged(data) {
    try {
      if (!this.panel || !this.currentNode || this.currentNode.id !== data.node.id) return;
      const input = this.panel.querySelector(`[data-param="${data.parameterName}"]`);
      if (input) {
        input.value = data.newValue;
        input.style.backgroundColor = data.source === 'undo' ? '#2a4a2a' : '#4a2a2a';
        setTimeout(() => { input.style.backgroundColor = ''; }, 200);
      } else {
        console.warn('Parameter input not found:', data.parameterName);
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { component: 'parameter-panel-on-change', data });
    }
  }

  hide() {
    try {
      if (this.panel) {
        this.panel.remove();
        this.panel = null;
        this.currentNode = null;
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-hide" });
    }
  }

  destroy() {
    try {
      this.hide();
      this.eventUnsubscribers.forEach(unsub => {
        try { unsub(); } 
        catch(e) { window.errorHandler?.handleError(e, { component: 'parameter-panel-unsubscribe' }); }
      });
      this.eventUnsubscribers = [];
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-destroy" });
    }
  }

  contains(element) {
    try { return this.panel && this.panel.contains(element); }
    catch (error) { window.errorHandler?.handleError(error, { component: "parameter-panel-contains" }); return false; }
  }

  show(node, clientX, clientY) {
    try {
      this.hide();
      const def = NodeDefs[node.kind];
      if (!def?.params || def.params.length === 0) return;

      this.panel = this._createPanel(clientX, clientY);
      this._addHeader(def);
      this._addParameters(def, node);
      this._addCloseButton();
      document.body.appendChild(this.panel);
      this.currentNode = node;
      this._focusFirstInput();
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-show", node, clientX, clientY });
    }
  }

  _createPanel(clientX, clientY) {
    try {
      const panel = document.createElement("div");
      panel.className = "param-panel";
      panel.style.position = "fixed";
      panel.style.left = clientX + 20 + "px";
      panel.style.top = clientY + "px";
      panel.style.zIndex = "1000";
      panel.addEventListener("click", (e) => e.stopPropagation());
      panel.addEventListener("mousedown", (e) => e.stopPropagation());
      return panel;
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-create" });
      return null;
    }
  }

  _addHeader(def) {
    try {
      const header = document.createElement("div");
      header.className = "param-header";
      header.textContent = `${def.label} Parameters`;
      this.panel.appendChild(header);
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-add-header", def });
    }
  }

  _addParameters(def, node) {
    try {
      for (const param of def.params) {
        try {
          const paramDiv = this._createParameterInput(param, node);
          this.panel.appendChild(paramDiv);
        } catch (e) {
          window.errorHandler?.handleError(e, { component: 'parameter-panel-add-param', param, node });
        }
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-add-parameters", def, node });
    }
  }

  _addCloseButton() {
    try {
      const buttons = document.createElement("div");
      buttons.className = "param-buttons";
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("click", (e) => { e.stopPropagation(); this.hide(); });
      buttons.appendChild(closeBtn);
      this.panel.appendChild(buttons);
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-add-close-button" });
    }
  }

  _focusFirstInput() {
    try {
      setTimeout(() => {
        try {
          const firstInput = this.panel.querySelector(".param-input");
          if (firstInput) firstInput.focus();
        } catch(e) { window.errorHandler?.handleError(e, { component:'parameter-panel-focus-input' }); }
      }, 10);
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-focus-timeout" });
    }
  }

  _createParameterInput(param, node) {
    try {
      const div = document.createElement("div");
      div.className = "param-input-group";
      const label = document.createElement("label");
      label.textContent = param.label;
      div.appendChild(label);

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
    } catch (error) {
      window.errorHandler?.handleError(error, { component: "parameter-panel-create-input", param, node });
      return document.createElement("div");
    }
  }
}
