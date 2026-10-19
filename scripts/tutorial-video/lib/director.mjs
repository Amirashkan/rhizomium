// The vocabulary scenes are written in. Every action moves a visible cursor at
// human speed, and `at(n)` holds an action back until the narrator reaches
// sentence n, which is what keeps picture and voice together.
//
// Nothing here throws into a scene: an action that cannot find its target logs
// a warning and the tour carries on, so one renamed button costs a few seconds
// of footage rather than a whole render.

const HEADER_H = 26; // src/core/pinLayout.js

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Director {
  constructor(page, clock, { log = console.log } = {}) {
    this.page = page;
    this.clock = clock; // () => seconds of video recorded
    this.log = log;
    this.mouse = { x: 960, y: 600 };
    this.scene = null;
    this.warnings = [];
  }

  // --- timing ---------------------------------------------------------------

  /** Called by the runner: sentence offsets are relative to `voiceAt`. */
  beginScene(scene, voiceAt, sentences) {
    this.scene = { ...scene, voiceAt, sentences };
  }

  /** Wait until the narrator starts sentence `n` (plus `offset` seconds). */
  async at(n, offset = 0) {
    const s = this.scene.sentences[Math.min(n, this.scene.sentences.length - 1)];
    const target = this.scene.voiceAt + (s ? s.start : 0) + offset;
    const wait = target - this.clock();
    if (wait > 0) await sleep(wait * 1000);
  }

  async wait(seconds) {
    await sleep(seconds * 1000);
  }

  async safe(label, fn) {
    try {
      return await fn();
    } catch (e) {
      const msg = `[${this.scene?.id}] ${label}: ${String(e.message || e).split('\n')[0]}`;
      this.warnings.push(msg);
      this.log(`    ! ${msg}`);
      return null;
    }
  }

  // --- pointer --------------------------------------------------------------

  /** Accepts {x,y}, a Playwright locator, or a CSS selector. */
  async point(target) {
    if (target && typeof target.x === 'number') return target;
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target;
    const box = await loc.boundingBox({ timeout: 4000 });
    if (!box) throw new Error(`not visible: ${target}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async move(target, ms) {
    const to = await this.point(target);
    const from = { ...this.mouse };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const dur = ms ?? Math.min(900, 250 + dist * 0.55);
    const steps = Math.max(2, Math.round(dur / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await this.page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      await sleep(dur / steps);
    }
    this.mouse = to;
    return to;
  }

  async click(target, { button = 'left', count = 1, settle = 250 } = {}) {
    return this.safe(`click ${describe(target)}`, async () => {
      const p = await this.move(target);
      await sleep(120);
      await this.page.mouse.click(p.x, p.y, { button, clickCount: count, delay: 60 });
      await sleep(settle);
    });
  }

  rightClick(target, opts) {
    return this.click(target, { ...opts, button: 'right' });
  }

  async dblclick(target, opts = {}) {
    return this.safe(`dblclick ${describe(target)}`, async () => {
      const p = await this.move(target);
      await sleep(120);
      await this.page.mouse.dblclick(p.x, p.y, { delay: 40 });
      await sleep(opts.settle ?? 400);
    });
  }

  async drag(from, to, { ms = 900 } = {}) {
    return this.safe('drag', async () => {
      await this.move(from);
      await sleep(120);
      await this.page.mouse.down();
      await sleep(80);
      await this.move(to, ms);
      await sleep(120);
      await this.page.mouse.up();
      await sleep(250);
    });
  }

  /** Pan the canvas with a middle-button drag. */
  async pan(dx, dy, from = { x: 1500, y: 700 }) {
    return this.safe('pan', async () => {
      await this.move(from);
      await this.page.mouse.down({ button: 'middle' });
      await this.move({ x: from.x + dx, y: from.y + dy }, 900);
      await this.page.mouse.up({ button: 'middle' });
      await sleep(250);
    });
  }

  /** Mouse-wheel zoom around a point, in gentle notches. */
  async zoom(target, notches) {
    return this.safe('zoom', async () => {
      await this.move(target);
      for (let i = 0; i < Math.abs(notches); i++) {
        await this.page.mouse.wheel(0, notches > 0 ? -100 : 100);
        await sleep(110);
      }
    });
  }

  // --- keyboard -------------------------------------------------------------

  async type(text, { delay = 55 } = {}) {
    await this.page.keyboard.type(text, { delay });
  }

  async key(combo, settle = 250) {
    await this.safe(`key ${combo}`, async () => {
      await this.page.keyboard.press(combo);
      await sleep(settle);
    });
  }

  // --- editor chrome --------------------------------------------------------

  /**
   * Open a top-level menu and pick an item by its visible label. With no item
   * the menu is left open, for the narration to walk through.
   */
  async menu(top, item, { hold = 700 } = {}) {
    const id = top.toLowerCase();
    return this.safe(`menu ${top} > ${item}`, async () => {
      await this.click(`#menu-${id}`);
      await sleep(hold);
      if (!item) return;
      const entry = this.page.locator(`#dropdown-${id} button:visible`, { hasText: item }).first();
      await this.click(entry, { settle: 300 });
      await this.closeMenus();
      await sleep(400);
    });
  }

  /** Close any open dropdown the way an outside click would. */
  async closeMenus() {
    await this.page.evaluate(() => {
      document.querySelectorAll('.menu-dropdown.show').forEach((d) => d.classList.remove('show'));
      document.querySelectorAll('.menu-button.active').forEach((b) => b.classList.remove('active'));
    });
  }

  /** Click a window's close button, if it has one, else press Escape. */
  async closeWindow(selector) {
    return this.safe(`close ${selector}`, async () => {
      const win = this.page.locator(selector).first();
      if (!(await win.isVisible())) return;
      const btn = win.locator('[aria-label="Close"], [title^="Close"], .close-btn, .vj-close-btn').first();
      if (await btn.count()) await this.click(btn, { settle: 400 });
      else await this.key('Escape', 400);
    });
  }

  // --- highlights & overlays -----------------------------------------------

  async highlight(target, label, { pad = 8 } = {}) {
    return this.safe(`highlight ${describe(target)}`, async () => {
      let rect;
      if (target && typeof target.width === 'number') rect = target;
      else {
        const loc = typeof target === 'string' ? this.page.locator(target).first() : target;
        await loc.waitFor({ state: 'visible', timeout: 4000 });
        rect = await loc.boundingBox();
      }
      if (!rect) throw new Error('nothing to highlight');
      await this.page.evaluate(([r, l, p]) => window.__tour.highlight(r, l, p), [rect, label, pad]);
    });
  }

  async clearHighlights() {
    await this.page.evaluate(() => window.__tour?.clearHighlights()).catch(() => {});
  }

  async chapter(num, title) {
    await this.page.evaluate(([n, t]) => window.__tour.chapter(n, t), [num, title]).catch(() => {});
  }

  async card(html) {
    await this.page.evaluate((h) => window.__tour.card(h), html).catch(() => {});
  }

  // --- graph geometry -------------------------------------------------------

  nodes() {
    return this.page.evaluate(() =>
      window.editor.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y, w: n.w })),
    );
  }

  async node(kind) {
    const all = await this.nodes();
    const hits = all.filter((n) => n.kind === kind);
    return hits[hits.length - 1] || null;
  }

  /** Graph space -> client pixels. */
  world(x, y) {
    return this.page.evaluate(([x, y]) => {
      const r = document.getElementById('ui-canvas').getBoundingClientRect();
      const v = window.editor.viewport;
      return { x: r.left + x * v.scale + v.offsetX, y: r.top + y * v.scale + v.offsetY };
    }, [x, y]);
  }

  /** Client pixels -> graph space. */
  toWorld(pt) {
    return this.page.evaluate(([x, y]) => {
      const r = document.getElementById('ui-canvas').getBoundingClientRect();
      const v = window.editor.viewport;
      return { x: (x - r.left - v.offsetX) / v.scale, y: (y - r.top - v.offsetY) / v.scale };
    }, [pt.x, pt.y]);
  }

  pin(id, dir, index = 0) {
    return this.page.evaluate(([id, dir, i]) => {
      const n = window.editor.graph.nodes.find((n) => n.id === id);
      const rd = window.editor.renderer;
      const p = dir === 'out' ? rd._getOutputPinPosition(n, i) : rd._getInputPinPosition(n, i);
      const r = document.getElementById('ui-canvas').getBoundingClientRect();
      const v = window.editor.viewport;
      return { x: r.left + p.x * v.scale + v.offsetX, y: r.top + p.y * v.scale + v.offsetY };
    }, [id, dir, index]);
  }

  /** A point on the node's body: below the header, clear of the pins. */
  async body(id, dy = 40) {
    const n = (await this.nodes()).find((n) => n.id === id);
    return this.world(n.x + (n.w || 180) / 2, n.y + HEADER_H + dy);
  }

  async title(id) {
    const n = (await this.nodes()).find((n) => n.id === id);
    return this.world(n.x + 40, n.y + HEADER_H / 2);
  }

  /** Bounding rect of a node in client pixels (approximate height). */
  async nodeRect(id, h = 260) {
    const n = (await this.nodes()).find((n) => n.id === id);
    const a = await this.world(n.x, n.y);
    const b = await this.world(n.x + (n.w || 180), n.y + h);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  }

  // --- graph actions --------------------------------------------------------

  /**
   * Right-click at `where` (client px), search the palette for `query` and
   * place the highlighted result. Returns the new node's id.
   */
  async addNode(query, where, { pick = 0 } = {}) {
    return this.safe(`add node "${query}"`, async () => {
      const before = new Set((await this.nodes()).map((n) => n.id));
      await this.rightClick(where, { settle: 500 });
      await this.page.locator('.rz-palette-input').waitFor({ state: 'visible', timeout: 4000 });
      await this.type(query, { delay: 85 });
      await sleep(450);
      for (let i = 0; i < pick; i++) await this.key('ArrowDown', 200);
      await this.key('Enter', 700);
      const added = (await this.nodes()).find((n) => !before.has(n.id));
      if (!added) throw new Error('palette placed nothing');
      return added.id;
    });
  }

  async wire(fromId, outIndex, toId, inIndex) {
    if (!fromId || !toId) return null;
    return this.safe(`wire ${fromId}->${toId}`, async () => {
      const a = await this.pin(fromId, 'out', outIndex);
      const b = await this.pin(toId, 'in', inIndex);
      await this.drag(a, b);
    });
  }

  /** Open a node's parameter panel. */
  async openParams(id) {
    if (!id) return null;
    return this.dblclick(await this.body(id), { settle: 700 });
  }

  /** A parameter's block in the open panel: label, field, value and range. */
  paramBlock(label) {
    return this.page
      .locator('.parameter-panel .parameter-container')
      .filter({ has: this.page.locator('.parameter-label', { hasText: new RegExp(`^\\s*${label}`, 'i') }) })
      .first();
  }

  paramField(label) {
    return this.paramBlock(label).locator('.param-input').first();
  }

  async setParam(label, value) {
    return this.safe(`set ${label}`, async () => {
      const field = this.paramField(label);
      await this.click(field, { settle: 200 });
      await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await this.type(value, { delay: 70 });
      await this.key('Enter', 500);
    });
  }

  /** Programmatic graph edits for set-up the viewer needn't watch. */
  async loadStarter(name) {
    return this.safe(`starter ${name}`, async () => {
      await this.menu('Help', 'Welcome');
      await this.click(this.page.getByText(name, { exact: true }).first(), { settle: 2500 });
    });
  }

  async frameAll() {
    await this.click({ x: 1500, y: 980 }, { settle: 100 });
    await this.key('f', 600);
  }
}

function describe(t) {
  if (!t) return String(t);
  if (typeof t === 'string') return t;
  if (typeof t.x === 'number') return `(${Math.round(t.x)},${Math.round(t.y)})`;
  return 'locator';
}
