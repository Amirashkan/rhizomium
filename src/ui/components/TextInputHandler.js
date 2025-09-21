// src/ui/components/TextInputHandler.js
export class TextInputHandler {
  create(param, node, div, label, valueManager, onChange) {
    const input = this._createInputElement(param, node, valueManager);
    this._setupEventHandlers(input, param, node, valueManager, onChange);
    this._addNumericDragSupport(input, param, node, valueManager, onChange);
    
    div.appendChild(input);
    return div;
  }

  _createInputElement(param, node, valueManager) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "param-input";
    input.dataset.paramName = param.name;
    input.dataset.paramType = param.type;
    input.style.cssText = `
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

    this._setCurrentValue(input, param, node, valueManager);
    this._setPlaceholder(input, param);
    this._setConnectionState(input, param, node, valueManager);
    
    // Store reference for real-time updates
    input._paramName = param.name;
    input._node = node;

    return input;
  }

  _setCurrentValue(input, param, node, valueManager) {
    let currentValue = valueManager.getNodeParameterValue(node, param.name, param.default);
    input.value = String(currentValue);
  }

  _setPlaceholder(input, param) {
    input.placeholder = param.type === "expression" 
      ? "Enter expression..." 
      : `Default: ${param.default}`;
  }

  _setConnectionState(input, param, node, valueManager) {
    // Check if this parameter has a connected input
    const hasConnectedInput = valueManager.hasConnectedInput(node, param.name);
    if (hasConnectedInput) {
      input.style.backgroundColor = "#2a4a2a"; // Green tint to show it's connected
      input.title = "Connected to input - value reflects connected node";
    }
  }

  _setupEventHandlers(input, param, node, valueManager, onChange) {
    // Real-time updates on input
    input.addEventListener("input", (e) => {
      e.stopPropagation();
      valueManager.updateNodeParameter(node, param.name, input.value.trim(), onChange);
    });

    input.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  _addNumericDragSupport(input, param, node, valueManager, onChange) {
    if (param.type !== "float") return;

    let isDragging = false;
    let startValue = 0;
    let startY = 0;

    input.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.shiftKey) {
        // Shift+click for drag mode
        isDragging = true;
        startValue = parseFloat(input.value) || 0;
        startY = e.clientY;
        input.style.cursor = "ns-resize";
        e.preventDefault();
        e.stopPropagation();

        const onMouseMove = (e) => {
          if (!isDragging) return;
          const deltaY = startY - e.clientY; // Inverted: up = positive
          const sensitivity = e.ctrlKey ? 0.001 : e.altKey ? 0.1 : 0.01;
          const newValue = startValue + deltaY * sensitivity;
          input.value = newValue.toFixed(3);
          valueManager.updateNodeParameter(node, param.name, input.value, onChange);
          e.preventDefault();
        };

        const onMouseUp = () => {
          isDragging = false;
          input.style.cursor = "";
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }
    });

    // Add visual hint
    input.title = "Shift+drag to adjust value\nCtrl: fine precision, Alt: coarse precision";
  }
}