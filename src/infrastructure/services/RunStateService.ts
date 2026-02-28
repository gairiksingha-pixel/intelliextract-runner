import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";

export class RunStateService {
  constructor(private checkpointRepo: ICheckpointRepository) {}

  async loadRunStates(): Promise<any> {
    try {
      const val = await this.checkpointRepo.getMeta("last_run_state");
      if (!val) return {};
      return JSON.parse(val);
    } catch (_) {
      return {};
    }
  }

  async saveRunStates(states: any): Promise<void> {
    try {
      await this.checkpointRepo.setMeta(
        "last_run_state",
        JSON.stringify(states),
      );
    } catch (_) {}
  }

  async updateRunState(caseId: string, stateUpdate: any): Promise<void> {
    const states = await this.loadRunStates();
    states[caseId] = { ...states[caseId], ...stateUpdate };
    await this.saveRunStates(states);
  }

  async clearRunState(caseId: string): Promise<void> {
    const states = await this.loadRunStates();
    delete states[caseId];
    await this.saveRunStates(states);
  }

  async getRunState(caseId: string): Promise<any> {
    const states = await this.loadRunStates();
    return states[caseId] || null;
  }
}
