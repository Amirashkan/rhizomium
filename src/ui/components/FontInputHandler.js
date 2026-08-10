// src/ui/components/FontInputHandler.js
//
// Input handler for `type: 'font'` parameters (the Text node's custom font).
//
// Two ways to pick a typeface, both ending in the same place — the font's bytes stored on the node
// as a data URL:
//
//   Load file…    a .ttf/.otf/.woff/.woff2 from disk, by click or drag-and-drop
//   Installed…    a font already on this machine, via the Local Font Access API
//
// Storing the bytes rather than a family name is what makes a patch portable. Patches are traded
// (ui/publish.js puts them in the gallery), and a name alone would render as a substitute typeface
// on anyone else's machine — silently, and differently for each of them. The cost is project size,
// which MAX_FONT_BYTES keeps to something a save file can carry.
//
// The actual FontFace registration lives in core/TextRasterizer.js, next to the drawing that needs
// it; this file only puts bytes on the node.

/** Fonts above this go in a save file as-is, so the ceiling is about what a project can carry. */
export const MAX_FONT_BYTES = 8 * 1024 * 1024;

const FONT_EXTENSIONS = /\.(ttf|otf|woff2?|ttc)$/i;

function isFontFile(file) {
  if (!file) return false;
  return /^font\//.test(file.type)
    || /application\/(x-)?font/.test(file.type)
    || FONT_EXTENSIONS.test(file.name || '');
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Strip the path and extension: "fonts/Inter-Bold.ttf" reads better as "Inter-Bold". */
function displayNameFor(fileName) {
  return String(fileName || 'Custom font').split(/[\\/]/).pop().replace(FONT_EXTENSIONS, '');
}

import { ACCENT, SEMANTIC, SURFACE, TEXT, FONT_MONO } from '../../core/theme.js';

export class FontInputHandler {
  constructor(undoManager = null) {
    this.undoManager = undoManager;
  }

  create(param, node, container, _label, valueManager, onUpdate) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-top: 4px;';

    const status = document.createElement('div');
    status.className = 'font-input-status';
    status.style.cssText = `font-size: 10px; color: ${TEXT.tertiary}; min-height: 13px;`;
    row.appendChild(status);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.ttf,.otf,.woff,.woff2,.ttc,font/*';
    fileInput.style.display = 'none';
    fileInput.setAttribute('data-param', param.name);
    fileInput.addEventListener('click', (e) => e.stopPropagation());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._applyFile(file, { node, param, valueManager, onUpdate, status });
    });

    const loadBtn = this._button('Load font file…');
    loadBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    buttons.appendChild(loadBtn);

    // Only offered where the browser can actually enumerate installed fonts; elsewhere the file
    // picker is the whole story and an inert button would just be a dead end.
    if (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function') {
      const localBtn = this._button('Installed…');
      localBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showInstalledFonts(row, localBtn, { node, param, valueManager, onUpdate, status });
      });
      buttons.appendChild(localBtn);
    }

    const clearBtn = this._button('Use default');
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._commit('', '', { node, param, valueManager, onUpdate, status });
    });
    buttons.appendChild(clearBtn);

    row.appendChild(buttons);
    row.appendChild(fileInput);
    this._setupDropZone(row, { node, param, valueManager, onUpdate, status });

    this._renderStatus(status, node);
    container.appendChild(row);
    return container;
  }

  _button(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.className = 'param-button';
    btn.style.cssText = `
      flex: 1 1 auto;
      padding: 5px 8px;
      background: ${SURFACE.fillSoft};
      color: ${TEXT.secondary};
      border: 1px solid ${SURFACE.line};
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background = SURFACE.hover; });
    btn.addEventListener('mouseleave', () => { btn.style.background = SURFACE.fillSoft; });
    return btn;
  }

  _renderStatus(status, node) {
    const name = node?.params?.fontName;
    if (name) {
      status.textContent = `✓ ${name}`;
      status.style.color = ACCENT.base;
    } else {
      status.textContent = 'Using the Font dropdown';
      status.style.color = TEXT.tertiary;
    }
  }

  _setupDropZone(row, ctx) {
    const highlight = (on) => {
      row.style.outline = on ? `1px dashed ${ACCENT.base}` : '';
      row.style.outlineOffset = on ? '3px' : '';
    };

    row.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); highlight(true); });
    row.addEventListener('dragleave', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!row.contains(e.relatedTarget)) highlight(false);
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      highlight(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isFontFile(file)) {
        this._fail(ctx.status, 'Not a font file');
        return;
      }
      this._applyFile(file, ctx);
    });
  }

  async _applyFile(file, ctx) {
    if (!isFontFile(file)) {
      this._fail(ctx.status, 'Not a font file');
      return;
    }
    if (file.size > MAX_FONT_BYTES) {
      this._fail(ctx.status, `Too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_FONT_BYTES / 1024 / 1024}MB)`);
      return;
    }

    ctx.status.textContent = 'Loading…';
    ctx.status.style.color = SEMANTIC.warn;
    try {
      const dataUrl = await readAsDataUrl(file);
      this._commit(displayNameFor(file.name), dataUrl, ctx);
    } catch {
      this._fail(ctx.status, 'Could not read that file');
    }
  }

  /**
   * List the machine's installed fonts inline, filtered as you type. Rendered into the panel rather
   * than a modal so it sits with the parameter it belongs to and closes by picking or by pressing
   * the button again.
   */
  async _showInstalledFonts(row, button, ctx) {
    const existing = row.querySelector('.installed-font-picker');
    if (existing) { existing.remove(); return; }

    let fonts;
    try {
      fonts = await window.queryLocalFonts();
    } catch {
      // The user declined the permission prompt, or the page isn't allowed to ask.
      this._fail(ctx.status, 'Permission to read installed fonts was denied');
      return;
    }
    if (!fonts?.length) {
      this._fail(ctx.status, 'No installed fonts reported');
      return;
    }

    const picker = document.createElement('div');
    picker.className = 'installed-font-picker';
    picker.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = `Filter ${fonts.length} fonts…`;
    search.className = 'param-input';
    search.style.cssText = `
      width: 100%; padding: 6px 8px; background: ${SURFACE.well}; color: ${TEXT.primary};
      border: 1px solid ${SURFACE.line}; border-radius: 8px; font-family: ${FONT_MONO};
      font-size: 11px; box-sizing: border-box;
    `;
    search.addEventListener('keydown', (e) => e.stopPropagation());

    const list = document.createElement('div');
    list.style.cssText = `
      max-height: 160px; overflow-y: auto; border: 1px solid ${SURFACE.line};
      border-radius: 8px; background: ${SURFACE.well};
    `;

    const render = () => {
      const filter = search.value.trim().toLowerCase();
      const matches = fonts
        .filter((f) => !filter || String(f.fullName || f.family).toLowerCase().includes(filter))
        .slice(0, 300);

      list.replaceChildren();
      for (const font of matches) {
        const item = document.createElement('div');
        item.textContent = font.fullName || font.family;
        item.title = font.postscriptName || '';
        item.style.cssText = `padding: 5px 7px; border-radius: 6px; font-size: 11px; color: ${TEXT.secondary}; cursor: pointer;`;
        item.addEventListener('mouseenter', () => { item.style.background = SURFACE.hover; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this._applyInstalledFont(font, ctx);
          picker.remove();
        });
        list.appendChild(item);
      }
    };

    search.addEventListener('input', render);
    render();

    picker.appendChild(search);
    picker.appendChild(list);
    row.appendChild(picker);
    search.focus();
  }

  /**
   * Take the installed font's actual bytes rather than just its name, so the patch renders the same
   * typeface on a machine that doesn't have it.
   */
  async _applyInstalledFont(font, ctx) {
    ctx.status.textContent = 'Loading…';
    ctx.status.style.color = SEMANTIC.warn;
    try {
      const blob = await font.blob();
      if (blob.size > MAX_FONT_BYTES) {
        this._fail(ctx.status, `Too large (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
        return;
      }
      const dataUrl = await readAsDataUrl(blob);
      this._commit(font.fullName || font.family, dataUrl, ctx);
    } catch {
      this._fail(ctx.status, 'Could not read that font');
    }
  }

  _commit(name, dataUrl, { node, param, valueManager, onUpdate, status }) {
    const oldName = node?.params?.fontName ?? '';
    if (this.undoManager && oldName !== name) {
      this.undoManager.recordParameterChange(node.id, 'fontName', oldName, name);
    }

    // fontData carries the bytes and fontName the label; both are plain parameters so they save,
    // load and undo like everything else. `param.name` is the one the panel is rendering (fontData)
    // and is written through the value manager so the node's refresh runs.
    if (!node.params) node.params = {};
    node.params.fontName = name;
    if (valueManager?.setValue) {
      valueManager.setValue(node, param.name, dataUrl);
    } else {
      node.params[param.name] = dataUrl;
    }

    this._renderStatus(status, node);
    onUpdate?.(name ? `Font: ${name}` : 'Font cleared');
  }

  _fail(status, message) {
    status.textContent = `✕ ${message}`;
    status.style.color = SEMANTIC.error;
  }
}
