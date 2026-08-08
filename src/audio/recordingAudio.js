/**
 * recordingAudio.js - Lend the loaded audio track to a MediaRecorder capture.
 *
 * The editor already plays the artist's audio file through an AudioContext to
 * drive the audio-reactive nodes (see BrowserAudioCapture). A canvas capture
 * stream carries pixels only, so a recording of an audio-driven patch arrived
 * silent — the visuals danced to music the viewer could not hear.
 *
 * Tapping the same graph hands the recorder exactly the audio the visuals are
 * reacting to, already in sync, without asking the artist for a second source
 * or a screen-share permission.
 *
 * Container choice lives here too: whether a video file can carry an audio
 * track at all is a property of the mime type, and the two decisions have to
 * agree — an audio track in a video-only container is silently discarded.
 */

/** Bits per second for the recorded audio track. Transparent enough for music. */
export const AUDIO_BITRATE = 128_000;

// Containers that carry video and audio together. MP4/H.264+AAC first for the
// same reason as the video-only list: it plays everywhere the gallery does.
const AUDIO_VIDEO_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D001E,mp4a.40.2',
  'video/mp4;codecs=avc1.64001E,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,vorbis',
  'video/webm',
];

const VIDEO_ONLY_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.4D001E',
  'video/mp4;codecs=avc1.64001E',
  'video/mp4;codecs=h264',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function isSupported(candidate) {
  try {
    return MediaRecorder.isTypeSupported(candidate);
  } catch {
    return false;
  }
}

/**
 * Pick the best container this browser will record.
 *
 * `withAudio` picks from the list whose codec strings name an audio codec, so
 * the recorder is told up front to make room for the track. Returns null when
 * nothing is supported, which the caller reports as a browser limitation.
 */
export function selectRecordingMimeType({ withAudio = false } = {}) {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = withAudio ? AUDIO_VIDEO_CANDIDATES : VIDEO_ONLY_CANDIDATES;
  return candidates.find(isSupported) || null;
}

/**
 * Add a frame-rate hint to a mime type, keeping the playback speed correct in
 * MP4 — but only if the browser accepts the codecs alongside it.
 *
 * The hint is never worth paying for with the codec list: dropping back to a
 * bare `video/mp4;framerate=30` leaves the audio codec to the browser's
 * default, which is how a recording ends up silent despite carrying a track.
 */
export function applyFrameRate(mimeType, fps) {
  if (!mimeType || typeof MediaRecorder === 'undefined') return mimeType;
  const withRate = `${mimeType};framerate=${fps}`;
  return isSupported(withRate) ? withRate : mimeType;
}

/** Is there a loaded audio file whose playback we could record? */
export function hasRecordableAudio(capture) {
  return !!(capture?.audioContext && capture?.source && capture?.audioElement);
}

/**
 * Open a tap on the audio graph and return a handle over it.
 *
 * The tap branches off the source node rather than the analyser: the analyser
 * is a measurement branch whose smoothing and FFT settings the artist changes
 * mid-session to tune reactivity, and none of that should reach the recording.
 * Branching leaves the audible path untouched — the artist still hears the
 * track normally while it records.
 *
 * Returns null when there is nothing to record. The handle's `startPlayback()`
 * is separate so the caller can hold the track through its setup work and only
 * roll the music when the recorder is actually about to start.
 */
export async function openAudioTap(capture) {
  if (!hasRecordableAudio(capture)) return null;

  const context = capture.audioContext;
  if (typeof context.createMediaStreamDestination !== 'function') return null;

  // A context suspended by the autoplay policy produces a track of silence.
  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch (err) {
      console.warn('Could not resume the audio context for recording:', err);
    }
  }

  const destination = context.createMediaStreamDestination();
  capture.source.connect(destination);

  const track = destination.stream.getAudioTracks()[0] || null;
  if (!track) {
    try {
      capture.source.disconnect(destination);
    } catch {
      // Nothing to unwind if the connection never took.
    }
    return null;
  }

  let startedPlayback = false;
  let resumePosition = 0;

  return {
    track,

    /**
     * Make sure the track is actually playing, starting it from wherever the
     * artist left the playhead. Resolves true when this call started it, so a
     * track that was already playing is left alone on the way out.
     */
    async startPlayback() {
      if (capture.getIsPlaying?.()) return false;
      resumePosition = capture.audioElement?.currentTime ?? 0;
      await capture.play();
      startedPlayback = true;
      return true;
    },

    /**
     * Undo everything the tap did: drop the branch, end the track, and put
     * playback back where it was. Recording must not leave the artist's
     * playhead somewhere they did not put it.
     */
    stop() {
      try {
        capture.source.disconnect(destination);
      } catch {
        // Already disconnected - the context may have been torn down.
      }
      try {
        track.stop();
      } catch {
        // An ended track is fine.
      }
      if (startedPlayback) {
        startedPlayback = false;
        try {
          capture.pause();
          if (capture.audioElement) capture.audioElement.currentTime = resumePosition;
        } catch (err) {
          console.warn('Could not restore audio playback state after recording:', err);
        }
      }
    },
  };
}
