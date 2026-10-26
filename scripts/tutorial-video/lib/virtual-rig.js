// A multi-screen rig for recordings made in the browser, on a machine with one
// monitor. Run in the page (page.evaluate) after the editor has loaded.
//
// The editor only builds its screens panel in the desktop app, where each screen
// is a real fullscreen OS window. This builds the same panel (src/ui/ScreensPanel.js)
// on the same model (src/screens/ScreenModel.js), answers its display list with
// the displays below, wires View > Open Output and View > Output Screens the way
// main.js does, and draws each switched-on screen as a small on-screen display
// fed from the live render: its region of the composition, letterboxed into the
// display, feathered by the projection mapping's soft edge the way
// src/mapping/MappingCompositor.js feathers a surface.
//
//   window.__rig.show(on)       the simulated displays
//   window.__rig.wall(on)       also draw the beams overlapping on one wall
//   window.__rig.paid = false   answer the entitlement gate as a free account
export async function installVirtualRig({ displays, at = { right: 24, bottom: 24 }, width = 1000 }) {
  if (window.__rig) return;
  const { ScreenModel, DISPLAY_AUTO } = await import('/src/screens/ScreenModel.js');
  const { getScreensPanel } = await import('/src/ui/ScreensPanel.js');
  const { getOutputAspect } = await import('/src/ui/OutputFormat.js');

  const rig = { paid: true, visible: false, showWall: false };
  window.__rig = rig;

  const model = new ScreenModel();
  window.screenModel = model;
  if (window.editor) window.editor.screenModel = model;

  const panel = getScreensPanel(model, {
    onStatus: (message, kind) => window.updateStatus?.(message, kind),
    canUseMultiScreen: () => rig.paid,
    getCompositionAspect: () => getOutputAspect(),
  });
  panel.displays = displays;
  panel._refreshDisplays = async () => {};
  window.screensPanel = panel;

  // View menu, as main.js wires it in the desktop build.
  const outBtn = document.getElementById('btn-second-monitor');
  const screensBtn = document.getElementById('btn-output-screens');
  document.getElementById('sep-second-monitor')?.style.removeProperty('display');
  outBtn?.style.removeProperty('display');
  screensBtn?.style.removeProperty('display');
  const syncButton = () => {
    if (!outBtn) return;
    const count = model.enabledScreens().length;
    const many = count > 1 ? ` (${count} screens)` : '';
    outBtn.textContent = count ? `Close Output${many}` : `Open Output${many}`;
    outBtn.style.backgroundColor = count ? 'rgba(0, 170, 0, 0.8)' : '';
    outBtn.style.borderColor = count ? 'rgba(0, 255, 0, 0.4)' : '';
  };
  outBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const screens = model.list();
    if (!screens.length) { model.ensureMain(); return; }
    const turningOff = model.enabledScreens().length > 0;
    if (!turningOff && !rig.paid) return;
    for (const s of screens) model.update(s.id, { enabled: !turningOff });
  });
  screensBtn?.addEventListener('click', (e) => { e.preventDefault(); panel.toggle(); });

  model.onChange(() => syncButton());
  syncButton();

  // --- the simulated displays ----------------------------------------------

  const box = document.createElement('div');
  box.id = 'virtual-rig';
  box.style.cssText = `position: fixed; right: ${at.right}px; bottom: ${at.bottom}px; z-index: 99990;
    display: none; padding: 30px 16px 14px; border-radius: 12px; width: ${width}px; box-sizing: border-box;
    background: rgba(14, 12, 10, 0.94); border: 1px solid rgba(255, 244, 230, 0.12);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); pointer-events: none;`;
  const title = document.createElement('div');
  title.textContent = 'Displays (simulated on this one monitor)';
  title.style.cssText = 'position: absolute; top: 9px; left: 16px; color: #8f867a; font: 600 12px system-ui, sans-serif;';
  box.appendChild(title);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display: block; width: 100%;';
  box.appendChild(canvas);
  document.body.appendChild(box);
  const g = canvas.getContext('2d');

  const COLORS = ['#c6f24e', '#4ed8f2', '#f24ea8', '#f2b84e', '#a78bfa', '#4ef2a0'];
  const smooth = (e, x) => { const t = Math.min(1, Math.max(0, x / e)); return t * t * (3 - 2 * t); };
  const masks = new Map();
  /** Alpha that fades in from every edge, as the compositor's uSoftEdge does. */
  function mask(w, h, soft) {
    const key = `${w}x${h}@${soft}`;
    if (masks.has(key)) return masks.get(key);
    const c = new OffscreenCanvas(w, h);
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const qy = (y + 0.5) / h;
      const ay = smooth(soft, qy) * smooth(soft, 1 - qy);
      for (let x = 0; x < w; x++) {
        const qx = (x + 0.5) / w;
        img.data[(y * w + x) * 4 + 3] = Math.round(255 * ay * smooth(soft, qx) * smooth(soft, 1 - qx));
      }
    }
    c.getContext('2d').putImageData(img, 0, 0);
    if (masks.size > 24) masks.clear();
    masks.set(key, c);
    return c;
  }
  const scratch = new OffscreenCanvas(16, 16);
  const sg = scratch.getContext('2d');

  /** Draw a region of the source into a rect, feathered if the mapping says so. */
  function beam(ctx, src, r, dx, dy, dw, dh, soft, op) {
    const sw = src.width;
    const sh = src.height;
    const w = Math.max(1, Math.round(dw));
    const h = Math.max(1, Math.round(dh));
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, w, h);
    sg.drawImage(src, r.x * sw, r.y * sh, r.w * sw, r.h * sh, 0, 0, w, h);
    if (soft > 0) {
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(mask(w, h, soft), 0, 0);
    }
    ctx.globalCompositeOperation = op;
    ctx.drawImage(scratch, Math.round(dx), Math.round(dy));
    ctx.globalCompositeOperation = 'source-over';
  }

  function softEdge() {
    const m = window.mappingModel;
    if (!m?.enabled) return 0;
    const s = m.surfaces.find((x) => x.enabled);
    return s ? s.softEdge : 0;
  }

  /** Which display each screen lands on: explicit picks first, then Auto in order. */
  function assign(screens) {
    const claimed = new Set(screens.map((s) => s.displayIndex).filter((i) => i >= 0));
    claimed.add(0); // the editor's own display
    const out = new Map();
    for (const s of screens) {
      if (s.displayIndex !== DISPLAY_AUTO) { out.set(s.id, s.displayIndex); continue; }
      let i = 0;
      while (claimed.has(i) && i < displays.length) i++;
      if (i < displays.length) { claimed.add(i); out.set(s.id, i); } else out.set(s.id, -1);
    }
    return out;
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!rig.visible) return;
    const src = document.getElementById('gpu-canvas');
    const all = model.list();
    const on = model.enabledScreens();
    const soft = softEdge();
    const where = assign(all);
    const W = width - 32;
    const label = 24;
    const gap = 18;

    // Displays, in rows by where their region sits.
    const rows = [];
    for (const s of all) {
      const y = Math.round(s.region.y * 20);
      let row = rows.find((r) => r.y === y);
      if (!row) rows.push(row = { y, items: [] });
      row.items.push(s);
    }
    rows.sort((a, b) => a.y - b.y);
    rows.forEach((r) => r.items.sort((a, b) => a.region.x - b.region.x));
    const perRow = Math.max(1, ...rows.map((r) => r.items.length));
    const bw = Math.min(300, (W - gap * (perRow - 1)) / perRow);
    const bh = bw * 9 / 16;
    const dispH = rows.length ? rows.length * (bh + label) + (rows.length - 1) * 10 : 60;
    const aspect = getOutputAspect() || 16 / 9;
    const wallW = W;
    const wallH = rig.showWall ? Math.min(220, wallW / aspect) : 0;
    const H = dispH + (rig.showWall ? wallH + label + 26 : 0);
    if (canvas.width !== W || canvas.height !== Math.round(H)) { canvas.width = W; canvas.height = Math.round(H); }
    g.clearRect(0, 0, W, H);
    g.font = '600 12px system-ui, sans-serif';
    g.textBaseline = 'top';

    if (!all.length) {
      g.fillStyle = '#8f867a';
      g.fillText('No output screens', 0, 20);
      return;
    }

    rows.forEach((row, ri) => {
      const rowW = row.items.length * bw + (row.items.length - 1) * gap;
      row.items.forEach((s, i) => {
        const x = (W - rowW) / 2 + i * (bw + gap);
        const y = ri * (bh + label + 10);
        const idx = all.indexOf(s);
        g.fillStyle = '#050403';
        g.fillRect(x, y, bw, bh);
        const live = s.enabled;
        if (live && src && src.width) {
          // The crop, letterboxed into the display so its shape never changes.
          const cropA = aspect * s.region.w / s.region.h;
          let cw = bw;
          let ch = bw / cropA;
          if (ch > bh) { ch = bh; cw = bh * cropA; }
          beam(g, src, s.region, x + (bw - cw) / 2, y + (bh - ch) / 2, cw, ch, soft, 'source-over');
        } else {
          g.fillStyle = '#5c554b';
          g.fillText(s.enabled ? '' : 'off', x + bw / 2 - 8, y + bh / 2 - 6);
        }
        g.strokeStyle = s.enabled ? COLORS[idx % 6] : '#3a342c';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
        const d = where.get(s.id);
        const dn = d >= 0 && displays[d] ? displays[d].name : 'no display';
        g.fillStyle = s.enabled ? '#f3ede4' : '#6d655a';
        g.fillText(s.name, x, y + bh + 6);
        g.fillStyle = '#8f867a';
        const t = `→ ${dn}`;
        g.fillText(t, x + bw - g.measureText(t).width, y + bh + 6);
      });
    });

    if (rig.showWall) {
      const y0 = dispH + 26;
      g.fillStyle = '#f3ede4';
      g.fillText('On the wall: every beam where it lands', 0, y0);
      const wy = y0 + label;
      const ww = wallH * aspect;
      const wx = (W - ww) / 2;
      g.fillStyle = '#000';
      g.fillRect(wx, wy, ww, wallH);
      if (src && src.width) {
        for (const s of on) {
          const r = s.region;
          beam(g, src, r, wx + r.x * ww, wy + r.y * wallH, r.w * ww, r.h * wallH, soft, 'lighter');
        }
      }
      on.forEach((s) => {
        const r = s.region;
        g.strokeStyle = COLORS[all.indexOf(s) % 6];
        g.setLineDash([5, 4]);
        g.lineWidth = 1.5;
        g.strokeRect(wx + r.x * ww + 1, wy + r.y * wallH + 1, r.w * ww - 2, r.h * wallH - 2);
        g.setLineDash([]);
      });
    }
  }
  requestAnimationFrame(draw);

  rig.show = (v = true) => { rig.visible = v; box.style.display = v ? 'block' : 'none'; };
  rig.wall = (v = true) => { rig.showWall = v; };
  rig.model = model;
  rig.panel = panel;
}
