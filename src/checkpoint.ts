/**
 * File-level checkpointing for resumable execution.
 * Uses a JSON file to record status per file so runs can resume after interruption.
 * (No native modules - works on Windows without Visual Studio build tools.)
 */

import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { CheckpointRecord, CheckpointStatus } from "./types.js";

const RUN_ID_KEY = "current_run_id";

// Retry configuration for lock acquisition
const LOCK_RETRIES = 10;
const LOCK_WAIT_MS = 100;

function sleep(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait */
  }
}

interface CheckpointRow {
  file_path: string;
  relative_path: string;
  brand: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  latency_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  pattern_key: string | null;
  run_id: string;
}

interface CheckpointStore {
  run_meta: Record<string, string>;
  checkpoints: CheckpointRow[];
}

export interface CheckpointDb {
  _path: string;
  _data: CheckpointStore;
}

function jsonPath(checkpointPath: string): string {
  return (
    checkpointPath.replace(/\.sqlite$/i, ".json") || checkpointPath + ".json"
  );
}

function loadStore(path: string): CheckpointStore {
  // Try to read up to 3 times in case of atomic write contention
  for (let i = 0; i < 3; i++) {
    if (!existsSync(path)) {
      return { run_meta: {}, checkpoints: [] };
    }
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as CheckpointStore;
    } catch (e) {
      if (i === 2) {
        // Return empty on final failure to avoid crashing
        return { run_meta: {}, checkpoints: [] };
      }
      sleep(50);
    }
  }
  return { run_meta: {}, checkpoints: [] };
}

function saveStore(db: CheckpointDb): void {
  const dir = dirname(db._path);
  mkdirSync(dir, { recursive: true });

  const lockFile = db._path + ".lock";
  const tempFile = db._path + ".tmp." + Math.random().toString(36).slice(2);
  let locked = false;

  try {
    // 1. Acquire Lock
    for (let i = 0; i < LOCK_RETRIES; i++) {
      try {
        // Exclusive creation fails if file exists
        writeFileSync(lockFile, process.pid.toString(), { flag: "wx" });
        locked = true;
        break;
      } catch (e) {
        if (i === LOCK_RETRIES - 1) {
          // Could not acquire lock, proceed with risk or log error?
          // We'll proceed to try and write anyway to avoid total data loss,
          // but this indicates high contention.
        } else {
          sleep(LOCK_WAIT_MS);
        }
      }
    }

    // 2. Reload latest data to merge (in case it changed while we were working)
    // This is critical for concurrency: merge our changes into LATEST on disk
    let currentOnDisk: CheckpointStore = { run_meta: {}, checkpoints: [] };
    if (existsSync(db._path)) {
      try {
        const raw = readFileSync(db._path, "utf-8");
        currentOnDisk = JSON.parse(raw);
      } catch (_) {}
    }

    // Merge strategy:
    // - run_meta: overwrite with ours
    // - checkpoints: merge ours into disk version based on (run_id, file_path)
    const mergedCheckpoints = [...(currentOnDisk.checkpoints || [])];
    const ourCheckpoints = db._data.checkpoints;

    // Create a map for fast lookup of disk records
    const diskMap = new Map<string, number>();
    mergedCheckpoints.forEach((r, idx) => {
      diskMap.set(`${r.run_id}::${r.file_path}`, idx);
    });

    // Apply our updates
    for (const ourRow of ourCheckpoints) {
      const key = `${ourRow.run_id}::${ourRow.file_path}`;
      const idx = diskMap.get(key);
      if (idx !== undefined) {
        mergedCheckpoints[idx] = ourRow;
      } else {
        mergedCheckpoints.push(ourRow);
        diskMap.set(key, mergedCheckpoints.length - 1);
      }
    }

    const mergedData: CheckpointStore = {
      run_meta: { ...currentOnDisk.run_meta, ...db._data.run_meta },
      checkpoints: mergedCheckpoints,
    };

    // Update in-memory db logic to match merged state
    db._data = mergedData;

    // 3. Write to temp file
    writeFileSync(tempFile, JSON.stringify(mergedData, null, 0), "utf-8");

    // 4. Atomic Rename
    renameSync(tempFile, db._path);
  } catch (e) {
    // Write failed
    try {
      if (existsSync(tempFile)) unlinkSync(tempFile);
    } catch (_) {}
  } finally {
    // 5. Release Lock
    if (locked) {
      try {
        unlinkSync(lockFile);
      } catch (_) {}
    }
  }
}

function rowToRecord(r: CheckpointRow): CheckpointRecord {
  return {
    filePath: r.file_path,
    relativePath: r.relative_path,
    brand: r.brand,
    status: r.status as CheckpointStatus,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    latencyMs: r.latency_ms ?? undefined,
    statusCode: r.status_code ?? undefined,
    errorMessage: r.error_message ?? undefined,
    patternKey: r.pattern_key ?? undefined,
    runId: r.run_id,
  };
}

function recordToRow(record: CheckpointRecord): CheckpointRow {
  return {
    file_path: record.filePath,
    relative_path: record.relativePath,
    brand: record.brand,
    status: record.status,
    started_at: record.startedAt ?? null,
    finished_at: record.finishedAt ?? null,
    latency_ms: record.latencyMs ?? null,
    status_code: record.statusCode ?? null,
    error_message: record.errorMessage ?? null,
    pattern_key: record.patternKey ?? null,
    run_id: record.runId,
  };
}

export function openCheckpointDb(checkpointPath: string): CheckpointDb {
  const path = jsonPath(checkpointPath);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const _data = loadStore(path);
  if (!_data.run_meta) _data.run_meta = {};
  if (!Array.isArray(_data.checkpoints)) _data.checkpoints = [];
  return { _path: path, _data };
}

/** Format run ID as human-readable date and time (e.g. run_2025-02-11_14-30-52). */
function formatRunId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 4);
  return `run_${y}-${m}-${d}_${h}-${min}-${s}_${suffix}`;
}

/** Generate a new run ID without persisting it (for "no work" runs so we don't overwrite the current run). */
export function createRunIdOnly(): string {
  return formatRunId(new Date());
}

export function startRun(db: CheckpointDb): string {
  const runId = formatRunId(new Date());
  db._data.run_meta[RUN_ID_KEY] = runId;
  saveStore(db);
  return runId;
}

export function getCurrentRunId(db: CheckpointDb): string | null {
  return db._data.run_meta[RUN_ID_KEY] ?? null;
}

export function getOrCreateRunId(db: CheckpointDb): string {
  let runId = getCurrentRunId(db);
  if (!runId) {
    runId = startRun(db);
  }
  return runId;
}

export function upsertCheckpoint(
  db: CheckpointDb,
  record: CheckpointRecord,
): void {
  const row = recordToRow(record);
  const idx = db._data.checkpoints.findIndex(
    (c) => c.file_path === record.filePath && c.run_id === record.runId,
  );
  if (idx >= 0) {
    db._data.checkpoints[idx] = row;
  } else {
    db._data.checkpoints.push(row);
  }
  saveStore(db);
}

export function isCompleted(
  db: CheckpointDb,
  runId: string,
  filePath: string,
): boolean {
  const row = db._data.checkpoints.find(
    (c) => c.file_path === filePath && c.run_id === runId,
  );
  return row?.status === "done";
}

export function getCompletedPaths(db: CheckpointDb): Set<string> {
  // Treat both "done" and "skipped" as "completed" for the purpose of
  // future runs. This ensures that:
  // - Files successfully processed in a prior run ("done") are not
  //   re-processed when skipCompleted is enabled.
  // - Files explicitly marked as "skipped" in a later run (because they
  //   were already completed) continue to be treated as completed even
  //   if older "done" rows are no longer present in the checkpoint file.
  const rows = db._data.checkpoints.filter(
    (c) => c.status === "done" || c.status === "skipped",
  );
  return new Set(rows.map((r) => r.file_path));
}

export function getRecordsForRun(
  db: CheckpointDb,
  runId: string,
): CheckpointRecord[] {
  const rows = db._data.checkpoints.filter((c) => c.run_id === runId);
  return rows.map(rowToRecord);
}

/** All unique run IDs from checkpoints, ordered by latest first (by earliest started_at in that run). */
export function getAllRunIdsOrdered(db: CheckpointDb): string[] {
  const byRun = new Map<string, number>();
  for (const c of db._data.checkpoints) {
    const t = c.started_at ? new Date(c.started_at).getTime() : 0;
    const cur = byRun.get(c.run_id);
    if (cur === undefined || t < cur) byRun.set(c.run_id, t);
  }
  return [...byRun.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([runId]) => runId);
}

export function closeCheckpointDb(db: CheckpointDb): void {
  saveStore(db);
}
