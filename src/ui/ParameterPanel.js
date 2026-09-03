// src/ui/ParameterPanel.js - Clean implementation with binding support

import { ExpressionTextInputHandler, ExpressionParameterValueManager, expressionSystem, expressionStyles } from '../utils/ParameterExpressionSystem.js';
import { getInputCount } from '../data/nodeInputs.js';
import { setIcon, iconMarkup } from './iconSprite.js';
import { SelectInputHandler } from './components/SelectInputHandler.js';
import { FileInputHandler } from './components/FileInputHandler.js';
import { FontInputHandler } from './components/FontInputHandler.js';
import { ParameterBindingSystem } from '../utils/ParameterBindingSystem.js';
import { ColorStopInputHandler } from './components/ColorStopInputHandler.js';
import { ColorInputHandler } from './components/ColorInputHandler.js';
import { BooleanInputHandler } from './components/BooleanInputHandler.js';
import { discreteReadout, isBooleanParamType } from './components/discreteExpressionField.js';
import { GLSLCodeInputHandler } from './components/GLSLCodeInputHandler.js';
import { WGSLCodeInputHandler } from './components/WGSLCodeInputHandler.js';
import { GraphProcessor } from '../codegen/processors/GraphProcessor.js';
import { nodeReferenceDropStyles } from './NodeReferenceDrop.js';
import { NodeDefs } from '../data/NodeDefs.js';
import { nodeDisplayName } from '../core/nodeName.js';
import { describeExternalControls } from '../parameters/ExternalParameterControl.js';
import { describeAudioSource, getAudioSettingsPanel } from './AudioSettingsPanel.js';
import {
  ACCENT,
  SEMANTIC,
  SURFACE,
  TEXT,
  FONT_MONO,
  FONT_UI,
  categoryColor,
  withAlpha,
} from '../core/theme.js';

// Colours for parameters driven from outside the graph. Deliberately away from
// the greens/oranges the in-graph binding UI already owns, so "a controller is
// moving this" never reads as "another node is driving this".
const EXTERNAL_CONTROL_COLORS = {
  midi: SEMANTIC.audio,
  osc: SEMANTIC.info,
};

const EXTERNAL_CONTROL_ICONS = {
  midi: 'midi-port',
  osc: 'wire',
};

/**
 * Sources that move a parameter from outside this panel, continuously.
 *
 * They get the cheap display path: the field's text is corrected, the expensive refresh waits for
 * the stream to stop. A field the artist is typing in, and one holding an expression, are both left
 * alone — see _lightweightExternalValueUpdate.
 */
const EXTERNAL_PARAMETER_SOURCES = new Set(['midi', 'osc', 'audio-panel']);

export class ParameterPanel {
  constructor(eventSystem, undoManager, graph) {
    this.colorStopInputHandler = new ColorStopInputHandler(undoManager);
    this.colorInputHandler = new ColorInputHandler(undoManager);
    this.booleanInputHandler = new BooleanInputHandler(undoManager);
    this.eventSystem = eventSystem;
    this.undoManager = undoManager;
    this.graph = graph;
    this.selectedNode = null;
    this.panel = null;
    this.panelContent = null;
    this.resizeHandle = null;
    this.lastFocusedParameter = null; // Track last focused parameter for MIDI learn
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

    // MIDI parameter display update throttling
    this._midiDisplayUpdateTimer = null;
    this._midiDisplayUpdateDelay = 500; // ms - delay before updating displays after MIDI stops
    this._pendingMidiUpdate = null; // Store pending MIDI update data for flushing

    // Initialize GraphProcessor for expression-aware downstream tracking
    this.graphProcessor = new GraphProcessor();

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
    this.fontInputHandler = new FontInputHandler(undoManager);
    this.glslCodeInputHandler = new GLSLCodeInputHandler(undoManager);
    try {
      this.wgslCodeInputHandler = new WGSLCodeInputHandler(undoManager);
    } catch (e) {
      console.error('[ParameterPanel] Failed to initialize WGSLCodeInputHandler:', e);
      this.wgslCodeInputHandler = null;
    }
    
    // A dropdown or a true/false toggle can also hold an expression. The widget itself has no room
    // for one, so both handlers borrow the expression textarea and ask for a re-render when the
    // user switches modes (the parameter's whole control changes shape, not just its value).
    const expressionSupport = {
      expressionHandler: this.textInputHandler,
      requestRerender: (node) => {
        // The node is passed explicitly: the panel can be rendering a node it was handed directly
        // (a preview pane, a test harness) without that node being the current selection, and the
        // fx switch has to redraw whichever node it was clicked on.
        const target = node || this.selectedNode;
        if (target) this.renderParameters(target);
      },
    };
    this.selectInputHandler.setExpressionSupport(expressionSupport);
    this.booleanInputHandler.setExpressionSupport(expressionSupport);

    // Input handlers mapping
    this.inputHandlers = {
      text: this.textInputHandler,
      float: this.textInputHandler,
      int: this.textInputHandler,
      expression: this.textInputHandler,
      glsl: this.glslCodeInputHandler,
      'wgsl-code': this.wgslCodeInputHandler,
      select: this.selectInputHandler,
      file: this.fileInputHandler,
      font: this.fontInputHandler,
      colorstops: this.colorStopInputHandler,
      color: this.colorInputHandler,
      boolean: this.booleanInputHandler
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
      background: linear-gradient(${SURFACE.panelTop}, ${SURFACE.panelBottom});
      border: 1px solid ${SURFACE.lineStrong};
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 24px 60px -12px rgba(0,0,0,0.75), 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,244,230,0.06);
      font-family: ${FONT_UI};
      font-size: 12px;
      color: ${TEXT.primary};
      z-index: 1000;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      user-select: text;
      -webkit-user-select: text;
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
    } catch {
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
    } catch {
    }

    this.clampPanelSizeToViewport();
  }

  injectStyles() {
    if (!document.getElementById('expression-styles')) {
      const styleElement = document.createElement('style');
      styleElement.id = 'expression-styles';
      styleElement.textContent = expressionStyles + nodeReferenceDropStyles;
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
        if (this.selectedNode &&
            (this.selectedNode.id === data.sourceNodeId || this.selectedNode.id === data.targetNodeId)) {
          this.renderParameters(this.selectedNode);
        }
      });

      this.eventSystem.on('BINDING_REMOVED', (data) => {
        if (this.selectedNode &&
            (this.selectedNode.id === data.sourceNodeId || this.selectedNode.id === data.targetNodeId)) {
          this.renderParameters(this.selectedNode);
        }
      });

      // Keep the MIDI/OSC indicators honest. Mapping happens over in the MIDI
      // and OSC panels (or by wiggling a control in learn mode), so without
      // this the badge only appears after the node is reselected.
      const externalControlEvents = [
        'MIDI_BINDING_CREATED', 'MIDI_BINDING_REMOVED', 'MIDI_BINDING_UPDATED',
        'OSC_BINDING_CREATED', 'OSC_BINDING_REMOVED', 'OSC_BINDING_UPDATED',
      ];
      externalControlEvents.forEach((eventName) => {
        this.eventSystem.on(eventName, (data) => {
          if (this.selectedNode && this.selectedNode.id === data?.nodeId) {
            this.renderParameters(this.selectedNode);
          }
        });
      });
    }

    if (!this._onWindowResize) {
      this._onWindowResize = () => {
        this.clampPanelSizeToViewport();
        this.savePanelSize();
      };
    }
    window.addEventListener('resize', this._onWindowResize);

    // Track focused parameter inputs for MIDI learn
    this.panel.addEventListener('focusin', (e) => {
      if (e.target.classList.contains('param-input')) {
        const paramName = e.target.getAttribute('data-param');
        if (this.selectedNode && paramName) {
          this.lastFocusedParameter = { paramName, node: this.selectedNode };
        }
      }
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.panel.style.display === 'none') {
        return;
      }

      // Don't close if clicking on the panel itself, a node, or the timeline panel
      if (this.panel.contains(e.target) ||
          e.target.closest('.node') ||
          e.target.closest('.timeline-panel')) {
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && this.panel.contains(activeElement)) {
        return;
      }

      // Only close if the selected node is no longer in the selection
      // This prevents closing when clicking on menus or other UI elements
      if (this.selectedNode && this.graph?.selection?.has(this.selectedNode.id)) {
        return; // Node is still selected, keep panel open
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
      displayName: 'Angle (°)',
      default: 0.0,
      min: 0,
      max: 360,
      description: 'Gradient rotation angle in degrees'
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
      displayName: 'Rotation (°)',
      default: 0.0,
      min: 0,
      max: 360,
      description: 'Starting angle rotation in degrees'
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
      // Matches the node definition. It read 0.3 here, so the panel described a shape the
      // node never creates.
      default: 0.5,
      min: 0.01,
      max: 2.0,
      description: 'Rectangle height'
    },
    {
      // What Width and Height are fractions OF. Without this control the choice is
      // unreachable, since this hand-written list shadows the node's own params.
      name: 'sizeMode',
      type: 'select',
      displayName: 'Size Mode',
      options: ['Proportional', 'Frame'],
      default: 'Proportional',
      description:
        'Proportional: Width and Height share one unit, so Width : Height is the shape’s real ' +
        'ratio — 0.5 × 0.5 is a square at any render resolution. Frame: they are fractions of ' +
        'the frame’s width and height, so 1 × 1 fills the composition, but the shape then takes ' +
        'the composition’s ratio.'
    },
    {
      // Implemented in the shape function; it just had no control here.
      name: 'roundness',
      type: 'float',
      displayName: 'Roundness',
      default: 0.0,
      min: 0.0,
      max: 1.0,
      description: 'Corner rounding, as a fraction of the shortest half-extent'
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
            displayName: 'Image / Video File',
            accept: 'image/*,video/*',
            description: 'Texture image or video file'
          },
          {
            name: 'scale',
            type: 'float',
            displayName: 'Scale',
            default: 1.0,
            min: 0.1,
            max: 10.0,
            description: 'Texture scale'
          },
          // Playback, for when the loaded file is a video. `sourceType` is written by the upload
          // (see FileInputHandler), so these dim themselves for a still image. Mirrors the
          // declaration in NodeDefs' Texture2D.
          {
            name: 'playing',
            type: 'boolean',
            displayName: 'Play',
            default: true,
            activeWhen: { sourceType: 'video' },
            description: 'Run the video, or hold it on the current frame'
          },
          {
            name: 'loop',
            type: 'boolean',
            displayName: 'Loop',
            default: true,
            activeWhen: { sourceType: 'video' },
            description: 'Restart the video when it reaches the end'
          },
          {
            name: 'playbackRate',
            type: 'float',
            displayName: 'Speed',
            default: 1.0,
            min: 0.0625,
            max: 16.0,
            activeWhen: { sourceType: 'video' },
            description: 'Playback speed multiplier'
          },
          {
            name: 'sound',
            type: 'boolean',
            displayName: 'Sound',
            default: false,
            activeWhen: { sourceType: 'video' },
            description: "Unmute the video's audio track"
          },
          {
            name: 'trimStart',
            type: 'float',
            displayName: 'Trim Start (s)',
            default: 0.0,
            min: 0.0,
            max: 3600.0,
            activeWhen: { sourceType: 'video' },
            description: 'Start playback this many seconds into the clip'
          },
          {
            name: 'trimEnd',
            type: 'float',
            displayName: 'Trim End (s, 0 = end)',
            default: 0.0,
            min: 0.0,
            max: 3600.0,
            activeWhen: { sourceType: 'video' },
            description: 'Stop (or loop) at this many seconds in; 0 plays to the end of the clip'
          },
          {
            name: 'reset',
            type: 'button',
            action: 'resetVideo',
            expressionable: true,
            expressionPlaceholder: '=audioEnvelopeBass > 0.6',
            displayName: 'Reset',
            activeWhen: { sourceType: 'video' },
            description: 'Rewind to the start of the clip (or of the trim span)'
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
    { name: 'rotation', type: 'float', displayName: 'Rotation (°)', default: 0.0, min: 0, max: 360, description: 'Rotation angle in degrees' },
    // The centre is the point rotation and scaling pivot around, so it cancels out exactly while
    // there is neither: dimmed rather than left looking broken.
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, description: 'Rotation/scale center X', activeUnless: { rotation: 0, scaleX: 1, scaleY: 1 } },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, description: 'Rotation/scale center Y', activeUnless: { rotation: 0, scaleX: 1, scaleY: 1 } }
  );
  break;

case 'scale2d':
  definitions.push(
    { name: 'scaleX', type: 'float', displayName: 'Scale X', default: 1.0, min: 0.01, description: 'Horizontal scale' },
    { name: 'scaleY', type: 'float', displayName: 'Scale Y', default: 1.0, min: 0.01, description: 'Vertical scale' },
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, description: 'Scale center X', activeUnless: { scaleX: 1, scaleY: 1 } },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, description: 'Scale center Y', activeUnless: { scaleX: 1, scaleY: 1 } }
  );
  break;

case 'rotate2d':
  definitions.push(
    { name: 'rotation', type: 'float', displayName: 'Rotation (°)', default: 0.0, min: 0, max: 360, description: 'Rotation angle in degrees' },
    { name: 'centerX', type: 'float', displayName: 'Center X', default: 0.5, description: 'Rotation center X', activeUnless: { rotation: 0 } },
    { name: 'centerY', type: 'float', displayName: 'Center Y', default: 0.5, description: 'Rotation center Y', activeUnless: { rotation: 0 } }
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
      // Noise nodes: Use parameter definitions from NodeDefs
      case 'random':
      case 'valuenoise':
      case 'perlinnoise':
      case 'simplexnoise':
      case 'fbmnoise':
      case 'voronoinoise':
      case 'ridgednoise':
      case 'warpnoise':
      // Pattern and field nodes: Use parameter definitions from NodeDefs
      case 'checker':
      case 'stripe':
      case 'displacement': {
        const nodeDef = NodeDefs[node.kind];
        if (nodeDef && nodeDef.params && Array.isArray(nodeDef.params)) {
          nodeDef.params.forEach(param => {
            if (param.hidden) return; // node-maintained state, not a control (see below)
            definitions.push({
              name: param.name,
              type: param.type === 'bool' ? 'boolean' : param.type,
              displayName: param.label || param.name.charAt(0).toUpperCase() + param.name.slice(1),
              default: param.default,
              min: param.min,
              max: param.max,
              group: param.group,
              groupCollapsed: param.groupCollapsed,
              activeWhen: param.activeWhen,
              activeUnless: param.activeUnless,
              activeWhenConnected: param.activeWhenConnected,
              description: param.label || `${param.name} parameter`
            });
          });
        }
        break;
      }
        
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

        default: {
        // For all other nodes, try to use their NodeDef parameters first
        const defaultNodeDef = NodeDefs[node.kind];
        if (defaultNodeDef && defaultNodeDef.params && Array.isArray(defaultNodeDef.params)) {
          // Use parameter definitions from NodeDefs to preserve options arrays and metadata
          defaultNodeDef.params.forEach(param => {
            // `hidden` parameters are state the node maintains for itself - Texture 2D records
            // whether the loaded file is an image or a video there - declared so that an
            // activeWhen can key off them, but with nothing for a person to set.
            if (param.hidden) return;
            definitions.push({
              name: param.name,
              type: param.type === 'bool' ? 'boolean' : param.type,
              displayName: param.displayName || param.label || param.name.charAt(0).toUpperCase() + param.name.slice(1),
              default: param.default,
              min: param.min,
              max: param.max,
              options: param.options, // Preserve options array for select parameters
              accept: param.accept, // Preserve accept for file inputs
              action: param.action, // Preserve action for button parameters
              group: param.group, // Preserve the collapsible section this parameter belongs to
              groupCollapsed: param.groupCollapsed, // ...and whether that section starts closed
              activeWhen: param.activeWhen, // ...and the conditions under which it applies at all
              activeUnless: param.activeUnless,
              activeWhenConnected: param.activeWhenConnected,
              description: param.label || param.description || `${param.name} parameter`
            });
          });
        } else if (node.params && Object.keys(node.params).length > 0) {
          // Fallback: Infer types from values if no NodeDef available
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
          // Last resort: Add a generic value parameter
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
    }

    this._applyDynamicInputRanges(node, definitions);

    return definitions;
  }

  // A parameter that addresses input pins by index (Switch's `select`) has to follow the node's
  // live pin count, which the node's "+" chip can grow past the definition's fixed maximum.
  // Marked in the node definition with `maxFromInputCount: true`.
  _applyDynamicInputRanges(node, definitions) {
    const defParams = NodeDefs[node?.kind]?.params;
    if (!Array.isArray(defParams)) return;

    const dynamicNames = new Set(
      defParams.filter((p) => p?.maxFromInputCount).map((p) => p.name)
    );
    if (dynamicNames.size === 0) return;

    const lastPin = Math.max(0, getInputCount(node) - 1);
    for (const definition of definitions) {
      if (dynamicNames.has(definition.name)) definition.max = lastPin;
    }
  }

  showNodeParameters(node) {
    // Flush any pending MIDI updates from the previous node before switching
    if (this.selectedNode && this.selectedNode.id !== node.id) {
      this._flushPendingMIDIUpdates();
    }

    this.selectedNode = node;
    this.lastFocusedParameter = null; // Clear when switching nodes
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
    // Flush any pending MIDI updates before hiding
    this._flushPendingMIDIUpdates();

    this.panel.style.display = 'none';
    this.selectedNode = null;
    this.lastFocusedParameter = null; // Clear when hiding panel
  }

  _flushPendingMIDIUpdates() {
    // Flush pending MIDI updates from ParameterPanel
    if (this._midiDisplayUpdateTimer && this._pendingMidiUpdate) {
      clearTimeout(this._midiDisplayUpdateTimer);
      this._midiDisplayUpdateTimer = null;

      // Process the pending updates immediately with the stored data
      const { node, parameterName, newValue } = this._pendingMidiUpdate;
      this.expressionSystem.updateDependencies(node.id, parameterName, newValue);
      if (this.selectedNode && this.selectedNode.id === node.id) {
        this.refreshParameterDisplays();
      }
      this._pendingMidiUpdate = null;
    }

    // Also flush pending MIDI updates from Editor and ParameterBindingSystem
    if (window.editor?.flushPendingMidiUpdates) {
      window.editor.flushPendingMidiUpdates();
    }
    if (this.bindingSystem?.flushPendingMidiUpdates) {
      this.bindingSystem.flushPendingMidiUpdates();
    }
  }

  renderParameters(node) {
    if (!node) {
      this.panelContent.innerHTML = '<div class="no-parameters">No node provided</div>';
      return;
    }

    const parameterDefinitions = this.getParameterDefinitions(node);

    if (!parameterDefinitions || parameterDefinitions.length === 0) {
      // Built element-by-element rather than as an innerHTML template: the heading carries the
      // node's name, which the artist typed, and must never be parsed as markup.
      const empty = document.createElement('div');
      empty.className = 'no-parameters';
      const heading = document.createElement('h3');
      heading.textContent = nodeDisplayName(node);
      const note = document.createElement('p');
      note.textContent = 'No parameters available for this node type.';
      const idLine = document.createElement('p');
      idLine.textContent = `Node ID: ${node.id}`;
      empty.append(heading, note, idLine);

      this.panelContent.innerHTML = '';
      this.panelContent.appendChild(empty);
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

    // Panel header, in the order the eye needs it: what this surface is, which node it is pointed
    // at, and which family that node belongs to.
    //
    // The node's name is its kind's label until the artist renames it. Renaming a node is how a
    // patch full of Remaps becomes readable, so the panel has to answer "which one is this?" with
    // the same title the node draws on the canvas.
    const cat = NodeDefs[node.kind]?.cat || '';
    const swatch = categoryColor(cat);

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.style.cssText = `
      margin-bottom: 12px;
      padding-bottom: 11px;
      border-bottom: 1px solid ${SURFACE.line};
    `;

    const eyebrow = document.createElement('div');
    eyebrow.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: ${TEXT.faint};
    `;
    const eyebrowLabel = document.createElement('span');
    eyebrowLabel.textContent = 'PARAMETERS';
    const eyebrowId = document.createElement('span');
    eyebrowId.style.cssText = `font-family: ${FONT_MONO}; letter-spacing: 0;`;
    eyebrowId.textContent = `#${node.id}`;
    eyebrow.appendChild(eyebrowLabel);
    eyebrow.appendChild(eyebrowId);

    const identity = document.createElement('div');
    identity.style.cssText = 'display: flex; align-items: center; gap: 9px; margin-top: 11px;';

    // The category swatch is the same identity colour as the node's spine on the canvas — the one
    // thread that ties the panel to the card it is editing.
    const dot = document.createElement('span');
    dot.style.cssText = `
      width: 10px; height: 10px; border-radius: 3px; flex: none;
      background: ${swatch}; box-shadow: 0 0 10px ${withAlpha(swatch, 0.6)};
    `;

    const name = document.createElement('span');
    name.style.cssText = `
      flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: ${TEXT.primary};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    `;
    name.textContent = nodeDisplayName(node);

    identity.appendChild(dot);
    identity.appendChild(name);

    if (cat) {
      const pill = document.createElement('span');
      pill.style.cssText = `
        flex: none; font-size: 10px; padding: 3px 9px; border-radius: 999px;
        background: ${SURFACE.fillSoft}; color: ${TEXT.secondary};
        border: 1px solid ${SURFACE.line};
      `;
      pill.textContent = cat;
      identity.appendChild(pill);
    }

    title.appendChild(eyebrow);
    title.appendChild(identity);

    this.panelContent.innerHTML = '';
    this.panelContent.appendChild(title);

    const notice = this._nodeNotice(node);
    if (notice) this.panelContent.appendChild(notice);

    // Parameters may declare an optional `group`. Consecutive parameters sharing one are rendered
    // under a collapsible heading, which keeps a node with many controls readable — without it,
    // something like Audio Analysis is a flat wall of eighteen fields where the ones that shape a
    // continuous level sit indistinguishably next to the ones that detect hits. Parameters with no
    // `group` render exactly as before, so other nodes are untouched.
    const realPanelContent = this.panelContent;

    // Collect consecutive runs first, so a section knows all of its parameters before it is built
    // — the heading dims when every parameter under it is inactive.
    const runs = [];
    for (const param of parameterDefinitions) {
      const group = param.group || null;
      const last = runs[runs.length - 1];
      if (last && last.group === group) last.params.push(param);
      else runs.push({ group, params: [param] });
    }

    for (const run of runs) {
      const target = run.group
        ? this._createParameterGroup(run.group, node, run.params)
        : realPanelContent;
      for (const param of run.params) {
        // renderParameter and its helpers append to this.panelContent; point it at the group body
        // for the duration so they land inside the section. Rendering is synchronous, so this is
        // restored before anything else can observe it.
        this.panelContent = target;
        try {
          this.renderParameter(param, node);
        } finally {
          this.panelContent = realPanelContent;
        }
      }
    }

    this.addExpressionHelp();
  }

  /**
   * Build a collapsible section and return the element parameters should be appended to.
   * Collapsed state is remembered per node kind + group name, so toggling a section open survives
   * the re-render that follows every parameter edit.
   */
  _createParameterGroup(groupName, node, params) {
    if (!this._collapsedGroups) this._collapsedGroups = new Map();
    const key = `${node.kind}:${groupName}`;
    if (!this._collapsedGroups.has(key)) {
      this._collapsedGroups.set(key, params[0]?.groupCollapsed === true);
    }
    let collapsed = this._collapsedGroups.get(key);

    const section = document.createElement('div');
    section.className = 'parameter-group';
    section.dataset.group = groupName;
    section.style.cssText = 'margin: 4px 0 10px 0;';

    const header = document.createElement('div');
    header.className = 'parameter-group-header';
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      padding: 6px 4px;
      margin-bottom: 6px;
      border-bottom: 1px solid ${SURFACE.line};
      color: ${TEXT.faint};
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.4px;
    `;
    const caret = document.createElement('span');
    setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down', { size: 12 });
    const label = document.createElement('span');
    label.textContent = groupName;
    header.appendChild(caret);
    header.appendChild(label);

    // A section whose every parameter is inactive is itself inactive — the whole Instances section
    // does nothing in surface mode. Dimming the heading says so without opening it.
    if (params.every(p => !this._isParameterActive(p, node))) {
      section.classList.add('parameter-group-inactive');
      header.style.opacity = '0.45';
      header.title = this._inactiveReason(params[0], node) || 'Not used with the current settings';
    }

    const body = document.createElement('div');
    body.style.display = collapsed ? 'none' : 'block';

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      this._collapsedGroups.set(key, collapsed);
      body.style.display = collapsed ? 'none' : 'block';
      setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down', { size: 12 });
    });

    section.appendChild(header);
    section.appendChild(body);
    this.panelContent.appendChild(section);
    return body;
  }

  /**
   * Is this parameter used by the node as currently configured?
   *
   * Several nodes carry parameters that only apply in one mode: the 3D Field Visualizer ignores
   * every instancing control while `mode` is 'surface', Threshold reads either `threshold` or the
   * min/max pair but never both. Nothing distinguished those from the live ones, so the panel
   * offered controls that provably do nothing.
   *
   * Three optional declarations express it:
   *   activeWhen: { mode: 'instances' }               - another parameter equals this value
   *   activeWhen: { type: ['Radial', 'Diamond'] }     - ...or any value in this list
   *   activeUnless: { rotation: 0, scaleX: 1 }        - every one of these is at the listed value
   *   activeWhenConnected: 0                          - something is wired to this input pin
   * All must hold. A parameter that declares none is always active, so nodes that say nothing
   * behave exactly as before.
   *
   * activeUnless covers the pivot case: a transform pivot is a mathematical no-op while there is
   * no rotation and no scaling to pivot around, and only stops mattering when EVERY one of those
   * is at rest - which the all-must-match activeWhen cannot say.
   */
  _isParameterActive(param, node) {
    if (param?.activeWhenConnected !== undefined) {
      const source = node?.inputs?.[param.activeWhenConnected];
      if (source === null || source === undefined) return false;
    }

    if (this._isAtRest(param?.activeUnless, node)) return false;

    const conditions = param?.activeWhen;
    if (!conditions) return true;

    for (const [name, expected] of Object.entries(conditions)) {
      if (!this._isConditionMet(name, expected, node)) return false;
    }
    return true;
  }

  /**
   * Is every parameter named in an `activeUnless` block sitting at its listed resting value?
   * An expression never counts as at rest: it is resolved per frame and could be anything, so a
   * control it governs stays live rather than being dimmed on a guess.
   */
  _isAtRest(resting, node) {
    if (!resting) return false;
    return Object.entries(resting).every(([name, value]) => {
      const current = node?.params?.[name];
      if (typeof current === 'string' && current.startsWith('=')) return false;
      return this._sameValue(current ?? this._defaultOf(node, name), value);
    });
  }

  /** Compare a stored parameter against a declared value, tolerating "0" vs 0 and "1.0" vs 1. */
  _sameValue(a, b) {
    if (a === null || a === undefined || a === '') return false;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    return String(a) === String(b);
  }

  /** Wording for the tooltip on a dimmed control: why it is doing nothing right now. */
  _inactiveReason(param, node) {
    if (param?.activeWhenConnected !== undefined) {
      const source = node?.inputs?.[param.activeWhenConnected];
      if (source === null || source === undefined) {
        const pin = NodeDefs[node?.kind]?.pinsIn?.[param.activeWhenConnected];
        const pinName = (typeof pin === 'string' ? pin : pin?.label) || 'the input';
        return `Not used until something is connected to ${pinName}`;
      }
    }
    const conditions = param?.activeWhen || {};
    const parts = [];
    for (const [name, expected] of Object.entries(conditions)) {
      if (this._isConditionMet(name, expected, node)) continue;
      const values = (Array.isArray(expected) ? expected : [expected]).map(String);
      const label = this._parameterLabel(node, name);
      const list = values.length > 1
        ? `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`
        : values[0];
      parts.push(`${label} is ${list}`);
    }
    if (parts.length) return `Only applies when ${parts.join(' and ')}`;

    if (this._isAtRest(param?.activeUnless, node)) {
      const names = Object.entries(param.activeUnless)
        .map(([name, value]) => `${this._parameterLabel(node, name)} is not ${value}`);
      const list = names.length > 1
        ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
        : names[0];
      return `Only applies while ${list}`;
    }
    return '';
  }

  _isConditionMet(name, expected, node) {
    const current = node?.params?.[name];
    if (typeof current === 'string' && current.startsWith('=')) return true;
    const actual = String(current ?? this._defaultOf(node, name) ?? '');
    return (Array.isArray(expected) ? expected : [expected]).map(String).includes(actual);
  }

  _defaultOf(node, name) {
    return NodeDefs[node?.kind]?.params?.find(p => p.name === name)?.default;
  }

  _parameterLabel(node, name) {
    const def = NodeDefs[node?.kind]?.params?.find(p => p.name === name);
    return def?.displayName || def?.label || name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Does any parameter on this node key its availability off `changedName`? Editing such a
   * parameter changes which other controls apply, so the panel has to be redrawn to restate it.
   */
  _controlsOtherParameters(node, changedName) {
    if (!node || !changedName) return false;
    // The rendered definitions, not NodeDefs: transform nodes declare their availability rules in
    // getParameterDefinitions rather than in the node definition.
    return this.getParameterDefinitions(node).some(p => (
      (p.activeWhen && Object.prototype.hasOwnProperty.call(p.activeWhen, changedName))
      || (p.activeUnless && Object.prototype.hasOwnProperty.call(p.activeUnless, changedName))
    ));
  }

  renderParameter(param, node) {
    // Action buttons (e.g. the Feedback node's "Reset Feedback") are momentary
    // controls, not stored values, so they skip the binding/keyframe/value
    // machinery entirely.
    if (param.type === 'button') {
      this.renderActionButton(param, node);
      return;
    }

    const paramContainer = document.createElement('div');
    paramContainer.className = 'parameter-container';
    paramContainer.setAttribute('data-param', param.name);

    // Get binding info
    const bindingInfo = this.bindingSystem ? 
      this.bindingSystem.getBindingInfo(node.id, param.name) : 
      { isBound: false, hasTargets: false };
    
    // A parameter the node is currently ignoring is dimmed rather than disabled: it says "this is
    // doing nothing right now" while still letting the value be set up before switching modes.
    const active = this._isParameterActive(param, node);

    // MIDI/OSC drive a parameter without touching the input, so an externally
    // controlled value is otherwise indistinguishable from one typed by hand.
    // Mark it: colour on the edge and the name, a badge, and the source below.
    const externalControls = describeExternalControls(node.id, param.name);
    const externalColor = externalControls.length
      ? EXTERNAL_CONTROL_COLORS[externalControls[0].type]
      : null;

    // In-graph bindings keep their existing amber — that relationship is
    // editable from this panel, so it stays the louder of the two. An ordinary
    // parameter's edge is the accent, matching the selection on the canvas.
    const accentColor = bindingInfo.isBound ? SEMANTIC.warn : (externalColor || ACCENT.base);

    paramContainer.style.cssText = `
      margin-bottom: 10px;
      padding: 9px 10px;
      background: ${bindingInfo.isBound ? withAlpha(SEMANTIC.warn, 0.07) : SURFACE.fillSoft};
      border: 1px solid ${SURFACE.line};
      border-radius: 10px;
      border-left: 3px solid ${active ? accentColor : SURFACE.lineStrong};
      position: relative;
      opacity: ${active ? '1' : '0.45'};
    `;

    if (!active) {
      paramContainer.classList.add('parameter-inactive');
      paramContainer.title = this._inactiveReason(param, node) || 'Not used with the current settings';
    }

    // Create label container
    const labelContainer = document.createElement('div');
    labelContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    `;

    // Name and badges travel together on the left; the buttons stay right.
    const labelGroup = document.createElement('div');
    labelGroup.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    `;

    const label = document.createElement('label');
    label.className = 'parameter-label';
    label.textContent = param.displayName || param.name;
    label.style.cssText = `
      font-size: 12.5px;
      font-weight: 500;
      color: ${bindingInfo.isBound || externalColor ? accentColor : TEXT.secondary};
    `;

    if (param.description) {
      label.title = param.description;
    }

    labelGroup.appendChild(label);

    for (const control of externalControls) {
      labelGroup.appendChild(this.createExternalControlBadge(control));
    }

    labelContainer.appendChild(labelGroup);

    // Controls container for binding and keyframe buttons
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
      display: flex;
      gap: 4px;
      align-items: center;
    `;

    // Add binding controls
    if (this.bindingSystem) {
      const bindingControls = this.createBindingControls(param, node, bindingInfo);
      controlsContainer.appendChild(bindingControls);
    }

    // Add keyframe button
    const keyframeBtn = this.createKeyframeButton(param, node);
    controlsContainer.appendChild(keyframeBtn);

    labelContainer.appendChild(controlsContainer);

    paramContainer.appendChild(labelContainer);

    // Add binding status if needed
    if (this.bindingSystem && (bindingInfo.isBound || bindingInfo.hasTargets)) {
      const bindingStatus = this.createBindingStatus(param, node, bindingInfo);
      paramContainer.appendChild(bindingStatus);
    }

    // Which CC / which address — the badge says "external", this says "which".
    if (externalControls.length) {
      paramContainer.appendChild(this.createExternalControlStatus(externalControls));
    }

    // Input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'parameter-input-container';

    // A bound numeric parameter is driven by its source. Rather than disabling the input,
    // expose an expression field that post-processes that driven value (the live source value
    // is available as `bound`/`self`, e.g. "=bound * 2"). Non-numeric bound params have no
    // sensible scalar transform, so they keep the read-only disabled treatment.
    const transformableTypes = ['float', 'int', 'expression'];
    if (bindingInfo.isBound && transformableTypes.includes(param.type)) {
      this.createBoundTransformInput(param, node, inputContainer, bindingInfo);
    } else {
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

          // Disable input if parameter is bound (non-numeric types only)
          if (bindingInfo.isBound) {
            const input = inputContainer.querySelector('.param-input');
            if (input) {
              input.disabled = true;
              input.style.opacity = '0.6';
              input.title = `Bound to ${bindingInfo.source.nodeId}.${bindingInfo.source.parameterName}`;
            }
          }
        } catch {

          this.createFallbackInput(param, node, inputContainer);
        }
      } else {
        this.createFallbackInput(param, node, inputContainer);
      }
    }

    paramContainer.appendChild(inputContainer);

    // Add parameter info
    if (param.min !== undefined || param.max !== undefined) {
      const rangeInfo = document.createElement('div');
      rangeInfo.className = 'parameter-range';
      rangeInfo.textContent = `Range: ${param.min ?? '−∞'} to ${param.max ?? '∞'}`;
      rangeInfo.style.cssText = `
        font-size: 10px;
        color: ${TEXT.faint};
        font-family: ${FONT_MONO};
        margin-top: 3px;
      `;
      paramContainer.appendChild(rangeInfo);
    }

    this.panelContent.appendChild(paramContainer);
  }

  /**
   * Render the input for a bound numeric parameter as an expression that transforms the live
   * driven value. The parameter stays bound to its source; the expression here post-processes the
   * incoming value, with that value exposed as `bound` (and `self`). An empty field means "use the
   * driven value as-is". The transform is owned by the binding system, not node.params, so the
   * binding keeps writing the computed numeric result downstream (codegen/uniforms/preview).
   */
  createBoundTransformInput(param, node, inputContainer, bindingInfo) {
    const sourceNode = this.graph.nodes.find(n => n.id === bindingInfo.source.nodeId);
    const sourceLabel = `${sourceNode?.kind || 'Unknown'} #${bindingInfo.source.nodeId}.${bindingInfo.source.parameterName}`;

    const container = document.createElement('div');
    container.className = 'expression-input-container';
    container.style.cssText = 'position: relative; margin-bottom: 4px;';

    const input = document.createElement('textarea');
    input.className = 'param-input expression-capable has-expression';
    input.setAttribute('data-param', param.name);
    input.setAttribute('data-param-type', param.type);
    input.setAttribute('data-node-id', String(node.id));
    input.setAttribute('rows', '1');
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.value = this.bindingSystem.getBoundTransform(node.id, param.name) || '';
    input.placeholder = '=bound (e.g. =bound * 2)';
    input.title = `Bound to ${sourceLabel}. Type an expression of "bound" (the driven value) to transform it; leave empty to use it directly.`;
    input.style.cssText = `
      width: 100%;
      min-height: 30px;
      max-height: 200px;
      padding: 6px 8px;
      background: ${SURFACE.well};
      color: #c9b9f7;
      border: 1px solid ${withAlpha(SEMANTIC.warn, 0.45)};
      border-radius: 8px;
      font-size: 11px;
      font-family: ${FONT_MONO};
      line-height: 1.4;
      box-sizing: border-box;
      resize: vertical;
      overflow-y: hidden;
    `;

    const resultDisplay = document.createElement('div');
    resultDisplay.className = 'expression-result';
    resultDisplay.style.cssText = `
      font-size: 10px;
      color: ${TEXT.tertiary};
      margin-top: 3px;
      font-family: ${FONT_MONO};
      min-height: 12px;
      padding-left: 2px;
    `;

    const refreshResult = () => {
      const current = this.valueManager.getValue(node, param.name);
      const shown = typeof current === 'number' ? Math.round(current * 10000) / 10000 : current;
      const live = this.expressionSystem.isExpression(node.params?.[param.name]);
      resultDisplay.textContent = `→ ${shown}${live ? ' (live)' : ''}`;
    };
    refreshResult();

    // When the driven value is a live expression (e.g. the source is =sin(time)), keep the readout
    // ticking so it doesn't look like a frozen number. The loop self-cancels once the input is
    // detached (panel re-render/close) or the value stops being an expression.
    const liveTick = () => {
      if (!input.isConnected) return;
      if (!this.expressionSystem.isExpression(node.params?.[param.name])) return;
      refreshResult();
      setTimeout(() => requestAnimationFrame(liveTick), 66); // ~15 fps, cheap text update
    };
    requestAnimationFrame(liveTick);

    const commit = () => {
      const changed = this.bindingSystem.setBoundTransform(node.id, param.name, input.value);
      if (changed) {
        refreshResult();
        this.handleParameterUpdate({
          parameterName: param.name,
          newValue: this.valueManager.getValue(node, param.name),
        });
      }
    };

    // Keep editor-level shortcuts from firing while typing in the field.
    input.addEventListener('keydown', (e) => {
      if (['Delete', 'Backspace', 'Enter'].includes(e.key)) {
        e.stopPropagation();
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
        input.blur();
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
    // Programmatic edits (a node dropped on the field to insert its reference) arrive as a
    // change event rather than typing followed by a blur.
    input.addEventListener('change', commit);

    container.appendChild(input);
    container.appendChild(resultDisplay);
    inputContainer.appendChild(container);
  }

  /**
   * Render a momentary action button parameter (param.type === 'button').
   * Dispatches a named action rather than storing a value.
   */
  renderActionButton(param, node) {
    // A button can be declared video-only (Texture 2D's Reset), so it dims for a still image the
    // same way the playback controls above it do.
    const active = this._isParameterActive(param, node);

    const paramContainer = document.createElement('div');
    paramContainer.className = 'parameter-container';
    paramContainer.setAttribute('data-param', param.name);
    paramContainer.style.cssText = `
      margin-bottom: 10px;
      padding: 9px 10px;
      background: ${SURFACE.fillSoft};
      border: 1px solid ${SURFACE.line};
      border-radius: 10px;
      border-left: 3px solid ${active ? ACCENT.base : SURFACE.lineStrong};
      opacity: ${active ? '1' : '0.45'};
    `;

    if (!active) {
      paramContainer.classList.add('parameter-inactive');
      paramContainer.title = this._inactiveReason(param, node) || 'Not used with the current settings';
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = param.displayName || param.name;
    if (param.description) button.title = param.description;
    button.style.cssText = `
      width: 100%;
      padding: 8px;
      background: ${SURFACE.fillSoft};
      color: ${TEXT.secondary};
      border: 1px solid ${SURFACE.line};
      border-radius: 8px;
      font-family: ${FONT_UI};
      font-size: 12px;
      cursor: pointer;
    `;
    button.addEventListener('mouseenter', () => { button.style.background = SURFACE.hover; });
    button.addEventListener('mouseleave', () => { button.style.background = SURFACE.fillSoft; });

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.runParameterAction(param.action, node);
    });

    paramContainer.appendChild(button);

    // An expressionable button also fires on its own: the field below it holds an expression that
    // is evaluated every frame, and each rising edge runs the same action as a click.
    if (param.expressionable) {
      paramContainer.appendChild(this.createActionTriggerInput(param, node));
    }

    this.panelContent.appendChild(paramContainer);
  }

  /**
   * The expression field under an expressionable action button (param.expressionable).
   *
   * The stored parameter is the expression itself — a button has no value to keep, so the slot is
   * free — and an empty field means "click only". A per-frame processor (VideoResetProcessor for
   * Texture 2D's Reset) watches it and fires the action on every rising edge past 0.5, which is
   * what makes "=audioEnvelopeBass > 0.6" re-cue a clip on the beat.
   */
  createActionTriggerInput(param, node) {
    const container = document.createElement('div');
    container.className = 'expression-input-container';
    container.style.cssText = 'position: relative; margin-top: 6px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'param-input expression-capable';
    input.setAttribute('data-param', param.name);
    input.setAttribute('data-param-type', 'expression');
    input.setAttribute('data-node-id', String(node.id));
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    const stored = node.params?.[param.name];
    input.value = typeof stored === 'string' ? stored : '';
    input.placeholder = param.expressionPlaceholder || '= expression to fire on';
    input.title = `Fire ${param.displayName || param.name} whenever this expression rises past 0.5. Leave empty to use the button only.`;
    input.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      background: ${SURFACE.well};
      color: #c9b9f7;
      border: 1px solid ${SURFACE.line};
      border-radius: 8px;
      font-size: 11px;
      font-family: ${FONT_MONO};
      box-sizing: border-box;
    `;

    const commit = () => {
      const value = input.value.trim();
      if ((node.params?.[param.name] ?? '') === value) return;
      if (!node.params) node.params = {};
      node.params[param.name] = value;
      this.handleParameterUpdate({ parameterName: param.name, newValue: value });
    };

    // Keep editor-level shortcuts (delete node, etc.) from firing while typing in the field.
    input.addEventListener('keydown', (e) => {
      if (['Delete', 'Backspace', 'Enter'].includes(e.key)) e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        input.blur();
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
    // A node dropped onto the field to insert its reference arrives as a change, not as typing.
    input.addEventListener('change', commit);

    container.appendChild(input);
    return container;
  }

  /**
   * Execute a named parameter action triggered by a button parameter.
   */
  runParameterAction(action, node) {
    switch (action) {
      case 'resetVideo':
        // Rewinds the node's <video> to the start of its clip (or of its trim span). A still image
        // has no video element, so this is a no-op there.
        window.textureManager?.resetVideo?.(node.id);
        // The frame on screen is the one we just left until something asks for a redraw.
        window.editor?.markDirty?.('video-reset');
        break;
      case 'resetFeedback':
        if (window.computeExecutor?.resetNodeFeedback) {
          window.computeExecutor.resetNodeFeedback(node.id);
        }
        break;
      case 'openAudioPanel':
        // The node names a channel; the panel is where the channels can be watched, and where a
        // threshold is set against the meter it is compared to. Show it rather than making the
        // artist find it in the Tools menu with the node already selected.
        getAudioSettingsPanel().show();
        break;
      case 'resetCount':
        // Queue a reset of the CPU-side counter; CountNodeProcessor applies it on the next frame.
        window.countNodeProcessor?.requestReset?.(node.id);
        // Nudge a redraw so the node's numeric preview reflects the reset promptly.
        window.editor?.markDirty?.('count-reset');
        break;
      default:
        console.warn(`[ParameterPanel] Unknown parameter action: ${action}`);
    }
  }

  /**
   * A live status strip under the panel header, for nodes whose output depends on something outside
   * the graph.
   *
   * The audio nodes read a live signal, so with no track playing every channel is 0 — the values
   * are 0, the thresholds decide nothing, and everything downstream sits still. That is
   * indistinguishable from "this node is broken" unless something says otherwise, and the place to
   * say it is where the artist is already looking when they wonder why nothing moves. Clicking it
   * opens the panel that fixes it.
   */
  _nodeNotice(node) {
    if (node?.kind !== 'Audio' && node?.kind !== 'AudioValue') return null;

    const strip = document.createElement('button');
    strip.type = 'button';
    strip.className = 'node-notice';
    strip.title = 'Open the Audio panel: source, meter shape and thresholds';
    strip.addEventListener('click', () => getAudioSettingsPanel().show());

    const dot = document.createElement('span');
    dot.style.cssText = 'flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor;';
    const text = document.createElement('span');
    strip.append(dot, text);

    // Styled here rather than in a stylesheet, as everything else in this panel is.
    const paint = () => {
      const source = describeAudioSource();
      const quiet = source.playing;
      strip.dataset.state = source.state;
      strip.style.cssText = `
        display: flex; align-items: center; gap: 8px; width: 100%;
        margin: 0 0 12px; padding: 8px 10px; text-align: left;
        border-radius: 8px; cursor: pointer;
        font-family: ${FONT_UI}; font-size: 11px; line-height: 1.35;
        border: 1px solid ${quiet ? SURFACE.line : withAlpha(SEMANTIC.warn, 0.35)};
        background: ${quiet ? SURFACE.fillSoft : withAlpha(SEMANTIC.warn, 0.14)};
        color: ${quiet ? TEXT.tertiary : SEMANTIC.warn};
      `;
      const running = source.live ? source.label : 'Playing';
      text.textContent = quiet
        ? `${running}${source.fileName ? ` — ${source.fileName}` : ''}`
        : `${source.label} — every channel reads 0. Open Audio Setup…`;
    };
    paint();

    // Polled rather than event-driven: the transport can be driven from the panel, from another
    // window, or by a track running out, and the strip has to be right in all three. It stops on
    // its own once the panel has moved on to another node.
    const timer = setInterval(() => {
      if (!strip.isConnected) {
        clearInterval(timer);
        return;
      }
      paint();
    }, 400);

    return strip;
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
    setIcon(copyBtn, 'copy-value', { size: 12, label: 'Copy as reference' });
    copyBtn.title = 'Copy as reference (Ctrl+Shift+C)';
    copyBtn.style.cssText = `
      width: 18px;
      height: 18px;
      background: ${SURFACE.fillSoft};
      border: 1px solid ${SURFACE.line};
      border-radius: 5px;
      color: ${TEXT.secondary};
      cursor: pointer;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyParameterReference(node, param);
      // Confirm right at the icon. The corner toast renders top-right, away from where the user is
      // looking in the panel, so flash the button to a checkmark and pop a small "Copied!" label anchored to
      // the icon as unmistakable feedback next to the parameter.
      setIcon(copyBtn, 'status-success', { size: 12, label: 'Copied' });
      copyBtn.title = `Copied ${node.kind}.${param.name} as reference`;
      clearTimeout(this._copyFlashTimer);
      this._copyFlashTimer = setTimeout(() => {
        setIcon(copyBtn, 'copy-value', { size: 12, label: 'Copy as reference' });
        copyBtn.title = 'Copy as reference (Ctrl+Shift+C)';
      }, 1000);
      this.showAnchoredMessage(copyBtn, 'Copied!');
    });

    // Paste reference button
    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'binding-btn paste-ref-btn';
    setIcon(pasteBtn, 'attach', { size: 12, label: 'Paste reference' });
    pasteBtn.title = 'Paste reference (Ctrl+Shift+V)';
    pasteBtn.style.cssText = `
      width: 18px;
      height: 18px;
      background: ${SURFACE.fillSoft};
      border: 1px solid ${SURFACE.line};
      border-radius: 5px;
      color: ${TEXT.secondary};
      cursor: pointer;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    pasteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const clip = this.bindingSystem.clipboard;
      this.pasteParameterReference(node, param);
      // Confirm at the icon (the corner toast is easy to miss). Reflect whether a binding was made.
      const bound = clip && this.bindingSystem.isParameterBound(node.id, param.name);
      this.showAnchoredMessage(pasteBtn, bound ? 'Bound!' : 'Nothing to paste');
    });

    // Unbind button (only show if parameter is bound)
    if (bindingInfo.isBound) {
      const unbindBtn = document.createElement('button');
      unbindBtn.type = 'button';
      unbindBtn.className = 'binding-btn unbind-btn';
      setIcon(unbindBtn, 'unlink', { size: 12, label: 'Remove binding' });
      unbindBtn.title = 'Remove binding';
      unbindBtn.style.cssText = `
        width: 18px;
        height: 18px;
        background: ${withAlpha(SEMANTIC.error, 0.14)};
        border: 1px solid ${withAlpha(SEMANTIC.error, 0.35)};
        border-radius: 5px;
        color: ${SEMANTIC.error};
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

  createKeyframeButton(param, node) {
    const keyframeBtn = document.createElement('button');
    keyframeBtn.type = 'button';
    keyframeBtn.className = 'keyframe-btn';
    setIcon(keyframeBtn, 'record', { size: 12, label: 'Add keyframe' });
    keyframeBtn.title = 'Add keyframe at current time';

    // Check if parameter has keyframes
    const hasKeyframes = window.timelineManager &&
      window.timelineManager.hasKeyframes(node.id, param.name);

    keyframeBtn.style.cssText = `
      width: 18px;
      height: 18px;
      background: ${hasKeyframes ? withAlpha(ACCENT.base, 0.16) : SURFACE.fillSoft};
      border: 1px solid ${hasKeyframes ? withAlpha(ACCENT.base, 0.35) : SURFACE.line};
      border-radius: 5px;
      color: ${hasKeyframes ? ACCENT.base : TEXT.tertiary};
      cursor: pointer;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    `;

    keyframeBtn.addEventListener('mouseenter', () => {
      keyframeBtn.style.background = hasKeyframes ? withAlpha(ACCENT.base, 0.26) : SURFACE.hover;
    });

    keyframeBtn.addEventListener('mouseleave', () => {
      keyframeBtn.style.background = hasKeyframes ? withAlpha(ACCENT.base, 0.16) : SURFACE.fillSoft;
    });

    keyframeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addKeyframeForParameter(node, param);
    });

    return keyframeBtn;
  }

  addKeyframeForParameter(node, param) {
    if (!window.timelineManager) {

      return;
    }

    try {
      // Get current parameter value
      const value = node.params[param.name];

      // Add keyframe at current time
      window.timelineManager.addKeyframe(node.id, param.name, value);

      // Show success message
      if (window.updateStatus) {
        window.updateStatus(`Keyframe added for ${param.name} at ${window.timelineManager.getCurrentTime().toFixed(2)}s`);
      }

      // Update the keyframe button appearance
      this.renderParameters(node);

    } catch (error) {

      if (window.updateStatus) {
        window.updateStatus(`Error adding keyframe: ${error.message}`, 'error');
      }
    }
  }

  createBindingStatus(param, node, bindingInfo) {
    const status = document.createElement('div');
    status.className = 'binding-status';
    status.style.cssText = `
      font-size: 9.5px;
      margin-bottom: 5px;
      padding: 4px 6px;
      border-radius: 6px;
      background: ${SURFACE.well};
    `;

    if (bindingInfo.isBound) {
      const sourceNode = this.graph.nodes.find(n => n.id === bindingInfo.source.nodeId);
      const sourceNodeName = sourceNode ? sourceNode.kind : 'Unknown';
      // Include the node id so the exact source is identifiable when several nodes share a kind
      // (e.g. multiple ConstFloats). The line is clickable to jump to that source node.
      const sourceLabel = `${sourceNodeName} #${bindingInfo.source.nodeId}.${bindingInfo.source.parameterName}`;

      const boundLine = document.createElement('div');
      boundLine.innerHTML = `
        <span style="color: ${SEMANTIC.warn};">${iconMarkup('link', { size: 12 })} Bound to:</span>
        <span style="color: ${TEXT.primary}; text-decoration: underline dotted;">${sourceLabel}</span>
      `;
      if (sourceNode) {
        boundLine.style.cursor = 'pointer';
        boundLine.title = 'Click to select the source node';
        boundLine.addEventListener('click', (e) => {
          e.stopPropagation();
          this.focusSourceNode(sourceNode);
        });
      }
      status.appendChild(boundLine);
    }

    if (bindingInfo.hasTargets) {
      const targetCount = bindingInfo.targets.length;
      const targetsText = targetCount === 1 ? '1 parameter' : `${targetCount} parameters`;
      
      const targetInfo = document.createElement('div');
      targetInfo.innerHTML = `
        <span style="color: ${ACCENT.base};">${iconMarkup('wire', { size: 12 })} Controls:</span> 
        <span style="color: ${TEXT.primary};">${targetsText}</span>
      `;
      
      if (bindingInfo.isBound) {
        status.appendChild(document.createElement('br'));
      }
      status.appendChild(targetInfo);
    }

    return status;
  }

  /**
   * Small "MIDI"/"OSC" pill sitting next to the parameter name.
   *
   * This is the at-a-glance half of the indicator: scanning the panel should
   * answer "what in here is on a controller?" without reading any detail lines.
   * Clicking it opens the settings panel that owns the mapping, which is where
   * the range or the mapping itself can actually be changed.
   */
  createExternalControlBadge(control) {
    const color = EXTERNAL_CONTROL_COLORS[control.type] || TEXT.tertiary;

    const badge = document.createElement('span');
    badge.className = `external-control-badge external-control-badge--${control.type}`;
    badge.setAttribute('data-external-control', control.type);
    badge.textContent = control.label;
    badge.style.cssText = `
      flex: none;
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 0.4px;
      line-height: 1;
      padding: 2px 7px;
      border: 1px solid ${withAlpha(color, 0.35)};
      border-radius: 999px;
      color: ${color};
      background: ${withAlpha(color, 0.14)};
      cursor: pointer;
      opacity: ${control.enabled ? '1' : '0.45'};
    `;
    badge.title = control.enabled
      ? `Driven by ${control.label}: ${control.source}. Click to open ${control.label} settings.`
      : `${control.label} mapping (${control.source}) is disabled. Click to open ${control.label} settings.`;

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openExternalControlSettings(control.type);
    });

    return badge;
  }

  /**
   * Detail line naming the controller source, styled to match "Bound to: …".
   */
  createExternalControlStatus(controls) {
    const status = document.createElement('div');
    status.className = 'external-control-status';
    status.style.cssText = `
      font-size: 9.5px;
      margin-bottom: 5px;
      padding: 4px 6px;
      border-radius: 6px;
      background: ${SURFACE.well};
    `;

    controls.forEach((control) => {
      const color = EXTERNAL_CONTROL_COLORS[control.type] || TEXT.tertiary;
      const icon = EXTERNAL_CONTROL_ICONS[control.type] || 'wire';

      const line = document.createElement('div');
      line.style.cssText = `opacity: ${control.enabled ? '1' : '0.5'};`;
      line.innerHTML = `
        <span style="color: ${color};">${iconMarkup(icon, { size: 12 })} ${control.label}:</span>
        <span style="color: ${TEXT.primary};">${this.escapeHtml(control.source)}</span>
        ${control.enabled ? '' : '<span style="color: ${TEXT.faint};">(disabled)</span>'}
      `;
      status.appendChild(line);
    });

    return status;
  }

  /** Open the MIDI or OSC settings panel, where mappings are edited. */
  openExternalControlSettings(type) {
    const panel = type === 'midi'
      ? (window.editor?.midiSettingsPanel ?? window.midiSettingsPanel)
      : (window.editor?.oscSettingsPanel ?? window.oscSettingsPanel);

    panel?.show?.();
  }

  escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Select a bound parameter's source node and show its parameters, so "Bound to: …" is a way to
  // jump straight to the driver. Selection is a plain Set of node ids on the graph.
  focusSourceNode(sourceNode) {
    if (!sourceNode) return;
    try {
      if (this.graph?.selection) {
        this.graph.selection.clear();
        this.graph.selection.add(sourceNode.id);
      }
      this.selectedNode = sourceNode;
      this.renderParameters(sourceNode);
      if (window.editor?.markDirty) window.editor.markDirty('binding-source-focus');
      if (window.editor?.draw) window.editor.draw();
    } catch {
      // Non-fatal: the binding status is informational even if focusing fails.
    }
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

  // Pop a brief message anchored directly beneath an element (e.g. a parameter's copy icon), so the
  // confirmation appears where the user is looking instead of in the far corner like showToast.
  showAnchoredMessage(anchorEl, message) {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const tip = document.createElement('div');
    tip.textContent = message;
    tip.style.cssText = `
      position: fixed;
      left: ${rect.left + rect.width / 2}px;
      top: ${rect.bottom + 6}px;
      transform: translateX(-50%);
      background: ${ACCENT.base};
      color: ${ACCENT.ink};
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      z-index: 100000;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      opacity: 0;
      transition: opacity 0.15s;
    `;
    document.body.appendChild(tip);
    requestAnimationFrame(() => { tip.style.opacity = '1'; });
    setTimeout(() => {
      tip.style.opacity = '0';
      setTimeout(() => tip.remove(), 200);
    }, 1100);
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    const colors = {
      success: ACCENT.base,
      warning: SEMANTIC.warn,
      error: SEMANTIC.error,
      info: SEMANTIC.info
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
    // First try currently focused input
    const focusedInput = this.panel.querySelector('.param-input:focus');
    if (focusedInput) {
      const paramName = focusedInput.getAttribute('data-param');

      if (this.selectedNode && paramName) {
        const paramDef = this.getParameterDefinitions(this.selectedNode)
          .find(p => p.name === paramName);
        if (paramDef) {
          return { name: paramName, ...paramDef };
        }
      }
    }

    // Fall back to last focused parameter (for MIDI learn)
    if (this.lastFocusedParameter &&
        this.lastFocusedParameter.node === this.selectedNode) {
      const paramName = this.lastFocusedParameter.paramName;
      const paramDef = this.getParameterDefinitions(this.selectedNode)
        .find(p => p.name === paramName);
      if (paramDef) {
        return { name: paramName, ...paramDef };
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
      padding: 7px 9px;
      background: ${SURFACE.well};
      color: ${TEXT.primary};
      border: 1px solid ${SURFACE.line};
      border-radius: 8px;
      font-family: ${FONT_MONO};
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
      background: ${SURFACE.well};
      border-radius: 10px;
      border: 1px solid ${SURFACE.line};
    `;

    const helpTitle = document.createElement('div');
    helpTitle.textContent = 'Expression Help';
    helpTitle.style.cssText = `
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      margin-bottom: 8px;
      color: ${TEXT.faint};
    `;

    const helpContent = document.createElement('div');
    helpContent.innerHTML = `
      <div style="font-size: 10px; line-height: 1.5; color: ${TEXT.secondary};">
        <strong>Expression Syntax:</strong><br>
        • Start with <code>=</code> to create expressions<br>
        • Use <code>sin(x)</code>, <code>cos(x)</code>, <code>sqrt(x)</code>, etc.<br>
        • Access other parameters: <code>=radius * 2</code><br>
        • Reference another node: <code>=node_5</code> — or drag that node from the graph
          and drop it on this field<br>
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
  // Extract fields safely from the action object
  const name = action?.parameterName || action?.name || "";
  const value = action?.newValue ?? action?.value ?? 0;

  // Warn for negative geometry parameters
  if (Number(value) < 0 && name === "radius") {
    if (typeof window.updateStatus === "function") {
      window.updateStatus("Radius cannot be negative – auto-corrected", "warning");
    }
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
    // Video playback lives on the node's own <video> element, which no shader rebuild touches.
    // Applying it here means Play/Loop/Speed/Sound respond immediately, including on a texture
    // node that isn't wired to the output yet. A no-op for every other node.
    window.textureManager?.applyVideoParams?.(node.id, node.params);

    if (window.editor?.previewSystem?.canvasManager) {
      window.editor.previewSystem.canvasManager.canvasCache.delete(node.id);
    }

    if (window.editor?.previewIntegration) {
      window.editor.previewIntegration.generateNodePreview(node);

      if (window.editor?.graph?.nodes) {
        // Use expression-aware downstream tracking
        const downstreamNodes = this.graphProcessor.findDownstreamNodes(node.id, window.editor.graph.nodes);

        downstreamNodes.forEach(downstreamNode => {
          if (!downstreamNode || downstreamNode.id === node.id) {
            return;
          }
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

          // Use expression-aware downstream tracking
          const downstream = this.graphProcessor.findDownstreamNodes(nodeId, window.editor.graph.nodes);

          return downstream.some(n => hasOutputInChain(n.id, visited));
        };

        if (hasOutputInChain(node.id) && window.editor.onChange) {
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

    // Trigger canvas redraw to update node labels with new preview values
    if (window.editor?.draw) {
      if (window.editor.markDirty) window.editor.markDirty('parameter-change');
      window.editor.draw();
    } else if (typeof window.render === 'function') {
      window.render();
    }

  } catch {
  }
}

  forceEditorUpdate() {
    try {
      if (window.editor) {
        if (window.editor.previewSystem?.canvasManager?.canvasCache) {
          window.editor.previewSystem.canvasManager.canvasCache.clear();
        }

        if (window.editor.safeDraw) {
          window.editor.safeDraw();
        } else if (window.editor.draw) {
          if (window.editor.markDirty) window.editor.markDirty('preview-toggle');
          window.editor.draw();
        }

        if (window.editor.onChange) {
          window.editor.onChange('Parameter Panel Update');
        }
      }
    } catch {
    }
  }

  handleParameterChange(data) {
    const { node, parameterName, newValue, source } = data;

    if (this.selectedNode && this.selectedNode.id === node.id) {
      // Anything driving a parameter from OUTSIDE this panel, continuously: a MIDI knob, an OSC
      // message, a slider in the Audio panel. They all need the same thing — the number in the
      // field kept honest without rebuilding the panel under the artist's cursor — and only the
      // MIDI one used to get it, so an OSC-driven or panel-driven parameter sat at a stale value
      // while the node underneath it moved. refreshParameterDisplays() below repaints expression
      // readouts, not the field itself, which is why the plain number never budged.
      if (EXTERNAL_PARAMETER_SOURCES.has(source)) {
        // LIGHTWEIGHT: Just update the input text value (no queries, no style changes)
        this._lightweightExternalValueUpdate(node.id, parameterName, newValue);

        // Store pending update data for potential flushing on deselect
        this._pendingMidiUpdate = { node, parameterName, newValue };

        // Debounce expensive operations until the controller stops moving
        if (this._midiDisplayUpdateTimer) {
          clearTimeout(this._midiDisplayUpdateTimer);
        }
        this._midiDisplayUpdateTimer = setTimeout(() => {
          // Update expression cache and full display after MIDI stops
          this.expressionSystem.updateDependencies(node.id, parameterName, newValue);
          this.refreshParameterDisplays();
          this._pendingMidiUpdate = null;
        }, this._midiDisplayUpdateDelay);

        return;
      }

      // For non-MIDI sources, update immediately
      this.expressionSystem.updateDependencies(node.id, parameterName, newValue);

      // Switching a mode changes which of the other parameters the node actually reads, and the
      // dimming that says so is decided at render time — so that parameter needs a full redraw,
      // not just refreshed values. Only parameters something else keys off qualify, so ordinary
      // edits still take the cheap path and nothing is rebuilt under the user's cursor.
      if (this._controlsOtherParameters(node, parameterName)) {
        this.renderParameters(node);
        return;
      }

      this.refreshParameterDisplays();
    } else if (source !== 'midi') {
      // Only update dependencies for non-MIDI sources if node not selected
      this.expressionSystem.updateDependencies(node.id, parameterName, newValue);
    }
  }

  _lightweightExternalValueUpdate(nodeId, paramName, newValue) {
    // Ultra-lightweight: just update the input.value text, nothing else
    // No DOM queries, no style changes, no validation - just the text
    const key = `${nodeId}_${paramName}`;
    const inputData = this.textInputHandler?.activeInputs?.get(key);

    if (inputData?.input && document.activeElement !== inputData.input) {
      // A field holding an expression is NOT the controller's readout — the reading reaches the
      // formula as `midi` and the formula stays in the field. Writing the number here would erase
      // it on the first CC, which is exactly what made an expression and a MIDI mapping mutually
      // exclusive; the evaluated value is refreshed by refreshParameterDisplays when MIDI settles.
      if (this.expressionSystem.isExpression(inputData.input.value)) {
        // Still move the evaluated readout, so the formula visibly tracks the controller. One
        // cached-AST evaluation and one text write — the full validated refresh runs on the
        // debounce once MIDI settles.
        if (inputData.resultDisplay) {
          const evaluated = this.expressionSystem.evaluateExpression(
            inputData.input.value, {}, inputData.node, paramName,
          );
          inputData.resultDisplay.textContent = `→ ${evaluated}`;
        }
        return;
      }

      // Only update if user is not currently editing
      const displayValue = typeof newValue === 'number'
        ? Math.round(newValue * 10000) / 10000
        : newValue;
      inputData.input.value = String(displayValue);

      // And the evaluated readout beside it. The field is a textarea — its text is not what the eye
      // lands on, this "→ 0.5" is — and nothing else refreshes it for a plain number: the debounced
      // refreshParameterDisplays repaints expression results only. Left out, a threshold moved from
      // the Audio panel or by a controller showed its new value in the field and its OLD value in
      // the readout, for the rest of the session.
      if (inputData.resultDisplay) {
        inputData.resultDisplay.textContent = `→ ${displayValue}`;
      }
    }
  }

updateDependentExpressions(_node) {
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
        // A dropdown or toggle in fx mode reads out the OPTION its expression lands on, not the
        // number behind it — repainting it here with the evaluated result would replace
        // "→ Proportional" with "→ 0" every time any value in the panel moved.
        if (display.classList.contains('discrete-expression-result')) {
          const verdict = discreteReadout(
            this.selectedNode,
            input.dataset.param,
            input.value,
            isBooleanParamType(input.dataset.paramType),
          );
          if (verdict) {
            display.textContent = verdict.text;
            display.style.color = verdict.error ? SEMANTIC.error : TEXT.tertiary;
          }
          return;
        }

        const validation = this.expressionSystem.validateExpression(
          input.value,
          {},
          this.selectedNode,
          input.dataset.param || null,
        );

        if (validation.valid) {
          display.textContent = `→ ${validation.result}`;
          // A live value is not a success message — only the error state gets a
          // colour, so a working expression stays quiet.
          display.style.color = TEXT.tertiary;
        } else {
          display.textContent = `Error: ${validation.error}`;
          display.style.color = SEMANTIC.error;
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

  setDevice(device) {
    if (this.wgslCodeInputHandler) {
      this.wgslCodeInputHandler.setDevice(device);
    }
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

    if (this.wgslCodeInputHandler && this.wgslCodeInputHandler.destroy) {
      this.wgslCodeInputHandler.destroy();
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
