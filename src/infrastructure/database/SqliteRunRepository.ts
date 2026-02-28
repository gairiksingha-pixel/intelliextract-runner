import Database from "better-sqlite3";
import {
  IRunStore,
  RunStats,
  CumulativeStats,
} from "../../core/domain/repositories/IRunStore.js";

export class SqliteRunRepository implements IRunStore {
  constructor(private db: Database.Database) {}

  private async getMeta(key: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT value FROM tbl_app_config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO tbl_app_config (key, value) VALUES (?, ?)",
      )
      .run(key, value);
  }

  async getCurrentRunId(): Promise<string | null> {
    return await this.getMeta("current_run_id");
  }

  async startNewRun(prefix?: string): Promise<string> {
    const runId =
      (prefix || "RUN") + new Date().toISOString().replace(/[:.]/g, "-");
    await this.setMeta("current_run_id", runId);

    this.db
      .prepare("INSERT INTO tbl_runs (id, startedAt, status) VALUES (?, ?, ?)")
      .run(runId, new Date().toISOString(), "running");

    return runId;
  }

  async markRunCompleted(runId: string): Promise<void> {
    await this.setMeta("last_run_completed", runId);
    this.db
      .prepare("UPDATE tbl_runs SET finishedAt = ?, status = ? WHERE id = ?")
      .run(new Date().toISOString(), "done", runId);
  }
  async saveRunSummary(runId: string, summary: unknown): Promise<void> {
    this.db
      .prepare("UPDATE tbl_runs SET summary_json = ? WHERE id = ?")
      .run(JSON.stringify(summary), runId);
  }

  async getRunSummary(runId: string): Promise<unknown | null> {
    const row = this.db
      .prepare("SELECT summary_json FROM tbl_runs WHERE id = ?")
      .get(runId) as { summary_json: string } | undefined;
    if (!row?.summary_json) return null;
    try {
      return JSON.parse(row.summary_json);
    } catch (_) {
      return null;
    }
  }

  async getLastCompletedRunId(): Promise<string | null> {
    return await this.getMeta("last_run_completed");
  }

  async getRunStatus(): Promise<RunStats> {
    const runId = await this.getCurrentRunId();
    if (!runId)
      return { canResume: false, runId: null, done: 0, failed: 0, total: 0 };

    const lastCompleted = await this.getLastCompletedRunId();

    const rows = this.db
      .prepare("SELECT status FROM tbl_run_checkpoints WHERE runId = ?")
      .all(runId) as Array<{ status: string }>;

    const done = rows.filter((r) => r.status === "done").length;
    const failed = rows.filter((r) => r.status === "error").length;
    const canResume = rows.length > 0 && runId !== lastCompleted;

    return { canResume, runId, done, failed, total: rows.length };
  }

  async getAllRunIdsOrdered(
    limit?: number,
    offset?: number,
  ): Promise<string[]> {
    let query =
      "SELECT DISTINCT runId FROM tbl_run_checkpoints ORDER BY startedAt DESC";
    const params: any[] = [];

    if (limit !== undefined && offset !== undefined) {
      query += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    } else if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      runId: string;
    }>;
    return rows.map((r) => r.runId);
  }

  async getCumulativeStats(filter?: {
    tenant?: string;
    purchaser?: string;
  }): Promise<CumulativeStats> {
    let query = "SELECT status FROM tbl_run_checkpoints";
    const params: string[] = [];
    if (filter?.tenant && filter?.purchaser) {
      query += " WHERE brand = ? AND purchaser = ?";
      params.push(filter.tenant, filter.purchaser);
    }
    const rows = this.db.prepare(query).all(...params) as Array<{
      status: string;
    }>;
    const success = rows.filter((r) => r.status === "done").length;
    const failed = rows.filter((r) => r.status === "error").length;
    return { success, failed, total: rows.length };
  }
}
