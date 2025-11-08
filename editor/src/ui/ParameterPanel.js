// src/ui/ParameterPanel.js - Clean implementation with binding support

import { ExpressionTextInputHandler, ExpressionParameterValueManager, expressionSystem, expressionStyles } from '../utils/ParameterExpressionSystem.js';
import { SelectInputHandler } from './components/SelectInputHandler.js';
import { FileInputHandler } from './components/FileInputHandler.js';
import { ParameterBindingSystem } from '../utils/ParameterBindingSystem.js';
import { ColorStopInputHandler } from './components/ColorStopInputHandler.js';
import { BooleanInputHandler } from './components/BooleanInputHandler.js';
import { WGSLCodeInputHandler } from './components/WGSLCodeInputHandler.js';

export class ParameterPanel {
  constructor(eventSystem, undoManager, graph) {
    this.colorStopInputHandler = new ColorStopInputHandler(undoManager);
    this.booleanInputHandler = new BooleanInputHandler(undoManager);
    this.eventSystem = eventSystem;
    this.undoManager = undoManager;
    this.graph = graph;
    this.selectedNode = null;
    this.panel = null;
    this.panelContent = null;
    this.resizeHandle = null;
    this._onResizeMouseDown = null;
    this._onResizeMouseMove = null;
    this._onResizeMouseUp = null;
    this._preResizeUserSelect = null;
    this._onWindowResize = null;
    this.minPanelWidth = 220;
    this.minPanelHeight = 220;
    this.expressionSystem = expressionSystem;
    this._pendingPreviewUpdates = new Map();
    this._previewFrame = null;
    this._outputRebuildTimeout = null;

    // Initialize binding system
    this.bindingSystem = new ParameterBindingSystem(graph, eventSystem, undoManager);

    this.expressionSystem.startAnimationLoop();

    // Initialize expression system components
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

    // Initialize WGSL code editor handler (device will be set later)
    this.wgslCodeInputHandler = new WGSLCodeInputHandler(undoManager);

    // Input handlers mapping
    this.inputHandlers = {
      text: this.textInputHandler,
      float: this.textInputHandler,
      int: this.textInputHandler,
      expression: this.textInputHandler,
      select: this.selectInputHandler,
      file: this.fileInputHandler,
      colorstops: this.colorStopInputHandler,
      boolean: this.booleanInputHandler,
      'wgsl-code': this.wgslCodeInputHandler
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
      width: 320px;
      min-width: 220px;
      min-height: 220px;
      max-height: calc(100vh - 20px);
      background: #2b2b2b;
      border: 1px solid #555;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #fff;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
    `;
    this.panel.style.display = 'none';

    this.panelContent = document.createElement('div');
    this.panelContent.className = 'parameter-panel__content';
    this.panelContent.style.cssText = `
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 4px;
    `;

    this.panel.appendChild(this.panelContent);
    this.createResizeHandle();
    document.body.appendChild(this.panel);
    this.restorePanelSize();
  }

  createResizeHandle() {
    if (!this.panel) {
      return;
    }

    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'parameter-panel__resize-handle';
    this.resizeHandle.style.cssText = `
      position: absolute;
      width: 14px;
      height: 14px;
      right: 6px;
      bottom: 6px;
      cursor: nwse-resize;
      border-radius: 3px;
      background: linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 50%, rgba(0,0,0,0.3) 100%);
    `;

    this.panel.appendChild(this.resizeHandle);

    let startWidth = 0;
    let startHeight = 0;
    let startX = 0;
    let startY = 0;

    this._onResizeMouseMove = (event) => {
      if (!this.panel) return;

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      const maxWidth = Math.max(this.minPanelWidth, window.innerWidth - 20);
      const maxHeight = Math.max(this.minPanelHeight, window.innerHeight - 20);

      let nextWidth = startWidth - deltaX;
      let nextHeight = startHeight + deltaY;

      nextWidth = Math.min(Math.max(nextWidth, this.minPanelWidth), maxWidth);
      nextHeight = Math.min(Math.max(nextHeight, this.minPanelHeight), maxHeight);

      this.panel.style.width = `${Math.round(nextWidth)}px`;
      this.panel.style.height = `${Math.round(nextHeight)}px`;
    };

    this._onResizeMouseUp = () => {
      document.removeEventListener('mousemove', this._onResizeMouseMove);
      document.removeEventListener('mouseup', this._onResizeMouseUp);

      if (this._preResizeUserSelect !== null) {
        document.body.style.userSelect = this._preResizeUserSelect;
        this._preResizeUserSelect = null;
      }

      this.savePanelSize();
    };

    this._onResizeMouseDown = (event) => {
      event.preventDefault();

      if (!this.panel) return;

      startWidth = this.panel.offsetWidth;
      startHeight = this.panel.offsetHeight;
      startX = event.clientX;
      startY = event.clientY;

      this._preResizeUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', this._onResizeMouseMove);
      document.addEventListener('mouseup', this._onResizeMouseUp);
    };

    this.resizeHandle.addEventListener('mousedown', this._onResizeMouseDown);
  }

  clampPanelSizeToViewport() {
    if (!this.panel) {
      return;
    }

    const maxWidth = Math.max(this.minPanelWidth, window.innerWidth - 20);
    const maxHeight = Math.max(this.minPanelHeight, window.innerHeight - 20);

    let currentWidth = this.panel.offsetWidth;
    let currentHeight = this.panel.offsetHeight;

    if (!currentWidth) {
      const parsedWidth = parseFloat(this.panel.style.width);
      currentWidth = Number.isFinite(parsedWidth) ? parsedWidth : this.minPanelWidth;
    }

    if (!currentHeight) {
      const parsedHeight = parseFloat(this.panel.style.height);
      currentHeight = Number.isFinite(parsedHeight) ? parsedHeight : this.minPanelHeight;
    }

    const clampedWidth = Math.min(Math.max(currentWidth, this.minPanelWidth), maxWidth);
    const clampedHeight = Math.min(Math.max(currentHeight, this.minPanelHeight), maxHeight);

    this.panel.style.width = `${Math.round(clampedWidth)}px`;
    this.panel.style.height = `${Math.round(clampedHeight)}px`;
  }

  savePanelSize() {
    if (!this.panel) {
      return;
    }

    const size = {
      width: this.panel.offsetWidth,
      height: this.panel.offsetHeight
    };

    try {
      localStorage.setItem('glsl-node-editor.parameter-panel.size', JSON.stringify(size));
    } catch (error) {
      console.warn('Unable to persist parameter panel size:', error);
    }
  }

  restorePanelSize() {
    if (!this.panel) {
      return;
    }

    try {
      const stored = localStorage.getItem('glsl-node-editor.parameter-panel.size');
      if (stored) {
        const size = JSON.parse(stored);
        if (size && Number.isFinite(size.width)) {
          const width = Math.min(Math.max(size.width, this.minPanelWidth), Math.max(this.minPanelWidth, window.innerWidth - 20));
          this.panel.style.width = `${Math.round(width)}px`;
        }
        if (size && Number.isFinite(size.height)) {
          const height = Math.min(Math.max(size.height, this.minPanelHeight), Math.max(this.minPanelHeight, window.innerHeight - 20));
          this.panel.style.height = `${Math.round(height)}px`;
        }
      } else {
        this.panel.style.height = '';
      }
    } catch (error) {
      console.warn('Unable to restore parameter panel size:', error);
    }

    this.clampPanelSizeToViewport();
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

      // Listen for binding events
      this.eventSystem.on('BINDING_CREATED', (data) => {
        console.log('Binding created:', data);
        if (this.selectedNode && 
            (this.selectedNode.id === data.sourceNodeId || this.selectedNode.id === data.targetNodeId)) {
          this.renderParameters(this.selectedNode);
        }
      });

      this.eventSystem.on('BINDING_REMOVED', (data) => {
        console.log('Binding removed:', data);
        if (this.selectedNode && 
            (this.selectedNode.id === data.sourceNodeId || this.selectedNode.id === data.targetNodeId)) {
          this.renderParameters(this.selectedNode);
        }
      });
    }

    if (!this._onWindowResize) {
      this._onWindowResize = () => {
        this.clampPanelSizeToViewport();
        this.savePanelSize();
      };
    }
    window.addEventListener('resize', this._onWindowResize);

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.panel.style.display === 'none') {
        return;
      }

      if (this.panel.contains(e.target) || e.target.closest('.node')) {
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && this.panel.contains(activeElement)) {
        return;
      }

      this.hide();
    });

    // Add keyboard shortcuts for binding
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'C' || e.key === 'c') {
          e.preventDefault();
          const selectedParam = this.getSelectedParameter();
          if (selectedParam && this.selectedNode) {
            this.copyParameterReference(this.selectedNode, selectedParam);
          }
        } else if (e.key === 'V' || e.key === 'v') {
          e.preventDefault();
          const selectedParam = this.getSelectedParameter();
          if (selectedParam && this.selectedNode) {
            this.pasteParameterReference(this.selectedNode, selectedParam);
          }
        }
      }
    });
  }

  // Get parameter definitions based on node type
  getParameterDefinitions(node) {
    if (node.parameterDefinitions && node.parameterDefinitions.length > 0) {
      return node.parameterDefinitions;
    }

    const definitions = [];
    
    switch (node.kind.toLowerCase()) {
      case 'lineargradient':
  definitions.push(
    { 
      name: 'angle', 
      type: 'float', 
      displayName: 'Angle (rad)', 
      default: 0.0, 
      min: 0, 
      max: 6.28318, 
      description: 'Gradient rotation angle in radians' 
    },
    { 
      name: 'offset', 
      type: 'float', 
      displayName: 'Offset', 
      default: 0.0, 
      min: -2.0, 
      max: 2.0, 
      description: 'Shifts the gradient position' 
    },
    { 
      name: 'scale', 
      type: 'float', 
      displayName: 'Scale', 
      default: 1.0, 
      min: 0.1, 
      max: 10.0, 
      description: 'Scales the gradient frequency' 
    },
    { 
      name: 'repeat', 
      type: 'boolean', 
      displayName: 'Repeat', 
      default: false, 
      description: 'Tile the gradient pattern' 
    }
  );
  break;

case 'radialgradient':
  definitions.push(
    { 
      name: 'centerX', 
      type: 'float', 
      displayName: 'Center X', 
      default: 0.5, 
      min: 0, 
      max: 1, 
      description: 'Horizontal center position' 
    },
    { 
      name: 'centerY', 
      type: 'float', 
      displayName: 'Center Y', 
      default: 0.5, 
      min: 0, 
      max: 1, 
      description: 'Vertical center position' 
    },
    { 
      name: 'radius', 
      type: 'float', 
      displayName: 'Radius', 
      default: 0.5, 
      min: 0.01, 
      max: 2.0, 
      description: 'Gradient radius' 
    },
    { 
      name: 'falloff', 
      type: 'float', 
      displayName: 'Falloff', 
      default: 1.0, 
      min: 0.1, 
      max: 5.0, 
      description: 'Controls gradient falloff curve' 
    },
    { 
      name: 'invert', 
      type: 'boolean', 
      displayName: 'Invert', 
      default: false, 
      description: 'Reverse gradient direction' 
    }
  );
  break;

case 'angulargradient':
  definitions.push(
    { 
      name: 'centerX', 
      type: 'float', 
      displayName: 'Center X', 
      default: 0.5, 
      min: 0, 
      max: 1, 
      description: 'Horizontal center position' 
    },
    { 
      name: 'centerY', 
      type: 'float', 
      displayName: 'Center Y', 
      default: 0.5, 
      min: 0, 
      max: 1, 
      description: 'Vertical center position' 
    },
    { 
      name: 'rotation', 
      type: 'float', 
      displayName: 'Rotation (rad)', 
      default: 0.0, 
      min: 0, 
      max: 6.28318, 
      description: 'Starting angle rotation' 
    },
    { 
      name: 'repeat', 
      type: 'float', 
      displayName: 'Repeat', 
      default: 1.0, 
      min: 1.0, 
      max: 20.0, 
      description: 'Number of gradient repetitions' 
    }
  );
  break;

case 'conicgradient':
  definitions.push(
    { 
      name: 'centerX', 
      type: 'float', 
      displayName: 'Center X', 
      default: 0.5, 
      min: 0, 
      max: 1, 
      description: 'Horizontal center position' 
    },
    { 
      name: 'centerY', 
      type: 'float', 
      displayName: 'Center Y', 
      default: 0.5, 
      min: 0, 
      max: 1, 
      description: 'Vertical center position' 
    },
    { 
      name: 'startAngle', 
      type: 'float', 
      displayName: 'Start Angle (rad)', 
      default: 0.0, 
      min: 0, 
      max: 6.28318, 
      description: 'Gradient start angle' 
    },
    { 
      name: 'endAngle', 
      type: 'float', 
      displayName: 'End Angle (rad)', 
      default: 6.28318, 
      min: 0, 
      max: 6.28318, 
      description: 'Gradient end angle' 
    },
    { 
      name: 'smoothness', 
      type: 'float', 
      displayName: 'Smoothness', 
      default: 0.0, 
      min: 0, 
      max: 1.0, 
      description: 'Smooth interpolation amount' 
    }
  );
  break;

case 'colorramp':
  definitions.push(
    {
      name: 'stops',
      type: 'colorstops',
      displayName: 'Color Stops',
      default: [
        { position: 0.0, color: [0, 0, 0, 1] },
        { position: 1.0, color: [1, 1, 1, 1] }
      ],
      description: 'Gradient color stops'
    },
    {
      name: 'mode',
      type: 'select',
      displayName: 'Interpolation',
      options: ['Linear', 'Step', 'Smooth'],
      default: 'Linear',
      description: 'Color interpolation mode'
    }
  );
  break;
      case 'colorramp':
  definitions.push(
    {
      name: 'stops',
      type: 'colorstops',
      displayName: 'Color Stops',
      default: [
        { position: 0.0, color: [0, 0, 0, 1] },
        { position: 1.0, color: [1, 1, 1, 1] }
      ],
      description: 'Gradient color stops'
    },
    {
      name: 'mode',
      type: 'select',
      displayName: 'Interpolation',
      options: ['Linear', 'Step', 'Smooth'],
      default: 'Linear',
      description: 'Interpolation mode'
    }
  );
  break;
case 'lineargradient':
  definitions.push(
    { name: 'angle', type: 'float', displayName: 'Angle', default: 0.0, min: 0, max: 6.28318, description: 'Gradient angle in radians' },
    { name: 'offset', type: 'float', displayName: 'Offset', default: 0.0, description: 'Gradient offset' },
    { name: 'scale', type: 'float', displayName: 'Scale', default: 1.0, min: 0.1, max: 10.0, description: 'Gradient scale' },
    { name: 'repeat', type: 'boolean', displayName: 'Repeat', default: false, description: 'Repeat gradient' }
  );
  break;

case 'radialgradient':
  definitions.push(
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, min: 0, max: 1, description: 'Center X position' },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, min: 0, max: 1, description: 'Center Y position' },
    { name: 'radius', type: 'float', displayName: 'Radius', default: 0.5, min: 0.01, max: 2.0, description: 'Gradient radius' },
    { name: 'falloff', type: 'float', displayName: 'Falloff', default: 1.0, min: 0.1, max: 5.0, description: 'Falloff power' },
    { name: 'invert', type: 'boolean', displayName: 'Invert', default: false, description: 'Invert gradient' }
  );
  break;

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
        case 'rectfield':
case 'rectangle':
  definitions.push(
    {
      name: 'width',
      type: 'float',
      displayName: 'Width',
      default: 0.5,
      min: 0.01,
      max: 2.0,
      description: 'Rectangle width'
    },
    {
      name: 'height',
      type: 'float',
      displayName: 'Height',
      default: 0.3,
      min: 0.01,
      max: 2.0,
      description: 'Rectangle height'
    },
    {
      name: 'centerX',
      type: 'float',
      displayName: 'Center X',
      default: 0.5,
      min: 0.0,
      max: 1.0,
      description: 'Rectangle center X position'
    },
    {
      name: 'centerY',
      type: 'float',
      displayName: 'Center Y',
      default: 0.5,
      min: 0.0,
      max: 1.0,
      description: 'Rectangle center Y position'
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
case 'circle':
case 'circlefield':
  definitions.push(
    {
      name: 'radius',
      type: 'float',
      displayName: 'Radius',
      default: 0.25,
      min: 0.0,
      max: 2.0
    },
    {
      name: 'epsilon',
      type: 'float',
      displayName: 'Softness',
      default: 0.02,
      min: 0.001,  // Minimum is 0.001, but value might still be 0
      max: 0.1
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
        // In src/ui/ParameterPanel.js, find the getParameterDefinitions method
// and add these cases to the switch statement:

case 'transform2d':
  definitions.push(
    { name: 'translateX', type: 'float', displayName: 'Translate X', default: 0.0, description: 'Horizontal translation' },
    { name: 'translateY', type: 'float', displayName: 'Translate Y', default: 0.0, description: 'Vertical translation' },
    { name: 'scaleX', type: 'float', displayName: 'Scale X', default: 1.0, min: 0.01, description: 'Horizontal scale' },
    { name: 'scaleY', type: 'float', displayName: 'Scale Y', default: 1.0, min: 0.01, description: 'Vertical scale' },
    { name: 'rotation', type: 'float', displayName: 'Rotation (rad)', default: 0.0, description: 'Rotation angle' },
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, description: 'Rotation center X' },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, description: 'Rotation center Y' }
  );
  break;

case 'scale2d':
  definitions.push(
    { name: 'scaleX', type: 'float', displayName: 'Scale X', default: 1.0, min: 0.01, description: 'Horizontal scale' },
    { name: 'scaleY', type: 'float', displayName: 'Scale Y', default: 1.0, min: 0.01, description: 'Vertical scale' },
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, description: 'Scale center X' },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, description: 'Scale center Y' }
  );
  break;

case 'rotate2d':
  definitions.push(
    { name: 'rotation', type: 'float', displayName: 'Rotation (rad)', default: 0.0, description: 'Rotation angle' },
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, description: 'Rotation center X' },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, description: 'Rotation center Y' }
  );
  break;

case 'translate2d':
  definitions.push(
    { name: 'translateX', type: 'float', displayName: 'Translate X', default: 0.0, description: 'Horizontal offset' },
    { name: 'translateY', type: 'float', displayName: 'Translate Y', default: 0.0, description: 'Vertical offset' }
  );
  break;

case 'tileandoffset':
  definitions.push(
    { name: 'tilingX', type: 'float', displayName: 'Tiling X', default: 1.0, min: 0.01, description: 'Horizontal tiling' },
    { name: 'tilingY', type: 'float', displayName: 'Tiling Y', default: 1.0, min: 0.01, description: 'Vertical tiling' },
    { name: 'offsetX', type: 'float', displayName: 'Offset X', default: 0.0, description: 'Horizontal offset' },
    { name: 'offsetY', type: 'float', displayName: 'Offset Y', default: 0.0, description: 'Vertical offset' }
  );
  break;

case 'flip2d':
  definitions.push(
    { name: 'flipX', type: 'boolean', displayName: 'Flip X', default: false, description: 'Mirror horizontally' },
    { name: 'flipY', type: 'boolean', displayName: 'Flip Y', default: false, description: 'Mirror vertically' }
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
        
        case 'colormix':
          definitions.push({
            name: 'mode',
            type: 'select',
            displayName: 'Blend Mode',
            options: [
              'mix',
              'multiply',
              'screen',
              'overlay',
              'add',
              'subtract',
              'divide',
              'difference',
              'darken',
              'lighten'
            ],
            default: node.params?.mode ?? 'mix',
            description: 'Choose how the blend color combines with the base color'
          });
          break;

        // Compute nodes with WGSL editor
        case 'computenoise':
        case 'computeblur':
        case 'computeparticles':
        case 'computefeedback':
        case 'computereactiondiffusion':
        case 'computefluidsim':
        case 'computeconvolution':
        case 'computecellular':
          // Add WGSL code editor parameter
          definitions.push({
            name: 'wgslSource',
            type: 'wgsl-code',
            displayName: 'WGSL Shader Code',
            default: node.wgslSource || '',
            description: 'WGSL compute shader source code'
          });

          // Add standard compute parameters if they exist in the node
          if (node.params) {
            Object.keys(node.params).forEach(key => {
              // Skip wgslSource as it's already added
              if (key === 'wgslSource') return;

              const value = node.params[key];
              let inferredType = 'text';

              if (typeof value === 'number') {
                inferredType = Number.isInteger(value) ? 'int' : 'float';
              } else if (typeof value === 'boolean') {
                inferredType = 'boolean';
              }

              definitions.push({
                name: key,
                type: inferredType,
                displayName: key.charAt(0).toUpperCase() + key.slice(1),
                default: value,
                description: `${key} parameter`
              });
            });
          }
          break;

        default:
        if (node.params && Object.keys(node.params).length > 0) {
          Object.keys(node.params).forEach(key => {
            const value = node.params[key];
            let inferredType = 'text';

            if (typeof value === 'number') {
              inferredType = Number.isInteger(value) ? 'int' : 'float';
            } else if (typeof value === 'boolean') {
              inferredType = 'boolean';
            }

            definitions.push({
              name: key,
              type: inferredType,
              displayName: key.charAt(0).toUpperCase() + key.slice(1),
              default: value,
              description: `${key} parameter`
            });
          });
        } else {
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

  /**
   * Set the WebGPU device for WGSL compilation checking
   */
  setDevice(device) {
    if (this.wgslCodeInputHandler) {
      this.wgslCodeInputHandler.setDevice(device);
      console.log('[ParameterPanel] WebGPU device set for WGSL editor');
    }
  }

  showNodeParameters(node) {
    this.selectedNode = node;
    this.panel.style.display = 'flex';
    this.renderParameters(node);
  }

  updateParameterDisplay(node, paramName, value) {
    if (!node) return;
    if (!node.params) node.params = {};
    node.params[paramName] = value;

    if (this.selectedNode && this.selectedNode.id === node.id) {
      this.renderParameters(node);
    }
  }

  hide() {
    this.panel.style.display = 'none';
    this.selectedNode = null;
  }

  // Refresh the current node's parameter display (e.g., when connections change)
  refreshCurrentNode() {
    if (this.selectedNode) {
      this.renderParameters(this.selectedNode);
    }
  }

  renderParameters(node) {
    if (!node) {
      this.panelContent.innerHTML = '<div class="no-parameters">No node provided</div>';
      return;
    }

    const parameterDefinitions = this.getParameterDefinitions(node);

    if (!parameterDefinitions || parameterDefinitions.length === 0) {
      this.panelContent.innerHTML = `
        <div class="no-parameters">
          <h3>${node.kind}</h3>
          <p>No parameters available for this node type.</p>
          <p>Node ID: ${node.id}</p>
        </div>
      `;
      return;
    }

    if (!node.params) {
      node.params = {};
    }

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

    this.panelContent.innerHTML = '';
    this.panelContent.appendChild(title);

    parameterDefinitions.forEach(param => {
      this.renderParameter(param, node);
    });

    this.addExpressionHelp();
  }

  renderParameter(param, node) {
    const paramContainer = document.createElement('div');
    paramContainer.className = 'parameter-container';
    
    // Get binding info
    const bindingInfo = this.bindingSystem ? 
      this.bindingSystem.getBindingInfo(node.id, param.name) : 
      { isBound: false, hasTargets: false };
    
    paramContainer.style.cssText = `
      margin-bottom: 12px;
      padding: 8px;
      background: ${bindingInfo.isBound ? '#2a2a4a' : '#333'};
      border-radius: 4px;
      border-left: 3px solid ${bindingInfo.isBound ? '#ff9800' : '#4CAF50'};
      position: relative;
    `;

    // Create label container
    const labelContainer = document.createElement('div');
    labelContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    `;

    const label = document.createElement('label');
    label.className = 'parameter-label';
    label.textContent = param.displayName || param.name;
    label.style.cssText = `
      font-weight: bold;
      color: ${bindingInfo.isBound ? '#ff9800' : '#ccc'};
    `;

    if (param.description) {
      label.title = param.description;
    }

    labelContainer.appendChild(label);

    // Add binding controls
    if (this.bindingSystem) {
      const bindingControls = this.createBindingControls(param, node, bindingInfo);
      labelContainer.appendChild(bindingControls);
    }

    paramContainer.appendChild(labelContainer);

    // Add binding status if needed
    if (this.bindingSystem && (bindingInfo.isBound || bindingInfo.hasTargets)) {
      const bindingStatus = this.createBindingStatus(param, node, bindingInfo);
      paramContainer.appendChild(bindingStatus);
    }

    // Input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'parameter-input-container';

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
        
        // Disable input if parameter is bound
        if (bindingInfo.isBound) {
          const input = inputContainer.querySelector('.param-input');
          if (input) {
            input.disabled = true;
            input.style.opacity = '0.6';
            input.title = `Bound to ${bindingInfo.source.nodeId}.${bindingInfo.source.parameterName}`;
          }
        }
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

    this.panelContent.appendChild(paramContainer);
  }

  createBindingControls(param, node, bindingInfo) {
    const controls = document.createElement('div');
    controls.className = 'binding-controls';
    controls.style.cssText = `
      display: flex;
      gap: 2px;
    `;

    // Copy reference button
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'binding-btn copy-ref-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy as reference (Ctrl+Shift+C)';
    copyBtn.style.cssText = `
      width: 18px;
      height: 18px;
      background: #2196F3;
      border: none;
      border-radius: 3px;
      color: white;
      cursor: pointer;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyParameterReference(node, param);
    });

    // Paste reference button
    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'binding-btn paste-ref-btn';
    pasteBtn.innerHTML = '📎';
    pasteBtn.title = 'Paste reference (Ctrl+Shift+V)';
    pasteBtn.style.cssText = `
      width: 18px;
      height: 18px;
      background: #4CAF50;
      border: none;
      border-radius: 3px;
      color: white;
      cursor: pointer;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    pasteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pasteParameterReference(node, param);
    });

    // Unbind button (only show if parameter is bound)
    if (bindingInfo.isBound) {
      const unbindBtn = document.createElement('button');
      unbindBtn.type = 'button';
      unbindBtn.className = 'binding-btn unbind-btn';
      unbindBtn.innerHTML = '🔗';
      unbindBtn.title = 'Remove binding';
      unbindBtn.style.cssText = `
        width: 18px;
        height: 18px;
        background: #f44336;
        border: none;
        border-radius: 3px;
        color: white;
        cursor: pointer;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      unbindBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeParameterBinding(node, param);
      });

      controls.appendChild(unbindBtn);
    }

    controls.appendChild(copyBtn);
    controls.appendChild(pasteBtn);

    return controls;
  }

  createBindingStatus(param, node, bindingInfo) {
    const status = document.createElement('div');
    status.className = 'binding-status';
    status.style.cssText = `
      font-size: 9px;
      margin-bottom: 4px;
      padding: 2px 4px;
      border-radius: 2px;
      background: rgba(0,0,0,0.2);
    `;

    if (bindingInfo.isBound) {
      const sourceNode = this.graph.nodes.find(n => n.id === bindingInfo.source.nodeId);
      const sourceNodeName = sourceNode ? sourceNode.kind : 'Unknown';
      
      status.innerHTML = `
        <span style="color: #ff9800;">⬅ Bound to:</span> 
        <span style="color: #fff;">${sourceNodeName}.${bindingInfo.source.parameterName}</span>
      `;
    }

    if (bindingInfo.hasTargets) {
      const targetCount = bindingInfo.targets.length;
      const targetsText = targetCount === 1 ? '1 parameter' : `${targetCount} parameters`;
      
      const targetInfo = document.createElement('div');
      targetInfo.innerHTML = `
        <span style="color: #4CAF50;">➡ Controls:</span> 
        <span style="color: #fff;">${targetsText}</span>
      `;
      
      if (bindingInfo.isBound) {
        status.appendChild(document.createElement('br'));
      }
      status.appendChild(targetInfo);
    }

    return status;
  }

  copyParameterReference(node, param) {
    this.bindingSystem.clipboard = {
      nodeId: node.id,
      parameterName: param.name,
      nodeKind: node.kind,
      timestamp: Date.now()
    };

    this.showToast(`Copied ${node.kind}.${param.name} as reference`, 'success');
  }

  pasteParameterReference(node, param) {
    if (!this.bindingSystem.clipboard) {
      this.showToast('No parameter reference in clipboard', 'warning');
      return;
    }

    const success = this.bindingSystem.createBinding(
      this.bindingSystem.clipboard.nodeId,
      this.bindingSystem.clipboard.parameterName,
      node.id,
      param.name
    );

    if (success) {
      this.showToast(`Bound ${param.name} to ${this.bindingSystem.clipboard.nodeKind}.${this.bindingSystem.clipboard.parameterName}`, 'success');
      this.renderParameters(node);
    } else {
      this.showToast('Failed to create binding', 'error');
    }
  }

  removeParameterBinding(node, param) {
    const bindingInfo = this.bindingSystem.getBindingInfo(node.id, param.name);
    
    if (bindingInfo.isBound) {
      const success = this.bindingSystem.removeBinding(
        bindingInfo.source.nodeId,
        bindingInfo.source.parameterName,
        node.id,
        param.name
      );

      if (success) {
        this.showToast(`Removed binding from ${param.name}`, 'success');
        this.renderParameters(node);
      }
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    const colors = {
      success: '#4CAF50',
      warning: '#ff9800',
      error: '#f44336',
      info: '#2196F3'
    };
    
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${colors[type]};
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      opacity: 0;
      transition: opacity 0.3s;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '1';
    }, 10);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  getSelectedParameter() {
    const focusedInput = this.panel.querySelector('.param-input:focus');
    if (focusedInput) {
      const paramName = focusedInput.getAttribute('data-param');
      
      if (this.selectedNode && paramName) {
        const paramDef = this.getParameterDefinitions(this.selectedNode)
          .find(p => p.name === paramName);
        return paramDef;
      }
    }
    return null;
  }

getInputHandler(param) {
  let inputType = param.type;
  
  if (param.type === 'boolean') {
    inputType = 'boolean';
  } else if (param.options && param.options.length > 0) {
    inputType = 'select';
  } else if (param.type === 'file' || param.accept) {
    inputType = 'file';
  } else if (param.type === 'colorstops') {
    inputType = 'colorstops';
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
        • Click copy button to copy parameter as reference<br>
        • Use Ctrl+Shift+C/V for keyboard shortcuts<br>
        • Bound parameters show orange highlighting
      </div>
    `;

    helpSection.appendChild(helpTitle);
    helpSection.appendChild(helpContent);
    this.panelContent.appendChild(helpSection);
  }

handleParameterUpdate(action) {
  console.log('Parameter updated:', action);

  // Extract fields safely from the action object
  const name = action?.parameterName || action?.name || "";
  const value = action?.newValue ?? action?.value ?? 0;

  // Warn for negative geometry parameters
  if (Number(value) < 0 && name === "radius") {
    StatusManager.warn("Radius cannot be negative – auto-corrected");
  }

  // Clear any existing timeout
  if (this._updateTimeout) {
    clearTimeout(this._updateTimeout);
  }

  // Debounce updates
  this._updateTimeout = setTimeout(() => {
    if (this.eventSystem?.emit) {
      this.eventSystem.emit("GRAPH_CHANGED", {
        action,
        source: "parameter-panel",
      });
    }

    if (this.selectedNode) {
      this.updateNodePreview(this.selectedNode);
    }
  }, 100);
}


updateNodePreview(node) {
  if (!node) {
    return;
  }

  this._pendingPreviewUpdates.set(node.id, node);

  if (this._previewFrame) {
    return;
  }

  this._previewFrame = requestAnimationFrame(() => {
    const queuedUpdates = Array.from(this._pendingPreviewUpdates.values());
    this._pendingPreviewUpdates.clear();
    this._previewFrame = null;

    queuedUpdates.forEach((queuedNode) => {
      this._processPreviewUpdate(queuedNode);
    });
  });
}

_processPreviewUpdate(node) {
  try {
    console.log('Updating preview for node:', node.id);
    
    if (window.editor?.previewSystem?.canvasManager) {
      window.editor.previewSystem.canvasManager.canvasCache.delete(node.id);
      console.log('Cleared preview cache for node:', node.id);
    }
    
    if (window.editor?.previewIntegration) {
      window.editor.previewIntegration.generateNodePreview(node);
      console.log('Regenerated preview for node:', node.id);
      
      if (window.editor?.graph?.nodes) {
        const downstreamNodes = window.editor.graph.nodes.filter(n => 
          n.inputs && Array.isArray(n.inputs) && n.inputs.includes(node.id)
        );
        
        console.log(`Found ${downstreamNodes.length} downstream nodes for ${node.id}`);
        
        downstreamNodes.forEach(downstreamNode => {
          if (!downstreamNode || downstreamNode.id === node.id) {
            return;
          }
          console.log('Queuing downstream node update:', downstreamNode.id);
          if (window.editor?.previewSystem?.canvasManager) {
            window.editor.previewSystem.canvasManager.canvasCache.delete(downstreamNode.id);
          }
          this.updateNodePreview(downstreamNode);
        });
        
        // CRITICAL: Recursively check ALL downstream nodes for OutputFinal
        const hasOutputInChain = (nodeId, visited = new Set()) => {
          if (visited.has(nodeId)) return false;
          visited.add(nodeId);
          
          const currentNode = window.editor.graph.nodes.find(n => n.id === nodeId);
          if (!currentNode) return false;
          
          if (currentNode.kind.toLowerCase() === 'outputfinal') {
            return true;
          }
          
          const downstream = window.editor.graph.nodes.filter(n => 
            n.inputs && Array.isArray(n.inputs) && n.inputs.includes(nodeId)
          );
          
          return downstream.some(n => hasOutputInChain(n.id, visited));
        };
        
        if (hasOutputInChain(node.id) && window.editor.onChange) {
          console.log('OutputFinal found in downstream chain - scheduling shader recompilation');
          if (this._outputRebuildTimeout) {
            clearTimeout(this._outputRebuildTimeout);
          }
          this._outputRebuildTimeout = setTimeout(() => {
            this._outputRebuildTimeout = null;
            window.editor.onChange('Parameter update affecting output');
          }, 150);
        }
      }
    }
    
  } catch (error) {
    console.warn(`Error updating preview for node ${node.id}:`, error);
  }
}

  forceEditorUpdate() {
    try {
      if (window.editor) {
        console.log('Forcing editor update...');
        
        if (window.editor.previewSystem?.canvasManager?.canvasCache) {
          window.editor.previewSystem.canvasManager.canvasCache.clear();
          console.log('Cleared all preview caches');
        }
        
        if (window.editor.safeDraw) {
          window.editor.safeDraw();
          console.log('Called editor.safeDraw()');
        } else if (window.editor.draw) {
          window.editor.draw();
          console.log('Called editor.draw()');
        }
        
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
  // DISABLED: This was causing infinite preview loops
  // if (this.textInputHandler.updateDependentInputs) {
  //   this.textInputHandler.updateDependentInputs(node.id);
  // }
  
  // Just refresh the displayed values in the parameter panel
  this.refreshParameterDisplays();
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
    if (this.resizeHandle && this._onResizeMouseDown) {
      this.resizeHandle.removeEventListener('mousedown', this._onResizeMouseDown);
    }
    if (this._onResizeMouseMove) {
      document.removeEventListener('mousemove', this._onResizeMouseMove);
    }
    if (this._onResizeMouseUp) {
      document.removeEventListener('mouseup', this._onResizeMouseUp);
    }
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
      this._onWindowResize = null;
    }
    if (this._preResizeUserSelect !== null) {
      document.body.style.userSelect = this._preResizeUserSelect;
      this._preResizeUserSelect = null;
    }

    if (this.panel) {
      this.panel.remove();
    }
    
    if (this.textInputHandler && this.textInputHandler.destroy) {
      this.textInputHandler.destroy();
    }
    
    if (this.bindingSystem) {
      this.bindingSystem.destroy();
    }
    
    if (this.eventSystem && this.eventSystem.off) {
      this.eventSystem.off('NODE_SELECTED');
      this.eventSystem.off('NODE_DESELECTED');
      this.eventSystem.off('PARAMETER_CHANGED');
      this.eventSystem.off('BINDING_CREATED');
      this.eventSystem.off('BINDING_REMOVED');
    }

    if (this._previewFrame) {
      cancelAnimationFrame(this._previewFrame);
      this._previewFrame = null;
    }

    if (this._outputRebuildTimeout) {
      clearTimeout(this._outputRebuildTimeout);
      this._outputRebuildTimeout = null;
    }

    this._pendingPreviewUpdates.clear();
  }
}
