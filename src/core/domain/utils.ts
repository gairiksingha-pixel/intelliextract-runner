/**
 * Pure domain utilities — zero external dependencies.
 * Safe to import from any layer (core, adapters, infrastructure).
 */

/**
 * Normalizes a file path to a forward-slash, no-leading-slash relative path.
 * e.g. "\\brand\\file.json" → "brand/file.json"
 */
export function normalizeRelativePath(p: string): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
