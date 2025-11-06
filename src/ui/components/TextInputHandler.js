// src/ui/components/TextInputHandler.js
import { expressionSystem } from '../../utils/ParameterExpressionSystem.js';

export class TextInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
    this.expressionSystem = expressionSystem;
    this.dragState = new Map();
    // Performance optimization: throttle parameter updates during drag
    this._pendingUpdate = null;
  }
_isValidExpression(value) {
  if (!value.trim().startsWith('=')) return true;
  
  const expr = value.slice(1).trim();
  
  // Check for incomplete operators
  if (expr.endsWith('+') || expr.endsWith('-') || expr.endsWith('*') || expr.endsWith('/')) {
    return false;
  }
  
  // Check for basic syntax
  try {
    // Don't actually evaluate, just check if it could be valid
    if (expr.length === 0) return false;
    if (/^[\d\s+\-*/().a-zA-Z_]+$/.test(expr)) {
      return true; // Basic syntax check passed
    }
    return false;
  } catch (error) {
    return false;
  }
}
  create(param, node, div, label, valueManager, onChange) {
    const input = this._createInputElement(param, node, valueManager);
    this._setupEventHandlers(input, param, node, valueManager, onChange);
    this._addExpressionSupport(input, param, node, valueManager, onChange);
    this._addNumericDragSupport(input, param, node, valueManager, onChange);
    
    // Create container for input and expression helper
    const inputContainer = document.createElement("div");
    inputContainer.className = "param-input-container";
    inputContainer.style.cssText = `
      position: relative;
      display: flex;
      align-items: center;
      gap: 4px;
    `;
    
    inputContainer.appendChild(input);
    
    // Add expression helper button for eligible parameters
    if (this._canHaveExpressions(param)) {
      const helperBtn = this._createExpressionHelper(input, param, node, valueManager);
      inputContainer.appendChild(helperBtn);
    }
    
    div.appendChild(inputContainer);
    
    // Add expression result display
    const resultDiv = this._createExpressionResult(input, param, node);
    if (resultDiv) {
      div.appendChild(resultDiv);
    }
    
    return div;
  }

  _createInputElement(param, node, valueManager) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "param-input";
    input.dataset.param = param.name;
    input.dataset.paramType = param.type;
    input.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      margin: 2px 0;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 11px;
      box-sizing: border-box;
      font-family: 'Consolas', 'Monaco', monospace;
    `;

    this._setCurrentValue(input, param, node, valueManager);
    this._setPlaceholder(input, param);
    this._setConnectionState(input, param, node, valueManager);
    
    // Store references for updates
    input._paramName = param.name;
    input._node = node;

    return input;
  }

  _setCurrentValue(input, param, node, valueManager) {
    try {
      // Get the raw value (not evaluated) for display in the input field
      const currentValue = valueManager.getRawParameterValue(node, param.name, param.default ?? "");

      input.value = String(currentValue);
      
      // Update expression styling
      this._updateExpressionStyling(input, currentValue);
    } catch (error) {
      console.error('Error setting current value:', error);
      input.value = param.default ?? "";
    }
  }

  _setPlaceholder(input, param) {
    if (param.type === "expression") {
      input.placeholder = "=sin(x*2) + cos(y*3)";
    } else {
      input.placeholder = `${param.default ?? 'Enter value...'}`;
    }
  }

  _setConnectionState(input, param, node, valueManager) {
    try {
      const hasConnectedInput = valueManager.hasConnectedInput(node, param.name);
      if (hasConnectedInput) {
        input.style.backgroundColor = "#2a4a2a";
        input.style.borderColor = "#4a6a4a";
        input.title = "Connected to input - value reflects connected node";
        input.disabled = true;
      }
    } catch (error) {
      console.error('Error checking connection state:', error);
    }
  }

  _setupEventHandlers(input, param, node, valueManager, onChange) {
    let inputTimer = null;
    let lastValue = input.value;

    // Prevent editor keydown interference
    input.addEventListener("keydown", (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
      }
      
      if (e.key === "Enter") {
        input.blur();
        e.stopPropagation();
      }
    });

    // Capture initial value on focus
    input.addEventListener("focus", (e) => {
      lastValue = input.value;
    });

    // Real-time input handling
input.addEventListener("input", (e) => {
  e.stopPropagation();
  
  const newValue = input.value;
  
  // Update styling and validation
  this._updateExpressionStyling(input, newValue);
  this._updateExpressionValidation(input, newValue, node);
  
  // Clear any existing timer
  if (inputTimer) {
    clearTimeout(inputTimer);
  }
  
  // CRITICAL: Don't update parameters immediately if it's an incomplete expression
  const isIncompleteExpression = newValue.trim().startsWith('=') && 
    (newValue.trim().length <= 1 || newValue.includes('+') && !this._isValidExpression(newValue));
  
  if (!isIncompleteExpression) {
    // Update parameter immediately for non-expressions or complete expressions
    valueManager.updateNodeParameter(node, param.name, newValue, onChange);
  }

  // Debounce for final update (increased delay for expressions)
  const delay = newValue.trim().startsWith('=') ? 1000 : 500;
  inputTimer = setTimeout(() => {
    // Final update after user stops typing
    valueManager.updateNodeParameter(node, param.name, input.value.trim(), onChange);
    inputTimer = null;
  }, delay);
});

    // Final update on blur
    input.addEventListener("blur", (e) => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }
      
      if (input.value !== lastValue) {
        valueManager.updateNodeParameter(node, param.name, input.value.trim(), onChange);
      }
    });

    input.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  _addExpressionSupport(input, param, node, valueManager, onChange) {
    // Real-time expression validation and result preview
    input.addEventListener("input", (e) => {
      this._updateExpressionResult(input, param, node);
    });
  }

  _updateExpressionStyling(input, value) {
    try {
      if (this.expressionSystem.isExpression(value)) {
        input.classList.add('has-expression');
        input.style.backgroundColor = '#2a2a3e';
        input.style.borderColor = '#4CAF50';
        input.style.color = '#a8e6cf';
        input.style.fontWeight = 'normal';
      } else {
        input.classList.remove('has-expression');
        input.style.backgroundColor = '#333';
        input.style.borderColor = '#555';
        input.style.color = '#fff';
        input.style.fontWeight = 'normal';
      }
    } catch (error) {
      console.error('Error updating expression styling:', error);
    }
  }

  _updateExpressionValidation(input, value, node) {
    try {
      if (this.expressionSystem.isExpression(value)) {
        const validation = this.expressionSystem.validateExpression(value, {}, node);
        
        if (validation.valid) {
          input.style.borderColor = '#4CAF50';
          input.title = `Expression result: ${validation.result}`;
        } else {
          input.style.borderColor = '#f44336';
          input.title = `Expression error: ${validation.error}`;
        }
      } else {
        // Reset title for non-expressions, but keep any existing tooltip info
        const baseTitle = (input.dataset.paramType === "float" || input.dataset.paramType === "int")
          ? "Shift+drag to adjust value (Ctrl: fine, Alt: coarse)"
          : "";
        input.title = baseTitle;
      }
    } catch (error) {
      console.error('Error validating expression:', error);
    }
  }

  _canHaveExpressions(param) {
    // Allow expressions for numeric and string parameters
    return ['float', 'int', 'string', 'expression'].includes(param.type);
  }

  _createExpressionHelper(input, param, node, valueManager) {
    const helperBtn = document.createElement("button");
    helperBtn.className = "expression-helper-btn";
    helperBtn.textContent = "fx";
    helperBtn.type = "button";
    helperBtn.title = "Toggle expression mode";
    helperBtn.style.cssText = `
      background: #4CAF50;
      border: none;
      color: white;
      padding: 4px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-weight: bold;
      min-width: 20px;
      height: 24px;
      flex-shrink: 0;
    `;
    
    // Update initial button state
    this._updateHelperButtonState(helperBtn, input.value);
    
    helperBtn.addEventListener("click", (e) => {
      try {
        e.stopPropagation();
        
        if (this.expressionSystem.isExpression(input.value)) {
          // Remove expression prefix
          input.value = input.value.slice(1);
        } else {
          // Add expression prefix
          input.value = "=" + input.value;
        }
        
        this._updateExpressionStyling(input, input.value);
        this._updateHelperButtonState(helperBtn, input.value);
        
        // Trigger change event
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } catch (error) {
        console.error('Error toggling expression mode:', error);
      }
    });

    return helperBtn;
  }

  _updateHelperButtonState(helperBtn, value) {
    if (this.expressionSystem.isExpression(value)) {
      helperBtn.style.background = '#45a049';
      helperBtn.title = "Remove expression mode";
    } else {
      helperBtn.style.background = '#4CAF50';
      helperBtn.title = "Enable expression mode";
    }
  }

  _createExpressionResult(input, param, node) {
    if (!this._canHaveExpressions(param)) return null;
    
    const resultDiv = document.createElement("div");
    resultDiv.className = "expression-result";
    resultDiv.style.cssText = `
      font-size: 10px;
      color: #888;
      margin-top: 2px;
      font-style: italic;
      min-height: 12px;
      padding-left: 4px;
    `;
    
    // Store reference for updates
    input._resultDiv = resultDiv;
    
    // Initial update
    this._updateExpressionResult(input, param, node);
    
    return resultDiv;
  }

  _updateExpressionResult(input, param, node) {
    try {
      const resultDiv = input._resultDiv;
      if (!resultDiv) return;
      
      const value = input.value;
      
      if (this.expressionSystem.isExpression(value)) {
        const validation = this.expressionSystem.validateExpression(value, {}, node);
        
        if (validation.valid) {
          resultDiv.textContent = `→ ${validation.result}`;
          resultDiv.style.color = '#4CAF50';
        } else {
          resultDiv.textContent = `Error: ${validation.error}`;
          resultDiv.style.color = '#f44336';
        }
      } else {
        resultDiv.textContent = '';
      }
    } catch (error) {
      console.error('Error updating expression result:', error);
    }
  }

  _addNumericDragSupport(input, param, node, valueManager, onChange) {
    // Only enable drag for numeric parameters (float and int) and when not disabled
    if (param.type !== "float" && param.type !== "int") return;

    let isDragging = false;
    let startValue = 0;
    let startY = 0;
    let dragStartValue = null;

    input.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.shiftKey && !input.disabled) {
        console.log(`Starting shift+drag on ${param.name}`);
        
        // Don't allow drag on expressions
        if (this.expressionSystem.isExpression(input.value)) {
          return;
        }
        
        isDragging = true;
        startValue = parseFloat(input.value) || 0;
        dragStartValue = startValue;
        startY = e.clientY;
        input.style.cursor = "ns-resize";
        
        e.preventDefault();
        e.stopPropagation();

        const onMouseMove = (e) => {
          if (!isDragging) return;

          const deltaY = startY - e.clientY;
          const sensitivity = e.ctrlKey ? 0.001 : e.altKey ? 0.1 : 0.01;
          const newValue = startValue + deltaY * sensitivity;

          // Format based on parameter type
          if (param.type === "int") {
            input.value = Math.round(newValue).toString();
          } else {
            input.value = newValue.toFixed(3);
          }

          // Throttle updates using requestAnimationFrame for better performance
          if (this._pendingUpdate !== null) {
            return; // Update already scheduled
          }

          this._pendingUpdate = requestAnimationFrame(() => {
            this._pendingUpdate = null;

            // Update without undo recording (we'll do it on mouse up)
            const oldUndoManager = valueManager.undoManager;
            valueManager.undoManager = null;
            valueManager.updateNodeParameter(node, param.name, input.value, onChange);
            valueManager.undoManager = oldUndoManager;
          });

          e.preventDefault();
        };

        const onMouseUp = (e) => {
          console.log(`Ending shift+drag on ${param.name}`);

          // Cancel any pending update
          if (this._pendingUpdate !== null) {
            cancelAnimationFrame(this._pendingUpdate);
            this._pendingUpdate = null;
          }

          // Ensure final value is applied
          const oldUndoManager = valueManager.undoManager;
          valueManager.undoManager = null;
          valueManager.updateNodeParameter(node, param.name, input.value, onChange);
          valueManager.undoManager = oldUndoManager;

          if (isDragging && dragStartValue !== null) {
            const finalValue = parseFloat(input.value) || 0;
            if (this.undoManager && Math.abs(dragStartValue - finalValue) > 0.001) {
              this.undoManager.recordParameterChange(node.id, param.name, dragStartValue, finalValue);
              console.log(`Recorded undo: ${param.name} from ${dragStartValue} to ${finalValue}`);
            }
          }

          isDragging = false;
          dragStartValue = null;
          input.style.cursor = "";
          document.body.style.cursor = "";

          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        document.body.style.cursor = "ns-resize";
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }
    });

    // Add tooltip for numeric parameters
    if (param.type === "float" || param.type === "int") {
      const currentTitle = input.title || "";
      input.title = currentTitle + (currentTitle ? "\n" : "") + "Shift+drag to adjust value (Ctrl: fine, Alt: coarse)";
    }
  }
}