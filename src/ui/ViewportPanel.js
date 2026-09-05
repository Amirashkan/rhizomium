// src/ui/ViewportPanel.js

import { clampPanelPosition, keepPanelInBounds } from './utils/windowBounds.js';
import { makeResizable } from './utils/resizable.js';

/**
 * ViewportPanel - Manages 3D viewport display and controls
 * Integrates Viewport3D with the editor UI
 */

export class ViewportPanel {
  constructor(viewport3D, scene) {
    this.viewport3D = viewport3D;
    this.scene = scene;
    this.isVisible = false;
    this.panelElement = null;
    this.canvasContainer = null;
    this.controlsContainer = null;

    this.createPanel();
    this.setupEventListeners();
  }

  /**
   * Create the viewport panel UI
   */
  createPanel() {
    // Create panel container
    this.panelElement = document.createElement('div');
    this.panelElement.id = 'viewport3d-panel';
    this.panelElement.className = 'viewport3d-panel hidden';
    this.panelElement.style.cssText = `
      position: fixed;
      top: 60px;
      right: 16px;
      width: 560px;
      height: 460px;
      min-width: 320px;
      min-height: 260px;
      max-width: 92vw;
      max-height: 88vh;
      background: rgba(20, 20, 25, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      overflow: hidden;
    `;

    // Create header
    const header = document.createElement('div');
    header.className = 'viewport3d-header';
    header.style.cssText = `
      padding: 8px 12px;
      background: rgba(40, 40, 50, 0.8);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
    `;

    const title = document.createElement('span');
    title.textContent = '3D Viewport';
    title.style.cssText = `
      color: #f3ede4;
      font-size: 12px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    // Each 3D node renders its own frame; the heading names the one on screen
    this._titleElement = title;

    const headerBtnStyle = `
      background: none;
      border: none;
      color: #8f867a;
      font-size: 16px;
      cursor: pointer;
      padding: 0;
      width: 22px;
      height: 20px;
      line-height: 20px;
      text-align: center;
    `;
    const makeHeaderBtn = (text, titleText) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.title = titleText;
      btn.style.cssText = headerBtnStyle;
      btn.onmouseenter = () => btn.style.color = '#f3ede4';
      btn.onmouseleave = () => btn.style.color = '#8f867a';
      return btn;
    };

    // Maximize / restore
    const maxBtn = makeHeaderBtn('▢', 'Maximize');
    maxBtn.onclick = () => this.toggleMaximize();
    this._maxBtn = maxBtn;

    // Close
    const closeBtn = makeHeaderBtn('×', 'Close (Ctrl+3)');
    closeBtn.className = 'viewport3d-close';
    closeBtn.style.fontSize = '20px';
    closeBtn.onclick = () => this.hide();

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 2px; align-items: center;';
    buttons.appendChild(maxBtn);
    buttons.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(buttons);

    // Create canvas container
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'viewport3d-canvas-container';
    this.canvasContainer.style.cssText = `
      flex: 1;
      position: relative;
      background: #0f0c0a;
      overflow: hidden;
    `;

    // Create controls container
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'viewport3d-controls';
    this.controlsContainer.style.cssText = `
      padding: 8px;
      background: rgba(30, 30, 35, 0.8);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    `;

    // Create camera controls
    this.createCameraControls();

    // Assemble panel
    this.panelElement.appendChild(header);
    this.panelElement.appendChild(this.canvasContainer);
    this.panelElement.appendChild(this.controlsContainer);

    document.body.appendChild(this.panelElement);

    // Make panel draggable
    this.makeDraggable(header);
    this.makeResizable();
  }

  /**
   * Create camera control buttons
   */
  createCameraControls() {
    const buttonStyle = `
      padding: 4px 8px;
      background: rgba(60, 60, 70, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: #f3ede4;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.2s;
    `;

    // Reset camera button
    const resetBtn = this.createButton('Reset Camera', buttonStyle);
    resetBtn.onclick = () => {
      if (this.viewport3D) {
        this.viewport3D.resetCamera();
      }
    };

    // Camera type toggle
    const cameraTypeBtn = this.createButton('Perspective', buttonStyle);
    this._cameraTypeBtn = cameraTypeBtn;
    cameraTypeBtn.onclick = () => {
      const isPerspective = this.viewport3D?.getCameraType?.() !== 'perspective';
      if (this.viewport3D) {
        this.viewport3D.setCameraType(isPerspective ? 'perspective' : 'orthographic');
        cameraTypeBtn.textContent = isPerspective ? 'Perspective' : 'Orthographic';
      }
    };

    const labelStyle = `
      color: #8f867a;
      font-size: 11px;
      align-self: center;
      user-select: none;
    `;
    const selectStyle = `
      padding: 3px 6px;
      background: rgba(60, 60, 70, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: #f3ede4;
      font-size: 11px;
      cursor: pointer;
    `;

    // Node selector - which 3D node this viewport is looking at. Every 3D
    // node renders independently, so the viewport shows one at a time and the
    // controls below act on that node alone.
    const nodeLabel = document.createElement('span');
    nodeLabel.textContent = '3D Node';
    nodeLabel.style.cssText = labelStyle;

    this.nodeSelect = document.createElement('select');
    this.nodeSelect.style.cssText = selectStyle + 'max-width: 150px;';
    this.nodeSelect.title = 'Which 3D Field Visualizer this viewport shows';
    this.nodeSelect.onchange = () => {
      window.fieldMapperIntegration?.setFocus?.(this.nodeSelect.value);
      this.syncShapeSelect();
      this.syncCameraControls();
    };

    // Shape selector - applies to the focused 3D Field Visualizer node
    const shapeLabel = document.createElement('span');
    shapeLabel.textContent = 'Shape';
    shapeLabel.style.cssText = labelStyle;

    this.shapeSelect = document.createElement('select');
    this.shapeSelect.style.cssText = selectStyle;
    for (const shape of ['plane', 'sphere', 'box', 'torus', 'instances']) {
      const option = document.createElement('option');
      option.value = shape;
      option.textContent = shape[0].toUpperCase() + shape.slice(1);
      this.shapeSelect.appendChild(option);
    }
    this.shapeSelect.onchange = () => {
      const node = this.getFocusedNode();
      if (!node) return;
      const value = this.shapeSelect.value;
      node.params = node.params || {};
      if (value === 'instances') {
        node.params.mode = 'instances';
      } else {
        node.params.mode = 'surface';
        node.params.shape = value;
      }
      if (typeof window.updateShaderFromGraph === 'function') {
        window.updateShaderFromGraph();
      } else if (typeof window.rebuild === 'function') {
        window.rebuild();
      }
    };

    // FOV slider (perspective camera)
    const fovLabel = document.createElement('span');
    fovLabel.textContent = 'FOV';
    fovLabel.style.cssText = labelStyle;

    const fovSlider = document.createElement('input');
    this._fovSlider = fovSlider;
    fovSlider.type = 'range';
    fovSlider.min = '25';
    fovSlider.max = '110';
    fovSlider.value = String(this.viewport3D?.getCamera?.()?.fov ?? 60);
    fovSlider.style.cssText = 'width: 70px; align-self: center;';
    fovSlider.oninput = () => {
      const camera = this.viewport3D?.getCamera?.();
      if (camera && typeof camera.setPerspective === 'function') {
        camera.setPerspective(Number(fovSlider.value), camera.aspect, camera.near, camera.far);
      }
    };

    // Auto-rotate toggle + speed
    const spinLabel = document.createElement('label');
    spinLabel.style.cssText = labelStyle + 'display: flex; gap: 4px; align-items: center; cursor: pointer;';
    const spinCheckbox = document.createElement('input');
    this._spinCheckbox = spinCheckbox;
    spinCheckbox.type = 'checkbox';
    spinCheckbox.onchange = () => {
      if (this.viewport3D) {
        this.viewport3D.autoRotate = spinCheckbox.checked;
      }
    };
    spinLabel.appendChild(spinCheckbox);
    spinLabel.appendChild(document.createTextNode('Spin'));

    const spinSpeedSlider = document.createElement('input');
    this._spinSpeedSlider = spinSpeedSlider;
    spinSpeedSlider.type = 'range';
    spinSpeedSlider.min = '0.05';
    spinSpeedSlider.max = '2';
    spinSpeedSlider.step = '0.05';
    spinSpeedSlider.value = String(this.viewport3D?.autoRotateSpeed ?? 0.25);
    spinSpeedSlider.title = 'Spin speed';
    spinSpeedSlider.style.cssText = 'width: 60px; align-self: center;';
    spinSpeedSlider.oninput = () => {
      if (this.viewport3D) {
        this.viewport3D.autoRotateSpeed = Number(spinSpeedSlider.value);
        // Nudging the speed while stopped is a clear "I want it spinning"
        if (!this.viewport3D.autoRotate) {
          this.viewport3D.autoRotate = true;
          spinCheckbox.checked = true;
        }
      }
    };

    this.controlsContainer.appendChild(nodeLabel);
    this.controlsContainer.appendChild(this.nodeSelect);
    this.controlsContainer.appendChild(shapeLabel);
    this.controlsContainer.appendChild(this.shapeSelect);
    this.controlsContainer.appendChild(fovLabel);
    this.controlsContainer.appendChild(fovSlider);
    this.controlsContainer.appendChild(spinLabel);
    this.controlsContainer.appendChild(spinSpeedSlider);
    this.controlsContainer.appendChild(resetBtn);
    this.controlsContainer.appendChild(cameraTypeBtn);
  }

  /**
   * The graph node this viewport is currently showing
   * @returns {Object|null}
   */
  getFocusedNode() {
    const graph = window.editor?.graph;
    if (!graph?.nodes) return null;
    const focusedId = window.fieldMapperIntegration?.getFocusedNodeId?.();
    if (focusedId !== null && focusedId !== undefined) {
      const focused = graph.nodes.find((n) => n && String(n.id) === String(focusedId));
      if (focused) return focused;
    }
    return graph.nodes.find((n) => n && n.kind === 'ComputeFieldMapper') || null;
  }

  /**
   * Human-readable name for a 3D node, matching what the editor shows
   * @param {Object} node
   * @returns {string}
   */
  nodeDisplayName(node) {
    return `${node?.name || '3D Field Visualizer'} #${node?.id}`;
  }

  /**
   * Rebuild the 3D-node selector from the graph and mark the focused entry.
   * The heading follows it, so the panel always says which node is on screen.
   */
  syncNodeSelect() {
    if (!this.nodeSelect) return;
    const nodes = (window.editor?.graph?.nodes || []).filter((n) => n && n.kind === 'ComputeFieldMapper');
    const focused = this.getFocusedNode();
    const focusedId = focused ? String(focused.id) : '';

    // Rebuild only when the set of nodes (or their names) actually changed -
    // this runs on every panel update
    const signature = nodes.map((n) => `${n.id}:${n.name || ''}`).join('|');
    if (signature !== this._nodeSelectSignature) {
      this._nodeSelectSignature = signature;
      this.nodeSelect.innerHTML = '';
      for (const node of nodes) {
        const option = document.createElement('option');
        option.value = String(node.id);
        option.textContent = this.nodeDisplayName(node);
        this.nodeSelect.appendChild(option);
      }
    }

    if (focusedId && this.nodeSelect.value !== focusedId) {
      this.nodeSelect.value = focusedId;
    }
    this.nodeSelect.disabled = nodes.length < 2;

    if (this._titleElement) {
      const heading = focused ? `3D Viewport - ${this.nodeDisplayName(focused)}` : '3D Viewport';
      // Only write when it changed - this runs on every frame the panel is open
      if (this._titleElement.textContent !== heading) {
        this._titleElement.textContent = heading;
      }
    }
  }

  /**
   * Reflect the focused node's shape in the selector
   */
  syncShapeSelect() {
    if (!this.shapeSelect) return;
    const mapper = this.getFocusedNode();
    if (mapper) {
      const params = mapper.params || {};
      const legacyPoints = params.shape === 'points' || (!params.shape && params.mappingMode === 'points');
      const value = (params.mode === 'instances' || (!params.mode && legacyPoints))
        ? 'instances'
        : ((params.shape && params.shape !== 'points') ? params.shape : 'plane');
      if (this.shapeSelect.value !== value) {
        this.shapeSelect.value = value;
      }
    }
  }

  /**
   * Reflect the focused node's camera in the FOV / spin / projection widgets.
   * Switching nodes loads that node's own camera into the controller, so the
   * widgets have to follow it rather than keep the previous node's values.
   */
  syncCameraControls() {
    const vp = this.viewport3D;
    if (!vp) return;
    const camera = vp.getCamera?.();
    if (this._fovSlider && Number.isFinite(camera?.fov)) {
      this._fovSlider.value = String(camera.fov);
    }
    if (this._cameraTypeBtn) {
      this._cameraTypeBtn.textContent = vp.getCameraType?.() === 'orthographic' ? 'Orthographic' : 'Perspective';
    }
    if (this._spinCheckbox) {
      this._spinCheckbox.checked = !!vp.autoRotate;
    }
    if (this._spinSpeedSlider && Number.isFinite(vp.autoRotateSpeed)) {
      this._spinSpeedSlider.value = String(vp.autoRotateSpeed);
    }
  }

  /**
   * Called by FieldMapperIntegration when the viewport switches nodes
   * @param {string|null} _nodeId
   */
  onFocusChanged(_nodeId) {
    this.syncNodeSelect();
    this.syncShapeSelect();
    this.syncCameraControls();
  }

  /**
   * Create a button element
   */
  createButton(text, style) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = style;
    btn.onmouseenter = () => btn.style.background = 'rgba(80, 80, 90, 0.8)';
    btn.onmouseleave = () => btn.style.background = 'rgba(60, 60, 70, 0.8)';
    return btn;
  }

  /**
   * Make panel draggable
   */
  makeDraggable(handle) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      initialX = e.clientX - this.panelElement.offsetLeft;
      initialY = e.clientY - this.panelElement.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      // Clamped so the panel can't be dragged off screen, or under the top
      // menu bar - which paints above it and would swallow this very header.
      const bounded = clampPanelPosition(e.clientX - initialX, e.clientY - initialY, {
        keepVisibleX: 200,
        keepVisibleY: 120,
      });
      currentX = bounded.left;
      currentY = bounded.top;
      this.panelElement.style.left = currentX + 'px';
      this.panelElement.style.top = currentY + 'px';
      this.panelElement.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Shrinking the window under a dragged panel would otherwise strand it off
    // screen, or leave one near the top inside the menu bar. An undragged panel
    // is still anchored by `right`, so keepPanelInBounds leaves it be; so is a
    // maximized one, which is sized in viewport units.
    window.addEventListener('resize', () => {
      if (this._maximized) return;
      keepPanelInBounds(this.panelElement, { keepVisibleX: 200, keepVisibleY: 120 });
    });
  }

  /**
   * Make panel resizable from every edge and corner.
   *
   * The panel sits at `right: 16px` until it is dragged or maximized, so the
   * anchor is read from the element each time: keeping it pinned to the right
   * edge is what makes a width change grow the window leftwards, the way a
   * panel parked in that corner should behave.
   */
  makeResizable() {
    const usesLeft = () => {
      const left = this.panelElement.style.left;
      return !!left && left !== 'auto';
    };

    this._cleanupResizable = makeResizable(this.panelElement, {
      minWidth: 320,
      minHeight: 260,
      anchor: () => ({ x: usesLeft() ? 'left' : 'right', y: 'top' }),
      onResize: () => this._resizeCanvasToContainer(),
    });
  }

  /**
   * Match the 3D canvas to the space the panel currently leaves it.
   *
   * Called on every step of a resize drag, so it does its own measuring rather
   * than waiting a tick the way _syncCanvasSize does — a canvas that lags the
   * window by a frame is visible as the panel is pulled about.
   * @private
   */
  _resizeCanvasToContainer() {
    if (!this.viewport3D?.canvas || !this.canvasContainer) return;

    const width = this.canvasContainer.clientWidth;
    const height = this.canvasContainer.clientHeight;
    if (width <= 0 || height <= 0) return;

    this.viewport3D.canvas.width = width;
    this.viewport3D.canvas.height = height;
    this.viewport3D.handleResize?.(width, height);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for scene updates
    if (this.scene) {
      // Could add scene update listeners here
    }
  }

  /**
   * Set the 3D canvas to display in the panel
   */
  setCanvas(canvas) {
    if (!canvas) return;

    // Clear existing canvas
    this.canvasContainer.innerHTML = '';

    // Add canvas to container. position/inset MUST be set inline: the editor
    // stylesheet has a global `canvas { position: fixed; left: 0; }` rule that
    // would otherwise rip the canvas out of the panel and stretch it across
    // the full display width (percent widths on fixed elements resolve
    // against the viewport).
    canvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      z-index: 0;
    `;
    this.canvasContainer.appendChild(canvas);

    // Resize canvas to match container after it's been added
    setTimeout(() => {
      const containerWidth = this.canvasContainer.clientWidth;
      const containerHeight = this.canvasContainer.clientHeight;

      if (containerWidth > 0 && containerHeight > 0) {
        canvas.width = containerWidth;
        canvas.height = containerHeight;

        // Update viewport3D if available
        if (this.viewport3D && this.viewport3D.handleResize) {
          this.viewport3D.handleResize(containerWidth, containerHeight);
        }
      }
    }, 0);
  }

  /**
   * Show the viewport panel
   */
  show() {
    this.isVisible = true;
    this.panelElement.style.display = 'flex';
    this.panelElement.classList.remove('hidden');
    this.syncNodeSelect();
    this.syncShapeSelect();
    this.syncCameraControls();

    // The canvas had no layout while hidden; sync its backing size (and the
    // camera aspect) to the now-measurable container
    this._syncCanvasSize();
  }

  /**
   * Hide the viewport panel
   */
  hide() {
    this.isVisible = false;
    this.panelElement.style.display = 'none';
    this.panelElement.classList.add('hidden');
  }

  /**
   * Maximize the window to (nearly) the full display, or restore its
   * previous size and position.
   */
  toggleMaximize() {
    const el = this.panelElement;
    if (!this._maximized) {
      this._restoreRect = {
        top: el.style.top, left: el.style.left, right: el.style.right,
        width: el.style.width, height: el.style.height
      };
      el.style.top = '48px';
      el.style.left = '16px';
      el.style.right = 'auto';
      el.style.width = 'calc(100vw - 32px)';
      el.style.height = 'calc(100vh - 64px)';
      this._maximized = true;
      if (this._maxBtn) this._maxBtn.title = 'Restore';
    } else {
      const r = this._restoreRect || {};
      el.style.top = r.top || '60px';
      el.style.left = r.left || 'auto';
      el.style.right = r.right || '16px';
      el.style.width = r.width || '560px';
      el.style.height = r.height || '460px';
      this._maximized = false;
      if (this._maxBtn) this._maxBtn.title = 'Maximize';
    }
    this._syncCanvasSize();
  }

  /**
   * Match the canvas backing store (and camera aspect) to the container
   * @private
   */
  _syncCanvasSize() {
    setTimeout(() => {
      if (this.viewport3D && this.viewport3D.canvas && this.canvasContainer) {
        const containerWidth = this.canvasContainer.clientWidth;
        const containerHeight = this.canvasContainer.clientHeight;
        if (containerWidth > 0 && containerHeight > 0) {
          this.viewport3D.canvas.width = containerWidth;
          this.viewport3D.canvas.height = containerHeight;
          if (this.viewport3D.handleResize) {
            this.viewport3D.handleResize(containerWidth, containerHeight);
          }
        }
      }
    }, 0);
  }

  /**
   * Toggle viewport visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Reset viewport to default size and position
   */
  reset() {
    this.panelElement.style.width = '560px';
    this.panelElement.style.height = '460px';
    this.panelElement.style.top = '60px';
    this.panelElement.style.right = '16px';
    this.panelElement.style.left = 'auto';
    this.panelElement.style.bottom = 'auto';
    this._maximized = false;

    this._syncCanvasSize();
  }

  /**
   * Update viewport state
   */
  update() {
    if (this.isVisible && this.viewport3D) {
      this.viewport3D.update();
      // Nodes are added, deleted and renamed while the panel is open
      this.syncNodeSelect();
    }
  }

  /**
   * Capture the full viewport state (window geometry, camera, spin) so it can
   * be saved with the project and restored on load. Returns null if the 3D
   * subsystem isn't available.
   */
  serializeState() {
    try {
      const vp = this.viewport3D;
      const cam = vp?.getCamera?.();
      const cc = vp?.cameraController;
      const el = this.panelElement;
      const state = {
        visible: !!this.isVisible,
        maximized: !!this._maximized,
      };
      if (el) {
        // Persist the *restored* rect when maximized, so reload doesn't lock the
        // window to a maximized frame with no way back to its prior size.
        const rect = (this._maximized && this._restoreRect) ? this._restoreRect : {
          left: el.style.left, top: el.style.top, right: el.style.right,
          width: el.style.width, height: el.style.height,
        };
        state.window = rect;
      }
      if (cc) {
        const angles = cc.getAngles?.() || { azimuth: cc.azimuth, elevation: cc.elevation };
        const target = cc.getTarget?.() || cc.target || { x: 0, y: 0, z: 0 };
        state.camera = {
          azimuth: angles.azimuth,
          elevation: angles.elevation,
          distance: cc.getDistance?.() ?? cc.distance,
          target: [target.x || 0, target.y || 0, target.z || 0],
          type: vp.getCameraType?.() || 'perspective',
          fov: cam?.fov ?? 60,
        };
      }
      state.autoRotate = !!vp?.autoRotate;
      state.autoRotateSpeed = vp?.autoRotateSpeed ?? 0.25;
      return state;
    } catch {
      return null;
    }
  }

  /**
   * Restore a state previously captured by serializeState().
   */
  restoreState(state) {
    if (!state || typeof state !== 'object') return;
    try {
      const el = this.panelElement;
      if (el && state.window) {
        const w = state.window;
        if (w.left != null) el.style.left = w.left;
        if (w.top != null) el.style.top = w.top;
        if (w.right != null) el.style.right = w.right;
        if (w.width) el.style.width = w.width;
        if (w.height) el.style.height = w.height;
      }
      this._maximized = false;

      const vp = this.viewport3D;
      const cc = vp?.cameraController;
      const cam = state.camera;
      if (vp && cc && cam) {
        if (cam.type === 'orthographic' || cam.type === 'perspective') {
          vp.setCameraType(cam.type);
          if (this._cameraTypeBtn) {
            this._cameraTypeBtn.textContent = cam.type === 'perspective' ? 'Perspective' : 'Orthographic';
          }
        }
        if (Number.isFinite(cam.fov) && cam.type !== 'orthographic') {
          const c = vp.getCamera?.();
          if (c?.setPerspective) c.setPerspective(cam.fov, c.aspect, c.near, c.far);
          if (this._fovSlider) this._fovSlider.value = String(cam.fov);
        }
        if (Array.isArray(cam.target)) cc.setTarget?.(cam.target[0], cam.target[1], cam.target[2]);
        if (Number.isFinite(cam.distance)) cc.setDistance?.(cam.distance);
        if (Number.isFinite(cam.azimuth) && Number.isFinite(cam.elevation)) {
          cc.setAngles?.(cam.azimuth, cam.elevation);
        }
      }
      if (vp) {
        if (typeof state.autoRotate === 'boolean') vp.autoRotate = state.autoRotate;
        if (Number.isFinite(state.autoRotateSpeed)) vp.autoRotateSpeed = state.autoRotateSpeed;
        if (this._spinCheckbox) this._spinCheckbox.checked = !!vp.autoRotate;
        if (this._spinSpeedSlider) this._spinSpeedSlider.value = String(vp.autoRotateSpeed);
      }

      // The camera block above is panel-wide, but cameras belong to the 3D
      // NODES now. Hand control back to them: the focused node re-asserts its
      // own saved viewpoint, or - for a project saved before cameras were per
      // node - the restored block becomes those nodes' camera.
      window.fieldMapperIntegration?.onViewportStateRestored?.();

      // Apply visibility last so show()'s canvas-size sync runs against the
      // restored window geometry.
      if (state.visible) {
        this.show();
      } else {
        this.hide();
      }
    } catch {
      // A malformed viewport block must never break project loading.
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this._cleanupResizable) {
      this._cleanupResizable();
      this._cleanupResizable = null;
    }
    if (this.panelElement) {
      this.panelElement.remove();
    }
  }
}
