import Database from "better-sqlite3";
import { Checkpoint } from "../../core/domain/entities/Checkpoint.js";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";

export class SqliteCheckpointRepository implements ICheckpointRepository {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb() {
    return new Database(this.dbPath);
  }

  async open(path: string): Promise<void> {
    this.dbPath = path;
  }

  async close(): Promise<void> {
    // handled by better-sqlite3
  }

  async initialize(): Promise<void> {
    const db = this.getDb();
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS checkpoints (
          filePath TEXT,
          relativePath TEXT,
          brand TEXT,
          purchaser TEXT,
          status TEXT,
          startedAt TEXT,
          finishedAt TEXT,
          latencyMs INTEGER,
          statusCode INTEGER,
          errorMessage TEXT,
          patternKey TEXT,
          runId TEXT,
          PRIMARY KEY (runId, relativePath)
        );
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          created_at TEXT,
          brands TEXT,
          purchasers TEXT,
          cron TEXT,
          timezone TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT,
          synced INTEGER,
          skipped INTEGER,
          errors INTEGER,
          message TEXT,
          brands TEXT,
          purchasers TEXT
        );
      `);
    } finally {
      db.close();
    }
  }

  async getCurrentRunId(): Promise<string | null> {
    return await this.getMeta("current_run_id");
  }

  async startNewRun(): Promise<string> {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    await this.setMeta("current_run_id", runId);
    return runId;
  }

  async markRunCompleted(runId: string): Promise<void> {
    await this.setMeta("last_run_completed", runId);
  }

  async getLastCompletedRunId(): Promise<string | null> {
    return await this.getMeta("last_run_completed");
  }

  async upsertCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        `
        INSERT OR REPLACE INTO checkpoints 
        (filePath, relativePath, brand, status, startedAt, finishedAt, latencyMs, statusCode, errorMessage, patternKey, runId, purchaser)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      );
    } finally {
      db.close();
    }
  }

  async getRecordsForRun(runId: string): Promise<Checkpoint[]> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare("SELECT * FROM checkpoints WHERE runId = ?")
        .all(runId);
      return rows.map((r: any) => this.mapToEntity(r));
    } finally {
      db.close();
    }
  }

  async getCompletedPaths(runId: string): Promise<Set<string>> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare(
          "SELECT relativePath FROM checkpoints WHERE runId = ? AND status = 'done'",
        )
        .all(runId);
      return new Set(rows.map((r: any) => r.relativePath));
    } finally {
      db.close();
    }
  }

  async getErrorPaths(runId: string): Promise<Set<string>> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare(
          "SELECT relativePath FROM checkpoints WHERE runId = ? AND status = 'error'",
        )
        .all(runId);
      return new Set(rows.map((r: any) => r.relativePath));
    } finally {
      db.close();
    }
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

  async getMeta(key: string): Promise<string | null> {
    const db = this.getDb();
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
      return row ? (row as any).value : null;
    } finally {
      db.close();
    }
  }

  async setMeta(key: string, value: string): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
        key,
        value,
      );
    } finally {
      db.close();
    }
  }

  async getAllCheckpoints(): Promise<Checkpoint[]> {
    const db = this.getDb();
    try {
      const rows = db.prepare("SELECT * FROM checkpoints").all();
      return rows.map((r: any) => this.mapToEntity(r));
    } finally {
      db.close();
    }
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
    };
  }
}
