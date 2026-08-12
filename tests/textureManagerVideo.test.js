import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextureManager, isVideoSource } from '../src/core/TextureManager.js';

// The video path is exercised with a stand-in element: happy-dom has no decoder, and what we
// care about is the bookkeeping around it - which frames get copied, what gets released, and
// how parameters land on the element.
function fakeVideo({ width = 320, height = 180, readyState = 2, duration = 10 } = {}) {
  return {
    videoWidth: width,
    videoHeight: height,
    readyState,
    duration,
    currentTime: 0,
    paused: false,
    muted: true,
    loop: true,
    playbackRate: 1,
    play: vi.fn(function () { this.paused = false; return Promise.resolve(); }),
    pause: vi.fn(function () { this.paused = true; }),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  };
}

function fakeDevice() {
  let n = 0;
  return {
    createTexture: vi.fn(() => {
      const id = ++n;
      return { id, createView: () => ({ _view: id }), destroy: vi.fn() };
    }),
    createSampler: vi.fn(() => ({ _sampler: true })),
    queue: { copyExternalImageToTexture: vi.fn() },
  };
}

/** A TextureManager whose video loading is stubbed out, with the element it will hand back. */
function managerWithVideo(video = fakeVideo()) {
  const tm = new TextureManager();
  tm.device = fakeDevice();
  tm.loadVideo = vi.fn(async () => video);
  return { tm, video };
}

const videoFile = (name = 'clip.mp4', type = 'video/mp4', size = 1024) => ({ name, type, size });

beforeEach(() => {
  globalThis.window = globalThis.window || {};
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('isVideoSource', () => {
  it('detects video by MIME type', () => {
    expect(isVideoSource({ name: 'a.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoSource({ name: 'a.png', type: 'image/png' })).toBe(false);
  });

  it('falls back to the extension when the drop carries no type', () => {
    expect(isVideoSource({ name: 'clip.webm', type: '' })).toBe(true);
    expect(isVideoSource({ name: 'photo.jpg', type: '' })).toBe(false);
    expect(isVideoSource(null)).toBe(false);
  });
});

describe('TextureManager video upload', () => {
  it('registers a video source in both maps and invalidates the bind group', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => 'data:video/mp4;base64,AAA');
    tm.bindGroup = { stale: true };

    const info = await tm.uploadTexture('node_3', videoFile());

    expect(info).toMatchObject({ isVideo: true, width: 320, height: 180, filename: 'clip.mp4' });
    expect(info.video).toBe(video);
    expect(tm.getTexture('node_3').isVideo).toBe(true);
    expect(tm.gpuTextures.get('node_3')).toMatchObject({ width: 320, height: 180 });
    expect(tm.isVideoTexture('node_3')).toBe(true);
    expect(tm.bindGroup).toBeNull();
    // The first frame is on the GPU before any render tick runs.
    expect(tm.device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
  });

  it('inlines the file for saving only under the size cap', async () => {
    const { tm } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => 'data:video/mp4;base64,AAA');

    const small = await tm.uploadTexture('a', videoFile('small.mp4', 'video/mp4', 1024));
    expect(small.dataUrl).toBe('data:video/mp4;base64,AAA');

    const huge = await tm.uploadTexture('b', videoFile(
      'huge.mp4', 'video/mp4', TextureManager.MAX_INLINE_VIDEO_BYTES + 1,
    ));
    // Too big to carry in a patch: playable now, and the node keeps the filename.
    expect(huge.dataUrl).toBeNull();
    expect(huge.filename).toBe('huge.mp4');
  });

  it('reuses a caller-supplied data URL instead of re-encoding (patch restore)', async () => {
    const { tm } = managerWithVideo();
    tm.fileToDataUrl = vi.fn();

    const info = await tm.uploadVideo('n', videoFile(), { dataUrl: 'data:video/mp4;base64,ZZZ' });

    expect(info.dataUrl).toBe('data:video/mp4;base64,ZZZ');
    expect(tm.fileToDataUrl).not.toHaveBeenCalled();
  });

  it('revokes the object URL when the file cannot be decoded', async () => {
    const tm = new TextureManager();
    tm.device = fakeDevice();
    tm.loadVideo = vi.fn(async () => { throw new Error('unsupported format'); });

    await expect(tm.uploadVideo('n', videoFile())).rejects.toThrow('unsupported format');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(tm.videos.size).toBe(0);
  });
});

describe('TextureManager.updateVideoTextures', () => {
  it('copies a frame only when the video has advanced', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());
    const copy = tm.device.queue.copyExternalImageToTexture;
    copy.mockClear();

    // Same frame: nothing to re-upload.
    tm.updateVideoTextures();
    expect(copy).not.toHaveBeenCalled();

    video.currentTime = 0.033;
    tm.updateVideoTextures();
    expect(copy).toHaveBeenCalledTimes(1);

    video.currentTime = 0.066;
    tm.updateVideoTextures();
    expect(copy).toHaveBeenCalledTimes(2);
  });

  it('skips a video that has no decoded frame yet', async () => {
    const { tm, video } = managerWithVideo(fakeVideo({ readyState: 0, width: 0, height: 0 }));
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());
    tm.device.queue.copyExternalImageToTexture.mockClear();

    tm.updateVideoTextures();
    expect(tm.device.queue.copyExternalImageToTexture).not.toHaveBeenCalled();

    // Once it reports a frame, the texture is created and the frame lands.
    Object.assign(video, { readyState: 2, videoWidth: 64, videoHeight: 64, currentTime: 0.5 });
    tm.updateVideoTextures();
    expect(tm.device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    expect(tm.gpuTextures.get('n')).toMatchObject({ width: 64, height: 64 });
  });

  it('keeps the same GPU texture across frames so bind groups stay valid', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    const first = tm.gpuTextures.get('n').texture;
    video.currentTime = 1;
    tm.updateVideoTextures();
    video.currentTime = 2;
    tm.updateVideoTextures();

    expect(tm.gpuTextures.get('n').texture).toBe(first);
    expect(tm.bindGroup).toBeNull(); // only nulled by the initial creation
  });
});

describe('TextureManager.applyVideoParams', () => {
  it('maps node parameters onto the element, tolerating saved strings', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    tm.applyVideoParams('n', { playing: false, loop: 'false', playbackRate: '2', sound: true });

    expect(video.paused).toBe(true);
    expect(video.loop).toBe(false);
    expect(video.playbackRate).toBe(2);
    expect(video.muted).toBe(false);

    tm.applyVideoParams('n', { playing: true, loop: true, playbackRate: 1, sound: false });
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(true);
  });

  it('does not restart a clip that played out, however often the parameters are re-applied', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    // A non-looping clip reaching its natural end: the element pauses itself and reports `ended`.
    Object.assign(video, { paused: true, ended: true, currentTime: 10 });
    video.play.mockClear();

    // Every recompile and preview update re-applies the same parameters.
    tm.applyVideoParams('n', { playing: true, loop: false });
    tm.applyVideoParams('n', { playing: true, loop: false });

    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(10);
  });

  it('resumes a video that was paused for no reason of its own', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    // e.g. autoplay was refused at load time.
    video.paused = true;
    tm.applyVideoParams('n', { playing: true });

    expect(video.paused).toBe(false);
  });

  it('clamps a rate the media element would reject', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    tm.applyVideoParams('n', { playbackRate: -4 });
    expect(video.playbackRate).toBeGreaterThan(0);

    tm.applyVideoParams('n', { playbackRate: 1000 });
    expect(video.playbackRate).toBe(16);
  });

  it('is a no-op for a node with no video', () => {
    const tm = new TextureManager();
    expect(() => tm.applyVideoParams('nope', { playing: false })).not.toThrow();
  });
});

describe('trimming a video to part of the clip', () => {
  /** A manager holding one 10-second clip, trimmed to the given span. */
  async function trimmed(params) {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());
    tm.applyVideoParams('n', { playing: true, loop: true, ...params });
    return { tm, video };
  }

  it('jumps to Trim Start when playback is before the span', async () => {
    const { tm, video } = await trimmed({ trimStart: 2, trimEnd: 5 });
    expect(video.currentTime).toBe(0);

    tm.updateVideoTextures();

    expect(video.currentTime).toBe(2);
  });

  it('loops back to Trim Start at the end of the span, not to zero', async () => {
    const { tm, video } = await trimmed({ trimStart: 2, trimEnd: 5 });
    tm.updateVideoTextures();

    video.currentTime = 5.01;
    tm.updateVideoTextures();

    expect(video.currentTime).toBe(2);
    // The element's own looping would have gone back to 0, so it is off while a span is in force.
    expect(video.loop).toBe(false);
  });

  it('holds on the last frame of the span when Loop is off', async () => {
    const { tm, video } = await trimmed({ trimStart: 1, trimEnd: 4, loop: false });
    video.currentTime = 4.2;

    tm.updateVideoTextures();

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(4);
  });

  it('treats Trim End 0 as the end of the clip', async () => {
    const { tm, video } = await trimmed({ trimStart: 3, trimEnd: 0 });
    tm.updateVideoTextures();
    expect(video.currentTime).toBe(3);

    video.currentTime = 9.99;
    tm.updateVideoTextures();
    expect(video.currentTime).toBe(9.99); // still inside the span, which runs to the clip's end
  });

  it('leaves an untrimmed clip entirely alone, element looping included', async () => {
    const { tm, video } = await trimmed({});
    video.currentTime = 7;
    tm.updateVideoTextures();

    expect(video.currentTime).toBe(7);
    expect(video.loop).toBe(true);
  });

  it('ignores a span that makes no sense rather than freezing the clip', async () => {
    const { tm, video } = await trimmed({ trimStart: 8, trimEnd: 3 });
    video.currentTime = 1;
    tm.updateVideoTextures();
    expect(video.currentTime).toBe(1);

    // ...including a start past the end of the clip.
    tm.applyVideoParams('n', { playing: true, loop: true, trimStart: 30, trimEnd: 0 });
    video.currentTime = 2;
    tm.updateVideoTextures();
    expect(video.currentTime).toBe(2);
  });

  it('restarts the span when Play is pressed again on a clip parked at the end', async () => {
    const { tm, video } = await trimmed({ trimStart: 1, trimEnd: 4, loop: false });
    const span = { loop: false, trimStart: 1, trimEnd: 4 };
    video.currentTime = 4.5;
    tm.updateVideoTextures();
    expect(video.paused).toBe(true); // holding at the end of the span

    // Anything else in the patch changing re-applies the same parameters; the hold must survive it.
    tm.applyVideoParams('n', { playing: true, ...span });
    expect(video.paused).toBe(true);

    // An actual press - off, then on - starts the span again.
    tm.applyVideoParams('n', { playing: false, ...span });
    tm.applyVideoParams('n', { playing: true, ...span });
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(1);
  });

  it('releases the hold when the trim is cleared altogether', async () => {
    const { tm, video } = await trimmed({ trimStart: 1, trimEnd: 4, loop: false });
    video.currentTime = 4.5;
    tm.updateVideoTextures();
    expect(video.paused).toBe(true);

    tm.applyVideoParams('n', { playing: true, loop: true, trimStart: 0, trimEnd: 0 });

    expect(video.paused).toBe(false);
    expect(video.loop).toBe(true); // the element gets its own looping back
  });

  it('releases the hold when the span is widened past where it stopped', async () => {
    const { tm, video } = await trimmed({ trimStart: 1, trimEnd: 4, loop: false });
    video.currentTime = 4.5;
    tm.updateVideoTextures();
    expect(video.paused).toBe(true);

    tm.applyVideoParams('n', { playing: true, loop: false, trimStart: 1, trimEnd: 8 });

    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(4); // carries on from where it was holding
  });
});

describe('TextureManager video cleanup', () => {
  it('stops the decoder and revokes the URL when the node is removed', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    tm.removeTexture('n');

    expect(video.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(tm.videos.size).toBe(0);
    expect(tm.gpuTextures.has('n')).toBe(false);
    expect(tm.textures.has('n')).toBe(false);
  });

  it('releases the previous video when the same node loads another file', async () => {
    const first = fakeVideo();
    const { tm } = managerWithVideo(first);
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile('one.mp4'));

    const second = fakeVideo({ width: 640, height: 360 });
    tm.loadVideo = vi.fn(async () => second);
    await tm.uploadTexture('n', videoFile('two.mp4'));

    expect(first.pause).toHaveBeenCalled();
    expect(tm.videos.size).toBe(1);
    expect(tm.getTexture('n').video).toBe(second);
    expect(tm.gpuTextures.get('n')).toMatchObject({ width: 640, height: 360 });
  });

  it('releases the video when the node switches back to a still image', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => 'data:image/png;base64,AAA');
    await tm.uploadTexture('n', videoFile());

    tm.loadImage = vi.fn(async () => ({ width: 8, height: 8 }));
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 8, height: 8 }));
    await tm.uploadTexture('n', { name: 'still.png', type: 'image/png', size: 10 });

    expect(video.pause).toHaveBeenCalled();
    expect(tm.isVideoTexture('n')).toBe(false);
    expect(tm.getTexture('n').isVideo).toBeUndefined();
  });

  it('destroy() stops every playing video', async () => {
    const { tm, video } = managerWithVideo();
    tm.fileToDataUrl = vi.fn(async () => null);
    await tm.uploadTexture('n', videoFile());

    tm.destroy();

    expect(video.pause).toHaveBeenCalled();
    expect(tm.videos.size).toBe(0);
  });
});
