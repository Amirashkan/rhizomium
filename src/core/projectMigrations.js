// Project save-format versioning and migration.
//
// Every load path (file open, local autosave, backup restore) funnels through
// SaveLoadManager.importProject(), which calls migrateProjectData() before
// validation - so adding a new format version only requires bumping
// SAVE_FORMAT_VERSION and adding a migration step here.

export const SAVE_FORMAT_VERSION = 4;

// Kinds whose multiple channel output pins (RGBA/RGB/R/G/B/A) were collapsed
// into a single Color output in v4. A node kind is considered collapsed when it
// is a Texture sampler or any Compute node.
function isCollapsedOutputKind(kind) {
  return kind === "Texture2D" || kind === "TextureCube" ||
    (typeof kind === "string" && kind.startsWith("Compute"));
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
};

export function migrateProjectData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid project data");
  }

  let version = typeof data.version === "number" ? data.version : 1;

  if (version > SAVE_FORMAT_VERSION) {
    throw new Error(
      `This project was saved by a newer version of the editor ` +
        `(format ${version}, this editor supports up to ${SAVE_FORMAT_VERSION}). ` +
        `Please update the editor to open it.`,
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

  return { ...migrated, version: SAVE_FORMAT_VERSION };
}
