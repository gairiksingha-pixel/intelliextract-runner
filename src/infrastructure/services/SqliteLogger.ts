import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";
import { ILogger, LogEntry } from "../../core/domain/services/ILogger.js";

export class SqliteLogger implements ILogger {
  constructor(private repo: ICheckpointRepository) {}

  init(runId: string): void {
    // Database table is already initialized by the repository
  }

  log(entry: LogEntry): void {
    // We don't await here because logging is typically fire-and-forget in the stream
    // but the repo ensures a valid connection.
    // In extraction loop, we could await but technically ILogger.log is void.
    this.repo.saveLog(entry).catch((err) => {
      console.error("Failed to save log to SQLite:", err);
    });
  }

  close(): void {
    // No specific stream to close
  }
}
