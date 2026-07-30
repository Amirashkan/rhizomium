// Project save-format versioning and migration.
//
// Every load path (file open, local autosave, backup restore) funnels through
// SaveLoadManager.importProject(), which calls migrateProjectData() before
// validation - so adding a new format version only requires bumping
// SAVE_FORMAT_VERSION and adding a migration step here.

export const SAVE_FORMAT_VERSION = 6;

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
