import { createIcon, setIcon } from './iconSprite.js';
// src/ui/ParameterBindingMenu.js
export class ParameterBindingMenu {
  constructor(bindingSystem, paramPanel) {
    this.bindingSystem = bindingSystem;
    this.paramPanel = paramPanel;
    this.menu = null;
    this.currentParameter = null;
    
    this.init();
  }

  init() {
    this.createMenu();
    this.setupEventListeners();
  }

  createMenu() {
    this.menu = document.createElement('div');
    this.menu.className = 'parameter-binding-menu';
    this.menu.style.cssText = `
      position: fixed;
      background: #141110;
      border: 1px solid rgba(255,244,230,0.08);
      border-radius: 4px;
      padding: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      z-index: 10000;
      display: none;
      min-width: 180px;
      font-size: 12px;
    `;

    document.body.appendChild(this.menu);
  }

  setupEventListeners() {
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (this.menu.style.display !== 'none' && !this.menu.contains(e.target)) {
        this.hide();
      }
    });

    // Listen for right-click on parameter inputs
    document.addEventListener('contextmenu', (e) => {
      const paramInput = e.target.closest('.param-input');
      if (paramInput) {
        e.preventDefault();
        this.showForParameter(e, paramInput);
      }
    });
  }

  showForParameter(event, inputElement) {
        if (!this.selectionManager || !this.selectionManager.selectedNode) {

        return;
    }
    const paramName = inputElement.getAttribute('data-param');
    const node = this.paramPanel.selectedNode;
    
    if (!node || !paramName) return;

    this.currentParameter = { node, paramName };
    const bindingInfo = this.bindingSystem.getBindingInfo(node.id, paramName);
    
    this.renderMenuContent(bindingInfo);
    this.positionMenu(event.clientX, event.clientY);
    this.show();
  }

  renderMenuContent(bindingInfo) {
    this.menu.innerHTML = '';

    const paramName = this.currentParameter.paramName;
    const node = this.currentParameter.node;

    // Menu header
    const header = document.createElement('div');
    header.style.cssText = `
      font-weight: bold;
      color: #c6f24e;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(255,244,230,0.08);
    `;
    header.textContent = `${node.kind}.${paramName}`;
    this.menu.appendChild(header);

    // Copy as reference
    const copyItem = this.createMenuItem('Copy as Reference', 'copy-value', () => {
      this.bindingSystem.clipboard = {
        nodeId: node.id,
        parameterName: paramName,
        nodeKind: node.kind,
        timestamp: Date.now()
      };
      this.paramPanel.showToast(`Copied ${node.kind}.${paramName} as reference`, 'success');
      this.hide();
    });
    this.menu.appendChild(copyItem);

    // Paste reference (if clipboard has content)
    if (this.bindingSystem.clipboard) {
      const canPaste = this.bindingSystem.clipboard.nodeId !== node.id || 
                      this.bindingSystem.clipboard.parameterName !== paramName;
      
      const pasteItem = this.createMenuItem(
        'Paste Reference', 
        'attach', 
        () => {
          this.pasteReference();
        },
        !canPaste
      );
      this.menu.appendChild(pasteItem);

      if (this.bindingSystem.clipboard && canPaste) {
        const clipboardInfo = document.createElement('div');
        clipboardInfo.style.cssText = `
          font-size: 10px;
          color: #6f6559;
          margin: 2px 0;
          padding-left: 20px;
        `;
        clipboardInfo.textContent = `From: ${this.bindingSystem.clipboard.nodeKind}.${this.bindingSystem.clipboard.parameterName}`;
        this.menu.appendChild(clipboardInfo);
      }
    }

    // Separator
    if (bindingInfo.isBound || bindingInfo.hasTargets) {
      this.menu.appendChild(this.createSeparator());
    }

    // Remove binding (if bound)
    if (bindingInfo.isBound) {
      const removeItem = this.createMenuItem('Remove Binding', 'unlink', () => {
        this.removeBinding();
      });
      removeItem.style.color = '#f8615a';
      this.menu.appendChild(removeItem);

      // Show source info
      const sourceInfo = document.createElement('div');
      sourceInfo.style.cssText = `
        font-size: 10px;
        color: #f5a524;
        margin: 2px 0;
        padding-left: 20px;
      `;
      const sourceNode = this.paramPanel.graph.nodes.find(n => n.id === bindingInfo.source.nodeId);
      sourceInfo.textContent = `Bound to: ${sourceNode?.kind || 'Unknown'}.${bindingInfo.source.parameterName}`;
      this.menu.appendChild(sourceInfo);
    }

    // Remove all targets (if has targets)
    if (bindingInfo.hasTargets) {
      const removeAllItem = this.createMenuItem('Remove All Target Bindings', 'trash', () => {
        this.removeAllTargetBindings();
      });
      removeAllItem.style.color = '#f8615a';
      this.menu.appendChild(removeAllItem);

      // Show targets info
      const targetsInfo = document.createElement('div');
      targetsInfo.style.cssText = `
        font-size: 10px;
        color: #c6f24e;
        margin: 2px 0;
        padding-left: 20px;
      `;
      targetsInfo.textContent = `Controls ${bindingInfo.targets.length} parameter(s)`;
      this.menu.appendChild(targetsInfo);
    }

    // Separator before utilities
    this.menu.appendChild(this.createSeparator());

    // Show all bindings
    const showAllItem = this.createMenuItem('Show All Bindings', 'search', () => {
      this.showAllBindings();
    });
    this.menu.appendChild(showAllItem);

    // Debug bindings
    const debugItem = this.createMenuItem('Debug Bindings', 'console', () => {
      this.bindingSystem.debugPrintBindings();
      this.hide();
    });
    this.menu.appendChild(debugItem);
  }

  createMenuItem(text, icon, onClick, disabled = false) {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.style.cssText = `
      padding: 6px 8px;
      cursor: ${disabled ? 'not-allowed' : 'pointer'};
      color: ${disabled ? 'rgba(255,244,230,0.13)' : '#f3ede4'};
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background-color 0.2s;
    `;

    if (!disabled) {
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#1a1611';
      });

      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });

      item.addEventListener('click', onClick);
    }

    // `icon` is a sprite id (see src/ui/iconSprite.js), not a glyph.
    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = 'width:16px;height:16px;flex:none;display:flex';
    iconSpan.appendChild(createIcon(icon, { size: 16 }));

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    item.appendChild(iconSpan);
    item.appendChild(textSpan);

    return item;
  }

  createSeparator() {
    const separator = document.createElement('div');
    separator.style.cssText = `
      height: 1px;
      background: rgba(255,244,230,0.08);
      margin: 4px 0;
    `;
    return separator;
  }

  pasteReference() {
    if (!this.bindingSystem.clipboard || !this.currentParameter) return;

    const success = this.bindingSystem.createBinding(
      this.bindingSystem.clipboard.nodeId,
      this.bindingSystem.clipboard.parameterName,
      this.currentParameter.node.id,
      this.currentParameter.paramName
    );

    if (success) {
      this.paramPanel.showToast(
        `Bound ${this.currentParameter.paramName} to ${this.bindingSystem.clipboard.nodeKind}.${this.bindingSystem.clipboard.parameterName}`,
        'success'
      );
      this.paramPanel.renderParameters(this.currentParameter.node);
    } else {
      this.paramPanel.showToast('Failed to create binding', 'error');
    }

    this.hide();
  }

  removeBinding() {
    if (!this.currentParameter) return;

    const bindingInfo = this.bindingSystem.getBindingInfo(
      this.currentParameter.node.id, 
      this.currentParameter.paramName
    );

    if (bindingInfo.isBound) {
      const success = this.bindingSystem.removeBinding(
        bindingInfo.source.nodeId,
        bindingInfo.source.parameterName,
        this.currentParameter.node.id,
        this.currentParameter.paramName
      );

      if (success) {
        this.paramPanel.showToast(`Removed binding from ${this.currentParameter.paramName}`, 'success');
        this.paramPanel.renderParameters(this.currentParameter.node);
      }
    }

    this.hide();
  }

  removeAllTargetBindings() {
    if (!this.currentParameter) return;

    this.bindingSystem.removeBindingsForSource(
      this.currentParameter.node.id,
      this.currentParameter.paramName
    );

    this.paramPanel.showToast(`Removed all target bindings from ${this.currentParameter.paramName}`, 'success');
    this.paramPanel.renderParameters(this.currentParameter.node);
    this.hide();
  }

  showAllBindings() {
    const bindings = this.bindingSystem.getAllBindings();
    
    if (bindings.length === 0) {
      this.paramPanel.showToast('No parameter bindings found', 'info');
      this.hide();
      return;
    }

    // Create a popup window showing all bindings
    this.createBindingsDialog(bindings);
    this.hide();
  }

  createBindingsDialog(bindings) {
    // Remove existing dialog if any
    const existing = document.getElementById('bindings-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'bindings-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #141110;
      border: 1px solid rgba(255,244,230,0.08);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index: 10001;
      max-width: 500px;
      max-height: 400px;
      overflow-y: auto;
      font-size: 12px;
      color: #f3ede4;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      font-weight: bold;
      color: #c6f24e;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255,244,230,0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

    const title = document.createElement('span');
    title.textContent = `Parameter Bindings (${bindings.length})`;

    const closeBtn = document.createElement('button');
    setIcon(closeBtn, 'close', { size: 12, label: 'Close' });
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #f3ede4;
      font-size: 16px;
      cursor: pointer;
      padding: 0;
      width: 20px;
      height: 20px;
    `;
    closeBtn.addEventListener('click', () => dialog.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // List bindings
    bindings.forEach((binding, _index) => {
      const sourceNode = this.paramPanel.graph.nodes.find(n => n.id === binding.source.nodeId);
      const targetNode = this.paramPanel.graph.nodes.find(n => n.id === binding.target.nodeId);

      const bindingItem = document.createElement('div');
      bindingItem.style.cssText = `
        padding: 8px;
        margin-bottom: 8px;
        background: #171310;
        border-radius: 4px;
        border-left: 3px solid #c6f24e;
      `;

      bindingItem.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="color: #f5a524;">${sourceNode?.kind || 'Unknown'}</span>
            <span style="color: #cabfb0;">.${binding.source.parameterName}</span>
            <span style="color: #6f6559;"> → </span>
            <span style="color: #c6f24e;">${targetNode?.kind || 'Unknown'}</span>
            <span style="color: #cabfb0;">.${binding.target.parameterName}</span>
          </div>
          <button class="remove-binding-btn" style="
            background: #f8615a;
            border: none;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            cursor: pointer;
          ">Remove</button>
        </div>
      `;

      const removeBtn = bindingItem.querySelector('.remove-binding-btn');
      removeBtn.addEventListener('click', () => {
        this.bindingSystem.removeBinding(
          binding.source.nodeId,
          binding.source.parameterName,
          binding.target.nodeId,
          binding.target.parameterName
        );
        bindingItem.remove();
        
        // Update title
        const remainingCount = dialog.querySelectorAll('.remove-binding-btn').length - 1;
        title.textContent = `Parameter Bindings (${remainingCount})`;
        
        if (remainingCount === 0) {
          dialog.remove();
          this.paramPanel.showToast('All bindings removed', 'info');
        }
      });

      dialog.appendChild(bindingItem);
    });

    document.body.appendChild(dialog);

    // Click outside to close
    const closeOnOutside = (e) => {
      if (!dialog.contains(e.target)) {
        dialog.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeOnOutside);
    }, 100);
  }

  positionMenu(x, y) {
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;

    // Adjust position if menu goes off-screen
    const rect = this.menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (rect.right > viewportWidth) {
      this.menu.style.left = `${x - rect.width}px`;
    }

    if (rect.bottom > viewportHeight) {
      this.menu.style.top = `${y - rect.height}px`;
    }
  }

  show() {
    this.menu.style.display = 'block';
  }

  hide() {
    this.menu.style.display = 'none';
    this.currentParameter = null;
  }

  destroy() {
    if (this.menu) {
      this.menu.remove();
    }
  }
}

// Visual Binding Indicators for the Editor Canvas
export class BindingVisualizer {
  constructor(editor, bindingSystem) {
    this.editor = editor;
    this.bindingSystem = bindingSystem;
    this.showBindings = false;
    this.bindingLines = [];
    
    this.init();
  }

  init() {
    // Add toggle button to editor UI
    this.createToggleButton();
    
    // Listen for binding changes
    this.bindingSystem.eventSystem.on('BINDING_CREATED', () => {
      if (this.showBindings) this.updateBindingVisualization();
    });
    
    this.bindingSystem.eventSystem.on('BINDING_REMOVED', () => {
      if (this.showBindings) this.updateBindingVisualization();
    });
  }

  createToggleButton() {
    const button = document.createElement('button');
    button.id = 'toggle-bindings-btn';
    setIcon(button, 'link', { size: 12, label: 'Bindings' });
    button.title = 'Toggle parameter binding visualization';
    button.style.cssText = `
      position: fixed;
      top: 60px;
      right: 10px;
      width: 40px;
      height: 40px;
      background: ${this.showBindings ? '#c6f24e' : '#171310'};
      border: 1px solid rgba(255,244,230,0.08);
      border-radius: 6px;
      color: white;
      cursor: pointer;
      font-size: 16px;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.3s;
    `;

    button.addEventListener('click', () => {
      this.toggleBindingVisualization();
    });

    document.body.appendChild(button);
  }

  toggleBindingVisualization() {
    this.showBindings = !this.showBindings;
    
    const button = document.getElementById('toggle-bindings-btn');
    if (button) {
      button.style.background = this.showBindings ? '#c6f24e' : '#171310';
    }

    if (this.showBindings) {
      this.updateBindingVisualization();
    } else {
      this.clearBindingVisualization();
    }
  }

  updateBindingVisualization() {
    this.clearBindingVisualization();
    
    if (!this.showBindings) return;

    const bindings = this.bindingSystem.getAllBindings();
    const canvas = this.editor.canvas;
    
    if (!canvas) return;

    bindings.forEach(binding => {
      this.drawBindingLine(binding, canvas);
    });
  }

  drawBindingLine(binding, canvas) {
    const sourceNode = this.editor.graph.nodes.find(n => n.id === binding.source.nodeId);
    const targetNode = this.editor.graph.nodes.find(n => n.id === binding.target.nodeId);
    
    if (!sourceNode || !targetNode) return;

    // Create SVG overlay for binding lines
    let svg = document.getElementById('binding-overlay');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'binding-overlay';
      svg.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 5;
      `;
      canvas.parentElement.appendChild(svg);
    }

    // Calculate positions
    const sourcePos = this.getNodePosition(sourceNode);
    const targetPos = this.getNodePosition(targetNode);
    
    if (!sourcePos || !targetPos) return;

    // Create curved line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const midX = (sourcePos.x + targetPos.x) / 2;
    const midY = (sourcePos.y + targetPos.y) / 2 - 50; // Curve upward
    
    const d = `M ${sourcePos.x} ${sourcePos.y} Q ${midX} ${midY} ${targetPos.x} ${targetPos.y}`;
    
    line.setAttribute('d', d);
    line.setAttribute('stroke', '#f5a524');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke-dasharray', '5,5');
    line.style.opacity = '0.7';

    // Add animation
    const animation = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animation.setAttribute('attributeName', 'stroke-dashoffset');
    animation.setAttribute('values', '0;-10');
    animation.setAttribute('dur', '1s');
    animation.setAttribute('repeatCount', 'indefinite');
    line.appendChild(animation);

    svg.appendChild(line);
    this.bindingLines.push(line);

    // Add labels
    this.addBindingLabel(svg, sourcePos, targetPos, binding);
  }

  addBindingLabel(svg, sourcePos, targetPos, binding) {
    const midX = (sourcePos.x + targetPos.x) / 2;
    const midY = (sourcePos.y + targetPos.y) / 2 - 25;

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', midX);
    label.setAttribute('y', midY);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#f3ede4');
    label.setAttribute('font-size', '10');
    label.style.fontFamily = 'var(--rz-font-ui)';
    label.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
    
    label.textContent = `${binding.source.parameterName} → ${binding.target.parameterName}`;
    
    svg.appendChild(label);
    this.bindingLines.push(label);
  }

  getNodePosition(node) {
    // This depends on your editor's node positioning system
    // Adjust according to your implementation
    const nodeElement = document.querySelector(`[data-node-id="${node.id}"]`);
    if (!nodeElement) return null;

    const rect = nodeElement.getBoundingClientRect();
    const canvasRect = this.editor.canvas.getBoundingClientRect();
    
    return {
      x: rect.left - canvasRect.left + rect.width / 2,
      y: rect.top - canvasRect.top + rect.height / 2
    };
  }

  clearBindingVisualization() {
    const svg = document.getElementById('binding-overlay');
    if (svg) {
      svg.remove();
    }
    this.bindingLines = [];
  }

  destroy() {
    this.clearBindingVisualization();
    
    const button = document.getElementById('toggle-bindings-btn');
    if (button) {
      button.remove();
    }
  }
}