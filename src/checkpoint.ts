/**
 * File-level checkpointing for resumable execution.
 * Uses SQLite (via better-sqlite3) for structured, queryable storage.
 * Automatic one-time migration from legacy JSON checkpoint format.
 */

import {
  mkdirSync,
  existsSync,
  readFileSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  CheckpointRecord,
  CheckpointStatus,
  SyncHistoryEntry,
  ManifestEntry,
  Schedule,
  ResumeState,
  EmailConfig,
} from "./types.js";

const RUN_ID_KEY = "current_run_id";
const LAST_RUN_NUM_KEY = "last_run_number";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckpointDb {
  /** Path to the .sqlite file */
  _path: string;
  /** The underlying better-sqlite3 handle */
  _db: DatabaseType;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Resolve the .sqlite path from the config-supplied checkpoint path. */
function sqlitePath(checkpointPath: string): string {
  // Config has `checkpoint.db` — we keep the same file name but ensure .sqlite extension
  // to clearly differentiate from the old JSON file.
  return checkpointPath
    .replace(/\.json$/i, ".sqlite")
    .replace(/\.db$/i, ".sqlite");
}

/** Legacy JSON path (for migration). */
function legacyJsonPath(checkpointPath: string): string {
  if (existsSync(checkpointPath) && !checkpointPath.endsWith(".sqlite")) {
    return checkpointPath;
  }
  const jsonAlt = checkpointPath
    .replace(/\.sqlite$/i, ".json")
    .replace(/\.db$/i, ".json");
  if (existsSync(jsonAlt)) return jsonAlt;
  const dbAlt = checkpointPath
    .replace(/\.sqlite$/i, ".db")
    .replace(/\.json$/i, ".db");
  if (existsSync(dbAlt)) return dbAlt;
  return jsonAlt || checkpointPath + ".json";
}

function initSchema(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      file_path     TEXT    NOT NULL,
      relative_path TEXT    NOT NULL,
      brand         TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      started_at    TEXT,
      finished_at   TEXT,
      latency_ms    REAL,
      status_code   INTEGER,
      error_message TEXT,
      pattern_key   TEXT,
      run_id        TEXT    NOT NULL,
      purchaser     TEXT,
      PRIMARY KEY (run_id, file_path)
    );

    CREATE TABLE IF NOT EXISTS sync_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT    NOT NULL,
      synced     INTEGER NOT NULL,
      skipped    INTEGER NOT NULL,
      errors     INTEGER NOT NULL,
      brands     TEXT    NOT NULL, -- JSON string
      purchasers TEXT              -- JSON string
    );

    CREATE TABLE IF NOT EXISTS sync_manifest (
      key    TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      etag   TEXT,
      size   INTEGER
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      brands     TEXT NOT NULL, -- JSON string
      purchasers TEXT NOT NULL, -- JSON string
      cron       TEXT NOT NULL,
      timezone   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON checkpoints(status);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_file_path ON checkpoints(file_path);
    CREATE INDEX IF NOT EXISTS idx_sync_history_timestamp ON sync_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_schedules_created_at ON schedules(created_at);
  `);
}

// ─── Legacy JSON migration ──────────────────────────────────────────────────

interface LegacyRow {
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
  purchaser: string | null;
}

interface LegacyStore {
  run_meta: Record<string, string>;
  checkpoints: LegacyRow[];
}

interface LegacySyncEntry {
  timestamp: string;
  synced: number;
  skipped: number;
  errors: number;
  brands: string[];
  purchasers?: string[];
}

function migrateFromJson(db: DatabaseType, jsonPath: string): void {
  if (!existsSync(jsonPath)) return;

  let store: LegacyStore;
  try {
    const raw = readFileSync(jsonPath, "utf-8");
    store = JSON.parse(raw) as LegacyStore;
  } catch {
    return; // corrupt / unreadable — skip migration
  }

  const insertMeta = db.prepare(
    "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
  );
  const insertCp = db.prepare(`
    INSERT OR REPLACE INTO checkpoints
      (file_path, relative_path, brand, status, started_at, finished_at,
       latency_ms, status_code, error_message, pattern_key, run_id, purchaser)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const migrate = db.transaction(() => {
    if (store.run_meta) {
      for (const [key, value] of Object.entries(store.run_meta)) {
        insertMeta.run(key, value);
      }
    }
    if (Array.isArray(store.checkpoints)) {
      for (const c of store.checkpoints) {
        insertCp.run(
          c.file_path,
          c.relative_path,
          c.brand,
          c.status,
          c.started_at ?? null,
          c.finished_at ?? null,
          c.latency_ms ?? null,
          c.status_code ?? null,
          c.error_message ?? null,
          c.pattern_key ?? null,
          c.run_id,
          c.purchaser ?? null,
        );
      }
    }
  });

  migrate();

  // Migrate sync-history.json if it exists in the same directory
  const syncHistoryJson = join(dirname(jsonPath), "sync-history.json");
  if (existsSync(syncHistoryJson)) {
    try {
      const raw = readFileSync(syncHistoryJson, "utf-8");
      const history = JSON.parse(raw) as LegacySyncEntry[];
      if (Array.isArray(history)) {
        const insertSync = db.prepare(`
          INSERT INTO sync_history (timestamp, synced, skipped, errors, brands, purchasers)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        db.transaction(() => {
          for (const entry of history) {
            insertSync.run(
              entry.timestamp,
              entry.synced,
              entry.skipped,
              entry.errors,
              JSON.stringify(entry.brands),
              entry.purchasers ? JSON.stringify(entry.purchasers) : null,
            );
          }
        })();
        renameSync(syncHistoryJson, syncHistoryJson + ".migrated");
      }
    } catch {
      // ignore history migration errors
    }
  }

  // Migrate sync-manifest.json if it exists in the same directory
  const syncManifestJson = join(dirname(jsonPath), "sync-manifest.json");
  if (existsSync(syncManifestJson)) {
    try {
      const raw = readFileSync(syncManifestJson, "utf-8");
      const manifest = JSON.parse(raw) as Record<string, any>;
      if (typeof manifest === "object" && manifest !== null) {
        const insertManifest = db.prepare(`
          INSERT OR REPLACE INTO sync_manifest (key, sha256, etag, size)
          VALUES (?, ?, ?, ?)
        `);
        db.transaction(() => {
          for (const [key, value] of Object.entries(manifest)) {
            if (typeof value === "string") {
              // Legacy string SHA-256
              insertManifest.run(key, value, null, null);
            } else if (typeof value === "object" && value !== null) {
              // Modern ManifestEntry
              insertManifest.run(
                key,
                value.sha256,
                value.etag ?? null,
                value.size ?? null,
              );
            }
          }
        })();
        renameSync(syncManifestJson, syncManifestJson + ".migrated");
      }
    } catch {
      // ignore manifest migration errors
    }
  }

  // Migrate schedules.json if it exists in the same directory
  const schedulesJson = join(dirname(jsonPath), "schedules.json");
  if (existsSync(schedulesJson)) {
    try {
      const raw = readFileSync(schedulesJson, "utf-8");
      const schedules = JSON.parse(raw);
      if (Array.isArray(schedules)) {
        const insertSchedule = db.prepare(`
          INSERT OR REPLACE INTO schedules (id, created_at, brands, purchasers, cron, timezone)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        db.transaction(() => {
          for (const s of schedules) {
            insertSchedule.run(
              s.id,
              s.createdAt,
              JSON.stringify(s.brands),
              JSON.stringify(s.purchasers),
              s.cron,
              s.timezone,
            );
          }
        })();
        renameSync(schedulesJson, schedulesJson + ".migrated");
      }
    } catch {
      // ignore schedules migration errors
    }
  }

  // Migrate resume-state.json if it exists in the same directory
  const resumeStateJson = join(dirname(jsonPath), "resume-state.json");
  if (existsSync(resumeStateJson)) {
    try {
      const raw = readFileSync(resumeStateJson, "utf-8");
      const state = JSON.parse(raw);
      if (
        typeof state === "object" &&
        state !== null &&
        Object.keys(state).length > 0
      ) {
        db.prepare(
          "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
        ).run("resume_state", JSON.stringify(state));
      }
      renameSync(resumeStateJson, resumeStateJson + ".migrated");
    } catch {
      // ignore resume-state migration errors
    }
  }

  // Migrate notification-config.json if it exists in the same directory
  const notificationJson = join(dirname(jsonPath), "notification-config.json");
  if (existsSync(notificationJson)) {
    try {
      const raw = readFileSync(notificationJson, "utf-8");
      const config = JSON.parse(raw);
      if (typeof config === "object" && config !== null) {
        db.prepare(
          "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
        ).run("notification_config", JSON.stringify(config));
      }
      renameSync(notificationJson, notificationJson + ".migrated");
    } catch {
      // ignore notification migration errors
    }
  }

  // Migrate last-pipe-params.json if it exists in the same directory
  const pipeParamsJson = join(dirname(jsonPath), "last-pipe-params.json");
  if (existsSync(pipeParamsJson)) {
    try {
      const raw = readFileSync(pipeParamsJson, "utf-8");
      db.prepare(
        "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
      ).run("last_pipe_params", raw);
      renameSync(pipeParamsJson, pipeParamsJson + ".migrated");
    } catch {
      // ignore pipe params migration
    }
  }

  // Migrate last-run-state.json if it exists in the same directory
  const runStateJson = join(dirname(jsonPath), "last-run-state.json");
  if (existsSync(runStateJson)) {
    try {
      const raw = readFileSync(runStateJson, "utf-8");
      db.prepare(
        "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
      ).run("last_run_state", raw);
      renameSync(runStateJson, runStateJson + ".migrated");
    } catch {
      // ignore run state migration
    }
  }

  // Migrate last-run-id.txt if it exists in the same directory
  const lastRunIdFile = join(dirname(jsonPath), "last-run-id.txt");
  if (existsSync(lastRunIdFile)) {
    try {
      const raw = readFileSync(lastRunIdFile, "utf-8").trim();
      if (raw) {
        db.prepare(
          "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
        ).run("current_run_id", raw);
      }
      renameSync(lastRunIdFile, lastRunIdFile + ".migrated");
    } catch {
      // ignore
    }
  }

  // Migrate last-run-completed.txt if it exists in the same directory
  const lastCompletedFile = join(dirname(jsonPath), "last-run-completed.txt");
  if (existsSync(lastCompletedFile)) {
    try {
      const raw = readFileSync(lastCompletedFile, "utf-8").trim();
      if (raw) {
        db.prepare(
          "INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)",
        ).run("last_run_completed", raw);
      }
      renameSync(lastCompletedFile, lastCompletedFile + ".migrated");
    } catch {
      // ignore
    }
  }

  // Rename the old JSON so we don't re-migrate every time
  try {
    const backupPath = jsonPath + ".migrated";
    if (!existsSync(backupPath)) {
      renameSync(jsonPath, backupPath);
    }
  } catch {
    // ignore rename error
  }
}

// ─── Row ↔ Record converters ────────────────────────────────────────────────

function rowToRecord(r: LegacyRow): CheckpointRecord {
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
    purchaser: r.purchaser ?? undefined,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function openCheckpointDb(checkpointPath: string): CheckpointDb {
  const path = sqlitePath(checkpointPath);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const _db = new Database(path);

  // Performance pragmas
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");

  initSchema(_db);

  // One-time migration from legacy JSON
  const jsonFile = legacyJsonPath(checkpointPath);
  if (existsSync(jsonFile)) {
    // Only migrate if the SQLite DB is empty (first open after switch)
    const count = (
      _db.prepare("SELECT COUNT(*) AS cnt FROM checkpoints").get() as {
        cnt: number;
      }
    ).cnt;
    if (count === 0) {
      migrateFromJson(_db, jsonFile);
    }
  }

  return { _path: path, _db };
}

/** Format run ID as a sequence number (RUN1) or human-readable date for temporary IDs. */
function formatRunId(date: Date, num?: number): string {
  if (num !== undefined) {
    return `RUN${num}`;
  }
  const istDate = new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const y = istDate.getFullYear();
  const m = String(istDate.getMonth() + 1).padStart(2, "0");
  const d = String(istDate.getDate()).padStart(2, "0");
  const h = String(istDate.getHours()).padStart(2, "0");
  const min = String(istDate.getMinutes()).padStart(2, "0");
  const s = String(istDate.getSeconds()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 4);
  return `SKIP-${y}${m}${d}-${h}${min}${s}-${suffix}`;
}

export function getMeta(db: CheckpointDb, key: string): string | null {
  const row = db._db
    .prepare("SELECT value FROM run_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: CheckpointDb, key: string, value: string): void {
  db._db
    .prepare("INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)")
    .run(key, value);
}

function getNextRunNumber(db: CheckpointDb): number {
  const lastNumStr = getMeta(db, LAST_RUN_NUM_KEY);
  if (lastNumStr) {
    return parseInt(lastNumStr, 10) + 1;
  }
  // Fallback: scan existing checkpoints for max RUNn
  const row = db._db
    .prepare(
      "SELECT run_id FROM checkpoints WHERE run_id LIKE 'RUN%' OR run_id LIKE '#RUN%'",
    )
    .all() as { run_id: string }[];
  let max = 0;
  for (const r of row) {
    const match = r.run_id.match(/#?RUN(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/** Generate a new run ID without persisting it (for "no work" runs). */
export function createRunIdOnly(): string {
  return formatRunId(new Date());
}

export function startNewRun(db: CheckpointDb, isPipe: boolean = false): string {
  const num = getNextRunNumber(db);
  const runId = formatRunId(new Date(), num);
  setMeta(db, RUN_ID_KEY, runId);
  setMeta(db, LAST_RUN_NUM_KEY, num.toString());
  return runId;
}

/** Get the run ID from the last (potentially interrupted) run. */
export function getCurrentRunId(db: CheckpointDb): string | null {
  return getMeta(db, RUN_ID_KEY);
}

export function getOrCreateRunId(db: CheckpointDb): string {
  let runId = getCurrentRunId(db);
  if (!runId) {
    runId = startNewRun(db);
  }
  return runId;
}

export function upsertCheckpoint(
  db: CheckpointDb,
  record: CheckpointRecord,
): void {
  db._db
    .prepare(
      `INSERT OR REPLACE INTO checkpoints
        (file_path, relative_path, brand, status, started_at, finished_at,
         latency_ms, status_code, error_message, pattern_key, run_id, purchaser)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.filePath,
      record.relativePath,
      record.brand,
      record.status,
      record.startedAt ?? null,
      record.finishedAt ?? null,
      record.latencyMs ?? null,
      record.statusCode ?? null,
      record.errorMessage ?? null,
      record.patternKey ?? null,
      record.runId,
      record.purchaser ?? null,
    );
}

/** Batch upsert: wrap all inserts in a single transaction for performance. */
export function upsertCheckpoints(
  db: CheckpointDb,
  records: CheckpointRecord[],
): void {
  if (records.length === 0) return;

  const stmt = db._db.prepare(
    `INSERT OR REPLACE INTO checkpoints
      (file_path, relative_path, brand, status, started_at, finished_at,
       latency_ms, status_code, error_message, pattern_key, run_id, purchaser)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const batchInsert = db._db.transaction((recs: CheckpointRecord[]) => {
    for (const r of recs) {
      stmt.run(
        r.filePath,
        r.relativePath,
        r.brand,
        r.status,
        r.startedAt ?? null,
        r.finishedAt ?? null,
        r.latencyMs ?? null,
        r.statusCode ?? null,
        r.errorMessage ?? null,
        r.patternKey ?? null,
        r.runId,
        r.purchaser ?? null,
      );
    }
  });

  batchInsert(records);
}

export function isCompleted(
  db: CheckpointDb,
  runId: string,
  filePath: string,
): boolean {
  const row = db._db
    .prepare(
      "SELECT status FROM checkpoints WHERE file_path = ? AND run_id = ?",
    )
    .get(filePath, runId) as { status: string } | undefined;
  return row?.status === "done";
}

export function getCompletedPaths(db: CheckpointDb): Set<string> {
  const rows = db._db
    .prepare(
      "SELECT DISTINCT file_path FROM checkpoints WHERE status IN ('done', 'skipped', 'error')",
    )
    .all() as { file_path: string }[];
  return new Set(rows.map((r) => r.file_path));
}

export function getRecordsForRun(
  db: CheckpointDb,
  runId: string,
): CheckpointRecord[] {
  const rows = db._db
    .prepare("SELECT * FROM checkpoints WHERE run_id = ?")
    .all(runId) as LegacyRow[];
  return rows.map(rowToRecord);
}

/**
 * Returns overall statistics across ALL runs for unique files,
 * taking the latest status for each file.
 */
export function getCumulativeStats(
  db: CheckpointDb,
  filter?: { tenant?: string; purchaser?: string },
): { success: number; failed: number; total: number } {
  // Build a query that groups by file_path and picks the latest status
  let sql = `
    SELECT file_path, status, MAX(COALESCE(started_at, '')) AS latest_start
    FROM checkpoints
    WHERE 1=1
  `;
  const params: string[] = [];
  if (filter?.tenant) {
    sql += " AND brand = ?";
    params.push(filter.tenant);
  }
  if (filter?.purchaser) {
    sql += " AND purchaser = ?";
    params.push(filter.purchaser);
  }
  sql += " GROUP BY file_path";

  // We need a subquery to get the latest record per file_path
  // SQLite trick: the row returned by GROUP BY with MAX is NOT guaranteed
  // to return the status of the MAX row. So use a proper subquery.
  const latestSql = `
    SELECT c.file_path, c.status
    FROM checkpoints c
    INNER JOIN (
      SELECT file_path, MAX(COALESCE(started_at, '')) AS max_start
      FROM checkpoints
      WHERE 1=1
      ${filter?.tenant ? "AND brand = ?" : ""}
      ${filter?.purchaser ? "AND purchaser = ?" : ""}
      GROUP BY file_path
    ) latest ON c.file_path = latest.file_path AND COALESCE(c.started_at, '') = latest.max_start
    ${filter?.tenant ? "AND c.brand = ?" : ""}
    ${filter?.purchaser ? "AND c.purchaser = ?" : ""}
  `;
  const latestParams: string[] = [];
  if (filter?.tenant) latestParams.push(filter.tenant);
  if (filter?.purchaser) latestParams.push(filter.purchaser);
  if (filter?.tenant) latestParams.push(filter.tenant);
  if (filter?.purchaser) latestParams.push(filter.purchaser);

  const rows = db._db.prepare(latestSql).all(...latestParams) as {
    file_path: string;
    status: string;
  }[];

  // Deduplicate in JS to be safe (multiple rows with same max timestamp)
  const latestByFile = new Map<string, string>();
  for (const r of rows) {
    latestByFile.set(r.file_path, r.status);
  }

  let success = 0;
  let failed = 0;
  for (const status of latestByFile.values()) {
    if (status === "done") success++;
    else if (status === "error") failed++;
  }

  return { success, failed, total: latestByFile.size };
}

/** All unique run IDs from checkpoints, ordered by latest first. */
export function getAllRunIdsOrdered(db: CheckpointDb): string[] {
  const rows = db._db
    .prepare(
      `SELECT run_id, MIN(COALESCE(started_at, '')) AS earliest
       FROM checkpoints
       GROUP BY run_id
       ORDER BY earliest DESC`,
    )
    .all() as { run_id: string }[];
  return rows.map((r) => r.run_id);
}

export function closeCheckpointDb(db: CheckpointDb): void {
  try {
    db._db.close();
  } catch {
    // already closed
  }
}

// ─── New helpers (replace direct db._data.checkpoints access) ────────────────

/**
 * Get all file paths with "error" status across all runs.
 * Used by runner.ts and load-engine.ts for retry-failed logic.
 */
export function getErrorPaths(db: CheckpointDb): Set<string> {
  const rows = db._db
    .prepare(
      "SELECT DISTINCT file_path FROM checkpoints WHERE status = 'error'",
    )
    .all() as { file_path: string }[];
  return new Set(rows.map((r) => r.file_path));
}

/**
 * Find a checkpoint row for a specific run_id and file_path.
 * Used by load-engine.ts to check if a file is already processed in the current run.
 */
export function findCheckpointRow(
  db: CheckpointDb,
  runId: string,
  filePath: string,
): { status: string } | undefined {
  return db._db
    .prepare(
      "SELECT status FROM checkpoints WHERE run_id = ? AND file_path = ?",
    )
    .get(runId, filePath) as { status: string } | undefined;
}

/**
 * Get ALL checkpoint rows as CheckpointRecord[].
 * Used by app-server.mjs to build extraction data pages.
 */
export function getAllCheckpoints(db: CheckpointDb): CheckpointRecord[] {
  const rows = db._db.prepare("SELECT * FROM checkpoints").all() as LegacyRow[];
  return rows.map(rowToRecord);
}

/**
 * Get all run metadata as a plain object.
 * Used by app-server.mjs for reading run state.
 */
export function getRunMeta(db: CheckpointDb): Record<string, string> {
  const rows = db._db.prepare("SELECT key, value FROM run_meta").all() as {
    key: string;
    value: string;
  }[];
  const meta: Record<string, string> = {};
  for (const r of rows) {
    meta[r.key] = r.value;
  }
  return meta;
}

/**
 * Append a new sync history entry to the database.
 */
export function appendSyncHistory(
  db: CheckpointDb,
  entry: SyncHistoryEntry,
): void {
  db._db
    .prepare(
      `INSERT INTO sync_history (timestamp, synced, skipped, errors, brands, purchasers)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.timestamp,
      entry.synced,
      entry.skipped,
      entry.errors,
      JSON.stringify(entry.brands),
      entry.purchasers ? JSON.stringify(entry.purchasers) : null,
    );

  // Keep only last 100 entries to avoid bloating (optional but good practice)
  const count = (
    db._db.prepare("SELECT COUNT(*) AS cnt FROM sync_history").get() as {
      cnt: number;
    }
  ).cnt;
  if (count > 100) {
    db._db
      .prepare(
        "DELETE FROM sync_history WHERE id IN (SELECT id FROM sync_history ORDER BY id ASC LIMIT ?)",
      )
      .run(count - 100);
  }
}

/**
 * Read the latest 100 sync history entries.
 */
export function getSyncHistory(db: CheckpointDb): SyncHistoryEntry[] {
  const rows = db._db
    .prepare("SELECT * FROM sync_history ORDER BY id ASC LIMIT 100")
    .all() as {
    timestamp: string;
    synced: number;
    skipped: number;
    errors: number;
    brands: string;
    purchasers: string | null;
  }[];

  return rows.map((r) => ({
    timestamp: r.timestamp,
    synced: r.synced,
    skipped: r.skipped,
    errors: r.errors,
    brands: JSON.parse(r.brands),
    purchasers: r.purchasers ? JSON.parse(r.purchasers) : undefined,
  }));
}

/**
 * Read the entire sync manifest from the database.
 */
export function getSyncManifest(
  db: CheckpointDb,
): Record<string, ManifestEntry> {
  const rows = db._db.prepare("SELECT * FROM sync_manifest").all() as {
    key: string;
    sha256: string;
    etag: string | null;
    size: number | null;
  }[];

  const manifest: Record<string, ManifestEntry> = {};
  for (const r of rows) {
    manifest[r.key] = {
      sha256: r.sha256,
      etag: r.etag ?? "",
      size: r.size ?? 0,
    };
  }
  return manifest;
}

/**
 * Upsert a single entry into the sync manifest.
 */
export function upsertSyncManifestEntry(
  db: CheckpointDb,
  key: string,
  entry: ManifestEntry,
): void {
  db._db
    .prepare(
      `INSERT OR REPLACE INTO sync_manifest (key, sha256, etag, size)
       VALUES (?, ?, ?, ?)`,
    )
    .run(key, entry.sha256, entry.etag, entry.size);
}

/**
 * Delete a single entry from the sync manifest.
 */
export function deleteSyncManifestEntry(db: CheckpointDb, key: string): void {
  db._db.prepare("DELETE FROM sync_manifest WHERE key = ?").run(key);
}

/**
 * Read resume state from run_meta.
 */
export function getResumeState(db: CheckpointDb): ResumeState {
  const val = getMeta(db, "resume_state");
  if (!val) return {};
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

/**
 * Save resume state to run_meta.
 */
export function saveResumeState(db: CheckpointDb, state: ResumeState): void {
  setMeta(db, "resume_state", JSON.stringify(state));
}

/**
 * Read email config from run_meta.
 */
export function getEmailConfig(db: CheckpointDb): EmailConfig {
  const val = getMeta(db, "notification_config");
  if (!val) return {};
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

/**
 * Save email config to run_meta.
 */
export function saveEmailConfig(db: CheckpointDb, config: EmailConfig): void {
  setMeta(db, "notification_config", JSON.stringify(config));
}

/**
 * Read all schedules from the database.
 */
export function getSchedules(db: CheckpointDb): Schedule[] {
  const rows = db._db
    .prepare("SELECT * FROM schedules ORDER BY created_at ASC")
    .all() as any[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    brands: JSON.parse(r.brands),
    purchasers: JSON.parse(r.purchasers),
    cron: r.cron,
    timezone: r.timezone,
  }));
}

/**
 * Persist all schedules to the database (overwrites existing).
 */
export function saveSchedules(db: CheckpointDb, schedules: Schedule[]): void {
  db._db.transaction(() => {
    db._db.prepare("DELETE FROM schedules").run();
    const insert = db._db.prepare(`
      INSERT INTO schedules (id, created_at, brands, purchasers, cron, timezone)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const s of schedules) {
      insert.run(
        s.id,
        s.createdAt,
        JSON.stringify(s.brands),
        JSON.stringify(s.purchasers),
        s.cron,
        s.timezone,
      );
    }
  })();
}
