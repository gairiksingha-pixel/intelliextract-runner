import Database from "better-sqlite3";
import {
  IExtractionLogStore,
  LogEntry,
} from "../../core/domain/repositories/extraction-log-store.repository.js";

export class SqliteExtractionLogRepository implements IExtractionLogStore {
  constructor(private db: Database.Database) {}

  async saveLog(entry: LogEntry): Promise<void> {
    const timestamp = (entry.timestamp as string) || new Date().toISOString();
    const runId = (entry.runId as string) || "";
    this.db
      .prepare(
        "INSERT INTO tbl_extraction_logs (runId, timestamp, level, data) VALUES (?, ?, ?, ?)",
      )
      .run(runId, timestamp, "info", JSON.stringify(entry));
  }

  async getLogsForRun(runId: string): Promise<LogEntry[]> {
    try {
      const rows = this.db
        .prepare(
          "SELECT data FROM tbl_extraction_logs WHERE runId = ? ORDER BY timestamp ASC",
        )
        .all(runId) as Array<{ data: string }>;
      return rows.map((r) => JSON.parse(r.data) as LogEntry);
    } catch (err) {
      console.error(
        `[SqliteExtractionLogRepository] getLogsForRun(${runId}) failed:`,
        err,
      );
      return [];
    }
  }
}
