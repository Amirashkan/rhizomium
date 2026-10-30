# NDI Output

Publishes the rendered output onto the network as an NDI source, so a vision
mixer, OBS, Resolume or a monitor on another machine can subscribe to it.

## How it reaches the network

NDI is a native protocol. It announces itself over mDNS and moves frames over
raw TCP/UDP — none of which a webview can do. So NDI is a **desktop app**
feature, split in two:

| Piece | Where | Job |
| --- | --- | --- |
| `src/output/NDIOutput.js` | editor | takes frames off the renderer, converts to RGBA, sends them |
| `src-tauri/src/bridge/video.rs` | the app | owns the NDI sender and publishes to the network |

They talk over the app's loopback WebSocket, `ws://127.0.0.1:8767/video` —
the same socket Live Input nodes receive NDI on, so NDI in and NDI out are one
feature of the app, not two. Nothing has to be started: the app opens it when
NDI output is switched on, and the NDI source exists only while frames are
going out.

## Setup

**View → NDI Output** (`Mod+Shift+N`). The name receivers list you under is
the **NDI Name** field beside it, and can be changed while running.

NDI itself is Vizrt's library, the **NDI Runtime**. The Windows installer
ships it in the app's own `ndi` folder, so NDI works with nothing else
installed; the app loads it when NDI is first used. Release builds fetch it per
build (`scripts/fetch-ndi-runtime.ps1`, bundled through
`src-tauri/tauri.ndi.conf.json`) — it is Vizrt's file under the NDI SDK
licence and is never committed.

A build without it (`npm run tauri:dev`, or `tauri build` without that config)
uses a system-wide NDI Runtime if there is one. With neither, switching NDI
output on says so and offers **Get NDI Runtime**, which opens the official
download; once installed it is picked up without a restart, and output that
was left on starts sending.

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

Editor ↔ app, over `ws://127.0.0.1:8767/video`:

```jsonc
// on connect, app → editor
{"type": "welcome", "ndi_available": true, "ndi_error": null,
 "ndi_runtime_url": "https://ndi.link/NDIRedistV6",
 "source_name": "Rhizomium", "frame_rate": 30, "sources": [...]}

// each frame: a header, then the pixels as one binary message
{"type": "frame", "width": 1920, "height": 1080, "format": "rgba"}
<width * height * 4 bytes>

// settings
{"type": "set_source_name", "name": "Stage Left"}
{"type": "set_frame_rate", "fps": 30}
```

The header-then-binary shape is the one `frame_stream_server.py` already uses,
so both ends of the project describe a frame the same way.

The app validates every header before it allocates: the payload length must
equal `width × height × 4`, the format must be RGBA, and the frame must be
within `MAX_FRAME_PIXELS`. A mismatch is answered with an `error` message and
dropped, never guessed at. Sending runs on its own thread; a frame that arrives
while the previous one is still going out is skipped rather than queued.

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

## Security

The WebSocket is loopback-only and origin-checked: a request carrying a
browser `Origin` must come from the editor itself. WebSockets are not subject
to the same-origin policy, and this one publishes whatever it is sent to every
machine on the network. Non-browser clients (no `Origin` header) are left alone
so scripts and native tools still work.
