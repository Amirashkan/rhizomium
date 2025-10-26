// src/ui/components/ColorStopInputHandler.js

export class ColorStopInputHandler {
  constructor(undoManager) {
    this.undoManager = undoManager;
  }

  create(param, node, container, label, valueManager, onUpdate) {
    container.innerHTML = '';
    
    const stops = node.params?.[param.name] || param.default;
    
    const widget = document.createElement('div');
    widget.className = 'color-stops-widget';
    widget.style.cssText = `
      background: #222;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 8px;
      margin-top: 4px;
    `;
    
    // Gradient preview container with draggable handles
    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = `
      position: relative;
      height: 30px;
      margin-bottom: 8px;
    `;
    
    // Gradient preview bar
    const previewBar = document.createElement('div');
    previewBar.className = 'gradient-preview';
    previewBar.style.cssText = `
      height: 20px;
      border-radius: 3px;
      background: linear-gradient(to right, ${this.generateGradientCSS(stops)});
      border: 1px solid #666;
      cursor: crosshair;
      position: relative;
    `;
    
    // Click on bar to add new stop
    previewBar.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = previewBar.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const position = Math.max(0, Math.min(1, x / rect.width));
      
      const color = this.interpolateColor(stops, position);
      
      const currentStops = [...node.params[param.name]];
      currentStops.push({ position, color });
      currentStops.sort((a, b) => a.position - b.position);
      
      valueManager.setValue(node, param.name, currentStops);
      onUpdate(`Add color stop at ${position.toFixed(2)}`);
      this.create(param, node, container, label, valueManager, onUpdate);
    });
    
    previewContainer.appendChild(previewBar);
    
    // Add draggable handles for each stop
    stops.forEach((stop, index) => {
      const handle = this.createDraggableHandle(
        stop, 
        index, 
        node, 
        param, 
        valueManager, 
        onUpdate, 
        previewBar, 
        () => this.create(param, node, container, label, valueManager, onUpdate)
      );
      previewContainer.appendChild(handle);
    });
    
    widget.appendChild(previewContainer);
    
    // Stop list container
    const stopList = document.createElement('div');
    stopList.className = 'color-stop-list';
    
    stops.forEach((stop, index) => {
      const stopItem = this.createStopItem(
        stop, 
        index, 
        node, 
        param, 
        valueManager, 
        onUpdate, 
        () => this.create(param, node, container, label, valueManager, onUpdate)
      );
      stopList.appendChild(stopItem);
    });
    
    widget.appendChild(stopList);
    
    // Add stop button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Stop';
    addBtn.style.cssText = `
      width: 100%;
      padding: 6px;
      margin-top: 8px;
      background: #4CAF50;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
    `;
    
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const currentStops = node.params[param.name];
      const newStops = [...currentStops, { position: 0.5, color: [1, 1, 1, 1] }];
      valueManager.setValue(node, param.name, newStops);
      onUpdate(`Add color stop`);
      this.create(param, node, container, label, valueManager, onUpdate);
    });
    
    widget.appendChild(addBtn);
    container.appendChild(widget);
  }
  
  createDraggableHandle(stop, index, node, param, valueManager, onUpdate, previewBar, refreshCallback) {
    const handle = document.createElement('div');
    handle.style.cssText = `
      position: absolute;
      left: ${stop.position * 100}%;
      top: 18px;
      width: 12px;
      height: 12px;
      background: ${this.rgbToHex(stop.color)};
      border: 2px solid white;
      border-radius: 50%;
      cursor: grab;
      transform: translateX(-50%);
      box-shadow: 0 2px 4px rgba(0,0,0,0.5);
      z-index: 10;
      transition: transform 0.1s;
    `;
    
    // Add hover effect
    handle.addEventListener('mouseenter', () => {
      if (!handle.classList.contains('dragging')) {
        handle.style.transform = 'translateX(-50%) scale(1.15)';
      }
    });
    
    handle.addEventListener('mouseleave', () => {
      if (!handle.classList.contains('dragging')) {
        handle.style.transform = 'translateX(-50%)';
      }
    });
    
    let isDragging = false;
    
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      isDragging = true;
      handle.classList.add('dragging');
      handle.style.cursor = 'grabbing';
      handle.style.transform = 'translateX(-50%) scale(1.3)';
      handle.style.zIndex = '20';
      
      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        
        const rect = previewBar.getBoundingClientRect();
        const x = moveEvent.clientX - rect.left;
        const newPosition = Math.max(0, Math.min(1, x / rect.width));
        
        const currentStops = [...node.params[param.name]];
        currentStops[index].position = newPosition;
        
        // Update handle position immediately for smooth dragging
        handle.style.left = `${newPosition * 100}%`;
        
        valueManager.setValue(node, param.name, currentStops);
      };
      
      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          handle.classList.remove('dragging');
          handle.style.cursor = 'grab';
          handle.style.transform = 'translateX(-50%)';
          handle.style.zIndex = '10';
          onUpdate(`Move color stop`);
          refreshCallback();
        }
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    // Double-click to delete
    handle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const currentStops = node.params[param.name];
      if (currentStops.length <= 2) {
        alert('Cannot delete - gradient must have at least 2 stops');
        return;
      }
      
      const newStops = currentStops.filter((_, i) => i !== index);
      valueManager.setValue(node, param.name, newStops);
      onUpdate(`Delete color stop`);
      refreshCallback();
    });
    
    return handle;
  }
  
  interpolateColor(stops, position) {
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    
    // Find surrounding stops
    let before = sorted[0];
    let after = sorted[sorted.length - 1];
    
    for (let i = 0; i < sorted.length - 1; i++) {
      if (position >= sorted[i].position && position <= sorted[i + 1].position) {
        before = sorted[i];
        after = sorted[i + 1];
        break;
      }
    }
    
    if (before === after) return [...before.color];
    
    // Linear interpolation
    const t = (position - before.position) / (after.position - before.position);
    return [
      before.color[0] + (after.color[0] - before.color[0]) * t,
      before.color[1] + (after.color[1] - before.color[1]) * t,
      before.color[2] + (after.color[2] - before.color[2]) * t,
      1
    ];
  }
  
  createStopItem(stop, index, node, param, valueManager, onUpdate, refreshCallback) {
    const item = document.createElement('div');
    item.className = 'color-stop-item';
    item.style.cssText = `
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 6px;
      padding: 6px;
      background: #2a2a2a;
      border-radius: 3px;
      border: 1px solid #444;
    `;
    
    // Position label
    const posLabel = document.createElement('span');
    posLabel.textContent = 'Pos:';
    posLabel.style.cssText = `
      font-size: 10px;
      color: #999;
      min-width: 28px;
    `;
    item.appendChild(posLabel);
    
    // Position input
    const posInput = document.createElement('input');
    posInput.type = 'number';
    posInput.value = stop.position.toFixed(2);
    posInput.min = '0';
    posInput.max = '1';
    posInput.step = '0.01';
    posInput.style.cssText = `
      width: 60px;
      padding: 4px;
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #555;
      border-radius: 3px;
      font-size: 11px;
    `;
    
    posInput.addEventListener('change', (e) => {
      e.stopPropagation();
      const newValue = parseFloat(e.target.value);
      if (isNaN(newValue)) return;
      
      const currentStops = [...node.params[param.name]];
      currentStops[index].position = Math.max(0, Math.min(1, newValue));
      valueManager.setValue(node, param.name, currentStops);
      onUpdate(`Update stop position`);
      refreshCallback();
    });
    
    item.appendChild(posInput);
    
    // Color picker
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = this.rgbToHex(stop.color);
    colorPicker.style.cssText = `
      width: 40px;
      height: 28px;
      border: 1px solid #555;
      border-radius: 3px;
      cursor: pointer;
      background: transparent;
    `;
    
    colorPicker.addEventListener('change', (e) => {
      e.stopPropagation();
      const currentStops = [...node.params[param.name]];
      currentStops[index].color = [...this.hexToRgb(e.target.value), 1];
      valueManager.setValue(node, param.name, currentStops);
      onUpdate(`Update stop color`);
      refreshCallback();
    });
    
    item.appendChild(colorPicker);
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '×';
    deleteBtn.style.cssText = `
      width: 24px;
      height: 24px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      padding: 0;
      line-height: 1;
      margin-left: auto;
    `;
    
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const currentStops = node.params[param.name];
      if (currentStops.length <= 2) {
        alert('Cannot delete - gradient must have at least 2 stops');
        return;
      }
      
      const newStops = currentStops.filter((_, i) => i !== index);
      valueManager.setValue(node, param.name, newStops);
      onUpdate(`Delete color stop`);
      refreshCallback();
    });
    
    item.appendChild(deleteBtn);
    
    return item;
  }
  
  generateGradientCSS(stops) {
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    return sorted.map(stop => {
      const c = stop.color;
      const r = Math.round(c[0] * 255);
      const g = Math.round(c[1] * 255);
      const b = Math.round(c[2] * 255);
      return `rgb(${r},${g},${b}) ${(stop.position * 100).toFixed(1)}%`;
    }).join(', ');
  }
  
  rgbToHex(rgb) {
    const r = Math.round(rgb[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgb[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgb[2] * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  
  hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }
}