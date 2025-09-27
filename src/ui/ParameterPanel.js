// src/ui/ParameterPanel.js - Complete implementation with preview updates

import { ExpressionTextInputHandler, ExpressionParameterValueManager, expressionSystem, expressionStyles } from '../utils/ParameterExpressionSystem.js';
import { SelectInputHandler } from './components/SelectInputHandler.js';
import { FileInputHandler } from './components/FileInputHandler.js';

export class ParameterPanel {
  constructor(eventSystem, undoManager, graph) {
    this.eventSystem = eventSystem;
    this.undoManager = undoManager;
    this.graph = graph;
    this.selectedNode = null;
    this.panel = null;
    this.expressionSystem = expressionSystem;
    this.expressionSystem.startAnimationLoop();
    // Initialize expression system components
    this.expressionSystem = expressionSystem;
    this.valueManager = new ExpressionParameterValueManager(
      graph, 
      undoManager, 
      eventSystem, 
      this.expressionSystem
    );
    
    // Initialize input handlers with expression support
    this.textInputHandler = new ExpressionTextInputHandler(
      undoManager, 
      this.expressionSystem
    );
    this.selectInputHandler = new SelectInputHandler(undoManager);
    this.fileInputHandler = new FileInputHandler(undoManager);
    
    // Input handlers mapping
    this.inputHandlers = {
      text: this.textInputHandler,
      float: this.textInputHandler,
      int: this.textInputHandler,
      expression: this.textInputHandler,
      select: this.selectInputHandler,
      file: this.fileInputHandler
    };
    
    this.init();
  }

  init() {
    this.createPanel();
    this.injectStyles();
    this.setupEventListeners();
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'parameter-panel';
    this.panel.className = 'parameter-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 300px;
      max-height: 70vh;
      background: #2b2b2b;
      border: 1px solid #555;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #fff;
      overflow-y: auto;
      z-index: 1000;
      display: none;
    `;
    
    document.body.appendChild(this.panel);
  }

  injectStyles() {
    if (!document.getElementById('expression-styles')) {
      const styleElement = document.createElement('style');
      styleElement.id = 'expression-styles';
      styleElement.textContent = expressionStyles;
      document.head.appendChild(styleElement);
    }
  }

  setupEventListeners() {
    // Listen for node selection changes
    if (this.eventSystem && this.eventSystem.on) {
      this.eventSystem.on('NODE_SELECTED', (data) => {
        this.showNodeParameters(data.node);
      });

      this.eventSystem.on('NODE_DESELECTED', () => {
        this.hide();
      });

      this.eventSystem.on('PARAMETER_CHANGED', (data) => {
        this.handleParameterChange(data);
      });
    }

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.panel.style.display !== 'none' && 
          !this.panel.contains(e.target) && 
          !e.target.closest('.node')) {
        this.hide();
      }
    });
  }

  // Get parameter definitions based on node type
  getParameterDefinitions(node) {
    // First check if node already has parameter definitions
    if (node.parameterDefinitions && node.parameterDefinitions.length > 0) {
      return node.parameterDefinitions;
    }

    // Generate parameter definitions based on node type
    const definitions = [];
    
    switch (node.kind.toLowerCase()) {
      case 'constfloat':
        definitions.push({
          name: 'value',
          type: 'float',
          displayName: 'Value',
          default: 0.0,
          description: 'The constant float value'
        });
        break;
        
      case 'constvec3':
        definitions.push(
          {
            name: 'x',
            type: 'float',
            displayName: 'X',
            default: 0.0,
            description: 'X component'
          },
          {
            name: 'y',
            type: 'float',
            displayName: 'Y',
            default: 0.0,
            description: 'Y component'
          },
          {
            name: 'z',
            type: 'float',
            displayName: 'Z',
            default: 0.0,
            description: 'Z component'
          }
        );
        break;
        
      case 'circle':
      case 'circlefield':
        definitions.push(
          {
            name: 'radius',
            type: 'float',
            displayName: 'Radius',
            default: 0.25,
            min: 0.0,
            max: 2.0,
            description: 'Circle radius'
          },
          {
            name: 'epsilon',
            type: 'float',
            displayName: 'Softness',
            default: 0.02,
            min: 0.001,
            max: 0.1,
            description: 'Edge softness'
          }
        );
        break;
        
      case 'add':
      case 'multiply':
      case 'subtract':
      case 'divide':
        definitions.push(
          {
            name: 'a',
            type: 'float',
            displayName: 'A',
            default: 0.0,
            description: 'First operand'
          },
          {
            name: 'b',
            type: 'float',
            displayName: 'B',
            default: 0.0,
            description: 'Second operand'
          }
        );
        break;
        
      case 'texture2d':
        definitions.push(
          {
            name: 'file',
            type: 'file',
            displayName: 'Image File',
            accept: 'image/*',
            description: 'Texture image file'
          },
          {
            name: 'scale',
            type: 'float',
            displayName: 'Scale',
            default: 1.0,
            min: 0.1,
            max: 10.0,
            description: 'Texture scale'
          }
        );
        break;
        
      case 'valuenoise':
      case 'fbmnoise':
      case 'simplexnoise':
        definitions.push(
          {
            name: 'scale',
            type: 'float',
            displayName: 'Scale',
            default: 5.0,
            min: 0.1,
            max: 20.0,
            description: 'Noise scale'
          },
          {
            name: 'amplitude',
            type: 'float',
            displayName: 'Amplitude',
            default: 1.0,
            min: 0.0,
            max: 2.0,
            description: 'Noise amplitude'
          }
        );
        break;
        
      default:
        // For unknown node types, try to infer from existing params
        if (node.params && Object.keys(node.params).length > 0) {
          Object.keys(node.params).forEach(key => {
            const value = node.params[key];
            definitions.push({
              name: key,
              type: typeof value === 'number' ? 'float' : 'text',
              displayName: key.charAt(0).toUpperCase() + key.slice(1),
              default: value,
              description: `${key} parameter`
            });
          });
        } else {
          // Add a generic value parameter for unknown types
          definitions.push({
            name: 'value',
            type: 'float',
            displayName: 'Value',
            default: 0.0,
            description: 'Parameter value'
          });
        }
        break;
    }
    
    return definitions;
  }

  showNodeParameters(node) {
    this.selectedNode = node;
    this.panel.style.display = 'block';
    this.renderParameters(node);
  }

  hide() {
    this.panel.style.display = 'none';
    this.selectedNode = null;
  }

  renderParameters(node) {
    if (!node) {
      this.panel.innerHTML = '<div class="no-parameters">No node provided</div>';
      return;
    }

    // Get parameter definitions for this node type
    const parameterDefinitions = this.getParameterDefinitions(node);

    if (!parameterDefinitions || parameterDefinitions.length === 0) {
      this.panel.innerHTML = `
        <div class="no-parameters">
          <h3>${node.kind}</h3>
          <p>No parameters available for this node type.</p>
          <p>Node ID: ${node.id}</p>
        </div>
      `;
      return;
    }

    // Initialize node.params if it doesn't exist
    if (!node.params) {
      node.params = {};
    }

    // Initialize any missing parameters with defaults
    parameterDefinitions.forEach(param => {
      if (!(param.name in node.params)) {
        node.params[param.name] = param.default;
      }
    });

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = `${node.kind} Parameters`;
    title.style.cssText = `
      font-weight: bold;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #555;
      color: #4CAF50;
    `;

    this.panel.innerHTML = '';
    this.panel.appendChild(title);

    // Render each parameter
    parameterDefinitions.forEach(param => {
      this.renderParameter(param, node);
    });

    // Add expression help section
    this.addExpressionHelp();
  }

  renderParameter(param, node) {
    const paramContainer = document.createElement('div');
    paramContainer.className = 'parameter-container';
    paramContainer.style.cssText = `
      margin-bottom: 12px;
      padding: 8px;
      background: #333;
      border-radius: 4px;
      border-left: 3px solid #4CAF50;
    `;

    // Parameter label
    const label = document.createElement('label');
    label.className = 'parameter-label';
    label.textContent = param.displayName || param.name;
    label.style.cssText = `
      display: block;
      margin-bottom: 4px;
      font-weight: bold;
      color: #ccc;
    `;

    if (param.description) {
      label.title = param.description;
    }

    paramContainer.appendChild(label);

    // Input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'parameter-input-container';

    // Get appropriate input handler
    const handler = this.getInputHandler(param);
    if (handler) {
      try {
        handler.create(
          param, 
          node, 
          inputContainer, 
          label, 
          this.valueManager, 
          (action) => this.handleParameterUpdate(action)
        );
      } catch (error) {
        console.error(`Error creating input for parameter ${param.name}:`, error);
        this.createFallbackInput(param, node, inputContainer);
      }
    } else {
      this.createFallbackInput(param, node, inputContainer);
    }

    paramContainer.appendChild(inputContainer);

    // Add parameter info
    if (param.min !== undefined || param.max !== undefined) {
      const rangeInfo = document.createElement('div');
      rangeInfo.className = 'parameter-range';
      rangeInfo.textContent = `Range: ${param.min ?? '−∞'} to ${param.max ?? '∞'}`;
      rangeInfo.style.cssText = `
        font-size: 10px;
        color: #888;
        margin-top: 2px;
      `;
      paramContainer.appendChild(rangeInfo);
    }

    this.panel.appendChild(paramContainer);
  }

  getInputHandler(param) {
    let inputType = param.type;
    
    if (param.options && param.options.length > 0) {
      inputType = 'select';
    } else if (param.type === 'file' || param.accept) {
      inputType = 'file';
    }
    
    return this.inputHandlers[inputType] || this.inputHandlers.text;
  }

  createFallbackInput(param, node, container) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'param-input fallback-input';
    input.value = node.params?.[param.name] ?? param.default ?? '';
    input.placeholder = `Enter ${param.type}...`;
    
    input.style.cssText = `
      width: 100%;
      padding: 6px;
      background: #444;
      color: #fff;
      border: 1px solid #666;
      border-radius: 4px;
      font-size: 11px;
    `;

    input.addEventListener('change', (e) => {
      this.valueManager.setValue(node, param.name, e.target.value);
      this.handleParameterUpdate(`Fallback ${param.name}`);
    });

    container.appendChild(input);
  }

  addExpressionHelp() {
    const helpSection = document.createElement('div');
    helpSection.className = 'expression-help';
    helpSection.style.cssText = `
      margin-top: 16px;
      padding: 12px;
      background: #1a1a2e;
      border-radius: 4px;
      border: 1px solid #4CAF50;
    `;

    const helpTitle = document.createElement('div');
    helpTitle.textContent = 'Expression Help';
    helpTitle.style.cssText = `
      font-weight: bold;
      margin-bottom: 8px;
      color: #4CAF50;
    `;

    const helpContent = document.createElement('div');
    helpContent.innerHTML = `
      <div style="font-size: 10px; line-height: 1.4; color: #ccc;">
        <strong>Expression Syntax:</strong><br>
        • Start with <code>=</code> to create expressions<br>
        • Use <code>sin(x)</code>, <code>cos(x)</code>, <code>sqrt(x)</code>, etc.<br>
        • Access other parameters: <code>=radius * 2</code><br>
        • Use constants: <code>PI</code>, <code>E</code><br>
        • Utility functions: <code>clamp(x, 0, 1)</code>, <code>lerp(a, b, t)</code><br><br>
        
        <strong>Examples:</strong><br>
        • <code>=sin(nodeX * 0.1) * 10</code><br>
        • <code>=clamp(radius * 2, 0, 100)</code><br>
        • <code>=random() * PI</code><br><br>
        
        <strong>Tips:</strong><br>
        • Click <span style="background: #4CAF50; padding: 1px 4px; border-radius: 2px;">fx</span> to toggle expression mode<br>
        • Shift+drag numeric values to adjust<br>
        • Expressions update in real-time
      </div>
    `;

    helpSection.appendChild(helpTitle);
    helpSection.appendChild(helpContent);
    this.panel.appendChild(helpSection);
  }

  handleParameterUpdate(action) {
    console.log('Parameter updated:', action);
    
    // Trigger graph update
    if (this.eventSystem && this.eventSystem.emit) {
      this.eventSystem.emit('GRAPH_CHANGED', {
        action,
        source: 'parameter-panel'
      });
    }

    // FORCE PREVIEW UPDATE IMMEDIATELY
    if (this.selectedNode) {
      this.updateNodePreview(this.selectedNode);
      this.updateDependentExpressions(this.selectedNode);
    }

    // FORCE EDITOR REDRAW
    this.forceEditorUpdate();
  }

  updateNodePreview(node) {
    try {
      console.log('Updating preview for node:', node.id);
      
      // Clear preview cache completely
      if (window.editor?.previewSystem?.canvasManager) {
        window.editor.previewSystem.canvasManager.canvasCache.delete(node.id);
        console.log('Cleared preview cache for node:', node.id);
      }
      
      // Regenerate preview
      if (window.editor?.previewIntegration) {
        window.editor.previewIntegration.generateNodePreview(node);
        console.log('Regenerated preview for node:', node.id);
      }
      
    } catch (error) {
      console.warn(`Error updating preview for node ${node.id}:`, error);
    }
  }

  forceEditorUpdate() {
    try {
      // Multiple approaches to force editor update
      if (window.editor) {
        console.log('Forcing editor update...');
        
        // Clear all preview caches
        if (window.editor.previewSystem?.canvasManager?.canvasCache) {
          window.editor.previewSystem.canvasManager.canvasCache.clear();
          console.log('Cleared all preview caches');
        }
        
        // Force redraw
        if (window.editor.safeDraw) {
          window.editor.safeDraw();
          console.log('Called editor.safeDraw()');
        } else if (window.editor.draw) {
          window.editor.draw();
          console.log('Called editor.draw()');
        }
        
        // Trigger onChange if available
        if (window.editor.onChange) {
          window.editor.onChange('Parameter Panel Update');
          console.log('Called editor.onChange()');
        }
      }
    } catch (error) {
      console.warn('Error forcing editor update:', error);
    }
  }

  handleParameterChange(data) {
    const { node, parameterName, newValue } = data;
    
    this.expressionSystem.updateDependencies(node.id, parameterName, newValue);
    
    if (this.selectedNode && this.selectedNode.id === node.id) {
      this.refreshParameterDisplays();
    }
  }

  updateDependentExpressions(node) {
    if (this.textInputHandler.updateDependentInputs) {
      this.textInputHandler.updateDependentInputs(node.id);
    }
  }

  refreshParameterDisplays() {
    if (!this.selectedNode) return;

    const resultDisplays = this.panel.querySelectorAll('.expression-result');
    resultDisplays.forEach(display => {
      const container = display.closest('.parameter-container');
      const input = container?.querySelector('.param-input');
      if (input && this.expressionSystem.isExpression(input.value)) {
        const paramName = input.getAttribute('data-param');
        const validation = this.expressionSystem.validateExpression(
          input.value, 
          {}, 
          this.selectedNode
        );
        
        if (validation.valid) {
          display.textContent = `→ ${validation.result}`;
          display.style.color = '#4CAF50';
        } else {
          display.textContent = `Error: ${validation.error}`;
          display.style.color = '#f44336';
        }
      }
    });
  }

  // Legacy compatibility methods
  showParameters(node) {
    this.showNodeParameters(node);
  }

  show(node) {
    this.showNodeParameters(node);
  }

  hideParameters() {
    this.hide();
  }

  updateParameterValue(node, paramName, value) {
    if (this.valueManager) {
      this.valueManager.setValue(node, paramName, value);
      this.handleParameterUpdate(`Update ${paramName}`);
    }
  }

  // Public API methods
  isVisible() {
    return this.panel.style.display !== 'none';
  }

  getSelectedNode() {
    return this.selectedNode;
  }

  updateParameter(paramName, value) {
    if (this.selectedNode) {
      this.valueManager.setValue(this.selectedNode, paramName, value);
      this.handleParameterUpdate(`API Update: ${paramName}`);
    }
  }

  getParameterValue(paramName) {
    if (this.selectedNode) {
      return this.valueManager.getValue(this.selectedNode, paramName);
    }
    return null;
  }

  // Expression system integration methods
  evaluateExpression(expression, context = {}) {
    return this.expressionSystem.evaluateExpression(expression, context, this.selectedNode);
  }

  validateExpression(expression, context = {}) {
    return this.expressionSystem.validateExpression(expression, context, this.selectedNode);
  }

  clearExpressionCache() {
    this.expressionSystem.clearCache();
    this.refreshParameterDisplays();
  }

  getExpressionStats() {
    return this.expressionSystem.getCacheStats();
  }

  // Integration with existing editor callbacks
  setOnChange(callback) {
    this.onChangeCallback = callback;
  }

  // Integration point for existing parameter value management
  getNodeParameterValue(node, paramName, defaultValue) {
    if (this.valueManager) {
      return this.valueManager.getValue(node, paramName) ?? defaultValue;
    }
    return node.params?.[paramName] ?? defaultValue;
  }

  setNodeParameterValue(node, paramName, value) {
    if (this.valueManager) {
      this.valueManager.setValue(node, paramName, value);
    } else {
      if (!node.params) node.params = {};
      node.params[paramName] = value;
    }
  }

  // Check if parameter has connected input (used by renderers)
  hasConnectedInput(node, paramName) {
    const inputSlots = node.inputs || [];
    const paramDef = node.parameterDefinitions?.find(p => p.name === paramName);
    
    if (paramDef && paramDef.inputSlot !== undefined) {
      return inputSlots[paramDef.inputSlot] !== null;
    }
    
    return false;
  }

  destroy() {
    if (this.panel) {
      this.panel.remove();
    }
    
    if (this.textInputHandler && this.textInputHandler.destroy) {
      this.textInputHandler.destroy();
    }
    
    if (this.eventSystem && this.eventSystem.off) {
      this.eventSystem.off('NODE_SELECTED');
      this.eventSystem.off('NODE_DESELECTED');
      this.eventSystem.off('PARAMETER_CHANGED');
    }
  }
}