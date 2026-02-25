import {
  IRunStatusStore,
  RunInfo,
} from "../../core/domain/services/IRunStatusStore.js";

export class RunStatusStore implements IRunStatusStore {
  constructor(private activeRunsMap: Map<string, any>) {}

  registerRun(run: RunInfo): void {
    this.activeRunsMap.set(run.caseId, run);
  }

  unregisterRun(caseId: string): void {
    this.activeRunsMap.delete(caseId);
  }

  getActiveRuns(): RunInfo[] {
    return Array.from(this.activeRunsMap.values());
  }

  isActive(caseId: string): boolean {
    return this.activeRunsMap.has(caseId);
  }
}
