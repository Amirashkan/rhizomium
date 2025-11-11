// src/ui/components/SelectInputHandler.js - Updated for expression system integration

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
    select.setAttribute("data-param", param.name);
    select.setAttribute("data-param-type", param.type);
    
    select.style.cssText = `
      width: 100%;
      padding: 6px;
      margin: 4px 0;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 11px;
      box-sizing: border-box;
    `;
    
    return select;
  }

  _populateOptions(select, param) {
    // Add options from parameter definition
    if (param.options && Array.isArray(param.options)) {
      for (const option of param.options) {
        const value = typeof option === 'string' ? option : option?.value;
        if (value === undefined) {
          continue;
        }
        const rawLabel = typeof option === 'string'
          ? option
          : option?.label ?? option?.value ?? '';
        let displayLabel = rawLabel;
        if (typeof rawLabel === 'string' && rawLabel === rawLabel.toLowerCase()) {
          displayLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
        }
        const optionElement = document.createElement("option");
        optionElement.value = value;
        optionElement.textContent = displayLabel || value;
        select.appendChild(optionElement);
      }
    }
  }

  _setCurrentValue(select, param, node, valueManager) {
    try {
      // Use the expression-aware value manager to get current value
      let currentValue;
      if (valueManager && valueManager.getValue) {
        currentValue = valueManager.getValue(node, param.name);
      } else if (valueManager && valueManager.getNodeParameterValue) {
        currentValue = valueManager.getNodeParameterValue(node, param.name, param.default);
      } else {
        // Fallback to direct parameter access
        currentValue = node.params?.[param.name] ?? param.default;
      }

      // Ensure the value exists in options
      if (currentValue !== undefined && currentValue !== null) {
        const optionExists = Array.from(select.options).some(option => option.value === currentValue);
        if (optionExists) {
          select.value = currentValue;
        } else {

          if (param.default !== undefined) {
            select.value = param.default;
          }
        }
      }
    } catch (error) {

      if (param.default !== undefined) {
        select.value = param.default;
      }
    }
  }

  _setupEventHandlers(select, param, node, valueManager, onChange) {
    let previousValue = select.value;

    // Prevent keyboard events from bubbling to editor
    select.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });

    // Store initial value when focus starts
    select.addEventListener("focus", (e) => {
      previousValue = select.value;
    });

    select.addEventListener("change", (e) => {
      e.stopPropagation();

      const newValue = select.value;

      try {
        // Use the expression-aware value manager
        if (valueManager && valueManager.setValue) {
          valueManager.setValue(node, param.name, newValue);
        } else if (valueManager && valueManager.updateNodeParameter) {
          valueManager.updateNodeParameter(node, param.name, newValue, onChange);
        } else {
          // Fallback: direct parameter update
          if (!node.params) node.params = {};

          // Record for undo if available
          if (this.undoManager && previousValue !== newValue) {
            this.undoManager.recordParameterChange(node.id, param.name, previousValue, newValue);
          }

          node.params[param.name] = newValue;

          if (onChange) {
            onChange(`Parameter Change: ${param.name}`);
          }
        }

        previousValue = newValue;

      } catch (error) {

        // Revert to previous value on error
        select.value = previousValue;
      }
    });

    // Prevent click propagation
    select.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
}
