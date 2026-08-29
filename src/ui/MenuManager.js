// src/ui/MenuManager.js
import { NodeDefs, updateNodeIdCounter } from "../data/NodeDefs.js";
import { AddNodePalette } from "./AddNodePalette.js";
import { nodeDisplayName, hasCustomNodeName } from "../core/nodeName.js";
import { cloneNode, cloneConnections } from "../core/cloneGraph.js";
import { getReviewPanel } from "./ReviewPanel.js";

export class MenuManager {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;
    this.menuEl = null;
    this.menuPos = { x: 0, y: 0 };
    this.palette = null;
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
    this.palette?.hide();
  }

  contains(element) {
    return (
      (this.menuEl && this.menuEl.contains(element)) ||
      !!this.palette?.contains(element)
    );
  }

  /**
   * Whether the add-node palette is on screen. A wire being dragged must not be
   * dropped while it is open — the wire is waiting for the node you are about
   * to pick.
   */
  isAddMenuOpen() {
    return !!this.palette?.isVisible;
  }

  /**
   * Open the add-node palette at the cursor.
   *
   * Both entry points land here — the right-click on empty canvas, and the
   * "Create Node…"/quick-search command. There used to be two different menus
   * for those (a radial wheel and a search list); one search-first palette
   * covers both, and the node lands at `canvasX/canvasY` either way.
   */
  showCreateMenu(canvasX, canvasY, clientX, clientY) {
    this.menuPos = { x: canvasX, y: canvasY };
    if (!this.palette) {
      this.palette = new AddNodePalette(this.graph, this.onChange);
    }
    this.palette.show(canvasX, canvasY, clientX, clientY);
  }

  /**
   * Kept as the name the canvas right-click and the dropped-wire handler call.
   * The radial menu it used to open is gone; this is the palette.
   */
  showRadialMenu(canvasX, canvasY, clientX, clientY) {
    this.showCreateMenu(canvasX, canvasY, clientX, clientY);
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
    const header = this._createMenuHeader(nodeDisplayName(node));
    header.setAttribute("data-category", nodeType);
    el.appendChild(header);

    // Edit Parameters — open the parameter panel for the clicked node (same target as
    // double-clicking the node body).
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

    // Rename — same inline title-bar field as double-clicking the title, or F2. Acts on the
    // clicked node only, even inside a multi-selection: one field, one name.
    if (editor?.beginNodeRename) {
      el.appendChild(
        this._createMenuItem(
          "Rename…",
          () => {
            this.hide();
            editor.beginNodeRename(node.id);
          },
          nodeType,
        ),
      );
    }

    // Reset Name — back to the node kind's own label. Offered only on a node that actually carries
    // a custom name, so it never appears as a dead entry (same rule as Reset Parameters below).
    if (editor?.renameNode && hasCustomNodeName(node)) {
      el.appendChild(
        this._createMenuItem(
          "Reset Name",
          () => {
            editor.renameNode(node.id, "");
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

    // Add Comment — the canvas-side way into the review layer
    // (src/ui/ReviewPanel.js). Opens the dock with the compose form already
    // aimed at this node, so leaving a note never means picking the node back
    // out of a dropdown. Acts on the clicked node only, like Rename: a comment
    // is about one node.
    el.appendChild(
      this._createMenuItem(
        "Add Comment…",
        () => {
          this.hide();
          getReviewPanel().composeFor(node.id);
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

    // Reset Parameters — put every parameter back to the value a freshly created node of this kind
    // would have. Acts on the whole selection (like Duplicate above), and is offered only when
    // something would actually change, so it never appears as a dead entry on an untouched node.
    if (editor?.resetNodeParameters && editor.hasNonDefaultParameters) {
      const ids = this.graph.selection;
      const resettable = [];
      for (const id of ids || []) {
        const n = this.graph.nodes.find((x) => x.id === id);
        if (n && editor.hasNonDefaultParameters(n)) resettable.push(n);
      }

      if (resettable.length) {
        const suffix = resettable.length > 1 ? ` (${resettable.length})` : "";
        el.appendChild(
          this._createMenuItem(
            "Reset Parameters to Default" + suffix,
            () => {
              editor.resetNodeParameters();
              this.hide();
            },
            nodeType,
          ),
        );
      }
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

      // Clone nodes using the shared clone (same one SelectionManager's Cmd/Ctrl+D uses, so the two
      // duplicate paths can't drift over what a copy carries).
      for (const n of this.graph.nodes) {
        if (!idSet.has(n.id)) continue;

        const clone = cloneNode(n, 20, 20);

        clones.push(clone);
        mapOldToNew.set(n.id, clone.id);
      }

      // Add clones to graph
      this.graph.nodes.push(...clones);

      // Clone connections between selected nodes. cloneConnections also mirrors each wire into the
      // clones' `inputs`, without which the copies compile as disconnected.
      const newConns = cloneConnections(this.graph.connections, mapOldToNew, clones);

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
