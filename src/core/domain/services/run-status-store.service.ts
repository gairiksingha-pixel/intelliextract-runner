export interface RunInfo {
  caseId: string;
  runId?: string;
  startTime: string;
  origin?: "manual" | "scheduled";
  params?: any;
  status: string;
  progress?: any;
  syncProgress?: any;
  extractProgress?: any;
}

export interface IRunStatusStore {
  registerRun(run: RunInfo): void;
  unregisterRun(caseId: string): void;
  getActiveRuns(): RunInfo[];
  isActive(caseId: string): boolean;
}
