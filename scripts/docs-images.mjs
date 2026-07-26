#!/usr/bin/env node
// Prepare screenshots for the documentation site.
//
//   node scripts/docs-images.mjs optimize [file...]   crop/downscale/re-encode to .webp
//   node scripts/docs-images.mjs annotate [name...]   draw numbered callouts
//   node scripts/docs-images.mjs list                 show what is in docs/images
//
// Rendering runs through headless Chromium (the same binary Playwright uses),
// so there is no native image dependency to install. Crops and callout
// positions live in docs/images/images.config.json, keyed by image name, and
// are expressed as fractions of the image so they survive a re-capture at a
// different resolution.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMAGES = join(ROOT, 'docs/images');
const CONFIG = join(IMAGES, 'images.config.json');
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const MAX_WIDTH = 1600;
const QUALITY = 0.92;

// playwright-core is deliberately not a dependency of this repo (it is heavy and
// only this tool and the ad-hoc verification scripts need it). Resolve it from
// wherever it happens to be installed and say so plainly if it is missing.
async function loadChromium() {
  const from = process.env.PLAYWRIGHT_CORE || 'playwright-core';
  try {
    return (await import(from)).chromium;
  } catch {
    console.error(
      'This tool renders through headless Chromium via playwright-core, which is not\n' +
      'installed. Either:\n' +
      '  npm i --no-save playwright-core\n' +
      'or point at an existing copy:\n' +
      '  PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node scripts/docs-images.mjs ...\n' +
      `Chromium itself is taken from CHROMIUM_PATH (currently ${EXEC}).`,
    );
    process.exit(1);
  }
}

const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : { images: {} };
const cmd = process.argv[2] || 'list';
const args = process.argv.slice(3);

const nameOf = (f) => basename(f, extname(f));

function pick(ext) {
  const all = readdirSync(IMAGES).filter((f) => ext.includes(extname(f)));
  return args.length ? all.filter((f) => args.includes(nameOf(f)) || args.includes(f)) : all;
}

async function withPage(fn) {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('about:blank');
  try { return await fn(page); } finally { await browser.close(); }
}

const dataUrl = (file) => {
  const mime = extname(file) === '.webp' ? 'image/webp' : extname(file) === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(join(IMAGES, file)).toString('base64')}`;
};

// --- optimize -------------------------------------------------------------
async function optimize() {
  const files = pick(['.png', '.jpg', '.jpeg', '.webp']);
  if (!files.length) return console.log('nothing to optimize');
  await withPage(async (page) => {
    let before = 0, after = 0;
    for (const file of files) {
      const name = nameOf(file);
      const crop = cfg.images?.[name]?.crop || null;
      const out = await page.evaluate(async ({ url, crop, MAX_WIDTH, QUALITY }) => {
        const img = new Image();
        await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (crop) {
          sx = Math.round(img.width * crop.x); sy = Math.round(img.height * crop.y);
          sw = Math.round(img.width * crop.w); sh = Math.round(img.height * crop.h);
        }
        const scale = Math.min(1, MAX_WIDTH / sw);
        const c = document.createElement('canvas');
        c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        return { url: c.toDataURL('image/webp', QUALITY), w: c.width, h: c.height };
      }, { url: dataUrl(file), crop, MAX_WIDTH, QUALITY });

      const src = join(IMAGES, file);
      const dst = join(IMAGES, `${name}.webp`);
      const wasSize = statSync(src).size;
      const buf = Buffer.from(out.url.split(',')[1], 'base64');
      writeFileSync(dst, buf);
      if (src !== dst) unlinkSync(src);
      before += wasSize; after += buf.length;
      console.log(`  ${(wasSize / 1024).toFixed(1).padStart(8)} -> ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${out.w}x${out.h}  ${name}${crop ? '  (cropped)' : ''}`);
    }
    console.log(`\ntotal ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB`);
  });
}

// --- annotate -------------------------------------------------------------
// Callouts are drawn onto a copy named <name>.annotated.webp so the clean
// original stays available for re-annotation.
async function annotate() {
  const names = args.length ? args : Object.keys(cfg.images || {}).filter((n) => cfg.images[n].callouts?.length);
  if (!names.length) return console.log('no images have callouts in images.config.json');
  await withPage(async (page) => {
    for (const name of names) {
      const spec = cfg.images?.[name];
      if (!spec?.callouts?.length) { console.log(`  skip ${name} (no callouts)`); continue; }
      const file = existsSync(join(IMAGES, `${name}.webp`)) ? `${name}.webp` : `${name}.png`;
      if (!existsSync(join(IMAGES, file))) { console.log(`  skip ${name} (no image)`); continue; }
      const out = await page.evaluate(async ({ url, callouts, QUALITY }) => {
        const img = new Image();
        await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        // Badge size tracks the image so callouts stay legible at any capture size.
        const r = Math.max(15, Math.round(Math.min(c.width, c.height) * 0.028));
        ctx.font = `700 ${Math.round(r * 1.25)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // Boxes and leader lines first, so every badge sits on top of its own
        // line rather than being crossed by a later one.
        const placed = callouts.map((cal) => {
          const x = cal.x * c.width, y = cal.y * c.height;
          const box = cal.box && {
            x: cal.box.x * c.width, y: cal.box.y * c.height,
            w: cal.box.w * c.width, h: cal.box.h * c.height,
          };
          return { cal, x, y, box };
        });

        for (const { x, y, box } of placed) {
          if (!box) continue;
          ctx.strokeStyle = '#ff9d4d'; ctx.lineWidth = Math.max(2, r * 0.16);
          ctx.strokeRect(box.x, box.y, box.w, box.h);

          // Leader line from the badge to the nearest point on the box, so a
          // badge parked in empty space is still unambiguously attached to the
          // thing it names. Skipped when the badge already touches the box.
          const tx = Math.max(box.x, Math.min(x, box.x + box.w));
          const ty = Math.max(box.y, Math.min(y, box.y + box.h));
          const dx = tx - x, dy = ty - y;
          const dist = Math.hypot(dx, dy);
          if (dist > r * 1.25) {
            const ux = dx / dist, uy = dy / dist;
            ctx.beginPath();
            ctx.moveTo(x + ux * r, y + uy * r);
            ctx.lineTo(tx - ux * 2, ty - uy * 2);
            ctx.strokeStyle = '#ff9d4d';
            ctx.lineWidth = Math.max(2, r * 0.12);
            ctx.stroke();
          }
        }

        for (const [i, { cal, x, y }] of placed.entries()) {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = '#d67f4f'; ctx.fill();
          ctx.lineWidth = Math.max(2, r * 0.14); ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(cal.n ?? i + 1), x, y + r * 0.06);
        }
        return c.toDataURL('image/webp', QUALITY);
      }, { url: dataUrl(file), callouts: spec.callouts, QUALITY });
      const dst = join(IMAGES, `${name}.annotated.webp`);
      writeFileSync(dst, Buffer.from(out.split(',')[1], 'base64'));
      console.log(`  annotated ${name} (${spec.callouts.length} callouts) -> ${basename(dst)}`);
      if (spec.callouts.some((c) => c.label))
        for (const [i, c] of spec.callouts.entries())
          console.log(`      ${c.n ?? i + 1}. ${c.label ?? ''}`);
    }
  });
}

function list() {
  for (const f of readdirSync(IMAGES).sort()) {
    if (f === basename(CONFIG)) continue;
    const s = statSync(join(IMAGES, f));
    const spec = cfg.images?.[nameOf(f)];
    const tags = [spec?.crop && 'crop', spec?.callouts?.length && `${spec.callouts.length} callouts`].filter(Boolean);
    console.log(`  ${(s.size / 1024).toFixed(1).padStart(8)} KB  ${f}${tags.length ? '   [' + tags.join(', ') + ']' : ''}`);
  }
}

if (cmd === 'optimize') await optimize();
else if (cmd === 'annotate') await annotate();
else if (cmd === 'list') list();
else { console.error(`unknown command: ${cmd}`); process.exit(1); }
