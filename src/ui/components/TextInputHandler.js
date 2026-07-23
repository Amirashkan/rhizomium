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
  /**
   * True when a numeric (float/int) field currently holds an incomplete or
   * unparseable value that must NOT be committed to the shader yet — e.g. the
   * user has typed ".", "-", "1." or "1e" on the way to a real number. Emitting
   * any of these into the generated WGSL produces an unparseable module, so we
   * hold the update until the field becomes a valid number (or is reverted).
   */
  _isIncompleteNumericValue(value, param) {
    if (param.type !== 'float' && param.type !== 'int') return false;

    const t = String(value).trim();

    // Expressions (=..., time, audioEnvelope...) are validated elsewhere.
    if (this.expressionSystem.isExpression(t)) return false;

    if (t === '') return true;              // empty field
    if (/^[+-]?$/.test(t)) return true;     // lone sign: "+", "-"
    if (/^[+-]?\.$/.test(t)) return true;   // lone dot: ".", "-."
    if (/[.eE][+-]?$/.test(t)) return true; // trailing dot / exponent: "1.", "1e", "1e-"

    return !Number.isFinite(Number(t));     // anything else that won't parse
  }

  /**
   * Give the field a red border while it holds an incomplete numeric value so
   * the user can see why the preview isn't updating.
   */
  _updateNumericValidation(input, param, isInvalid) {
    if (param.type !== 'float' && param.type !== 'int') return;

    if (isInvalid) {
      input.style.borderColor = '#f44336';
      input.title = 'Incomplete number — finish typing a valid value';
    } else if (!input.classList.contains('has-expression')) {
      input.style.borderColor = '#555';
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

  // PERFORMANCE: Skip expensive operations during shift+drag
  // The drag handler will apply updates with its own throttling
  if (input._isDragging) {
    return;
  }

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

  // Don't push an incomplete/invalid number (".", "-", "1.", ...) into the
  // shader — that generates unparseable WGSL. Hold the update and flag the field.
  const isIncompleteNumeric = this._isIncompleteNumericValue(newValue, param);
  this._updateNumericValidation(input, param, isIncompleteNumeric);

  if (!isIncompleteExpression && !isIncompleteNumeric) {
    // Update parameter immediately for non-expressions or complete expressions
    valueManager.updateNodeParameter(node, param.name, newValue, onChange);
  }

  // Debounce for final update (increased delay for expressions)
  const delay = newValue.trim().startsWith('=') ? 1000 : 500;
  inputTimer = setTimeout(() => {
    // Final update after user stops typing — but only once the value is valid,
    // so a half-typed number never reaches the shader.
    if (!this._isIncompleteNumericValue(input.value, param)) {
      valueManager.updateNodeParameter(node, param.name, input.value.trim(), onChange);
    }
    inputTimer = null;
  }, delay);
});

    // Final update on blur
    input.addEventListener("blur", (e) => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }
      
      // If the field was left in an incomplete/invalid numeric state, don't push
      // garbage into the shader. Salvage a real number if one can be parsed
      // (e.g. "1." -> "1"); otherwise revert to the last committed value.
      if (this._isIncompleteNumericValue(input.value, param)) {
        const parsed = parseFloat(input.value);
        if (Number.isFinite(parsed)) {
          const salvaged = param.type === 'int' ? String(Math.round(parsed)) : String(parsed);
          input.value = salvaged;
          this._updateNumericValidation(input, param, false);
          if (salvaged !== lastValue) {
            valueManager.updateNodeParameter(node, param.name, salvaged, onChange);
          }
        } else {
          input.value = lastValue;
          this._updateNumericValidation(input, param, false);
        }
        return;
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

    }
  }

  _addNumericDragSupport(input, param, node, valueManager, onChange) {
    // Only enable drag for numeric parameters (float and int) and when not disabled
    if (param.type !== "float" && param.type !== "int") return;

    let isDragging = false;
    let startValue = 0;
    let startY = 0;
    let dragStartValue = null;
    let currentDragValue = 0; // Track value internally during drag

    // Store drag state on input element so input event listener can check it
    input._isDragging = false;

    input.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.shiftKey && !input.disabled) {
        // PERFORMANCE: Disable console logging during drag
        // console.log(`Starting shift+drag on ${param.name}`);

        // Don't allow drag on expressions
        if (this.expressionSystem.isExpression(input.value)) {
          return;
        }
        
        isDragging = true;
        input._isDragging = true; // Flag for input event listener
        startValue = parseFloat(input.value) || 0;
        dragStartValue = startValue;
        startY = e.clientY;
        input.style.cursor = "ns-resize";

        // PERFORMANCE: Signal that we're in a drag operation
        // This allows the continuous render loop to skip expensive operations
        if (window.editor) {
          window.editor._parameterDragging = true;

          // Notify shader preview manager of edit start (for throttling)
          if (window.editor.shaderPreviewManager) {
            window.editor.shaderPreviewManager.beginInteraction('edit');
          }
        }

        e.preventDefault();
        e.stopPropagation();

        const onMouseMove = (e) => {
          if (!isDragging) return;

          // PERFORMANCE MEASUREMENT: Time this handler
          const t0 = performance.now();

          const deltaY = startY - e.clientY;
          const sensitivity = e.ctrlKey ? 0.001 : e.altKey ? 0.1 : 0.01;
          const newValue = startValue + deltaY * sensitivity;

          // Format based on parameter type
          if (param.type === "int") {
            currentDragValue = Math.round(newValue);
          } else {
            currentDragValue = newValue;
          }

          // PERFORMANCE: Update uniforms directly without shader rebuild
          // This updates the uniform manager values which GPU reads each frame
          // NO rebuild during drag = 60fps smooth dragging + real-time visual updates
          if (!node.params) node.params = {};
          node.params[param.name] = currentDragValue;

          // Update GPU uniforms immediately
          if (typeof window.updateUniformsOnly === 'function') {
            window.updateUniformsOnly(node.id, param.name, currentDragValue);
          }

          // PERFORMANCE FIX: Don't mark canvas dirty during parameter drag
          // Canvas doesn't need to redraw - only GPU preview needs to update
          // Canvas redraws are expensive and cause frame drops
          // The GPU preview shows parameter changes in real-time via uniforms
          // Canvas will redraw on mouseup when we call updateNodeParameter

          e.preventDefault();
          e.stopPropagation(); // Prevent EventHandler from processing this event
        };

        const onMouseUp = (e) => {
          // PERFORMANCE: Disable console logging during drag
          // console.log(`Ending shift+drag on ${param.name}`);

          // Update input.value with final drag value
          const finalValueStr = param.type === "int"
            ? currentDragValue.toString()
            : currentDragValue.toFixed(3);
          input.value = finalValueStr;

          // PERFORMANCE: Apply final value WITH all expensive operations
          // Now we trigger shader rebuild and preview computation once at the end
          const oldUndoManager = valueManager.undoManager;
          valueManager.undoManager = null;

          // This will trigger onChange (shader rebuild) and preview updates
          valueManager.updateNodeParameter(node, param.name, finalValueStr, onChange);

          valueManager.undoManager = oldUndoManager;

          if (isDragging && dragStartValue !== null) {
            if (this.undoManager && Math.abs(dragStartValue - currentDragValue) > 0.001) {
              this.undoManager.recordParameterChange(node.id, param.name, dragStartValue, currentDragValue);
              // console.log(`Recorded undo: ${param.name} from ${dragStartValue} to ${currentDragValue}`);
            }
          }

          isDragging = false;
          input._isDragging = false; // Clear flag
          dragStartValue = null;
          input.style.cursor = "";
          document.body.style.cursor = "";

          // PERFORMANCE: Clear drag flag to resume normal rendering
          if (window.editor) {
            window.editor._parameterDragging = false;

            // Notify shader preview manager of edit end (for throttling)
            if (window.editor.shaderPreviewManager) {
              window.editor.shaderPreviewManager.endInteraction('edit');
            }
          }

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