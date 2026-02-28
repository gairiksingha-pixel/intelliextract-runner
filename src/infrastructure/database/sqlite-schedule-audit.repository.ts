import Database from "better-sqlite3";
import { ScheduleLogEntry } from "../../core/domain/repositories/checkpoint.repository.js";

/**
 * Concrete implementation for schedule audit logging (SQLite backed).
 */
export class SqliteScheduleAuditRepository {
  constructor(private db: Database.Database) {}

  appendScheduleLog(entry: Record<string, unknown>): void {
    try {
      const timestamp = (entry.timestamp as string) || new Date().toISOString();
      const outcome = (entry.outcome as string) || "executed";
      const level = (entry.level as string) || "info";
      const message = (entry.message as string) || "";
      const scheduleId = (entry.scheduleId as string) || null;
      this.db
        .prepare(
          `INSERT INTO tbl_schedule_logs (timestamp, scheduleId, outcome, level, message, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          timestamp,
          scheduleId,
          outcome,
          level,
          message,
          JSON.stringify(entry),
        );
    } catch (err) {
      console.error(
        "[SqliteScheduleAuditRepository] appendScheduleLog failed:",
        err,
      );
    }
  }

  getScheduleLogs(limit = 500): ScheduleLogEntry[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT data FROM tbl_schedule_logs
           ORDER BY timestamp DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{ data: string }>;
      return rows
        .map((r) => {
          try {
            const entry = JSON.parse(r.data) as ScheduleLogEntry;
            if (entry.outcome === undefined) {
              entry.outcome =
                entry.message &&
                String(entry.message).toLowerCase().includes("skipped")
                  ? "skipped"
                  : "executed";
            }
            return entry;
          } catch (err) {
            console.error(
              "[SqliteScheduleAuditRepository] Failed to parse schedule log entry:",
              err,
            );
            return null;
          }
        })
        .filter((e): e is ScheduleLogEntry => e !== null);
    } catch (err) {
      console.error(
        "[SqliteScheduleAuditRepository] getScheduleLogs failed:",
        err,
      );
      return [];
    }
  }
}
