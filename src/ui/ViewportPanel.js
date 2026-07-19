// src/ui/ViewportPanel.js

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
      color: #fff;
      font-size: 12px;
      font-weight: 500;
    `;

    const headerBtnStyle = `
      background: none;
      border: none;
      color: #999;
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
      btn.onmouseenter = () => btn.style.color = '#fff';
      btn.onmouseleave = () => btn.style.color = '#999';
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
      background: #1a1a1f;
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
      color: #fff;
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
    let isPerspective = true;
    cameraTypeBtn.onclick = () => {
      isPerspective = !isPerspective;
      if (this.viewport3D) {
        this.viewport3D.setCameraType(isPerspective ? 'perspective' : 'orthographic');
        cameraTypeBtn.textContent = isPerspective ? 'Perspective' : 'Orthographic';
      }
    };

    const labelStyle = `
      color: #aaa;
      font-size: 11px;
      align-self: center;
      user-select: none;
    `;
    const selectStyle = `
      padding: 3px 6px;
      background: rgba(60, 60, 70, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: #fff;
      font-size: 11px;
      cursor: pointer;
    `;

    // Shape selector - applies to every 3D Field Visualizer node in the graph
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
      const graph = window.editor?.graph;
      if (!graph?.nodes) return;
      const value = this.shapeSelect.value;
      let changed = false;
      for (const node of graph.nodes) {
        if (node && node.kind === 'ComputeFieldMapper') {
          node.params = node.params || {};
          if (value === 'instances') {
            node.params.mode = 'instances';
          } else {
            node.params.mode = 'surface';
            node.params.shape = value;
          }
          changed = true;
        }
      }
      if (changed && typeof window.updateShaderFromGraph === 'function') {
        window.updateShaderFromGraph();
      } else if (changed && typeof window.rebuild === 'function') {
        window.rebuild();
      }
    };

    // FOV slider (perspective camera)
    const fovLabel = document.createElement('span');
    fovLabel.textContent = 'FOV';
    fovLabel.style.cssText = labelStyle;

    const fovSlider = document.createElement('input');
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
    spinCheckbox.type = 'checkbox';
    spinCheckbox.onchange = () => {
      if (this.viewport3D) {
        this.viewport3D.autoRotate = spinCheckbox.checked;
      }
    };
    spinLabel.appendChild(spinCheckbox);
    spinLabel.appendChild(document.createTextNode('Spin'));

    const spinSpeedSlider = document.createElement('input');
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
   * Reflect the current graph's field-mapper shape in the selector
   */
  syncShapeSelect() {
    if (!this.shapeSelect) return;
    const graph = window.editor?.graph;
    const mapper = graph?.nodes?.find?.((n) => n && n.kind === 'ComputeFieldMapper');
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
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      this.panelElement.style.left = currentX + 'px';
      this.panelElement.style.top = currentY + 'px';
      this.panelElement.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  /**
   * Make panel resizable
   */
  makeResizable() {
    const resizer = document.createElement('div');
    resizer.style.cssText = `
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.1) 50%);
      z-index: 10;
    `;

    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = this.panelElement.offsetWidth;
      startHeight = this.panelElement.offsetHeight;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const width = Math.max(320, startWidth + (e.clientX - startX));
      const height = Math.max(260, startHeight + (e.clientY - startY));
      this.panelElement.style.width = width + 'px';
      this.panelElement.style.height = height + 'px';

      // Resize viewport3D canvas if it exists
      if (this.viewport3D && this.viewport3D.canvas) {
        // Get the actual container size (accounting for header and controls)
        const containerHeight = this.canvasContainer.clientHeight;
        const containerWidth = this.canvasContainer.clientWidth;

        this.viewport3D.canvas.width = containerWidth;
        this.viewport3D.canvas.height = containerHeight;

        // Update viewport3D dimensions
        if (this.viewport3D.handleResize) {
          this.viewport3D.handleResize(containerWidth, containerHeight);
        }
      }
    });

    document.addEventListener('mouseup', () => {
      isResizing = false;
    });

    this.panelElement.appendChild(resizer);
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
    this.syncShapeSelect();

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
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this.panelElement) {
      this.panelElement.remove();
    }
  }
}
