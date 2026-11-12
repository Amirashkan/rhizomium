// Build identity exposed in Help → About and patch metadata.
// Vite replaces these constants for every production/development bundle.
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null;
export const APP_BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "unknown";
export const APP_BUILD_DATE = typeof __APP_BUILD_DATE__ === "string" ? __APP_BUILD_DATE__ : "unknown";
export const APP_BUILD_TARGET = typeof __APP_BUILD_TARGET__ === "string" ? __APP_BUILD_TARGET__ : "unknown";
