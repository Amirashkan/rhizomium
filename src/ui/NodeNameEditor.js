// Inline rename field for a node's title.
//
// The graph is drawn into a single 2D canvas, so there is no DOM element behind a node title to
// make contenteditable. This overlays one <input> on top of the canvas — positioned, sized and
// scaled to the node's title bar in the current viewport — and takes it away again the moment the
// edit ends. Renaming therefore stays a canvas-native gesture (double-click the title, or F2)
// without giving every node a permanent DOM twin to keep in sync while panning.
//
// The field is modeless, so it commits on anything that ends the edit: Enter, clicking elsewhere,
// or a gesture that would move the node out from under it. "I typed a name and clicked away" has
// to mean the name stuck. Escape is the only path that throws the text away.

import { nodeDisplayName, customNodeName, defaultNodeName, MAX_NODE_NAME_LENGTH } from "../core/nodeName.js";
import { nodeTitleRect, HEADER_H } from "../core/pinLayout.js";

export class NodeNameEditor {
  constructor({ canvas, viewport, editor }) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.editor = editor;

    this.input = null;
    this.node = null;
    this._closing = false;
  }

  get isOpen() {
    return !!this.input;
  }

  /**
   * Open the field over `node`'s title bar with its current display name selected, so typing
   * replaces it outright — the common case is naming a node, not editing the kind's label.
   */
  open(node) {
    if (!node || !this.canvas || !this.viewport) return false;

    // Re-opening on the node that is already being edited would blow the edit away on the blur
    // that follows; treat it as "keep typing" instead.
    if (this.isOpen && this.node === node) {
      this.input.focus();
      return true;
    }
    if (this.isOpen) this.commit();

    const input = document.createElement("input");
    input.type = "text";
    input.className = "node-name-editor";
    input.value = customNodeName(node) || nodeDisplayName(node);
    input.placeholder = defaultNodeName(node);
    input.maxLength = MAX_NODE_NAME_LENGTH;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", `Rename node #${node.id}`);
    input.title = "Enter to rename, Esc to cancel. Clear the field to restore the default name.";

    input.addEventListener("keydown", (e) => {
      // The canvas listens for single-key shortcuts (H, Delete) and Ctrl/Cmd combos (copy, paste,
      // undo); while this field has the text they belong to the text.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      }
    });
    input.addEventListener("blur", () => this.commit());
    // A click inside the field must not fall through to the canvas underneath and start a drag or
    // dismiss the field as an "outside" click.
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());

    this.input = input;
    this.node = node;
    this._position();
    document.body.appendChild(input);
    input.focus();
    input.select();

    // Zooming re-lays out the canvas under a field that is positioned in screen space, so commit
    // rather than let the box drift off its node. Panning already routes through a canvas
    // mousedown, which blurs the field and commits it the same way.
    this._onWheel = () => {
      if (this.isOpen) this.commit();
    };
    window.addEventListener("wheel", this._onWheel, { passive: true });
    window.addEventListener("resize", this._onWheel);

    return true;
  }

  /** Store what has been typed (via the editor, so it lands on the undo stack) and close. */
  commit() {
    if (!this.isOpen || this._closing) return;
    const node = this.node;
    const value = this.input.value;
    this._teardown();
    this.editor?.renameNode?.(node.id, value);
  }

  /** Close without storing anything. */
  cancel() {
    if (!this.isOpen) return;
    this._teardown();
    this.editor?.safeDraw?.();
  }

  _teardown() {
    // Guards the commit()-from-blur that removing a focused input triggers.
    this._closing = true;
    try {
      window.removeEventListener("wheel", this._onWheel);
      window.removeEventListener("resize", this._onWheel);
      this.input?.remove();
    } finally {
      this.input = null;
      this.node = null;
      this._onWheel = null;
      this._closing = false;
    }
  }

  // Place the field over the node's title bar, in client coordinates. The canvas is transformed by
  // the viewport (translate + scale), so the field is scaled to match: at 50% zoom a node's title
  // bar is half as tall, and so is the box you type into.
  _position() {
    const node = this.node;
    const input = this.input;
    if (!node || !input) return;

    const rect = this.canvas.getBoundingClientRect();
    const scale = this.viewport.scale || 1;
    const origin = this.viewport.canvasToScreen(node.x, node.y);
    const title = nodeTitleRect(node);

    // Matches the renderer's title inset and baseline, so the text does not jump when the field
    // opens over the drawn name.
    const padX = 6 * scale;
    input.style.left = `${rect.left + origin.x + 4 * scale}px`;
    input.style.top = `${rect.top + origin.y + 3 * scale}px`;
    input.style.width = `${Math.max(40, (title.w - 8) * scale)}px`;
    input.style.height = `${Math.max(16, (HEADER_H - 6) * scale)}px`;
    input.style.padding = `0 ${padX}px`;
    // The renderer draws the title at max(10, 12/scale) node-px inside a scaled context, which
    // lands on screen at max(10 * scale, 12) px.
    input.style.fontSize = `${Math.max(10 * scale, 12)}px`;
  }
}
