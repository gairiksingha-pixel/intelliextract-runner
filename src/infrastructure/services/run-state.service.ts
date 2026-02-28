import { IAppConfigStore } from "../../core/domain/repositories/app-config-store.repository.js";
import {
  IRunStateService,
  RunState,
} from "../../core/domain/services/run-state.service.js";

export class RunStateService implements IRunStateService {
  constructor(private configStore: IAppConfigStore) {}

  private async loadRunStates(): Promise<Record<string, RunState>> {
    try {
      const val = await this.configStore.getMeta("last_run_state");
      if (!val) return {};
      return JSON.parse(val) as Record<string, RunState>;
    } catch (err) {
      console.error("[RunStateService] Failed to load run states:", err);
      return {};
    }
  }

  private async saveRunStates(states: Record<string, RunState>): Promise<void> {
    try {
      await this.configStore.setMeta("last_run_state", JSON.stringify(states));
    } catch (err) {
      console.error("[RunStateService] Failed to save run states:", err);
    }
  }

  async updateRunState(
    caseId: string,
    stateUpdate: Partial<RunState>,
  ): Promise<void> {
    const states = await this.loadRunStates();
    states[caseId] = { ...states[caseId], ...stateUpdate };
    await this.saveRunStates(states);
  }

  async clearRunState(caseId: string): Promise<void> {
    const states = await this.loadRunStates();
    delete states[caseId];
    await this.saveRunStates(states);
  }

  async getRunState(caseId: string): Promise<RunState | null> {
    const states = await this.loadRunStates();
    return states[caseId] ?? null;
  }
}
