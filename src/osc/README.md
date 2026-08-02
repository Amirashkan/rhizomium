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

1. Start the server — the bridge starts with it:

   ```bash
   python rhizo_server.py
   ```

   It prints the UDP port to aim at:

   ```
   OSC:
     Send OSC to:   udp://<this machine>:9000
   ```

2. Open the editor and choose **Tools → OSC Receiver**, then click **Connect**.
   Incoming addresses appear as soon as anything arrives, which is the fastest
   way to confirm your sender is pointed at the right machine.

3. Map a control:
   - click a node to select it,
   - click the parameter field you want to drive in the Parameter Panel,
   - click **Start OSC Learn**,
   - move the control on your sender.

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

**Panel says "Connecting..." and never connects** — the bridge is not running.
Start `python rhizo_server.py` and check its log for a UDP bind error, which
usually means another OSC receiver already holds port 9000.

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
