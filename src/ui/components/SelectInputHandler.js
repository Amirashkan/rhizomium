// src/ui/components/SelectInputHandler.js
export class SelectInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
  }

  create(param, node, div, label, valueManager, onChange) {
    const select = this._createSelectElement(param);
    this._populateOptions(select, param);
    this._setCurrentValue(select, param, node, valueManager);
    this._setupEventHandlers(select, param, node, valueManager, onChange);
    
    div.appendChild(select);
    return div;
  }

  _createSelectElement(param) {
    const select = document.createElement("select");
    select.className = "param-select";
    select.style.cssText = `
      width: 100%;
      padding: 6px;
      margin: 4px 0;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 11px;
    `;
    
    return select;
  }

  _populateOptions(select, param) {
    for (const option of param.options) {
      const optionElement = document.createElement("option");
      optionElement.value = option;
      optionElement.textContent = option;
      select.appendChild(optionElement);
    }
  }

  _setCurrentValue(select, param, node, valueManager) {
    const currentValue = valueManager.getNodeParameterValue(node, param.name, param.default);
    select.value = currentValue;
  }

  _setupEventHandlers(select, param, node, valueManager, onChange) {
    let previousValue = select.value;

    // Store initial value when focus starts
    select.addEventListener("focus", (e) => {
      previousValue = select.value;
    });

    select.addEventListener("change", (e) => {
      e.stopPropagation();
      
      // Record the change immediately since select changes are discrete
      valueManager.updateNodeParameter(node, param.name, select.value, onChange);
    });

    select.addEventListener("click", (e) => e.stopPropagation());
  }
}