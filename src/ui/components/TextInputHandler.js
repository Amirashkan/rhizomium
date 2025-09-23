// src/ui/components/TextInputHandler.js
export class TextInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
    this.dragState = new Map(); // Track drag state for batching undo operations
  }

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
    input.dataset.param = param.name;
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
      input.addEventListener("keydown", (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation(); // Prevent editor from receiving this keydown
    }
  });
    let inputTimer = null;
    let lastValue = input.value;

    // Capture initial value when focus starts
    input.addEventListener("focus", (e) => {
      lastValue = input.value;
    });

    // Real-time updates on input (but debounced for undo)
    input.addEventListener("input", (e) => {
      e.stopPropagation();
      
      // Update immediately for visual feedback
      valueManager.updateNodeParameter(node, param.name, input.value.trim(), onChange);

      // Clear previous timer
      if (inputTimer) {
        clearTimeout(inputTimer);
      }

      // Debounce undo recording for rapid typing
      inputTimer = setTimeout(() => {
        // The undo recording is already handled in updateNodeParameter
        inputTimer = null;
      }, 500); // Wait 500ms after last keystroke
    });

    // When losing focus, ensure final undo state is recorded
    input.addEventListener("blur", (e) => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }
      
      // Final update to make sure everything is in sync
      if (input.value !== lastValue) {
        valueManager.updateNodeParameter(node, param.name, input.value.trim(), onChange);
      }
    });

    input.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Handle Enter key
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        input.blur(); // This will trigger the blur event and finalize any pending updates
        e.stopPropagation();
      }
    });
  }

  _addNumericDragSupport(input, param, node, valueManager, onChange) {
    if (param.type !== "float") return;

    let isDragging = false;
    let startValue = 0;
    let startY = 0;
    let dragStartValue = null;

    input.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.shiftKey) {
        // Shift+click for drag mode
        isDragging = true;
        startValue = parseFloat(input.value) || 0;
        dragStartValue = startValue; // Store the value when drag started
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
          
          // Update immediately but don't record undo yet (we'll do it on mouse up)
          const oldUndoManager = valueManager.undoManager;
          valueManager.undoManager = null; // Temporarily disable undo recording
          valueManager.updateNodeParameter(node, param.name, input.value, onChange);
          valueManager.undoManager = oldUndoManager; // Restore undo manager
          
          e.preventDefault();
        };

        const onMouseUp = () => {
          if (isDragging && dragStartValue !== null) {
            // Record single undo action for the entire drag operation
            const finalValue = parseFloat(input.value) || 0;
            if (this.undoManager && dragStartValue !== finalValue) {
              this.undoManager.recordParameterChange(node.id, param.name, dragStartValue, finalValue);
            }
          }
          
          isDragging = false;
          dragStartValue = null;
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