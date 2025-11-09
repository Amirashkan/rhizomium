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
      top: 50px;
      right: 10px;
      width: 400px;
      height: 400px;
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

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'viewport3d-close';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #999;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 20px;
      height: 20px;
      line-height: 20px;
      text-align: center;
    `;
    closeBtn.onclick = () => this.hide();
    closeBtn.onmouseenter = () => closeBtn.style.color = '#fff';
    closeBtn.onmouseleave = () => closeBtn.style.color = '#999';

    header.appendChild(title);
    header.appendChild(closeBtn);

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

    // Frame scene button
    const frameBtn = this.createButton('Frame All', buttonStyle);
    frameBtn.onclick = () => {
      if (this.viewport3D && this.scene) {
        // Calculate scene bounds
        const meshNodes = this.scene.getMeshNodes();
        if (meshNodes.length > 0) {
          // Simple framing - could be improved
          this.viewport3D.resetCamera();
        }
      }
    };

    this.controlsContainer.appendChild(resetBtn);
    this.controlsContainer.appendChild(cameraTypeBtn);
    this.controlsContainer.appendChild(frameBtn);
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
      const width = Math.max(300, startWidth + (e.clientX - startX));
      const height = Math.max(200, startHeight + (e.clientY - startY));
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

    // Add canvas to container
    canvas.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
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
    this.panelElement.style.width = '400px';
    this.panelElement.style.height = '400px';
    this.panelElement.style.top = '50px';
    this.panelElement.style.right = '10px';
    this.panelElement.style.left = 'auto';
    this.panelElement.style.bottom = 'auto';

    // Resize canvas to match container
    setTimeout(() => {
      if (this.viewport3D && this.viewport3D.canvas && this.canvasContainer) {
        const containerWidth = this.canvasContainer.clientWidth;
        const containerHeight = this.canvasContainer.clientHeight;

        this.viewport3D.canvas.width = containerWidth;
        this.viewport3D.canvas.height = containerHeight;

        if (this.viewport3D.handleResize) {
          this.viewport3D.handleResize(containerWidth, containerHeight);
        }
      }
    }, 0);
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
