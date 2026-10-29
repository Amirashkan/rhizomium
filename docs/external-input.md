# Input from Other Software

Rhizomium can take **data** and **visuals** from other applications running at
the same time — TouchDesigner, Resolume, OBS, Max/MSP, a camera rig, a Python
script — and send its own output out over NDI. All of this is part of the
**desktop app**: there is nothing to start or install for OSC or pushed frames,
and the app switches each feature on by itself the moment a patch uses it. The
web editor cannot do any of it — a browser tab cannot listen for UDP or speak
NDI.

| What | How it arrives | In the editor |
| --- | --- | --- |
| Data (numbers, faders, CHOP channels) | OSC over UDP, port 9000 | **Tools → OSC Receiver**, bind to any parameter |
| Visuals (a TOP, a camera, another app's output) | NDI, or frames pushed to `127.0.0.1:8767` | the **Live Input** node |
| Rhizomium's own output, to other software | NDI | **View → NDI Output** |

NDI needs Vizrt's free **NDI Runtime** on the computer (anything that already
does NDI — NDI Tools, OBS with NDI, TouchDesigner — has usually installed it).
When it is missing Rhizomium says so and offers the download; it is picked up
as soon as it is installed, without restarting.

## Data: OSC

Point any OSC sender at `udp://<this machine>:9000` and open
**Tools → OSC Receiver**: every address that arrives is listed with its live
value and a **Bind** button. OSC switches on by itself when a patch has OSC
bindings or OSC learn starts, so a saved patch with OSC mappings responds as
soon as it is opened. The full guide is
[src/osc/README.md](https://github.com/amirashkan/rhizomium/blob/develop/src/osc/README.md).

**From TouchDesigner:** add an **OSC Out CHOP**, set *Network Address* to the
machine running Rhizomium (`127.0.0.1` for the same machine) and *Network Port*
to `9000`, and wire in the channels you want to send. Each channel arrives as
its own address — a channel named `level` becomes `/level` — so a whole CHOP
shows up in the *Channels* list at once, ready to bind.

## Visuals: the Live Input node

Add **Texture → Live Input**, wire it in like a Texture 2D, and type the
source's name into **Source**. That is all: the app starts receiving as soon as
the node has a source, and stops when the node goes.

The node's thumbnail says what it is waiting for: *Waiting for "…"* means the
app has not seen that source yet — check the name, and if it is an NDI source,
that the NDI Runtime is installed (the reason is shown when it is not). From
the shader's side a Live Input is an ordinary texture, so it goes anywhere a
Texture 2D does: into a Transform's *Texture* pin, a Projection Map surface, a
compute node, through a feedback loop.

**Fit** decides how the incoming frame's shape meets the output's: *stretch*
fills the frame, *contain* letterboxes, *cover* crops. The source's size is
read every frame, so it can change mid-show.

### Option A — NDI (recommended for TouchDesigner)

TouchDesigner, OBS, Resolume, vMix and most vision mixers can publish NDI.

1. Have the NDI Runtime installed (see above). Without it the pushed-frame
   option below still works.
2. In TouchDesigner add an **NDI Out TOP** after the TOP you want to send and
   give it a name, e.g. `TouchDesigner`.
3. In Rhizomium set the Live Input's **Source** to that name.

NDI names on the network look like `STUDIO-PC (TouchDesigner)`. The part in
brackets is enough, and so is any part of the name that is unique.

### Option B — push frames (no extra installs)

Anything on the same computer that can open a WebSocket or make an HTTP
request can send frames to Rhizomium under a name it chooses. That name is what
goes into **Source**. Rhizomium must be open with a Live Input in the patch (or
OSC or NDI output in use) for the address to answer.

| Send to | Each message |
| --- | --- |
| `ws://127.0.0.1:8767/publish/<name>` | one JPEG or PNG; or a JSON header `{"type":"frame","width":W,"height":H,"format":"rgba"}` followed by W×H×4 raw bytes |
| `ws://127.0.0.1:8767/` | the same, after a first message `{"type":"hello","name":"<name>"}` |
| `POST http://127.0.0.1:8767/publish/<name>` | the body is one JPEG or PNG |

**From TouchDesigner, without NDI:** add a **WebSocket DAT** with *Network
Address* `127.0.0.1` and *Network Port* `8767`. In its callbacks DAT, name the
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
        ws = await s.ws_connect('http://127.0.0.1:8767/publish/MyScript')
        while True:
            buf = io.BytesIO()
            Image.new('RGB', (640, 360), (255, 80, 0)).save(buf, 'JPEG')
            await ws.send_bytes(buf.getvalue())
            await asyncio.sleep(1 / 30)

asyncio.run(main())
```

**From another machine:** use NDI, which crosses the network by design. The
push address only listens on this computer.

### Performance

Only the newest frame of each source is ever delivered; a slow link skips
frames instead of falling behind. Pushed JPEGs at 1080p are a few hundred KB
each. NDI frames reach the editor uncompressed (8 MB at 1080p) at up to 60 fps.

## Reference

The desktop app serves all of this from one loopback address,
`127.0.0.1:8767`, opened the first time a patch uses OSC, NDI output or a Live
Input (src-tauri/src/bridge):

- `ws://127.0.0.1:8767/publish/<name>`, `ws://127.0.0.1:8767/`,
  `POST http://127.0.0.1:8767/publish/<name>` — pushing frames, as above.
- Browser connections are only accepted from the editor itself; non-browser
  clients (TouchDesigner, scripts) are not checked.
