import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export function listStagingFiles(
  dir: string,
  base: string,
  results: string[],
): string[] {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listStagingFiles(full, base, results);
    } else {
      results.push(relative(base, full));
    }
  }
  return results;
}

export function normalizeRelativePath(p: string): string {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
