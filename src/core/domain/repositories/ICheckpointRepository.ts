import { Checkpoint, CheckpointStatus } from "../entities/Checkpoint.js";

export interface ICheckpointRepository {
  open(path: string): Promise<void>;
  close(): Promise<void>;
  initialize(): Promise<void>;

  // Run management
  getCurrentRunId(): Promise<string | null>;
  startNewRun(prefix?: string): Promise<string>;
  markRunCompleted(runId: string): Promise<void>;
  getLastCompletedRunId(): Promise<string | null>;
  getRunStatus(): Promise<any>;
  getAllRunIdsOrdered(): Promise<string[]>;

  // Checkpoint management
  upsertCheckpoint(checkpoint: Checkpoint): Promise<void>;
  upsertCheckpoints(checkpoints: Checkpoint[]): Promise<void>;
  getRecordsForRun(runId: string): Promise<Checkpoint[]>;
  getCompletedPaths(runId?: string): Promise<Set<string>>;
  getGlobalSkipCount(): Promise<number>;
  getErrorPaths(runId: string): Promise<Set<string>>;
  getCumulativeStats(filter?: {
    tenant?: string;
    purchaser?: string;
  }): Promise<{ success: number; failed: number; total: number }>;

  // Meta management (generic key-value for state)
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // Config persistence
  getEmailConfig(): Promise<any>;
  saveEmailConfig(config: any): Promise<void>;

  getAllCheckpoints(): Promise<Checkpoint[]>;
  getUnextractedFiles(filter?: { brand?: string; purchaser?: string }): Promise<
    Array<{
      filePath: string;
      relativePath: string;
      brand: string;
      purchaser?: string;
    }>
  >;
  registerFiles(
    files: Array<{
      id: string;
      fullPath: string;
      brand: string;
      purchaser?: string;
      size?: number;
      etag?: string;
      sha256?: string;
    }>,
  ): Promise<void>;
  updateFileStatus(
    id: string,
    status: CheckpointStatus,
    metrics?: {
      latencyMs?: number;
      statusCode?: number;
      errorMessage?: string;
      patternKey?: string;
      runId?: string;
    },
  ): Promise<void>;

  // Log management
  saveLog(entry: any): Promise<void>;
  getLogsForRun(runId: string): Promise<any[]>;

  // Schedule audit log (DB-backed, replaces schedule.log flat file)
  appendScheduleLog(entry: Record<string, unknown>): void;
  getScheduleLogs(limit?: number): any[];
}
