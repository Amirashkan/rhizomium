// src/ui/components/FileInputHandler.js
export class FileInputHandler {
  constructor(onChange) {
    this.onChange = onChange;
  }

  create(param, node, div, label, panel, currentNode) {
    this._showCurrentFile(node, div);
    
    const fileInput = this._createFileInput(param);
    const dropZone = this._createDropZone();
    
    this._setupEventHandlers(fileInput, dropZone, node, panel, currentNode);
    
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
    `;

    dropZone.innerHTML = `
      <div>
        <div style="margin-bottom: 4px;">📁 Drop image here</div>
        <div style="font-size: 9px; opacity: 0.7;">or click to browse</div>
      </div>
    `;

    return dropZone;
  }

  _setupEventHandlers(fileInput, dropZone, node, panel, currentNode) {
    // Click to open file dialog
    dropZone.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    // Drag and drop events
    this._setupDragDropEvents(dropZone, node);
    
    // File input change handler
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        this._handleFileLoad(node, file, dropZone, panel, currentNode);
      }
    });

    // Prevent clicks from bubbling up
    fileInput.addEventListener("click", (e) => e.stopPropagation());
  }

  _setupDragDropEvents(dropZone, node) {
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
          this._handleFileLoad(node, file, dropZone);
        } else {
          alert("Please drop an image file");
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

  async _handleFileLoad(node, file, dropZone, panel, currentNode) {
    try {
      console.log("Loading texture file:", file.name, "for node:", node.id);

      if (!window.textureManager) {
        throw new Error("TextureManager not available. Make sure it's initialized.");
      }

      this._showLoadingState(dropZone);
      
      // Load the texture
      await window.textureManager.loadTexture(node.id, file, node);
      console.log("✅ Texture loaded successfully");

      this._showSuccessState(dropZone, file);
      this._updateParameterPanel(panel, currentNode, node, file);
      this._triggerUpdates(node);

    } catch (error) {
      console.error("Failed to load texture:", error);
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

    alert(`Failed to load texture: ${errorMessage}`);
  }

  _updateParameterPanel(panel, currentNode, node, file) {
    // Update parameter panel to show new file
    if (panel && currentNode === node) {
      const fileLabels = panel.querySelectorAll(".current-file");
      fileLabels.forEach((label) => {
        label.textContent = `✓ ${file.name}`;
        label.style.color = "#5cb85c";
      });
    }
  }

  _triggerUpdates(node) {
    // Update node preview if available
    if (window.editor?.previewIntegration) {
      window.editor.previewIntegration.generateNodePreview(node);
      window.editor.draw();
    }

    // Trigger shader rebuild
    if (this.onChange) {
      console.log("Triggering shader rebuild...");
      this.onChange();
    }
  }
}