// Tests for the OSC 1.0 wire-format decoder.
//
// Packets are built here byte by byte rather than with a library, so the
// assertions pin the actual wire format — padding rules included — instead of
// agreeing with whatever an encoder happens to do.

import { describe, it, expect } from 'vitest';
import {
  decodePacket,
  decodeMessages,
  flattenMessages,
  oscArgToNumber,
  formatOSCArg,
  OSCDecodeError,
} from '../src/osc/OSCDecoder.js';

// --- packet building helpers ------------------------------------------------

function concat(...chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** An OSC-string: null-terminated then null-padded to a 4-byte boundary. */
function str(value) {
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array((encoded.length + 4) & ~3);
  out.set(encoded);
  return out;
}

function i32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value, false);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function f32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, false);
  return out;
}

function f64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

function blob(bytes) {
  const padding = new Uint8Array(((bytes.length + 3) & ~3) - bytes.length);
  return concat(i32(bytes.length), bytes, padding);
}

function msg(address, types, ...args) {
  return concat(str(address), str(types), ...args);
}

function bundle(timetagSeconds, ...packets) {
  return concat(
    str('#bundle'),
    u32(timetagSeconds),
    u32(0),
    ...packets.map((p) => concat(i32(p.length), p)),
  );
}

// --- tests ------------------------------------------------------------------

describe('OSC message decoding', () => {
  it('decodes a single float argument', () => {
    const packet = decodePacket(msg('/1/fader1', ',f', f32(0.5)));

    expect(packet.type).toBe('message');
    expect(packet.address).toBe('/1/fader1');
    expect(packet.types).toBe('f');
    expect(packet.args).toEqual([0.5]);
  });

  it('decodes mixed argument types in order', () => {
    const packet = decodePacket(
      msg('/mix', ',ifs', i32(7), f32(0.25), str('hello')),
    );

    expect(packet.args).toEqual([7, 0.25, 'hello']);
  });

  it('decodes the tagless arguments that carry no payload', () => {
    const packet = decodePacket(msg('/flags', ',TFNI'));

    // Impulse decodes as true so a bang normalises to 1 like a toggle.
    expect(packet.args).toEqual([true, false, null, true]);
  });

  it('decodes 64-bit numeric types', () => {
    const packet = decodePacket(msg('/wide', ',d', f64(0.1)));
    expect(packet.args[0]).toBeCloseTo(0.1, 12);
  });

  it('decodes a blob and skips its padding', () => {
    // 5 bytes of payload pad out to 8, and the trailing float must still land.
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const packet = decodePacket(msg('/blob', ',bf', blob(payload), f32(1.5)));

    expect(packet.args[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(packet.args[0])).toEqual([1, 2, 3, 4, 5]);
    expect(packet.args[1]).toBe(1.5);
  });

  it('decodes colour and MIDI arguments', () => {
    const packet = decodePacket(msg('/extras', ',rm', u32(0x11223344), new Uint8Array([0, 0xb0, 7, 100])));

    expect(packet.args[0]).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 });
    expect(packet.args[1]).toEqual([0, 0xb0, 7, 100]);
  });

  it('decodes nested arrays', () => {
    const packet = decodePacket(msg('/arr', ',[ff]i', f32(1), f32(2), i32(3)));
    expect(packet.args).toEqual([[1, 2], 3]);
  });

  it('accepts a message with no type tag string at all', () => {
    // Some older senders omit it; the message simply has no arguments.
    const packet = decodePacket(str('/ping'));

    expect(packet.address).toBe('/ping');
    expect(packet.args).toEqual([]);
  });

  // Address lengths 3..6 straddle every padding case (3+1=4 exact, 4+1 rounds
  // to 8, and so on), which is where a decoder usually goes wrong.
  it.each(['/ab', '/abc', '/abcd', '/abcde'])('handles padding for address %s', (address) => {
    const packet = decodePacket(msg(address, ',f', f32(0.75)));

    expect(packet.address).toBe(address);
    expect(packet.args).toEqual([0.75]);
  });
});

describe('OSC bundle decoding', () => {
  it('decodes a bundle of two messages', () => {
    const packet = decodePacket(
      bundle(3913056000, msg('/a', ',f', f32(1)), msg('/b', ',i', i32(2))),
    );

    expect(packet.type).toBe('bundle');
    expect(packet.packets).toHaveLength(2);
    expect(packet.packets[0].address).toBe('/a');
    expect(packet.packets[1].address).toBe('/b');
  });

  it('flattens nested bundles into a list of messages', () => {
    const inner = bundle(0, msg('/inner', ',f', f32(9)));
    const outer = bundle(0, msg('/outer', ',f', f32(1)), inner);

    const messages = decodeMessages(outer);

    expect(messages.map((m) => m.address)).toEqual(['/outer', '/inner']);
    expect(messages.map((m) => m.args[0])).toEqual([1, 9]);
  });

  it('marks the immediate timetag rather than dating it to 1900', () => {
    const packet = decodePacket(
      concat(str('#bundle'), u32(0), u32(1), i32(msg('/x', ',f', f32(0)).length), msg('/x', ',f', f32(0))),
    );

    expect(packet.timetag.immediate).toBe(true);
    expect(packet.timetag.date).toBeNull();
  });

  it('carries the enclosing timetag onto each flattened message', () => {
    const packet = decodePacket(bundle(3913056000, msg('/a', ',f', f32(1))));
    const [message] = flattenMessages(packet);

    expect(message.timetag.seconds).toBe(3913056000);
  });

  it('gives a loose message a null timetag', () => {
    const [message] = decodeMessages(msg('/a', ',f', f32(1)));
    expect(message.timetag).toBeNull();
  });
});

describe('OSC decoding rejects malformed input', () => {
  it('rejects a truncated argument', () => {
    // Type tag promises a float, but only two of its four bytes are present.
    const truncated = concat(str('/x'), str(',f'), new Uint8Array([0, 0]));
    expect(() => decodePacket(truncated)).toThrow(OSCDecodeError);
  });

  it('rejects an address that does not start with a slash', () => {
    expect(() => decodePacket(msg('nope', ',f', f32(1)))).toThrow(/must start with/);
  });

  it('rejects a type tag string without its leading comma', () => {
    expect(() => decodePacket(msg('/x', 'f', f32(1)))).toThrow(/must start with/);
  });

  it('rejects an unknown type tag', () => {
    expect(() => decodePacket(msg('/x', ',Q', i32(1)))).toThrow(/unsupported OSC type tag/);
  });

  it('rejects an unterminated string', () => {
    expect(() => decodePacket(new Uint8Array([0x2f, 0x61, 0x62, 0x63]))).toThrow(OSCDecodeError);
  });

  it('rejects an empty packet', () => {
    expect(() => decodePacket(new Uint8Array(0))).toThrow(/empty OSC packet/);
  });

  it('rejects a bundle element that overruns the packet', () => {
    const bad = concat(str('#bundle'), u32(0), u32(1), i32(999));
    expect(() => decodePacket(bad)).toThrow(OSCDecodeError);
  });

  it('rejects an unbalanced array tag', () => {
    expect(() => decodePacket(msg('/x', ',[f', f32(1)))).toThrow(/unbalanced/);
  });
});

describe('decodePacket input forms', () => {
  it('accepts an ArrayBuffer, a Uint8Array and a DataView alike', () => {
    const packet = msg('/x', ',f', f32(0.5));
    const expected = { address: '/x', args: [0.5] };

    expect(decodePacket(packet)).toMatchObject(expected);
    expect(decodePacket(packet.buffer.slice(0))).toMatchObject(expected);
    expect(decodePacket(new DataView(packet.buffer.slice(0)))).toMatchObject(expected);
  });

  it('decodes correctly from a view with a non-zero byte offset', () => {
    // A datagram read into a shared buffer arrives offset; the decoder must
    // honour byteOffset rather than assuming it starts at zero.
    const packet = msg('/x', ',f', f32(0.5));
    const backing = new Uint8Array(packet.length + 8);
    backing.set(packet, 8);

    const view = new Uint8Array(backing.buffer, 8, packet.length);
    expect(decodePacket(view)).toMatchObject({ address: '/x', args: [0.5] });
  });
});

describe('oscArgToNumber', () => {
  it('passes finite numbers through', () => {
    expect(oscArgToNumber(0.25)).toBe(0.25);
    expect(oscArgToNumber(-3)).toBe(-3);
  });

  it('maps booleans to 1 and 0 so toggles and bangs drive parameters', () => {
    expect(oscArgToNumber(true)).toBe(1);
    expect(oscArgToNumber(false)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(oscArgToNumber('0.5')).toBe(0.5);
  });

  it('falls back to 0 for values that carry no number', () => {
    expect(oscArgToNumber(NaN)).toBe(0);
    expect(oscArgToNumber(Infinity)).toBe(0);
    expect(oscArgToNumber('hello')).toBe(0);
    expect(oscArgToNumber(null)).toBe(0);
    expect(oscArgToNumber(undefined)).toBe(0);
    expect(oscArgToNumber({})).toBe(0);
  });
});

describe('formatOSCArg', () => {
  it('renders each argument type readably for the activity monitor', () => {
    expect(formatOSCArg(1)).toBe('1');
    expect(formatOSCArg(0.123456)).toBe('0.1235');
    expect(formatOSCArg(true)).toBe('true');
    expect(formatOSCArg(null)).toBe('null');
    expect(formatOSCArg('hi')).toBe('"hi"');
    expect(formatOSCArg(new Uint8Array(3))).toBe('<3 bytes>');
    expect(formatOSCArg([1, 2])).toBe('[1, 2]');
    expect(formatOSCArg({ r: 1, g: 2, b: 3, a: 4 })).toBe('rgba(1, 2, 3, 4)');
  });
});
