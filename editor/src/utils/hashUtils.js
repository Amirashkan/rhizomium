// editor/src/utils/hashUtils.js
// Hash computation utilities for strings
// Supports both cryptographic (SHA-256) and fast (djb2) hashing

/**
 * Fast hash function (djb2 algorithm)
 * Good for performance-critical paths where cryptographic security isn't needed
 * Synchronous operation - returns immediately
 * @param {string} str - String to hash
 * @returns {string} - Hexadecimal hash string
 */
function djb2Hash(str) {
  if (typeof str !== 'string') {
    throw new TypeError('hashString: input must be a string');
  }
  
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16);
}

/**
 * Cryptographic hash function (SHA-256) using Web Crypto API
 * More robust but slower than djb2 - use when collision resistance is important
 * Asynchronous operation - returns a Promise
 * @param {string} str - String to hash
 * @returns {Promise<string>} - Hexadecimal hash string
 */
async function sha256Hash(str) {
  if (typeof str !== 'string') {
    throw new TypeError('hashString: input must be a string');
  }
  
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('hashString: Web Crypto API not available, cannot use SHA-256');
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a string using either SHA-256 (cryptographic) or djb2 (fast)
 * 
 * @param {string} str - String to hash
 * @param {Object} options - Hash options
 * @param {boolean} [options.cryptographic=false] - If true, use SHA-256 (async), otherwise djb2 (sync)
 * @param {boolean} [options.async=false] - If true, always return Promise (for SHA-256), otherwise return sync value when possible
 * @returns {string|Promise<string>} - Hash string (sync) or Promise<string> (async)
 * 
 * @example
 * // Synchronous fast hash (djb2)
 * const hash1 = hashString('hello world');
 * 
 * @example
 * // Asynchronous cryptographic hash (SHA-256)
 * const hash2 = await hashString('hello world', { cryptographic: true });
 * 
 * @example
 * // Always async (returns Promise even for djb2)
 * const hash3 = await hashString('hello world', { async: true });
 */
export function hashString(str, options = {}) {
  const { cryptographic = false, async = false } = options;
  
  if (cryptographic) {
    // SHA-256 is always async
    return sha256Hash(str);
  }
  
  // djb2 is sync, but can be wrapped in Promise if async flag is set
  if (async) {
    return Promise.resolve(djb2Hash(str));
  }
  
  return djb2Hash(str);
}

/**
 * Check if Web Crypto API is available for SHA-256 hashing
 * @returns {boolean} - True if crypto.subtle is available
 */
export function isCryptographicHashAvailable() {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/**
 * Get the default hash algorithm based on availability
 * @returns {'sha256'|'djb2'} - Default hash algorithm name
 */
export function getDefaultHashAlgorithm() {
  return isCryptographicHashAvailable() ? 'sha256' : 'djb2';
}

