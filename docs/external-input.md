# Input from Other Software

Rhizomium can take **data** and **visuals** from other applications running at
the same time — TouchDesigner, Resolume, OBS, Max/MSP, a camera rig, a Python
script. Both are local-only: each arrives through a small bridge process,
because a browser tab cannot listen for UDP or receive NDI by itself. The
bridges — OSC in, Video In and NDI output — work only in the **desktop app**;
the web editor (in any browser, including a local dev server) never connects
to them.

| What | How it arrives | Bridge | In the editor |
| --- | --- | --- | --- |
| Data (numbers, faders, CHOP channels) | OSC over UDP, port 9000 | `osc_bridge_server.py` — starts with `npm run dev` | **Tools → OSC Receiver**, bind to any parameter |
| Visuals (a TOP, a camera, another app's output) | NDI, or frames pushed over WebSocket/HTTP, port 8769 | `video_in_bridge_server.py` — `npm run video-in` | the **Live Input** node |

## Data: OSC

Point any OSC sender at `udp://<this machine>:9000`, open
**Tools → OSC Receiver**, click **Connect**, and every address that arrives is
listed with its live value and a **Bind** button. The full guide is
[src/osc/README.md](https://github.com/amirashkan/rhizomium/blob/develop/src/osc/README.md).

**From TouchDesigner:** add an **OSC Out CHOP**, set *Network Address* to the
machine running Rhizomium (`127.0.0.1` for the same machine) and *Network Port*
to `9000`, and wire in the channels you want to send. Each channel arrives as
its own address — a channel named `level` becomes `/level` — so a whole CHOP
shows up in the *Channels* list at once, ready to bind.

## Visuals: the Live Input node

1. Start the bridge:

   ```bash
   npm run video-in
   ```

2. In the editor add **Texture → Live Input**, wire it in like a Texture 2D,
   and type the source's name into **Source**.

The node's thumbnail says what it is waiting for: *No bridge* (start it), or
*Waiting for "…"* (the bridge is up but has not seen that source yet — check
the name). From the shader's side a Live Input is an ordinary texture, so it
goes anywhere a Texture 2D does: into a Transform's *Texture* pin, a Projection
Map surface, a compute node, through a feedback loop.

**Fit** decides how the incoming frame's shape meets the output's: *stretch*
fills the frame, *contain* letterboxes, *cover* crops. The source's size is
read every frame, so it can change mid-show.

### Option A — NDI (recommended for TouchDesigner)

TouchDesigner, OBS, Resolume, vMix and most vision mixers can publish NDI.

1. Install the NDI runtime from <https://ndi.video/> and `pip install cyndilib`
   (the same two things NDI *output* needs). Without them the bridge still
   runs and the pushed-frame option below still works; its log says which is
   missing.
2. In TouchDesigner add an **NDI Out TOP** after the TOP you want to send and
   give it a name, e.g. `TouchDesigner`.
3. In Rhizomium set the Live Input's **Source** to that name.

NDI names on the network look like `STUDIO-PC (TouchDesigner)`. The part in
brackets is enough, and so is any part of the name that is unique. The bridge's
status page, <http://127.0.0.1:8769/>, lists every source it can see.

### Option B — push frames (no extra installs)

Anything that can open a WebSocket or make an HTTP request can send frames to
the bridge under a name it chooses. That name is what goes into **Source**.

| Send to | Each message |
| --- | --- |
| `ws://127.0.0.1:8769/publish/<name>` | one JPEG or PNG; or a JSON header `{"type":"frame","width":W,"height":H,"format":"rgba"}` followed by W×H×4 raw bytes |
| `ws://127.0.0.1:8769/` | the same, after a first message `{"type":"hello","name":"<name>"}` |
| `POST http://127.0.0.1:8769/publish/<name>` | the body is one JPEG or PNG |

**From TouchDesigner, without NDI:** add a **WebSocket DAT** with *Network
Address* `127.0.0.1` and *Network Port* `8769`. In its callbacks DAT, name the
stream when the connection opens:

```python
# websocket1_callbacks
def onConnect(dat):
    dat.sendText('{"type": "hello", "name": "TouchDesigner"}')
```

Then add an **Execute DAT** with *Frame End* turned on to send a TOP each frame:

```python
# Execute DAT — sends the TOP named 'out1' to Rhizomium
def onFrameEnd(frame):
    if frame % 2 == 0:  # every other frame is plenty for a 60 fps project
        op('websocket1').sendBinary(op('out1').saveByteArray('.jpg'))
```

JPEG keeps the bandwidth down; use `.png` if you need alpha. Set **Source** in
Rhizomium to `TouchDesigner`.

**From Python:**

```python
import asyncio, io, aiohttp
from PIL import Image

async def main():
    async with aiohttp.ClientSession() as s:
        ws = await s.ws_connect('http://127.0.0.1:8769/publish/MyScript')
        while True:
            buf = io.BytesIO()
            Image.new('RGB', (640, 360), (255, 80, 0)).save(buf, 'JPEG')
            await ws.send_bytes(buf.getvalue())
            await asyncio.sleep(1 / 30)

asyncio.run(main())
```

**From another machine:** start the bridge with
`python3 video_in_bridge_server.py --ws-host 0.0.0.0` and push to that
machine's address. (NDI already crosses the network without this.)

### Performance

Only the newest frame of each source is ever delivered; a slow link skips
frames instead of falling behind. Pushed JPEGs at 1080p are a few hundred KB
each. NDI frames reach the editor uncompressed (8 MB at 1080p), which is fine
on one machine; lower the pull rate with `--max-fps 30` if the editor is
struggling.

## Bridge reference

```bash
python3 video_in_bridge_server.py [--ws-host 127.0.0.1] [--ws-port 8769] [--max-fps 60] [--no-ndi]
```

- `http://127.0.0.1:8769/` — status page with the sources it can see
- `/health`, `/stats` — JSON, for scripts
- Browser connections are only accepted from the editor's own origins, like
  the other bridges; non-browser clients (TouchDesigner, scripts) are not
  checked.
