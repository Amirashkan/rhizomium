// src/core/TextRasterizer.js
//
// The Text node's pixels. Glyphs cannot be drawn procedurally in WGSL, so the node rasterises its
// string with Canvas 2D and hands the result to TextureManager under the node's own id — the same
// slot a Texture 2D node's image occupies. That is what lets the generated shader sample it through
// the ordinary `texture_<id>` / `sampler_<id>` binding pair, and what lets every consumer (main
// render, node thumbnail, second-monitor mirror) find it without knowing the node kind.
//
// Everything the node exposes is baked into the bitmap; nothing rides in as a uniform. Position,
// scale and rotation of the *result* are deliberately not parameters here — a Transform node wired
// into the UV input (or fed from this node's output) already does that, live and on the GPU, and
// composing the two beats duplicating them.
//
// Parameters may be expressions, including the string itself: `{...}` inside the text is evaluated
// and replaced with its value, so a Text node can read out a live signal ("BPM {node_4}") rather
// than print the reference. The cache key is taken over the RESOLVED layout rather than the raw
// parameters, which is what makes that work — an expression whose value has not moved this frame
// produces the same key and re-uploads nothing, and one that has moved invalidates on its own.
//
// The expression system is reached through `window.expressionSystem` rather than imported: it is
// what resolves `node_<id>` references against the graph's computed values, and it imports this
// module in turn (parameter writes refresh the raster), so importing it back would be a cycle.

import { getNumericParam, evaluateExpressionSafely } from '../utils/safeExpression.js';

/** Guard rails for the texture the node allocates. A square texture per side. */
export const MIN_RESOLUTION = 64;
export const MAX_RESOLUTION = 4096;

/** Font stacks the `fontFamily` parameter selects between, keyed by the stored value. */
const FONT_STACKS = {
  'sans-serif': 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  monospace: '"Courier New", Courier, monospace',
  cursive: '"Comic Sans MS", cursive',
  fantasy: 'Impact, fantasy',
};

/** Parameters that change only how the texture is sampled, not what is in it. */
const SAMPLER_PARAMS = ['wrap', 'filter'];

const WRAP_MODES = {
  clamp: 'clamp-to-edge',
  repeat: 'repeat',
  mirror: 'mirror-repeat',
};

// nodeId -> { rasterKey, samplerKey, resolution }: what was last uploaded for that node.
const uploadState = new Map();

function paramString(node, name, fallback) {
  const value = node?.params?.[name];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function paramBool(node, name, fallback = false) {
  const value = node?.params?.[name];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

// --- Expressions ------------------------------------------------------------------------------

/**
 * Evaluate one expression the way the rest of the editor does.
 *
 * The app's expression system is preferred because it is the only evaluator that resolves
 * `node_<id>` references against the graph's computed values — that is what makes a Text node able
 * to show another node's output. Falls back to the standalone safe evaluator (arithmetic, time,
 * audio) when the editor isn't up, so previews and tests still resolve what they can. Neither path
 * can reach `eval`: both parse to an AST first.
 *
 * @param {string} expr - expression source, with or without the leading '='
 * @param {object} node - the node the expression belongs to (for node-reference scope)
 * @returns {number|number[]|string|null} the value, or null when it cannot be evaluated
 */
function evaluateExpression(expr, node) {
  const source = String(expr).trim().replace(/^=/, '').trim();
  if (!source) return null;

  const system = typeof window !== 'undefined' ? window.expressionSystem : null;
  if (system?.evaluateExpression) {
    try {
      const value = system.evaluateExpression(`=${source}`, {}, node);
      if (value !== undefined && value !== null) return value;
    } catch { /* fall through to the standalone evaluator */ }
  }

  const scope = liveScope();
  const value = evaluateExpressionSafely(source, scope, NaN);
  return Number.isFinite(value) ? value : null;
}

/** Clock and audio values an expression can read when the full expression system isn't available. */
function liveScope() {
  if (typeof window === 'undefined') return {};
  const simTime = window.renderLoop?._simTime;
  const time = Number.isFinite(simTime) ? simTime : Date.now() / 1000;
  return {
    time,
    frame: Math.floor(time * 60),
    audioEnvelope: window._audioEnvelopeValue || 0,
    audioEnvelopeBass: window._audioEnvelopeBass || 0,
    audioEnvelopeMids: window._audioEnvelopeMids || 0,
    audioEnvelopeHighs: window._audioEnvelopeHighs || 0,
    audioEnvelopeFull: window._audioEnvelopeFull || 0,
  };
}

/**
 * A numeric parameter, with `=expr` resolved against the live graph.
 *
 * getNumericParam already covers plain numbers and self-contained arithmetic; routing expressions
 * through evaluateExpression first is what adds node references to it.
 */
function evalNumber(node, name, fallback) {
  const raw = node?.params?.[name];
  if (typeof raw === 'string' && raw.trim().startsWith('=')) {
    const value = evaluateExpression(raw, node);
    const num = Array.isArray(value) ? value[0] : Number(value);
    if (Number.isFinite(num)) return num;
    return fallback;
  }
  return getNumericParam(node, name, fallback, liveScope());
}

/** Render one evaluated value as display text. */
function formatValue(value, decimals) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => formatValue(v, decimals)).join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  // Whole numbers read better without trailing zeros — a frame counter should say 240, not 240.00.
  if (decimals <= 0 || Number.isInteger(num)) return String(Math.round(num * 10 ** Math.max(0, decimals)) / 10 ** Math.max(0, decimals));
  return num.toFixed(decimals);
}

/**
 * The string to draw, with expressions resolved.
 *
 * Two forms, matching how expressions are written everywhere else in the editor:
 *   "=node_4 * 2"        the whole field is one expression; the node prints its value
 *   "BPM {node_4}"       braces interpolate a value into surrounding text
 *
 * An expression that cannot be resolved yet (a reference to a node with no computed value, a
 * half-typed formula) renders as an empty span rather than leaking the source text into the frame.
 *
 * @param {object} node
 * @param {number} decimals
 * @returns {string}
 */
export function resolveTextContent(node, decimals = 2) {
  const raw = node?.params?.text;
  const text = raw === undefined || raw === null ? '' : String(raw);

  if (text.trim().startsWith('=')) {
    return formatValue(evaluateExpression(text, node), decimals);
  }

  if (!text.includes('{')) return text;

  return text.replace(/\{([^{}]*)\}/g, (match, expr) => {
    if (!expr.trim()) return match;
    return formatValue(evaluateExpression(expr, node), decimals);
  });
}

/**
 * Does this node's output depend on something that moves on its own (a clock, the audio signal,
 * another node's value)? Only those need the per-frame refresh TextNodeProcessor runs; a static
 * Text node costs nothing.
 *
 * @param {object} node
 * @returns {boolean}
 */
export function textNodeHasLiveExpression(node) {
  if (node?.kind !== 'Text') return false;
  for (const value of Object.values(node.params || {})) {
    if (typeof value !== 'string') continue;
    if (value.trim().startsWith('=')) return true;
    if (/\{[^{}]+\}/.test(value)) return true;
  }
  return false;
}

// --- Custom fonts -----------------------------------------------------------------------------

// Font data URL -> { family, status: 'loading'|'ready'|'failed' }. Registering the same font twice
// is wasteful and would add a duplicate FontFace to the document, so loads are shared by content.
const fontRegistry = new Map();
let fontSeq = 0;

/**
 * Register a node's custom font with the document so Canvas 2D can draw with it, and report the
 * family name to use right now.
 *
 * Loading is asynchronous but rasterising is not, so the first call after a font is chosen returns
 * null (draw with the fallback) and forces a re-raster once the font is ready. That is the only
 * honest ordering: a canvas asked to draw with a font that has not loaded silently substitutes
 * another one.
 *
 * @param {object} node
 * @returns {string|null} the CSS family name, or null while unavailable
 */
export function customFontFamily(node) {
  const data = node?.params?.fontData;
  if (typeof data !== 'string' || !data.startsWith('data:')) return null;

  let entry = fontRegistry.get(data);
  if (!entry) {
    entry = { family: `RhizoTextFont${++fontSeq}`, status: 'loading' };
    fontRegistry.set(data, entry);

    if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
      entry.status = 'failed';
      return null;
    }

    const face = new FontFace(entry.family, `url(${data})`);
    face.load().then(() => {
      document.fonts.add(face);
      entry.status = 'ready';
      // The bitmap drawn before this resolved used the fallback family; redraw it now.
      forceRefreshFontUsers(data);
    }).catch(() => {
      entry.status = 'failed';
    });
  }

  return entry.status === 'ready' ? entry.family : null;
}

/** Re-rasterise every Text node using this font once it finishes loading. */
function forceRefreshFontUsers(data) {
  const nodes = (typeof window !== 'undefined' && window.editor?.graph?.nodes) || [];
  for (const node of nodes) {
    if (node?.kind === 'Text' && node.params?.fontData === data) {
      ensureTextTexture(node, { force: true });
    }
  }
}

/**
 * A `type: 'color'` parameter as a CSS colour. Stored as [r,g,b,a] floats by ColorInputHandler;
 * hex strings from a hand-edited project file are tolerated the same way that handler tolerates
 * them.
 */
export function colorToCss(value, fallback = [1, 1, 1, 1]) {
  let c = fallback;

  if (Array.isArray(value) && value.length >= 3) {
    c = value;
  } else if (typeof value === 'string') {
    const hex = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    if (hex) {
      const n = parseInt(hex[1], 16);
      c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    }
  }

  const ch = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255);
  const alpha = c.length > 3 ? Math.min(1, Math.max(0, Number(c[3]) || 0)) : 1;
  return `rgba(${ch(c[0])}, ${ch(c[1])}, ${ch(c[2])}, ${alpha})`;
}

/**
 * Everything needed to draw the node, resolved from its parameters — no canvas involved, so the
 * layout is testable on its own and the drawing step below stays a straight transcription.
 *
 * Coordinates are in texture pixels with y growing downward (canvas convention). The shader flips
 * y when sampling, exactly as the Texture 2D node does, so posY = 1 is the top of the output.
 *
 * @param {object} node - the Text node
 * @returns {object} layout description
 */
export function textNodeLayout(node) {
  const resolution = Math.round(
    Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, evalNumber(node, 'resolution', 1024)))
  );

  // Size is a fraction of the texture so the look survives a resolution change.
  const fontPx = Math.max(1, evalNumber(node, 'size', 0.25) * resolution);
  const lineStep = fontPx * evalNumber(node, 'lineHeight', 1.2);

  // A loaded custom font wins over the generic stack; while it is still loading we fall back, and
  // customFontFamily() schedules the redraw that picks it up.
  const custom = customFontFamily(node);
  const generic = FONT_STACKS[paramString(node, 'fontFamily', 'sans-serif')] || FONT_STACKS['sans-serif'];
  const family = custom ? `"${custom}", ${generic}` : generic;
  const style = paramBool(node, 'italic') ? 'italic ' : '';
  const weight = paramBool(node, 'bold') ? 'bold ' : '';

  const align = paramString(node, 'align', 'center');
  const posX = evalNumber(node, 'posX', 0.5);
  const posY = evalNumber(node, 'posY', 0.5);

  // An empty string still produces one (blank) line, which keeps the texture valid rather than
  // collapsing the layout — the node then renders as transparent, which is what "no text" means.
  const decimals = Math.round(evalNumber(node, 'decimals', 2));
  const lines = resolveTextContent(node, decimals).split('\n');

  // The block is centred on posY: with textBaseline "middle" each line's y is its own centre.
  const x = posX * resolution;
  const blockCentreY = (1 - posY) * resolution;
  const firstLineY = blockCentreY - ((lines.length - 1) * lineStep) / 2;

  return {
    resolution,
    fontPx,
    lineStep,
    font: `${style}${weight}${fontPx}px ${family}`,
    align,
    letterSpacing: evalNumber(node, 'letterSpacing', 0),
    lines: lines.map((text, i) => ({ text, x, y: firstLineY + i * lineStep })),
    fill: colorToCss(node?.params?.color, [1, 1, 1, 1]),
    stroke: colorToCss(node?.params?.outlineColor, [0, 0, 0, 1]),
    // Outline width is a fraction of the font size, so it tracks the text rather than the texture.
    strokeWidth: Math.max(0, evalNumber(node, 'outlineWidth', 0)) * fontPx,
    background: colorToCss(node?.params?.background, [0, 0, 0, 0]),
    // Shrink-to-fit is applied at draw time, where a context exists to measure with. The point the
    // shrink happens about, so the composition just gets smaller instead of drifting.
    autoFit: paramBool(node, 'autoFit', true),
    anchor: { x, y: blockCentreY },
  };
}

/** Fraction of the texture left clear around auto-fitted text, so an outline isn't clipped. */
const AUTO_FIT_MARGIN = 0.04;

/**
 * How much the text has to shrink to sit inside its texture.
 *
 * Measuring needs a context, which is why this is a draw-time step rather than part of the pure
 * layout. It matters most for a custom font: "Handgloves" at the same Size is a comfortable fit in
 * Arial and a third wider in a display face, and without this the overflow is silently clipped by
 * the texture edge with nothing on screen to explain it.
 *
 * @returns {number} scale factor in (0, 1]
 */
function autoFitScale(ctx, layout) {
  if (!layout.autoFit) return 1;

  const usable = layout.resolution * (1 - AUTO_FIT_MARGIN * 2);
  if (usable <= 0) return 1;

  ctx.font = layout.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${layout.letterSpacing}em`;

  let widest = 0;
  for (const line of layout.lines) {
    if (!line.text) continue;
    const width = ctx.measureText(line.text)?.width || 0;
    if (width > widest) widest = width;
  }
  // A stroke grows the mark by half its width on each side.
  widest += layout.strokeWidth;

  const blockHeight = (layout.lines.length - 1) * layout.lineStep + layout.fontPx + layout.strokeWidth;

  return Math.min(1, widest > 0 ? usable / widest : 1, blockHeight > 0 ? usable / blockHeight : 1);
}

/**
 * Draw a layout onto a 2D context sized `layout.resolution` square. Shared by the GPU texture and
 * the node thumbnail so the two can never drift apart.
 *
 * Paints over whatever is already on the surface rather than clearing it — the caller owns that.
 * The rasteriser hands in a fresh (transparent) canvas; the thumbnail hands in a checkerboard, so
 * a background with alpha below 1 reads as see-through there instead of as solid black.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout - from textNodeLayout()
 * @param {number} [scale=1] - draw at a different size (the 64px thumbnail passes 64/resolution)
 */
export function drawTextLayout(ctx, layout, scale = 1) {
  const size = layout.resolution * scale;

  ctx.save();
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, size, size);

  ctx.scale(scale, scale);

  // Shrink text that would overrun the texture, about its own anchor so the composition is
  // preserved and only its size changes. Measured here because it needs a context; the factor is a
  // deterministic function of the layout, so it does not have to enter the cache key.
  const fitScale = autoFitScale(ctx, layout);
  if (fitScale < 1) {
    ctx.translate(layout.anchor.x, layout.anchor.y);
    ctx.scale(fitScale, fitScale);
    ctx.translate(-layout.anchor.x, -layout.anchor.y);
  }

  ctx.font = layout.font;
  ctx.textAlign = layout.align;
  ctx.textBaseline = 'middle';
  // Chrome ships letterSpacing (and every browser with WebGPU is well past that), but a context
  // without it should still render the text rather than throw on an unknown property.
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${layout.letterSpacing}em`;
  }

  // Stroke first so the outline sits behind the fill and only grows outward.
  if (layout.strokeWidth > 0) {
    ctx.strokeStyle = layout.stroke;
    ctx.lineWidth = layout.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    for (const line of layout.lines) {
      if (line.text) ctx.strokeText(line.text, line.x, line.y);
    }
  }

  ctx.fillStyle = layout.fill;
  for (const line of layout.lines) {
    if (line.text) ctx.fillText(line.text, line.x, line.y);
  }

  ctx.restore();
}

/**
 * Rasterise a Text node into a fresh canvas.
 *
 * @param {object} node
 * @param {object} [layout] - a layout already computed for this node, to avoid resolving twice
 * @returns {HTMLCanvasElement|null} null when no 2D context is available (non-browser hosts)
 */
export function rasterizeTextNode(node, layout = textNodeLayout(node)) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = layout.resolution;
  canvas.height = layout.resolution;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  drawTextLayout(ctx, layout);
  return canvas;
}

/**
 * What the bitmap will contain, as a comparable string.
 *
 * Taken over the RESOLVED layout rather than the raw parameters, so an expression is compared by
 * its current value: a Text node reading `{node_4}` re-uploads on the frames where node 4's value
 * actually moved, and not on the ones where it didn't. Two different parameter sets that produce
 * the same picture also collapse to one upload.
 *
 * @param {object} node
 * @param {object} [layout] - a layout already computed for this node, to avoid resolving twice
 * @returns {string}
 */
export function textRasterKey(node, layout = textNodeLayout(node)) {
  return JSON.stringify([
    layout.resolution, layout.font, layout.align, layout.letterSpacing,
    layout.fill, layout.stroke, layout.strokeWidth, layout.background, layout.autoFit,
    layout.lines.map((l) => [l.text, Math.round(l.x * 100), Math.round(l.y * 100)]),
  ]);
}

/** The parameter values the sampler depends on, as a comparable string. */
function samplerKey(node) {
  return SAMPLER_PARAMS.map((name) => String(node?.params?.[name] ?? '')).join('|');
}

function createSampler(device, node) {
  const address = WRAP_MODES[paramString(node, 'wrap', 'clamp')] || 'clamp-to-edge';
  const filter = paramString(node, 'filter', 'linear') === 'nearest' ? 'nearest' : 'linear';
  return device.createSampler({
    magFilter: filter,
    minFilter: filter,
    addressModeU: address,
    addressModeV: address,
  });
}

/**
 * Make sure the GPU texture backing `node` matches its current parameters, rasterising and
 * uploading only when something that shapes the bitmap changed.
 *
 * Safe (and cheap) to call on every shader build: the common case is a cache-key comparison and an
 * early return.
 *
 * @param {object} node - a Text node
 * @param {object} [options]
 * @param {boolean} [options.force=false] - re-upload even when the cache key is unchanged
 * @returns {boolean} true when the texture was (re)uploaded
 */
export function ensureTextTexture(node, { force = false } = {}) {
  if (!node || node.kind !== 'Text') return false;

  const texManager = typeof window !== 'undefined' ? window.textureManager : null;
  const device = texManager?.device;
  if (!device) return false;

  // Resolved once and threaded through: expressions in it may be non-trivial, and the key and the
  // drawing have to agree on the same values anyway.
  const layout = textNodeLayout(node);
  const rasterKey = textRasterKey(node, layout);
  const sampKey = samplerKey(node);
  const previous = uploadState.get(node.id);
  const existing = texManager.gpuTextures?.get(node.id);

  if (!force && existing && previous
      && previous.rasterKey === rasterKey && previous.samplerKey === sampKey) {
    return false;
  }

  const canvas = rasterizeTextNode(node, layout);
  if (!canvas) return false;

  const resolution = canvas.width;
  const samplerChanged = !previous || previous.samplerKey !== sampKey;

  // Reusing the texture when the size is unchanged keeps the existing texture view valid, so the
  // renderer's bind groups survive a text edit untouched — only a resize or a sampler change
  // forces the rebuild below.
  let texture = existing?.texture;
  let textureView = existing?.textureView;
  let sampler = existing?.sampler;
  let needsRebind = false;

  if (!texture || previous?.resolution !== resolution) {
    try {
      existing?.texture?.destroy?.();
    } catch { /* already gone */ }

    texture = device.createTexture({
      size: [resolution, resolution, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
      label: `text-node-${node.id}`,
    });
    textureView = texture.createView();
    needsRebind = true;
  }

  if (!sampler || samplerChanged) {
    sampler = createSampler(device, node);
    needsRebind = true;
  }

  device.queue.copyExternalImageToTexture(
    { source: canvas },
    { texture },
    [resolution, resolution, 1],
  );

  const info = {
    texture,
    textureView,
    sampler,
    width: resolution,
    height: resolution,
    // The second-monitor mirror broadcasts whatever image source it finds on the entry, and a
    // canvas is a valid createImageBitmap source — so the mirror gets the text without a
    // kind-specific path. Deliberately `source` rather than `bitmap`: SaveLoadManager treats a
    // `bitmap` on a texture entry as an image restored from the project file and uploads it a
    // second time, which this one does not need.
    source: canvas,
  };
  texManager.gpuTextures?.set(node.id, info);
  texManager.textures?.set(node.id, info);
  uploadState.set(node.id, { rasterKey, samplerKey: sampKey, resolution });

  if (needsRebind) {
    // Signals gpuRenderer._updateTextureBindings to pick up the new view/sampler next frame.
    texManager.bindGroup = null;
  }

  if (typeof window !== 'undefined') {
    window.secondMonitorViewer?.onTextureChanged?.(node.id);
    window.editor?.markDirty?.('text-node-raster');
  }

  return true;
}

/**
 * Re-rasterise after a parameter write that skipped the shader rebuild (a typed edit, a MIDI or
 * OSC value). A no-op for every other node kind, so callers on shared parameter paths can call it
 * unconditionally.
 *
 * @param {object} node
 */
export function refreshTextNodeTexture(node) {
  if (node?.kind !== 'Text') return;
  ensureTextTexture(node);
}

/** Forget a node's upload state so the next ensureTextTexture() rasterises from scratch. */
export function releaseTextTexture(nodeId) {
  uploadState.delete(nodeId);
}
