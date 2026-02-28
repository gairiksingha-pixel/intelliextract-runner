import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Checkpoint } from "../../core/domain/entities/Checkpoint.js";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";

export class SqliteCheckpointRepository implements ICheckpointRepository {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb() {
    mkdirSync(dirname(this.dbPath), { recursive: true });
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

  async startNewRun(prefix?: string): Promise<string> {
    const runId =
      (prefix || "RUN") + new Date().toISOString().replace(/[:.]/g, "-");
    await this.setMeta("current_run_id", runId);
    return runId;
  }

  async upsertCheckpoints(checkpoints: Checkpoint[]): Promise<void> {
    const db = this.getDb();
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO checkpoints 
        (filePath, relativePath, brand, status, startedAt, finishedAt, latencyMs, statusCode, errorMessage, patternKey, runId, purchaser)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const cp of checkpoints) {
          stmt.run(
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
          );
        }
      })();
    } finally {
      db.close();
    }
  }

  async getCumulativeStats(filter?: {
    tenant?: string;
    purchaser?: string;
  }): Promise<{ success: number; failed: number; total: number }> {
    const db = this.getDb();
    try {
      let query = "SELECT status FROM checkpoints";
      const params: string[] = [];
      if (filter?.tenant && filter?.purchaser) {
        query += " WHERE brand = ? AND purchaser = ?";
        params.push(filter.tenant, filter.purchaser);
      }
      const rows = db.prepare(query).all(...params);
      const success = rows.filter((r: any) => r.status === "done").length;
      const failed = rows.filter((r: any) => r.status === "error").length;
      return { success, failed, total: rows.length };
    } finally {
      db.close();
    }
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

  async getCompletedPaths(runId?: string): Promise<Set<string>> {
    const db = this.getDb();
    try {
      let query =
        "SELECT filePath FROM checkpoints WHERE (status = 'done' OR status = 'skipped')";
      const params: any[] = [];
      if (runId) {
        query += " AND runId = ?";
        params.push(runId);
      }
      const rows = db.prepare(query).all(...params);
      return new Set(rows.map((r: any) => r.filePath));
    } finally {
      db.close();
    }
  }

  async getGlobalSkipCount(): Promise<number> {
    const db = this.getDb();
    try {
      const row = db
        .prepare(
          "SELECT COUNT(DISTINCT filePath) as count FROM checkpoints WHERE status = 'done' OR status = 'skipped'",
        )
        .get();
      return (row as any).count;
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

  async getAllRunIdsOrdered(): Promise<string[]> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare(
          "SELECT DISTINCT runId FROM checkpoints ORDER BY startedAt DESC",
        )
        .all();
      return rows.map((r: any) => r.runId);
    } finally {
      db.close();
    }
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
