#!/usr/bin/env python3
"""
Recover a VJ set (scenes, presets, playlist) from the browser's storage files.

The VJ panel keeps its set in browser storage: scenes in IndexedDB, presets
and the playlist in localStorage. When a set is replaced - File > New Project,
or opening a project that carries its own - the new values are written over
the old ones. Chromium-based browsers (Chrome, Edge, Brave, and the WebView2
the Windows desktop app runs in) keep both stores in LevelDB, which appends
new values rather than overwriting old ones in place: the old copies stay in
the storage files until the browser compacts them. This script reads those
files, finds every copy of the set it can, and writes each one out as a file
the VJ panel's "Import Set" button loads.

    python scripts/recover_vj_set.py                 # search the usual places
    python scripts/recover_vj_set.py <folder> ...    # search these folders
    python scripts/recover_vj_set.py --out <folder>  # where to write results

QUIT THE BROWSER (or the desktop app) FIRST, and keep it closed until you have
your set back. Every run of it can compact the files and drop old copies for
good. The script only reads; it never changes the browser's files.

Standard library only, so it runs on any Python 3.8+.
"""

import argparse
import hashlib
import json
import os
import re
import struct
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Snappy - LevelDB compresses table blocks with it, and Chromium compresses
# large IndexedDB values with it.
# ---------------------------------------------------------------------------


class SnappyError(Exception):
    pass


def _varint(buf, pos):
    result = 0
    shift = 0
    while True:
        if pos >= len(buf):
            raise SnappyError("truncated varint")
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7
        if shift > 63:
            raise SnappyError("varint too long")


def snappy_decompress(buf, pos=0, limit=512 * 1024 * 1024):
    """Decode one raw snappy stream starting at buf[pos]."""
    length, pos = _varint(buf, pos)
    if length > limit:
        raise SnappyError("implausible length")
    out = bytearray()
    n = len(buf)
    while len(out) < length:
        if pos >= n:
            raise SnappyError("truncated stream")
        tag = buf[pos]
        pos += 1
        kind = tag & 3
        if kind == 0:
            size = tag >> 2
            if size >= 60:
                extra = size - 59
                size = int.from_bytes(buf[pos:pos + extra], "little")
                pos += extra
            size += 1
            if pos + size > n:
                raise SnappyError("literal past end")
            out += buf[pos:pos + size]
            pos += size
            continue
        if kind == 1:
            size = ((tag >> 2) & 7) + 4
            offset = ((tag >> 5) << 8) | buf[pos]
            pos += 1
        elif kind == 2:
            size = (tag >> 2) + 1
            offset = int.from_bytes(buf[pos:pos + 2], "little")
            pos += 2
        else:
            size = (tag >> 2) + 1
            offset = int.from_bytes(buf[pos:pos + 4], "little")
            pos += 4
        if offset == 0 or offset > len(out):
            raise SnappyError("bad copy offset")
        start = len(out) - offset
        for i in range(size):  # copies may overlap their own output
            out.append(out[start + i])
    if len(out) != length:
        raise SnappyError("length mismatch")
    return bytes(out)


# ---------------------------------------------------------------------------
# LevelDB files: write-ahead logs (*.log) and sorted tables (*.ldb, *.sst).
# Both are reduced to plain byte streams to search; the search itself does not
# care about keys, only about the values' text.
# ---------------------------------------------------------------------------

LOG_BLOCK = 32768
TABLE_MAGIC = 0xDB4775248B80FB57


def log_payload(data):
    """Strip the 7-byte record headers so values split across blocks rejoin."""
    out = bytearray()
    pos = 0
    n = len(data)
    while pos + 7 <= n:
        left_in_block = LOG_BLOCK - (pos % LOG_BLOCK)
        if left_in_block < 7:
            pos += left_in_block
            continue
        length = struct.unpack_from("<H", data, pos + 4)[0]
        rtype = data[pos + 6]
        if rtype == 0 and length == 0:
            pos += left_in_block  # zero padding to the end of the block
            continue
        if not 1 <= rtype <= 4 or pos + 7 + length > n:
            # Not a record header - keep the raw bytes rather than lose them.
            out += data[pos:pos + left_in_block]
            pos += left_in_block
            continue
        out += data[pos + 7:pos + 7 + length]
        pos += 7 + length
    return bytes(out)


def _table_block(data, offset, size):
    raw = data[offset:offset + size]
    kind = data[offset + size] if offset + size < len(data) else 0
    if kind == 1:
        return snappy_decompress(raw)
    return raw


def _block_entries(block):
    if len(block) < 4:
        return
    restarts = struct.unpack_from("<I", block, len(block) - 4)[0]
    end = len(block) - 4 * (restarts + 1)
    pos = 0
    key = b""
    while 0 <= pos < end:
        shared, pos = _varint(block, pos)
        unshared, pos = _varint(block, pos)
        vlen, pos = _varint(block, pos)
        key = key[:shared] + block[pos:pos + unshared]
        pos += unshared
        yield key, block[pos:pos + vlen]
        pos += vlen


def table_payload(data):
    """Every data block of a LevelDB table, decompressed and concatenated."""
    if len(data) < 48 or struct.unpack_from("<Q", data, len(data) - 8)[0] != TABLE_MAGIC:
        return data
    footer = data[-48:]
    _, p = _varint(footer, 0)
    _, p = _varint(footer, p)  # metaindex handle
    index_off, p = _varint(footer, p)
    index_size, p = _varint(footer, p)
    out = bytearray()
    index = _table_block(data, index_off, index_size)
    for _, handle in _block_entries(index):
        off, q = _varint(handle, 0)
        size, _ = _varint(handle, q)
        try:
            out += _table_block(data, off, size)
        except (SnappyError, IndexError, struct.error):
            out += data[off:off + size]
    return bytes(out)


# Chromium marks a compressed IndexedDB value with these three bytes (SSV
# version tag, "needs processing" pseudo-version, "compressed with snappy").
SNAPPY_VALUE_MARK = b"\xff\x11\x02"


def expand_compressed_values(stream):
    out = []
    for m in re.finditer(re.escape(SNAPPY_VALUE_MARK), stream):
        try:
            out.append(snappy_decompress(stream, m.end()))
        except (SnappyError, IndexError):
            pass
    return out


def streams_for(path):
    """The byte streams worth searching in one file."""
    try:
        data = path.read_bytes()
    except OSError as error:
        print(f"  ! could not read {path}: {error}", file=sys.stderr)
        return []
    name = path.name.lower()
    streams = [data]
    try:
        if name.endswith(".log"):
            streams.append(log_payload(data))
        elif name.endswith((".ldb", ".sst")):
            streams.append(table_payload(data))
    except (SnappyError, IndexError, struct.error):
        pass
    expanded = []
    for s in streams:
        expanded += expand_compressed_values(s)
    # Values too big to keep inline go to separate blob files, which may
    # themselves be a compressed value.
    if ".blob" in str(path).lower():
        for start in range(0, min(len(data), 32)):
            try:
                expanded.append(snappy_decompress(data, start))
                break
            except (SnappyError, IndexError):
                continue
    return streams + expanded


# ---------------------------------------------------------------------------
# Finding the set's JSON in a byte stream. Strings are stored as Latin-1 or as
# UTF-16LE depending on their content, so both are searched.
# ---------------------------------------------------------------------------

MARKERS = {
    "playlist": '{"version":1,"playlist":[',
    "scenes": '{"version":1,"scenes":[',
    "presets": '{"version":1,"presets":[',
    "set": '{"version":1,"scenes":{"version":1,"scenes":[',  # a saved vjSet
}


def _balanced_end(text, start):
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        c = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_string = False
        elif c == '"':
            in_string = True
        elif c in "{[":
            depth += 1
        elif c in "}]":
            depth -= 1
            if depth == 0:
                return i + 1
    return None


def _from_latin1(raw):
    """Latin-1 text, read back as UTF-8 where the bytes were really UTF-8."""
    try:
        return raw.encode("latin-1").decode("utf-8")
    except UnicodeError:
        return raw


def find_json(stream):
    found = []
    for encoding in ("latin-1", "utf-16-le"):
        for kind, marker in MARKERS.items():
            needle = marker.encode(encoding)
            for m in re.finditer(re.escape(needle), stream):
                if encoding == "latin-1":
                    text = stream[m.start():].decode("latin-1")
                    end = _balanced_end(text, 0)
                    if end is None:
                        continue
                    candidate = _from_latin1(text[:end])
                else:
                    chunk = stream[m.start():]
                    chunk = chunk[:len(chunk) // 2 * 2]
                    text = chunk.decode("utf-16-le", errors="replace")
                    end = _balanced_end(text, 0)
                    if end is None:
                        continue
                    candidate = text[:end]
                try:
                    found.append((kind, json.loads(candidate)))
                except ValueError:
                    continue
    return found


# ---------------------------------------------------------------------------
# Where browsers keep their storage.
# ---------------------------------------------------------------------------

APP_ID = "com.rhizomium.studio"


def default_roots():
    home = Path.home()
    roots = []
    if sys.platform.startswith("win"):
        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        roots += [
            local / APP_ID / "EBWebView",
            local / "Google" / "Chrome" / "User Data",
            local / "Microsoft" / "Edge" / "User Data",
            local / "BraveSoftware" / "Brave-Browser" / "User Data",
            local / "Vivaldi" / "User Data",
            local / "Chromium" / "User Data",
        ]
        roaming = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        roots += [roaming / "Opera Software"]
    elif sys.platform == "darwin":
        support = home / "Library" / "Application Support"
        roots += [
            home / "Library" / "WebKit" / APP_ID,
            support / APP_ID,
            support / "Google" / "Chrome",
            support / "Microsoft Edge",
            support / "BraveSoftware" / "Brave-Browser",
            support / "Vivaldi",
            support / "Chromium",
            support / "Arc" / "User Data",
        ]
    else:
        config = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
        share = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share"))
        roots += [
            share / APP_ID,
            config / "google-chrome",
            config / "chromium",
            config / "microsoft-edge",
            config / "BraveSoftware" / "Brave-Browser",
            config / "vivaldi",
            home / "snap" / "chromium" / "common" / "chromium",
        ]
    return [r for r in roots if r.exists()]


STORAGE_DIRS = ("local storage", "indexeddb", "session storage", "webkit", "localstorage")


def storage_files(root):
    """Storage files under a browser or profile folder, or every file under a
    folder that is itself a storage folder (or a copy of one)."""
    root = Path(root)
    if root.is_file():
        yield root
        return
    lowered = str(root).lower()
    whole = any(part in lowered for part in STORAGE_DIRS) or not any(
        (root / d).exists() for d in ("Default", "Local State", "Local Storage", "IndexedDB")
    )
    for dirpath, dirnames, filenames in os.walk(root):
        here = dirpath.lower()
        if not whole and not any(part in here for part in STORAGE_DIRS):
            # Skip caches and the like; descend only toward storage folders.
            dirnames[:] = [d for d in dirnames if d.lower() not in ("cache", "code cache", "gpucache", "service worker", "extensions")]
            continue
        for f in filenames:
            if f in ("LOCK", "LOG", "LOG.old", "CURRENT") or f.startswith("MANIFEST"):
                continue
            yield Path(dirpath) / f


# ---------------------------------------------------------------------------
# Putting the pieces back together.
# ---------------------------------------------------------------------------


def _key(obj):
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode("utf-8")).hexdigest()


def _scene_names(scenes):
    return [s.get("name", s.get("id", "?")) for s in scenes.get("scenes", [])]


def collect(paths):
    found = {"playlist": {}, "scenes": {}, "presets": {}, "set": {}}
    sources = {}
    for root in paths:
        print(f"Searching {root}")
        for path in storage_files(root):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = 0
            for stream in streams_for(path):
                for kind, obj in find_json(stream):
                    k = _key(obj)
                    if k not in found[kind]:
                        found[kind][k] = obj
                        sources[k] = (str(path), mtime)
    return found, sources


def is_empty(kind, obj):
    if kind == "playlist":
        return not obj.get("playlist")
    if kind == "scenes":
        return not obj.get("scenes")
    if kind == "presets":
        return not obj.get("presets")
    return not (obj.get("scenes") or {}).get("scenes")


def assemble(found):
    """Whole sets: each recovered playlist with the scenes it plays."""
    scenes_list = [s for s in found["scenes"].values() if not is_empty("scenes", s)]
    presets_list = [p for p in found["presets"].values() if not is_empty("presets", p)]
    best_presets = max(presets_list, key=lambda p: len(p["presets"]), default=None)
    sets = []

    for playlist in found["playlist"].values():
        if is_empty("playlist", playlist):
            continue
        wanted = {item.get("sceneId") for item in playlist["playlist"]}
        best = None
        best_score = (-1, -1)
        for scenes in scenes_list:
            have = {s.get("id") for s in scenes["scenes"]}
            score = (len(wanted & have), len(have))
            if score > best_score:
                best, best_score = scenes, score
        sets.append({
            "version": 1,
            "scenes": best or {"version": 1, "scenes": [], "sceneOrder": [], "activeSceneId": None},
            "presets": best_presets or {"version": 1, "presets": [], "presetOrder": []},
            "playlist": playlist,
        })

    # Scene collections no playlist claimed are worth keeping too.
    used = {_key(s["scenes"]) for s in sets}
    for scenes in scenes_list:
        if _key(scenes) in used:
            continue
        sets.append({
            "version": 1,
            "scenes": scenes,
            "presets": best_presets or {"version": 1, "presets": [], "presetOrder": []},
            "playlist": {"version": 1, "playlist": [], "loop": True},
        })

    for vj_set in found["set"].values():
        if not is_empty("set", vj_set):
            sets.append(vj_set)

    # Fullest first: most playlist entries whose scene is there, then most scenes.
    def rank(s):
        have = {x.get("id") for x in s["scenes"].get("scenes", [])}
        items = s["playlist"].get("playlist", [])
        return (sum(1 for i in items if i.get("sceneId") in have), len(have), len(items))

    unique = {}
    for s in sets:
        unique.setdefault(_key(s), s)
    return sorted(unique.values(), key=rank, reverse=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="*", help="browser, profile or storage folders to search (default: the usual places)")
    parser.add_argument("--out", default="recovered-vj-sets", help="folder to write recovered sets to")
    args = parser.parse_args(argv)

    roots = [Path(p) for p in args.paths] or default_roots()
    if not roots:
        print("No browser storage found in the usual places. Pass the folder to search.")
        return 1

    found, _ = collect(roots)
    sets = assemble(found)
    if not sets:
        print("\nNo VJ set found. If the browser has been running since the set was lost,")
        print("its old copies may have been compacted away; try any backup or copy of the")
        print("browser profile folder by passing its path.")
        return 2

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    print(f"\nFound {len(sets)} VJ set(s). Fullest first:\n")
    for i, vj_set in enumerate(sets, 1):
        names = _scene_names(vj_set["scenes"])
        have = {s.get("id") for s in vj_set["scenes"].get("scenes", [])}
        items = vj_set["playlist"].get("playlist", [])
        missing = sum(1 for item in items if item.get("sceneId") not in have)
        file = out / f"vj-set-{stamp}-{i}.json"
        file.write_text(json.dumps(vj_set), encoding="utf-8")
        print(f"  {i}. {file}")
        print(f"     scenes ({len(names)}): {', '.join(names) or '-'}")
        print(f"     playlist: {len(items)} item(s)" + (f", {missing} whose scene was not found" if missing else ""))
        print(f"     presets: {len(vj_set['presets'].get('presets', []))}")
    print("\nOpen the VJ panel, press Import Set, and pick a file. The set it replaces")
    print("is kept, so Restore Previous Set undoes the import if you pick the wrong one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
