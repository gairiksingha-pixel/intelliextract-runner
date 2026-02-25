import {
  openCheckpointDb,
  getMeta,
  setMeta,
  closeCheckpointDb,
} from "../../checkpoint.js";

export class RunStateService {
  constructor(private checkpointPath: string) {}

  loadRunStates(): any {
    try {
      const db = openCheckpointDb(this.checkpointPath);
      const val = getMeta(db, "last_run_state");
      closeCheckpointDb(db);
      if (!val) return {};
      return JSON.parse(val);
    } catch (_) {
      return {};
    }
  }

  saveRunStates(states: any): void {
    try {
      const db = openCheckpointDb(this.checkpointPath);
      setMeta(db, "last_run_state", JSON.stringify(states));
      closeCheckpointDb(db);
    } catch (_) {}
  }

  updateRunState(caseId: string, stateUpdate: any): void {
    const states = this.loadRunStates();
    states[caseId] = { ...states[caseId], ...stateUpdate };
    this.saveRunStates(states);
  }

  clearRunState(caseId: string): void {
    const states = this.loadRunStates();
    delete states[caseId];
    this.saveRunStates(states);
  }

  getRunState(caseId: string): any {
    const states = this.loadRunStates();
    return states[caseId] || null;
  }
}
