import { join } from "node:path";
import { existsSync, copyFileSync, unlinkSync } from "node:fs";

/** Runtime parameters for a case run (CLI flags). */
export interface RunParams {
  syncLimit?: number;
  extractLimit?: number;
  tenant?: string;
  purchaser?: string;
  pairs?: { tenant: string; purchaser: string }[];
  retryFailed?: boolean;
  skipCompleted?: boolean;
  concurrency?: number;
  requestsPerSecond?: number;
  caseId?: string;
}

/** Options passed at invocation time (resume state, run key, etc.). */
export interface RunOptions {
  resume?: boolean;
  runId?: string;
  runKey?: string;
  lastSyncDone?: number;
  status?: string;
}

/** The tuple returned by a case command builder: [cmd, args, spawnOpts]. */
export type SpawnArgs = [string, string[], Record<string, unknown>];

/** Case command builder function signature. */
export type CaseCommandFn = (
  params?: RunParams,
  runOpts?: RunOptions,
) => Promise<SpawnArgs> | SpawnArgs;

export function addPairArgs(base: string[], p: RunParams | undefined) {
  if (p?.pairs && Array.isArray(p.pairs) && p.pairs.length > 0) {
    base.push("--pairs", JSON.stringify(p.pairs));
  } else {
    if (p?.tenant) base.push("--tenant", p.tenant);
    if (p?.purchaser) base.push("--purchaser", p.purchaser);
  }
}

export function syncArgs(
  p: RunParams | undefined,
  runOpts: RunOptions | null,
  root: string,
): SpawnArgs {
  const base = ["dist/index.js", "sync"];
  let limit = p?.syncLimit;

  if (
    runOpts &&
    runOpts.resume &&
    limit !== undefined &&
    limit > 0 &&
    runOpts.lastSyncDone !== undefined &&
    runOpts.lastSyncDone > 0
  ) {
    limit = Math.max(0, limit - runOpts.lastSyncDone);
  }

  if (limit !== undefined && limit > 0) base.push("--limit", String(limit));
  addPairArgs(base, p);
  return ["node", base, { cwd: root }];
}

export function runArgs(
  p: RunParams | undefined,
  extra: string[] = [],
  runOpts: RunOptions | null = null,
  root: string,
): SpawnArgs {
  const base = ["dist/index.js", "run", ...extra];
  if (runOpts?.runId) base.push("--run-id", runOpts.runId);
  if (p?.syncLimit && p.syncLimit > 0)
    base.push("--sync-limit", String(p.syncLimit));
  if (p?.extractLimit && p.extractLimit > 0)
    base.push("--extract-limit", String(p.extractLimit));
  if (p?.retryFailed) base.push("--retry-failed");
  if (p?.skipCompleted) base.push("--skip-completed");
  addPairArgs(base, p);
  return ["node", base, { cwd: root }];
}

export function pipelineArgs(
  p: RunParams | undefined,
  opts: RunOptions = {},
  root: string,
): SpawnArgs {
  const base = ["dist/index.js", "sync-extract"];
  if (opts.resume) base.push("--resume");
  if (opts.runId) base.push("--run-id", opts.runId);
  const limit =
    p?.syncLimit !== undefined && Number(p.syncLimit) >= 0
      ? Number(p.syncLimit)
      : 0;
  if (limit > 0) base.push("--limit", String(limit));
  if (p?.retryFailed) base.push("--retry-failed");
  if (p?.skipCompleted) base.push("--skip-completed");
  addPairArgs(base, p);
  return ["node", base, { cwd: root }];
}

export function getCaseCommands(
  root: string,
  lastRunIdProvider: () => Promise<string | null>,
): Record<string, CaseCommandFn> {
  return {
    P1: (p, runOpts) => syncArgs(p, runOpts ?? null, root),
    P2: (p, runOpts) => runArgs(p, ["--no-sync"], runOpts ?? null, root),
    PIPE: (p, opts) => pipelineArgs(p, opts ?? {}, root),
    P3: () => ["node", ["dist/index.js", "report"], { cwd: root }],
    P4: (p, runOpts) => {
      const base = ["dist/index.js", "sync", "-c", "config/config.yaml"];
      let limit = p?.syncLimit;
      if (
        runOpts?.resume &&
        limit !== undefined &&
        limit > 0 &&
        runOpts.lastSyncDone !== undefined &&
        runOpts.lastSyncDone > 0
      ) {
        limit = Math.max(0, limit - runOpts.lastSyncDone);
      }
      if (limit !== undefined && limit > 0) base.push("--limit", String(limit));
      return ["node", base, { cwd: root }];
    },
    P5: (p, runOpts) => runArgs(p, [], runOpts, root),
    P6: (p) => runArgs(p, ["--no-sync", "--no-report"], null, root),
    P7: () => [
      "node",
      [
        "-e",
        "const fs=require('fs');const p=require('path');const dir=p.join(process.cwd(),'output','logs');if(!fs.existsSync(dir))process.exit(1);const f=fs.readdirSync(dir).find(n=>n.endsWith('.jsonl'));if(!f)process.exit(1);const lines=fs.readFileSync(p.join(dir,f),'utf8').trim().split(/\\\\n/).filter(Boolean);const ok=lines.length>0&&lines.every(l=>{try{const j=JSON.parse(l);return j.runId&&j.filePath&&j.request&&j.response!==undefined;}catch(e){return false;}});process.exit(ok?0:1);",
      ],
      { cwd: root },
    ],
    N1: () => [
      "node",
      ["dist/index.js", "sync", "-c", "config/nonexistent.yaml"],
      { cwd: root },
    ],
    N2: () => [
      "node",
      ["dist/index.js", "report", "--run-id", "run_0000000000_fake"],
      { cwd: root },
    ],
    N3: (p, runOpts) => syncArgs(p, runOpts ?? null, root),
    E1: (p, runOpts) => runArgs(p, ["--no-sync"], runOpts ?? null, root),
    E2: (p) => {
      const dbPath = join(root, "output", "records", "intelliextract.db");
      if (existsSync(dbPath)) {
        try {
          copyFileSync(dbPath, dbPath + ".bak");
          unlinkSync(dbPath);
        } catch (_) {}
      }
      return runArgs(p, ["--no-sync"], null, root);
    },
    E3: (p, runOpts) => syncArgs(p, runOpts ?? null, root),
    E4: async () => {
      const runId = (await lastRunIdProvider()) || "run_0000000000_fake";
      return [
        "node",
        ["dist/index.js", "report", "--run-id", runId],
        { cwd: root },
      ] as SpawnArgs;
    },
    E5: (p) => runArgs(p, ["--no-sync"], null, root),
  };
}
