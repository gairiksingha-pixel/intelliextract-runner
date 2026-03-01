import {
  IExtractionLogStore,
  LogEntry,
} from "../../core/domain/repositories/extraction-log-store.repository.js";

/**
 * tbl_extraction_logs was dropped in Migration M4 (it was written on every file
 * extraction but never read by any controller or use-case — pure dead storage).
 * This implementation is now a no-op to keep the interface contract intact.
 */
export class SqliteExtractionLogRepository implements IExtractionLogStore {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async saveLog(_entry: LogEntry): Promise<void> {
    // No-op: tbl_extraction_logs was removed in DB cleanup (M4).
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getLogsForRun(_runId: string): Promise<LogEntry[]> {
    return [];
  }
}
