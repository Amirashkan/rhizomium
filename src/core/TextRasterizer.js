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
// Re-rasterising is only worth it when a parameter that shapes the bitmap actually changed, so
// ensureTextTexture() compares a cache key first and is cheap to call on every shader build.

import { getNumericParam } from '../utils/safeExpression.js';

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

/** Parameters that change the bitmap. Anything not listed here cannot invalidate the raster. */
const RASTER_PARAMS = [
  'text', 'fontFamily', 'bold', 'italic',
  'size', 'lineHeight', 'letterSpacing', 'align', 'posX', 'posY',
  'color', 'outlineWidth', 'outlineColor', 'background',
  'resolution',
];

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
    Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, getNumericParam(node, 'resolution', 1024)))
  );

  // Size is a fraction of the texture so the look survives a resolution change.
  const fontPx = Math.max(1, getNumericParam(node, 'size', 0.25) * resolution);
  const lineStep = fontPx * getNumericParam(node, 'lineHeight', 1.2);

  const family = FONT_STACKS[paramString(node, 'fontFamily', 'sans-serif')] || FONT_STACKS['sans-serif'];
  const style = paramBool(node, 'italic') ? 'italic ' : '';
  const weight = paramBool(node, 'bold') ? 'bold ' : '';

  const align = paramString(node, 'align', 'center');
  const posX = getNumericParam(node, 'posX', 0.5);
  const posY = getNumericParam(node, 'posY', 0.5);

  // An empty string still produces one (blank) line, which keeps the texture valid rather than
  // collapsing the layout — the node then renders as transparent, which is what "no text" means.
  const raw = node?.params?.text;
  const lines = String(raw === undefined || raw === null ? '' : raw).split('\n');

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
    letterSpacing: getNumericParam(node, 'letterSpacing', 0),
    lines: lines.map((text, i) => ({ text, x, y: firstLineY + i * lineStep })),
    fill: colorToCss(node?.params?.color, [1, 1, 1, 1]),
    stroke: colorToCss(node?.params?.outlineColor, [0, 0, 0, 1]),
    // Outline width is a fraction of the font size, so it tracks the text rather than the texture.
    strokeWidth: Math.max(0, getNumericParam(node, 'outlineWidth', 0)) * fontPx,
    background: colorToCss(node?.params?.background, [0, 0, 0, 0]),
  };
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
 * @returns {HTMLCanvasElement|null} null when no 2D context is available (non-browser hosts)
 */
export function rasterizeTextNode(node) {
  if (typeof document === 'undefined') return null;

  const layout = textNodeLayout(node);
  const canvas = document.createElement('canvas');
  canvas.width = layout.resolution;
  canvas.height = layout.resolution;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  drawTextLayout(ctx, layout);
  return canvas;
}

/** The parameter values the bitmap depends on, as a comparable string. */
export function textRasterKey(node) {
  return JSON.stringify(RASTER_PARAMS.map((name) => node?.params?.[name] ?? null));
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

  const rasterKey = textRasterKey(node);
  const sampKey = samplerKey(node);
  const previous = uploadState.get(node.id);
  const existing = texManager.gpuTextures?.get(node.id);

  if (!force && existing && previous
      && previous.rasterKey === rasterKey && previous.samplerKey === sampKey) {
    return false;
  }

  const canvas = rasterizeTextNode(node);
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
