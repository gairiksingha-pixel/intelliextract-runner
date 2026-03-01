import Database from "better-sqlite3";
import {
  IEmailLogStore,
  EmailLogEntry,
} from "../../core/domain/repositories/email-log-store.repository.js";

export class SqliteEmailLogRepository implements IEmailLogStore {
  constructor(private db: Database.Database) {}

  async saveEmailLog(entry: EmailLogEntry): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT INTO tbl_email_logs (timestamp, runId, recipient, subject, status, error)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.timestamp,
          entry.runId,
          entry.recipient,
          entry.subject,
          entry.status,
          entry.error || null,
        );
    } catch (err) {
      console.error("[SqliteEmailLogRepository] saveEmailLog failed:", err);
    }
  }

  async getEmailLogs(limit = 100): Promise<EmailLogEntry[]> {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM tbl_email_logs ORDER BY timestamp DESC LIMIT ?`)
        .all(limit) as EmailLogEntry[];
      return rows;
    } catch (err) {
      console.error("[SqliteEmailLogRepository] getEmailLogs failed:", err);
      return [];
    }
  }
}
