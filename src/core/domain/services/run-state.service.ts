/**
 * Domain interface for run state persistence (resume/pause tracking).
 * Abstracts over the concrete RunStateService so controllers
 * and CronManager depend only on this interface.
 */
export interface RunState {
  status?: "running" | "stopped" | "done" | "error";
  caseId?: string;
  runId?: string;
  [key: string]: unknown;
}

export interface IRunStateService {
  getRunState(caseId: string): Promise<RunState | null>;
  clearRunState(caseId: string): Promise<void>;
  updateRunState(caseId: string, stateUpdate: Partial<RunState>): Promise<void>;
}
