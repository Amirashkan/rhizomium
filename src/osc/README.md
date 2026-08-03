# OSC Receiver

Real-time parameter control from any OSC sender — TouchOSC, Lemur, Max/MSP,
SuperCollider, Resolume, Ableton via a Max device, or a five-line Python script.

## Why there is a bridge

OSC is carried over UDP, and a browser cannot open a UDP socket. There is no
"Web OSC API" the way there is a Web MIDI API, so the editor cannot hear an OSC
sender directly no matter what it does.

A small Python bridge (`osc_bridge_server.py`) owns the UDP socket and forwards
each datagram, byte for byte, to the editor over a WebSocket. Nothing is
re-encoded on the way, so the editor decodes the real OSC wire format and any
sender works without agreeing on a private JSON envelope first.

```
OSC sender ──UDP:9000──> osc_bridge_server.py ──WebSocket:8767──> OSCManager
                                                                      │
                                                                 OSCDecoder
                                                                      │
                                                              OSCParameterBinding
                                                                      │
                                                              GPU uniform write
```

## Quick start

1. Start the editor whichever way you normally do — the bridge comes with it:

   | How you run the editor | Bridge |
   | --- | --- |
   | `python rhizo_server.py` | started by the server |
   | `npm run dev` | started by the Vite dev server |
   | `npm run tauri:dev` | same — the desktop app runs that dev server |
   | a built desktop binary | run `npm run osc` alongside it |
   | static web deploy (Vercel) | not possible — OSC is local-only |

   Each prints the UDP port to aim at:

   ```
   OSC:
     Send OSC to:   udp://<this machine>:9000
   ```

   Set `RHIZO_NO_OSC=1` to stop the dev server starting one, and it will leave
   an already-running bridge alone rather than fighting it for the port.

2. Open the editor and choose **Tools → OSC Receiver**, then click **Connect**.
   Incoming addresses appear as soon as anything arrives, which is the fastest
   way to confirm your sender is pointed at the right machine.

3. Map a control. Select a node, click the parameter field you want to drive,
   then either:
   - press **Bind** next to the channel in the panel's *Channels* list, or
   - click **Start OSC Learn** and move the control on your sender.

## Mapping several channels

A MIDI controller has a handful of CCs you learn one at a time. An OSC source
sends a rack of channels at once, and the panel is built for that.

**Every channel is visible before you map anything.** As soon as your sender
touches a channel it appears in *Channels* with its live value, so a rack shows
up as `/vcv/ch0`…`/vcv/ch7` and you map by reading rather than by wiggling
controls one at a time to find out which is which. A **Bind** button on each
channel maps it to whatever parameter is selected; the button turns green once
that channel drives something, and each channel lists the parameters it is
driving underneath. Use the filter box when the list gets long.

The list is ordered by address and stays put — sorted numerically, so `ch2`
comes before `ch10`. It does not reshuffle by activity, because a channel you
are reaching for should not move while you reach for it.

**Learn waits for movement, not for traffic.** A modular rack or a DAW streams
every channel continuously, so binding whatever arrives next would map a random
channel microseconds after arming. Learn snapshots what each channel is sending
when you arm it and ignores anything holding still — the channel you *move* is
the one that binds. The threshold scales with the values a channel sends, so it
works the same for a 0-1 fader and a 0-127 source. Senders that stay quiet until
touched (TouchOSC and friends) still bind on their first message, since there is
nothing to hold still.

**Keep armed** turns learn continuous. Arm it once, then: select a parameter,
move a control, select the next parameter, move the next control. Between maps
the panel shows *"Mapped. Select the next parameter…"*, and channels arriving in
that gap drive their existing bindings instead of being swallowed.

**Bind wins over learn.** Pressing Bind while learn is armed cancels the learn
and maps the channel you pressed — the two are alternatives, not a race.

**One channel can drive several parameters.** Bind it again to another
parameter; both follow it. The bindings list groups them under the channel and
marks it *"2 targets"*. Removing one leaves the others running.

**A multi-value message gets one Bind per argument.** `/xy 0.3 0.7` shows
**Bind 0** and **Bind 1** so each half can drive a different parameter.

**Ranges are editable in place.** Each binding row carries
`in [min] [max] → [min] [max]`, a curve, and an invert box, so a channel that
turned out to send 0–127 or −5…5 can be corrected without going near the
console.

The bridge can also be run on its own, on other ports:

```bash
python osc_bridge_server.py --udp-port 9001 --ws-port 8767
```

## Components

### `OSCDecoder.js`
The OSC 1.0 wire format: messages, bundles (including nested ones), and every
type tag in the spec — `ifsbhtdcrmTFNI` plus `[]` arrays. Pure functions, no
state. A malformed or truncated packet raises `OSCDecodeError` rather than
returning a plausible wrong number.

### `OSCManager.js`
Owns the WebSocket to the bridge: connect, reconnect with backoff, decode, and
emit. Remembers the latest value per address so the settings panel can show
what is arriving, and caps that map so a sender spraying unique addresses
cannot grow it without bound.

### `OSCParameterBinding.js`
Maps an address (and an argument index) to a node parameter, with OSC learn,
input-range normalisation, curves, and save/load.

### `../ui/OSCSettingsPanel.js`
The panel: connection, incoming addresses, learn, active bindings, activity.

## Input ranges

This is the one real difference from the MIDI system. MIDI CC is always 0-127,
so `MIDIParameterBinding` can assume it. OSC has no such convention: a fader
usually sends 0-1, a rotary might send 0-360, a step sequencer 0-16. Each
binding therefore carries the range it expects:

```javascript
window.oscBinding.createBinding(
  '/1/fader1',  // OSC address
  0,            // which argument of the message
  nodeId,
  'radius',
  {
    inputMin: 0,      // range the sender emits
    inputMax: 1,
    min: 0,           // range to drive the parameter over
    max: 10,
    curve: 'linear',  // 'linear' | 'exponential' | 'logarithmic'
    inverted: false,
  }
);
```

Readings are clamped to the input range, so a sender that overshoots cannot
push a parameter past its bounds.

OSC learn guesses for you: bind while sending a value above 1 and the input
range widens to match rather than clamping everything you send to full scale.

## One message, several parameters

Bindings are keyed by address *and* argument index, because a single message
routinely carries several values:

```javascript
// '/xy 0.3 0.7' driving two parameters
oscBinding.createBinding('/xy', 0, nodeId, 'centerX');
oscBinding.createBinding('/xy', 1, nodeId, 'centerY');

// the same channel driving two parameters, each with its own range
oscBinding.createBinding('/lfo', 0, nodeId, 'radius',   { min: 0, max: 10 });
oscBinding.createBinding('/lfo', 0, otherId, 'rotation', { min: 0, max: 360 });
```

A parameter follows at most one source, so bindings are removed and edited by
their target rather than by their address:

```javascript
oscBinding.updateBindingForParameter(nodeId, 'radius', { max: 4 });
oscBinding.removeBindingForParameter(nodeId, 'radius');   // sibling keeps running
oscBinding.removeBinding('/lfo', 0);                      // drops every target
```

## Argument types

Anything numeric drives a parameter. `T`/`F` (toggles) and `I` (bang) map to 1
and 0, so a button works as well as a fader. Strings that parse as numbers are
accepted; anything else reads as 0 rather than poisoning the parameter with
`NaN`.

## Events

| Event | Payload |
| --- | --- |
| `OSC_CONNECTED` | `{ url }` |
| `OSC_DISCONNECTED` | `{ url, willRetry }` |
| `OSC_ERROR` | `{ message, url }` |
| `OSC_BRIDGE_INFO` | `{ udpHost, udpPort, version }` |
| `OSC_MESSAGE` | `{ address, args, types, value, timestamp }` |
| `OSC_ADDRESSES_CHANGED` | `{ addresses }` |
| `OSC_BINDING_CREATED` / `_REMOVED` / `_UPDATED` | the binding |
| `OSC_LEARN_STARTED` / `_COMPLETED` / `_CANCELLED` | `{ nodeId, paramName, ... }` |

## Performance

A bound parameter is compiled as a GPU uniform (see
`ParameterUniformManager`), so an incoming message is a uniform buffer write
and a redraw — not a shader rebuild. That is what makes OSC usable at the rates
senders actually push.

The bridge gives each connected editor a bounded queue and drops the oldest
packets if that editor falls behind, so a burst cannot stall the UDP receiver
or grow memory. For control data the newest reading is the only one that
matters. `/stats` on the bridge reports the drop count.

## Networking and exposure

- The bridge's **UDP** side listens on all interfaces by default, because
  controlling the editor from a phone or tablet on the same network is the
  point of the feature. Anything that can reach that port can drive mapped
  parameters, so on an untrusted network pass `--udp-host 127.0.0.1` or keep
  the port closed at the firewall.
- The bridge's **WebSocket** side listens on loopback only, and rejects browser
  connections whose `Origin` is not one of the editor's own. WebSockets are not
  covered by the same-origin policy, so without that check any page open in the
  artist's browser could watch their control surface.
- OSC addresses arrive from the network, so the settings panel renders them as
  text rather than markup.

## Troubleshooting

**"Could not reach the OSC bridge"** — the bridge process is not running. This
is about the editor↔bridge WebSocket, not about your sender: no OSC
configuration will fix it. Start the bridge:

```bash
npm run osc          # or: python osc_bridge_server.py
```

Whatever starts the editor normally starts one too (see the table above), so
the usual cause is a server that was already running from before OSC existed —
restart it. The other cause is Python or `aiohttp` missing, in which case the
dev server prints `OSC: not started` rather than failing.

**Panel says "UDP port busy"** — the bridge is running and reachable, but
something else already holds the UDP port, so no OSC can arrive.

The usual culprit is your own OSC sender. A sender and a receiver cannot both
hold the same UDP port on one machine, and many hosts — VCV Rack modules,
TouchOSC, Max — have a *receive* port setting sitting right next to the send
one. If both are set to 9000, the sender binds it and the bridge cannot.
Set the sender's **destination/output** port to 9000 and its **receive/input**
port to something else, or turn its receive side off.

To find the holder:

```powershell
netstat -ano -p UDP | findstr :9000        # Windows — note the PID
tasklist /FI "PID eq <pid>"
```

```bash
lsof -nP -iUDP:9000                        # macOS / Linux
```

Two ways out, both without restarting anything:

- **Free the port.** Close whatever holds it; the bridge retries every few
  seconds and picks it up on its own.
- **Move the bridge.** Type a new port in the panel's *UDP port* field and
  click **Move**, then point your sender at it. A port that is also refused
  leaves the bridge on the one it already had rather than going deaf.

To start on a different port every time, set `RHIZO_OSC_UDP_PORT=9001` (dev
server) or pass `--udp-port 9001` (standalone).

**Connected, but no addresses appear** — the sender is aimed somewhere else.
Check the machine's LAN IP (not `localhost`, if the sender is a phone), confirm
the port matches the one the panel shows, and check the firewall. `curl
http://127.0.0.1:8767/stats` shows whether packets are reaching the bridge at
all: if `packet_count` climbs, the problem is between the bridge and the
editor; if it does not, the problem is between the sender and the bridge.

**Learn does nothing** — you must select a node and click a parameter field
first, and be connected. The panel says so, but in that order.

**Values jump to full scale** — the sender is emitting something wider than
0-1. Rebind with learn while moving the control near its maximum, or set
`inputMax` on the binding.
