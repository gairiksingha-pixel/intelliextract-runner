/**
 * Utilities for parsing process stdout from CLI operations.
 * Belongs in infrastructure/utils — no domain dependencies.
 */

/**
 * Parses sync summary metrics from a process stdout string.
 * Returns null if no recognizable sync summary is found.
 */
export function parseSyncSummaryFromStdout(stdout: string): {
  downloaded: number;
  skipped: number;
  errors: number;
  totalInInventory: number;
} | null {
  if (!stdout || typeof stdout !== "string") return null;
  const downloadedM = /Downloaded\s*\(new\):\s*(\d+)/i.exec(stdout);
  const skippedM =
    /Skipped\s*\(already\s*present[^:]*:\s*(\d+)/i.exec(stdout) ||
    /Skipped:\s*(\d+)/i.exec(stdout);
  const errorsM = /Errors:\s*(\d+)/i.exec(stdout);
  const downloaded = downloadedM ? parseInt(downloadedM[1], 10) : 0;
  const skipped = skippedM ? parseInt(skippedM[1], 10) : 0;
  const errors = errorsM ? parseInt(errorsM[1], 10) : 0;
  if (downloadedM || skippedM || errorsM) {
    return {
      downloaded,
      skipped,
      errors,
      totalInInventory: downloaded + skipped,
    };
  }
  return null;
}
