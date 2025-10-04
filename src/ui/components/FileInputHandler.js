// src/ui/components/FileInputHandler.js - Updated for expression system integration

export class FileInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
  }

  create(param, node, div, label, valueManager, onChange) {
    this._showCurrentFile(node, div);
    
    const fileInput = this._createFileInput(param);
    const dropZone = this._createDropZone();
    
    this._setupEventHandlers(fileInput, dropZone, node, param, valueManager, onChange);
    
    div.appendChild(dropZone);
    div.appendChild(fileInput);
    
    return div;
  }

  _showCurrentFile(node, div) {
    const textureInfo = window.textureManager?.getTexture(node.id);
    if (textureInfo && textureInfo.file) {
      const fileLabel = document.createElement("div");
      fileLabel.className = "current-file";
      fileLabel.style.cssText = `
        font-size: 10px;
        color: #4a90e2;
        margin-bottom: 4px;
        font-style: italic;
      `;
      fileLabel.textContent = `✓ ${textureInfo.file.name}`;
      div.appendChild(fileLabel);
    }
  }

  _createFileInput(param) {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = param.accept || "image/*";
    fileInput.style.display = "none";
    fileInput.setAttribute("data-param", param.name);
    fileInput.setAttribute("data-param-type", param.type);
    
    return fileInput;
  }

  _createDropZone() {
    const dropZone = document.createElement("div");
    dropZone.className = "file-drop-zone";
    dropZone.style.cssText = `
      border: 2px dashed #666;
      border-radius: 6px;
      padding: 16px;
      text-align: center;
      color: #aaa;
      font-size: 11px;
      margin: 4px 0;
      cursor: pointer;
      transition: all 0.2s ease;
      background: rgba(255,255,255,0.02);
      min-height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    `;

    dropZone.innerHTML = `
      <div>
        <div style="margin-bottom: 4px;">📁 Drop image here</div>
        <div style="font-size: 9px; opacity: 0.7;">or click to browse</div>
      </div>
    `;

    return dropZone;
  }

  _setupEventHandlers(fileInput, dropZone, node, param, valueManager, onChange) {
    // Click to open file dialog
    dropZone.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    // Drag and drop events
    this._setupDragDropEvents(dropZone, node, param, valueManager, onChange);
    
    // File input change handler
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        this._handleFileLoad(node, file, dropZone, param, valueManager, onChange);
      }
    });

    // Prevent clicks from bubbling up
    fileInput.addEventListener("click", (e) => e.stopPropagation());
  }

  _setupDragDropEvents(dropZone, node, param, valueManager, onChange) {
    dropZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showDragHover(dropZone);
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showDragHover(dropZone);
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only reset if we're actually leaving the drop zone
      if (!dropZone.contains(e.relatedTarget)) {
        this._hideDragHover(dropZone);
      }
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._hideDragHover(dropZone);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("image/")) {
          this._handleFileLoad(node, file, dropZone, param, valueManager, onChange);
        } else {
          this._showErrorState(dropZone, "Please drop an image file");
        }
      }
    });
  }

  _showDragHover(dropZone) {
    dropZone.style.borderColor = "#4a90e2";
    dropZone.style.backgroundColor = "rgba(74, 144, 226, 0.1)";
    dropZone.style.transform = "scale(1.02)";
  }

  _hideDragHover(dropZone) {
    dropZone.style.borderColor = "#666";
    dropZone.style.backgroundColor = "rgba(255,255,255,0.02)";
    dropZone.style.transform = "scale(1)";
  }

  async _handleFileLoad(node, file, dropZone, param, valueManager, onChange) {
    try {
      console.log("Loading texture file:", file.name, "for node:", node.id);

      if (!window.textureManager) {
        throw new Error("TextureManager not available. Make sure it's initialized.");
      }

      this._showLoadingState(dropZone);
      
      // Record the old file for undo if available
      const oldTextureInfo = window.textureManager?.getTexture(node.id);
      const oldFileName = oldTextureInfo?.file?.name || null;
      
      // Load the texture
await window.textureManager.uploadTexture(node.id, file);

      console.log("✅ Texture loaded successfully");

      // Update parameter value through the value manager
      if (valueManager && valueManager.setValue) {
        // Record for undo
        if (this.undoManager && oldFileName !== file.name) {
          this.undoManager.recordParameterChange(node.id, param.name, oldFileName, file.name);
        }
        
        // Set the file name as the parameter value
        valueManager.setValue(node, param.name, file.name);
      } else {
        // Fallback: direct parameter update
        if (!node.params) node.params = {};
        
        if (this.undoManager && oldFileName !== file.name) {
          this.undoManager.recordParameterChange(node.id, param.name, oldFileName, file.name);
        }
        
        node.params[param.name] = file.name;
      }

      this._showSuccessState(dropZone, file);
      this._triggerUpdates(node, onChange);

    } catch (error) {
      console.error('File load error:', error);
      if (window.errorHandler?.handleError) {
        window.errorHandler.handleError(error, { 
          component: 'texture-load', 
          nodeId: node.id 
        });
      }
      this._showErrorState(dropZone, error.message);
    }
  }

  _showLoadingState(dropZone) {
    if (dropZone) {
      dropZone.style.borderColor = "#f0ad4e";
      dropZone.innerHTML = "<div>Loading...</div>";
    }
  }

  _showSuccessState(dropZone, file) {
    if (dropZone) {
      dropZone.style.borderColor = "#5cb85c";
      dropZone.innerHTML = `<div style="color: #5cb85c;">✓ ${file.name}</div>`;

      // Reset after a moment
      setTimeout(() => {
        dropZone.style.borderColor = "#666";
        dropZone.innerHTML = `
          <div>
            <div style="margin-bottom: 4px;">📁 Drop image here</div>
            <div style="font-size: 9px; opacity: 0.7;">or click to browse</div>
          </div>
        `;
      }, 2000);
    }
  }

  _showErrorState(dropZone, errorMessage) {
    if (dropZone) {
      dropZone.style.borderColor = "#d9534f";
      dropZone.innerHTML = '<div style="color: #d9534f;">❌ Load failed</div>';

      console.error('File load error:', errorMessage);

      setTimeout(() => {
        dropZone.style.borderColor = "#666";
        dropZone.innerHTML = `
          <div>
            <div style="margin-bottom: 4px;">📁 Drop image here</div>
            <div style="font-size: 9px; opacity: 0.7;">or click to browse</div>
          </div>
        `;
      }, 3000);
    }
  }

  _triggerUpdates(node, onChange) {
    try {
      // Update node preview if available
      if (window.editor?.previewIntegration) {
        window.editor.previewIntegration.generateNodePreview(node);
      }
      
      // Trigger editor redraw
      if (window.editor?.safeDraw) {
        window.editor.safeDraw();
      } else if (window.editor?.draw) {
        window.editor.draw();
      }

      // Call the onChange callback
      if (onChange) {
        console.log("Triggering parameter update callback...");
        onChange(`File loaded for ${node.kind}`);
      }
    } catch (error) {
      console.warn('Error triggering updates after file load:', error);
    }
  }
}