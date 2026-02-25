import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEDULE_LOG_MAX_ENTRIES = 500;

export function appendScheduleLog(logPath: string, entry: any) {
  try {
    const dir = dirname(logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    writeFileSync(logPath, line + "\n", {
      encoding: "utf-8",
      flag: "a",
    });
  } catch (_) {}
}

export function readScheduleLogEntries(logPath: string) {
  if (!existsSync(logPath)) return [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.split("\n").filter((s) => s.trim());
    const entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry && (entry.scheduleId || entry.message)) {
          if (entry.outcome === undefined) {
            entry.outcome =
              entry.message &&
              String(entry.message).toLowerCase().includes("skipped")
                ? "skipped"
                : "executed";
          }
          entries.push(entry);
        }
      } catch (_) {}
    }
    return entries.slice(-SCHEDULE_LOG_MAX_ENTRIES).reverse();
  } catch (_) {
    return [];
  }
}
