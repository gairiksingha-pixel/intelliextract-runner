import { RunParams } from "../types.js";

export interface ProgressSnapshot {
  done: number;
  total: number;
  percent?: number;
}

export interface RunInfo {
  caseId: string;
  runId?: string;
  startTime: string;
  origin?: "manual" | "scheduled";
  params?: RunParams;
  status: string;
  progress?: ProgressSnapshot;
  syncProgress?: ProgressSnapshot;
  extractProgress?: ProgressSnapshot;
}

export interface IRunStatusStore {
  registerRun(run: RunInfo): void;
  unregisterRun(caseId: string): void;
  getActiveRuns(): RunInfo[];
  isActive(caseId: string): boolean;
}
