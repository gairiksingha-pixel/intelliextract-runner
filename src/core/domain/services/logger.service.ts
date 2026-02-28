import { LogEntry } from "../repositories/extraction-log-store.repository.js";
export { LogEntry } from "../repositories/extraction-log-store.repository.js";

export interface ILogger {
  init(runId: string): void;
  log(entry: LogEntry): void;
  close(): void;
}
