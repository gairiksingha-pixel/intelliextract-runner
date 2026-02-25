import {
  openCheckpointDb,
  appendSyncHistory as dbAppendSyncHistory,
  getSyncHistory as dbGetSyncHistory,
  closeCheckpointDb,
} from "./checkpoint.js";
import type { SyncHistoryEntry } from "./types.js";

export { SyncHistoryEntry };

export function appendSyncHistory(
  checkpointPath: string,
  entry: SyncHistoryEntry,
): void {
  const db = openCheckpointDb(checkpointPath);
  try {
    dbAppendSyncHistory(db, entry);
  } finally {
    closeCheckpointDb(db);
  }
}

export function readSyncHistory(checkpointPath: string): SyncHistoryEntry[] {
  const db = openCheckpointDb(checkpointPath);
  try {
    return dbGetSyncHistory(db);
  } finally {
    closeCheckpointDb(db);
  }
}
