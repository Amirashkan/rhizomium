// src/ui/components/GLSLCodeInputHandler.js
// GLSL/WGSL Code Editor for CustomGLSL node

export class GLSLCodeInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
  }

  create(param, node, div, label, valueManager, onChange) {
    const container = this.createContainer();
    const textarea = this.createTextarea(param, node, valueManager);
    const helpText = this.createHelpText();

    // Setup event handlers
    this.setupEventHandlers(textarea, param, node, valueManager, onChange);

    container.appendChild(textarea);
    container.appendChild(helpText);
    div.appendChild(container);

    return div;
  }

  createContainer() {
    const container = document.createElement('div');
    container.className = 'glsl-code-editor-container';
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 8px 0;
    `;
    return container;
  }

  createTextarea(param, node, valueManager) {
    const textarea = document.createElement('textarea');
    textarea.className = 'glsl-code-editor';
    textarea.setAttribute('data-param', param.name);
    textarea.setAttribute('rows', '8');
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';
    
    const currentValue = node.params?.[param.name] ?? param.default ?? '';
    textarea.value = String(currentValue);

    textarea.style.cssText = `
      width: 100%;
      min-height: 150px;
      max-height: 400px;
      padding: 8px;
      background: #1e1e1e;
      color: #d4d4d4;
      border: 1px solid #555;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      resize: vertical;
      overflow-y: auto;
      white-space: pre;
      overflow-wrap: normal;
      tab-size: 2;
      box-sizing: border-box;
    `;

    // Handle tab key for indentation
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;

        // Insert 2 spaces
        textarea.value = value.substring(0, start) + '  ' + value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
    });

    return textarea;
  }

  createHelpText() {
    const help = document.createElement('div');
    help.className = 'glsl-code-help';
    help.style.cssText = `
      font-size: 10px;
      color: #888;
      padding: 4px 8px;
      background: #252525;
      border-radius: 3px;
      line-height: 1.4;
    `;
    help.innerHTML = `
      <strong>Tips:</strong><br>
      • Use <code>input0</code>, <code>input1</code>, <code>input2</code>, <code>input3</code> to reference inputs<br>
      • Write WGSL code (e.g., <code>sin(input0) * 2.0</code>)<br>
      • Last line should be the expression to output
    `;
    return help;
  }

  setupEventHandlers(textarea, param, node, valueManager, onChange) {
    let inputTimer = null;
    let lastValue = textarea.value;

    // Prevent editor interference
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
      }
      if (e.key === 'Escape') {
        textarea.blur();
        e.stopPropagation();
      }
    });

    // Capture initial value on focus
    textarea.addEventListener('focus', () => {
      lastValue = textarea.value;
    });

    // Real-time input handling with debounce
    textarea.addEventListener('input', (e) => {
      e.stopPropagation();

      const newValue = textarea.value;

      // Clear existing timer
      if (inputTimer) {
        clearTimeout(inputTimer);
      }

      // Debounced update
      inputTimer = setTimeout(() => {
        if (this.undoManager && textarea.value !== lastValue) {
          this.undoManager.recordState(`Update ${param.label || param.name}`);
        }
        valueManager.updateNodeParameter(node, param.name, newValue, onChange);
        lastValue = newValue;
        inputTimer = null;
      }, 500);
    });

    // Final update on blur
    textarea.addEventListener('blur', () => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }

      if (textarea.value !== lastValue) {
        if (this.undoManager) {
          this.undoManager.recordState(`Update ${param.label || param.name}`);
        }
        valueManager.updateNodeParameter(node, param.name, textarea.value, onChange);
        lastValue = textarea.value;
      }
    });

    // Prevent clicks from propagating to editor
    textarea.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
}

