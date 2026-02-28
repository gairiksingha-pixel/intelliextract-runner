import { existsSync, unlinkSync } from "node:fs";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";

export interface ResumeState {
  syncInProgressPath?: string;
  syncInProgressManifestKey?: string;
}

export async function loadResumeState(
  repo: ICheckpointRepository,
): Promise<ResumeState> {
  try {
    const raw = await repo.getMeta("resume_state");
    if (!raw) return {};
    const data = JSON.parse(raw) as ResumeState;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

export async function saveResumeState(
  repo: ICheckpointRepository,
  state: ResumeState,
): Promise<void> {
  await repo.setMeta("resume_state", JSON.stringify(state));
}

export async function clearResumeState(
  repo: ICheckpointRepository,
): Promise<void> {
  await saveResumeState(repo, {});
}

export async function clearPartialFileAndResumeState(
  repo: ICheckpointRepository,
): Promise<void> {
  const state = await loadResumeState(repo);
  const path = state.syncInProgressPath;

  if (path && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch (_) {
      // ignore
    }
  }

  await clearResumeState(repo);
}
