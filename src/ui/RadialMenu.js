// src/ui/RadialMenu.js
import { makeNode, NodeDefs } from "../data/NodeDefs.js";
import { pickAutoConnectInputPin } from "../core/autoConnect.js";
import { ensureIconSprite } from "./iconSprite.js";

// Category glyphs for the radial "Add Node" menu come from the shared app sprite
// (src/assets/icons-sprite.svg, injected by ensureIconSprite). Monoline, 24x24,
// 1.6px stroke, single-color (currentColor) so each segment tints its own icon.
// Referenced by <use href="#icon-<category>"> in _renderCategories.

// Every category has a glyph, so the id is derived directly:
// `icon-${name.toLowerCase()}`. Categories come from each NodeDef's `cat` field
// (see getNodeCategories() in src/data/NodeDefs.js) — NOT from the unused
// NodeCategories enum in src/data/nodes/NodeTypes.js. A category listed here
// without a matching <symbol> in the sprite falls back to a text label.
const CATEGORY_ICON_IDS = new Set([
  "transform", "input", "output", "texture", "blend", "math",
  "utility", "vector", "simulation", "generators", "effects", "modifiers",
]);

export class RadialMenu {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.element = null;
    this.centerX = 0;
    this.centerY = 0;
    this.radius = 112;
    this.innerRadius = 52;
    this.expandedRadius = 210;
    this.isVisible = false;
    this.expandedCategory = null;
    this.scrollOffsets = new Map();
    this.maxVisibleNodes = 6;
    this.gapAngle = Math.PI / 8;
    this.searchTerm = "";
    this.showingSearch = false;
    this.selectedCategoryIndex = -1;
    this.selectedNodeIndex = -1;
    this._isCreatingNode = false; // Flag to track if we're creating a node
  }

  show(canvasX, canvasY, clientX, clientY, categories) {
    this._closeExistingMenus();

    this.centerX = clientX;
    this.centerY = clientY;
    this.canvasPos = { x: canvasX, y: canvasY };
    this.categories = categories;
    this.searchTerm = "";
    this.showingSearch = false;
    this.selectedCategoryIndex = -1;
    this.selectedNodeIndex = -1;

    // Category glyphs are <use> references into the document-level sprite.
    ensureIconSprite();

    this.element = this._createRadialElement();
    document.body.appendChild(this.element);
    this.isVisible = true;

    this.element.addEventListener("wheel", (e) => this._handleWheel(e), {
      passive: false,
    });

    this._boundKeyHandler = this._handleKeyDown.bind(this);
    this._boundClickHandler = this._handleDocumentClick.bind(this);

    document.removeEventListener("keydown", this._boundKeyHandler, {
      capture: true,
    });
    document.removeEventListener("click", this._boundClickHandler);
    document.removeEventListener("contextmenu", this._boundClickHandler);

    document.addEventListener("keydown", this._boundKeyHandler, {
      capture: true,
    });
    document.addEventListener("click", this._boundClickHandler);
    document.addEventListener("contextmenu", this._boundClickHandler);
  }

  _closeExistingMenus() {
    const existingMenus = document.querySelectorAll(".radial-menu");
    existingMenus.forEach((menu) => menu.remove());
  }

  hide() {
    const wasVisible = this.isVisible;
    const isCreatingNode = this._isCreatingNode;
    
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    this.isVisible = false;
    this.expandedCategory = null;
    this.searchTerm = "";
    this.showingSearch = false;
    this.selectedCategoryIndex = -1;
    this.selectedNodeIndex = -1;

    if (this._boundKeyHandler) {
      document.removeEventListener("keydown", this._boundKeyHandler, {
        capture: true,
      });
    }
    if (this._boundClickHandler) {
      document.removeEventListener("click", this._boundClickHandler);
      document.removeEventListener("contextmenu", this._boundClickHandler);
    }
    
    // If menu was visible and is being closed without creating a node,
    // and there's an active wire drag, cancel it
    if (wasVisible && !isCreatingNode && window.eventHandler && window.eventHandler.connections) {
      const dragWire = window.eventHandler.connections.getDragWire();
      if (dragWire) {
        // Cancel the wire drag by ending it without a target
        window.eventHandler.connections.endWireDrag(dragWire.pos, null);
        if (window.eventHandler._requestDraw) {
          window.eventHandler._requestDraw('wire-drag-cancel');
        }
      }
    }
    
    // Reset the flag
    this._isCreatingNode = false;
  }

  _handleDocumentClick(e) {
    // Don't close menu if there's an active wire drag (user might be selecting a node to connect)
    const hasActiveWireDrag = window.eventHandler?.connections?.getDragWire();
    if (e.button === 0 && (!this.element || !this.element.contains(e.target)) && !hasActiveWireDrag) {
      this.hide();
    }
  }

  _handleKeyDown(e) {
    if (!this.isVisible) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      if (this.showingSearch) {
        this.showingSearch = false;
        this.searchTerm = "";
        this.selectedNodeIndex = -1;
        this._renderMenu();
      } else if (this.expandedCategory) {
        this.expandedCategory = null;
        this.selectedNodeIndex = -1;
        this._renderMenu();
      } else {
        this.hide();
      }
      return;
    }

    if (e.key === "Backspace" && this.searchTerm.length > 0) {
      this.searchTerm = this.searchTerm.slice(0, -1);
      if (this.searchTerm.length === 0) {
        this.showingSearch = false;
      }
      this._renderMenu();
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (this.showingSearch) {
        const allNodes = this._getSearchResults();
        const visibleResults = allNodes.slice(0, 8);

        if (this.selectedNodeIndex === -1) {
          this.selectedNodeIndex = 0;
        } else {
          this.selectedNodeIndex =
            e.key === "ArrowRight"
              ? (this.selectedNodeIndex + 1) % visibleResults.length
              : (this.selectedNodeIndex - 1 + visibleResults.length) %
                visibleResults.length;
        }
        this._renderMenu();
      } else if (this.expandedCategory) {
        if (e.key === "ArrowLeft") {
          this.expandedCategory = null;
          this.selectedNodeIndex = -1;
          this._renderMenu();
        }
      } else {
        if (this.selectedCategoryIndex === -1) {
          this.selectedCategoryIndex = 0;
        } else {
          this.selectedCategoryIndex =
            e.key === "ArrowRight"
              ? (this.selectedCategoryIndex + 1) % this.categories.length
              : (this.selectedCategoryIndex - 1 + this.categories.length) %
                this.categories.length;
        }
        this._renderMenu();
      }
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (this.showingSearch) {
        const allNodes = this._getSearchResults();
        const visibleResults = allNodes.slice(0, 8);

        if (this.selectedNodeIndex === -1) {
          this.selectedNodeIndex = 0;
        } else {
          this.selectedNodeIndex =
            e.key === "ArrowDown"
              ? (this.selectedNodeIndex + 1) % visibleResults.length
              : (this.selectedNodeIndex - 1 + visibleResults.length) %
                visibleResults.length;
        }
        this._renderMenu();
      } else if (this.expandedCategory) {
        const category = this.categories.find(
          (c) => c.name === this.expandedCategory,
        );
        if (!category) return;

        const scrollOffset = this.scrollOffsets.get(category.name) || 0;
        const visibleNodes = this._getVisibleNodes(
          category.items,
          scrollOffset,
        );

        if (this.selectedNodeIndex === -1) {
          this.selectedNodeIndex = 0;
        } else {
          this.selectedNodeIndex =
            e.key === "ArrowDown"
              ? (this.selectedNodeIndex + 1) % visibleNodes.length
              : (this.selectedNodeIndex - 1 + visibleNodes.length) %
                visibleNodes.length;
        }
        this._renderMenu();
      }
      return;
    }

    if (e.key === "Enter") {
      if (this.showingSearch && this.selectedNodeIndex !== -1) {
        const allNodes = this._getSearchResults();
        const visibleResults = allNodes.slice(0, 8);
        const selectedNode = visibleResults[this.selectedNodeIndex];
        if (selectedNode) {
          this._createNode(selectedNode.kind);
        }
      } else if (this.expandedCategory && this.selectedNodeIndex !== -1) {
        const category = this.categories.find(
          (c) => c.name === this.expandedCategory,
        );
        if (category) {
          const scrollOffset = this.scrollOffsets.get(category.name) || 0;
          const visibleNodes = this._getVisibleNodes(
            category.items,
            scrollOffset,
          );
          const selectedNode = visibleNodes[this.selectedNodeIndex];
          if (selectedNode) {
            this._createNode(selectedNode.kind);
          }
        }
      } else if (this.selectedCategoryIndex !== -1) {
        const selectedCategory = this.categories[this.selectedCategoryIndex];
        if (selectedCategory) {
          this.expandedCategory = selectedCategory.name;
          this.selectedNodeIndex = -1;
          if (!this.scrollOffsets.has(selectedCategory.name)) {
            this.scrollOffsets.set(selectedCategory.name, 0);
          }
          this._renderMenu();
        }
      }
      return;
    }

    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
      this.searchTerm += e.key.toLowerCase();
      this.showingSearch = true;
      this.selectedNodeIndex = -1;
      this._renderMenu();
    }
  }

  _getSearchResults() {
    const allNodes = [];
    this.categories.forEach((category) => {
      category.items.forEach((item) => {
        if (item.label.toLowerCase().includes(this.searchTerm)) {
          allNodes.push({ ...item, category: category.name });
        }
      });
    });
    return allNodes;
  }

  _createRadialElement() {
    const container = document.createElement("div");
    container.className = "radial-menu";
    container.style.cssText = `
      position: fixed;
      left: ${this.centerX}px;
      top: ${this.centerY}px;
      width: ${this.expandedRadius * 2.5}px;
      height: ${this.expandedRadius * 2.5}px;
      margin-left: -${this.expandedRadius * 1.25}px;
      margin-top: -${this.expandedRadius * 1.25}px;
      pointer-events: none;
      z-index: 1000;
    `;

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("width", this.expandedRadius * 2.5);
    this.svg.setAttribute("height", this.expandedRadius * 2.5);
    this.svg.style.pointerEvents = "auto";

    this._createDefs();
    this._renderMenu();
    container.appendChild(this.svg);
    return container;
  }

  _createDefs() {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

    const centerGradient = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "radialGradient",
    );
    centerGradient.setAttribute("id", "centerGrad");
    centerGradient.setAttribute("cx", "30%");
    centerGradient.setAttribute("cy", "30%");

    const stop1 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "stop",
    );
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", "#2a2a2a");

    const stop2 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "stop",
    );
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", "#0a0a0a");

    centerGradient.appendChild(stop1);
    centerGradient.appendChild(stop2);
    defs.appendChild(centerGradient);

    const buttonGrad = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "linearGradient",
    );
    buttonGrad.setAttribute("id", "buttonGrad");
    buttonGrad.setAttribute("x1", "0%");
    buttonGrad.setAttribute("y1", "0%");
    buttonGrad.setAttribute("x2", "0%");
    buttonGrad.setAttribute("y2", "100%");

    const bStops = [
      { offset: "0%", color: "#2d2d2d" },
      { offset: "15%", color: "#252525" },
      { offset: "85%", color: "#1a1a1a" },
      { offset: "100%", color: "#0f0f0f" },
    ];

    bStops.forEach((stop) => {
      const stopEl = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop",
      );
      stopEl.setAttribute("offset", stop.offset);
      stopEl.setAttribute("stop-color", stop.color);
      buttonGrad.appendChild(stopEl);
    });
    defs.appendChild(buttonGrad);

    const pressedGrad = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "linearGradient",
    );
    pressedGrad.setAttribute("id", "pressedGrad");
    pressedGrad.setAttribute("x1", "0%");
    pressedGrad.setAttribute("y1", "0%");
    pressedGrad.setAttribute("x2", "0%");
    pressedGrad.setAttribute("y2", "100%");

    const pStops = [
      { offset: "0%", color: "#0f0f0f" },
      { offset: "15%", color: "#1a1a1a" },
      { offset: "85%", color: "#252525" },
      { offset: "100%", color: "#2d2d2d" },
    ];

    pStops.forEach((stop) => {
      const stopEl = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop",
      );
      stopEl.setAttribute("offset", stop.offset);
      stopEl.setAttribute("stop-color", stop.color);
      pressedGrad.appendChild(stopEl);
    });
    defs.appendChild(pressedGrad);

    this.svg.appendChild(defs);
  }

  _renderMenu() {
    const defs = this.svg.querySelector("defs");
    this.svg.innerHTML = "";
    if (defs) this.svg.appendChild(defs);

    const centerX = this.expandedRadius * 1.25;
    const centerY = this.expandedRadius * 1.25;

    const centerCircle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    centerCircle.setAttribute("cx", centerX);
    centerCircle.setAttribute("cy", centerY);
    centerCircle.setAttribute("r", this.innerRadius - 6);
    centerCircle.setAttribute("fill", "url(#centerGrad)");
    centerCircle.setAttribute("stroke", "rgba(255,255,255,0.1)");
    centerCircle.setAttribute("stroke-width", "2");
    this.svg.appendChild(centerCircle);

    if (!this.showingSearch) {
      this._renderCenterReadout(centerX, centerY);
    }

    if (!this.showingSearch && !this.expandedCategory) {
      this._renderHelpBox(centerX, centerY);
    }

    if (this.showingSearch) {
      this._renderSearchResults(centerX, centerY);
      this._renderSearchIndicator(centerX, centerY);
    } else {
      this._renderCategories(centerX, centerY);
      if (this.expandedCategory) {
        this._renderNodes(centerX, centerY);
      }
    }
  }

  _renderCenterReadout(centerX, centerY) {
    // The hub shows the active category's name. It reflects the expanded
    // category, else the keyboard-selected one, else a neutral prompt — and
    // updates live as the pointer hovers segments (see _renderCategories).
    let defaultName = "ADD NODE";
    if (this.expandedCategory) {
      defaultName = this.expandedCategory;
    } else if (
      this.selectedCategoryIndex >= 0 &&
      this.categories[this.selectedCategoryIndex]
    ) {
      defaultName = this.categories[this.selectedCategoryIndex].name;
    }
    this._centerDefaultName = defaultName;

    const name = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    name.setAttribute("x", centerX);
    name.setAttribute("y", centerY - 2);
    name.setAttribute("text-anchor", "middle");
    name.setAttribute("dominant-baseline", "central");
    name.setAttribute("fill", "#ffffff");
    name.setAttribute("font-size", "15");
    name.setAttribute("font-weight", "700");
    name.setAttribute("font-family", "Inter, -apple-system, sans-serif");
    name.style.pointerEvents = "none";
    name.textContent = defaultName;
    this.svg.appendChild(name);
    this._centerLabelEl = name;

    const caption = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    caption.setAttribute("x", centerX);
    caption.setAttribute("y", centerY + 14);
    caption.setAttribute("text-anchor", "middle");
    caption.setAttribute("dominant-baseline", "central");
    caption.setAttribute("fill", "#7d838f");
    caption.setAttribute("font-size", "8");
    caption.setAttribute("font-weight", "500");
    caption.setAttribute("letter-spacing", "0.16em");
    caption.setAttribute("font-family", "Inter, -apple-system, sans-serif");
    caption.style.pointerEvents = "none";
    caption.textContent = this.expandedCategory ? "SELECT NODE" : "CATEGORY";
    this.svg.appendChild(caption);
    this._centerCaptionEl = caption;
  }

  // Update the hub readout to a hovered category name (transient — the next
  // _renderMenu restores the default from selection/expansion state).
  _setCenterReadout(name) {
    if (this._centerLabelEl) {
      this._centerLabelEl.textContent = name ?? this._centerDefaultName;
    }
  }

  _renderHelpBox(centerX, centerY) {
    const boxY = centerY - this.radius - 42;

    const helpBg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    helpBg.setAttribute("x", centerX - 180);
    helpBg.setAttribute("y", boxY - 25);
    helpBg.setAttribute("width", "360");
    helpBg.setAttribute("height", "50");
    helpBg.setAttribute("rx", "8");
    helpBg.setAttribute("fill", "rgba(20,20,20,0.5)");
    helpBg.setAttribute("stroke", "rgba(80,80,80,0.3)");
    helpBg.setAttribute("stroke-width", "1");
    this.svg.appendChild(helpBg);

    const helpText = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    helpText.setAttribute("x", centerX);
    helpText.setAttribute("y", boxY);
    helpText.setAttribute("text-anchor", "middle");
    helpText.setAttribute("dominant-baseline", "middle");
    helpText.setAttribute("fill", "#999999");
    helpText.setAttribute("font-size", "11");
    helpText.setAttribute("font-weight", "400");
    helpText.setAttribute("font-family", "Inter, -apple-system, sans-serif");
    helpText.style.pointerEvents = "none";
    helpText.textContent =
      "Type to search • Arrows to navigate • Enter to select • ESC/← to go back";
    this.svg.appendChild(helpText);
  }

  _renderSearchIndicator(centerX, centerY) {
    const searchBg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    searchBg.setAttribute("x", centerX - 80);
    searchBg.setAttribute("y", centerY - this.expandedRadius - 50);
    searchBg.setAttribute("width", "160");
    searchBg.setAttribute("height", "30");
    searchBg.setAttribute("rx", "15");
    searchBg.setAttribute("fill", "#1a1a1a");
    searchBg.setAttribute("stroke", "rgba(255,255,255,0.4)");
    searchBg.setAttribute("stroke-width", "2");
    this.svg.appendChild(searchBg);

    const searchText = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    searchText.setAttribute("x", centerX);
    searchText.setAttribute("y", centerY - this.expandedRadius - 35);
    searchText.setAttribute("text-anchor", "middle");
    searchText.setAttribute("dominant-baseline", "middle");
    searchText.setAttribute("fill", "#ffffff");
    searchText.setAttribute("font-size", "14");
    searchText.setAttribute("font-weight", "600");
    searchText.setAttribute("font-family", "Inter, -apple-system, sans-serif");
    searchText.textContent = `Search: ${this.searchTerm}`;
    this.svg.appendChild(searchText);
  }

  _renderSearchResults(centerX, centerY) {
    const allNodes = this._getSearchResults();

    if (allNodes.length === 0) {
      const noResults = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      noResults.setAttribute("x", centerX);
      noResults.setAttribute("y", centerY + 50);
      noResults.setAttribute("text-anchor", "middle");
      noResults.setAttribute("fill", "#888");
      noResults.setAttribute("font-size", "16");
      noResults.setAttribute("font-family", "Inter, -apple-system, sans-serif");
      noResults.textContent = "No results found";
      this.svg.appendChild(noResults);
      return;
    }

    const visibleResults = allNodes.slice(0, 8);
    const angleStep = (2 * Math.PI) / visibleResults.length;

    visibleResults.forEach((nodeItem, index) => {
      const angle = index * angleStep - Math.PI / 2;
      const isSelected = this.selectedNodeIndex === index;

      const segmentStartAngle = angle - angleStep / 3;
      const segmentEndAngle = angle + angleStep / 3;

      const segment = this._createSegmentPath(
        centerX,
        centerY,
        this.radius + 20,
        this.expandedRadius - 30,
        segmentStartAngle,
        segmentEndAngle,
      );

      const categoryColor = this._getSubmenuBgColor(nodeItem.category);
      segment.setAttribute(
        "fill",
        isSelected
          ? this._getSubmenuHoverColor(nodeItem.category)
          : categoryColor,
      );
      segment.setAttribute(
        "stroke",
        isSelected ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
      );
      segment.setAttribute("stroke-width", isSelected ? "3" : "2");
      segment.style.cursor = "pointer";

      segment.addEventListener("click", (e) => {
        e.stopPropagation();
        this._createNode(nodeItem.kind);
      });

      this.svg.appendChild(segment);

      const labelRadius = (this.radius + 20 + this.expandedRadius - 30) / 2;
      const labelX = centerX + Math.cos(angle) * labelRadius;
      const labelY = centerY + Math.sin(angle) * labelRadius;

      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("x", labelX);
      label.setAttribute("y", labelY);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", "#ffffff");
      label.setAttribute("font-size", "14");
      label.setAttribute("font-weight", isSelected ? "700" : "600");
      label.setAttribute("font-family", "Inter, -apple-system, sans-serif");
      label.style.pointerEvents = "none";
      label.textContent = nodeItem.label;
      this.svg.appendChild(label);

      if (nodeItem.kind?.startsWith('Compute')) {
        const badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
        badge.setAttribute("x", labelX);
        badge.setAttribute("y", labelY + 13);
        badge.setAttribute("text-anchor", "middle");
        badge.setAttribute("dominant-baseline", "central");
        badge.setAttribute("fill", "#7eb8f7");
        badge.setAttribute("font-size", "9");
        badge.setAttribute("font-weight", "600");
        badge.setAttribute("font-family", "Inter, -apple-system, sans-serif");
        badge.style.pointerEvents = "none";
        badge.textContent = "GPU";
        this.svg.appendChild(badge);
      }
    });
  }

  _renderCategories(centerX, centerY) {
    const availableAngle = 2 * Math.PI - this.gapAngle;
    const angleStep = availableAngle / this.categories.length;
    const startOffset = this.gapAngle / 2;

    this.categories.forEach((category, index) => {
      const startAngle = startOffset + index * angleStep - Math.PI / 2;
      const endAngle = startOffset + (index + 1) * angleStep - Math.PI / 2;
      const isExpanded = this.expandedCategory === category.name;
      const isSelected = this.selectedCategoryIndex === index;

      category._angle = startAngle + angleStep / 2;

      const outerRing = this._createSegmentPath(
        centerX,
        centerY,
        this.radius - 3,
        this.radius + 3,
        startAngle,
        endAngle,
      );
      outerRing.setAttribute("fill", this._getCategoryColor(category.name));
      outerRing.style.pointerEvents = "none";
      this.svg.appendChild(outerRing);

      const segment = this._createSegmentPath(
        centerX,
        centerY,
        this.innerRadius,
        this.radius - 3,
        startAngle,
        endAngle,
      );
      segment.setAttribute(
        "fill",
        isExpanded ? "url(#pressedGrad)" : "url(#buttonGrad)",
      );
      segment.setAttribute(
        "stroke",
        isSelected ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.4)",
      );
      segment.setAttribute("stroke-width", isSelected ? "3" : "2");
      segment.style.cursor = "pointer";

      segment.addEventListener("click", (e) => {
        e.stopPropagation();
        this.expandedCategory =
          this.expandedCategory === category.name ? null : category.name;
        this.selectedNodeIndex = -1;
        if (this.expandedCategory && !this.scrollOffsets.has(category.name)) {
          this.scrollOffsets.set(category.name, 0);
        }
        this._renderMenu();
      });

      // Surface the category name in the hub readout while hovering.
      segment.addEventListener("mouseenter", () =>
        this._setCenterReadout(category.name),
      );
      segment.addEventListener("mouseleave", () => this._setCenterReadout(null));

      this.svg.appendChild(segment);

      const labelAngle = startAngle + angleStep / 2;
      const glyphRadius = (this.innerRadius + this.radius - 3) / 2;
      const glyphX = centerX + Math.cos(labelAngle) * glyphRadius;
      const glyphY = centerY + Math.sin(labelAngle) * glyphRadius;
      const hasIcon = CATEGORY_ICON_IDS.has(category.name.toLowerCase());

      if (hasIcon) {
        // Icon-forward: a centered glyph is the segment's affordance; the name
        // lives in the hub readout. currentColor tints it — white, brightened
        // when the segment is selected/expanded.
        const iconSize = 26;
        const icon = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "use",
        );
        const iconHref = `#icon-${category.name.toLowerCase()}`;
        icon.setAttribute("href", iconHref);
        icon.setAttributeNS("http://www.w3.org/1999/xlink", "href", iconHref);
        icon.setAttribute("x", glyphX - iconSize / 2);
        icon.setAttribute("y", glyphY - iconSize / 2);
        icon.setAttribute("width", iconSize);
        icon.setAttribute("height", iconSize);
        icon.style.color = isExpanded || isSelected ? "#ffffff" : "#e6e6e6";
        icon.style.pointerEvents = "none";
        this.svg.appendChild(icon);
      } else {
        // No glyph for this category (e.g. Compute) — fall back to a label.
        const label = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        label.setAttribute("x", glyphX);
        label.setAttribute("y", glyphY);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        label.setAttribute(
          "fill",
          isExpanded || isSelected ? "#ffffff" : "#c0c0c0",
        );
        label.setAttribute("font-size", "11");
        label.setAttribute("font-weight", "600");
        label.setAttribute("font-family", "Inter, -apple-system, sans-serif");
        label.style.pointerEvents = "none";
        label.textContent = category.name;
        this.svg.appendChild(label);
      }
    });
  }

  _renderNodes(centerX, centerY) {
    const category = this.categories.find(
      (c) => c.name === this.expandedCategory,
    );
    if (!category) return;

    const scrollOffset = this.scrollOffsets.get(category.name) || 0;
    const visibleNodes = this._getVisibleNodes(category.items, scrollOffset);

    const categoryAngle = category._angle;
    const nodeAngleSpread = Math.PI / 1.1;
    const startAngle = categoryAngle - nodeAngleSpread / 2;
    const angleStep = nodeAngleSpread / Math.max(1, this.maxVisibleNodes - 1);

    visibleNodes.forEach((nodeItem, index) => {
      const nodeAngle = startAngle + index * angleStep;
      const isSelected = this.selectedNodeIndex === index;

      const segmentStartAngle = nodeAngle - angleStep / 1.6;
      const segmentEndAngle = nodeAngle + angleStep / 1.6;

      const segment = this._createSegmentPath(
        centerX,
        centerY,
        this.radius + 15,
        this.expandedRadius,
        segmentStartAngle,
        segmentEndAngle,
      );

      segment.setAttribute(
        "fill",
        isSelected
          ? this._getSubmenuHoverColor(category.name)
          : this._getSubmenuBgColor(category.name),
      );
      segment.setAttribute(
        "stroke",
        isSelected ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.5)",
      );
      segment.setAttribute("stroke-width", isSelected ? "3" : "2");
      segment.style.cursor = "pointer";

      segment.addEventListener("click", (e) => {
        e.stopPropagation();
        this._createNode(nodeItem.kind);
      });

      this.svg.appendChild(segment);

      const labelRadius = (this.radius + 15 + this.expandedRadius) / 2;
      const labelX = centerX + Math.cos(nodeAngle) * labelRadius;
      const labelY = centerY + Math.sin(nodeAngle) * labelRadius;

      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("x", labelX);
      label.setAttribute("y", labelY);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", isSelected ? "#ffffff" : "#dddddd");
      label.setAttribute("font-size", "14");
      label.setAttribute("font-weight", isSelected ? "700" : "500");
      label.setAttribute("font-family", "Inter, -apple-system, sans-serif");
      label.style.pointerEvents = "none";
      label.textContent = nodeItem.label;
      this.svg.appendChild(label);

      if (nodeItem.kind?.startsWith('Compute')) {
        const badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
        badge.setAttribute("x", labelX);
        badge.setAttribute("y", labelY + 13);
        badge.setAttribute("text-anchor", "middle");
        badge.setAttribute("dominant-baseline", "central");
        badge.setAttribute("fill", "#7eb8f7");
        badge.setAttribute("font-size", "9");
        badge.setAttribute("font-weight", "600");
        badge.setAttribute("font-family", "Inter, -apple-system, sans-serif");
        badge.style.pointerEvents = "none";
        badge.textContent = "GPU";
        this.svg.appendChild(badge);
      }
    });

    if (category.items.length > this.maxVisibleNodes) {
      this._addScrollIndicators(centerX, centerY, category);
    }
  }

  _createSegmentPath(
    centerX,
    centerY,
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
  ) {
    const x1 = centerX + Math.cos(startAngle) * innerRadius;
    const y1 = centerY + Math.sin(startAngle) * innerRadius;
    const x2 = centerX + Math.cos(endAngle) * innerRadius;
    const y2 = centerY + Math.sin(endAngle) * innerRadius;
    const x3 = centerX + Math.cos(endAngle) * outerRadius;
    const y3 = centerY + Math.sin(endAngle) * outerRadius;
    const x4 = centerX + Math.cos(startAngle) * outerRadius;
    const y4 = centerY + Math.sin(startAngle) * outerRadius;

    const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

    const pathData = [
      `M ${x1} ${y1}`,
      `L ${x4} ${y4}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x3} ${y3}`,
      `L ${x2} ${y2}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1}`,
      "Z",
    ].join(" ");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    return path;
  }

  _getVisibleNodes(nodes, scrollOffset) {
    if (nodes.length <= this.maxVisibleNodes) return nodes;
    return nodes.slice(scrollOffset, scrollOffset + this.maxVisibleNodes);
  }

  _addScrollIndicators(centerX, centerY, category) {
    const scrollOffset = this.scrollOffsets.get(category.name) || 0;
    const canScrollUp = scrollOffset > 0;
    const canScrollDown =
      scrollOffset < category.items.length - this.maxVisibleNodes;

    const categoryAngle = category._angle;

    if (canScrollUp) {
      const upX =
        centerX +
        Math.cos(categoryAngle - Math.PI / 3) * (this.expandedRadius + 30);
      const upY =
        centerY +
        Math.sin(categoryAngle - Math.PI / 3) * (this.expandedRadius + 30);
      const upArrow = this._createScrollArrow(upX, upY, "↑");
      this.svg.appendChild(upArrow);
    }

    if (canScrollDown) {
      const downX =
        centerX +
        Math.cos(categoryAngle + Math.PI / 3) * (this.expandedRadius + 30);
      const downY =
        centerY +
        Math.sin(categoryAngle + Math.PI / 3) * (this.expandedRadius + 30);
      const downArrow = this._createScrollArrow(downX, downY, "↓");
      this.svg.appendChild(downArrow);
    }
  }

  _createScrollArrow(x, y, text) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bg.setAttribute("cx", x);
    bg.setAttribute("cy", y);
    bg.setAttribute("r", "12");
    bg.setAttribute("fill", "#1a1a1a");
    bg.setAttribute("stroke", "rgba(255,255,255,0.2)");
    bg.setAttribute("stroke-width", "2");

    const arrow = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    arrow.setAttribute("x", x);
    arrow.setAttribute("y", y + 2);
    arrow.setAttribute("text-anchor", "middle");
    arrow.setAttribute("dominant-baseline", "middle");
    arrow.setAttribute("fill", "#c0c0c0");
    arrow.setAttribute("font-size", "14");
    arrow.setAttribute("font-weight", "600");
    arrow.setAttribute("font-family", "Inter, -apple-system, sans-serif");
    arrow.style.pointerEvents = "none";
    arrow.textContent = text;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.appendChild(bg);
    group.appendChild(arrow);

    return group;
  }

  _handleWheel(e) {
    if (!this.expandedCategory) return;

    const category = this.categories.find(
      (c) => c.name === this.expandedCategory,
    );
    if (!category || category.items.length <= this.maxVisibleNodes) return;

    e.preventDefault();

    const scrollOffset = this.scrollOffsets.get(category.name) || 0;
    const delta = e.deltaY > 0 ? 1 : -1;
    const newOffset = Math.max(
      0,
      Math.min(
        category.items.length - this.maxVisibleNodes,
        scrollOffset + delta,
      ),
    );

    this.scrollOffsets.set(category.name, newOffset);
    this._renderMenu();
  }

  _getCategoryColor(categoryName) {
    return (
      {
        Transform: "#0f766e",
        Input: "#1e40af",
        Output: "#92400e",
        Math: "#991b1b",
        Vector: "#7c2d12",
        Generators: "#047857",
        Modifiers: "#c2410c",
        Effects: "#9333ea",
        Simulation: "#0891b2",
        Utility: "#581c87",
        Blend: "#be185d",
        Texture: "#4338ca",
      }[categoryName] || "#374151"
    );
  }

  _getSubmenuBgColor(categoryName) {
    return (
      {
        Transform: "#134e4a",
        Input: "#1e3a8a",
        Output: "#78350f",
        Math: "#7f1d1d",
        Vector: "#431407",
        Generators: "#064e3b",
        Modifiers: "#9a3412",
        Effects: "#6b21a8",
        Simulation: "#0e7490",
        Utility: "#4c1d95",
        Blend: "#9f1239",
        Texture: "#3730a3",
      }[categoryName] || "#2d3748"
    );
  }

  _getSubmenuHoverColor(categoryName) {
    return (
      {
        Transform: "#0d9488",
        Input: "#2563eb",
        Output: "#a16207",
        Math: "#b91c1c",
        Vector: "#9a3412",
        Generators: "#065f46",
        Modifiers: "#ea580c",
        Effects: "#a855f7",
        Simulation: "#06b6d4",
        Utility: "#6d28d9",
        Blend: "#db2777",
        Texture: "#4f46e5",
      }[categoryName] || "#374151"
    );
  }

_createNode(kind) {
  // Set flag to prevent wire drag cancellation when hiding menu
  this._isCreatingNode = true;
  
  // Warm up GPU/canvas before node creation to prevent lag
  if (window.eventHandler && typeof window.eventHandler._checkAndWarmupAfterInactivity === 'function') {
    window.eventHandler._checkAndWarmupAfterInactivity();
  }
  
  const node = makeNode(kind, this.canvasPos.x, this.canvasPos.y);
  this.graph.nodes.push(node);
  this.graph.selection = new Set([node.id]);

  // Record node creation for undo system
  if (window.onNodeCreated && typeof window.onNodeCreated === 'function') {
    window.onNodeCreated(node);
  }

  // Check if there's an active wire drag and connect the new node
  let shouldConnectToWire = false;
  let connectionInfo = null;
  if (window.eventHandler && window.eventHandler.connections) {
    const dragWire = window.eventHandler.connections.getDragWire();
    if (dragWire) {
      shouldConnectToWire = true;
      connectionInfo = dragWire;
    }
  }

  // CRITICAL ORDER OF OPERATIONS (do not reorder these steps):

  // 1. Hide the radial menu FIRST so it doesn't overlay the canvas
  this.hide();

  // 2. Connect to wire if one was being dragged
  if (shouldConnectToWire && connectionInfo && window.eventHandler && window.eventHandler.connections) {
    try {
      const connections = window.eventHandler.connections;
      const nodeDef = NodeDefs[kind];
      
      // Determine which pin to connect based on drag direction
      if (connectionInfo.isFromInput) {
        // Dragging from input: connect first output (pin 0) of new node to the input
        // Check if node has outputs
        const outputCount = (nodeDef?.pinsOut || []).length || (nodeDef ? 1 : 0);
        if (outputCount > 0) {
          const outputPin = 0; // First output pin
          const hitPin = {
            nodeId: node.id,
            pin: outputPin
          };
          // Use the current wire position for connection
          connections.endWireDrag(connectionInfo.pos, hitPin);
        }
      } else {
        // Dragging from output: land the wire on the input pin that suits the source. Pin 0 for
        // almost every node, but a texture source (Texture 2D / Compute) dropped on a Transform
        // belongs on its Texture pin, not on the UV pin that sits at index 0.
        const sourceNode = this.graph.nodes.find(
          (n) => n.id === connectionInfo.from?.nodeId,
        );
        const inputPin = pickAutoConnectInputPin(sourceNode?.kind, kind);
        if (inputPin >= 0) {
          const hitPin = {
            nodeId: node.id,
            pin: inputPin
          };
          // Use the current wire position for connection
          connections.endWireDrag(connectionInfo.pos, hitPin);
        }
      }
    } catch (error) {
      console.warn('[RadialMenu] Failed to connect node to wire:', error);
      // Continue with node creation even if connection fails
    }
  }

  // 3. Immediately redraw the UI canvas so the new node appears visually
  //    IMPORTANT: editor.draw() renders the 2D UI canvas (node boxes, wires, etc.)
  //    This is SEPARATE from GPU shader compilation which happens later in onChange
  //    Without this call, the node exists in the graph but is invisible until next redraw
  if (window.editor && typeof window.editor.draw === 'function') {
    if (typeof window.editor.markDirty === 'function') {
      window.editor.markDirty('node-creation');
    }
    window.editor.draw(); // Makes node visible immediately
  }
  
  // Mark interaction start for immediate updates after node creation
  if (window.eventHandler) {
    window.eventHandler._interactionStartTime = Date.now();
    window.eventHandler._justWarmedUp = true;
    // Keep immediate updates active for 1 second after node creation
    setTimeout(() => {
      if (window.eventHandler) {
        window.eventHandler._justWarmedUp = false;
      }
    }, 1000);
  }

  // 4. Delay GPU shader compilation (onChange calls updateShaderFromGraph)
  //    The 50ms delay allows GPU bind groups to settle and prevents mismatch errors
  //    NOTE: updateShaderFromGraph() updates the GPU shader but does NOT redraw the canvas
  //    That's why we need the explicit editor.draw() call above
  setTimeout(() => {
    if (this.onChange) this.onChange();
    // This path bypasses Editor.createNode, so trigger preview generation explicitly — without
    // this the new node (and any others left stale by the structural change) stay placeholders
    // until a parameter change.
    window.editor?.previewIntegration?.onNodeAdded?.(node);
  }, 50);
}
}