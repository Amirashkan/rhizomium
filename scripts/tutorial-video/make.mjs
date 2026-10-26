#!/usr/bin/env node
// Record a narrated feature tour of the editor.
//
//   node scripts/tutorial-video/make.mjs [options]
//
// Three stages, each reusable on its own:
//   1. voice     - Piper speaks every sentence of scenes.mjs (cached)
//   2. record    - a real browser plays the scenes against the live editor
//                  while a screencast is encoded to video
//   3. assemble  - narration is laid over the video by timestamp, with
//                  chapters and subtitles
//
// See README.md beside this file for requirements and options.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { voiceScenes, ensureVoice, sentences } from './lib/tts.mjs';
import { startRecording } from './lib/recorder.mjs';
import { Director } from './lib/director.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/editor/index.html' },
    out: { type: 'string', default: join(HERE, 'build') },
    scenes: { type: 'string', default: join(HERE, 'scenes.mjs') }, // the tour to record
    only: { type: 'string' },                     // comma-separated scene ids
    browser: { type: 'string' },                  // chrome | msedge | path to a Chromium binary
    headless: { type: 'boolean', default: false },
    args: { type: 'string', default: '' },        // extra Chromium flags, space separated
    size: { type: 'string', default: '1920x1080' },
    fps: { type: 'string', default: '30' },
    captions: { type: 'string', default: 'soft' }, // soft | burn | none
    voice: { type: 'string' },                    // path to a Piper .onnx voice
    python: { type: 'string', default: process.platform === 'win32' ? 'python' : 'python3' },
    ffmpeg: { type: 'string', default: 'ffmpeg' },
    'length-scale': { type: 'string', default: '1.05' }, // >1 speaks slower
    gap: { type: 'string', default: '0.35' },     // pause between sentences, s
    lead: { type: 'string', default: '0.8' },     // silence before a scene's narration, s
    tail: { type: 'string', default: '0.9' },     // hold after it, s
    'audio-file': { type: 'string' },
    'hide-errors': { type: 'boolean', default: false }, // hide error toasts (e.g. a GPU-less test machine)             // fed to the page as the microphone
    'no-voice': { type: 'boolean', default: false }, // dry run: timings estimated from word count
    'skip-record': { type: 'boolean', default: false }, // re-assemble the last recording
    help: { type: 'boolean', default: false },
  },
});

if (opt.help) {
  console.log(readFileSync(join(HERE, 'README.md'), 'utf8'));
  process.exit(0);
}

const [W, H] = opt.size.split('x').map(Number);
const FPS = Number(opt.fps);
const LEAD = Number(opt.lead);
const TAIL = Number(opt.tail);
const OUT = resolve(opt.out);
const CACHE = join(OUT, 'cache');
mkdirSync(CACHE, { recursive: true });

const fmt = (s) => {
  const t = Math.max(0, s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return { h, m, sec };
};
const srtTime = (s) => {
  const { h, m, sec } = fmt(s);
  const whole = Math.floor(sec), ms = Math.round((sec - whole) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')},${String(Math.min(ms, 999)).padStart(3, '0')}`;
};
const ytTime = (s) => {
  const { h, m, sec } = fmt(s);
  const ss = String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

function run(cmd, args) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', no);
    p.on('close', (c) => (c === 0 ? ok() : no(new Error(`${cmd} exited with ${c}`))));
  });
}

async function loadChromium() {
  const from = process.env.PLAYWRIGHT_CORE || 'playwright-core';
  try {
    return (await import(from)).chromium;
  } catch {
    console.error('playwright-core is not installed. Run:\n  npm i --no-save playwright-core');
    process.exit(1);
  }
}

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/** Start the Vite dev server if the editor isn't already being served. */
async function ensureServer(url) {
  if (await reachable(url)) return null;
  const u = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error(`${url} is not reachable`);
  console.log(`  starting dev server on port ${u.port}`);
  const proc = spawn('npm', ['run', 'dev', '--', '--port', u.port, '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
  });
  for (let i = 0; i < 90; i++) {
    if (await reachable(url)) return proc;
    await new Promise((r) => setTimeout(r, 1000));
  }
  proc.kill();
  throw new Error('dev server did not come up in 90 s');
}

async function launch(chromium) {
  const args = [
    `--window-size=${W},${H + 140}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', // grant mic/MIDI prompts without a click
    '--hide-scrollbars',
    ...opt.args.split(' ').filter(Boolean),
  ];
  if (opt['audio-file']) {
    args.push('--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(opt['audio-file'])}`);
  }
  const base = { headless: opt.headless, args };
  const tries = opt.browser
    ? [opt.browser]
    : ['chrome', 'msedge', process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'];
  for (const b of tries) {
    try {
      const how = ['chrome', 'msedge'].includes(b) ? { channel: b } : { executablePath: b };
      const browser = await chromium.launch({ ...base, ...how });
      console.log(`  browser: ${b}`);
      return browser;
    } catch (e) {
      if (opt.browser) throw e;
    }
  }
  throw new Error('no Chromium-family browser found; pass --browser <path>');
}

// --- 1. voice ----------------------------------------------------------------

const {
  default: allScenes, lexicon = {}, title: videoTitle = 'Rhizomium feature tour', name = 'rhizomium-tour',
} = await import(pathToFileURL(resolve(opt.scenes)).href);
const only = opt.only?.split(',').map((s) => s.trim());
const scenes = only ? allScenes.filter((s) => only.includes(s.id)) : allScenes;
if (!scenes.length) throw new Error(`no scenes match --only ${opt.only}`);

console.log(`1/3 voice (${scenes.length} scenes)`);
let voiced;
if (opt['no-voice']) {
  voiced = scenes.map((s) => {
    let at = 0;
    const items = sentences(s.say).map((text) => {
      const dur = text.split(/\s+/).length / 2.6; // ~155 wpm
      const it = { text, file: null, start: at, dur };
      at += dur + Number(opt.gap);
      return it;
    });
    const last = items[items.length - 1];
    return { sentences: items, duration: last ? last.start + last.dur : 0 };
  });
} else {
  const model = await ensureVoice(opt.voice, CACHE);
  voiced = await voiceScenes(scenes, {
    python: opt.python, model, cacheDir: CACHE, gap: Number(opt.gap),
    lengthScale: Number(opt['length-scale']), lexicon,
  });
}
const narration = voiced.reduce((a, v) => a + v.duration, 0);
console.log(`  narration ${ytTime(narration)} across ${voiced.reduce((a, v) => a + v.sentences.length, 0)} sentences`);

// --- 2. record ---------------------------------------------------------------

const rawVideo = join(OUT, 'raw.mp4');
const timelineFile = join(OUT, 'timeline.json');
let timeline;

if (opt['skip-record']) {
  timeline = JSON.parse(readFileSync(timelineFile, 'utf8'));
} else {
  console.log('2/3 record');
  const chromium = await loadChromium();
  const server = await ensureServer(opt.url);
  const browser = await launch(chromium);
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript({ path: join(HERE, 'lib/overlay.js') });
  if (opt['hide-errors']) {
    await context.addInitScript(() => {
      const st = document.createElement('style');
      st.textContent = '.error-container { display: none !important; }';
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
    });
  }
  // A fresh profile every run: no autosave restored, the welcome dialog shows.
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`    page error: ${e.message.split('\n')[0]}`));
  await page.goto(opt.url);
  await page.waitForFunction(() => window.editor && window.rebuild, null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  const rec = await startRecording(page, { file: rawVideo, fps: FPS, width: W, height: H, ffmpeg: opt.ffmpeg });
  const d = new Director(page, rec.now);
  timeline = { fps: FPS, size: [W, H], scenes: [] };

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const v = voiced[i];
    const start = rec.now();
    const voiceAt = start + LEAD;
    console.log(`  [${String(i + 1).padStart(2)}/${scenes.length}] ${scene.id} (${v.duration.toFixed(1)} s voice)`);
    d.beginScene(scene, voiceAt, v.sentences);
    if (scene.chapter !== false) d.chapter(`Part ${String(i + 1).padStart(2, '0')}`, scene.title);

    const timers = [];
    if (opt.captions === 'burn') {
      for (const s of v.sentences) {
        timers.push(setTimeout(() => page.evaluate((t) => window.__tour.caption(t), s.text).catch(() => {}),
          Math.max(0, (voiceAt + s.start - rec.now()) * 1000)));
      }
    }

    await d.safe('scene', () => scene.run(d));
    const until = voiceAt + v.duration + TAIL;
    const left = until - rec.now();
    if (left > 0) await new Promise((r) => setTimeout(r, left * 1000));
    timers.forEach(clearTimeout);
    await page.evaluate(() => window.__tour.caption('')).catch(() => {});
    await d.clearHighlights();

    timeline.scenes.push({
      id: scene.id, title: scene.title, start, end: rec.now(), voiceAt,
      sentences: v.sentences.map((s) => ({ text: s.text, file: s.file, at: voiceAt + s.start, dur: s.dur })),
    });
  }

  const length = await rec.stop();
  timeline.length = length;
  await browser.close();
  server?.kill();
  writeFileSync(timelineFile, JSON.stringify(timeline, null, 2));
  if (d.warnings.length) {
    console.log(`  ${d.warnings.length} action(s) could not be performed:`);
    d.warnings.forEach((w) => console.log(`    - ${w}`));
  }
}

// --- 3. assemble -------------------------------------------------------------

console.log('3/3 assemble');

// Narration track: every sentence written into one buffer at its timestamp.
// Exact to the sample, and no hundred-input ffmpeg filter graph.
function buildNarration(file) {
  const all = timeline.scenes.flatMap((s) => s.sentences).filter((s) => s.file);
  if (!all.length) return false;
  const read = (f) => {
    const b = readFileSync(f);
    let off = 12, rate = 22050, data = null;
    while (off < b.length - 8) {
      const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
      if (id === 'fmt ') rate = b.readUInt32LE(off + 12);
      if (id === 'data') data = new Int16Array(b.buffer.slice(b.byteOffset + off + 8, b.byteOffset + off + 8 + size));
      off += 8 + size + (size & 1);
    }
    return { rate, data };
  };
  const rate = read(all[0].file).rate;
  const total = new Int16Array(Math.ceil((timeline.length + 1) * rate));
  for (const s of all) {
    const { data } = read(s.file);
    const at = Math.round(s.at * rate);
    total.set(data.subarray(0, Math.max(0, total.length - at)), at);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + total.byteLength, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(total.byteLength, 40);
  writeFileSync(file, Buffer.concat([hdr, Buffer.from(total.buffer)]));
  return true;
}

const voiceWav = join(OUT, 'narration.wav');
const hasVoice = buildNarration(voiceWav);

const srt = timeline.scenes
  .flatMap((s) => s.sentences)
  .map((s, i) => `${i + 1}\n${srtTime(s.at)} --> ${srtTime(s.at + s.dur)}\n${s.text}\n`)
  .join('\n');
const srtFile = join(OUT, `${name}.srt`);
writeFileSync(srtFile, srt);

const chapters = [';FFMETADATA1', `title=${videoTitle}`];
timeline.scenes.forEach((s, i) => {
  const end = timeline.scenes[i + 1]?.start ?? timeline.length;
  chapters.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(s.start * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${s.title}`);
});
const metaFile = join(OUT, 'chapters.ffmeta');
writeFileSync(metaFile, chapters.join('\n') + '\n');
writeFileSync(join(OUT, 'chapters.txt'),
  timeline.scenes.map((s, i) => `${ytTime(i === 0 ? 0 : s.start)} ${s.title}`).join('\n') + '\n');

const final = join(OUT, `${name}.mp4`);
const ff = ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideo];
if (hasVoice) ff.push('-i', voiceWav);
ff.push('-i', metaFile);
const softSubs = opt.captions === 'soft';
if (softSubs) ff.push('-i', srtFile);
const metaIdx = hasVoice ? 2 : 1;
ff.push('-map', '0:v');
if (hasVoice) ff.push('-map', '1:a');
if (softSubs) ff.push('-map', `${metaIdx + 1}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng');
ff.push('-map_metadata', String(metaIdx), '-map_chapters', String(metaIdx));
ff.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
if (hasVoice) ff.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
// Cut at the recording's own length. -shortest would end the file where the
// last subtitle cue starts, losing the final sentence.
ff.push('-t', timeline.length.toFixed(3), final);
await run(opt.ffmpeg, ff);

console.log(`\ndone: ${final}`);
console.log(`      ${srtFile}`);
console.log(`      ${join(OUT, 'chapters.txt')}  (paste into a YouTube description)`);
console.log(`      length ${ytTime(timeline.length)}`);
