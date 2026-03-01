export type ExtractionStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "skipped";

export interface ExtractionRecord {
  filePath: string;
  relativePath: string;
  brand: string;
  status: ExtractionStatus;
  startedAt?: string;
  finishedAt?: string;
  latencyMs?: number;
  statusCode?: number;
  errorMessage?: string;
  patternKey?: string;
  runId: string;
  purchaser?: string;
  fullResponse?: any;
}
