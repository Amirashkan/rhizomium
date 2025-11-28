// src/ui/components/GLSLCodeInputHandler.js
// GLSL/WGSL Code Editor for CustomGLSL node

// Inject styles for syntax highlighting
if (!document.getElementById('glsl-editor-styles')) {
  const style = document.createElement('style');
  style.id = 'glsl-editor-styles';
  style.textContent = `
    .glsl-keyword { color: #569cd6; }
    .glsl-type { color: #4ec9b0; }
    .glsl-function { color: #dcdcaa; }
    .glsl-number { color: #b5cea8; }
    .glsl-string { color: #ce9178; }
    .glsl-comment { color: #6a9955; font-style: italic; }
    .glsl-input { color: #9cdcfe; font-weight: bold; }
    .glsl-builtin { color: #4fc1ff; }
    .glsl-line-even { background: rgba(255, 255, 255, 0.02); }
    .glsl-line-odd { background: transparent; }
  `;
  document.head.appendChild(style);
}

export class GLSLCodeInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
  }

  create(param, node, div, label, valueManager, onChange) {
    // Clear any existing content
    div.innerHTML = '';
    
    const container = this.createContainer();
    const editorWrapper = this.createEditorWrapper();
    const lineNumbers = this.createLineNumbers();
    const textarea = this.createTextarea(param, node, valueManager);
    const highlightOverlay = this.createHighlightOverlay();
    const helpText = this.createHelpText();

    // Setup event handlers
    this.setupEventHandlers(textarea, param, node, valueManager, onChange, lineNumbers, highlightOverlay);

    // Create a wrapper for textarea and overlay to ensure they align perfectly
    const textareaContainer = document.createElement('div');
    textareaContainer.style.cssText = `
      position: relative;
      flex: 1;
      display: block;
      overflow: hidden;
    `;
    
    textareaContainer.appendChild(highlightOverlay);
    textareaContainer.appendChild(textarea);
    
    editorWrapper.appendChild(lineNumbers);
    editorWrapper.appendChild(textareaContainer);
    container.appendChild(editorWrapper);
    container.appendChild(helpText);
    div.appendChild(container);

    // Force initial update after DOM is ready
    requestAnimationFrame(() => {
      this.updateEditor(textarea, lineNumbers, highlightOverlay);
      // Ensure scroll is synced on initial load
      if (highlightOverlay) {
        highlightOverlay.style.transform = `translateY(-${textarea.scrollTop}px) translateX(-${textarea.scrollLeft}px)`;
      }
    });

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

  createEditorWrapper() {
    const wrapper = document.createElement('div');
    wrapper.className = 'glsl-editor-wrapper';
    wrapper.style.cssText = `
      position: relative;
      display: flex;
      width: 100%;
      background: #1e1e1e;
      border: 1px solid #555;
      border-radius: 4px;
      overflow: hidden;
    `;
    // Store reference for overlay positioning
    this.wrapper = wrapper;
    return wrapper;
  }

  createLineNumbers() {
    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'glsl-line-numbers';
    lineNumbers.style.cssText = `
      flex-shrink: 0;
      padding: 8px 4px 8px 8px;
      background: #252525;
      color: #858585;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      text-align: right;
      user-select: none;
      border-right: 1px solid #3a3a3a;
      width: 45px;
      overflow: hidden;
      box-sizing: border-box;
    `;
    lineNumbers.textContent = '1';
    return lineNumbers;
  }

  createHighlightOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'glsl-highlight-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      padding: 8px;
      margin: 0;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      overflow: visible;
      color: #d4d4d4;
      z-index: 1;
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      word-wrap: normal;
      overflow-wrap: normal;
    `;
    return overlay;
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
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      min-height: 150px;
      max-height: 400px;
      padding: 8px;
      background: transparent;
      color: transparent;
      border: none;
      outline: none;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      resize: vertical;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre;
      overflow-wrap: normal;
      tab-size: 2;
      box-sizing: border-box;
      z-index: 10;
      caret-color: #d4d4d4;
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
        this.updateEditor(textarea, null, null);
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

  setupEventHandlers(textarea, param, node, valueManager, onChange, lineNumbers, highlightOverlay) {
    let inputTimer = null;
    let lastValue = textarea.value;

    // Initial update
    this.updateEditor(textarea, lineNumbers, highlightOverlay);

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
      this.updateEditor(textarea, lineNumbers, highlightOverlay);
    });

    // Real-time input handling with debounce
    textarea.addEventListener('input', (e) => {
      e.stopPropagation();

      const newValue = textarea.value;

      // Update UI immediately
      this.updateEditor(textarea, lineNumbers, highlightOverlay);

      // Clear existing timer
      if (inputTimer) {
        clearTimeout(inputTimer);
      }

      // Debounced update
      inputTimer = setTimeout(() => {
        if (textarea.value !== lastValue) {
          valueManager.updateNodeParameter(node, param.name, newValue, onChange);
          lastValue = newValue;
        }
        inputTimer = null;
      }, 500);
    });

    // Sync scroll - update overlay position to match textarea scroll
    const syncScroll = () => {
      if (highlightOverlay) {
        // The overlay is absolutely positioned, so we need to adjust its transform
        // to match the textarea's scroll position
        requestAnimationFrame(() => {
          highlightOverlay.style.transform = `translateY(-${textarea.scrollTop}px) translateX(-${textarea.scrollLeft}px)`;
        });
      }
      if (lineNumbers) {
        lineNumbers.scrollTop = textarea.scrollTop;
      }
    };
    
    textarea.addEventListener('scroll', syncScroll);
    
    // Also update on resize
    const resizeObserver = new ResizeObserver(() => {
      this.updateEditor(textarea, lineNumbers, highlightOverlay);
      syncScroll();
    });
    if (window.ResizeObserver) {
      resizeObserver.observe(textarea);
    }

    // Final update on blur
    textarea.addEventListener('blur', () => {
      if (inputTimer) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }

      if (textarea.value !== lastValue) {
        valueManager.updateNodeParameter(node, param.name, textarea.value, onChange);
        lastValue = textarea.value;
      }
    });

    // Prevent clicks from propagating to editor
    textarea.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  updateEditor(textarea, lineNumbers, highlightOverlay) {
    const value = textarea.value;
    const lines = value.split('\n');
    const lineCount = lines.length || 1;

    // Update line numbers
    if (lineNumbers) {
      const lineNumbersHTML = Array.from({ length: lineCount }, (_, i) => i + 1)
        .map(num => `<div style="min-height: 18px; line-height: 1.5; ${num % 2 === 0 ? 'background: rgba(255,255,255,0.02);' : ''}">${num}</div>`)
        .join('');
      lineNumbers.innerHTML = lineNumbersHTML;
      lineNumbers.style.height = `${textarea.scrollHeight}px`;
    }

    // Update syntax highlighting with zebra striping
    if (highlightOverlay) {
      const highlighted = this.highlightSyntax(value);
      highlightOverlay.innerHTML = highlighted;
      // Match textarea scroll dimensions exactly - these are the full content dimensions
      highlightOverlay.style.height = `${textarea.scrollHeight}px`;
      highlightOverlay.style.width = `${textarea.scrollWidth}px`;
      // Sync scroll position - overlay content needs to move opposite to scroll
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        highlightOverlay.style.transform = `translateY(-${textarea.scrollTop}px) translateX(-${textarea.scrollLeft}px)`;
      });
    }
  }

  highlightSyntax(code) {
    // First escape all HTML to prevent injection
    let highlighted = this.escapeHtml(code);
    
    // GLSL/WGSL syntax highlighting - apply in order, avoiding overlapping matches
    // Use a marker system to avoid re-matching already highlighted content
    const markers = new Map();
    let markerIndex = 0;
    
    const patterns = [
      // Comments first (they can contain anything)
      { pattern: /\/\/.*$/gm, class: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g, class: 'comment' },
      // Strings (they can contain anything except unescaped quotes)
      { pattern: /"([^"\\]|\\.)*"/g, class: 'string' },
      // Keywords (must be whole words, not inside other tokens)
      { pattern: /\b(let|var|if|else|for|while|loop|switch|case|break|continue|return|discard|fn|struct|const)\b/g, class: 'keyword' },
      // Types
      { pattern: /\b(f32|f16|i32|u32|bool|vec2|vec3|vec4|mat2|mat3|mat4|sampler|texture)\b/g, class: 'type' },
      // Built-in functions
      { pattern: /\b(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|pow|exp|log|exp2|log2|sqrt|inversesqrt|abs|sign|floor|ceil|round|trunc|fract|mod|min|max|clamp|mix|step|smoothstep|length|distance|dot|cross|normalize|faceForward|reflect|refract|all|any|select|isNan|isInf|isFinite|isNormal|countLeadingZeros|countTrailingZeros|firstTrailingBit|insertBits|extractBits|findLsb|findMsb|pack4x8snorm|pack4x8unorm|pack2x16snorm|pack2x16unorm|pack2x16float|unpack4x8snorm|unpack4x8unorm|unpack2x16snorm|unpack2x16unorm|unpack2x16float|pack4x8i8|pack4x8u8|pack2x16i16|pack2x16u16|unpack4x8i8|unpack4x8u8|unpack2x16i16|unpack2x16u16|textureDimensions|textureNumLayers|textureNumLevels|textureNumSamples|textureSample|textureSampleBias|textureSampleCompare|textureSampleCompareLevel|textureSampleGrad|textureSampleLevel|textureSampleBaseClampToEdge|textureStore|textureLoad|atomicLoad|atomicStore|atomicAdd|atomicSub|atomicMax|atomicMin|atomicAnd|atomicOr|atomicXor|atomicExchange|atomicCompareExchangeWeak)\b/g, class: 'function' },
      // Numbers
      { pattern: /\b\d+\.?\d*[f]?\b/g, class: 'number' },
      // Input variables
      { pattern: /\b(input0|input1|input2|input3)\b/g, class: 'input' },
      // Built-in variables
      { pattern: /\b(time|uv|audioEnvelope|audioEnvelopeBass|audioEnvelopeMids|audioEnvelopeHighs|audioEnvelopeFull|PI|E|g\.time|g\.audioEnvelope|in\.uv)\b/g, class: 'builtin' },
    ];

    // Apply highlighting using markers to avoid nested matches
    for (const { pattern, class: className } of patterns) {
      highlighted = highlighted.replace(pattern, (match) => {
        const marker = `__MARKER_${markerIndex++}__`;
        markers.set(marker, { text: match, class: className });
        return marker;
      });
    }

    // Replace markers with HTML spans
    markers.forEach(({ text, class: className }, marker) => {
      highlighted = highlighted.replace(marker, `<span class="glsl-${className}">${text}</span>`);
    });

    // Add zebra striping to lines - use spans with display: block to match textarea line height
    const lines = highlighted.split('\n');
    const highlightedLines = lines.map((line, idx) => {
      const bgClass = idx % 2 === 1 ? 'glsl-line-even' : 'glsl-line-odd';
      // Use span with display: block to match textarea line height exactly (line-height: 1.5 * 12px = 18px)
      return `<span class="${bgClass}" style="display: block; min-height: 18px; line-height: 1.5;">${line || ' '}</span>`;
    });

    return highlightedLines.join('\n');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

