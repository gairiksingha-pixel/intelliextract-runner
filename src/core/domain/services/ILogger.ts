import { LogEntry } from "../repositories/IExtractionLogStore.js";
export { LogEntry } from "../repositories/IExtractionLogStore.js";

export interface ILogger {
  init(runId: string): void;
  log(entry: LogEntry): void;
  close(): void;
}
