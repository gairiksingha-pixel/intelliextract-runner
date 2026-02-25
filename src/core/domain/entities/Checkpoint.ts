export type CheckpointStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "skipped";

export interface Checkpoint {
  filePath: string;
  relativePath: string;
  brand: string;
  status: CheckpointStatus;
  startedAt?: string;
  finishedAt?: string;
  latencyMs?: number;
  statusCode?: number;
  errorMessage?: string;
  patternKey?: string;
  runId: string;
  purchaser?: string;
}
