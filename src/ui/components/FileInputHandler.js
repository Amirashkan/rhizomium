// src/ui/components/FileInputHandler.js - Updated for expression system integration

import { ACCENT, SEMANTIC, SURFACE, TEXT } from '../../core/theme.js';
import { isVideoSource } from '../../core/TextureManager.js';

const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;
const AUDIO_MIME_BY_EXTENSION = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
};

/** An audio file, by its type or - when the OS reports none - by its extension. */
export function isAudioFile(file) {
  if (!file) return false;
  if (typeof file.type === "string" && file.type.startsWith("audio/")) return true;
  return AUDIO_EXTENSION.test(file.name || "");
}

export class FileInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
  }

  create(param, node, div, label, valueManager, onChange) {
    this._showCurrentFile(node, div, param);
    
    const fileInput = this._createFileInput(param);
    const dropZone = this._createDropZone(param);

    this._setupEventHandlers(fileInput, dropZone, node, param, valueManager, onChange);
    
    div.appendChild(dropZone);
    div.appendChild(fileInput);
    
    return div;
  }

  _showCurrentFile(node, div, param = null) {
    // An audio file lives on the node itself (see the Audio Sampler), not in the texture manager.
    const audioName = this._acceptsAudio(param) ? node.params?.[param.name] : null;
    const textureInfo = audioName ? null : window.textureManager?.getTexture(node.id);
    const name = audioName || textureInfo?.file?.name;
    if (name) {
      const fileLabel = document.createElement("div");
      fileLabel.className = "current-file";
      fileLabel.style.cssText = `
        font-size: 10px;
        color: ${TEXT.tertiary};
        margin-bottom: 4px;
      `;
      fileLabel.textContent = `✓ ${name}`;
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

  /** Is this an audio parameter (the Audio Sampler's file) rather than a texture? */
  _acceptsAudio(param) {
    return (param?.accept || "").includes("audio");
  }

  /** Does this parameter take video as well as stills? Drives both wording and what a drop accepts. */
  _acceptsVideo(param) {
    return (param?.accept || "image/*").includes("video");
  }

  _createDropZone(param = null) {
    const dropZone = document.createElement("div");
    dropZone.className = "file-drop-zone";
    dropZone.style.cssText = `
      border: 1px dashed ${SURFACE.lineStrong};
      border-radius: 10px;
      padding: 16px;
      text-align: center;
      color: ${TEXT.tertiary};
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

    // Kept on the element so every "reset the drop zone" path below restores the same wording
    // rather than repeating (and drifting from) it.
    dropZone._idleContent = `
      <div>
        <div style="margin-bottom: 4px;">📁 Drop ${this._acceptsAudio(param) ? "audio file" : this._acceptsVideo(param) ? "image or video" : "image"} here</div>
        <div style="font-size: 9px; opacity: 0.7;">or click to browse</div>
      </div>
    `;
    dropZone.innerHTML = dropZone._idleContent;

    return dropZone;
  }

  _resetDropZone(dropZone) {
    dropZone.style.borderColor = SURFACE.lineStrong;
    dropZone.innerHTML = dropZone._idleContent ?? `
      <div>
        <div style="margin-bottom: 4px;">📁 Drop image here</div>
        <div style="font-size: 9px; opacity: 0.7;">or click to browse</div>
      </div>
    `;
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
        if (this._acceptsAudio(param)) {
          if (isAudioFile(file)) {
            this._handleFileLoad(node, file, dropZone, param, valueManager, onChange);
          } else {
            this._showErrorState(dropZone, "Please drop an audio file");
          }
          return;
        }
        const acceptsVideo = this._acceptsVideo(param);
        if (file.type.startsWith("image/") || (acceptsVideo && isVideoSource(file))) {
          this._handleFileLoad(node, file, dropZone, param, valueManager, onChange);
        } else {
          this._showErrorState(dropZone, acceptsVideo ? "Please drop an image or video file" : "Please drop an image file");
        }
      }
    });
  }

  _showDragHover(dropZone) {
    dropZone.style.borderColor = ACCENT.base;
    dropZone.style.backgroundColor = "rgba(198, 242, 78, 0.1)";
    dropZone.style.transform = "scale(1.02)";
  }

  _hideDragHover(dropZone) {
    dropZone.style.borderColor = SURFACE.lineStrong;
    dropZone.style.backgroundColor = "rgba(255,255,255,0.02)";
    dropZone.style.transform = "scale(1)";
  }

  async _handleFileLoad(node, file, dropZone, param, valueManager, onChange) {
    if (this._acceptsAudio(param)) {
      return this._handleAudioLoad(node, file, dropZone, param, valueManager, onChange);
    }
    try {
      if (!window.textureManager) {
        throw new Error("TextureManager not available. Make sure it's initialized.");
      }

      this._showLoadingState(dropZone);

      // Record the old file for undo if available
      const oldTextureInfo = window.textureManager?.getTexture(node.id);
      const oldFileName = oldTextureInfo?.file?.name || null;

      // Load the texture (a video gets a playing element; a still gets a one-shot upload)
      const textureInfo = await window.textureManager.uploadTexture(node.id, file, node);

      // The playback parameters only apply to a video, and this is what tells the panel which
      // kind of file the node is holding. It rides along in node.params, so a saved patch
      // reopens with the same controls live.
      if (!node.params) node.params = {};
      node.params.sourceType = textureInfo?.isVideo ? 'video' : 'image';

      // Mirror the new texture to the second-monitor window if a native-compute
      // mirror is open (no-op otherwise).
      window.secondMonitorViewer?.onTextureChanged?.(node.id);

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

      if (window.errorHandler?.handleError) {
        window.errorHandler.handleError(error, { 
          component: 'texture-load', 
          nodeId: node.id 
        });
      }
      this._showErrorState(dropZone, error.message);
    }
  }

  /**
   * Load an audio file onto the node. The clip is inlined into `audioData` as a data: URL so it is
   * saved with the patch and travels into every VJ scene captured from it; AudioSamplerProcessor
   * sees the new source on the next frame and starts it.
   */
  async _handleAudioLoad(node, file, dropZone, param, valueManager, onChange) {
    try {
      this._showLoadingState(dropZone);
      const dataUrl = await readAudioAsDataUrl(file);

      if (!node.params) node.params = {};
      const oldFileName = node.params[param.name] || null;
      node.params.audioData = dataUrl;

      if (this.undoManager && oldFileName !== file.name) {
        this.undoManager.recordParameterChange(node.id, param.name, oldFileName, file.name);
      }
      if (valueManager && valueManager.setValue) {
        valueManager.setValue(node, param.name, file.name);
      } else {
        node.params[param.name] = file.name;
      }

      this._showSuccessState(dropZone, file);
      if (onChange) onChange(`Audio loaded for ${node.kind}`);
    } catch (error) {
      window.errorHandler?.handleError?.(error, { component: 'audio-load', nodeId: node.id });
      this._showErrorState(dropZone, error.message);
    }
  }

  _showLoadingState(dropZone) {
    if (dropZone) {
      dropZone.style.borderColor = SEMANTIC.warn;
      dropZone.innerHTML = "<div>Loading...</div>";
    }
  }

  _showSuccessState(dropZone, file) {
    if (dropZone) {
      dropZone.style.borderColor = ACCENT.base;
      // A filename is arbitrary text the user did not type here, so it goes in
      // as text rather than markup.
      const label = document.createElement("div");
      label.style.color = ACCENT.base;
      label.textContent = `✓ ${file.name}`;
      dropZone.replaceChildren(label);

      // Reset after a moment
      setTimeout(() => this._resetDropZone(dropZone), 2000);
    }
  }

  _showErrorState(dropZone, _errorMessage) {
    if (dropZone) {
      dropZone.style.borderColor = SEMANTIC.error;
      dropZone.innerHTML = `<div style="color: ${SEMANTIC.error};">Load failed</div>`;

      setTimeout(() => this._resetDropZone(dropZone), 3000);
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
        if (window.editor.markDirty) window.editor.markDirty('file-input-change');
        window.editor.draw();
      }

      // Call the onChange callback
      if (onChange) {
        onChange(`File loaded for ${node.kind}`);
      }
    } catch {

    }
  }
}
/**
 * Read an audio file as a data: URL. A file the OS reported no type for comes back as
 * `data:application/octet-stream`, which the sampler refuses to play, so it is re-labelled from its
 * extension.
 */
function readAudioAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read the audio file'));
    reader.onload = () => {
      let dataUrl = String(reader.result || '');
      if (!/^data:(audio|video)\//i.test(dataUrl)) {
        const ext = (file.name || '').split('.').pop().toLowerCase();
        const mime = AUDIO_MIME_BY_EXTENSION[ext];
        const comma = dataUrl.indexOf(',');
        if (!mime || comma < 0) {
          reject(new Error('Not a recognised audio file'));
          return;
        }
        dataUrl = `data:${mime};base64${dataUrl.slice(comma)}`;
      }
      resolve(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}
