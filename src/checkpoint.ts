import DatabaseConstructor, { Database } from "better-sqlite3";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export function openCheckpointDb(path: string): Database {
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return new DatabaseConstructor(path);
}

export function closeCheckpointDb(db: Database) {
  db.close();
}

export function getRecordsForRun(db: Database, runId: string): any[] {
  return db.prepare("SELECT * FROM checkpoints WHERE runId = ?").all(runId);
}

export function getAllRunIdsOrdered(db: Database): string[] {
  const rows = db
    .prepare("SELECT DISTINCT runId FROM checkpoints ORDER BY startedAt DESC")
    .all();
  return rows.map((r: any) => r.runId);
}

export function getCheckpointRunId(db: Database): string | null {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'current_run_id'")
    .get();
  return row ? (row as any).value : null;
}

export function getMeta(db: Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? (row as any).value : null;
}

export function setMeta(db: Database, key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    key,
    value,
  );
}

export function getCurrentRunId(db: Database) {
  return getCheckpointRunId(db);
}
