// src/core/ViewportManager.js
export class ViewportManager {
  constructor() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._isPanning = false;
    this._panStart = null;
  }

  startPan(clientX, clientY) {
    this._isPanning = true;
    this._panStart = {
      x: clientX,
      y: clientY,
      ox: this.offsetX,
      oy: this.offsetY,
    };
  }

  updatePan(clientX, clientY) {
    if (!this._isPanning || !this._panStart) return false;

    const dx = clientX - this._panStart.x;
    const dy = clientY - this._panStart.y;
    this.offsetX = this._panStart.ox + dx;
    this.offsetY = this._panStart.oy + dy;
    return true;
  }

  stopPan() {
    this._isPanning = false;
    this._panStart = null;
  }

  zoom(mouseX, mouseY, delta) {
    const prev = this.scale;
    const step = 1 + -Math.sign(delta) * 0.1;
    const next = Math.min(2.5, Math.max(0.25, prev * step));

    if (next === prev) return false;

    const k = next / prev;
    this.offsetX = mouseX - (mouseX - this.offsetX) * k;
    this.offsetY = mouseY - (mouseY - this.offsetY) * k;
    this.scale = next;
    return true;
  }

  screenToCanvas(screenX, screenY) {
    return {
      x: (screenX - this.offsetX) / this.scale,
      y: (screenY - this.offsetY) / this.scale,
    };
  }

  canvasToScreen(canvasX, canvasY) {
    return {
      x: canvasX * this.scale + this.offsetX,
      y: canvasY * this.scale + this.offsetY,
    };
  }

  isPanning() {
    return this._isPanning;
  }
}
