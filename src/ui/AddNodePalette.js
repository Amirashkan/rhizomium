// src/ui/AddNodePalette.js
//
// The add-node command palette: search-first, spawns at the cursor.
//
// It replaces the radial menu. A ring of twelve wedges made you aim before you
// could think, and it could only ever show a handful of the ~140 node kinds at
// once; a search field plus a colour-coded category rail lets you either type
// what you want or browse the families, and it scales as nodes are added.
//
// The palette owns none of the graph rules. Creating a node — the undo
// transaction, the auto-connect onto a wire you were dragging, the redraw and
// the deferred shader rebuild — is the same sequence the radial menu ran, moved
// here intact. Read _placeNode/_finishNodeCreation as one unit: the ordering in
// there is load-bearing and is commented where it matters.

import { NodeDefs, makeNode } from "../data/NodeDefs.js";
import { pickAutoConnectInputPin } from "../core/autoConnect.js";
import { categoryColor, typeColor, withAlpha } from "../core/theme.js";

const PALETTE_WIDTH = 568;
const BODY_HEIGHT = 344;

// Category display order. Anything NodeDefs grows that isn't listed here still
// appears, appended in discovery order, so a new family is never hidden.
const CATEGORY_ORDER = [
  "Input",
  "Output",
  "Math",
  "Vector",
  "Generators",
  "Transform",
  "Modifiers",
  "Utility",
  "Blend",
  "Texture",
  "Simulation",
  "Effects",
];

// The default view when nothing is typed: a short cross-category set of the
// nodes a patch usually starts from. Kinds that don't exist are skipped, so
// this can't break if a node is renamed or removed.
const SUGGESTED_KINDS = [
  "OutputFinal",
  "UV",
  "Time",
  "PerlinNoise",
  "ColorMix",
  "Transform2D",
];

export class AddNodePalette {
  constructor(graph, onChange) {
    this.graph = graph;
    this.onChange = onChange;

    this.element = null;
    this.isVisible = false;
    this.canvasPos = { x: 0, y: 0 };
    this.query = "";
    this.activeCategory = null; // null = "All"
    this.highlightIndex = 0;
    this.results = [];
    this._isCreatingNode = false;
  }

  // ---- public API ---------------------------------------------------------

  show(canvasX, canvasY, clientX, clientY) {
    this.hide();

    this.canvasPos = { x: canvasX, y: canvasY };
    this.query = "";
    this.activeCategory = null;
    this.highlightIndex = 0;

    this._ensureStyles();
    this._buildIndex();
    this._render(clientX, clientY);

    this.isVisible = true;
    this.input?.focus();
  }

  hide() {
    const wasVisible = this.isVisible;
    const wasCreating = this._isCreatingNode;

    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    this.input = null;
    this.railEl = null;
    this.resultsEl = null;
    this.eyebrowEl = null;
    this.countEl = null;
    this.isVisible = false;

    if (this._onKeyDown) {
      document.removeEventListener("keydown", this._onKeyDown, true);
      this._onKeyDown = null;
    }

    // Closing without placing anything abandons a wire the user was dragging —
    // otherwise the wire stays latched to the cursor with no way to drop it.
    if (wasVisible && !wasCreating) {
      const connections = window.eventHandler?.connections;
      const dragWire = connections?.getDragWire?.();
      if (dragWire) {
        connections.endWireDrag(dragWire.pos, null);
        window.eventHandler?._requestDraw?.("wire-drag-cancel");
      }
    }

    this._isCreatingNode = false;
  }

  contains(el) {
    return !!(this.element && el && this.element.contains(el));
  }

  // ---- node index ---------------------------------------------------------

  _buildIndex() {
    const byCategory = new Map();
    const all = [];

    for (const [kind, def] of Object.entries(NodeDefs)) {
      const cat = def.cat || "Misc";
      const entry = {
        kind,
        cat,
        label: def.label || kind,
        type: this._outputType(def),
      };
      all.push(entry);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(entry);
    }

    for (const list of byCategory.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }

    this.byCategory = byCategory;
    this.allNodes = all.sort((a, b) => a.label.localeCompare(b.label));
    this.categories = [
      ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
      ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    this.total = all.length;
  }

  /** The data type a node hands downstream — what its badge shows. */
  _outputType(def) {
    const pins = def?.pinsOut || [];
    if (!pins.length) return null; // a sink, e.g. Output
    const first = pins[0];
    return (typeof first === "string" ? null : first.type) || null;
  }

  /**
   * Subsequence match: every character of the query appears in order. "cnos"
   * finds "Cell Noise" — the point is to reward typing the start of words
   * without demanding you remember the exact label.
   */
  _score(entry, q) {
    const label = entry.label.toLowerCase();
    const kind = entry.kind.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (kind.startsWith(q)) return 1;
    const at = label.indexOf(q);
    if (at >= 0) return 2 + at / 100;
    if (kind.includes(q)) return 3;

    let i = 0;
    for (const ch of label) {
      if (ch === q[i]) i++;
      if (i === q.length) return 4;
    }
    return -1;
  }

  _computeResults() {
    const q = this.query.trim().toLowerCase();

    if (q) {
      // A query searches every node; the rail selection is a browse aid, and
      // silently filtering the search by it would hide the obvious match.
      const scored = [];
      for (const entry of this.allNodes) {
        const score = this._score(entry, q);
        if (score >= 0) scored.push({ entry, score });
      }
      scored.sort((a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label));
      return scored.map((s) => s.entry);
    }

    if (this.activeCategory) return this.byCategory.get(this.activeCategory) || [];

    const suggested = SUGGESTED_KINDS.map((kind) =>
      this.allNodes.find((n) => n.kind === kind),
    ).filter(Boolean);
    return suggested.length ? suggested : this.allNodes.slice(0, 6);
  }

  // ---- rendering ----------------------------------------------------------

  _render(clientX, clientY) {
    const root = document.createElement("div");
    root.className = "rz-palette-root";

    const backdrop = document.createElement("div");
    backdrop.className = "rz-palette-backdrop";
    backdrop.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.hide();
    });
    root.appendChild(backdrop);

    // Where the palette sits: near the cursor, clamped inside the viewport.
    const left = Math.min(
      Math.max(16, clientX + 40),
      Math.max(16, window.innerWidth - PALETTE_WIDTH - 16),
    );
    const top = Math.min(
      Math.max(16, clientY - 120),
      Math.max(16, window.innerHeight - BODY_HEIGHT - 130),
    );

    root.appendChild(this._buildSpawnMarker(clientX, clientY, left, top));

    const card = document.createElement("div");
    card.className = "rz-palette";
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    // Clicks inside the card must not reach the backdrop behind it, nor the
    // document-level "click outside closes the menu" check in EventHandler.
    card.addEventListener("pointerdown", (e) => e.stopPropagation());
    card.addEventListener("click", (e) => e.stopPropagation());

    card.appendChild(this._buildHeader());

    const body = document.createElement("div");
    body.className = "rz-palette-body";
    this.railEl = document.createElement("div");
    this.railEl.className = "rz-palette-rail";
    const resultsCol = document.createElement("div");
    resultsCol.className = "rz-palette-results-col";

    const eyebrowRow = document.createElement("div");
    eyebrowRow.className = "rz-palette-eyebrow";
    this.eyebrowEl = document.createElement("span");
    this.countEl = document.createElement("span");
    this.countEl.className = "rz-palette-count";
    eyebrowRow.appendChild(this.eyebrowEl);
    eyebrowRow.appendChild(this.countEl);

    this.resultsEl = document.createElement("div");
    this.resultsEl.className = "rz-palette-results";

    resultsCol.appendChild(eyebrowRow);
    resultsCol.appendChild(this.resultsEl);
    body.appendChild(this.railEl);
    body.appendChild(resultsCol);
    card.appendChild(body);

    card.appendChild(this._buildFooter());
    root.appendChild(card);

    document.body.appendChild(root);
    this.element = root;

    this._renderRail();
    this._renderResults();

    this._onKeyDown = (e) => this._handleKey(e);
    document.addEventListener("keydown", this._onKeyDown, true);
  }

  /**
   * The lime ring at the point the node will land, with a dashed lead to the
   * palette. Without it the palette is just a floating list and "at cursor"
   * is a claim rather than something you can see.
   */
  _buildSpawnMarker(clientX, clientY, cardLeft, cardTop) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "rz-palette-marker");
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));

    const ns = "http://www.w3.org/2000/svg";
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("cx", clientX);
    ring.setAttribute("cy", clientY);
    ring.setAttribute("r", "6");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "var(--rz-accent)");
    ring.setAttribute("stroke-width", "2");

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", clientX);
    dot.setAttribute("cy", clientY);
    dot.setAttribute("r", "2.5");
    dot.setAttribute("fill", "var(--rz-accent)");

    const endX = cardLeft;
    const endY = cardTop + 34;
    const path = document.createElementNS(ns, "path");
    const midX = (clientX + endX) / 2;
    path.setAttribute(
      "d",
      `M${clientX} ${clientY} C ${midX} ${clientY} ${midX} ${endY} ${endX} ${endY}`,
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "var(--rz-accent)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-dasharray", "5 5");
    path.setAttribute("opacity", "0.7");

    svg.appendChild(path);
    svg.appendChild(ring);
    svg.appendChild(dot);
    return svg;
  }

  _buildHeader() {
    const header = document.createElement("div");
    header.className = "rz-palette-header";

    header.insertAdjacentHTML(
      "afterbegin",
      `<svg class="rz-palette-search-icon" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
    );

    this.input = document.createElement("input");
    this.input.className = "rz-palette-input";
    this.input.type = "text";
    this.input.placeholder = "Search nodes…";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Search nodes");
    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.highlightIndex = 0;
      this._renderRail();
      this._renderResults();
    });
    header.appendChild(this.input);

    const hint = document.createElement("span");
    hint.className = "rz-palette-hint";
    hint.textContent = "Add node at cursor";
    header.appendChild(hint);

    return header;
  }

  _buildFooter() {
    const footer = document.createElement("div");
    footer.className = "rz-palette-footer";
    footer.innerHTML = `
      <span><kbd>↑↓</kbd>navigate</span>
      <span><kbd>↵</kbd>place node</span>
      <span><kbd>esc</kbd>cancel</span>
      <span class="rz-palette-spacer"></span>
      <span class="rz-palette-tabhint">Tab cycles categories</span>
    `;
    return footer;
  }

  _renderRail() {
    if (!this.railEl) return;
    this.railEl.innerHTML = "";

    const rows = [
      { name: "All", cat: null, count: this.total, color: "var(--rz-accent)" },
      ...this.categories.map((cat) => ({
        name: cat,
        cat,
        count: (this.byCategory.get(cat) || []).length,
        color: categoryColor(cat),
      })),
    ];

    for (const row of rows) {
      const el = document.createElement("div");
      el.className = "rz-palette-cat";
      el.dataset.cat = row.cat ?? "";
      const on = this.activeCategory === row.cat;
      if (on) el.classList.add("is-active");
      el.style.setProperty("--cat", row.color);
      el.style.setProperty(
        "--cat-soft",
        row.cat ? withAlpha(categoryColor(row.cat), 0.14) : "var(--rz-accent-14)",
      );
      el.innerHTML = `<span class="rz-palette-bar"></span>
        <span class="rz-palette-dot"></span>
        <span class="rz-palette-cat-name"></span>
        <span class="rz-palette-cat-count"></span>`;
      el.querySelector(".rz-palette-cat-name").textContent = row.name;
      el.querySelector(".rz-palette-cat-count").textContent = String(row.count);
      el.addEventListener("click", () => {
        this.activeCategory = row.cat;
        this.highlightIndex = 0;
        // Picking a family is a browse gesture; a stale query would keep
        // overriding it, so clear it and let the rail speak.
        this.query = "";
        if (this.input) this.input.value = "";
        this._syncRailSelection();
        this._renderResults();
        this.input?.focus();
      });
      this.railEl.appendChild(el);
    }
  }

  /** Move the rail's selection without rebuilding its rows. */
  _syncRailSelection() {
    const rows = this.railEl?.children;
    if (!rows) return;
    for (const row of rows) {
      row.classList.toggle("is-active", row.dataset.cat === (this.activeCategory ?? ""));
    }
  }

  _renderResults() {
    if (!this.resultsEl) return;
    this.results = this._computeResults();
    this.highlightIndex = Math.max(
      0,
      Math.min(this.highlightIndex, this.results.length - 1),
    );

    const searching = !!this.query.trim();
    const label = searching
      ? "RESULTS"
      : this.activeCategory
        ? this.activeCategory.toUpperCase()
        : "SUGGESTED";
    this.eyebrowEl.textContent = label;
    this.eyebrowEl.style.color =
      !searching && this.activeCategory
        ? categoryColor(this.activeCategory)
        : "var(--rz-accent)";
    this.countEl.textContent =
      searching || !this.activeCategory
        ? `${this.results.length} of ${this.total}`
        : String(this.results.length);

    this.resultsEl.innerHTML = "";

    if (!this.results.length) {
      const empty = document.createElement("div");
      empty.className = "rz-palette-empty";
      empty.textContent = "No nodes match";
      this.resultsEl.appendChild(empty);
      return;
    }

    this.results.forEach((entry, i) => {
      const color = categoryColor(entry.cat);
      const row = document.createElement("div");
      row.className = "rz-palette-item";
      if (i === this.highlightIndex) row.classList.add("is-highlighted");
      row.style.setProperty("--cat", color);
      row.style.setProperty("--cat-soft", withAlpha(color, 0.16));

      const type = entry.type;
      const tint = type ? typeColor(type) : "var(--rz-type-default)";
      row.style.setProperty("--type", tint);
      row.style.setProperty(
        "--type-soft",
        type ? withAlpha(typeColor(type), 0.14) : "rgba(255,244,230,0.05)",
      );

      row.innerHTML = `<span class="rz-palette-glyph"></span>
        <span class="rz-palette-name"></span>
        <span class="rz-palette-item-cat"></span>
        <span class="rz-palette-type"></span>`;
      row.querySelector(".rz-palette-glyph").textContent = entry.label
        .slice(0, 1)
        .toUpperCase();
      row.querySelector(".rz-palette-name").textContent = entry.label;
      row.querySelector(".rz-palette-item-cat").textContent = entry.cat;
      row.querySelector(".rz-palette-type").textContent = type || "—";

      row.addEventListener("mousemove", () => {
        if (this.highlightIndex === i) return;
        this.highlightIndex = i;
        this._syncHighlight();
      });
      row.addEventListener("click", () => this._placeNode(entry.kind));

      this.resultsEl.appendChild(row);
    });
  }

  /** Move the highlight without rebuilding the list. */
  _syncHighlight() {
    const rows = this.resultsEl?.children;
    if (!rows) return;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("is-highlighted", i === this.highlightIndex);
    }
    rows[this.highlightIndex]?.scrollIntoView({ block: "nearest" });
  }

  // ---- keyboard -----------------------------------------------------------

  _handleKey(e) {
    if (!this.isVisible) return;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        return;
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        if (this.results.length) {
          this.highlightIndex = (this.highlightIndex + 1) % this.results.length;
          this._syncHighlight();
        }
        return;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        if (this.results.length) {
          this.highlightIndex =
            (this.highlightIndex - 1 + this.results.length) % this.results.length;
          this._syncHighlight();
        }
        return;
      case "Enter": {
        e.preventDefault();
        e.stopPropagation();
        const entry = this.results[this.highlightIndex];
        if (entry) this._placeNode(entry.kind);
        return;
      }
      case "Tab": {
        e.preventDefault();
        e.stopPropagation();
        const order = [null, ...this.categories];
        const at = order.indexOf(this.activeCategory);
        const next = e.shiftKey
          ? (at - 1 + order.length) % order.length
          : (at + 1) % order.length;
        this.activeCategory = order[next];
        this.query = "";
        if (this.input) this.input.value = "";
        this.highlightIndex = 0;
        this._syncRailSelection();
        this._renderResults();
        this.railEl?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
        return;
      }
      default:
        // Everything else is typing: keep the caret in the search field even if
        // focus wandered to a row.
        if (e.key.length === 1 && document.activeElement !== this.input) {
          this.input?.focus();
        }
    }
  }

  // ---- creating the node --------------------------------------------------

  _placeNode(kind) {
    // Tells hide() that the wire drag was consumed, not abandoned.
    this._isCreatingNode = true;

    window.eventHandler?._checkAndWarmupAfterInactivity?.();

    // Adding a node while dragging a wire is one user action, so it has to be
    // one undo step. Without the transaction the node and the auto-connected
    // wire land on the undo stack separately and the first Ctrl+Z only removes
    // the wire.
    const undoManager = window.undoManager || window.editor?.undoManager;
    undoManager?.beginTransaction?.("add node");

    try {
      const node = makeNode(kind, this.canvasPos.x, this.canvasPos.y);
      this.graph.nodes.push(node);
      this.graph.selection = new Set([node.id]);

      window.onNodeCreated?.(node);
      this._finishNodeCreation(node, kind);
    } finally {
      undoManager?.commitTransaction?.();
    }
  }

  _finishNodeCreation(node, kind) {
    // Capture the wire before hide() gets a chance to cancel it.
    const connections = window.eventHandler?.connections;
    const dragWire = connections?.getDragWire?.() || null;

    // ORDER MATTERS below; do not reorder.

    // 1. Close the palette first so it isn't overlaying the canvas.
    this.hide();

    // 2. Land the wire on the new node, if one was in flight.
    if (dragWire && connections) {
      try {
        if (dragWire.isFromInput) {
          // Dragging from an input: the new node's first output feeds it.
          const outCount = (NodeDefs[kind]?.pinsOut || []).length;
          if (outCount > 0) {
            connections.endWireDrag(dragWire.pos, { nodeId: node.id, pin: 0 });
          }
        } else {
          // Dragging from an output: pin 0 for almost every node, but a texture
          // source dropped on a Transform belongs on its Texture pin, not the
          // UV pin that happens to sit at index 0.
          const sourceNode = this.graph.nodes.find(
            (n) => n.id === dragWire.from?.nodeId,
          );
          const inputPin = pickAutoConnectInputPin(sourceNode?.kind, kind);
          if (inputPin >= 0) {
            connections.endWireDrag(dragWire.pos, { nodeId: node.id, pin: inputPin });
          }
        }
      } catch (error) {
        console.warn("[AddNodePalette] Failed to connect node to wire:", error);
      }
    }

    // 3. Repaint the UI canvas now. onChange (below) recompiles the shader but
    //    does not redraw the node canvas, so without this the node exists in
    //    the graph and is invisible until something else happens to repaint.
    window.editor?.markDirty?.("node-creation");
    window.editor?.draw?.();

    if (window.eventHandler) {
      window.eventHandler._interactionStartTime = Date.now();
      window.eventHandler._justWarmedUp = true;
      setTimeout(() => {
        if (window.eventHandler) window.eventHandler._justWarmedUp = false;
      }, 1000);
    }

    // 4. Defer the shader rebuild: the delay lets GPU bind groups settle after
    //    the structural change instead of compiling against half-updated state.
    setTimeout(() => {
      this.onChange?.();
      // This path bypasses Editor.createNode, so preview generation has to be
      // triggered explicitly — otherwise the new node stays a placeholder until
      // some later parameter change happens to recompute it.
      window.editor?.previewIntegration?.onNodeAdded?.(node);
    }, 50);
  }

  // ---- styles -------------------------------------------------------------

  _ensureStyles() {
    if (document.getElementById("rz-palette-styles")) return;
    const style = document.createElement("style");
    style.id = "rz-palette-styles";
    style.textContent = `
      .rz-palette-root {
        position: fixed;
        inset: 0;
        z-index: 10000;
        font-family: var(--rz-font-ui);
      }

      /* A transparent click-catcher, not a scrim: you are choosing what to add
         to the graph, so the graph has to stay readable behind the palette. */
      .rz-palette-backdrop {
        position: absolute;
        inset: 0;
      }

      .rz-palette-marker {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .rz-palette {
        position: absolute;
        width: ${PALETTE_WIDTH}px;
        border-radius: 16px;
        overflow: hidden;
        background: linear-gradient(#1a1511, #141009);
        border: 1px solid var(--rz-line-strong);
        box-shadow:
          0 30px 70px -14px rgba(0, 0, 0, 0.75),
          0 6px 20px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 244, 230, 0.06),
          0 0 46px var(--rz-accent-30);
        animation: rzradial 0.18s cubic-bezier(0.2, 0.7, 0.3, 1);
        color: var(--rz-text);
      }

      .rz-palette-header {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 13px 17px;
        border-bottom: 1px solid var(--rz-line);
      }

      .rz-palette-search-icon {
        flex: none;
        color: var(--rz-accent);
      }

      .rz-palette-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--rz-text);
        font-family: inherit;
        font-size: 15px;
        padding: 0;
        caret-color: var(--rz-accent);
      }

      .rz-palette-input::placeholder {
        color: var(--rz-text-faint);
      }

      .rz-palette-hint {
        flex: none;
        font-family: var(--rz-font-mono);
        font-size: 10px;
        color: var(--rz-text-3);
      }

      .rz-palette-body {
        display: flex;
        height: ${BODY_HEIGHT}px;
      }

      .rz-palette-rail {
        width: 176px;
        flex: none;
        padding: 9px;
        border-right: 1px solid rgba(255, 244, 230, 0.07);
        background: rgba(0, 0, 0, 0.16);
        overflow-y: auto;
      }

      /* A rail row states its family twice: the dot is the colour, the bar is
         the same spine the node will carry once it is on the canvas. */
      .rz-palette-cat {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 9px;
        border-radius: 9px;
        cursor: pointer;
        color: var(--rz-text-2);
        font-size: 12.5px;
      }

      .rz-palette-cat:hover {
        background: var(--rz-fill-soft);
      }

      .rz-palette-cat.is-active {
        background: var(--cat-soft);
        color: #ffffff;
      }

      .rz-palette-bar {
        position: absolute;
        left: 0;
        top: 7px;
        bottom: 7px;
        width: 3px;
        border-radius: 2px;
        background: transparent;
      }

      .rz-palette-cat.is-active .rz-palette-bar {
        background: var(--cat);
      }

      .rz-palette-dot {
        width: 9px;
        height: 9px;
        flex: none;
        border-radius: 50%;
        background: var(--cat);
        box-shadow: 0 0 7px var(--cat);
        opacity: 0.75;
      }

      .rz-palette-cat.is-active .rz-palette-dot {
        opacity: 1;
      }

      .rz-palette-cat-name {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .rz-palette-cat-count {
        flex: none;
        font-family: var(--rz-font-mono);
        font-size: 9px;
        color: var(--rz-text-faint);
      }

      .rz-palette-cat.is-active .rz-palette-cat-count {
        color: rgba(255, 255, 255, 0.55);
      }

      .rz-palette-results-col {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        padding: 9px 9px 9px 10px;
        overflow: hidden;
      }

      .rz-palette-eyebrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 3px 8px 8px;
        font-family: var(--rz-font-mono);
        font-size: 9px;
        letter-spacing: 1.3px;
      }

      .rz-palette-count {
        color: var(--rz-text-faint);
        letter-spacing: 0;
      }

      .rz-palette-results {
        flex: 1;
        overflow-y: auto;
      }

      .rz-palette-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 9px;
        cursor: pointer;
      }

      .rz-palette-item.is-highlighted {
        background: var(--rz-accent-10);
      }

      .rz-palette-glyph {
        width: 22px;
        height: 22px;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: var(--cat-soft);
        color: var(--cat);
        font-family: var(--rz-font-mono);
        font-size: 11px;
        font-weight: 600;
      }

      .rz-palette-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        color: #f0e9dd;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .rz-palette-item-cat {
        flex: none;
        font-size: 9.5px;
        color: var(--rz-text-3);
      }

      /* The data-type badge is the one place the SIGNAL palette appears here —
         everything else in this menu is category colour. */
      .rz-palette-type {
        flex: none;
        min-width: 40px;
        text-align: center;
        font-family: var(--rz-font-mono);
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 5px;
        background: var(--type-soft);
        color: var(--type);
      }

      .rz-palette-empty {
        padding: 14px 10px;
        font-size: 12.5px;
        color: var(--rz-text-3);
      }

      .rz-palette-footer {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 17px;
        border-top: 1px solid var(--rz-line);
        font-family: var(--rz-font-mono);
        font-size: 9.5px;
        color: var(--rz-text-faint);
      }

      .rz-palette-footer span {
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .rz-palette-footer kbd {
        font: inherit;
        padding: 1px 5px;
        border-radius: 4px;
        border: 1px solid rgba(255, 244, 230, 0.14);
      }

      .rz-palette-spacer {
        flex: 1;
      }

      .rz-palette-tabhint {
        color: var(--rz-accent);
      }
    `;
    document.head.appendChild(style);
  }
}
