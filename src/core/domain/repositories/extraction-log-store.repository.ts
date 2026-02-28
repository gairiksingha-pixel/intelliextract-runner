/**
 * Segregated interface: extraction request/response log entries per run.
 */
export interface LogEntry {
  runId: string;
  timestamp?: string;
  filePath?: string;
  brand?: string;
  purchaser?: string;
  request?: { method: string; url: string };
  response?: { statusCode: number; latencyMs: number; bodyLength?: number };
  success?: boolean;
  [key: string]: unknown;
}

export interface IExtractionLogStore {
  saveLog(entry: LogEntry): Promise<void>;
  getLogsForRun(runId: string): Promise<LogEntry[]>;
}
