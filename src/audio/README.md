# src/audio

In-browser audio analysis. Everything here runs in the page: there is no audio
server to start (the Python server in the top-level `audio/` directory is a
separate, standalone tool the editor does not connect to).

For the artist-facing side see [docs/audio-web.md](../../docs/audio-web.md);
for why the drum meters work the way they do see
[docs/audio-analysis-design.md](../../docs/audio-analysis-design.md).

| File | What it owns |
|---|---|
| `BrowserAudioCapture.js` | The single audio source: a file, the microphone or shared system audio, played through one `AudioContext`. Holds the envelope `getAudioEnvelope()` returns to parameter expressions. |
| `RealtimeAudioAnalysis.js` | Per-frame analysis: band levels, instrument meters, spectral descriptors. Every value is for *this* frame. |
| `audioAnalysisDefaults.js` | Declarations of the analysis settings and their defaults. The live values belong to the **Audio** node's parameters, so they get MIDI learn, expressions and undo, and travel with the patch. |
| `audioAnalysisTaps.js` | The live value of every analysis channel. Audio Value nodes and the Audio panel's meters both read from here, so a meter shows exactly what a node outputs. |
| `audioDeck.js` | The Audio panel's transport, addressable by name so a performer set can play its own tracks. |
| `MusicalListener.js` | A rolling memory of the music over three timescales, described in prose for the co-performer. |
| `musicalListening.js` | The one `MusicalListener` instance, paid for only while something asks for it. |
| `recordingAudio.js` | Lends the loaded track to a `MediaRecorder`, so recordings of audio-driven patches are not silent. |

The per-frame step that turns the analysis into meters, drum envelopes and
triggers is `src/core/AudioAnalysisProcessor.js`; the panel is
`src/ui/AudioSettingsPanel.js`.

One Web Audio rule shapes `BrowserAudioCapture`: a media element can be passed
to `createMediaElementSource()` only once in its lifetime, so the capture keeps
one element and one source node and changes the element's `src` when a new
file loads.
