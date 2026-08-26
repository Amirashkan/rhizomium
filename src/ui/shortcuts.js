// src/ui/shortcuts.js
//
// One keymap for the whole editor.
//
// Every entry in the top menu bar has a keyboard shortcut, and this file is the
// single place that says which. Three things read the same table, so they can
// never drift apart:
//
//   1. applyMenuShortcutHints()  — writes each combo onto its menu row, so the
//      menu itself teaches the shortcut (rendered by CSS from `data-shortcut`,
//      which survives a button whose label is rewritten at runtime).
//   2. installShortcutDispatcher() — the global key handler. For most entries
//      it simply clicks the menu row, so a shortcut and a click always run the
//      exact same code path.
//   3. showShortcutsDialog()     — Help → Shortcuts / Keymap prints the table.
//
// Entries marked `dispatch: false` are already implemented by a dedicated
// handler elsewhere (undo/redo in main.js, cut/copy/paste in the capture-phase
// handler that has to beat the browser to it, Delete in EventHandler). Those
// are listed and displayed here but not fired from here — otherwise the action
// would run twice per keystroke.

/** Combos are written with `Mod` for Ctrl on Windows/Linux and ⌘ on macOS. */
export function isMacPlatform() {
  const platform =
    (typeof navigator !== "undefined" &&
      (navigator.userAgentData?.platform || navigator.platform)) ||
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// ---------------------------------------------------------------------------
// The keymap
// ---------------------------------------------------------------------------
//
// item = {
//   id       DOM id of the menu row the shortcut is printed on (a <button>, or
//            the <label> of a checkbox row). Omit for actions with no menu row.
//   target   id of the element to click, when that isn't the row itself — a
//            checkbox row prints on its label but must fire on the input.
//   requires CSS selector that must match for the key to fire at all (the WGSL
//            console's own buttons only make sense while it is open).
//   label    what the dialog calls it
//   keys     canonical combo, e.g. "Mod+Shift+S"
//   alt      further combos that do the same thing
//   dispatch false when another handler owns the key (see the note above)
//   alias    true when this row repeats a command listed under another menu,
//            so the uniqueness check knows the shared key is deliberate
//   note     one line of context for the keymap dialog
// }

export const SHORTCUT_SECTIONS = [
  {
    title: "File",
    items: [
      { id: "btn-new-project", label: "New Project", keys: "Mod+N" },
      { id: "btn-open-project", label: "Open Project…", keys: "Mod+O" },
      { id: "btn-save", label: "Save", keys: "Mod+S" },
      { id: "btn-save-as", label: "Save As…", keys: "Mod+Shift+S" },
      { id: "btn-file-manager", label: "File Manager", keys: "Mod+Shift+O" },
      { id: "btn-export", label: "Export", keys: "Mod+Shift+X" },
      { id: "btn-publish-image", label: "Publish Image…", keys: "Mod+Shift+U" },
      {
        id: "btn-publish-animation",
        label: "Publish Animation…",
        keys: "Mod+Alt+U",
      },
      { id: "btn-web-viewer", label: "Open in Web Viewer", keys: "Mod+Shift+W" },
      { id: "btn-backups", label: "Backups", keys: "Mod+B" },
      { id: "btn-exit", label: "Exit", keys: "Mod+Alt+Q" },
      {
        label: "Load from browser storage",
        keys: "Mod+Shift+L",
        dispatch: false,
        note: "Restores the copy this browser autosaved.",
      },
    ],
  },
  {
    title: "Edit",
    items: [
      { id: "btn-undo", label: "Undo", keys: "Mod+Z", dispatch: false },
      {
        id: "btn-redo",
        label: "Redo",
        keys: "Mod+Y",
        alt: ["Mod+Shift+Z"],
        dispatch: false,
      },
      { id: "btn-cut", label: "Cut", keys: "Mod+X", dispatch: false },
      { id: "btn-copy", label: "Copy", keys: "Mod+C", dispatch: false },
      { id: "btn-paste", label: "Paste", keys: "Mod+V", dispatch: false },
      {
        id: "btn-delete",
        label: "Delete Selection",
        keys: "Delete",
        alt: ["Backspace"],
        dispatch: false,
      },
      { id: "btn-rebuild", label: "Rebuild Shader", keys: "Mod+Shift+R" },
      { id: "btn-preferences", label: "Preferences…", keys: "Mod+," },
      {
        label: "Edit expression on the focused parameter",
        keys: "Mod+E",
        dispatch: false,
      },
      {
        label: "Nudge selected nodes",
        keys: "Arrows",
        alt: ["Shift+Arrows"],
        dispatch: false,
        note: "Shift moves by a larger step; snapping uses the grid size.",
      },
      {
        label: "Rename selected node",
        keys: "F2",
        dispatch: false,
        note: "One node selected.",
      },
    ],
  },
  {
    title: "View",
    items: [
      { id: "btn-toggle-param-panel", label: "Toggle ParamPanel", keys: "Mod+1" },
      {
        id: "btn-toggle-preview-panel",
        label: "Toggle Preview Panel",
        keys: "Mod+2",
        alt: ["Mod+P"],
      },
      { id: "btn-toggle-3d-viewport", label: "Toggle 3D Viewport", keys: "Mod+3" },
      {
        id: "btn-preview-export-settings",
        label: "Preview / Export Settings",
        keys: "Mod+Shift+P",
      },
      { id: "btn-zoom-in", label: "Zoom In", keys: "Mod+=", alt: ["Mod++"] },
      { id: "btn-zoom-out", label: "Zoom Out", keys: "Mod+-" },
      { id: "btn-zoom-reset", label: "Reset Zoom", keys: "Mod+0" },
      {
        id: "row-view-show-grid",
        target: "view-show-grid",
        label: "Show Grid",
        keys: "Mod+Shift+G",
      },
      {
        id: "row-snap-toggle",
        target: "snap-toggle",
        label: "Snap to Grid",
        keys: "Mod+G",
      },
      { id: "btn-toggle-console", label: "Console (Generated WGSL)", keys: "Mod+`" },
      { id: "btn-toggle-timeline", label: "Timeline", keys: "Mod+Alt+T" },
      { id: "btn-toggle-vj", label: "VJ Control", keys: "Mod+Shift+V" },
      {
        id: "btn-toggle-profiler",
        label: "Compute Profiler",
        keys: "Mod+Alt+P",
        dispatch: false,
        note: "Per-frame GPU timing; costs performance while open.",
      },
      {
        id: "btn-second-monitor",
        label: "Second Monitor Viewer",
        keys: "Mod+Shift+2",
        note: "Desktop / Vite build only.",
      },
      {
        label: "Frame selected nodes",
        keys: "F",
        dispatch: false,
        note: "Fits the selection to the viewport.",
      },
      {
        label: "Show / hide selected node previews",
        keys: "H",
        dispatch: false,
      },
    ],
  },
  {
    title: "Node",
    items: [
      {
        id: "btn-create-node",
        label: "Create Node…",
        keys: "Mod+Space",
        alt: ["Tab"],
        dispatch: false,
        note: "Tab opens the palette while dragging a wire.",
      },
      {
        // The same command as Edit → Delete, listed again where the Node menu
        // offers it: one key, one action, printed on both rows.
        id: "btn-delete-node",
        label: "Delete Node",
        keys: "Delete",
        dispatch: false,
        alias: true,
      },
      { id: "btn-duplicate-node", label: "Duplicate Node", keys: "Mod+D" },
      { id: "btn-connect-pins", label: "Connect Pins", keys: "Mod+K" },
      { id: "btn-disconnect-pins", label: "Disconnect Pins", keys: "Mod+Shift+K" },
      { id: "btn-node-settings", label: "Node Settings / Params…", keys: "Mod+I" },
    ],
  },
  {
    title: "Tools",
    items: [
      { id: "btn-account", label: "Account…", keys: "Mod+Alt+L" },
      { id: "btn-ai-panel", label: "AI Assistant", keys: "Mod+Shift+A" },
      {
        id: "btn-script-editor",
        label: "Script Editor / Python Console",
        keys: "Mod+Alt+S",
      },
      { id: "btn-shader-compiler", label: "Shader Compiler", keys: "Mod+Alt+C" },
      { id: "btn-glsl-utilities", label: "GLSL Utilities", keys: "Mod+Alt+G" },
      {
        id: "btn-mapping-tool",
        label: "Projection Mapping…",
        keys: "Mod+Shift+M",
        // Not plain Mod+M: ⌘M is macOS's minimise-window and never reaches
        // the page, so the shortcut would be dead on half the machines.
      },
      { id: "btn-audio-settings", label: "Audio Settings", keys: "Mod+Alt+A" },
      { id: "btn-midi-settings", label: "MIDI Settings", keys: "Mod+Alt+M" },
      { id: "btn-osc-settings", label: "OSC Receiver", keys: "Mod+Alt+O" },
      {
        label: "Compute shader test",
        keys: "Mod+Shift+C",
        dispatch: false,
      },
    ],
  },
  {
    title: "Window",
    items: [
      { id: "btn-layout-default", label: "Layout: Default", keys: "Mod+Alt+1" },
      { id: "btn-layout-custom", label: "Layout: Custom", keys: "Mod+Alt+2" },
      { id: "btn-layout-minimal", label: "Layout: Minimal", keys: "Mod+Alt+3" },
      { id: "btn-floating-windows", label: "Floating Windows", keys: "Mod+Alt+F" },
      { id: "btn-reset-layout", label: "Reset Layout", keys: "Mod+Alt+0" },
    ],
  },
  {
    title: "Help",
    items: [
      { id: "btn-documentation", label: "Documentation", keys: "F1" },
      {
        id: "btn-shortcuts",
        label: "Shortcuts / Keymap",
        keys: "Mod+/",
        alt: ["Shift+/"],
      },
      { id: "btn-welcome", label: "Welcome", keys: "Mod+Alt+W" },
      { id: "btn-about", label: "About", keys: "Mod+Alt+I" },
    ],
  },
  {
    title: "WGSL Console",
    items: [
      {
        id: "btn-export-wgsl",
        label: "Export WGSL",
        keys: "Mod+Shift+E",
        dispatch: false,
      },
      {
        id: "btn-select-code",
        label: "Select All Code",
        keys: "Mod+Alt+E",
        requires: "#code-console:not(.closed)",
      },
      {
        id: "btn-copy-code",
        label: "Copy Code",
        keys: "Mod+Alt+Y",
        requires: "#code-console:not(.closed)",
      },
      {
        label: "Close panels / cancel",
        keys: "Esc",
        dispatch: false,
        note: "Closes the open menu, dialog or parameter panel.",
      },
    ],
  },
];

/** Every item, flattened, in menu order. */
export function allShortcutItems() {
  return SHORTCUT_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.title })),
  );
}

/** Every combo an item answers to. */
export function comboList(item) {
  return [item.keys, ...(item.alt || [])].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Combo parsing / matching
// ---------------------------------------------------------------------------

// Keys whose token is used verbatim rather than derived from a letter/digit.
const NAMED_KEYS = new Set([
  "delete",
  "backspace",
  "escape",
  "esc",
  "enter",
  "tab",
  "space",
  "arrows",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);

// Spellings the table may use, mapped onto the token eventKeyToken() produces.
const KEY_ALIASES = { esc: "escape", del: "delete" };

/** "Mod+Shift+S" -> { mod: true, shift: true, alt: false, key: "s" } */
export function parseCombo(combo) {
  const parts = String(combo).split("+");
  // "Mod++" splits to ["Mod", "", ""] — an empty last part means the key is the
  // plus sign itself.
  let rawKey = parts.pop();
  if (rawKey === "") rawKey = "+";
  const lowered = rawKey.toLowerCase();
  const key = KEY_ALIASES[lowered] || lowered;
  const mods = parts.map((p) => p.toLowerCase());
  return {
    mod: mods.includes("mod"),
    shift: mods.includes("shift"),
    alt: mods.includes("alt"),
    key,
  };
}

/**
 * The key a KeyboardEvent stands for, as a combo token.
 *
 * Read from `event.code` (physical key) rather than `event.key`: with Alt held,
 * macOS rewrites `key` into a symbol (⌥S is "ß"), and on non-US layouts a
 * shifted digit is a punctuation mark. `code` stays put.
 */
export function eventKeyToken(event) {
  const code = event.code || "";

  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);

  switch (code) {
    case "Backquote":
      return "`";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Backslash":
      return "\\";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Minus":
    case "NumpadSubtract":
      return "-";
    case "Equal":
      return "=";
    case "NumpadAdd":
      return "+";
    case "Space":
      return "space";
    case "Escape":
      return "escape";
    case "Delete":
      return "delete";
    case "Backspace":
      return "backspace";
    case "Enter":
    case "NumpadEnter":
      return "enter";
    case "Tab":
      return "tab";
    default:
      break;
  }

  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();

  // No usable code (synthetic events in tests, some IMEs): fall back to `key`.
  const key = (event.key || "").toLowerCase();
  if (key === " ") return "space";
  return key;
}

/** Does this keystroke fire this combo? */
export function eventMatchesCombo(event, combo, { mac = isMacPlatform() } = {}) {
  const want = parseCombo(combo);
  if (want.key === "arrows") return false; // documentation-only entry

  const modDown = mac ? !!event.metaKey : !!event.ctrlKey;
  const otherModDown = mac ? !!event.ctrlKey : !!event.metaKey;

  if (want.mod !== modDown) return false;
  if (otherModDown) return false;
  if (want.alt !== !!event.altKey) return false;

  const token = eventKeyToken(event);

  // "Mod++" and "Mod+=" are the same physical key; Shift is what separates
  // them, so the plus form deliberately ignores the shift state.
  if (want.key === "+") return token === "+" || token === "=";
  // "Shift+/" is how a US keyboard types "?" — the shift flag IS the key here.
  if (want.shift !== !!event.shiftKey) return false;

  return token === want.key;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const DISPLAY_NAMES = {
  space: "Space",
  escape: "Esc",
  esc: "Esc",
  delete: "Del",
  backspace: "Backspace",
  enter: "Enter",
  tab: "Tab",
  arrows: "Arrows",
  "`": "`",
};

/** "Mod+Shift+S" -> "Ctrl+Shift+S" (or "⌘⇧S" on macOS). */
export function formatCombo(combo, { mac = isMacPlatform() } = {}) {
  const { mod, shift, alt, key } = parseCombo(combo);

  let label = DISPLAY_NAMES[key];
  if (!label) {
    label = NAMED_KEYS.has(key)
      ? key.toUpperCase()
      : key.length === 1
        ? key.toUpperCase()
        : key.charAt(0).toUpperCase() + key.slice(1);
  }

  if (mac) {
    return `${mod ? "⌘" : ""}${alt ? "⌥" : ""}${shift ? "⇧" : ""}${label}`;
  }

  const parts = [];
  if (mod) parts.push("Ctrl");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  parts.push(label);
  return parts.join("+");
}

/** Every combo of an item, formatted for display: "Ctrl+Y / Ctrl+Shift+Z". */
export function formatItemCombos(item, options) {
  return comboList(item)
    .map((c) => formatCombo(c, options))
    .join(" / ");
}

// ---------------------------------------------------------------------------
// Menu annotation
// ---------------------------------------------------------------------------

/**
 * Print each shortcut on its menu row.
 *
 * The combo goes into `data-shortcut` and is drawn by CSS (`::after`) rather
 * than being appended as a child node: a couple of rows rewrite their own
 * `textContent` to show state (the profiler's "✓"), which would wipe an
 * appended element but leaves an attribute alone.
 *
 * @returns {number} rows annotated — the ones actually present in this build.
 */
export function applyMenuShortcutHints(root = document) {
  let annotated = 0;

  for (const item of allShortcutItems()) {
    if (!item.id) continue;
    const el = root.getElementById?.(item.id) || root.querySelector?.(`#${item.id}`);
    if (!el) continue;

    const display = formatCombo(item.keys);
    el.setAttribute("data-shortcut", display);

    // Keep any hand-written title, but make sure the shortcut is in it.
    const existing = el.getAttribute("title");
    if (!existing) {
      el.setAttribute("title", `${item.label} (${formatItemCombos(item)})`);
    } else if (!existing.includes(display)) {
      el.setAttribute("title", `${existing} (${formatItemCombos(item)})`);
    }
    annotated += 1;
  }

  return annotated;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** A row that isn't there, is hidden, or is disabled must not be fired. */
function isRowActionable(el) {
  if (!el) return false;
  if (el.disabled) return false;
  if (el.getAttribute?.("aria-disabled") === "true") return false;
  // Hidden rows are features this build doesn't ship (the second-monitor
  // viewer is web-hidden), so their key must fall through to the browser.
  const inlineHidden = el.style?.display === "none";
  const parentHidden = el.closest?.('[style*="display:none"],[style*="display: none"]');
  return !inlineHidden && !parentHidden;
}

/**
 * Install the global key handler.
 *
 * Every dispatchable entry fires by clicking its menu row, so a shortcut and a
 * click can never diverge. Returns a function that removes the listener.
 *
 * @param {object}   options
 * @param {Function} options.shouldIgnore  (event) => true while typing in a field
 * @param {Document} options.root          document to look rows up in
 * @param {Window}   options.target        where to listen
 */
export function installShortcutDispatcher({
  shouldIgnore = () => false,
  root = document,
  target = window,
  onDispatch = null,
  mac = isMacPlatform(),
} = {}) {
  const handler = (event) => {
    if (event.defaultPrevented) return;
    if (shouldIgnore(event)) return;

    for (const item of allShortcutItems()) {
      if (item.dispatch === false || !item.id) continue;
      if (!comboList(item).some((c) => eventMatchesCombo(event, c, { mac }))) {
        continue;
      }

      if (item.requires && !root.querySelector?.(item.requires)) return;

      const el = root.getElementById?.(item.target || item.id);
      const row = item.target ? root.getElementById?.(item.id) : el;
      // A row the build hides (the second-monitor viewer on the web) or one
      // that is disabled must let the key fall through untouched.
      if (!isRowActionable(el) || !isRowActionable(row)) return;

      event.preventDefault();
      event.stopPropagation();
      el.click();
      onDispatch?.(item);
      return;
    }
  };

  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}

// ---------------------------------------------------------------------------
// Help → Shortcuts / Keymap
// ---------------------------------------------------------------------------

let keymapOverlay = null;

/** Close the keymap dialog if it is open. */
export function hideShortcutsDialog() {
  if (keymapOverlay) {
    keymapOverlay.remove();
    keymapOverlay = null;
  }
}

/**
 * Show the full keymap — the same table the menus are annotated from, so it
 * can't fall behind them.
 */
export function showShortcutsDialog(doc = document) {
  if (keymapOverlay) {
    hideShortcutsDialog();
    return null;
  }

  const mac = isMacPlatform();

  const overlay = doc.createElement("div");
  overlay.className = "keymap-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Keyboard shortcuts");

  const panel = doc.createElement("div");
  panel.className = "keymap-panel";
  overlay.appendChild(panel);

  const head = doc.createElement("div");
  head.className = "keymap-head";
  panel.appendChild(head);

  const title = doc.createElement("div");
  title.className = "keymap-title";
  title.textContent = "Keyboard Shortcuts";
  head.appendChild(title);

  const search = doc.createElement("input");
  search.className = "keymap-search";
  search.type = "search";
  search.placeholder = "Filter…";
  search.setAttribute("aria-label", "Filter shortcuts");
  head.appendChild(search);

  const closeBtn = doc.createElement("button");
  closeBtn.className = "keymap-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  head.appendChild(closeBtn);

  const body = doc.createElement("div");
  body.className = "keymap-body";
  panel.appendChild(body);

  for (const section of SHORTCUT_SECTIONS) {
    const col = doc.createElement("section");
    col.className = "keymap-section";

    const h = doc.createElement("h3");
    h.textContent = section.title;
    col.appendChild(h);

    for (const item of section.items) {
      const row = doc.createElement("div");
      row.className = "keymap-row";
      row.dataset.search = `${section.title} ${item.label} ${formatItemCombos(item, { mac })}`
        .toLowerCase();

      const name = doc.createElement("span");
      name.className = "keymap-name";
      name.textContent = item.label;
      if (item.note) name.title = item.note;
      row.appendChild(name);

      const keys = doc.createElement("span");
      keys.className = "keymap-keys";
      comboList(item).forEach((combo, i) => {
        if (i > 0) {
          const sep = doc.createElement("span");
          sep.className = "keymap-or";
          sep.textContent = "or";
          keys.appendChild(sep);
        }
        const kbd = doc.createElement("kbd");
        kbd.textContent = formatCombo(combo, { mac });
        keys.appendChild(kbd);
      });
      row.appendChild(keys);

      col.appendChild(row);
    }

    body.appendChild(col);
  }

  const foot = doc.createElement("div");
  foot.className = "keymap-foot";
  foot.textContent = mac
    ? "⌘ Command · ⌥ Option · ⇧ Shift — shortcuts pause while you type in a field."
    : "Shortcuts pause while you type in a text field.";
  panel.appendChild(foot);

  // Filtering hides whole sections once every row in them is gone, so the
  // layout doesn't leave empty column headings behind.
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const col of body.querySelectorAll(".keymap-section")) {
      let visible = 0;
      for (const row of col.querySelectorAll(".keymap-row")) {
        const hit = !q || row.dataset.search.includes(q);
        row.style.display = hit ? "" : "none";
        if (hit) visible += 1;
      }
      col.style.display = visible ? "" : "none";
    }
  });

  closeBtn.addEventListener("click", hideShortcutsDialog);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) hideShortcutsDialog();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hideShortcutsDialog();
    }
  });

  doc.body.appendChild(overlay);
  keymapOverlay = overlay;
  search.focus?.();
  return overlay;
}

export function isShortcutsDialogOpen() {
  return !!keymapOverlay;
}
