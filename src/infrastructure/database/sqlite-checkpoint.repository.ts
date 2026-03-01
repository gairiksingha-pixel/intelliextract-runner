import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  Checkpoint,
  CheckpointStatus,
} from "../../core/domain/entities/checkpoint.entity.js";
import {
  ICheckpointRepository,
  ScheduleLogEntry,
} from "../../core/domain/repositories/checkpoint.repository.js";
import { EmailStoredConfig } from "../../core/domain/repositories/app-config-store.repository.js";
import {
  RegisterFileInput,
  UnextractedFile,
  FileStatusMetrics,
} from "../../core/domain/repositories/file-registry.repository.js";
import {
  RunStats,
  CumulativeStats,
} from "../../core/domain/repositories/run-store.repository.js";
import { LogEntry } from "../../core/domain/repositories/extraction-log-store.repository.js";

// Specialized repositories
import { SqliteAppConfigRepository } from "./sqlite-app-config.repository.js";
import { SqliteFileRegistryRepository } from "./sqlite-file-registry.repository.js";
import { SqliteRunRepository } from "./sqlite-run.repository.js";
import { SqliteExtractionLogRepository } from "./sqlite-extraction-log.repository.js";
import { SqliteScheduleAuditRepository } from "./sqlite-schedule-audit.repository.js";

/** Typed row shape returned by better-sqlite3 for tbl_run_checkpoints */
interface CheckpointRow {
  filePath: string;
  relativePath: string;
  brand: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  patternKey: string | null;
  runId: string;
  purchaser: string | null;
  fullResponse: string | null;
}

/**
 * Composite SQLite repository that delegates specific domains to specialized
 * repository implementations. This preserves the existing facade while
 * dramatically improving maintainability and adhering to SRP.
 */
export class SqliteCheckpointRepository implements ICheckpointRepository {
  private _db: Database.Database | null = null;
  private dbPath: string;

  // Delegates
  private appConfigRepo!: SqliteAppConfigRepository;
  private fileRegistryRepo!: SqliteFileRegistryRepository;
  private runRepo!: SqliteRunRepository;
  private logRepo!: SqliteExtractionLogRepository;
  private auditRepo!: SqliteScheduleAuditRepository;

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

    // Initialize delegates with the active DB connection
    this.appConfigRepo = new SqliteAppConfigRepository(this._db);
    this.fileRegistryRepo = new SqliteFileRegistryRepository(this._db);
    this.runRepo = new SqliteRunRepository(this._db);
    this.logRepo = new SqliteExtractionLogRepository(this._db);
    this.auditRepo = new SqliteScheduleAuditRepository(this._db);

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

      CREATE TABLE IF NOT EXISTS tbl_app_config (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS tbl_file_registry (
        id           TEXT PRIMARY KEY,
        fullPath     TEXT,
        brand        TEXT,
        purchaser    TEXT,
        size         INTEGER,
        etag         TEXT,
        sha256       TEXT,
        syncedAt     TEXT,
        registeredAt TEXT,
        extractStatus TEXT DEFAULT 'pending',
        extractedAt  TEXT,
        extractError TEXT,
        latencyMs    INTEGER,
        statusCode   INTEGER,
        patternKey   TEXT,
        lastRunId    TEXT,
        fullResponse TEXT
      );

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

      CREATE TABLE IF NOT EXISTS tbl_cron_schedules (
        id         TEXT PRIMARY KEY,
        created_at TEXT,
        brands     TEXT,
        purchasers TEXT,
        cron       TEXT,
        timezone   TEXT
      );

      CREATE TABLE IF NOT EXISTS tbl_sync_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT,
        synced     INTEGER,
        skipped    INTEGER,
        errors     INTEGER,
        brands     TEXT,
        purchasers TEXT
      );

      CREATE TABLE IF NOT EXISTS tbl_extraction_logs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        runId     TEXT,
        timestamp TEXT,
        level     TEXT,
        data      TEXT
      );

      CREATE TABLE IF NOT EXISTS tbl_runs (
        id         TEXT PRIMARY KEY,
        startedAt  TEXT,
        finishedAt TEXT,
        status     TEXT DEFAULT 'running',
        origin     TEXT,
        metadata   TEXT,
        summary_json TEXT
      );

      CREATE TABLE IF NOT EXISTS tbl_schedule_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT NOT NULL,
        scheduleId TEXT,
        outcome    TEXT,
        level      TEXT,
        message    TEXT,
        data       TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_runId        ON tbl_run_checkpoints(runId);
      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_status       ON tbl_run_checkpoints(status);
      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_relativePath ON tbl_run_checkpoints(relativePath);
      CREATE INDEX IF NOT EXISTS idx_run_checkpoints_finishedAt   ON tbl_run_checkpoints(finishedAt);
      CREATE INDEX IF NOT EXISTS idx_file_registry_extractStatus  ON tbl_file_registry(extractStatus);
      CREATE INDEX IF NOT EXISTS idx_extraction_logs_runId_ts     ON tbl_extraction_logs(runId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_runs_startedAt               ON tbl_runs(startedAt);
      CREATE INDEX IF NOT EXISTS idx_schedule_logs_timestamp      ON tbl_schedule_logs(timestamp);
    `);

    // Migration: Add summary_json to tbl_runs if it doesn't exist
    try {
      db.prepare("SELECT summary_json FROM tbl_runs LIMIT 1").get();
    } catch (_) {
      db.exec("ALTER TABLE tbl_runs ADD COLUMN summary_json TEXT;");
    }

    // Migration: Normalize ALL paths in DB to ignore leading/trailing slashes and backslashes
    try {
      db.exec(`
        UPDATE tbl_run_checkpoints 
        SET relativePath = LTRIM(REPLACE(relativePath, '\\', '/'), '/')
        WHERE relativePath LIKE '/%' OR relativePath LIKE '%\\%';

        -- Note: tbl_file_registry normalization is trickier due to PRIMARY KEY conflicts.
        -- We'll just do a best-effort update for non-critical cases or allow NEW insertions to override.
        -- For now, cleaning up run checkpoints fixes the "Missing Run ID" in inventory.
      `);
    } catch (e) {
      console.warn(
        "Path normalization migration failed (likely PK conflict); skipping:",
        e,
      );
    }
  }

  // Delegate Methods
  // ──────────────────────────────────────────────

  // IAppConfigStore
  async getMeta(key: string): Promise<string | null> {
    this.getDb();
    return this.appConfigRepo.getMeta(key);
  }
  async setMeta(key: string, value: string): Promise<void> {
    this.getDb();
    return this.appConfigRepo.setMeta(key, value);
  }
  async getEmailConfig(): Promise<EmailStoredConfig> {
    this.getDb();
    return this.appConfigRepo.getEmailConfig();
  }
  async saveEmailConfig(config: EmailStoredConfig): Promise<void> {
    this.getDb();
    return this.appConfigRepo.saveEmailConfig(config);
  }

  // IFileRegistry
  async registerFiles(files: RegisterFileInput[]): Promise<void> {
    this.getDb();
    return this.fileRegistryRepo.registerFiles(files);
  }
  async getUnextractedFiles(filter?: {
    brand?: string;
    purchaser?: string;
    pairs?: { brand: string; purchaser: string }[];
  }): Promise<UnextractedFile[]> {
    this.getDb();
    return this.fileRegistryRepo.getUnextractedFiles(filter);
  }
  async updateFileStatus(
    id: string,
    status: CheckpointStatus,
    metrics?: FileStatusMetrics,
  ): Promise<void> {
    this.getDb();
    return this.fileRegistryRepo.updateFileStatus(id, status, metrics);
  }

  // IRunStore
  async getCurrentRunId(): Promise<string | null> {
    this.getDb();
    return this.runRepo.getCurrentRunId();
  }
  async startNewRun(prefix?: string): Promise<string> {
    this.getDb();
    return this.runRepo.startNewRun(prefix);
  }
  async markRunCompleted(runId: string): Promise<void> {
    this.getDb();
    return this.runRepo.markRunCompleted(runId);
  }
  async saveRunSummary(runId: string, summary: unknown): Promise<void> {
    return this.runRepo.saveRunSummary(runId, summary);
  }

  async getRunSummary(runId: string): Promise<unknown | null> {
    return this.runRepo.getRunSummary(runId);
  }

  async getLastCompletedRunId(): Promise<string | null> {
    this.getDb();
    return this.runRepo.getLastCompletedRunId();
  }
  async getRunStatus(): Promise<RunStats> {
    this.getDb();
    return this.runRepo.getRunStatus();
  }
  async getAllRunIdsOrdered(
    limit?: number,
    offset?: number,
  ): Promise<string[]> {
    return this.runRepo.getAllRunIdsOrdered(limit, offset);
  }
  async getCumulativeStats(filter?: {
    tenant?: string;
    purchaser?: string;
  }): Promise<CumulativeStats> {
    this.getDb();
    return this.runRepo.getCumulativeStats(filter);
  }

  // IExtractionLogStore
  async saveLog(entry: LogEntry): Promise<void> {
    this.getDb();
    return this.logRepo.saveLog(entry);
  }
  async getLogsForRun(runId: string): Promise<LogEntry[]> {
    this.getDb();
    return this.logRepo.getLogsForRun(runId);
  }

  // Schedule audit logs
  appendScheduleLog(entry: Record<string, unknown>): void {
    this.getDb();
    this.auditRepo.appendScheduleLog(entry);
  }
  getScheduleLogs(limit?: number): ScheduleLogEntry[] {
    this.getDb();
    return this.auditRepo.getScheduleLogs(limit);
  }

  // Core Checkpoint logic (maintained here as it's the bridge)
  // ──────────────────────────────────────────────

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
          cp.status as string,
          cp.startedAt ?? null,
          cp.finishedAt ?? null,
          cp.latencyMs ?? null,
          cp.statusCode ?? null,
          cp.errorMessage ?? null,
          cp.patternKey ?? null,
          cp.runId,
          cp.purchaser ?? null,
          cp.fullResponse ? JSON.stringify(cp.fullResponse) : null,
        );
        stmtFile.run(
          cp.status === "done" ? "done" : "error",
          cp.finishedAt ?? null,
          cp.errorMessage ?? null,
          cp.latencyMs ?? null,
          cp.statusCode ?? null,
          cp.patternKey ?? null,
          cp.runId,
          cp.fullResponse ? JSON.stringify(cp.fullResponse) : null,
          cp.relativePath,
        );
      }
    })();
  }

  async getRecordsForRun(runId: string): Promise<Checkpoint[]> {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT * FROM tbl_run_checkpoints WHERE runId = ?")
      .all(runId) as CheckpointRow[];
    return rows.map((r) => this.mapToEntity(r));
  }

  async getAllCheckpoints(
    limit?: number,
    offset?: number,
  ): Promise<Checkpoint[]> {
    const db = this.getDb();
    let query = "SELECT * FROM tbl_run_checkpoints";
    const params: any[] = [];
    if (limit !== undefined && offset !== undefined) {
      query += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    } else if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(limit);
    }
    const rows = db.prepare(query).all(...params) as CheckpointRow[];
    return rows.map((r) => this.mapToEntity(r));
  }

  async getCompletedPaths(runId?: string): Promise<Set<string>> {
    const db = this.getDb();
    let query =
      "SELECT filePath FROM tbl_run_checkpoints WHERE (status = 'done' OR status = 'skipped')";
    const params: string[] = [];
    if (runId) {
      query += " AND runId = ?";
      params.push(runId);
    }
    const rows = db.prepare(query).all(...params) as Array<{
      filePath: string;
    }>;
    return new Set(rows.map((r) => r.filePath));
  }

  async getProcessedPaths(runId?: string): Promise<Set<string>> {
    const db = this.getDb();
    let query =
      "SELECT filePath FROM tbl_run_checkpoints WHERE (status = 'done' OR status = 'skipped' OR status = 'error')";
    const params: string[] = [];
    if (runId) {
      query += " AND runId = ?";
      params.push(runId);
    }
    const rows = db.prepare(query).all(...params) as Array<{
      filePath: string;
    }>;
    return new Set(rows.map((r) => r.filePath));
  }

  async getGlobalSkipCount(): Promise<number> {
    const db = this.getDb();
    const row = db
      .prepare(
        "SELECT COUNT(DISTINCT filePath) as count FROM tbl_run_checkpoints WHERE status = 'done' OR status = 'skipped'",
      )
      .get() as { count: number };
    return row.count;
  }

  async getErrorPaths(runId: string): Promise<Set<string>> {
    const db = this.getDb();
    const rows = db
      .prepare(
        "SELECT relativePath FROM tbl_run_checkpoints WHERE runId = ? AND status = 'error'",
      )
      .all(runId) as Array<{ relativePath: string }>;
    return new Set(rows.map((r) => r.relativePath));
  }

  async getFailedFiles(filter?: {
    brand?: string;
    purchaser?: string;
    pairs?: { brand: string; purchaser: string }[];
  }): Promise<UnextractedFile[]> {
    const db = this.getDb();
    let query = `
      SELECT filePath, relativePath, brand, purchaser
      FROM tbl_run_checkpoints
      WHERE status = 'error'
    `;
    const params: (string | number)[] = [];
    if (filter?.pairs?.length) {
      const placeholders = filter.pairs
        .map(() => "(brand = ? AND purchaser = ?)")
        .join(" OR ");
      query += " AND (" + placeholders + ")";
      for (const p of filter.pairs) {
        params.push(p.brand, p.purchaser || "");
      }
    } else {
      if (filter?.brand) {
        query += " AND brand = ?";
        params.push(filter.brand);
      }
      if (filter?.purchaser) {
        query += " AND purchaser = ?";
        params.push(filter.purchaser);
      }
    }
    query += " GROUP BY relativePath";
    const rows = db.prepare(query).all(...params) as Array<{
      filePath: string;
      relativePath: string;
      brand: string;
      purchaser?: string;
    }>;
    return rows
      .filter((r) => r.filePath && r.relativePath)
      .map((r) => ({
        filePath: r.filePath,
        relativePath: r.relativePath,
        brand: r.brand,
        purchaser: r.purchaser,
      }));
  }

  private mapToEntity(row: CheckpointRow): Checkpoint {
    return {
      filePath: row.filePath,
      relativePath: row.relativePath,
      brand: row.brand,
      status: row.status as CheckpointStatus,
      startedAt: row.startedAt ?? undefined,
      finishedAt: row.finishedAt ?? undefined,
      latencyMs: row.latencyMs ?? undefined,
      statusCode: row.statusCode ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      patternKey: row.patternKey ?? undefined,
      runId: row.runId,
      purchaser: row.purchaser ?? undefined,
      fullResponse: row.fullResponse ? JSON.parse(row.fullResponse) : undefined,
    };
  }
}
