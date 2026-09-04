// Project save-format versioning and migration.
//
// Every load path (file open, local autosave, backup restore) funnels through
// SaveLoadManager.importProject(), which calls migrateProjectData() before
// validation - so adding a new format version only requires bumping
// SAVE_FORMAT_VERSION and adding a migration step here.

export const SAVE_FORMAT_VERSION = 9;

// Kinds whose multiple channel output pins (RGBA/RGB/R/G/B/A) were collapsed
// into a single Color output in v4. A node kind is considered collapsed when it
// is a Texture sampler or any Compute node.
function isCollapsedOutputKind(kind) {
  return kind === "Texture2D" || kind === "TextureCube" ||
    (typeof kind === "string" && kind.startsWith("Compute"));
}

// ComputeFieldMapper (3D Field Visualizer) parameters removed in v5 when the
// node was rebuilt around a GPU surface/instanced pipeline. These have no
// runtime handler anymore, so old saves carry them as dead weight that the
// parameter panel never prunes (it only adds missing params) — the migration
// drops them. Parameters still honored by the node — displacementScale and
// resolution (current params) and the legacy mappingMode — are left intact.
const REMOVED_FIELD_MAPPER_PARAMS = [
  "width", "height", "depth", "updateFrequency",
  "boundsMinX", "boundsMinY", "boundsMinZ",
  "boundsMaxX", "boundsMaxY", "boundsMaxZ",
  "threshold", "isoThreshold", "pointSize", "sampleRate",
  "colorMode",
  "colorAR", "colorAG", "colorAB", "colorAA",
  "colorBR", "colorBG", "colorBB", "colorBA",
  "solidColorR", "solidColorG", "solidColorB", "solidColorA",
  "colorScaleMin", "colorScaleMax",
  "displacementAxisX", "displacementAxisY", "displacementAxisZ",
];

// The Audio Analysis node's output pins, in order, as they were when it existed. Index N here IS
// pin N there, which is the whole basis of the v7 -> v8 conversion below: a wire from pin 4 becomes
// a wire from an Audio node reading `kick`. Frozen as a literal on purpose — the live list
// (audio/audioAnalysisTaps.js) is free to grow, and a migration must keep describing the past.
const LEGACY_AUDIO_ANALYSIS_PINS = [
  "level", "low", "mid", "high",
  "kick", "kickTrig", "snare", "snareTrig", "hat", "hatTrig",
  "kickMeter", "snareMeter", "hatMeter",
  "centroid", "density",
];

/** Display names for the converted nodes, so a migrated patch reads as well as a new one. */
const LEGACY_AUDIO_PIN_LABELS = {
  level: "Level", low: "Low", mid: "Mid", high: "High",
  kick: "Kick", kickTrig: "Kick Trigger",
  snare: "Snare", snareTrig: "Snare Trigger",
  hat: "Hat", hatTrig: "Hat Trigger",
  kickMeter: "Kick Meter", snareMeter: "Snare Meter", hatMeter: "Hat Meter",
  centroid: "Brightness", density: "Noisiness",
};

/** The drum a channel is decided on, or null for one that takes no threshold. */
function legacyThresholdDrum(channel) {
  for (const drum of ["kick", "snare", "hat"]) {
    if (channel === drum || channel === `${drum}Trig`) return drum;
  }
  return null;
}

/** The old per-drum threshold parameter a converted channel should inherit, if any. */
function legacyThresholdParam(channel) {
  const drum = legacyThresholdDrum(channel);
  return drum === null ? null : `${drum}Thresh`;
}

/**
 * Every `node_<id>` reference in an expression, with an optional output-pin suffix.
 * Written with an explicit trailing guard rather than \b so `node_1` does not match inside
 * `node_12` or `node_1_x`.
 */
function nodeReferencePattern(id) {
  return new RegExp(`node_${String(id).replace(/[^\w]/g, "\\$&")}(?:_(\\d+))?(?![0-9A-Za-z_])`, "g");
}

/** Rewrite every reference to one old node id across a saved node's expression parameters. */
function rewriteNodeReferences(node, oldId, idForPin) {
  const pattern = nodeReferencePattern(oldId);
  const swap = (text) => text.replace(pattern, (match, pin) => {
    const target = idForPin(pin === undefined ? 0 : Number(pin));
    return target ? `node_${target}` : match;
  });

  let changed = false;
  const next = { ...node };

  if (node.params && typeof node.params === "object") {
    const params = { ...node.params };
    for (const [key, value] of Object.entries(params)) {
      if (typeof value !== "string" || !value.includes(`node_${oldId}`)) continue;
      const rewritten = swap(value);
      if (rewritten !== value) {
        params[key] = rewritten;
        changed = true;
      }
    }
    if (changed) next.params = params;
  }

  // `expr`, `value` and `code` are mirrored outside params (see graphHydration MIRRORED_PARAMS).
  for (const key of ["expr", "value", "code"]) {
    const value = node[key];
    if (typeof value !== "string" || !value.includes(`node_${oldId}`)) continue;
    const rewritten = swap(value);
    if (rewritten !== value) {
      next[key] = rewritten;
      changed = true;
    }
  }

  return changed ? next : node;
}

// Each step migrates from its key version to the next one.
const migrations = {
  // v1 -> v2: early saves predate the timeline/MIDI sections.
  1: (data) => ({
    ...data,
    timeline: data.timeline ?? null,
    midiBindings: data.midiBindings ?? null,
  }),

  // v2 -> v3: normalize optional sections so importers can rely on them.
  // The payload shape is otherwise unchanged; v3 marks the first format
  // with explicit migration support.
  2: (data) => ({
    ...data,
    textures: data.textures ?? {},
    timeline: data.timeline ?? null,
    midiBindings: data.midiBindings ?? null,
  }),

  // v3 -> v4: Texture/Compute nodes collapsed their 6 channel output pins
  // (RGBA, RGB, R, G, B, A) into a single Color output (pin 0). Remap any
  // existing connection that referenced a now-removed channel pin (pin > 0)
  // back to the Color pin so old graphs keep their wiring instead of dangling.
  3: (data) => {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const connections = Array.isArray(data.connections) ? data.connections : [];

    const kindById = new Map();
    for (const node of nodes) {
      if (node && node.id != null) kindById.set(node.id, node.kind);
    }

    const migratedConnections = connections.map((conn) => {
      const fromPin = conn?.from?.pin;
      if (
        conn?.from &&
        typeof fromPin === "number" &&
        fromPin > 0 &&
        isCollapsedOutputKind(kindById.get(conn.from.nodeId))
      ) {
        return { ...conn, from: { ...conn.from, pin: 0 } };
      }
      return conn;
    });

    return { ...data, connections: migratedConnections };
  },

  // v4 -> v5: ComputeFieldMapper (3D Field Visualizer) was rebuilt around a
  // GPU surface/instanced pipeline with an entirely new parameter set. Strip
  // the obsolete parameters from any saved ComputeFieldMapper node so they stop
  // riding along on every subsequent save; missing new params fall back to
  // their defaults at load time.
  4: (data) => {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    let changed = false;

    const migratedNodes = nodes.map((node) => {
      if (!node || node.kind !== "ComputeFieldMapper") return node;

      // Parameter values live under node.params; older paths may also have
      // written them directly onto the node, so clean both.
      const nextParams =
        node.params && typeof node.params === "object"
          ? { ...node.params }
          : node.params;
      const nextNode = { ...node };
      let nodeChanged = false;

      for (const key of REMOVED_FIELD_MAPPER_PARAMS) {
        if (nextParams && typeof nextParams === "object" && key in nextParams) {
          delete nextParams[key];
          nodeChanged = true;
        }
        if (key in nextNode) {
          delete nextNode[key];
          nodeChanged = true;
        }
      }

      if (!nodeChanged) return node;
      changed = true;
      if (nextParams !== node.params) nextNode.params = nextParams;
      return nextNode;
    });

    return changed ? { ...data, nodes: migratedNodes } : data;
  },

  // v5 -> v6: the fragment ColorRamp and ConicGradient nodes were removed and their
  // roles folded into the GPU Gradient node (ComputeGradient). Rewrite saved instances
  // so old projects keep loading (and stay functional) instead of becoming dead,
  // uncompilable nodes. Node ids/positions/inputs are preserved, so existing
  // connections stay valid (both old nodes had a single input pin and output pin,
  // matching ComputeGradient).
  //
  // - ColorRamp (Value -> Color via stops) becomes a Gradient in "Gradient" colour
  //   mode whose stops are driven by its input (inputMix = 1), matching the old
  //   value-in / colour-out behaviour. Its interpolation mode maps 1:1
  //   (Linear/Step/Smooth).
  // - ConicGradient (an angular sweep) becomes a Gradient of type "Angular" in
  //   grayscale (its output was a scalar 0..1 field), ignoring any input
  //   (inputMix = 0) so it renders the built-in sweep the way it used to. Its former
  //   UV input pin is meaningless to the new node but is left connected harmlessly.
  5: (data) => {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    let changed = false;

    const migratedNodes = nodes.map((node) => {
      if (!node) return node;
      const p = (node.params && typeof node.params === "object") ? node.params : {};

      if (node.kind === "ColorRamp") {
        changed = true;
        const params = {
          type: "Linear",
          colorMode: "Gradient",
          interpolation: typeof p.mode === "string" ? p.mode : "Linear",
          inputMix: 1.0,
        };
        if (Array.isArray(p.stops)) params.colorStops = p.stops;
        return { ...node, kind: "ComputeGradient", params };
      }

      if (node.kind === "ConicGradient") {
        changed = true;
        // startAngle was stored in radians; ComputeGradient's angle is in degrees.
        const angleDeg = Number.isFinite(p.startAngle)
          ? (((p.startAngle * 180 / Math.PI) % 360) + 360) % 360
          : 0;
        return {
          ...node,
          kind: "ComputeGradient",
          params: {
            type: "Angular",
            colorMode: "Grayscale",
            centerX: Number.isFinite(p.centerX) ? p.centerX : 0.5,
            centerY: Number.isFinite(p.centerY) ? p.centerY : 0.5,
            angle: angleDeg,
            inputMix: 0.0,
          },
        };
      }

      return node;
    });

    return changed ? { ...data, nodes: migratedNodes } : data;
  },

  // v6 -> v7: projects gained OSC bindings alongside the MIDI ones. Older
  // saves simply have none, so normalize the section the way v2 did for MIDI
  // and let importers rely on the key existing.
  6: (data) => ({
    ...data,
    oscBindings: data.oscBindings ?? null,
  }),

  // v7 -> v8: the all-in-one Audio Analysis node became the single-channel Audio node.
  //
  // That node carried fifteen output pins and every setting the analysis has, which was the wrong
  // shape twice over: a patch using two of its pins still dragged the other thirteen across the
  // canvas, and each copy of the shaping settings fought over the one engine that actually exists
  // (there is one Audio node carrying them now — see data/nodes/InputNodes.js).
  //
  // A saved node becomes one Audio node per pin the patch ACTUALLY used — wired, or named by a
  // `=node_<id>_N` reference — so a patch that only read `level` comes back as one node rather than
  // fifteen. The first of them keeps the original id, which is what lets the common single-pin case
  // migrate without touching a single connection or reference.
  //
  // Carried across: the wiring (each connection re-pointed at the node for its pin), expression
  // references (`node_<id>_5` -> `node_<newId>`), the per-drum thresholds (onto the Threshold of
  // the nodes that decide on them), and any MIDI/OSC binding aimed at one of those thresholds.
  // NOT carried: attack/release/gain, which are now one shared setting for the whole editor rather
  // than a property of the document — writing them from a loaded file would silently re-shape every
  // other patch too.
  7: (data) => {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const legacy = nodes.filter((n) => n?.kind === "AudioAnalysis");
    // `AudioValue` is the same node under the name it briefly had while this was being built.
    const renamed = nodes.filter((n) => n?.kind === "AudioValue");
    if (legacy.length === 0 && renamed.length === 0) return data;

    const connections = Array.isArray(data.connections) ? data.connections : [];
    let nextNodes = nodes.map((n) => (n?.kind === "AudioValue" ? { ...n, kind: "Audio" } : n));
    let nextConnections = connections;

    // Fresh ids continue the document's own numbering, so they read like every other node.
    let nextId = nodes.reduce((max, n) => {
      const num = Number.parseInt(n?.id, 10);
      return Number.isFinite(num) && num > max ? num : max;
    }, 0);

    const bindingRetargets = new Map(); // "oldId.paramName" -> { nodeId, paramName }

    for (const node of legacy) {
      const oldId = String(node.id);
      const params = (node.params && typeof node.params === "object") ? node.params : {};

      // Which pins this patch actually reads: the wired ones...
      const used = new Set(
        nextConnections
          .filter((c) => String(c?.from?.nodeId) === oldId)
          .map((c) => (typeof c.from.pin === "number" ? c.from.pin : 0)),
      );
      // ...and the ones named by an expression anywhere in the document.
      const refPattern = nodeReferencePattern(oldId);
      for (const other of nextNodes) {
        const texts = [
          ...Object.values(other?.params || {}),
          other?.expr, other?.value, other?.code,
        ].filter((v) => typeof v === "string");
        for (const text of texts) {
          refPattern.lastIndex = 0;
          let match;
          while ((match = refPattern.exec(text)) !== null) {
            used.add(match[1] === undefined ? 0 : Number(match[1]));
          }
        }
      }
      // A node nothing reads still stood on the canvas, so it comes back as its first pin rather
      // than vanishing on load.
      if (used.size === 0) used.add(0);

      const pins = [...used]
        .filter((pin) => pin >= 0 && pin < LEGACY_AUDIO_ANALYSIS_PINS.length)
        .sort((a, b) => a - b);
      if (pins.length === 0) pins.push(0);

      const idForPin = new Map();
      const replacements = pins.map((pin, index) => {
        const channel = LEGACY_AUDIO_ANALYSIS_PINS[pin];
        const id = index === 0 ? oldId : String(++nextId);
        idForPin.set(pin, id);

        const audioParams = { channel };
        const thresholdParam = legacyThresholdParam(channel);
        if (thresholdParam !== null) {
          audioParams.threshold = params[thresholdParam] !== undefined
            ? params[thresholdParam]
            : 0.5;
          // A controller aimed at that threshold follows it to its new home.
          bindingRetargets.set(`${oldId}.${thresholdParam}`, { nodeId: id, paramName: "threshold" });
        }

        const position = node.position || { x: node.x || 0, y: node.y || 0 };
        const replacement = {
          ...node,
          id,
          kind: "Audio",
          // Stacked, so a node that split into several reads as a rack rather than a pile.
          position: { x: position.x || 0, y: (position.y || 0) + index * 78 },
          size: { width: 180, height: 60 },
          inputs: [],
          // Named after the channel, as deploying one from the panel does. A single replacement
          // keeps a name the artist chose.
          name: (pins.length === 1 && typeof node.name === "string" && node.name.trim())
            ? node.name
            : (LEGACY_AUDIO_PIN_LABELS[channel] || channel),
          params: audioParams,
        };
        // The old node's parameters were also mirrored here by some save paths; they describe a
        // node that no longer exists.
        delete replacement.props;
        return replacement;
      });

      const pinToId = (pin) => idForPin.get(pin) ?? idForPin.get(pins[0]);

      nextConnections = nextConnections.map((conn) => {
        if (String(conn?.from?.nodeId) !== oldId) return conn;
        const pin = typeof conn.from.pin === "number" ? conn.from.pin : 0;
        return { ...conn, from: { nodeId: pinToId(pin), pin: 0 } };
      });

      const index = nextNodes.findIndex((n) => String(n?.id) === oldId);
      nextNodes = [
        ...nextNodes.slice(0, index < 0 ? nextNodes.length : index),
        ...replacements,
        ...nextNodes.slice(index < 0 ? nextNodes.length : index + 1),
      ].map((n) => (replacements.includes(n) ? n : rewriteNodeReferences(n, oldId, pinToId)));
    }

    const retargetBindings = (section) => {
      if (!section || !Array.isArray(section.bindings)) return section;
      return {
        ...section,
        bindings: section.bindings.map((binding) => {
          const target = bindingRetargets.get(`${binding?.nodeId}.${binding?.paramName}`);
          return target ? { ...binding, ...target } : binding;
        }),
      };
    };

    return {
      ...data,
      nodes: nextNodes,
      connections: nextConnections,
      midiBindings: retargetBindings(data.midiBindings),
      oscBindings: retargetBindings(data.oscBindings),
    };
  },

  // v8 -> v9: the audio node split in two — `AudioValue` reads one channel, `Audio` carries the
  // analysis's settings.
  //
  // v8 gave each channel-reading node its own Threshold, which made one drum's decision a
  // per-node affair and left the shaping (attack/release/gain) on a panel slider that no
  // controller could reach. Both are settings of the one analysis engine, so they belong together
  // on one node, where they are ordinary parameters: MIDI-mappable, expression-driven, undoable,
  // saved with the patch.
  //
  // A v8 `Audio` node is identified by its `channel` parameter — the setup node has none — and
  // becomes an `AudioValue`. Any thresholds those nodes carried are gathered onto a single new
  // setup node (per drum, the tightest one wins: it is the one that was dialled in, and a looser
  // sibling would have been firing on everything). MIDI/OSC bindings on a converted node's
  // threshold follow it there.
  8: (data) => {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const taps = nodes.filter((n) => n?.kind === "Audio" && n?.params?.channel !== undefined);
    if (taps.length === 0) return data;

    // Per drum: the tightest threshold any of its nodes was using, and where it came from.
    const thresholds = {};
    const sources = new Map(); // "oldId.threshold" -> drum
    for (const tap of taps) {
      const drum = legacyThresholdDrum(tap.params.channel);
      if (drum === null) continue;
      const value = tap.params.threshold;
      sources.set(`${tap.id}.threshold`, drum);
      if (value === undefined) continue;
      const current = thresholds[drum];
      // An expression wins outright: it is the most deliberate thing anyone put there, and picking
      // between two of them by value is not possible.
      if (typeof value === "string") {
        if (typeof current !== "string") thresholds[drum] = value;
      } else if (typeof current !== "string"
        && (current === undefined || Number(value) > Number(current))) {
        thresholds[drum] = value;
      }
    }

    let nextId = nodes.reduce((max, n) => {
      const num = Number.parseInt(n?.id, 10);
      return Number.isFinite(num) && num > max ? num : max;
    }, 0);

    const converted = nodes.map((node) => {
      if (node?.kind !== "Audio" || node?.params?.channel === undefined) return node;
      const params = { ...node.params };
      delete params.threshold;
      return { ...node, kind: "AudioValue", params };
    });

    // Only worth a node if something was actually dialled in; otherwise the built-in defaults still
    // hold and the patch stays as small as it was.
    const carried = Object.keys(thresholds);
    let setupId = null;
    if (carried.length > 0) {
      const anchor = taps[0];
      const position = anchor.position || { x: anchor.x || 0, y: anchor.y || 0 };
      setupId = String(++nextId);
      const params = {};
      for (const [drum, value] of Object.entries(thresholds)) params[`${drum}Thresh`] = value;
      converted.push({
        id: setupId,
        kind: "Audio",
        position: { x: (position.x || 0) - 220, y: position.y || 0 },
        size: { width: 180, height: 60 },
        inputs: [],
        name: "Audio Setup",
        params,
      });
    }

    const retarget = (section) => {
      if (!section || !Array.isArray(section.bindings)) return section;
      return {
        ...section,
        bindings: section.bindings.map((binding) => {
          const drum = sources.get(`${binding?.nodeId}.${binding?.paramName}`);
          if (!drum || !setupId) return binding;
          return { ...binding, nodeId: setupId, paramName: `${drum}Thresh` };
        }),
      };
    };

    return {
      ...data,
      nodes: converted,
      midiBindings: retarget(data.midiBindings),
      oscBindings: retarget(data.oscBindings),
    };
  },
};

export function migrateProjectData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid project data");
  }

  // Patches published to the gallery carry `schemaVersion` alongside `version`
  // (see patchSerializer.js). Take the higher of the two so a patch from a
  // newer Rhizomium is refused here rather than half-loading as a graph full of
  // node kinds this build has never heard of.
  const declared = typeof data.version === "number" ? data.version : 1;
  const schema = typeof data.schemaVersion === "number" ? data.schemaVersion : declared;
  let version = Math.max(declared, schema);

  if (version > SAVE_FORMAT_VERSION) {
    throw new Error(
      `This project was saved by a newer version of the editor ` +
        `(format ${version}, this editor supports up to ${SAVE_FORMAT_VERSION}). ` +
        `Please update Rhizomium to open it.`,
    );
  }

  let migrated = data;
  while (version < SAVE_FORMAT_VERSION) {
    const step = migrations[version];
    if (step) {
      migrated = step(migrated);
    }
    version++;
  }

  const result = { ...migrated, version: SAVE_FORMAT_VERSION };
  if ("schemaVersion" in result) result.schemaVersion = SAVE_FORMAT_VERSION;
  return result;
}
