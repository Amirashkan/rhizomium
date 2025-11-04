/**
 * TimelinePanel.js
 *
 * UI component for timeline and keyframe editing.
 * Displays time ruler, playback controls, and parameter tracks with keyframes.
 */

export class TimelinePanel {
  constructor(editor) {
    console.log('[TimelinePanel] Initializing...', { editor, timelineManager: editor?.timelineManager });

    if (!editor) {
      throw new Error('TimelinePanel requires an editor instance');
    }

    if (!editor.timelineManager) {
      throw new Error('TimelinePanel requires editor.timelineManager to be initialized');
    }

    this.editor = editor;
    this.timelineManager = editor.timelineManager;
    this.visible = false;
    this.height = 200;
    this.minHeight = 100;
    this.maxHeight = 600;

    // UI state
    this.isDraggingPlayhead = false;
    this.isDraggingKeyframe = false;
    this.isDraggingResize = false;
    this.isDraggingLoopStart = false;
    this.isDraggingLoopEnd = false;
    this.draggedKeyframe = null; // { trackIndex, keyframeIndex }
    this.hoveredKeyframe = null;
    this.selectedTrackIndex = null;

    // View state
    this.viewStart = 0;     // Start time of visible range
    this.viewEnd = 10;      // End time of visible range
    this.pixelsPerSecond = 100;

    // Layout
    this.trackHeight = 30;
    this.trackPadding = 5;
    this.rulerHeight = 30;
    this.controlsWidth = 150;
    this.resizeHandleHeight = 5;

    this.createUI();
    this.attachEventListeners();
  }

  /**
   * Create the timeline UI elements
   */
  createUI() {
    // Main container
    this.container = document.createElement('div');
    this.container.id = 'timeline-panel';
    this.container.className = 'timeline-panel';
    this.container.style.display = 'none';

    // Resize handle at top
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'timeline-resize-handle';
    this.resizeHandle.title = 'Drag to resize timeline';
    this.container.appendChild(this.resizeHandle);

    // Header with controls
    this.header = document.createElement('div');
    this.header.className = 'timeline-header';

    // Playback controls
    this.controls = document.createElement('div');
    this.controls.className = 'timeline-controls';

    this.playButton = this.createButton('▶', 'Play/Pause', () => this.togglePlay());
    this.stopButton = this.createButton('■', 'Stop', () => this.stop());
    this.loopButton = this.createButton('⟲', 'Toggle Loop', () => this.toggleLoop());

    this.controls.appendChild(this.playButton);
    this.controls.appendChild(this.stopButton);
    this.controls.appendChild(this.loopButton);

    // Time display
    this.timeDisplay = document.createElement('div');
    this.timeDisplay.className = 'timeline-time-display';
    this.timeDisplay.textContent = '0.00s';
    this.controls.appendChild(this.timeDisplay);

    // Duration input
    const durationLabel = document.createElement('label');
    durationLabel.textContent = 'Duration:';
    durationLabel.style.marginLeft = '10px';
    this.controls.appendChild(durationLabel);

    this.durationInput = document.createElement('input');
    this.durationInput.type = 'number';
    this.durationInput.min = '0.1';
    this.durationInput.step = '0.1';
    this.durationInput.value = '10';
    this.durationInput.className = 'timeline-duration-input';
    this.durationInput.addEventListener('click', (e) => e.stopPropagation());
    this.durationInput.addEventListener('change', (e) => {
      e.stopPropagation();
      const duration = parseFloat(e.target.value);
      if (!isNaN(duration) && duration > 0) {
        this.timelineManager.setDuration(duration);
        this.viewEnd = duration;
        this.render();
      }
    });
    this.controls.appendChild(this.durationInput);

    // FPS input
    const fpsLabel = document.createElement('label');
    fpsLabel.textContent = 'FPS:';
    fpsLabel.style.marginLeft = '10px';
    this.controls.appendChild(fpsLabel);

    this.fpsInput = document.createElement('input');
    this.fpsInput.type = 'number';
    this.fpsInput.min = '1';
    this.fpsInput.max = '240';
    this.fpsInput.value = '60';
    this.fpsInput.className = 'timeline-fps-input';
    this.fpsInput.addEventListener('click', (e) => e.stopPropagation());
    this.fpsInput.addEventListener('change', (e) => {
      e.stopPropagation();
      const fps = parseInt(e.target.value);
      if (!isNaN(fps) && fps > 0) {
        this.timelineManager.setFPS(fps);
      }
    });
    this.controls.appendChild(this.fpsInput);

    // Enable/disable toggle
    this.enableToggle = document.createElement('button');
    this.enableToggle.className = 'timeline-enable-toggle';
    this.enableToggle.textContent = 'Enable Timeline';
    this.enableToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggleTimeline();
    });
    this.controls.appendChild(this.enableToggle);

    this.header.appendChild(this.controls);
    this.container.appendChild(this.header);

    // Canvas for timeline visualization
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'timeline-canvas';
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');

    // Add to document
    document.body.appendChild(this.container);
    console.log('[TimelinePanel] Container appended to body', this.container);

    // Update canvas size
    this.updateCanvasSize();

    console.log('[TimelinePanel] UI created successfully');
  }

  /**
   * Create a button element
   */
  createButton(text, title, onClick) {
    const button = document.createElement('button');
    button.className = 'timeline-button';
    button.textContent = text;
    button.title = title;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick(e);
    });
    return button;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Stop all clicks from propagating out of the timeline panel
    this.container.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Resize handle
    this.resizeHandle.addEventListener('mousedown', (e) => {
      this.isDraggingResize = true;
      this.resizeDragStartY = e.clientY;
      this.resizeDragStartHeight = this.height;
      e.preventDefault();
      e.stopPropagation();
    });

    // Canvas mouse events
    this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.onCanvasMouseLeave(e));
    this.canvas.addEventListener('wheel', (e) => this.onCanvasWheel(e));

    // Global mouse events for dragging
    window.addEventListener('mousemove', (e) => {
      if (this.isDraggingResize) {
        const delta = e.clientY - this.resizeDragStartY;
        this.height = Math.max(this.minHeight, Math.min(this.maxHeight, this.resizeDragStartHeight - delta));
        this.updateLayout();
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingResize = false;
    });

    // Window resize
    window.addEventListener('resize', () => this.updateCanvasSize());

    // Timeline manager callbacks
    this.timelineManager.onTimeChange = (time) => {
      this.timeDisplay.textContent = `${time.toFixed(2)}s`;
      this.render();
    };

    this.timelineManager.onKeyframeChange = () => {
      this.render();
    };

    this.timelineManager.onPlayStateChange = (playing) => {
      this.playButton.textContent = playing ? '⏸' : '▶';
      this.playButton.title = playing ? 'Pause' : 'Play';
    };
  }

  /**
   * Update canvas size
   */
  updateCanvasSize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = (this.height - this.header.offsetHeight - this.resizeHandleHeight) * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${this.height - this.header.offsetHeight - this.resizeHandleHeight}px`;

    this.ctx.scale(dpr, dpr);
    this.render();
  }

  /**
   * Update layout
   */
  updateLayout() {
    this.container.style.height = `${this.height}px`;
    this.updateCanvasSize();
  }

  /**
   * Canvas mouse down event
   */
  onCanvasMouseDown(e) {
    // Stop propagation to prevent node deselection
    e.stopPropagation();

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking on loop markers (higher priority than playhead)
    if (this.timelineManager.getLoop() && y < 15) {
      const loopStart = this.timelineManager.getLoopStart();
      const loopEnd = this.timelineManager.getLoopEnd();
      const loopStartX = this.timeToX(loopStart);
      const loopEndX = this.timeToX(loopEnd);

      // Check loop start marker
      if (x >= loopStartX && x <= loopStartX + 8) {
        this.isDraggingLoopStart = true;
        return;
      }

      // Check loop end marker
      if (x >= loopEndX - 8 && x <= loopEndX) {
        this.isDraggingLoopEnd = true;
        return;
      }
    }

    // Check if clicking on playhead
    const playheadX = this.timeToX(this.timelineManager.getCurrentTime());
    if (Math.abs(x - playheadX) < 5 && y < this.rulerHeight) {
      this.isDraggingPlayhead = true;
      return;
    }

    // Check if clicking on a keyframe
    const keyframe = this.getKeyframeAt(x, y);
    if (keyframe) {
      this.isDraggingKeyframe = true;
      this.draggedKeyframe = keyframe;
      return;
    }

    // Check if clicking on timeline ruler (seek)
    if (y < this.rulerHeight) {
      const time = this.xToTime(x);
      this.timelineManager.setCurrentTime(time);
    }
  }

  /**
   * Canvas mouse move event
   */
  onCanvasMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isDraggingLoopStart) {
      const time = this.xToTime(x);
      this.timelineManager.setLoopStart(time);
      this.render();
      return;
    }

    if (this.isDraggingLoopEnd) {
      const time = this.xToTime(x);
      this.timelineManager.setLoopEnd(time);
      this.render();
      return;
    }

    if (this.isDraggingPlayhead) {
      const time = this.xToTime(x);
      this.timelineManager.setCurrentTime(time);
      return;
    }

    if (this.isDraggingKeyframe && this.draggedKeyframe) {
      const time = this.xToTime(x);
      const track = this.timelineManager.timeline.tracks[this.draggedKeyframe.trackIndex];
      const keyframe = track.keyframes[this.draggedKeyframe.keyframeIndex];

      this.timelineManager.moveKeyframe(track.nodeId, track.paramName, keyframe.time, time);
      return;
    }

    // Update hovered keyframe
    const keyframe = this.getKeyframeAt(x, y);
    this.hoveredKeyframe = keyframe;
    this.render();
  }

  /**
   * Canvas mouse up event
   */
  onCanvasMouseUp(e) {
    this.isDraggingPlayhead = false;
    this.isDraggingKeyframe = false;
    this.isDraggingLoopStart = false;
    this.isDraggingLoopEnd = false;
    this.draggedKeyframe = null;
  }

  /**
   * Canvas mouse leave event
   */
  onCanvasMouseLeave(e) {
    this.hoveredKeyframe = null;
    this.render();
  }

  /**
   * Canvas wheel event (zoom)
   */
  onCanvasWheel(e) {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 1.1 : 0.9;
    const mouseTime = this.xToTime(e.clientX - this.canvas.getBoundingClientRect().left);

    const duration = this.viewEnd - this.viewStart;
    const newDuration = duration * delta;

    const ratio = (mouseTime - this.viewStart) / duration;
    this.viewStart = mouseTime - newDuration * ratio;
    this.viewEnd = this.viewStart + newDuration;

    // Clamp view
    if (this.viewStart < 0) {
      this.viewEnd -= this.viewStart;
      this.viewStart = 0;
    }

    this.updatePixelsPerSecond();
    this.render();
  }

  /**
   * Get keyframe at position
   */
  getKeyframeAt(x, y) {
    if (y < this.rulerHeight) return null;

    const trackY = y - this.rulerHeight;
    const trackIndex = Math.floor(trackY / this.trackHeight);

    if (trackIndex < 0 || trackIndex >= this.timelineManager.timeline.tracks.length) {
      return null;
    }

    const track = this.timelineManager.timeline.tracks[trackIndex];
    const time = this.xToTime(x);

    for (let i = 0; i < track.keyframes.length; i++) {
      const kf = track.keyframes[i];
      const kfX = this.timeToX(kf.time);
      if (Math.abs(x - kfX) < 6) {
        return { trackIndex, keyframeIndex: i };
      }
    }

    return null;
  }

  /**
   * Convert time to x coordinate
   */
  timeToX(time) {
    const viewDuration = this.viewEnd - this.viewStart;
    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    return ((time - this.viewStart) / viewDuration) * canvasWidth;
  }

  /**
   * Convert x coordinate to time
   */
  xToTime(x) {
    const viewDuration = this.viewEnd - this.viewStart;
    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    return this.viewStart + (x / canvasWidth) * viewDuration;
  }

  /**
   * Update pixels per second based on view
   */
  updatePixelsPerSecond() {
    const viewDuration = this.viewEnd - this.viewStart;
    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    this.pixelsPerSecond = canvasWidth / viewDuration;
  }

  /**
   * Toggle play/pause
   */
  togglePlay() {
    this.timelineManager.togglePlay();
  }

  /**
   * Stop playback
   */
  stop() {
    this.timelineManager.stop();
  }

  /**
   * Toggle loop
   */
  toggleLoop() {
    const loop = !this.timelineManager.getLoop();
    this.timelineManager.setLoop(loop);
    this.loopButton.style.opacity = loop ? '1' : '0.5';
  }

  /**
   * Toggle timeline enabled
   */
  toggleTimeline() {
    const enabled = this.timelineManager.toggle();
    this.enableToggle.textContent = enabled ? 'Disable Timeline' : 'Enable Timeline';
    this.enableToggle.style.opacity = enabled ? '1' : '0.7';
  }

  /**
   * Show the timeline panel
   */
  show() {
    console.log('[TimelinePanel] Showing timeline');
    this.visible = true;
    this.container.style.display = 'block';
    this.updateCanvasSize();
    this.render();
  }

  /**
   * Hide the timeline panel
   */
  hide() {
    console.log('[TimelinePanel] Hiding timeline');
    this.visible = false;
    this.container.style.display = 'none';
  }

  /**
   * Toggle visibility
   */
  toggle() {
    console.log('[TimelinePanel] Toggle called, currently visible:', this.visible);
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Render the timeline
   */
  render() {
    if (!this.visible) return;

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Draw loop region (behind everything else)
    this.drawLoopRegion();

    // Draw ruler
    this.drawRuler();

    // Draw tracks
    this.drawTracks();

    // Draw playhead
    this.drawPlayhead();
  }

  /**
   * Draw loop region
   */
  drawLoopRegion() {
    if (!this.timelineManager.getLoop()) return;

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    const loopStart = this.timelineManager.getLoopStart();
    const loopEnd = this.timelineManager.getLoopEnd();

    const loopStartX = this.timeToX(loopStart);
    const loopEndX = this.timeToX(loopEnd);

    // Draw semi-transparent overlay for loop region
    this.ctx.fillStyle = 'rgba(70, 130, 180, 0.15)';
    this.ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, height);

    // Draw loop markers
    const markerHeight = 15;
    const markerWidth = 8;

    // Loop start marker
    this.ctx.fillStyle = this.isDraggingLoopStart ? '#4a90e2' : '#5aa7e2';
    this.ctx.beginPath();
    this.ctx.moveTo(loopStartX, 0);
    this.ctx.lineTo(loopStartX + markerWidth, 0);
    this.ctx.lineTo(loopStartX + markerWidth, markerHeight);
    this.ctx.lineTo(loopStartX, markerHeight);
    this.ctx.closePath();
    this.ctx.fill();

    // Loop start line
    this.ctx.strokeStyle = 'rgba(70, 130, 180, 0.6)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(loopStartX, markerHeight);
    this.ctx.lineTo(loopStartX, height);
    this.ctx.stroke();

    // Loop end marker
    this.ctx.fillStyle = this.isDraggingLoopEnd ? '#4a90e2' : '#5aa7e2';
    this.ctx.beginPath();
    this.ctx.moveTo(loopEndX - markerWidth, 0);
    this.ctx.lineTo(loopEndX, 0);
    this.ctx.lineTo(loopEndX, markerHeight);
    this.ctx.lineTo(loopEndX - markerWidth, markerHeight);
    this.ctx.closePath();
    this.ctx.fill();

    // Loop end line
    this.ctx.strokeStyle = 'rgba(70, 130, 180, 0.6)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(loopEndX, markerHeight);
    this.ctx.lineTo(loopEndX, height);
    this.ctx.stroke();

    this.ctx.lineWidth = 1; // Reset line width
  }

  /**
   * Draw time ruler
   */
  drawRuler() {
    const width = this.canvas.width / (window.devicePixelRatio || 1);

    // Background
    this.ctx.fillStyle = '#2a2a2a';
    this.ctx.fillRect(0, 0, width, this.rulerHeight);

    // Time markers
    this.ctx.fillStyle = '#aaa';
    this.ctx.font = '11px monospace';

    const viewDuration = this.viewEnd - this.viewStart;
    const majorInterval = this.getMajorInterval(viewDuration);

    for (let t = Math.floor(this.viewStart / majorInterval) * majorInterval; t <= this.viewEnd; t += majorInterval) {
      const x = this.timeToX(t);

      // Major tick
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.rulerHeight - 10);
      this.ctx.lineTo(x, this.rulerHeight);
      this.ctx.strokeStyle = '#666';
      this.ctx.stroke();

      // Time label
      this.ctx.fillText(`${t.toFixed(1)}s`, x + 2, this.rulerHeight - 15);
    }
  }

  /**
   * Get major interval for ruler based on view duration
   */
  getMajorInterval(duration) {
    if (duration < 2) return 0.1;
    if (duration < 10) return 1;
    if (duration < 60) return 5;
    return 10;
  }

  /**
   * Draw tracks
   */
  drawTracks() {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const tracks = this.timelineManager.timeline.tracks;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const y = this.rulerHeight + i * this.trackHeight;

      // Track background
      this.ctx.fillStyle = i % 2 === 0 ? '#1e1e1e' : '#252525';
      this.ctx.fillRect(0, y, width, this.trackHeight);

      // Track label
      const node = this.editor.graph.nodes.find(n => n.id === track.nodeId);
      const label = node ? `${node.kind}.${track.paramName}` : `${track.nodeId}.${track.paramName}`;

      this.ctx.fillStyle = '#aaa';
      this.ctx.font = '11px monospace';
      this.ctx.fillText(label, 5, y + this.trackHeight / 2 + 4);

      // Draw keyframes
      this.drawKeyframes(track, i, y);
    }
  }

  /**
   * Draw keyframes for a track
   */
  drawKeyframes(track, trackIndex, y) {
    const centerY = y + this.trackHeight / 2;

    for (let i = 0; i < track.keyframes.length; i++) {
      const kf = track.keyframes[i];
      const x = this.timeToX(kf.time);

      const isHovered = this.hoveredKeyframe &&
        this.hoveredKeyframe.trackIndex === trackIndex &&
        this.hoveredKeyframe.keyframeIndex === i;

      // Keyframe diamond
      this.ctx.beginPath();
      this.ctx.moveTo(x, centerY - 6);
      this.ctx.lineTo(x + 5, centerY);
      this.ctx.lineTo(x, centerY + 6);
      this.ctx.lineTo(x - 5, centerY);
      this.ctx.closePath();

      this.ctx.fillStyle = isHovered ? '#4af' : '#4a90e2';
      this.ctx.fill();

      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
  }

  /**
   * Draw playhead (current time indicator)
   */
  drawPlayhead() {
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const x = this.timeToX(this.timelineManager.getCurrentTime());

    this.ctx.strokeStyle = '#f44';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x, height);
    this.ctx.stroke();

    // Playhead handle
    this.ctx.fillStyle = '#f44';
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x - 5, 10);
    this.ctx.lineTo(x + 5, 10);
    this.ctx.closePath();
    this.ctx.fill();
  }

  /**
   * Update timeline panel (called each frame)
   */
  update() {
    if (this.visible && this.timelineManager.isPlaying()) {
      this.render();
    }
  }
}
