// Patch serialization for publishing to the TenderWorld gallery.
//
// A ".rz patch" is the artwork's *source document* travelling alongside the
// rendered media, so a visitor can download it and reopen the work here. The
// gallery stores it opaquely (it never parses the contents) and serves it from
// a PUBLIC bucket, which drives every rule in this file:
//
//   - Self-contained: no references to files on the author's machine. Textures
//     already ride along as inlined data URLs (SaveLoadManager.collectTextureData),
//     so the only local leakage risk is stray path-shaped strings, which
//     scrubPrivateData() reduces to a bare basename.
//   - No secrets: exportNodes() copies *every* non-runtime node property, so a
//     node kind added later could carry a token without anyone revisiting this
//     file. The scrub is therefore a denylist applied to the whole tree rather
//     than a fixed set of known fields.
//   - Deterministic: same document in, byte-identical patch out, so published
//     patches diff cleanly. That means stable key order and no wall-clock
//     timestamps anywhere in the payload.
//
// The patch is deliberately a *superset* of the normal project save format
// (same `app`/`version`/`nodes`/`connections`/... shape, plus the envelope
// fields below). A downloaded patch is therefore an ordinary .rz project file:
// File → Open, drag-and-drop and the migration chain all handle it with no
// special-casing.

import { SAVE_FORMAT_VERSION } from "./projectMigrations.js";

/** Patch envelope version. Mirrors the project save format it wraps. */
export const PATCH_SCHEMA_VERSION = SAVE_FORMAT_VERSION;

/** Gallery's hard limit for the `patch` field (5MB). Enforced client-side. */
export const PATCH_MAX_BYTES = 5 * 1024 * 1024;

const GENERATOR_APP = "rhizomium";

/**
 * Keys dropped from the patch wherever they appear, matched case-insensitively
 * after stripping `_`/`-`/spaces (so `api_key`, `apiKey` and `API-KEY` all hit).
 *
 * Two groups: credentials/identity (must never reach a public bucket) and
 * machine fingerprinting that SaveLoadManager.exportMetadata() records for
 * local debugging (`platform`, `userAgent`) and which has no business being
 * published. Names are kept specific enough that a shader parameter is not
 * going to collide with one — nothing here reads like a graph value.
 */
const PRIVATE_KEYS = new Set([
  // Credentials
  "apikey", "secret", "secretkey", "clientsecret", "token", "accesstoken",
  "refreshtoken", "authtoken", "idtoken", "bearertoken", "password", "passwd",
  "credential", "credentials", "privatekey", "licensekey", "license",
  "sessionid", "sessiontoken", "authorization", "cookie",
  // Identity
  "email", "useremail", "username", "userid", "accountid", "ownerid",
  // Machine fingerprinting
  "useragent", "platform", "hostname", "homedir",
]);

/**
 * Absolute filesystem locations we refuse to publish: POSIX home/system roots,
 * Windows drive letters and UNC shares, and file:// URLs. Matched against the
 * whole string so a shader expression that merely contains a slash is untouched.
 */
const ABSOLUTE_PATH_PATTERNS = [
  /^file:\/\//i,
  /^[a-z]:[\\/]/i,
  /^\\\\/,
  /^\/(users|home|root|var|tmp|private|mnt|media|opt|srv)\//i,
];

function normalizeKey(key) {
  return String(key).replace(/[_\-\s]/g, "").toLowerCase();
}

function isPrivateKey(key) {
  return PRIVATE_KEYS.has(normalizeKey(key));
}

function isAbsoluteLocalPath(value) {
  return ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Reduce an absolute local path to its basename. Textures are inlined as data
 * URLs, so the path is only ever a display label — the leading directories add
 * nothing but the author's account name and folder layout.
 */
function basename(value) {
  const parts = String(value).split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

/**
 * Recursively strip private keys and defuse absolute local paths.
 *
 * Data URLs are left alone: they are the inlined texture payloads that make a
 * patch self-contained, and they carry no location information.
 */
export function scrubPrivateData(value, seen = new WeakSet()) {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return value;
    return isAbsoluteLocalPath(value) ? basename(value) : value;
  }

  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) {
    throw new Error("Cannot serialize patch: project data contains a cycle");
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => scrubPrivateData(entry, seen));
    }

    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isPrivateKey(key)) continue;
      if (entry === undefined || typeof entry === "function") continue;
      result[key] = scrubPrivateData(entry, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/**
 * Deep-clone with object keys sorted, so JSON.stringify emits a stable byte
 * sequence. Arrays keep their order — it is meaningful for nodes/connections.
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;

  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

/** Deterministic JSON: stable key order, two-space indent. */
export function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

/**
 * Build the patch payload from project data (the object
 * SaveLoadManager.exportProject() returns).
 *
 * Wall-clock fields are dropped rather than refreshed — `savedAt` and
 * `metadata.created` would make every export of an unchanged document differ,
 * which is exactly what the determinism rule exists to prevent.
 */
export function serializePatchData(projectData, options = {}) {
  if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
    throw new Error("Cannot serialize patch: project data must be an object");
  }

  const { title = null, generatorVersion = null } = options;

  const scrubbed = scrubPrivateData(projectData);
  delete scrubbed.savedAt;
  if (scrubbed.metadata && typeof scrubbed.metadata === "object") {
    delete scrubbed.metadata.created;
  }

  const patch = {
    ...scrubbed,
    schemaVersion: PATCH_SCHEMA_VERSION,
    // Kept in step with schemaVersion so the patch also loads as a plain
    // project file through the normal migration chain.
    version: PATCH_SCHEMA_VERSION,
    generator: { app: GENERATOR_APP, ...(generatorVersion ? { version: generatorVersion } : {}) },
  };

  const patchTitle = typeof title === "string" ? title.trim() : "";
  if (patchTitle) patch.title = patchTitle;

  return patch;
}

/**
 * Serialize project data to a `.rz` patch Blob ready to POST as the `patch`
 * field. `.rz` is JSON — the gallery maps the extension to application/json.
 */
export function serializePatch(projectData, options = {}) {
  const json = stableStringify(serializePatchData(projectData, options));
  return new Blob([json], { type: "application/json" });
}

/**
 * Parse a downloaded patch back into project data for
 * SaveLoadManager.importProject().
 *
 * A patch from a *newer* Rhizomium is refused with an explicit "update" message
 * rather than being fed to the graph loader, where unknown node kinds would
 * surface as an unrelated-looking failure.
 */
export function deserializePatch(text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch (error) {
    throw new Error(`Not a valid Rhizomium patch: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Not a valid Rhizomium patch: expected a JSON object");
  }

  const schemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : null;
  if (schemaVersion !== null && schemaVersion > PATCH_SCHEMA_VERSION) {
    throw new Error(
      `This patch was created by a newer version of Rhizomium ` +
        `(patch format ${schemaVersion}, this build supports up to ${PATCH_SCHEMA_VERSION}). ` +
        `Please update Rhizomium to open it.`,
    );
  }

  return data;
}

/**
 * URL/filename-safe slug for the patch filename. The name sent to the gallery
 * is what a visitor's browser saves, so it should read like the artwork
 * ("slow-bloom.rz"), not like an export timestamp.
 */
export function slugify(value, fallback = "patch") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return slug || fallback;
}

/** `slugify()`ed title with the `.rz` extension. */
export function patchFilename(title, fallback = "patch") {
  return `${slugify(title, fallback)}.rz`;
}

/**
 * Check a patch Blob against the gallery's 5MB limit *before* uploading.
 * Returns null when it fits, otherwise an artist-facing explanation naming the
 * usual culprit — inlined textures dominate patch size by a wide margin.
 */
export function checkPatchSize(blob, maxBytes = PATCH_MAX_BYTES) {
  const size = blob?.size ?? 0;
  if (size <= maxBytes) return null;

  const sizeMB = (size / 1024 / 1024).toFixed(2);
  const limitMB = (maxBytes / 1024 / 1024).toFixed(0);
  return (
    `This patch is ${sizeMB} MB, over the ${limitMB} MB gallery limit.\n\n` +
    `Patch size is dominated by textures, which are embedded in the file so ` +
    `the patch opens on someone else's machine. To get under the limit, use ` +
    `smaller source images in your Texture nodes, or remove textures the ` +
    `graph no longer uses, then publish again.`
  );
}
