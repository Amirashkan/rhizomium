// Screen recorder built on the DevTools screencast. Chromium pushes a JPEG
// whenever the page repaints; we keep the latest one and write it into ffmpeg
// at a constant frame rate, paced by the wall clock. A frame is therefore
// repeated while nothing changes and skipped if the page outruns the rate, so
// video time always equals real time - which is what lets the narration be laid
// over it by timestamp afterwards.
//
// Playwright's own recordVideo would do the timing for us, but encodes at a
// fixed low bitrate that smears thin wires and small type.

import { spawn } from 'node:child_process';

export async function startRecording(page, { file, fps = 30, width, height, ffmpeg = 'ffmpeg', crf = 16 }) {
  const cdp = await page.context().newCDPSession(page);
  const ff = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    // Fast enough to keep up in real time on a laptop; the final assemble pass
    // re-encodes at a sensible size, so this only needs to be visually lossless.
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-vf', `scale=${width}:${height}:flags=lanczos`,
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });

  let latest = null;
  let written = 0;
  let t0 = null;
  let stopped = false;

  const pump = () => {
    if (!latest || t0 === null || stopped) return;
    const due = Math.floor(((performance.now() - t0) / 1000) * fps);
    while (written < due) {
      ff.stdin.write(latest);
      written++;
    }
  };

  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    latest = Buffer.from(data, 'base64');
    if (t0 === null) t0 = performance.now();
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    pump();
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1,
  });

  // A static page sends no frames at all; the timer keeps the clock filled.
  const timer = setInterval(pump, 1000 / fps / 2);

  // Nudge a repaint so the first frame (and t0) arrive promptly.
  await page.evaluate(() => document.body.style.setProperty('--tour-tick', '1')).catch(() => {});
  const startedAt = performance.now();
  while (t0 === null && performance.now() - startedAt < 10000) await new Promise((r) => setTimeout(r, 20));
  if (t0 === null) throw new Error('screencast produced no frames in 10 s');

  return {
    /** Seconds of video recorded so far - the timeline every scene mark uses. */
    now: () => (performance.now() - t0) / 1000,
    async stop() {
      pump();
      stopped = true;
      clearInterval(timer);
      await cdp.send('Page.stopScreencast').catch(() => {});
      ff.stdin.end();
      await ffDone;
      return written / fps;
    },
  };
}
