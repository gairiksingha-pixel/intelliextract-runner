import { Checkpoint } from "../entities/Checkpoint.js";

export interface ICheckpointRepository {
  open(path: string): Promise<void>;
  close(): Promise<void>;
  initialize(): Promise<void>;

  // Run management
  getCurrentRunId(): Promise<string | null>;
  startNewRun(): Promise<string>;
  markRunCompleted(runId: string): Promise<void>;
  getLastCompletedRunId(): Promise<string | null>;
  getRunStatus(): Promise<any>;

  // Checkpoint management
  upsertCheckpoint(checkpoint: Checkpoint): Promise<void>;
  getRecordsForRun(runId: string): Promise<Checkpoint[]>;
  getCompletedPaths(runId: string): Promise<Set<string>>;
  getErrorPaths(runId: string): Promise<Set<string>>;

  // Meta management (generic key-value for state)
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // Config persistence
  getEmailConfig(): Promise<any>;
  saveEmailConfig(config: any): Promise<void>;

  getAllCheckpoints(): Promise<Checkpoint[]>;
}
