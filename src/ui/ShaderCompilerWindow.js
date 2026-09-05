// src/ui/ShaderCompilerWindow.js
//
// Tools → Shader Tools → Shader Compiler.
//
// The WGSL console (View → Show Console) prints the text of the shader the last
// build produced. This window is the other half of that story: it compiles the
// graph as it stands right now, hands the source to the GPU driver, and shows
// what the driver said about it — line by line.
//
// Three things it is careful about:
//
//   • It compiles what the graph says, not what the canvas happens to be
//     showing. Pressing Compile re-runs buildWGSL, so a shader the renderer
//     refused to swap in is still inspectable here.
//   • It shows the source even when there is no GPU device, and says so. A
//     missing adapter is a reason to stop compiling, not a reason to show an
//     empty window.
//   • Compute nodes each carry their own compute shader, and those are what
//     usually go wrong. They are listed alongside the fragment shader rather
//     than hidden behind it.
//
// The pure halves — target discovery, statistics, diagnostics, highlighting,
// the compile call itself — are exported so they can be tested without a GPU.

import { buildWGSL } from '../codegen/glslBuilder.js';
import { nodeDisplayName } from '../core/nodeName.js';
import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';

/** The id of the one target that always exists: the main output's shader. */
export const FRAGMENT_TARGET_ID = 'fragment';

/** How long a burst of graph edits is allowed to settle before recompiling. */
const FOLLOW_DELAY_MS = 150;

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/**
 * Compile the graph to the fragment shader, and say why when there isn't one.
 *
 * An empty result is the normal state of a half-built patch rather than a
 * failure, so it comes back as a note the window can print instead of an error.
 *
 * @param {Object|null} graph
 * @param {Function} [build] - buildWGSL, injectable for tests.
 * @returns {{ code: string, note: string, failed: boolean }}
 */
export function buildFragmentWGSL(graph, build = buildWGSL) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { code: '', note: 'The canvas is empty. Add a node and wire it into the output.', failed: false };
  }

  try {
    const result = build(graph);
    const code = typeof result === 'string' ? result : String(result?.wgsl ?? '');
    if (!code.trim()) {
      return {
        code: '',
        note: 'Nothing reaches the output yet — wire a node into OutputFinal to get a fragment shader.',
        failed: false,
      };
    }
    return { code, note: '', failed: false };
  } catch (error) {
    return {
      code: '',
      note: `The graph could not be turned into WGSL: ${error?.message || error}`,
      failed: true,
    };
  }
}

/**
 * Every shader this patch produces: the fragment shader first, then one entry
 * per compute node the last build registered.
 *
 * The compute registry is populated by buildWGSL, so this is only complete
 * after a build — which is exactly when the window asks for it.
 *
 * @param {Object|null} graph
 * @param {Map|null} registry - window.computeNodeRegistry
 * @returns {Array<{id: string, kind: string, label: string, key?: string}>}
 */
export function shaderTargets(graph, registry) {
  const targets = [{ id: FRAGMENT_TARGET_ID, kind: 'fragment', label: 'Fragment — main output' }];

  if (!registry || typeof registry.forEach !== 'function') return targets;

  const compute = [];
  const seen = new Map();
  registry.forEach((entry, key) => {
    const node = entry?.node;
    const code = entry?.wgslCode;
    if (!node || typeof code !== 'string' || !code.trim()) return;
    const label = `${nodeDisplayName(node)} — compute`;
    seen.set(label, (seen.get(label) || 0) + 1);
    compute.push({ id: `compute:${key}`, kind: 'compute', key: String(key), label, nodeId: String(node.id) });
  });

  // Two untitled compute nodes of the same kind carry the same name, and a
  // dropdown with two identical rows is a coin toss. The node id only earns
  // its place in the label when there is something to tell apart.
  for (const target of compute) {
    if (seen.get(target.label) > 1) target.label = `${target.label} #${target.nodeId}`;
  }

  // Registry order is build order, which shuffles as the graph is rewired; a
  // stable alphabetical list keeps the dropdown from reordering under the
  // cursor between compiles.
  compute.sort((a, b) => a.label.localeCompare(b.label));
  return targets.concat(compute);
}

/**
 * The WGSL for one target.
 *
 * @param {Object} target - an entry from {@link shaderTargets}
 * @param {{fragment: {code: string, note: string}, registry: Map|null}} sources
 * @returns {{ code: string, note: string }}
 */
export function sourceForTarget(target, { fragment, registry }) {
  if (!target || target.kind === 'fragment') {
    return { code: fragment?.code || '', note: fragment?.note || '' };
  }
  const entry = registry?.get?.(target.key);
  const code = typeof entry?.wgslCode === 'string' ? entry.wgslCode : '';
  if (!code) {
    return { code: '', note: 'That compute node is no longer in the graph.' };
  }
  return { code, note: '' };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * The handful of numbers worth printing under a shader: how long it is, how
 * much of the binding budget it spends, and how many parameter uniforms the
 * graph pushed into it.
 *
 * @param {string} code
 */
export function wgslStats(code) {
  const source = typeof code === 'string' ? code : '';
  if (!source) {
    return { lines: 0, bytes: 0, bindings: 0, functions: 0, uniforms: 0 };
  }

  const paramStruct = /struct\s+ParamUniforms\s*\{([\s\S]*?)\}/.exec(source);
  const uniforms = paramStruct
    ? paramStruct[1].split('\n').filter((line) => /\w+\s*:\s*\w/.test(line)).length
    : 0;

  return {
    lines: source.split('\n').length,
    bytes: source.length,
    bindings: (source.match(/@group\s*\(\s*\d+\s*\)\s*@binding/g) || []).length,
    functions: (source.match(/^\s*fn\s+\w+/gm) || []).length,
    uniforms,
  };
}

/** "412 lines · 9 bindings · 14 functions · 6 uniforms · 11.2 KB" */
export function statsLine(stats) {
  if (!stats || !stats.lines) return 'No source';
  const parts = [
    `${stats.lines} ${stats.lines === 1 ? 'line' : 'lines'}`,
    `${stats.bindings} ${stats.bindings === 1 ? 'binding' : 'bindings'}`,
    `${stats.functions} ${stats.functions === 1 ? 'function' : 'functions'}`,
  ];
  if (stats.uniforms) {
    parts.push(`${stats.uniforms} ${stats.uniforms === 1 ? 'uniform' : 'uniforms'}`);
  }
  parts.push(stats.bytes < 1024 ? `${stats.bytes} B` : `${(stats.bytes / 1024).toFixed(1)} KB`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** GPUCompilationMessage is a host object; copy the fields we print off it. */
function normalizeMessages(messages) {
  if (!messages || typeof messages.length !== 'number') return [];
  return Array.from(messages, (msg) => ({
    type: msg?.type === 'error' || msg?.type === 'warning' ? msg.type : 'info',
    message: String(msg?.message ?? ''),
    lineNum: Number(msg?.lineNum) || 0,
    linePos: Number(msg?.linePos) || 0,
  })).sort((a, b) => a.lineNum - b.lineNum || a.linePos - b.linePos);
}

/**
 * Hand one shader to the driver and collect its verdict.
 *
 * A WGSL module that fails to compile does NOT throw — the messages come back
 * through getCompilationInfo() — so the error scope is what catches the rest
 * (a lost device, a module the implementation rejects outright).
 *
 * @param {GPUDevice|null} device
 * @param {string} code
 * @param {string} [label]
 * @returns {Promise<{status: 'ok'|'error'|'empty'|'unavailable', messages: Array, durationMs: number}>}
 */
export async function compileShader(device, code, label = 'shader-compiler') {
  const source = typeof code === 'string' ? code : '';
  if (!source.trim()) return { status: 'empty', messages: [], durationMs: 0 };
  if (!device || typeof device.createShaderModule !== 'function') {
    return { status: 'unavailable', messages: [], durationMs: 0 };
  }

  const started = nowMs();
  let scopePushed = false;
  try {
    if (typeof device.pushErrorScope === 'function') {
      device.pushErrorScope('validation');
      scopePushed = true;
    }

    const module = device.createShaderModule({ code: source, label });

    // Closed immediately, before anything is awaited. An error scope catches
    // every validation error the DEVICE raises while it is open, and the render
    // loop is submitting frames on that same device — held open across the
    // await below, this scope reports the frame's complaints as if they were
    // this shader's.
    const scopeResult = scopePushed ? device.popErrorScope() : null;
    scopePushed = false;

    const info = typeof module?.getCompilationInfo === 'function'
      ? await module.getCompilationInfo()
      : { messages: [] };
    const messages = normalizeMessages(info?.messages);

    const scoped = scopeResult ? await scopeResult : null;
    // Only worth adding when the messages missed it: an invalid module
    // reports through both channels, and printing it twice reads as two bugs.
    if (scoped && !messages.some((m) => m.type === 'error')) {
      messages.push({ type: 'error', message: String(scoped.message ?? scoped), lineNum: 0, linePos: 0 });
    }

    return {
      status: messages.some((m) => m.type === 'error') ? 'error' : 'ok',
      messages,
      durationMs: nowMs() - started,
    };
  } catch (error) {
    // A pushed scope that is never popped leaks onto the next compile, which
    // would then report this failure instead of its own.
    if (scopePushed) {
      try {
        await device.popErrorScope();
      } catch { /* the device is gone; the scope went with it */ }
    }
    return {
      status: 'error',
      messages: [{ type: 'error', message: String(error?.message || error), lineNum: 0, linePos: 0 }],
      durationMs: nowMs() - started,
    };
  }
}

/** Counts by severity, for the badge and the diagnostics heading. */
export function diagnosticSummary(messages) {
  const counts = { errors: 0, warnings: 0, infos: 0 };
  for (const msg of messages || []) {
    if (msg?.type === 'error') counts.errors += 1;
    else if (msg?.type === 'warning') counts.warnings += 1;
    else counts.infos += 1;
  }
  return counts;
}

/** The one line under the toolbar: what happened, and how long it took. */
export function resultSummary(result) {
  if (!result) return { state: 'idle', text: 'Not compiled yet' };

  const { errors, warnings } = diagnosticSummary(result.messages);
  const took = result.durationMs ? ` in ${result.durationMs.toFixed(1)} ms` : '';

  if (result.status === 'empty') return { state: 'idle', text: 'Nothing to compile' };
  if (result.status === 'unavailable') {
    return { state: 'idle', text: 'No GPU device — showing the source without compiling it' };
  }
  if (result.status === 'error') {
    const noun = errors === 1 ? 'error' : 'errors';
    return { state: 'error', text: `Failed${took} — ${errors} ${noun}` };
  }
  if (warnings) {
    const noun = warnings === 1 ? 'warning' : 'warnings';
    return { state: 'warn', text: `Compiled${took} — ${warnings} ${noun}` };
  }
  return { state: 'ok', text: `Compiled${took}` };
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  'alias', 'break', 'case', 'const', 'continue', 'continuing', 'default', 'discard',
  'else', 'enable', 'false', 'fn', 'for', 'if', 'let', 'loop', 'override', 'return',
  'struct', 'switch', 'true', 'type', 'var', 'while',
]);

const TYPES = new Set([
  'array', 'atomic', 'bool', 'f16', 'f32', 'i32', 'mat2x2', 'mat2x3', 'mat2x4',
  'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4', 'ptr', 'sampler',
  'sampler_comparison', 'texture_1d', 'texture_2d', 'texture_2d_array', 'texture_3d',
  'texture_cube', 'texture_external', 'texture_storage_1d', 'texture_storage_2d',
  'texture_storage_3d', 'u32', 'vec2', 'vec2f', 'vec3', 'vec3f', 'vec4', 'vec4f',
]);

function escapeHTML(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(kind, text) {
  return `<span class="rz-sc-${kind}">${escapeHTML(text)}</span>`;
}

/**
 * Colour one line of WGSL, carrying block-comment state across lines.
 *
 * Deliberately a hand-rolled single pass rather than layered regex replaces:
 * replacing inside already-emitted markup is how a highlighter starts colouring
 * its own `<span>`s.
 *
 * @returns {{ html: string, inBlock: boolean }}
 */
export function highlightLine(line, inBlock = false) {
  const text = String(line ?? '');
  let html = '';
  let i = 0;
  let block = inBlock;

  while (i < text.length) {
    if (block) {
      const end = text.indexOf('*/', i);
      if (end === -1) {
        html += span('comment', text.slice(i));
        i = text.length;
      } else {
        html += span('comment', text.slice(i, end + 2));
        i = end + 2;
        block = false;
      }
      continue;
    }

    const rest = text.slice(i);

    if (rest.startsWith('//')) {
      html += span('comment', rest);
      break;
    }
    if (rest.startsWith('/*')) {
      block = true;
      continue;
    }

    const attribute = /^@[A-Za-z_]\w*/.exec(rest);
    if (attribute) {
      html += span('attr', attribute[0]);
      i += attribute[0].length;
      continue;
    }

    const word = /^[A-Za-z_]\w*/.exec(rest);
    if (word) {
      const token = word[0];
      const kind = KEYWORDS.has(token) ? 'kw' : TYPES.has(token) ? 'ty' : null;
      html += kind ? span(kind, token) : escapeHTML(token);
      i += token.length;
      continue;
    }

    const number = /^\d[\w.]*/.exec(rest);
    if (number) {
      html += span('num', number[0]);
      i += number[0].length;
      continue;
    }

    html += escapeHTML(text[i]);
    i += 1;
  }

  return { html, inBlock: block };
}

/** One HTML string per source line, ready to drop into the code view. */
export function highlightWGSL(code) {
  const lines = String(code ?? '').split('\n');
  let inBlock = false;
  return lines.map((line) => {
    const result = highlightLine(line, inBlock);
    inBlock = result.inBlock;
    return result.html;
  });
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export class ShaderCompilerWindow {
  constructor() {
    this.panel = null;
    this.visible = false;
    this.targetId = FRAGMENT_TARGET_ID;
    this.targets = [];
    this.fragment = { code: '', note: '' };
    this.source = '';
    this.result = null;
    this.follow = true;

    this._compileToken = 0;
    this._followTimer = null;
    this._cleanupDraggable = null;
    this._onGraphBuilt = () => this._scheduleFollowCompile();
    this._onDocKey = (event) => {
      if (event.key !== 'Escape' || !this.visible) return;
      if (!this.panel?.contains(event.target)) return;
      event.stopPropagation();
      this.hide();
    };
  }

  // --- construction -------------------------------------------------------

  _build() {
    const panel = document.createElement('div');
    panel.id = 'shader-compiler-window';
    panel.className = 'rz-sc';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Shader Compiler');

    panel.innerHTML = `
      <div class="rz-sc-header">
        <h3 class="rz-sc-title">Shader Compiler</h3>
        <span class="rz-sc-badge" data-state="idle">Not compiled</span>
        <button class="rz-sc-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="rz-sc-toolbar">
        <select class="rz-sc-target" aria-label="Shader to compile"></select>
        <button class="rz-sc-btn rz-sc-primary rz-sc-compile" type="button">Compile</button>
        <span class="rz-sc-spacer"></span>
        <label class="rz-sc-follow"><input class="rz-sc-follow-input" type="checkbox" checked /> Follow graph</label>
        <button class="rz-sc-btn rz-sc-copy" type="button">Copy</button>
        <button class="rz-sc-btn rz-sc-save" type="button">Save .wgsl</button>
      </div>
      <div class="rz-sc-status"><span class="rz-sc-status-text">Not compiled yet</span></div>
      <div class="rz-sc-code" tabindex="0" role="group" aria-label="Generated WGSL"></div>
      <div class="rz-sc-diagnostics"></div>
      <div class="rz-sc-footer"><span class="rz-sc-stats">No source</span></div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    this.badgeEl = panel.querySelector('.rz-sc-badge');
    this.targetEl = panel.querySelector('.rz-sc-target');
    this.statusEl = panel.querySelector('.rz-sc-status-text');
    this.codeEl = panel.querySelector('.rz-sc-code');
    this.diagnosticsEl = panel.querySelector('.rz-sc-diagnostics');
    this.statsEl = panel.querySelector('.rz-sc-stats');
    this.followEl = panel.querySelector('.rz-sc-follow-input');

    panel.querySelector('.rz-sc-close').addEventListener('click', () => this.hide());
    panel.querySelector('.rz-sc-compile').addEventListener('click', () => this.compile());
    panel.querySelector('.rz-sc-copy').addEventListener('click', () => this._copy());
    panel.querySelector('.rz-sc-save').addEventListener('click', () => this._save());

    this.targetEl.addEventListener('change', () => {
      this.targetId = this.targetEl.value;
      this.compile();
    });

    this.followEl.addEventListener('change', () => {
      this.follow = this.followEl.checked;
      if (this.follow) this._scheduleFollowCompile();
    });

    this._cleanupDraggable = makeDraggable(panel, panel.querySelector('.rz-sc-header'));
    // Sized from any edge: the code view is the whole point of this window and
    // a long line or a deep listing is read by giving it more room.
    this._cleanupResizable = makeResizable(panel, { minWidth: 420, minHeight: 280 });
  }

  // --- lifecycle ----------------------------------------------------------

  show() {
    if (!this.panel) this._build();
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('rz-sc-open');
    window.addEventListener('rz:shader-built', this._onGraphBuilt);
    document.addEventListener('keydown', this._onDocKey, true);
    this.compile();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.panel?.classList.remove('rz-sc-open');
    window.removeEventListener('rz:shader-built', this._onGraphBuilt);
    document.removeEventListener('keydown', this._onDocKey, true);
    if (this._followTimer) {
      clearTimeout(this._followTimer);
      this._followTimer = null;
    }
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible() {
    return this.visible;
  }

  dispose() {
    this.hide();
    if (this._cleanupDraggable) this._cleanupDraggable();
    this._cleanupDraggable = null;
    if (this._cleanupResizable) this._cleanupResizable();
    this._cleanupResizable = null;
    if (this.panel?.parentNode) this.panel.parentNode.removeChild(this.panel);
    this.panel = null;
  }

  // --- compiling ----------------------------------------------------------

  _scheduleFollowCompile() {
    if (!this.visible || !this.follow) return;
    // An artist dragging a parameter rebuilds the graph on every frame. One
    // compile per settled edit is the point; one per frame is a second render
    // loop nobody asked for.
    if (this._followTimer) clearTimeout(this._followTimer);
    this._followTimer = setTimeout(() => {
      this._followTimer = null;
      this.compile();
    }, FOLLOW_DELAY_MS);
  }

  /**
   * Rebuild the graph's shaders, show the selected one, and compile it.
   * @returns {Promise<Object>} the compile result, for tests and callers
   */
  async compile() {
    if (!this.panel) this._build();

    const graph = window.editor?.graph || null;
    this.fragment = buildFragmentWGSL(graph);
    // buildWGSL is what fills the compute registry, so the targets are only
    // trustworthy after that call above.
    this.targets = shaderTargets(graph, window.computeNodeRegistry);
    if (!this.targets.some((t) => t.id === this.targetId)) {
      this.targetId = FRAGMENT_TARGET_ID;
    }
    this._renderTargets();

    const target = this.targets.find((t) => t.id === this.targetId) || this.targets[0];
    const { code, note } = sourceForTarget(target, {
      fragment: this.fragment,
      registry: window.computeNodeRegistry,
    });
    this.source = code;
    this._renderCode(code, note);

    const token = ++this._compileToken;
    const device = window.gpuRenderer?.device || null;
    const result = await compileShader(device, code, `shader-compiler:${target?.id || 'fragment'}`);

    // A later compile started while this one was in the driver: its answer is
    // the one on screen, and this one is about a shader nobody is looking at.
    if (token !== this._compileToken) return result;

    this.result = result;
    this._renderResult(result, note);
    return result;
  }

  // --- rendering ----------------------------------------------------------

  /** Called only from compile(), which has already settled on a live target. */
  _renderTargets() {
    this.targetEl.replaceChildren();
    for (const target of this.targets) {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = target.label;
      this.targetEl.appendChild(option);
    }
    this.targetEl.value = this.targetId;
  }

  _renderCode(code, note) {
    if (!code) {
      const empty = document.createElement('div');
      empty.className = 'rz-sc-empty';
      empty.textContent = note || 'No source for this shader.';
      this.codeEl.replaceChildren(empty);
      this.statsEl.textContent = statsLine(wgslStats(''));
      return;
    }

    const fragment = document.createDocumentFragment();
    highlightWGSL(code).forEach((html, index) => {
      const row = document.createElement('div');
      row.className = 'rz-sc-line';
      row.dataset.line = String(index + 1);

      const gutter = document.createElement('span');
      gutter.className = 'rz-sc-ln';
      gutter.textContent = String(index + 1);

      const source = document.createElement('code');
      source.className = 'rz-sc-src';
      source.innerHTML = html;

      row.append(gutter, source);
      fragment.appendChild(row);
    });

    this.codeEl.replaceChildren(fragment);
    this.codeEl.scrollTop = 0;
    this.statsEl.textContent = statsLine(wgslStats(code));
  }

  _renderResult(result, note) {
    const summary = resultSummary(result);
    this.statusEl.textContent = note && result.status === 'empty' ? note : summary.text;
    this.badgeEl.dataset.state = summary.state;
    this.badgeEl.textContent = {
      ok: 'Compiled', warn: 'Warnings', error: 'Errors', idle: 'Idle',
    }[summary.state];

    for (const row of this.codeEl.querySelectorAll('.rz-sc-line')) {
      row.classList.remove('rz-sc-has-error', 'rz-sc-has-warning');
    }

    this.diagnosticsEl.replaceChildren();
    const messages = result.messages || [];
    if (!messages.length) {
      this.diagnosticsEl.classList.add('rz-sc-quiet');
      return;
    }
    this.diagnosticsEl.classList.remove('rz-sc-quiet');

    for (const message of messages) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `rz-sc-diag rz-sc-${message.type}`;

      const where = document.createElement('span');
      where.className = 'rz-sc-diag-loc';
      where.textContent = message.lineNum ? `${message.lineNum}:${message.linePos || 0}` : '—';

      const what = document.createElement('span');
      what.className = 'rz-sc-diag-text';
      what.textContent = message.message;

      row.append(where, what);
      row.addEventListener('click', () => this._revealLine(message.lineNum));
      this.diagnosticsEl.appendChild(row);

      if (!message.lineNum) continue;
      const line = this.codeEl.querySelector(`.rz-sc-line[data-line="${message.lineNum}"]`);
      if (line) {
        line.classList.add(message.type === 'error' ? 'rz-sc-has-error' : 'rz-sc-has-warning');
      }
    }

    // The first error is the one that matters; the rest are usually its wake.
    const firstError = messages.find((m) => m.type === 'error' && m.lineNum);
    if (firstError) this._revealLine(firstError.lineNum);
  }

  _revealLine(lineNum) {
    if (!lineNum) return;
    const line = this.codeEl.querySelector(`.rz-sc-line[data-line="${lineNum}"]`);
    if (!line) return;
    if (typeof line.scrollIntoView === 'function') {
      line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    line.classList.add('rz-sc-flash');
    setTimeout(() => line.classList.remove('rz-sc-flash'), 900);
  }

  // --- actions ------------------------------------------------------------

  _status(message, type = 'info') {
    if (typeof window.updateStatus === 'function') window.updateStatus(message, type);
  }

  async _copy() {
    if (!this.source) {
      this._status('No WGSL to copy', 'error');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.source);
      } else {
        const temp = document.createElement('textarea');
        temp.value = this.source;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      this._status('Shader copied');
    } catch (error) {
      this._status(`Copy failed: ${error.message}`, 'error');
    }
  }

  _save() {
    if (!this.source) {
      this._status('No WGSL to save', 'error');
      return;
    }
    const target = this.targets.find((t) => t.id === this.targetId);
    const slug = (target?.label || 'shader').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `rhizomium-${slug || 'shader'}.wgsl`;

    const manager = window.saveLoadManager;
    if (manager && typeof manager.downloadFile === 'function') {
      manager.downloadFile(this.source, filename, 'text/plain');
    } else {
      const blob = new Blob([this.source], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    this._status(`Saved ${filename}`);
  }
}

/** One window for the session, like the other tool panels. */
let instance = null;

export function getShaderCompilerWindow() {
  if (!instance) instance = new ShaderCompilerWindow();
  return instance;
}

export default ShaderCompilerWindow;
