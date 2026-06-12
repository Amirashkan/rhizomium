// Project save-format versioning and migration.
//
// Every load path (file open, local autosave, backup restore) funnels through
// SaveLoadManager.importProject(), which calls migrateProjectData() before
// validation - so adding a new format version only requires bumping
// SAVE_FORMAT_VERSION and adding a migration step here.

export const SAVE_FORMAT_VERSION = 3;

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
