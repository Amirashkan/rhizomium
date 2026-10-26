// Narration through Piper (https://github.com/OHF-Voice/piper1-gpl), an offline
// neural TTS that runs on the CPU. Every sentence is synthesised on its own so
// the recorder knows exactly when each one starts - scenes act on sentence
// boundaries, and captions are cut on them. Results are cached by a hash of
// voice + settings + text, so editing one line re-voices only that line.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, createWriteStream, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const VOICE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/';
const VOICE_NAME = 'en_US-lessac-medium';

/** Split narration into sentences, keeping "e.g." and decimals intact. */
export function sentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .filter(Boolean);
}

/**
 * Pronunciation fixes: what the captions show is the text as written, what the
 * voice is fed has these substitutions applied.
 */
export function spoken(text, lexicon = {}) {
  let s = text;
  for (const [from, to] of Object.entries(lexicon)) {
    const lit = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`(?<![\\w.])${lit}(?![\\w])`, 'g'), to);
  }
  return s;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
}

/** Resolve a voice model: an explicit path, or the default voice, fetched once. */
export async function ensureVoice(voiceArg, cacheDir) {
  if (voiceArg) {
    if (!existsSync(voiceArg)) throw new Error(`voice model not found: ${voiceArg}`);
    return voiceArg;
  }
  const dir = join(cacheDir, 'voices');
  mkdirSync(dir, { recursive: true });
  const model = join(dir, `${VOICE_NAME}.onnx`);
  if (!existsSync(model)) {
    console.log(`  downloading voice ${VOICE_NAME} (~60 MB, once)`);
    await download(`${VOICE_URL}${VOICE_NAME}.onnx.json`, `${model}.json`);
    await download(`${VOICE_URL}${VOICE_NAME}.onnx`, model);
  }
  return model;
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')}\n${err}`))));
    p.stdin.end(input);
  });
}

/** Duration of a PCM WAV from its header - no ffprobe round-trip per sentence. */
export function wavSeconds(file) {
  const b = readFileSync(file);
  let off = 12;
  let byteRate = 0;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(off + 16);
    if (id === 'data') return size / byteRate;
    off += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}

/**
 * Voice every scene. Returns, per scene, its sentences with their WAV file,
 * duration and start offset inside the scene's narration.
 */
export async function voiceScenes(scenes, { python, model, cacheDir, gap, lengthScale, lexicon, jobs = 3 }) {
  const dir = join(cacheDir, 'tts');
  mkdirSync(dir, { recursive: true });
  const modelTag = createHash('sha1').update(readFileSync(`${model}.json`)).digest('hex').slice(0, 8);

  const work = [];
  const plan = scenes.map((scene) => {
    let at = 0;
    return sentences(scene.say).map((text) => {
      const voiced = spoken(text, lexicon);
      const key = createHash('sha1').update(`${modelTag}|${lengthScale}|${voiced}`).digest('hex').slice(0, 16);
      const file = join(dir, `${key}.wav`);
      const item = { text, file, start: 0, dur: 0 };
      if (!existsSync(file)) work.push({ voiced, file });
      item.place = () => { item.dur = wavSeconds(file); item.start = at; at += item.dur + gap; };
      return item;
    });
  });

  if (work.length) console.log(`  synthesising ${work.length} sentence(s)`);
  let done = 0;
  const worker = async () => {
    while (work.length) {
      const { voiced, file } = work.shift();
      mkdirSync(dirname(file), { recursive: true });
      await run(python, ['-m', 'piper', '-m', model, '--length-scale', String(lengthScale), '-f', `${file}.tmp.wav`], voiced);
      renameSync(`${file}.tmp.wav`, file);
      done++;
      if (done % 10 === 0) console.log(`    ${done} done`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  return plan.map((items) => {
    items.forEach((i) => i.place());
    const last = items[items.length - 1];
    return { sentences: items, duration: last ? last.start + last.dur : 0 };
  });
}
