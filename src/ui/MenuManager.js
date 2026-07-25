// src/ui/MenuManager.js
import { NodeDefs, makeNode, updateNodeIdCounter } from "../data/NodeDefs.js";
import { RadialMenu } from "./RadialMenu.js";

export class MenuManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.menuEl = null;
    this.menuFilter = "";
    this.menuPos = { x: 0, y: 0 };
    this.radialMenu = null;
    this.undoManager = null; // Set by Editor
  }

  // Setter for undoManager (called from Editor)
  setUndoManager(undoManager) {
    this.undoManager = undoManager;
  }

  hide() {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    if (this.radialMenu) {
      this.radialMenu.hide();
    }
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

    // Convert to array format expected by RadialMenu.
    // primaryOrder matches the category-icon set's wheel order (Transform first).
    const primaryOrder = [
      "Transform",
      "Input",
      "Output",
      "Math",
      "Vector",
      "Generators",
      "Modifiers",
      "Effects",
      "Simulation",
      "Utility",
      "Blend",
      "Texture",
    ];
    const orderedCategories = [
      ...primaryOrder,
      ...Array.from(categories.keys()).filter((c) => !primaryOrder.includes(c)),
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

    // Ensure node is selected. If the right-clicked node isn't part of the current selection,
    // select just it; a right-click inside an existing multi-selection leaves that selection intact
    // so bulk actions (Duplicate / previews / Delete) operate on the whole group.
    if (!this.graph.selection.has(node.id)) {
      this.graph.selection = new Set([node.id]);
    }

    const editor = window.editor;
    const nodeType = NodeDefs[node.kind]?.cat || "Misc";
    const nodeLabel = NodeDefs[node.kind]?.label || node.kind;
    const header = this._createMenuHeader(nodeLabel);
    header.setAttribute("data-category", nodeType);
    el.appendChild(header);

    // Edit Parameters — open the parameter panel for the clicked node (same target as double-click).
    const paramPanel = editor?.paramPanel;
    if (paramPanel && (paramPanel.showNodeParameters || paramPanel.show)) {
      el.appendChild(
        this._createMenuItem(
          "Edit Parameters…",
          () => {
            if (paramPanel.showNodeParameters) {
              paramPanel.showNodeParameters(node);
            } else {
              paramPanel.show(node, clientX, clientY);
            }
            this.hide();
          },
          nodeType,
        ),
      );
    }

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

    // Bypass — pass the clicked node's first input straight through, skipping its processing.
    // OutputFinal is the graph sink and can't be bypassed (editor.toggleNodeBypass guards it too).
    if (editor?.toggleNodeBypass && node.kind !== "OutputFinal") {
      el.appendChild(
        this._createMenuItem(
          node.bypassed ? "Enable (Un-bypass)" : "Bypass",
          () => {
            editor.toggleNodeBypass(node.id);
            this.hide();
          },
          nodeType,
        ),
      );
    }

    // Bulk thumbnail visibility for the whole selection (the node under the cursor is already part
    // of it — see the selection guard above). Label reflects the dominant current state: if any
    // selected node's preview is visible, offer to hide them all; otherwise offer to show them.
    if (editor?.setSelectedNodesPreview) {
      const ids = this.graph.selection;
      const count = ids?.size || 0;
      let anyVisible = false;
      if (ids) {
        for (const id of ids) {
          const n = this.graph.nodes.find((x) => x.id === id);
          if (n && editor.isNodePreviewEnabled(n)) { anyVisible = true; break; }
        }
      }
      const suffix = count > 1 ? ` (${count})` : "";
      el.appendChild(
        this._createMenuItem(
          (anyVisible ? "Hide Previews" : "Show Previews") + suffix,
          () => {
            editor.setSelectedNodesPreview(!anyVisible);
            this.hide();
          },
          nodeType,
        ),
      );
    }

    // Separate the destructive action so it isn't fired by accident right after a benign one.
    el.appendChild(this._createMenuSeparator());

    el.appendChild(
      this._createMenuItem(
        "Delete",
        () => {
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
    // Guarantee the menu stacks above #ui-canvas (z-index 10), the toolbar and the floating GPU
    // preview even if menu.css fails to load — without this the fixed menu paints behind the
    // canvas and is invisible, which reads as "right-click does nothing".
    el.style.zIndex = "10000";

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

  _createMenuSeparator() {
    const sep = document.createElement("div");
    sep.className = "ctx-separator";
    return sep;
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
      "Output",
      "Math",
      "Vector",
      "Generators",
      "Modifiers",
      "Effects",
      "Simulation",
      "Utility",
      "Blend",
      "Texture",
      ...Array.from(categories.keys()).filter(
        (c) => !["Input", "Output", "Math", "Vector", "Generators", "Modifiers", "Effects", "Simulation", "Utility", "Blend", "Texture"].includes(c),
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
            this._createNode(item.kind);
            this.hide();
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

  _activateFocusedItem(_el) {
    const focused = document.activeElement;
    if (focused && focused.classList.contains("ctx-item")) {
      focused.click();
    }
  }

  _createNode(kind) {
    const node = makeNode(kind, this.menuPos.x, this.menuPos.y);
    this.graph.nodes.push(node);
    this.graph.selection = new Set([node.id]);

    if (this.onChange) this.onChange();

    // Trigger the new node's preview. Unlike RadialMenu._createNode and Editor.createNode, this
    // "quick add" search menu otherwise does no per-node preview work, so the freshly added node
    // renders as a placeholder until some unrelated event (a parameter edit, or wiring it into the
    // chain that reaches the output) happens to recompute it. onNodeAdded debounces a full preview
    // refresh through the GPU funnel, so the node shows its own output right away — even while it is
    // still disconnected from the output.
    window.editor?.previewIntegration?.onNodeAdded?.(node);
  }

  _duplicateSelected() {
    try {
      // Warm up GPU/canvas before duplication to prevent lag
      if (window.eventHandler && typeof window.eventHandler._checkAndWarmupAfterInactivity === 'function') {
        window.eventHandler._checkAndWarmupAfterInactivity();
      }
      
      const ids = Array.from(this.graph.selection || []);
      if (!ids.length) return;

      const idSet = new Set(ids);
      const mapOldToNew = new Map();
      const clones = [];

      // Clone nodes using proper cloning
      for (const n of this.graph.nodes) {
        if (!idSet.has(n.id)) continue;

        // Use makeNode for proper initialization
        const clone = makeNode(
          n.kind,
          (n.x || 0) + 20,
          (n.y || 0) + 20
        );

        // Deep copy params to avoid shared references
        if (n.params) {
          clone.params = JSON.parse(JSON.stringify(n.params));
        }

        // Copy special properties
        if (n.value !== undefined) {
          clone.value = n.value;
        }
        if (n.expr !== undefined) {
          clone.expr = n.expr;
        }
        if (n.props) {
          clone.props = JSON.parse(JSON.stringify(n.props));
        }

        clones.push(clone);
        mapOldToNew.set(n.id, clone.id);
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

      // Record undo for all created nodes and connections as a single operation
      if (this.undoManager && this.undoManager.recordGroupCreation) {
        this.undoManager.recordGroupCreation(clones, newConns);
      }

      // Synchronize ID counter
      updateNodeIdCounter(this.graph.nodes);

      // Mark interaction start for immediate updates after duplication
      if (window.eventHandler) {
        window.eventHandler._interactionStartTime = Date.now();
        window.eventHandler._justWarmedUp = true;
        // Keep immediate updates active for 1 second after duplication
        setTimeout(() => {
          if (window.eventHandler) {
            window.eventHandler._justWarmedUp = false;
          }
        }, 1000);
      }

      if (this.onChange) this.onChange();

      // Same reason as _createNode: duplication adds nodes without otherwise triggering preview
      // generation, so the clones would render as placeholders until later recomputed. onNodeAdded
      // debounces a single full-graph preview refresh, which covers every clone at once.
      if (clones.length) {
        window.editor?.previewIntegration?.onNodeAdded?.(clones[0]);
      }
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'menu-node-duplication',
        selectedCount: this.graph.selection?.size || 0
      });
    }
  }
// Replace the _deleteSelected method in MenuManager.js with this:

_deleteSelected() {
  const ids = new Set(this.graph.selection);
  if (ids.size === 0) return;

  // Get nodes to delete before removing them
  const nodesToDelete = this.graph.nodes.filter((n) => ids.has(n.id));

  // USE GROUP DELETION for multiple nodes, single deletion for one node
  if (nodesToDelete.length > 1 && window.onGroupDeleted && typeof window.onGroupDeleted === 'function') {

    window.onGroupDeleted(nodesToDelete);
  } else if (nodesToDelete.length === 1 && window.onNodeDeleted && typeof window.onNodeDeleted === 'function') {

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

  // onChange only rebuilds the shader; it doesn't repaint the node canvas. Without this the
  // deleted node lingers on screen until the next interaction happens to mark the canvas dirty
  // (the "needs one more click to disappear" symptom). Mirror the keyboard-delete path, which
  // requests a redraw right after removing the nodes.
  window.editor?.markDirty?.('menu-node-delete');
}
}
