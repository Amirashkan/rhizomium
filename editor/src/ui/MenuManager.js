// src/ui/MenuManager.js
import { NodeDefs, makeNode } from "../data/NodeDefs.js";
import { RadialMenu } from "./RadialMenu.js";

let _nextId = 1000;

export class MenuManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.menuEl = null;
    this.menuFilter = "";
    this.menuPos = { x: 0, y: 0 };
    this.radialMenu = null;
  }

  hide() {
    console.log('[MenuManager] hide() called');
    if (this.menuEl) {
      console.log('[MenuManager] Removing menu element');
      // Blur any focused input before removing
      const focused = this.menuEl.querySelector(':focus');
      if (focused) {
        focused.blur();
      }
      this.menuEl.remove();
      this.menuEl = null;
    }
    if (this.radialMenu) {
      console.log('[MenuManager] Hiding radial menu');
      this.radialMenu.hide();
    }
    // Return focus to document body
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      document.activeElement.blur();
    }
    console.log('[MenuManager] hide() complete');
  }

  contains(element) {
    return (
      (this.menuEl && this.menuEl.contains(element)) ||
      (this.radialMenu &&
        this.radialMenu.element &&
        this.radialMenu.element.contains(element))
    );
  }

  showCreateMenu(canvasX, canvasY, clientX, clientY) {
    console.log('[MenuManager] showCreateMenu called at canvas:', canvasX, canvasY);
    this.menuPos = { x: canvasX, y: canvasY };
    const el = this._createMenuRoot(clientX, clientY);
    el.innerHTML = "";

    // Search input
    const input = document.createElement("input");
    input.className = "ctx-search";
    input.placeholder = "Search nodes…";
    input.value = this.menuFilter;
    input.addEventListener("input", () => {
      this.menuFilter = input.value;
      this._renderCreateList(el);
    });

    el.appendChild(input);
    this._renderCreateList(el);

    // Handle keyboard navigation
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this._focusNextItem(el);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this._focusPrevItem(el);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this._activateFocusedItem(el);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });

    input.focus();
  }

  showRadialMenu(canvasX, canvasY, clientX, clientY) {
    // Group categories
    const categories = this._groupNodesByCategory();

    if (!this.radialMenu) {
      this.radialMenu = new RadialMenu(this.graph, this.onChange);
    }

    this.radialMenu.show(canvasX, canvasY, clientX, clientY, categories);
  }

  _groupNodesByCategory() {
    const categories = new Map();
    for (const [kind, def] of Object.entries(NodeDefs)) {
      const cat = def.cat || "Misc";
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat).push({ kind, label: def.label || kind });
    }

    // Convert to array format expected by RadialMenu
    const orderedCategories = [
      "Input",
      "Math",
      "Field",
      "Utility",
      "Output",
      ...Array.from(categories.keys()).filter(
        (c) => !["Input", "Math", "Field", "Utility", "Output"].includes(c),
      ),
    ];

    return orderedCategories
      .map((categoryName) => ({
        name: categoryName,
        items: categories.get(categoryName) || [],
      }))
      .filter((cat) => cat.items.length > 0);
  }

  showNodeMenu(node, clientX, clientY) {
    const el = this._createMenuRoot(clientX, clientY);
    el.innerHTML = "";

    // Ensure node is selected
    if (!this.graph.selection.has(node.id)) {
      this.graph.selection = new Set([node.id]);
    }

    const nodeType = NodeDefs[node.kind]?.cat || "Misc";
    const header = this._createMenuHeader("Node Actions");
    header.setAttribute("data-category", nodeType);
    el.appendChild(header);

    el.appendChild(
      this._createMenuItem(
        "Duplicate",
        () => {
          this._duplicateSelected();
          this.hide();
        },
        nodeType,
      ),
    );

    el.appendChild(
      this._createMenuItem(
        "Delete",
        () => {
          this.graph.selection = new Set([node.id]);
          this._deleteSelected();
          this.hide();
        },
        nodeType,
      ),
    );
  }

  _createMenuRoot(clientX, clientY) {
    this.hide();
    const el = document.createElement("div");
    el.className = "ctx-menu";

    // Add to body to measure dimensions
    document.body.appendChild(el);

    // Position off-screen initially to measure
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    el.style.visibility = "hidden";

    // Force layout
    el.offsetHeight;

    // Calculate position with boundary checking
    const menuWidth = 240;
    const menuHeight = 400;

    let x = clientX;
    let y = clientY;

    // Check boundaries
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }

    // Ensure minimum margins
    x = Math.max(10, x);
    y = Math.max(10, y);

    // Apply final position
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.visibility = "visible";

    this.menuEl = el;
    return el;
  }

  _createMenuHeader(text, category = null) {
    const h = document.createElement("div");
    h.className = "ctx-header";
    h.textContent = text;
    if (category) {
      h.setAttribute("data-category", category);
    }
    return h;
  }

  _createMenuItem(text, onClick, category = null) {
    const item = document.createElement("div");
    item.className = "ctx-item";
    item.textContent = text;
    item.tabIndex = 0; // Make focusable for keyboard navigation
    if (category) {
      item.setAttribute("data-category", category);
    }

    const handleClick = () => {
      if (onClick) onClick();
    };

    item.addEventListener("click", handleClick);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    });

    return item;
  }

  _renderCreateList(el) {
    // Remove existing items (keep search input)
    const items = el.querySelectorAll(".ctx-header, .ctx-item");
    items.forEach((item) => item.remove());

    // Group nodes by category
    const categories = new Map();
    for (const [kind, def] of Object.entries(NodeDefs)) {
      const cat = def.cat || "Misc";
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat).push({ kind, label: def.label || kind });
    }

    // Sort items within each category
    for (const items of categories.values()) {
      items.sort((a, b) => a.label.localeCompare(b.label));
    }

    // Filter items based on search
    const filter = (this.menuFilter || "").trim().toLowerCase();
    const matches = (item) => {
      if (!filter) return true;
      return (
        item.label.toLowerCase().includes(filter) ||
        item.kind.toLowerCase().includes(filter)
      );
    };

    // Render categories in preferred order
    const orderedCategories = [
      "Input",
      "Math",
      "Field",
      "Utility",
      "Output",
      ...Array.from(categories.keys()).filter(
        (c) => !["Input", "Math", "Field", "Utility", "Output"].includes(c),
      ),
    ];

    for (const categoryName of orderedCategories) {
      const items = categories.get(categoryName);
      if (!items) continue;

      const visibleItems = items.filter(matches);
      if (visibleItems.length === 0) continue;

      // Add category header with color coding
      const header = this._createMenuHeader(categoryName, categoryName);
      el.appendChild(header);

      // Add category items with color coding
      for (const item of visibleItems) {
        const menuItem = this._createMenuItem(
          item.label,
          () => {
            console.log('[MenuManager] Menu item clicked:', item.label, item.kind);
            // Hide menu first, then create node after next paint
            this.hide();
            console.log('[MenuManager] Menu hidden, scheduling node creation');
            requestAnimationFrame(() => {
              console.log('[MenuManager] RAF callback executing');
              this._createNode(item.kind);
            });
          },
          categoryName,
        );
        el.appendChild(menuItem);
      }
    }

    // If no results, show a message
    if (filter && el.querySelectorAll(".ctx-item").length === 0) {
      const noResults = document.createElement("div");
      noResults.className = "ctx-item";
      noResults.textContent = "No nodes found";
      noResults.style.color = "#666";
      noResults.style.fontStyle = "italic";
      el.appendChild(noResults);
    }
  }

  _focusNextItem(el) {
    const items = Array.from(el.querySelectorAll('.ctx-item[tabindex="0"]'));
    const current = document.activeElement;
    const currentIndex = items.indexOf(current);

    if (currentIndex < items.length - 1) {
      items[currentIndex + 1].focus();
    } else if (items.length > 0) {
      items[0].focus(); // Wrap to first
    }
  }

  _focusPrevItem(el) {
    const items = Array.from(el.querySelectorAll('.ctx-item[tabindex="0"]'));
    const current = document.activeElement;
    const currentIndex = items.indexOf(current);

    if (currentIndex > 0) {
      items[currentIndex - 1].focus();
    } else if (items.length > 0) {
      items[items.length - 1].focus(); // Wrap to last
    }
  }

  _activateFocusedItem(el) {
    const focused = document.activeElement;
    if (focused && focused.classList.contains("ctx-item")) {
      focused.click();
    }
  }

  _createNode(kind) {
    console.log('[MenuManager] Creating node:', kind);
    const node = makeNode(kind, this.menuPos.x, this.menuPos.y);
    this.graph.nodes.push(node);
    this.graph.selection = new Set([node.id]);
    console.log('[MenuManager] Node created, ID:', node.id, 'Total nodes:', this.graph.nodes.length);

    // Record node creation for undo
    if (window.onNodeCreated && typeof window.onNodeCreated === 'function') {
      window.onNodeCreated(node);
    }

    // CRITICAL: Force immediate redraw using requestAnimationFrame
    // This ensures the node appears before the onChange callback
    requestAnimationFrame(() => {
      if (window.editor) {
        if (typeof window.editor.markDirty === 'function') {
          window.editor.markDirty('node-creation');
          console.log('[MenuManager] Marked editor dirty');
        }
        if (typeof window.editor.draw === 'function') {
          window.editor.draw();
          console.log('[MenuManager] Called editor.draw()');
        }
      }
    });

    // Delay onChange to allow GPU state to settle and prevent bind group mismatch
    setTimeout(() => {
      console.log('[MenuManager] Triggering onChange after delay');
      if (this.onChange) this.onChange();
    }, 50);
  }

  _duplicateSelected() {
    const ids = Array.from(this.graph.selection || []);
    if (!ids.length) return;

    const idSet = new Set(ids);
    const mapOldToNew = new Map();
    const clones = [];

    // Clone nodes
    for (const n of this.graph.nodes) {
      if (!idSet.has(n.id)) continue;

      const c = JSON.parse(JSON.stringify(n));
      c.id = String(++_nextId);
      c.x = (n.x || 0) + 20;
      c.y = (n.y || 0) + 20;
      clones.push(c);
      mapOldToNew.set(n.id, c.id);
    }

    // Add clones to graph
    this.graph.nodes.push(...clones);

    // Clone connections between selected nodes
    const newConns = [];
    for (const c of this.graph.connections) {
      const fromNew = mapOldToNew.get(c.from.nodeId);
      const toNew = mapOldToNew.get(c.to.nodeId);
      if (fromNew && toNew) {
        newConns.push({
          from: { nodeId: fromNew, pin: c.from.pin },
          to: { nodeId: toNew, pin: c.to.pin },
        });
      }
    }

    this.graph.connections.push(...newConns);
    this.graph.selection = new Set(clones.map((n) => n.id));

    if (this.onChange) this.onChange();
  }
// Replace the _deleteSelected method in MenuManager.js with this:

_deleteSelected() {
  const ids = new Set(this.graph.selection);
  if (ids.size === 0) return;

  // Get nodes to delete before removing them
  const nodesToDelete = this.graph.nodes.filter((n) => ids.has(n.id));

  console.log('MenuManager._deleteSelected called with', nodesToDelete.length, 'nodes');

  // USE GROUP DELETION for multiple nodes, single deletion for one node
  if (nodesToDelete.length > 1 && window.onGroupDeleted && typeof window.onGroupDeleted === 'function') {
    console.log("MenuManager: Using group deletion for", nodesToDelete.length, "nodes");
    window.onGroupDeleted(nodesToDelete);
  } else if (nodesToDelete.length === 1 && window.onNodeDeleted && typeof window.onNodeDeleted === 'function') {
    console.log("MenuManager: Using single node deletion for", nodesToDelete[0].kind, nodesToDelete[0].id);
    window.onNodeDeleted(nodesToDelete[0]);
  }

  // Remove connections involving selected nodes
  this.graph.connections = this.graph.connections.filter(
    (c) => !(ids.has(c.from.nodeId) || ids.has(c.to.nodeId)),
  );

  // Remove nodes
  this.graph.nodes = this.graph.nodes.filter((n) => !ids.has(n.id));
  this.graph.selection.clear();

  if (this.onChange) this.onChange();
}
}
