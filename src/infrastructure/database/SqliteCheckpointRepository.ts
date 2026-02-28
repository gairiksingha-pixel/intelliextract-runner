import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  Checkpoint,
  CheckpointStatus,
} from "../../core/domain/entities/Checkpoint.js";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";

export class SqliteCheckpointRepository implements ICheckpointRepository {
  private _db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb() {
    if (this._db) return this._db;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this._db = new Database(this.dbPath);
    this._db.pragma("journal_mode = DELETE");
    this._db.pragma("synchronous = FULL");
    this._db.pragma("busy_timeout = 5000");
    return this._db;
  }

  async open(path: string): Promise<void> {
    this.dbPath = path;
  }

  async close(): Promise<void> {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  async initialize(): Promise<void> {
    const db = this.getDb();
    db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;

      -- Key-value store for application state and configuration
      CREATE TABLE IF NOT EXISTS tbl_app_config (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      -- Master registry of all files discovered or synced from S3
      CREATE TABLE IF NOT EXISTS tbl_file_registry (
        id           TEXT PRIMARY KEY, -- relativePath acts as unique ID
        fullPath     TEXT,
        brand        TEXT,
        purchaser    TEXT,
        size         INTEGER,
        etag         TEXT,
        sha256       TEXT,
        syncedAt     TEXT,
        registeredAt TEXT,
        extractStatus TEXT DEFAULT 'pending', -- 'pending' | 'running' | 'done' | 'error' | 'skipped'
        extractedAt  TEXT,
        extractError TEXT,
        latencyMs    INTEGER,
        statusCode   INTEGER,
        patternKey   TEXT,
        lastRunId    TEXT,
        fullResponse TEXT
      );

      -- Transactional history of every extraction attempt, grouped by run
      CREATE TABLE IF NOT EXISTS tbl_run_checkpoints (
        runId        TEXT,
        relativePath TEXT,
        status       TEXT,
        startedAt    TEXT,
        finishedAt   TEXT,
        latencyMs    INTEGER,
        statusCode   INTEGER,
        errorMessage TEXT,
        patternKey   TEXT,
        brand        TEXT,
        purchaser    TEXT,
        filePath     TEXT,
        fullResponse TEXT,
        PRIMARY KEY (runId, relativePath)
      );

      -- Cron schedule definitions created by the user
      CREATE TABLE IF NOT EXISTS tbl_cron_schedules (
        id         TEXT PRIMARY KEY,
        created_at TEXT,
        brands     TEXT,
        purchasers TEXT,
        cron       TEXT,
        timezone   TEXT
      );

      -- Aggregate history of S3 sync operations
      CREATE TABLE IF NOT EXISTS tbl_sync_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT,
        synced     INTEGER,
        skipped    INTEGER,
        errors     INTEGER,
        brands     TEXT,
        purchasers TEXT
      );

      -- Per-file extraction request/response log entries
      CREATE TABLE IF NOT EXISTS tbl_extraction_logs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        runId     TEXT,
        timestamp TEXT,
        level     TEXT,
        data      TEXT
      );

      -- Run lifecycle: tracks start, finish, status and origin of each run
      CREATE TABLE IF NOT EXISTS tbl_runs (
        id         TEXT PRIMARY KEY,
        startedAt  TEXT,
        finishedAt TEXT,
        status     TEXT DEFAULT 'running', -- 'running' | 'done' | 'error'
        origin     TEXT,                   -- 'manual' | 'scheduled'
        metadata   TEXT                    -- extra info as JSON
      );

      -- Schedule job audit trail (replaces output/logs/schedule.log)
      CREATE TABLE IF NOT EXISTS tbl_schedule_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT NOT NULL,
        scheduleId TEXT,
        outcome    TEXT, -- 'executed' | 'skipped'
        level      TEXT, -- 'info' | 'warn' | 'error'
        message    TEXT,
        data       TEXT  -- full JSON payload
      );

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_runId        ON tbl_run_checkpoints(runId);
      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_status       ON tbl_run_checkpoints(status);
      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_relativePath ON tbl_run_checkpoints(relativePath);
      CREATE INDEX IF NOT EXISTS idx_file_registry_extractStatus  ON tbl_file_registry(extractStatus);
      CREATE INDEX IF NOT EXISTS idx_extraction_logs_runId_ts     ON tbl_extraction_logs(runId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_runs_startedAt               ON tbl_runs(startedAt);
      CREATE INDEX IF NOT EXISTS idx_schedule_logs_timestamp      ON tbl_schedule_logs(timestamp);
    `);
  }

  async getCurrentRunId(): Promise<string | null> {
    return await this.getMeta("current_run_id");
  }

  async startNewRun(prefix?: string): Promise<string> {
    const runId =
      (prefix || "RUN") + new Date().toISOString().replace(/[:.]/g, "-");
    await this.setMeta("current_run_id", runId);

    const db = this.getDb();
    db.prepare(
      "INSERT INTO tbl_runs (id, startedAt, status) VALUES (?, ?, ?)",
    ).run(runId, new Date().toISOString(), "running");

    return runId;
  }

  async upsertCheckpoints(checkpoints: Checkpoint[]): Promise<void> {
    const db = this.getDb();
    const stmtCp = db.prepare(`
      INSERT OR REPLACE INTO tbl_run_checkpoints
      (filePath, relativePath, brand, status, startedAt, finishedAt, latencyMs, statusCode, errorMessage, patternKey, runId, purchaser, fullResponse)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const stmtFile = db.prepare(`
      UPDATE tbl_file_registry
      SET extractStatus = ?, extractedAt = ?, extractError = ?, latencyMs = ?, statusCode = ?, patternKey = ?, lastRunId = ?, fullResponse = ?
      WHERE id = ?
    `);

    db.transaction(() => {
      for (const cp of checkpoints) {
        stmtCp.run(
          cp.filePath,
          cp.relativePath,
          cp.brand,
          cp.status,
          cp.startedAt,
          cp.finishedAt,
          cp.latencyMs,
          cp.statusCode,
          cp.errorMessage,
          cp.patternKey,
          cp.runId,
          cp.purchaser,
          cp.fullResponse ? JSON.stringify(cp.fullResponse) : null,
        );
        stmtFile.run(
          cp.status === "done" ? "done" : "error",
          cp.finishedAt,
          cp.errorMessage,
          cp.latencyMs,
          cp.statusCode,
          cp.patternKey,
          cp.runId,
          cp.fullResponse ? JSON.stringify(cp.fullResponse) : null,
          cp.relativePath,
        );
      }
    })();
  }

  async getCumulativeStats(filter?: {
    tenant?: string;
    purchaser?: string;
  }): Promise<{ success: number; failed: number; total: number }> {
    const db = this.getDb();
    let query = "SELECT status FROM tbl_run_checkpoints";
    const params: string[] = [];
    if (filter?.tenant && filter?.purchaser) {
      query += " WHERE brand = ? AND purchaser = ?";
      params.push(filter.tenant, filter.purchaser);
    }
    const rows = db.prepare(query).all(...params);
    const success = rows.filter((r: any) => r.status === "done").length;
    const failed = rows.filter((r: any) => r.status === "error").length;
    return { success, failed, total: rows.length };
  }

  async markRunCompleted(runId: string): Promise<void> {
    await this.setMeta("last_run_completed", runId);
    const db = this.getDb();
    db.prepare(
      "UPDATE tbl_runs SET finishedAt = ?, status = ? WHERE id = ?",
    ).run(new Date().toISOString(), "done", runId);
  }

  async getLastCompletedRunId(): Promise<string | null> {
    return await this.getMeta("last_run_completed");
  }

  async upsertCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const db = this.getDb();
    db.transaction(() => {
      db.prepare(
        `
        INSERT OR REPLACE INTO tbl_run_checkpoints
        (filePath, relativePath, brand, status, startedAt, finishedAt, latencyMs, statusCode, errorMessage, patternKey, runId, purchaser, fullResponse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        checkpoint.filePath,
        checkpoint.relativePath,
        checkpoint.brand,
        checkpoint.status,
        checkpoint.startedAt,
        checkpoint.finishedAt,
        checkpoint.latencyMs,
        checkpoint.statusCode,
        checkpoint.errorMessage,
        checkpoint.patternKey,
        checkpoint.runId,
        checkpoint.purchaser,
        checkpoint.fullResponse
          ? JSON.stringify(checkpoint.fullResponse)
          : null,
      );

      db.prepare(
        `
        UPDATE tbl_file_registry
        SET extractStatus = ?, extractedAt = ?, extractError = ?, latencyMs = ?, statusCode = ?, patternKey = ?, lastRunId = ?, fullResponse = ?
        WHERE id = ?
      `,
      ).run(
        checkpoint.status,
        checkpoint.finishedAt,
        checkpoint.errorMessage,
        checkpoint.latencyMs,
        checkpoint.statusCode,
        checkpoint.patternKey,
        checkpoint.runId,
        checkpoint.fullResponse
          ? JSON.stringify(checkpoint.fullResponse)
          : null,
        checkpoint.relativePath,
      );
    })();
  }

  async getRecordsForRun(runId: string): Promise<Checkpoint[]> {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT * FROM tbl_run_checkpoints WHERE runId = ?")
      .all(runId);
    return rows.map((r: any) => this.mapToEntity(r));
  }

  async getCompletedPaths(runId?: string): Promise<Set<string>> {
    const db = this.getDb();
    let query =
      "SELECT filePath FROM tbl_run_checkpoints WHERE (status = 'done' OR status = 'skipped')";
    const params: any[] = [];
    if (runId) {
      query += " AND runId = ?";
      params.push(runId);
    }
    const rows = db.prepare(query).all(...params);
    return new Set(rows.map((r: any) => r.filePath));
  }

  async getGlobalSkipCount(): Promise<number> {
    const db = this.getDb();
    const row = db
      .prepare(
        "SELECT COUNT(DISTINCT filePath) as count FROM tbl_run_checkpoints WHERE status = 'done' OR status = 'skipped'",
      )
      .get();
    return (row as any).count;
  }

  async getErrorPaths(runId: string): Promise<Set<string>> {
    const db = this.getDb();
    const rows = db
      .prepare(
        "SELECT relativePath FROM tbl_run_checkpoints WHERE runId = ? AND status = 'error'",
      )
      .all(runId);
    return new Set(rows.map((r: any) => r.relativePath));
  }

  async getEmailConfig(): Promise<any> {
    const val = await this.getMeta("email_config");
    return val ? JSON.parse(val) : {};
  }

  async saveEmailConfig(config: any): Promise<void> {
    await this.setMeta("email_config", JSON.stringify(config));
  }

  async getRunStatus(): Promise<any> {
    const runId = await this.getCurrentRunId();
    if (!runId)
      return { canResume: false, runId: null, done: 0, failed: 0, total: 0 };

    const lastCompleted = await this.getLastCompletedRunId();
    const records = await this.getRecordsForRun(runId);
    const done = records.filter((r) => r.status === "done").length;
    const failed = records.filter((r) => r.status === "error").length;
    const canResume = records.length > 0 && runId !== lastCompleted;

    return { canResume, runId, done, failed, total: records.length };
  }

  async getAllRunIdsOrdered(): Promise<string[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        "SELECT DISTINCT runId FROM tbl_run_checkpoints ORDER BY startedAt DESC",
      )
      .all();
    return rows.map((r: any) => r.runId);
  }

  async getMeta(key: string): Promise<string | null> {
    const db = this.getDb();
    const row = db
      .prepare("SELECT value FROM tbl_app_config WHERE key = ?")
      .get(key);
    return row ? (row as any).value : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT OR REPLACE INTO tbl_app_config (key, value) VALUES (?, ?)",
    ).run(key, value);
  }

  async getAllCheckpoints(): Promise<Checkpoint[]> {
    const db = this.getDb();
    const rows = db.prepare("SELECT * FROM tbl_run_checkpoints").all();
    return rows.map((r: any) => this.mapToEntity(r));
  }

  private mapToEntity(row: any): Checkpoint {
    return {
      filePath: row.filePath,
      relativePath: row.relativePath,
      brand: row.brand,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      latencyMs: row.latencyMs,
      statusCode: row.statusCode,
      errorMessage: row.errorMessage,
      patternKey: row.patternKey,
      runId: row.runId,
      purchaser: row.purchaser,
      fullResponse: row.fullResponse ? JSON.parse(row.fullResponse) : undefined,
    };
  }

  async getUnextractedFiles(filter?: {
    brand?: string;
    purchaser?: string;
  }): Promise<
    Array<{
      filePath: string;
      relativePath: string;
      brand: string;
      purchaser?: string;
    }>
  > {
    const db = this.getDb();
    let query =
      "SELECT fullPath, id as relativePath, brand, purchaser FROM tbl_file_registry WHERE extractStatus != 'done'";
    const params: any[] = [];

    if (filter?.brand) {
      query += " AND brand = ?";
      params.push(filter.brand);
    }
    if (filter?.purchaser) {
      query += " AND purchaser = ?";
      params.push(filter.purchaser);
    }

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      filePath: r.fullPath,
      relativePath: r.relativePath,
      brand: r.brand,
      purchaser: r.purchaser,
    }));
  }

  async registerFiles(
    files: Array<{
      id: string;
      fullPath: string;
      brand: string;
      purchaser?: string;
      size?: number;
      etag?: string;
      sha256?: string;
    }>,
  ): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO tbl_file_registry (id, fullPath, brand, purchaser, size, etag, sha256, syncedAt, registeredAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fullPath     = excluded.fullPath,
        size         = excluded.size,
        etag         = excluded.etag,
        sha256       = excluded.sha256,
        syncedAt     = excluded.syncedAt
    `);

    const now = new Date().toISOString();
    db.transaction(() => {
      for (const f of files) {
        stmt.run(
          f.id,
          f.fullPath,
          f.brand,
          f.purchaser || "",
          f.size || 0,
          f.etag || "",
          f.sha256 || "",
          now,
          now, // registeredAt — set on first INSERT only, not updated on conflict
        );
      }
    })();
  }

  async updateFileStatus(
    id: string,
    status: CheckpointStatus,
    metrics?: {
      latencyMs?: number;
      statusCode?: number;
      errorMessage?: string;
      patternKey?: string;
      runId?: string;
    },
  ): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `
      UPDATE tbl_file_registry
      SET extractStatus = ?,
          extractedAt   = ?,
          extractError  = ?,
          latencyMs     = ?,
          statusCode    = ?,
          patternKey    = ?,
          lastRunId     = ?
      WHERE id = ?
    `,
    ).run(
      status,
      new Date().toISOString(),
      metrics?.errorMessage,
      metrics?.latencyMs,
      metrics?.statusCode,
      metrics?.patternKey,
      metrics?.runId,
      id,
    );
  }

  async saveLog(entry: any): Promise<void> {
    const db = this.getDb();
    const timestamp = entry.timestamp || new Date().toISOString();
    const runId = entry.runId || "";
    db.prepare(
      "INSERT INTO tbl_extraction_logs (runId, timestamp, level, data) VALUES (?, ?, ?, ?)",
    ).run(runId, timestamp, "info", JSON.stringify(entry));
  }

  async getLogsForRun(runId: string): Promise<any[]> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare(
          "SELECT data FROM tbl_extraction_logs WHERE runId = ? ORDER BY timestamp ASC",
        )
        .all(runId) as any[];
      return rows.map((r) => JSON.parse(r.data));
    } catch (_) {
      return [];
    }
  }

  appendScheduleLog(entry: Record<string, unknown>): void {
    try {
      const db = this.getDb();
      const timestamp = (entry.timestamp as string) || new Date().toISOString();
      const outcome = (entry.outcome as string) || "executed";
      const level = (entry.level as string) || "info";
      const message = (entry.message as string) || "";
      const scheduleId = (entry.scheduleId as string) || null;
      db.prepare(
        `INSERT INTO tbl_schedule_logs (timestamp, scheduleId, outcome, level, message, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        timestamp,
        scheduleId,
        outcome,
        level,
        message,
        JSON.stringify(entry),
      );
    } catch (_) {}
  }

  getScheduleLogs(limit = 500): any[] {
    try {
      const db = this.getDb();
      const rows = db
        .prepare(
          `SELECT data FROM tbl_schedule_logs
           ORDER BY timestamp DESC
           LIMIT ?`,
        )
        .all(limit) as any[];
      return rows
        .map((r) => {
          try {
            const entry = JSON.parse(r.data);
            if (entry.outcome === undefined) {
              entry.outcome =
                entry.message &&
                String(entry.message).toLowerCase().includes("skipped")
                  ? "skipped"
                  : "executed";
            }
            return entry;
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }
}
