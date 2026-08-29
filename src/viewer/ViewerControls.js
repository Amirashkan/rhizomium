// src/viewer/ViewerControls.js
//
// VIEWER CONTROLS: the handful of parameters a patch offers to whoever is
// looking at it in the web viewer.
//
// A published patch normally plays and that is all. Sometimes the work is not
// the frame but the range — a piece that is worth turning a knob on. This is
// the artist's answer to "which knobs", written into the document:
//
//   viewerControls: [{ nodeId, param, label, kind, min, max, step }, …]
//
// Three rules shape everything here.
//
// **The artist chooses, exhaustively.** Nothing is exposed by default. A patch
// with no viewer controls shows no panel at all, which is what every patch
// published before this existed keeps doing.
//
// **A control names a parameter, not a value.** It carries the node id and the
// parameter name and how to present them; the value stays in `node.params`,
// where the compiler, the editor and the viewer already read it. So a control
// cannot drift from the patch, and removing one changes nothing about what the
// patch renders.
//
// **A formula owns its parameter.** A parameter holding an expression
// ("=sin(time)") is refused as a control: the formula is the author's, and a
// slider that silently replaced it would be a worse patch, not a more
// interactive one. Same rule ExternalParameterControl.js applies to MIDI.
//
// The model mirrors ScreenModel deliberately — plain data, edit operations, one
// change subscription — so the panel, the project file, the viewer and the tests
// all read the same object.

import { NodeDefs } from '../data/NodeDefs.js';
import { nodeDisplayName } from '../core/nodeName.js';

/**
 * How many controls one patch may offer.
 *
 * Not a technical limit: the panel sits over the artwork, and past a dozen rows
 * a viewer is reading a mixing desk rather than looking at a piece.
 */
export const MAX_VIEWER_CONTROLS = 12;

/** Longest label a control may carry, in the same spirit as a node name. */
export const MAX_CONTROL_LABEL_LENGTH = 40;

/** How a control presents itself. */
export const CONTROL_KINDS = ['slider', 'toggle', 'choice'];

/** Parameter types that become a slider. */
const NUMERIC_TYPES = ['float', 'f32', 'int', 'slider', 'dynamic', 'number', 'angle'];

/** Parameter types that become a toggle. */
const BOOLEAN_TYPES = ['bool', 'boolean'];

/** Parameter types that become a dropdown. */
const CHOICE_TYPES = ['select'];

/**
 * Which presentation a parameter definition earns, or null when the parameter
 * is not something a visitor can be handed.
 *
 * Deliberately narrow. A colour picker, a font, a texture file and a block of
 * GLSL are all authoring surfaces: they need the editor's machinery to mean
 * anything, and half of them would have to travel as new payload in the patch.
 *
 * @param {{type?: string}} def a parameter definition from NodeDefs
 * @returns {'slider'|'toggle'|'choice'|null}
 */
export function controlKindFor(def) {
  const type = String(def?.type || 'float').toLowerCase();
  if (NUMERIC_TYPES.includes(type)) return 'slider';
  if (BOOLEAN_TYPES.includes(type)) return 'toggle';
  if (CHOICE_TYPES.includes(type) && Array.isArray(def?.options) && def.options.length > 1) {
    return 'choice';
  }
  return null;
}

/**
 * Parameters this node could offer, in definition order.
 *
 * `resolution` and `mode`-style metadata parameters are not filtered here: what
 * makes a parameter unusable is its TYPE, and a metadata parameter that is a
 * select is genuinely switchable. The one exclusion is a parameter the node
 * itself is currently ignoring, which stays listed — an artist setting up a
 * patch knows which mode they will publish it in better than this does.
 *
 * @param {object} node a graph node
 * @returns {Array<{name: string, label: string, kind: string, def: object}>}
 */
export function exposableParameters(node) {
  const defs = NodeDefs[node?.kind]?.params;
  if (!Array.isArray(defs)) return [];

  const out = [];
  for (const def of defs) {
    if (!def?.name) continue;
    const kind = controlKindFor(def);
    if (!kind) continue;
    out.push({ name: def.name, label: parameterLabel(def), kind, def });
  }
  return out;
}

/** A parameter's human name, as the parameter panel writes it. */
export function parameterLabel(def) {
  const name = String(def?.name || '');
  return (
    def?.displayName ||
    def?.label ||
    (name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Parameter')
  );
}

/** The definition of one parameter on one node, or null. */
export function parameterDef(node, param) {
  const defs = NodeDefs[node?.kind]?.params;
  if (!Array.isArray(defs)) return null;
  return defs.find((d) => d?.name === param) || null;
}

/** Does this parameter currently hold a formula rather than a value? */
export function holdsExpression(node, param) {
  const raw = node?.params?.[param];
  return typeof raw === 'string' && raw.trim().startsWith('=');
}

function clampNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanLabel(raw) {
  if (typeof raw !== 'string') return '';
  let stripped = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    stripped += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return stripped.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTROL_LABEL_LENGTH).trim();
}

/**
 * A sensible step for a range, so a slider lands on values a person meant.
 *
 * An integer parameter steps by one. Everything else gets a two-hundredth of
 * its span rounded down to a power of ten — 0.001 across 0–1, 0.01 across 0–2,
 * 1 across 0–360 — which is a couple of hundred stops either way: finer than a
 * slider a few hundred pixels wide can be aimed anyway, without a read-out full
 * of digits nobody set.
 */
export function defaultStep(def, min, max) {
  const type = String(def?.type || '').toLowerCase();
  if (type === 'int') return 1;
  if (Number.isFinite(def?.step) && def.step > 0) return def.step;
  const span = Math.abs(clampNumber(max, 1) - clampNumber(min, 0)) || 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(span / 200)));
  return Math.min(1, Math.max(0.0001, magnitude));
}

/**
 * Build a complete control record, filling in everything not supplied.
 *
 * Every field is sanitized here rather than at the edges, because this is what
 * the project file, the panel and the viewer all go through — a hand-edited
 * `.rz` reaches the viewer by the same road as a control added in the panel.
 *
 * @param {object} opts
 * @param {object} [def] the parameter definition, when the node kind is known
 * @returns {object|null} null when the record names no parameter
 */
export function makeViewerControl(opts = {}, def = null) {
  const nodeId = opts?.nodeId === undefined || opts?.nodeId === null ? '' : String(opts.nodeId);
  const param = typeof opts?.param === 'string' ? opts.param.trim() : '';
  if (!nodeId || !param) return null;

  const kind = CONTROL_KINDS.includes(opts?.kind)
    ? opts.kind
    : (def ? controlKindFor(def) : null) || 'slider';

  const control = {
    nodeId,
    param,
    kind,
    label: cleanLabel(opts?.label) || (def ? parameterLabel(def) : param),
  };

  if (kind === 'slider') {
    const defMin = clampNumber(def?.min, 0);
    const defMax = clampNumber(def?.max, 1);
    let min = clampNumber(opts?.min, defMin);
    let max = clampNumber(opts?.max, defMax);
    // A range with no width is a slider that cannot move; widen it rather than
    // shipping a dead control.
    if (max === min) max = min + 1;
    if (max < min) [min, max] = [max, min];
    control.min = min;
    control.max = max;
    const step = clampNumber(opts?.step, defaultStep(def, min, max));
    control.step = step > 0 ? step : defaultStep(def, min, max);
  }

  if (kind === 'choice') {
    // The options live in the node definition, not in the document: a patch
    // must not be able to offer a mode the node does not have.
    const options = Array.isArray(def?.options) ? def.options.map(String) : [];
    if (options.length) control.options = options;
  }

  return control;
}

/** The key a control addresses — the same one the uniform buffer uses. */
export function controlKey(control) {
  return `${control?.nodeId}.${control?.param}`;
}

/**
 * Match the saved controls against a graph and say what can actually be shown.
 *
 * A patch outlives its graph: a node gets deleted, a parameter is renamed by a
 * migration, a slider is pointed at something that has since become a formula.
 * Rather than render a control that writes nowhere, drop it — the viewer shows
 * the controls that work and says nothing about the ones that do not, because
 * a visitor cannot act on either.
 *
 * @param {Array<object>|null} controls the document's `viewerControls`
 * @param {Array<object>} nodes the hydrated graph nodes
 * `authored` is the value the patch was published with and never changes;
 * `value` is what the control currently reads. Keeping both is what lets the
 * viewer offer "put it back" without reloading the page.
 *
 * @returns {Array<{control: object, node: object, def: object|null,
 *                  value: *, authored: *}>}
 */
export function resolveViewerControls(controls, nodes) {
  if (!Array.isArray(controls) || !Array.isArray(nodes)) return [];

  const byId = new Map(nodes.map((n) => [String(n?.id), n]));
  const seen = new Set();
  const resolved = [];

  for (const raw of controls) {
    if (resolved.length >= MAX_VIEWER_CONTROLS) break;

    const node = byId.get(String(raw?.nodeId));
    if (!node) continue;

    const def = parameterDef(node, raw?.param);
    const control = makeViewerControl(raw, def);
    if (!control) continue;

    // A parameter the node kind does not declare cannot be presented: its type
    // is unknown, and so is what writing to it would do.
    if (!def) continue;
    if (controlKindFor(def) !== control.kind) continue;

    // The formula rule. See the note at the top of the file.
    if (holdsExpression(node, control.param)) continue;

    const key = controlKey(control);
    if (seen.has(key)) continue;
    seen.add(key);

    const value = currentValue(node, control, def);
    resolved.push({ control, node, def, value, authored: value });
  }

  return resolved;
}

/**
 * What a control currently reads, coerced to the shape its presentation needs.
 */
export function currentValue(node, control, def = null) {
  const raw = node?.params?.[control?.param];
  const fallback = def?.default;

  if (control?.kind === 'toggle') {
    const value = raw === undefined ? fallback : raw;
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  if (control?.kind === 'choice') {
    const options = control.options || (Array.isArray(def?.options) ? def.options.map(String) : []);
    const value = String(raw === undefined ? fallback ?? '' : raw);
    return options.includes(value) ? value : options[0] ?? '';
  }

  // The authored value is allowed to sit outside the control's range — the
  // range is what the visitor may reach, not what the artist had to work in —
  // so it is reported as-is and only clamped once a visitor moves the slider.
  const n = Number(raw === undefined ? fallback : raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Coerce a value a visitor produced into what the parameter should hold.
 *
 * @returns {number|boolean|string}
 */
export function coerceControlValue(control, value) {
  if (control?.kind === 'toggle') return value === true || value === 'true' || value === 1;

  if (control?.kind === 'choice') {
    const options = control.options || [];
    const str = String(value);
    return options.includes(str) ? str : options[0] ?? str;
  }

  const n = Number(value);
  if (!Number.isFinite(n)) return clampNumber(control?.min, 0);
  const min = clampNumber(control?.min, 0);
  const max = clampNumber(control?.max, 1);
  return Math.min(Math.max(n, Math.min(min, max)), Math.max(min, max));
}

/**
 * An ordered list of viewer controls, with edit operations and a change
 * subscription. Every mutation that changes something notifies once.
 */
export class ViewerControlsModel {
  constructor() {
    /** @type {object[]} */
    this.controls = [];
    this._listeners = new Set();
  }

  /**
   * Subscribe to changes.
   * @param {(model: ViewerControlsModel) => void} fn
   * @returns {() => void} unsubscribe
   */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of [...this._listeners]) {
      try {
        fn(this);
      } catch {
        /* a broken listener is not the model's problem */
      }
    }
  }

  /** @returns {object[]} a shallow copy of the control list, in order */
  list() {
    return this.controls.slice();
  }

  get count() {
    return this.controls.length;
  }

  get isFull() {
    return this.controls.length >= MAX_VIEWER_CONTROLS;
  }

  /** @returns {object|null} the control on this node parameter */
  get(nodeId, param) {
    return (
      this.controls.find((c) => c.nodeId === String(nodeId) && c.param === param) || null
    );
  }

  /** Is this parameter already offered to the viewer? */
  has(nodeId, param) {
    return this.get(nodeId, param) !== null;
  }

  /**
   * Offer a parameter to the viewer.
   *
   * @param {object} node the graph node the parameter belongs to
   * @param {string} param
   * @param {object} [overrides] label/min/max/step to use instead of the defaults
   * @returns {{ok: true, control: object}|{ok: false, reason: string}}
   */
  add(node, param, overrides = {}) {
    if (this.isFull) {
      return { ok: false, reason: `A patch can offer at most ${MAX_VIEWER_CONTROLS} controls.` };
    }

    const def = parameterDef(node, param);
    if (!def) return { ok: false, reason: 'That node has no such parameter.' };
    if (!controlKindFor(def)) {
      return {
        ok: false,
        reason: `${parameterLabel(def)} is not a kind of parameter the viewer can offer.`,
      };
    }
    if (holdsExpression(node, param)) {
      return {
        ok: false,
        reason: `${parameterLabel(def)} holds a formula, which owns it. Clear the formula to offer it as a control.`,
      };
    }
    if (this.has(node.id, param)) {
      return { ok: false, reason: 'That parameter is already a viewer control.' };
    }

    const control = makeViewerControl(
      { nodeId: node.id, param, label: overrides.label || defaultLabel(node, def), ...overrides },
      def,
    );
    if (!control) return { ok: false, reason: 'That parameter could not be offered.' };

    this.controls.push(control);
    this._emit();
    return { ok: true, control };
  }

  /** Stop offering a parameter. @returns {boolean} whether one was removed */
  remove(nodeId, param) {
    const i = this.controls.findIndex(
      (c) => c.nodeId === String(nodeId) && c.param === param,
    );
    if (i < 0) return false;
    this.controls.splice(i, 1);
    this._emit();
    return true;
  }

  /** Drop every control this node offered — what deleting the node means. */
  removeNode(nodeId) {
    const before = this.controls.length;
    this.controls = this.controls.filter((c) => c.nodeId !== String(nodeId));
    if (this.controls.length === before) return false;
    this._emit();
    return true;
  }

  /** Remove every control. */
  clear() {
    if (!this.controls.length) return;
    this.controls = [];
    this._emit();
  }

  /**
   * Patch a control's presentation. Only the fields present are touched, and a
   * patch that changes nothing does not notify — a slider dragged back to where
   * it started must not redraw the panel.
   *
   * @returns {object|null} the updated control
   */
  update(nodeId, param, patch = {}) {
    const control = this.get(nodeId, param);
    if (!control) return null;

    // Only the presentation is editable. Which parameter a control names — and
    // therefore how it is presented — is its identity, and changing that is
    // removing one control and adding another.
    const next = { ...control };
    if (patch.label !== undefined) next.label = cleanLabel(patch.label) || control.label;

    if (control.kind === 'slider') {
      let min = clampNumber(patch.min, control.min);
      let max = clampNumber(patch.max, control.max);
      if (max === min) max = min + 1;
      if (max < min) [min, max] = [max, min];
      next.min = min;
      next.max = max;
      const step = clampNumber(patch.step, control.step);
      next.step = step > 0 ? step : control.step;
    }

    if (JSON.stringify(next) === JSON.stringify(control)) return control;
    Object.assign(control, next);
    this._emit();
    return control;
  }

  /**
   * Move a control up or down the panel. The order is the order a visitor
   * meets them in, which is part of how a patch reads.
   *
   * @param {number} delta -1 for up, +1 for down
   */
  move(nodeId, param, delta) {
    const i = this.controls.findIndex(
      (c) => c.nodeId === String(nodeId) && c.param === param,
    );
    if (i < 0) return false;
    const j = i + (delta < 0 ? -1 : 1);
    if (j < 0 || j >= this.controls.length) return false;
    const [control] = this.controls.splice(i, 1);
    this.controls.splice(j, 0, control);
    this._emit();
    return true;
  }

  /**
   * Drop controls whose node is no longer in the graph.
   *
   * Called after a load and after a delete: a control pointing at a node that
   * is gone is not an error, it is a leftover, and it should not travel into
   * the next save.
   *
   * @param {Array<object>} nodes
   * @returns {number} how many were dropped
   */
  prune(nodes) {
    if (!Array.isArray(nodes)) return 0;
    const ids = new Set(nodes.map((n) => String(n?.id)));
    const before = this.controls.length;
    this.controls = this.controls.filter((c) => ids.has(c.nodeId));
    const dropped = before - this.controls.length;
    if (dropped) this._emit();
    return dropped;
  }

  /**
   * @param {Array<object>} [nodes] the graph, to leave out controls whose node
   *   is no longer in it — a deleted node's slider is a leftover, and the file
   *   should not carry it. Omit to write the list verbatim.
   * @returns {object[]|null} plain data for the project file, null when empty
   */
  serialize(nodes = null) {
    const ids = Array.isArray(nodes) ? new Set(nodes.map((n) => String(n?.id))) : null;
    const live = ids ? this.controls.filter((c) => ids.has(c.nodeId)) : this.controls;
    if (!live.length) return null;
    return live.map((c) => ({ ...c }));
  }

  /**
   * Load from serialized data, replacing what is there. Unusable entries are
   * dropped rather than loaded broken.
   *
   * The node kind is not known here — the graph may not be hydrated yet — so
   * the records are sanitized structurally and checked against the graph later,
   * by {@link resolveViewerControls} in the viewer and {@link prune} here.
   *
   * @param {Array<object>|{controls?: Array<object>}|null} data
   */
  deserialize(data) {
    const raw = Array.isArray(data) ? data : (data && Array.isArray(data.controls) ? data.controls : []);
    const seen = new Set();
    const controls = [];
    for (const entry of raw) {
      if (controls.length >= MAX_VIEWER_CONTROLS) break;
      const control = makeViewerControl(entry, entry?.kind === 'choice' ? { type: 'select', options: entry.options } : null);
      if (!control) continue;
      const key = controlKey(control);
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push(control);
    }
    this.controls = controls;
    this._emit();
  }
}

/** "Bloom · Radius" — the node the artist sees, then the parameter. */
export function defaultLabel(node, def) {
  return cleanLabel(`${nodeDisplayName(node)} · ${parameterLabel(def)}`);
}
