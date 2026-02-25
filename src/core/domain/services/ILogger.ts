export interface LogEntry {
  runId: string;
  filePath: string;
  brand: string;
  purchaser?: string;
  request: {
    method: string;
    url: string;
    bodyLength?: number;
  };
  response: {
    statusCode: number;
    latencyMs: number;
    bodyLength?: number;
  };
  success: boolean;
}

export interface ILogger {
  init(runId: string): void;
  log(entry: LogEntry): void;
  close(): void;
}
