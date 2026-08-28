# NDI Output

Publishes the rendered output onto the network as an NDI source, so a vision
mixer, OBS, Resolume or a monitor on another machine can subscribe to it.

## Why there is a bridge

NDI is a native protocol. It announces itself over mDNS and moves frames over
raw TCP/UDP — none of which a browser tab can do, however the page is served.
So the editor cannot be an NDI source by itself, and this feature is split in
two:

| Piece | Where | Job |
| --- | --- | --- |
| `src/output/NDIOutput.js` | editor | takes frames off the renderer, converts to RGBA, sends them |
| `ndi_bridge_server.py` | local process | owns the NDI sender and publishes to the network |

They talk over a loopback WebSocket on port **8768**, one past the OSC bridge.
This is the same arrangement as OSC — a local process owning the socket a
browser cannot open — with the direction reversed: OSC reads from its bridge,
NDI writes to one.

Because the bridge is a local process, NDI is a local-only feature like the
external viewer. It cannot work on the static web deploy.

## Setup

NDI needs two things this repo does not vendor:

1. **The NDI runtime**, from <https://ndi.video/>. A native library, distributed
   by Vizrt under their own licence.
2. **The `cyndilib` binding**: `pip install cyndilib`.

Both are optional. With either missing the bridge still starts, still accepts
the editor's connection, and reports *which* one is missing — so the editor can
tell the artist what to install rather than showing them a toggle that does
nothing.

Then:

```bash
npm run ndi          # or: python3 ndi_bridge_server.py --source-name "Stage Left"
```

and in the editor, **View → NDI Output** (`Mod+Shift+N`). The name receivers
list you under is the **NDI Name** field beside it, and can be changed while
running.

NDI output is a Cloude Plus entitlement, gated through `requireOutputFeature`
like the second-monitor viewer. Stopping is never gated: a tier that lapses
mid-show must not strand a source published on the network with no way to take
it down.

## The frame path

Frames come from `GPURenderer.addFrameTap()`, not from reading `#gpu-canvas`
directly. That matters: reading the canvas from an animation frame of our own
races the compositor, which recycles the swapchain buffer once it has
presented, so those reads intermittently come back blank. The tap captures
synchronously right after `queue.submit()`, the only moment the frame is
reliably still there.

`addFrameTap` rather than `setFrameTap` because the second-monitor viewer owns
the single `setFrameTap` slot, and driving a projector *and* a vision mixer
from one patch is a normal thing to want. Consumers each receive their own
`ImageBitmap` and must close it; the renderer only copies when more than one
consumer is attached, so a single output costs exactly what it did before.

## Wire protocol

Editor → bridge, over `ws://127.0.0.1:8768/ws`:

```jsonc
// on connect, bridge → editor
{"type": "welcome", "ndi_available": true, "ndi_error": null,
 "source_name": "Rhizomium", "frame_rate": 30}

// each frame: a header, then the pixels as one binary message
{"type": "frame", "width": 1920, "height": 1080, "format": "rgba"}
<width * height * 4 bytes>

// settings
{"type": "set_source_name", "name": "Stage Left"}
{"type": "set_frame_rate", "fps": 30}
```

The header-then-binary shape is the one `frame_stream_server.py` already uses,
so both ends of the project describe a frame the same way.

The bridge validates every header before it allocates: the payload length must
equal `width × height × 4`, the format must be RGBA, and the frame must be
within `MAX_FRAME_PIXELS`. A mismatch is counted and dropped, never guessed at.

## What it costs

Raw RGBA is not cheap: 1920×1080 is 8.3 MB per frame, so 30 fps is ~250 MB/s
over loopback. Two things keep that from becoming a problem:

- **The rate is throttled** to the target fps (default 30) rather than sending
  every presented frame, which can be well above it.
- **Frames are dropped, not queued**, once the socket has more than 16 MB
  buffered. Late video is worse than missing video on a live output, and a
  socket that stalls for a moment can otherwise bank hundreds of megabytes of
  stale frames that arrive out of step with what is on screen.

If you need to cut the bandwidth further, lower the frame rate before reaching
for compression: an encode/decode round trip costs latency, which is the one
thing a live output cannot spend.

## Diagnostics

The bridge serves the same endpoints as the other local servers:

```bash
curl http://127.0.0.1:8768/health   # is it up, and is NDI available
curl http://127.0.0.1:8768/stats    # frames in, frames sent, drops, fps
```

`stats` separates `frame_count` (what the editor sent), `frames_sent` (what
reached NDI) and `rejected_count` (headers that did not describe their
payload) — enough to tell "the editor is not sending" from "NDI is refusing"
without attaching a receiver.

## Security

The WebSocket is loopback-only and origin-checked against the same
`ALLOWED_ORIGINS` as `rhizo_server.py`, `frame_stream_server.py` and
`osc_bridge_server.py`. WebSockets are not subject to the same-origin policy,
and this one publishes whatever it is sent to every machine on the network, so
a request carrying a browser `Origin` must name one the editor is served from.
Non-browser clients (no `Origin` header) are left alone so scripts and native
tools still work.
