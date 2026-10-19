# Tutorial video

Records a narrated feature tour of the editor: about ten minutes and
eighteen chapters, from building a first graph to projection mapping and NDI.
A real browser plays the tour against the live editor while it is screen
recorded. The voice is generated offline by [Piper](https://github.com/OHF-Voice/piper1-gpl),
a neural text-to-speech engine. Then the two are laid together by timestamp.

The output in `build/`:

| File | What it is |
| --- | --- |
| `rhizomium-tour.mp4` | 1080p H.264 video, AAC narration, chapters, and a soft English subtitle track |
| `rhizomium-tour.srt` | The subtitles on their own, for YouTube or Vimeo |
| `chapters.txt` | Chapter timestamps to paste into a video description |

## Run it

Run it on a machine with a real GPU. The previews are the point of the video,
and a GPU-less machine (a CI runner, a cloud container) records the editor with
black previews.

You need **Node 20+**, **ffmpeg** on the `PATH`, **Python 3.9+**, and
**Chrome or Edge**.

```bash
npm install                        # the repo's own dependencies, if not done
npm i --no-save playwright-core    # drives the browser; not a repo dependency
pip install piper-tts              # the voice

node scripts/tutorial-video/make.mjs
```

The script starts the dev server if nothing is serving the editor yet, and
downloads the default voice (`en_US-lessac-medium`, about 60 MB) once. A
browser window opens and plays the tour. **Leave it alone while it runs**: the
recording is real time, and a click or a window on top of it ends up in the
video.

On Windows, ffmpeg is `winget install Gyan.FFmpeg` and Python is from
python.org or `winget install Python.Python.3.12`. If `python` isn't the
interpreter you installed Piper into, pass `--python py` or a full path.

## Options

| Option | Default | |
| --- | --- | --- |
| `--only welcome,audio` | all | Record just these scenes (ids in `scenes.mjs`) |
| `--captions burn` | `soft` | `soft`: a subtitle track the player can toggle. `burn`: drawn into the picture. `none` |
| `--audio-file song.wav` | | Fed to the page as the microphone, so the audio chapter has something to react to. The music is not mixed into the video |
| `--browser msedge` | Chrome, then Edge | `chrome`, `msedge`, or a path to any Chromium binary |
| `--voice path.onnx` | lessac | Any Piper voice, from [the voice list](https://huggingface.co/rhasspy/piper-voices) (with its `.onnx.json` beside it) |
| `--length-scale 1.1` | `1.05` | Speaking pace: above 1 is slower |
| `--size 2560x1440` | `1920x1080` | Recording size |
| `--fps 60` | `30` | |
| `--url …` | `http://localhost:5173/editor/index.html` | Where the editor is served |
| `--skip-record` | | Re-assemble the last recording, for example after changing `--captions` |
| `--no-voice` | | Dry run: timings estimated from word count, no Piper needed |
| `--headless`, `--args "…"`, `--hide-errors` | | For recording on a machine without a display |

## How the voice stays in sync

Each scene's narration is voiced sentence by sentence, so the start of every
sentence is known before recording begins. A scene's actions wait for the
sentence that describes them (`await d.at(3)` holds until sentence 3 starts).
The recorder encodes frames at a constant rate paced by the wall clock, so a
second of video is a second of real time. The narration track is then built by
writing each sentence's audio at the moment its scene reached it. If an action
runs long, the scene simply runs longer, and the voice waits for it.

## Changing the tour

Everything is in `scenes.mjs`: one entry per chapter, with its narration
(`say`) and its actions (`run`). The helpers available inside `run` are in
`lib/director.mjs`:

- **Timing:** `at(n)`, `wait(s)`
- **Mouse:** `move`, `click`, `rightClick`, `dblclick`, `drag`, `pan`, `zoom`
- **Keyboard:** `type`, `key`
- **Editor:** `menu`, `closeMenus`, `closeWindow`, `addNode`, `wire`,
  `openParams`, `setParam`, `paramBlock`, `loadStarter`, `frameAll`
- **Overlays:** `highlight`, `clearHighlights`, `chapter`, `card`

Pins, nodes and graph coordinates are resolved through the editor's own
geometry, so a scene keeps working when nodes move.

An action that can't find its target logs a warning and the tour carries on.
Check the end of the run for the list of warnings.

Narration is cached per sentence in `build/cache/`, so changing one line only
re-voices that line. If Piper mispronounces a word, add it to `lexicon` at the
top of `scenes.mjs`. Captions keep the written form.
