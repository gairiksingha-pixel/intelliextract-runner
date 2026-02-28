import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Config } from "../../core/domain/entities/Config.js";

export interface ResumeState {
  syncInProgressPath?: string;
  syncInProgressManifestKey?: string;
}

function getResumeStatePath(config: Config): string {
  const checkpointDir = dirname(config.run.checkpointPath);
  return join(checkpointDir, "resume-state.json");
}

export function loadResumeState(config: Config): ResumeState {
  const path = getResumeStatePath(config);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as ResumeState;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

export function saveResumeState(config: Config, state: ResumeState): void {
  const path = getResumeStatePath(config);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 0), "utf-8");
}

export function clearResumeState(config: Config): void {
  saveResumeState(config, {});
}

export function clearPartialFileAndResumeState(config: Config): void {
  const state = loadResumeState(config);
  const path = state.syncInProgressPath;

  if (path && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch (_) {
      // ignore
    }
  }

  // Note: sync manifest in this project is in SQLite (SqliteSyncRepository),
  // which handles its own persistence. Here we just clear the file-level resume state.
  clearResumeState(config);
}
