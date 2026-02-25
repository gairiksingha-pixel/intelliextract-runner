export interface RunInfo {
  caseId: string;
  runId: string;
  startedAt: string;
  origin?: "manual" | "scheduled";
}

export interface IRunStatusStore {
  registerRun(run: RunInfo): void;
  unregisterRun(caseId: string): void;
  getActiveRuns(): RunInfo[];
  isActive(caseId: string): boolean;
}
