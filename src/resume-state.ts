/**
 * Resume state for sync-extract pipeline: tracks the file currently being
 * downloaded so that on resume we can delete the partial file and re-run from that file.
 * Uses SQLite (via checkpoint.js) for storage.
 */
import { existsSync, unlinkSync } from "node:fs";
import type { Config, ResumeState } from "./types.js";
import {
  openCheckpointDb,
  getResumeState as dbGetResumeState,
  saveResumeState as dbSaveResumeState,
  deleteSyncManifestEntry,
  closeCheckpointDb,
} from "./checkpoint.js";

export { ResumeState };

export function loadResumeState(config: Config): ResumeState {
  const db = openCheckpointDb(config.run.checkpointPath);
  try {
    return dbGetResumeState(db);
  } finally {
    closeCheckpointDb(db);
  }
}

export function saveResumeState(config: Config, state: ResumeState): void {
  const db = openCheckpointDb(config.run.checkpointPath);
  try {
    dbSaveResumeState(db, state);
  } finally {
    closeCheckpointDb(db);
  }
}

export function clearResumeState(config: Config): void {
  saveResumeState(config, {});
}

/**
 * Called when starting with --resume: delete the partial file (if any) from disk
 * and remove its entry from the sync manifest, then clear resume state so the
 * pipeline can run and re-download that file.
 */
export function clearPartialFileAndResumeState(config: Config): void {
  const db = openCheckpointDb(config.run.checkpointPath);
  try {
    const state = dbGetResumeState(db);
    const path = state.syncInProgressPath;
    const manifestKey = state.syncInProgressManifestKey;

    if (path && existsSync(path)) {
      try {
        unlinkSync(path);
      } catch (_) {
        // ignore
      }
    }

    if (manifestKey) {
      deleteSyncManifestEntry(db, manifestKey);
    }

    dbSaveResumeState(db, {});
  } finally {
    closeCheckpointDb(db);
  }
}
