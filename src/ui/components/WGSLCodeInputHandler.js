// src/ui/components/WGSLCodeInputHandler.js
// WGSL Code Editor with live syntax highlighting and compile checking

export class WGSLCodeInputHandler {
  constructor(undoManager = null, device = null) {
    this.undoManager = undoManager;
    this.device = device;
    this.compileTimeouts = new Map();
    this.lastValidCode = new Map();

    // WGSL Keywords and built-ins for syntax highlighting
    this.wgslKeywords = [
      'fn', 'var', 'let', 'const', 'struct', 'if', 'else', 'for', 'while', 'loop',
      'break', 'continue', 'return', 'discard', 'switch', 'case', 'default',
      'compute', 'fragment', 'vertex',
      'workgroup_size', 'binding', 'group', 'location', 'builtin',
      'read', 'write', 'read_write'
    ];

    this.wgslTypes = [
      'f32', 'i32', 'u32', 'bool',
      'vec2', 'vec3', 'vec4',
      'mat2x2', 'mat3x3', 'mat4x4',
      'texture_2d', 'texture_storage_2d', 'texture_3d',
      'sampler', 'sampler_comparison',
      'array', 'ptr', 'atomic'
    ];

    this.wgslStorageClasses = [
      'function', 'private', 'workgroup', 'uniform', 'storage'
    ];

    this.wgslBuiltins = [
      'textureStore', 'textureLoad', 'textureSample',
      'sin', 'cos', 'tan', 'sqrt', 'pow', 'exp', 'log',
      'abs', 'floor', 'ceil', 'round', 'fract', 'clamp', 'mix', 'step', 'smoothstep',
      'length', 'distance', 'dot', 'cross', 'normalize',
      'min', 'max', 'saturate'
    ];
  }

  /**
   * Set the WebGPU device for compilation checking
   */
  setDevice(device) {
    this.device = device;
  }

  /**
   * Create WGSL code editor UI
   */
  create(param, node, div, label, valueManager, onChange) {
    const container = this._createEditorContainer();
    const toolbar = this._createToolbar(param, node, valueManager, onChange);
    const editorWrapper = this._createEditorWrapper();
    const textarea = this._createTextarea(param, node, valueManager);
    const highlightLayer = this._createHighlightLayer();
    const errorDisplay = this._createErrorDisplay();

    // Set initial value
    this._setCurrentValue(textarea, param, node, valueManager);

    // Setup event handlers
    this._setupEventHandlers(textarea, highlightLayer, param, node, valueManager, onChange, errorDisplay);

    // Initial syntax highlighting
    this._updateSyntaxHighlighting(textarea, highlightLayer);

    // Assemble UI
    editorWrapper.appendChild(highlightLayer);
    editorWrapper.appendChild(textarea);
    container.appendChild(toolbar);
    container.appendChild(editorWrapper);
    container.appendChild(errorDisplay);
    div.appendChild(container);

    // Store references
    textarea._errorDisplay = errorDisplay;
    textarea._highlightLayer = highlightLayer;

    return div;
  }

  _createEditorContainer() {
    const container = document.createElement("div");
    container.className = "wgsl-editor-container";
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 8px 0;
    `;
    return container;
  }

  _createToolbar(param, node, valueManager, onChange) {
    const toolbar = document.createElement("div");
    toolbar.className = "wgsl-toolbar";
    toolbar.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: #12100e;
      border: 1px solid rgba(255, 244, 230, 0.08);
      border-radius: 4px;
      font-size: 11px;
    `;

    const title = document.createElement("span");
    title.textContent = "WGSL Compute Shader";
    title.style.cssText = `
      color: #8f867a;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    `;

    const buttonGroup = document.createElement("div");
    buttonGroup.style.cssText = `
      display: flex;
      gap: 4px;
    `;

    // Compile button
    const compileBtn = document.createElement("button");
    compileBtn.textContent = "✓ Compile";
    compileBtn.type = "button";
    compileBtn.title = "Check shader compilation";
    compileBtn.style.cssText = `
      background: rgba(198, 242, 78, 0.14);
      border: 1px solid rgba(198, 242, 78, 0.3);
      color: #c6f24e;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-weight: bold;
    `;

    compileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const textarea = toolbar.parentElement.querySelector("textarea");
      if (textarea) {
        this._checkCompilation(textarea.value, node, textarea._errorDisplay, true);
      }
    });

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "↺ Reset";
    resetBtn.type = "button";
    resetBtn.title = "Reset to default shader";
    resetBtn.style.cssText = `
      background: rgba(245, 165, 36, 0.14);
      border: 1px solid rgba(245, 165, 36, 0.3);
      color: #f5a524;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-weight: bold;
    `;

    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const textarea = toolbar.parentElement.querySelector("textarea");
      if (textarea && confirm("Reset shader to default?")) {
        textarea.value = param.default || "";
        valueManager.updateNodeParameter(node, param.name, textarea.value, onChange);
        this._updateSyntaxHighlighting(textarea, textarea._highlightLayer);
      }
    });

    buttonGroup.appendChild(compileBtn);
    buttonGroup.appendChild(resetBtn);

    toolbar.appendChild(title);
    toolbar.appendChild(buttonGroup);

    return toolbar;
  }

  _createEditorWrapper() {
    const wrapper = document.createElement("div");
    wrapper.className = "wgsl-editor-wrapper";
    wrapper.style.cssText = `
      position: relative;
      width: 100%;
      height: 400px;
      border: 1px solid #555;
      border-radius: 4px;
      overflow: hidden;
      background: #1e1e1e;
    `;
    return wrapper;
  }

  _createTextarea(param, _node, _valueManager) {
    const textarea = document.createElement("textarea");
    textarea.className = "wgsl-editor";
    textarea.dataset.param = param.name;
    textarea.spellcheck = false;
    textarea.autocapitalize = "off";
    textarea.autocomplete = "off";
    textarea.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      padding: 12px;
      background: transparent;
      color: #d4d4d4;
      border: none;
      resize: none;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      overflow-wrap: normal;
      overflow-x: auto;
      overflow-y: auto;
      z-index: 2;
      caret-color: #fff;
      tab-size: 2;
    `;

    // Handle tab key for indentation
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;

        // Insert 2 spaces
        textarea.value = value.substring(0, start) + "  " + value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;

        // Trigger input event for syntax highlighting
        textarea.dispatchEvent(new Event("input"));
      }
    });

    return textarea;
  }

  _createHighlightLayer() {
    const layer = document.createElement("div");
    layer.className = "wgsl-highlight-layer";
    layer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      padding: 12px;
      background: transparent;
      color: transparent;
      border: none;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      overflow-wrap: normal;
      overflow: hidden;
      pointer-events: none;
      z-index: 1;
    `;
    return layer;
  }

  _createErrorDisplay() {
    const errorDiv = document.createElement("div");
    errorDiv.className = "wgsl-error-display";
    errorDiv.style.cssText = `
      padding: 8px;
      background: rgba(248, 97, 90, 0.12);
      border: 1px solid rgba(248, 97, 90, 0.4);
      border-radius: 8px;
      color: #f8a49f;
      font-size: 11px;
      font-family: 'Consolas', 'Monaco', monospace;
      white-space: pre-wrap;
      display: none;
      max-height: 120px;
      overflow-y: auto;
    `;
    return errorDiv;
  }

  _setCurrentValue(textarea, param, node, _valueManager) {
    try {
      // Get WGSL source from node or parameter
      let wgslCode = "";

      if (node.wgslSource) {
        wgslCode = node.wgslSource;
      } else if (node.params && node.params[param.name]) {
        wgslCode = node.params[param.name];
      } else if (param.default) {
        wgslCode = param.default;
      }

      textarea.value = wgslCode;

      // Store as last valid code
      this.lastValidCode.set(node.id, wgslCode);
    } catch (error) {
      console.error('Error setting WGSL code value:', error);
      textarea.value = param.default || "";
    }
  }

  _setupEventHandlers(textarea, highlightLayer, param, node, valueManager, onChange, errorDisplay) {
    let inputTimer = null;
    let lastValue = textarea.value;

    // Prevent editor interference
    textarea.addEventListener("keydown", (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
      }

      // Allow Escape to blur
      if (e.key === "Escape") {
        textarea.blur();
        e.stopPropagation();
      }
    });

    // Capture initial value on focus
    textarea.addEventListener("focus", () => {
      lastValue = textarea.value;
    });

    // Sync scroll between textarea and highlight layer
    textarea.addEventListener("scroll", () => {
      highlightLayer.scrollTop = textarea.scrollTop;
      highlightLayer.scrollLeft = textarea.scrollLeft;
    });

    // Real-time input handling with syntax highlighting
    textarea.addEventListener("input", (e) => {
      e.stopPropagation();

      const newValue = textarea.value;

      // Update syntax highlighting
      this._updateSyntaxHighlighting(textarea, highlightLayer);

      // Clear existing timer
      if (inputTimer) {
        clearTimeout(inputTimer);
      }

      // Debounced compilation check and parameter update
      inputTimer = setTimeout(async () => {
        const isValid = await this._checkCompilation(newValue, node, errorDisplay, false);

        if (isValid) {
          // Update parameter and trigger shader reload
          valueManager.updateNodeParameter(node, param.name, newValue, onChange);
          this.lastValidCode.set(node.id, newValue);
        } else {
          // Show error but don't update (safe rollback)
          console.warn('[WGSLCodeEditor] Compilation failed, keeping previous shader');
        }

        inputTimer = null;
      }, 1500); // Longer delay for compilation
    });

    // Final update on blur
    textarea.addEventListener("blur", async () => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }

      if (textarea.value !== lastValue) {
        const isValid = await this._checkCompilation(textarea.value, node, errorDisplay, true);

        if (isValid) {
          valueManager.updateNodeParameter(node, param.name, textarea.value, onChange);
          this.lastValidCode.set(node.id, textarea.value);
        } else {
          // Rollback to last valid code
          const lastValid = this.lastValidCode.get(node.id) || lastValue;
          textarea.value = lastValid;
          this._updateSyntaxHighlighting(textarea, highlightLayer);
          alert('Shader compilation failed. Reverted to last valid code.');
        }
      }
    });

    textarea.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  /**
   * Update syntax highlighting
   */
  _updateSyntaxHighlighting(textarea, highlightLayer) {
    const code = textarea.value;
    const highlighted = this._highlightWGSL(code);
    highlightLayer.innerHTML = highlighted;
  }

  /**
   * Highlight WGSL code with syntax colors
   */
  _highlightWGSL(code) {
    let result = code;

    // Escape HTML
    result = result
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Comments (single-line and multi-line)
    result = result.replace(/(\/\/.*?)($|<br>)/g, '<span style="color: #6A9955;">$1</span>$2');
    result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color: #6A9955;">$1</span>');

    // Attributes (@group, @binding, @compute, etc.)
    result = result.replace(/@(\w+)/g, '<span style="color: #C586C0;">@$1</span>');

    // Keywords
    const keywordPattern = new RegExp(`\\b(${this.wgslKeywords.join('|')})\\b`, 'g');
    result = result.replace(keywordPattern, '<span style="color: #569CD6;">$1</span>');

    // Storage classes
    const storagePattern = new RegExp(`\\b(${this.wgslStorageClasses.join('|')})\\b`, 'g');
    result = result.replace(storagePattern, '<span style="color: #C586C0;">$1</span>');

    // Types
    const typePattern = new RegExp(`\\b(${this.wgslTypes.join('|')})\\b`, 'g');
    result = result.replace(typePattern, '<span style="color: #4EC9B0;">$1</span>');

    // Built-in functions
    const builtinPattern = new RegExp(`\\b(${this.wgslBuiltins.join('|')})\\b`, 'g');
    result = result.replace(builtinPattern, '<span style="color: #DCDCAA;">$1</span>');

    // Numbers
    result = result.replace(/\b(\d+\.?\d*)\b/g, '<span style="color: #B5CEA8;">$1</span>');

    // Strings
    result = result.replace(/"([^"]*)"/g, '<span style="color: #CE9178;">"$1"</span>');

    return result;
  }

  /**
   * Check shader compilation using WebGPU
   */
  async _checkCompilation(code, node, errorDisplay, showSuccess = false) {
    if (!this.device) {
      console.warn('[WGSLCodeEditor] No WebGPU device available for compilation check');
      errorDisplay.style.display = 'none';
      return true; // Assume valid if can't check
    }

    try {
      // Try to create shader module
      const shaderModule = this.device.createShaderModule({
        code: code,
        label: `${node.kind}_validation_${node.id}`
      });

      // Check for compilation errors
      const compilationInfo = await shaderModule.getCompilationInfo();

      const errors = compilationInfo.messages.filter(
        msg => msg.type === 'error'
      );

      if (errors.length > 0) {
        // Show errors
        const errorText = errors.map(err =>
          `Line ${err.lineNum}: ${err.message}`
        ).join('\n');

        errorDisplay.textContent = `Compilation Error:\n${errorText}`;
        errorDisplay.style.display = 'block';
        errorDisplay.style.borderColor = 'rgba(248, 97, 90, 0.4)';

        return false;
      } else {
        // Success
        if (showSuccess) {
          errorDisplay.textContent = '✓ Shader compiled successfully';
          errorDisplay.style.display = 'block';
          errorDisplay.style.borderColor = 'rgba(198, 242, 78, 0.3)';
          errorDisplay.style.background = 'rgba(198, 242, 78, 0.1)';
          errorDisplay.style.color = '#c6f24e';

          // Hide success message after 2 seconds
          setTimeout(() => {
            errorDisplay.style.display = 'none';
          }, 2000);
        } else {
          errorDisplay.style.display = 'none';
        }

        return true;
      }
    } catch (error) {
      // Compilation error
      errorDisplay.textContent = `Compilation Error:\n${error.message}`;
      errorDisplay.style.display = 'block';
      errorDisplay.style.borderColor = 'rgba(248, 97, 90, 0.4)';
      errorDisplay.style.background = '#2d1f1f';
      errorDisplay.style.color = '#ff6b6b';

      return false;
    }
  }
}
