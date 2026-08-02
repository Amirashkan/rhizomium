// src/osc/OSCDecoder.js

/**
 * OSC 1.0 wire-format decoder.
 *
 * OSC travels over UDP and a browser cannot open a UDP socket, so packets reach
 * the editor through a bridge (see osc_bridge_server.py) that forwards each
 * datagram untouched. That means the editor decodes the real wire format rather
 * than a JSON rendering of it, which keeps the bridge dumb and lets any OSC
 * source — TouchOSC, Max, SuperCollider, Resolume — talk to us without agreeing
 * on a private envelope first.
 *
 * Wire rules that shape everything below:
 * - integers and floats are big-endian
 * - every field is padded with nulls to a 4-byte boundary
 * - a packet is either a message or a bundle, and bundles nest
 */

const textDecoder = new TextDecoder('utf-8');

const BUNDLE_ID = '#bundle';

// OSC timetags count seconds from 1900-01-01; JS counts from 1970-01-01.
const NTP_EPOCH_OFFSET_SECONDS = 2208988800;

// Fractional part of a timetag is in units of 1/2^32 second.
const NTP_FRACTION_SCALE = 2 ** 32;

/** A timetag of exactly 1 means "now" — the one special value in the spec. */
const TIMETAG_IMMEDIATE = { seconds: 0, fraction: 1, immediate: true, date: null };

export class OSCDecodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OSCDecodeError';
  }
}

/** OSC pads every field out to a 4-byte boundary. */
function padded(length) {
  return (length + 3) & ~3;
}

/**
 * A cursor over one packet. Every read is bounds-checked, because the bytes
 * come off a socket and a truncated or hostile datagram must fail as a decode
 * error rather than as a silent wrong number.
 */
class Cursor {
  constructor(view) {
    this.view = view;
    this.offset = 0;
  }

  get remaining() {
    return this.view.byteLength - this.offset;
  }

  require(bytes, what) {
    if (bytes < 0 || this.remaining < bytes) {
      throw new OSCDecodeError(
        `truncated packet: needed ${bytes} more bytes for ${what}, ${this.remaining} left`,
      );
    }
  }

  readInt32() {
    this.require(4, 'int32');
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readUint32() {
    this.require(4, 'uint32');
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    this.require(4, 'float32');
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat64() {
    this.require(8, 'float64');
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readBigInt64() {
    this.require(8, 'int64');
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value;
  }

  /** An OSC-string: null-terminated, then null-padded to a 4-byte boundary. */
  readString() {
    const start = this.offset;
    let end = start;
    while (end < this.view.byteLength && this.view.getUint8(end) !== 0) end++;

    if (end >= this.view.byteLength) {
      throw new OSCDecodeError('truncated packet: unterminated OSC string');
    }

    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + start,
      end - start,
    );
    const text = textDecoder.decode(bytes);

    this.offset = start + padded(end - start + 1);
    // The padding itself can run past the end of a malformed packet.
    if (this.offset > this.view.byteLength) {
      throw new OSCDecodeError('truncated packet: OSC string padding overruns packet');
    }
    return text;
  }

  /** An OSC-blob: int32 length, that many bytes, then padding. */
  readBlob() {
    const length = this.readInt32();
    if (length < 0) {
      throw new OSCDecodeError(`invalid blob length ${length}`);
    }
    this.require(padded(length), 'blob');
    const bytes = new Uint8Array(
      this.view.buffer.slice(
        this.view.byteOffset + this.offset,
        this.view.byteOffset + this.offset + length,
      ),
    );
    this.offset += padded(length);
    return bytes;
  }

  readTimetag() {
    const seconds = this.readUint32();
    const fraction = this.readUint32();

    if (seconds === 0 && fraction === 1) return TIMETAG_IMMEDIATE;

    const unixSeconds = seconds - NTP_EPOCH_OFFSET_SECONDS + fraction / NTP_FRACTION_SCALE;
    return {
      seconds,
      fraction,
      immediate: false,
      date: new Date(unixSeconds * 1000),
    };
  }

  /** Read `count` raw bytes without padding. */
  readBytes(count, what) {
    this.require(count, what);
    const bytes = new Uint8Array(
      this.view.buffer.slice(
        this.view.byteOffset + this.offset,
        this.view.byteOffset + this.offset + count,
      ),
    );
    this.offset += count;
    return bytes;
  }
}

/**
 * Read one argument for `tag`.
 *
 * Returns `undefined` for tags that carry no data of their own — the caller
 * decides what those contribute, because `[`/`]` restructure the argument list
 * rather than adding to it.
 */
function readArgument(tag, cursor) {
  switch (tag) {
    case 'i': // int32
      return cursor.readInt32();

    case 'f': // float32
      return cursor.readFloat32();

    case 'd': // float64
      return cursor.readFloat64();

    case 's': // string
    case 'S': // symbol
      return cursor.readString();

    case 'b': // blob
      return cursor.readBlob();

    // int64. Values past 2^53 lose precision as Numbers, but every consumer
    // here wants a number to scale a parameter with, not a bit-exact integer.
    case 'h':
      return Number(cursor.readBigInt64());

    case 't': // timetag
      return cursor.readTimetag();

    case 'c': // ASCII char sent as int32
      return String.fromCharCode(cursor.readInt32());

    case 'r': { // 32-bit RGBA colour
      const packed = cursor.readUint32();
      return {
        r: (packed >>> 24) & 0xff,
        g: (packed >>> 16) & 0xff,
        b: (packed >>> 8) & 0xff,
        a: packed & 0xff,
      };
    }

    case 'm': // 4-byte MIDI message: port, status, data1, data2
      return Array.from(cursor.readBytes(4, 'midi message'));

    case 'T':
      return true;

    case 'F':
      return false;

    case 'N':
      return null;

    // Impulse ("bang"). Decoding it as `true` keeps triggers usable: a bang
    // normalises to 1 the same way a toggle does.
    case 'I':
      return true;

    default:
      throw new OSCDecodeError(`unsupported OSC type tag '${tag}'`);
  }
}

/**
 * Decode the argument list described by `types` (the tag string minus its
 * leading comma). Handles `[`/`]` by nesting into sub-arrays.
 */
function readArguments(types, cursor) {
  const root = [];
  const stack = [root];

  for (const tag of types) {
    const current = stack[stack.length - 1];

    if (tag === '[') {
      const nested = [];
      current.push(nested);
      stack.push(nested);
      continue;
    }

    if (tag === ']') {
      if (stack.length === 1) {
        throw new OSCDecodeError("unbalanced ']' in OSC type tag string");
      }
      stack.pop();
      continue;
    }

    current.push(readArgument(tag, cursor));
  }

  if (stack.length !== 1) {
    throw new OSCDecodeError("unbalanced '[' in OSC type tag string");
  }

  return root;
}

function decodeMessage(cursor) {
  const address = cursor.readString();

  if (!address.startsWith('/')) {
    throw new OSCDecodeError(`invalid OSC address '${address}' (must start with '/')`);
  }

  // The type tag string is optional in OSC 1.0 — a few older senders omit it,
  // in which case the message simply has no arguments.
  let types = '';
  if (cursor.remaining > 0) {
    const tagString = cursor.readString();
    if (!tagString.startsWith(',')) {
      throw new OSCDecodeError(`invalid OSC type tag string '${tagString}' (must start with ',')`);
    }
    types = tagString.slice(1);
  }

  return {
    type: 'message',
    address,
    types,
    args: readArguments(types, cursor),
  };
}

function decodeBundle(cursor) {
  cursor.readString(); // '#bundle'
  const timetag = cursor.readTimetag();
  const packets = [];

  while (cursor.remaining > 0) {
    const size = cursor.readInt32();
    if (size < 0) {
      throw new OSCDecodeError(`invalid bundle element size ${size}`);
    }
    cursor.require(size, 'bundle element');

    const element = new DataView(
      cursor.view.buffer,
      cursor.view.byteOffset + cursor.offset,
      size,
    );
    packets.push(decodeCursor(new Cursor(element)));
    cursor.offset += size;
  }

  return { type: 'bundle', timetag, packets };
}

function decodeCursor(cursor) {
  if (cursor.remaining === 0) {
    throw new OSCDecodeError('empty OSC packet');
  }

  // A bundle is exactly the packets whose first bytes spell '#bundle'.
  const isBundle =
    cursor.remaining >= 8 &&
    Array.from(BUNDLE_ID).every(
      (char, i) => cursor.view.getUint8(cursor.offset + i) === char.charCodeAt(0),
    ) &&
    cursor.view.getUint8(cursor.offset + BUNDLE_ID.length) === 0;

  return isBundle ? decodeBundle(cursor) : decodeMessage(cursor);
}

function toDataView(input) {
  if (input instanceof DataView) return input;
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new OSCDecodeError('expected an ArrayBuffer, DataView or typed array');
}

/**
 * Decode one OSC packet.
 *
 * @param {ArrayBuffer|DataView|ArrayBufferView} input raw packet bytes
 * @returns {{type: 'message', address: string, types: string, args: Array}
 *          |{type: 'bundle', timetag: object, packets: Array}}
 * @throws {OSCDecodeError} on malformed or truncated input
 */
export function decodePacket(input) {
  return decodeCursor(new Cursor(toDataView(input)));
}

/**
 * Flatten a decoded packet into a plain list of messages.
 *
 * Bundles exist to group messages that should be acted on together, and nothing
 * downstream of here treats a bundled message differently from a loose one, so
 * callers just want the messages. Each carries the timetag of its enclosing
 * bundle (null when it arrived on its own).
 */
export function flattenMessages(packet, timetag = null) {
  if (!packet) return [];

  if (packet.type === 'message') {
    return [{ ...packet, timetag }];
  }

  if (packet.type === 'bundle') {
    return packet.packets.flatMap((child) => flattenMessages(child, packet.timetag));
  }

  return [];
}

/** Decode a packet straight into its messages. */
export function decodeMessages(input) {
  return flattenMessages(decodePacket(input));
}

/**
 * Coerce an OSC argument into a number for parameter control.
 *
 * OSC is loosely typed by design — the same fader can arrive as `f`, `i`, `T`
 * or a numeric string depending on the sender — so bindings normalise here
 * instead of rejecting anything that is not a float.
 */
export function oscArgToNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Render an argument for the activity monitor. */
export function formatOSCArg(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (Array.isArray(value)) return `[${value.map(formatOSCArg).join(', ')}]`;
  if (value && typeof value === 'object' && 'r' in value) {
    return `rgba(${value.r}, ${value.g}, ${value.b}, ${value.a})`;
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    return value.immediate ? 'now' : `@${value.seconds}`;
  }
  return String(value);
}
