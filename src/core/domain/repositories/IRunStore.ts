/**
 * Segregated interface: run lifecycle management.
 */
export interface RunStats {
  canResume: boolean;
  runId: string | null;
  done: number;
  failed: number;
  total: number;
}

export interface CumulativeStats {
  success: number;
  failed: number;
  total: number;
}

export interface IRunStore {
  getCurrentRunId(): Promise<string | null>;
  startNewRun(prefix?: string): Promise<string>;
  markRunCompleted(runId: string): Promise<void>;
  saveRunSummary(runId: string, summary: unknown): Promise<void>;
  getRunSummary(runId: string): Promise<unknown | null>;
  getLastCompletedRunId(): Promise<string | null>;
  getRunStatus(): Promise<RunStats>;
  getAllRunIdsOrdered(limit?: number, offset?: number): Promise<string[]>;
  getCumulativeStats(filter?: {
    tenant?: string;
    purchaser?: string;
  }): Promise<CumulativeStats>;
}
