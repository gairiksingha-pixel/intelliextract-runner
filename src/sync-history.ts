import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface SyncHistoryEntry {
  timestamp: string;
  synced: number;
  skipped: number;
  errors: number;
  brands: string[];
  /** Purchaser folder names involved in this sync entry, parallel to brands. */
  purchasers?: string[];
}

const HISTORY_FILE = "sync-history.json";

export function getSyncHistoryPath(checkpointDir: string): string {
  return join(checkpointDir, HISTORY_FILE);
}

export function appendSyncHistory(
  checkpointDir: string,
  entry: SyncHistoryEntry,
): void {
  if (!existsSync(checkpointDir)) mkdirSync(checkpointDir, { recursive: true });
  const path = getSyncHistoryPath(checkpointDir);
  let history: SyncHistoryEntry[] = [];
  if (existsSync(path)) {
    try {
      history = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      history = [];
    }
  }
  history.push(entry);
  // Keep only last 100 entries to avoid bloating
  if (history.length > 100) history = history.slice(-100);
  writeFileSync(path, JSON.stringify(history, null, 2), "utf-8");
}

export function readSyncHistory(checkpointDir: string): SyncHistoryEntry[] {
  const path = getSyncHistoryPath(checkpointDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}
