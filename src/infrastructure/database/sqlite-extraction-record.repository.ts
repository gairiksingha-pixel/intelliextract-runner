import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  ExtractionRecord,
  ExtractionStatus,
} from "../../core/domain/entities/extraction-record.entity.js";
import {
  IExtractionRecordRepository,
  ScheduleLogEntry,
  EmailLogEntry,
} from "../../core/domain/repositories/extraction-record.repository.js";
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
import { SqliteEmailLogRepository } from "./sqlite-email-log.repository.js";

/** Typed row shape returned by better-sqlite3 for tbl_run_records */
interface ExtractionRecordRow {
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
export class SqliteExtractionRecordRepository implements IExtractionRecordRepository {
  private _db: Database.Database | null = null;
  private dbPath: string;

  // Delegates
  private appConfigRepo!: SqliteAppConfigRepository;
  private fileRegistryRepo!: SqliteFileRegistryRepository;
  private runRepo!: SqliteRunRepository;
  private logRepo!: SqliteExtractionLogRepository;
  private auditRepo!: SqliteScheduleAuditRepository;
  private emailLogRepo!: SqliteEmailLogRepository;

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
    this.logRepo = new SqliteExtractionLogRepository();
    this.auditRepo = new SqliteScheduleAuditRepository(this._db);
    this.emailLogRepo = new SqliteEmailLogRepository(this._db);

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

      -- Key-value config store (email config, current_run_id, etc.)
      CREATE TABLE IF NOT EXISTS tbl_app_config (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      -- S3 sync manifest: tracks every file synced from S3 with checksum/etag.
      -- Only extraction lifecycle fields here; metrics live in tbl_run_records.
      CREATE TABLE IF NOT EXISTS tbl_file_registry (
        id            TEXT PRIMARY KEY,
        fullPath      TEXT,
        brand         TEXT,
        purchaser     TEXT,
        size          INTEGER,
        etag          TEXT,
        sha256        TEXT,
        syncedAt      TEXT,
        registeredAt  TEXT,
        extractStatus TEXT DEFAULT 'pending',
        extractedAt   TEXT,
        lastRunId     TEXT
      );

      -- Per-file extraction result per run (source of truth for metrics)
      CREATE TABLE IF NOT EXISTS tbl_run_records (
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

      -- Scheduled cron jobs
      CREATE TABLE IF NOT EXISTS tbl_cron_schedules (
        id         TEXT PRIMARY KEY,
        created_at TEXT,
        brands     TEXT,
        purchasers TEXT,
        cron       TEXT,
        timezone   TEXT
      );

      -- Aggregate sync history (one row per sync operation)
      CREATE TABLE IF NOT EXISTS tbl_sync_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT,
        synced     INTEGER,
        skipped    INTEGER,
        errors     INTEGER,
        brands     TEXT,
        purchasers TEXT
      );

      -- Run lifecycle tracker
      CREATE TABLE IF NOT EXISTS tbl_runs (
        id           TEXT PRIMARY KEY,
        startedAt    TEXT,
        finishedAt   TEXT,
        status       TEXT DEFAULT 'running',
        summary_json TEXT
      );

      -- Schedule execution audit (full JSON blob only, no duplicate columns)
      CREATE TABLE IF NOT EXISTS tbl_schedule_logs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        data      TEXT
      );

      -- Email notification audit trail
      CREATE TABLE IF NOT EXISTS tbl_email_logs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        runId     TEXT,
        recipient TEXT,
        subject   TEXT,
        status    TEXT,
        error     TEXT
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_run_records_runId           ON tbl_run_records(runId);
      CREATE INDEX IF NOT EXISTS idx_run_records_status          ON tbl_run_records(status);
      CREATE INDEX IF NOT EXISTS idx_run_records_relativePath    ON tbl_run_records(relativePath);
      CREATE INDEX IF NOT EXISTS idx_run_records_startedAt       ON tbl_run_records(startedAt);
      CREATE INDEX IF NOT EXISTS idx_run_records_brand_purchaser ON tbl_run_records(brand, purchaser);
      CREATE INDEX IF NOT EXISTS idx_file_registry_extractStatus ON tbl_file_registry(extractStatus);
      CREATE INDEX IF NOT EXISTS idx_email_logs_timestamp        ON tbl_email_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_email_logs_runId            ON tbl_email_logs(runId);
    `);

    // ── Migrations for existing databases ─────────────────────────────────────

    // M1: Add summary_json to tbl_runs if it doesn't exist (legacy)
    try {
      db.prepare("SELECT summary_json FROM tbl_runs LIMIT 1").get();
    } catch (_) {
      db.exec("ALTER TABLE tbl_runs ADD COLUMN summary_json TEXT;");
    }

    // M2: Drop obsolete columns from tbl_runs (origin, metadata — never used)
    try {
      const runCols = (
        db.prepare("PRAGMA table_info(tbl_runs)").all() as any[]
      ).map((c) => c.name);
      if (runCols.includes("origin"))
        db.exec("ALTER TABLE tbl_runs DROP COLUMN origin;");
      if (runCols.includes("metadata"))
        db.exec("ALTER TABLE tbl_runs DROP COLUMN metadata;");
    } catch (e) {
      console.warn(
        "[Migration M2] Could not drop dead columns from tbl_runs:",
        e,
      );
    }

    // M3: Drop duplicate metric columns from tbl_file_registry
    // (latencyMs, statusCode, patternKey, fullResponse, extractError — all lived in tbl_run_records)
    try {
      const regCols = (
        db.prepare("PRAGMA table_info(tbl_file_registry)").all() as any[]
      ).map((c) => c.name);
      const toDrop = [
        "latencyMs",
        "statusCode",
        "patternKey",
        "fullResponse",
        "extractError",
      ];
      for (const col of toDrop) {
        if (regCols.includes(col)) {
          db.exec(`ALTER TABLE tbl_file_registry DROP COLUMN ${col};`);
        }
      }
    } catch (e) {
      console.warn(
        "[Migration M3] Could not drop duplicate columns from tbl_file_registry:",
        e,
      );
    }

    // M4: Drop tbl_extraction_logs — written every file, never read by any controller
    try {
      db.exec("DROP TABLE IF EXISTS tbl_extraction_logs;");
    } catch (e) {
      console.warn("[Migration M4] Could not drop tbl_extraction_logs:", e);
    }

    // M5: Simplify tbl_schedule_logs — drop redundant structured columns, keep only id+timestamp+data
    try {
      const schCols = (
        db.prepare("PRAGMA table_info(tbl_schedule_logs)").all() as any[]
      ).map((c) => c.name);
      const legacyCols = ["scheduleId", "outcome", "level", "message"];
      for (const col of legacyCols) {
        if (schCols.includes(col)) {
          db.exec(`ALTER TABLE tbl_schedule_logs DROP COLUMN ${col};`);
        }
      }
    } catch (e) {
      console.warn("[Migration M5] Could not simplify tbl_schedule_logs:", e);
    }

    // M6: Normalize paths in tbl_run_records
    try {
      db.exec(`
        UPDATE tbl_run_records 
        SET relativePath = LTRIM(REPLACE(relativePath, '\\', '/'), '/')
        WHERE relativePath LIKE '/%' OR relativePath LIKE '%\\%';
      `);
    } catch (e) {
      console.warn("[Migration M6] Path normalization failed:", e);
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
    status: ExtractionStatus,
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

  // IEmailLogStore
  async saveEmailLog(entry: EmailLogEntry): Promise<void> {
    this.getDb();
    return this.emailLogRepo.saveEmailLog(entry);
  }
  async getEmailLogs(limit?: number): Promise<EmailLogEntry[]> {
    this.getDb();
    return this.emailLogRepo.getEmailLogs(limit);
  }

  // Core ExtractionRecord logic (maintained here as it's the bridge)
  // ──────────────────────────────────────────────

  async upsertRecord(record: ExtractionRecord): Promise<void> {
    const db = this.getDb();
    db.transaction(() => {
      // Write full extraction result to run_records (single source of truth for metrics)
      db.prepare(
        `INSERT OR REPLACE INTO tbl_run_records
        (filePath, relativePath, brand, status, startedAt, finishedAt, latencyMs, statusCode, errorMessage, patternKey, runId, purchaser, fullResponse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.filePath,
        record.relativePath,
        record.brand,
        record.status,
        record.startedAt,
        record.finishedAt,
        record.latencyMs ?? null,
        record.statusCode ?? null,
        record.errorMessage ?? null,
        record.patternKey ?? null,
        record.runId,
        record.purchaser ?? null,
        record.fullResponse ? JSON.stringify(record.fullResponse) : null,
      );

      // Update file registry — only lifecycle fields (no duplicated metrics)
      db.prepare(
        `UPDATE tbl_file_registry
         SET extractStatus = ?,
             extractedAt   = ?,
             lastRunId     = ?,
             brand         = ?,
             purchaser     = ?,
             fullPath      = ?
         WHERE id = ?`,
      ).run(
        record.status,
        record.finishedAt ?? null,
        record.runId,
        record.brand,
        record.purchaser ?? null,
        record.filePath,
        record.relativePath,
      );
    })();
  }

  async upsertRecords(records: ExtractionRecord[]): Promise<void> {
    const db = this.getDb();
    const stmtRecord = db.prepare(
      `INSERT OR REPLACE INTO tbl_run_records
       (filePath, relativePath, brand, status, startedAt, finishedAt, latencyMs, statusCode, errorMessage, patternKey, runId, purchaser, fullResponse)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const stmtRegistry = db.prepare(
      `UPDATE tbl_file_registry
       SET extractStatus = ?,
           extractedAt   = ?,
           lastRunId     = ?,
           brand         = ?,
           purchaser     = ?,
           fullPath      = ?
       WHERE id = ?`,
    );

    db.transaction(() => {
      for (const cp of records) {
        stmtRecord.run(
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
        stmtRegistry.run(
          cp.status === "done" ? "done" : "error",
          cp.finishedAt ?? null,
          cp.runId,
          cp.brand,
          cp.purchaser ?? null,
          cp.filePath,
          cp.relativePath,
        );
      }
    })();
  }

  async getRecordsForRun(runId: string): Promise<ExtractionRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT * FROM tbl_run_records WHERE runId = ?")
      .all(runId) as ExtractionRecordRow[];
    return rows.map((r) => this.mapToEntity(r));
  }

  async getAllRecords(
    limit?: number,
    offset?: number,
  ): Promise<ExtractionRecord[]> {
    const db = this.getDb();
    let query = "SELECT * FROM tbl_run_records";
    const params: any[] = [];
    if (limit !== undefined && offset !== undefined) {
      query += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    } else if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(limit);
    }
    const rows = db.prepare(query).all(...params) as ExtractionRecordRow[];
    return rows.map((r) => this.mapToEntity(r));
  }

  async getCompletedPaths(runId?: string): Promise<Set<string>> {
    const db = this.getDb();
    let query =
      "SELECT filePath FROM tbl_run_records WHERE (status = 'done' OR status = 'skipped')";
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
      "SELECT filePath FROM tbl_run_records WHERE (status = 'done' OR status = 'skipped' OR status = 'error')";
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
        "SELECT COUNT(DISTINCT filePath) as count FROM tbl_run_records WHERE status = 'done' OR status = 'skipped'",
      )
      .get() as { count: number };
    return row.count;
  }

  async getErrorPaths(runId: string): Promise<Set<string>> {
    const db = this.getDb();
    const rows = db
      .prepare(
        "SELECT relativePath FROM tbl_run_records WHERE runId = ? AND status = 'error'",
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
      FROM tbl_run_records
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

  private mapToEntity(row: ExtractionRecordRow): ExtractionRecord {
    return {
      filePath: row.filePath,
      relativePath: row.relativePath,
      brand: row.brand,
      status: row.status as ExtractionStatus,
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
