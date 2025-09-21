// src/ui/ParameterPanel.js
import { NodeDefs } from "../data/NodeDefs.js";

export class ParameterPanel {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.panel = null;
    this.currentNode = null;
  }

  hide() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.currentNode = null;
    }
  }

  contains(element) {
    return this.panel && this.panel.contains(element);
  }

  show(node, clientX, clientY) {
    console.log(
      "ParameterPanel.show called for:",
      node.kind,
      "at",
      clientX,
      clientY,
    );

    this.hide();
    const def = NodeDefs[node.kind];
    console.log("NodeDef found:", def);

    if (!def?.params || def.params.length === 0) {
      console.log("No parameters for this node type");
      return;
    }

    console.log("Creating panel with", def.params.length, "parameters");

    const panel = document.createElement("div");
    panel.className = "param-panel";
    panel.style.position = "fixed";
    panel.style.left = clientX + 20 + "px";
    panel.style.top = clientY + "px";
    panel.style.zIndex = "1000";

    // Prevent clicks inside the panel from bubbling up
    panel.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Prevent mousedown events from bubbling up
    panel.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    // Header
    const header = document.createElement("div");
    header.className = "param-header";
    header.textContent = `${def.label} Parameters`;
    panel.appendChild(header);

    // Parameters
    for (const param of def.params) {
      const paramDiv = this._createParameterInput(param, node);
      panel.appendChild(paramDiv);
    }

    // Close button
    const buttons = document.createElement("div");
    buttons.className = "param-buttons";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });

    buttons.appendChild(closeBtn);
    panel.appendChild(buttons);

    document.body.appendChild(panel);
    this.panel = panel;
    this.currentNode = node;

    // Focus the first input after a short delay
    setTimeout(() => {
      const firstInput = panel.querySelector(".param-input");
      if (firstInput) {
        firstInput.focus();
      }
    }, 10);
  }

  _createParameterInput(param, node) {
    const div = document.createElement("div");
    div.className = "param-input-group";

    const label = document.createElement("label");
    label.textContent = param.label;
    div.appendChild(label);

    // Handle different parameter types
    switch (param.type) {
      case "file":
        return this._createFileInput(param, node, div, label);
      case "select":
        return this._createSelectInput(param, node, div, label);
      default:
        return this._createTextInput(param, node, div, label);
    }
  }

  _createFileInput(param, node, div, label) {
    // Show current file name if texture is loaded
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

    // Create hidden file input
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = param.accept || "image/*";
    fileInput.style.display = "none";

    // Create enhanced drag and drop zone
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

    // Click to open file dialog
    dropZone.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    // Enhanced drag and drop events
    dropZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = "#4a90e2";
      dropZone.style.backgroundColor = "rgba(74, 144, 226, 0.1)";
      dropZone.style.transform = "scale(1.02)";
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = "#4a90e2";
      dropZone.style.backgroundColor = "rgba(74, 144, 226, 0.1)";
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only reset if we're actually leaving the drop zone
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.style.borderColor = "#666";
        dropZone.style.backgroundColor = "rgba(255,255,255,0.02)";
        dropZone.style.transform = "scale(1)";
      }
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Reset visual state
      dropZone.style.borderColor = "#666";
      dropZone.style.backgroundColor = "rgba(255,255,255,0.02)";
      dropZone.style.transform = "scale(1)";

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

    // File input change handler
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        this._handleFileLoad(node, file, dropZone);
      }
    });

    // Prevent clicks from bubbling up
    fileInput.addEventListener("click", (e) => e.stopPropagation());

    div.appendChild(dropZone);
    div.appendChild(fileInput);

    return div;
  }

  async _handleFileLoad(node, file, dropZone) {
    try {
      console.log("Loading texture file:", file.name, "for node:", node.id);

      if (!window.textureManager) {
        throw new Error(
          "TextureManager not available. Make sure it's initialized.",
        );
      }

      // Show loading state
      if (dropZone) {
        dropZone.style.borderColor = "#f0ad4e";
        dropZone.innerHTML = "<div>Loading...</div>";
      }

      // Load the texture
      await window.textureManager.loadTexture(node.id, file, node);
      console.log("✅ Texture loaded successfully");

      // Update drop zone to show success
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

      // Update parameter panel to show new file
      if (this.panel && this.currentNode === node) {
        const fileLabels = this.panel.querySelectorAll(".current-file");
        fileLabels.forEach((label) => {
          label.textContent = `✓ ${file.name}`;
          label.style.color = "#5cb85c";
        });
      }

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
    } catch (error) {
      console.error("Failed to load texture:", error);

      // Show error state
      if (dropZone) {
        dropZone.style.borderColor = "#d9534f";
        dropZone.innerHTML =
          '<div style="color: #d9534f;">❌ Load failed</div>';

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

      alert(`Failed to load texture: ${error.message}`);
    }
  }

  _createSelectInput(param, node, div, label) {
    const select = document.createElement("select");
    select.className = "param-select";
    select.style.cssText = `
      width: 100%;
      padding: 6px;
      margin: 4px 0;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 11px;
    `;

    for (const option of param.options) {
      const optionElement = document.createElement("option");
      optionElement.value = option;
      optionElement.textContent = option;
      select.appendChild(optionElement);
    }

    // Set current value
    const currentValue = this._getNodeParameterValue(
      node,
      param.name,
      param.default,
    );
    select.value = currentValue;

    select.addEventListener("change", (e) => {
      e.stopPropagation();
      this._updateNodeParameter(node, param.name, select.value);
    });

    select.addEventListener("click", (e) => e.stopPropagation());

    div.appendChild(select);
    return div;
  }

  _createTextInput(param, node, div, label) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "param-input";
    input.dataset.paramName = param.name;
    input.dataset.paramType = param.type;
    input.style.cssText = `
      width: 100%;
      padding: 6px;
      margin: 4px 0;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 11px;
      box-sizing: border-box;
    `;

    // Get current value (now includes connected input values)
    let currentValue = this._getNodeParameterValue(
      node,
      param.name,
      param.default,
    );
    input.value = String(currentValue);

    // Check if this parameter has a connected input
    const hasConnectedInput =
      this._getConnectedInputValue(node, param.name) !== undefined;
    if (hasConnectedInput) {
      input.style.backgroundColor = "#2a4a2a"; // Green tint to show it's connected
      input.title = "Connected to input - value reflects connected node";
    }

    input.placeholder =
      param.type === "expression"
        ? "Enter expression..."
        : `Default: ${param.default}`;

    // Real-time updates on input
    input.addEventListener("input", (e) => {
      e.stopPropagation();
      this._updateNodeParameter(node, param.name, input.value.trim());
    });

    input.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Numeric drag support for float parameters
    if (param.type === "float") {
      this._addNumericDragSupport(input, node, param.name);
    }

    // Store reference for real-time updates
    input._paramName = param.name;
    input._node = node;

    div.appendChild(input);
    return div;
  }

  // Get node parameter value with connected input support
  _getNodeParameterValue(node, paramName, defaultValue) {
    // First check if there's a connected input for this parameter
    const connectedValue = this._getConnectedInputValue(node, paramName);
    if (connectedValue !== undefined) {
      return connectedValue; // Show the connected input value in the panel
    }

    // Otherwise use the stored parameter value
    if (paramName === "value" && typeof node.value !== "undefined")
      return node.value;
    if (paramName === "x" && typeof node.x !== "undefined") return node.x;
    if (paramName === "y" && typeof node.y !== "undefined") return node.y;
    if (paramName === "expr" && typeof node.expr !== "undefined")
      return node.expr;
    if (node.props && typeof node.props[paramName] !== "undefined")
      return node.props[paramName];
    return defaultValue;
  }

  // Get value from connected input
  _getConnectedInputValue(node, paramName) {
    if (!this.graph?.connections) return undefined;

    // Map parameter names to input pin indices
    const paramToPinMap = {
      radius: 0,
      epsilon: 1,
      value: 0,
      x: 0,
      y: 1,
      z: 2,
    };

    const pinIndex = paramToPinMap[paramName];
    if (pinIndex === undefined) return undefined;

    // Find connection to this node's input pin
    for (const conn of this.graph.connections) {
      if (conn.to.nodeId === node.id && conn.to.pin === pinIndex) {
        const sourceNode = this.graph.nodes.find(
          (n) => n.id === conn.from.nodeId,
        );
        if (sourceNode) {
          // Get the value from the source node
          return this._getSourceNodeValue(sourceNode);
        }
      }
    }

    return undefined;
  }

  // Get value from source node
  _getSourceNodeValue(node) {
    switch (node.kind.toLowerCase()) {
      case "constfloat":
      case "float":
        return node.props?.value || node.value || 0;
      case "time":
        return (Date.now() / 1000) % 1;
      case "uv":
        return 0.5;
      default:
        return 0;
    }
  }

  // Update node parameter with connected input support
  _updateNodeParameter(node, paramName, value) {
    console.log("Parameter update:", node.kind, paramName, value);

    // Check if this parameter has a connected input
    const connectedSourceNode = this._findConnectedSourceNode(node, paramName);

    if (connectedSourceNode) {
      // Update the source Float node instead of this node
      console.log(
        "Updating connected source node:",
        connectedSourceNode.kind,
        connectedSourceNode.id,
      );

      // Update the source node's value
      if (
        connectedSourceNode.kind === "ConstFloat" ||
        connectedSourceNode.kind === "Float"
      ) {
        const numValue = isNaN(Number(value)) ? 0 : Number(value);

        // Store in both places for compatibility
        connectedSourceNode.value = numValue;
        if (!connectedSourceNode.props) connectedSourceNode.props = {};
        connectedSourceNode.props.value = numValue;

        console.log("Updated source Float node value to:", numValue);

        // Trigger updates for the source node
        if (this.onChange) this.onChange(); // Trigger shader recompilation

        if (window.editor?.previewIntegration) {
          console.log(
            "Calling onParameterChange for source node:",
            connectedSourceNode.kind,
          );
          window.editor.previewIntegration.onParameterChange(
            connectedSourceNode,
          );
        }
      }
    } else {
      // No connected input - update this node's parameter normally
      console.log("No connected input - updating node parameter directly");

      if (paramName === "value") {
        node.value = isNaN(Number(value)) ? value : Number(value);
      } else if (paramName === "x") {
        node.x = isNaN(Number(value)) ? value : Number(value);
      } else if (paramName === "y") {
        node.y = isNaN(Number(value)) ? value : Number(value);
      } else if (paramName === "expr") {
        node.expr = value;
      } else {
        // For CircleField props and others
        if (!node.props) node.props = {};
        node.props[paramName] = isNaN(Number(value)) ? value : Number(value);
      }

      // Immediate updates
      if (this.onChange) this.onChange(); // Trigger shader recompilation

      if (window.editor?.previewIntegration) {
        console.log("Calling onParameterChange for:", node.kind);
        window.editor.previewIntegration.onParameterChange(node);
      }
    }
  }

  // Find connected source node for parameter
  _findConnectedSourceNode(node, paramName) {
    if (!this.graph?.connections) return null;

    // Map parameter names to input pin indices
    const paramToPinMap = {
      radius: 0,
      epsilon: 1,
      value: 0,
      x: 0,
      y: 1,
      z: 2,
    };

    const pinIndex = paramToPinMap[paramName];
    if (pinIndex === undefined) return null;

    // Find connection to this node's input pin
    for (const conn of this.graph.connections) {
      if (conn.to.nodeId === node.id && conn.to.pin === pinIndex) {
        const sourceNode = this.graph.nodes.find(
          (n) => n.id === conn.from.nodeId,
        );
        return sourceNode || null;
      }
    }

    return null;
  }

  _addNumericDragSupport(input, node, paramName) {
    let isDragging = false;
    let startValue = 0;
    let startY = 0;

    input.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.shiftKey) {
        // Shift+click for drag mode
        isDragging = true;
        startValue = parseFloat(input.value) || 0;
        startY = e.clientY;
        input.style.cursor = "ns-resize";
        e.preventDefault();
        e.stopPropagation();

        const onMouseMove = (e) => {
          if (!isDragging) return;
          const deltaY = startY - e.clientY; // Inverted: up = positive
          const sensitivity = e.ctrlKey ? 0.001 : e.altKey ? 0.1 : 0.01;
          const newValue = startValue + deltaY * sensitivity;
          input.value = newValue.toFixed(3);
          this._updateNodeParameter(node, paramName, input.value);
          e.preventDefault();
        };

        const onMouseUp = () => {
          isDragging = false;
          input.style.cursor = "";
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }
    });

    // Add visual hint
    input.title =
      "Shift+drag to adjust value\nCtrl: fine precision, Alt: coarse precision";
  }
}
