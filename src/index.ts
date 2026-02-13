#!/usr/bin/env node
/**
 * IntelliExtract Runner – CLI
 * Commands: sync | run | report
 */

import { program } from "commander";
import { loadConfig, getConfigPath } from "./config.js";
import { syncAllBuckets, printSyncResults } from "./s3-sync.js";
import {
  runFull,
  runExtractionOnly,
  runSyncExtractPipeline,
} from "./runner.js";
import type { Config } from "./types.js";
import { buildSummary, writeReports, writeReportsForRunId } from "./report.js";
import {
  openCheckpointDb,
  getRecordsForRun,
  closeCheckpointDb,
} from "./checkpoint.js";
import { clearPartialFileAndResumeState } from "./resume-state.js";
import { computeMetrics } from "./metrics.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

process.on("SIGTERM", () => {
  process.exit(143);
});

const LAST_RUN_FILE = "last-run-id.txt";

function getLastRunIdPath(config: ReturnType<typeof loadConfig>): string {
  const checkpointDir = dirname(config.run.checkpointPath);
  return `${checkpointDir}/${LAST_RUN_FILE}`;
}

function saveLastRunId(
  config: ReturnType<typeof loadConfig>,
  runId: string,
): void {
  const path = getLastRunIdPath(config);
  writeFileSync(path, runId, "utf-8");
}

program
  .name("intelliextract-runner")
  .description(
    "Test automation for IntelliExtract API: S3 sync, extraction run with checkpointing, and executive report",
  )
  .option("-c, --config <path>", "Config file path", getConfigPath());

function filterBucketsForTenantPurchaser(
  config: Config,
  tenant?: string,
  purchaser?: string,
): Config["s3"]["buckets"] {
  if (!tenant || !purchaser) return config.s3.buckets;
  return config.s3.buckets.filter(
    (b) => b.tenant === tenant && b.purchaser === purchaser,
  );
}

type TenantPurchaserPair = { tenant: string; purchaser: string };
function filterBucketsForPairs(
  config: Config,
  pairs: TenantPurchaserPair[],
): Config["s3"]["buckets"] {
  if (!pairs || pairs.length === 0) return config.s3.buckets;
  const set = new Set(
    pairs.map(({ tenant, purchaser }) => `${tenant}\0${purchaser}`),
  );
  return config.s3.buckets.filter(
    (b) =>
      b.tenant != null &&
      b.purchaser != null &&
      set.has(`${b.tenant}\0${b.purchaser}`),
  );
}

function parsePairs(
  pairsJson: string | undefined,
): TenantPurchaserPair[] | undefined {
  if (!pairsJson || typeof pairsJson !== "string") return undefined;
  try {
    const arr = JSON.parse(pairsJson) as unknown;
    if (!Array.isArray(arr)) return undefined;
    return arr.filter(
      (x): x is TenantPurchaserPair =>
        x != null &&
        typeof x === "object" &&
        typeof (x as TenantPurchaserPair).tenant === "string" &&
        typeof (x as TenantPurchaserPair).purchaser === "string",
    );
  } catch {
    return undefined;
  }
}

program
  .command("sync")
  .description("Sync S3 bucket (tenant/purchaser folders) to staging")
  .option(
    "--limit <n>",
    "Max number of files to download (0 = no limit). Skipped (unchanged SHA-256) do not count.",
    Number.parseInt,
  )
  .option(
    "--tenant <name>",
    "Sync only this tenant folder (requires --purchaser)",
  )
  .option(
    "--purchaser <name>",
    "Sync only this purchaser folder (requires --tenant)",
  )
  .option(
    "--pairs <json>",
    'JSON array of {tenant, purchaser} to scope (e.g. \'[{"tenant":"a","purchaser":"p"}]\')',
  )
  .action(
    async (cmdOpts: {
      limit?: number;
      tenant?: string;
      purchaser?: string;
      pairs?: string;
    }) => {
      try {
        const opts = program.opts() as { config?: string };
        const config = loadConfig(opts.config ?? getConfigPath());
        const syncLimit =
          cmdOpts.limit === undefined || Number.isNaN(cmdOpts.limit)
            ? undefined
            : cmdOpts.limit;
        const pairs = parsePairs(cmdOpts.pairs);
        const buckets =
          pairs && pairs.length > 0
            ? filterBucketsForPairs(config, pairs)
            : cmdOpts.tenant && cmdOpts.purchaser
              ? filterBucketsForTenantPurchaser(
                  config,
                  cmdOpts.tenant,
                  cmdOpts.purchaser,
                )
              : undefined;
        if (buckets && buckets.length === 0) {
          if (pairs?.length) {
            console.error("No bucket config matches the given --pairs.");
          } else {
            console.error(
              `No bucket config for tenant "${cmdOpts.tenant}" / purchaser "${cmdOpts.purchaser}".`,
            );
          }
          process.exit(1);
        }
        const stdoutPiped =
          typeof process !== "undefined" && process.stdout?.isTTY !== true;
        const syncLimitNum =
          syncLimit !== undefined && syncLimit > 0 ? syncLimit : 0;
        if (stdoutPiped)
          process.stdout.write(`SYNC_PROGRESS\t0\t${syncLimitNum}\n`);
        const results = await syncAllBuckets(config, {
          syncLimit,
          buckets,
          onProgress: stdoutPiped
            ? (done, total) => {
                process.stdout.write(`SYNC_PROGRESS\t${done}\t${total}\n`);
              }
            : undefined,
        });
        printSyncResults(results, syncLimit);
        if (typeof process !== "undefined" && process.stdout?.writable) {
          await new Promise<void>((resolve, reject) => {
            process.stdout!.write("", (err) => (err ? reject(err) : resolve()));
          });
        }
      } catch (e) {
        console.error(
          "Sync failed:",
          e instanceof Error ? e.message : String(e),
        );
        process.exit(1);
      }
    },
  );

program
  .command("run")
  .description(
    "Run extraction against staging files (with optional S3 sync). Optionally scope to tenant/purchaser.",
  )
  .option("--no-sync", "Skip S3 sync; use existing staging files")
  .option("--no-report", "Do not write report after run")
  .option(
    "--sync-limit <n>",
    "Max files to download when syncing (0 = no limit).",
    Number.parseInt,
  )
  .option(
    "--extract-limit <n>",
    "Max files to extract in this run (0 = no limit).",
    Number.parseInt,
  )
  .option("--tenant <name>", "Run only for this tenant (requires --purchaser)")
  .option(
    "--purchaser <name>",
    "Run only for this purchaser (requires --tenant)",
  )
  .option(
    "--pairs <json>",
    'JSON array of {tenant, purchaser} to scope (e.g. \'[{"tenant":"a","purchaser":"p"}]\')',
  )
  .action(
    async (opts: {
      sync: boolean;
      report: boolean;
      syncLimit?: number;
      extractLimit?: number;
      tenant?: string;
      purchaser?: string;
      pairs?: string;
    }) => {
      try {
        const globalOpts = program.opts() as { config?: string };
        const config = loadConfig(globalOpts.config ?? getConfigPath());
        const doSync = opts.sync === true || opts.sync === undefined;
        const doReport = opts.report === true || opts.report === undefined;
        const syncLimit =
          opts.syncLimit === undefined || Number.isNaN(opts.syncLimit)
            ? undefined
            : opts.syncLimit;
        const extractLimit =
          opts.extractLimit === undefined || Number.isNaN(opts.extractLimit)
            ? undefined
            : opts.extractLimit;
        const pairs = parsePairs(opts.pairs);
        const tenant = !pairs?.length ? opts.tenant?.trim() : undefined;
        const purchaser = !pairs?.length ? opts.purchaser?.trim() : undefined;
        if (!pairs?.length && tenant && !purchaser) {
          console.error("--purchaser is required when --tenant is set.");
          process.exit(1);
        }
        if (!pairs?.length && purchaser && !tenant) {
          console.error("--tenant is required when --purchaser is set.");
          process.exit(1);
        }
        if (pairs?.length)
          console.log(
            `Scoped to ${pairs.length} pair(s): ${pairs.map(({ tenant: t, purchaser: p }) => `${t}/${p}`).join(", ")}`,
          );
        else if (tenant && purchaser)
          console.log(`Scoped to tenant: ${tenant}, purchaser: ${purchaser}`);
        const result = await (doSync
          ? runFull({
              configPath: globalOpts.config,
              syncLimit,
              extractLimit,
              tenant,
              purchaser,
              pairs,
              onFileComplete: doReport
                ? (runId) => writeReportsForRunId(config, runId)
                : undefined,
            })
          : runExtractionOnly({
              configPath: globalOpts.config,
              extractLimit,
              tenant,
              purchaser,
              pairs,
              onFileComplete: doReport
                ? (runId) => writeReportsForRunId(config, runId)
                : undefined,
            }));
        if (doSync && result.syncResults && result.syncResults.length > 0) {
          printSyncResults(result.syncResults, syncLimit);
        }
        if (result.metrics.success === 0 && result.metrics.failed === 0) {
          console.log(
            "All files in the stage are extracted. Please sync new files.",
          );
        }
        if (result.metrics.success > 0) {
          const extractionsDir = `${dirname(config.report.outputDir)}/extractions`;
          console.log(
            `Extraction result(s): ${extractionsDir} (full API response JSON per file)`,
          );
        }
        console.log(
          `Extraction metrics: success=${result.metrics.success}, skipped=${result.metrics.skipped}, failed=${result.metrics.failed}`,
        );
        saveLastRunId(config, result.run.runId);
        if (doReport) {
          const summary = buildSummary(result.metrics);
          writeReports(config, summary);
          console.log(`Reports path: ${config.report.outputDir}`);
        }
      } catch (e) {
        console.error(
          "Run failed:",
          e instanceof Error ? e.message : String(e),
        );
        process.exit(1);
      }
    },
  );

program
  .command("sync-extract")
  .description(
    "Pipeline: sync up to N files; as each file is synced, extract it in the background. One count for both sync and extract.",
  )
  .option(
    "--limit <n>",
    "Max number of files to sync (and extract). Each synced file is extracted automatically.",
    Number.parseInt,
  )
  .option(
    "--resume",
    "Resume from last run: remove partial file (if any) and continue with same run ID",
  )
  .option(
    "--tenant <name>",
    "Sync/extract only for this tenant (requires --purchaser)",
  )
  .option(
    "--purchaser <name>",
    "Sync/extract only for this purchaser (requires --tenant)",
  )
  .option("--pairs <json>", "JSON array of {tenant, purchaser} to scope")
  .option("--no-report", "Do not write report after run")
  .action(
    async (cmdOpts: {
      limit?: number;
      resume?: boolean;
      tenant?: string;
      purchaser?: string;
      pairs?: string;
      report?: boolean;
    }) => {
      try {
        const globalOpts = program.opts() as { config?: string };
        const config = loadConfig(globalOpts.config ?? getConfigPath());
        const doReport =
          cmdOpts.report === true || cmdOpts.report === undefined;
        const limit =
          cmdOpts.limit === undefined || Number.isNaN(cmdOpts.limit)
            ? undefined
            : cmdOpts.limit;
        const pairs = parsePairs(cmdOpts.pairs);
        const tenant = !pairs?.length ? cmdOpts.tenant?.trim() : undefined;
        const purchaser = !pairs?.length
          ? cmdOpts.purchaser?.trim()
          : undefined;
        if (!pairs?.length && tenant && !purchaser) {
          console.error("--purchaser is required when --tenant is set.");
          process.exit(1);
        }
        if (!pairs?.length && purchaser && !tenant) {
          console.error("--tenant is required when --purchaser is set.");
          process.exit(1);
        }
        if (pairs?.length)
          console.log(
            `Scoped to ${pairs.length} pair(s): ${pairs.map(({ tenant: t, purchaser: p }) => `${t}/${p}`).join(", ")}`,
          );
        else if (tenant && purchaser)
          console.log(`Scoped to tenant: ${tenant}, purchaser: ${purchaser}`);
        if (cmdOpts.resume) {
          clearPartialFileAndResumeState(config);
          console.log(
            "Resume: cleared partial file (if any). Continuing with same run.",
          );
        } else {
          clearPartialFileAndResumeState(config);
        }
        const stdoutPiped =
          typeof process !== "undefined" && process.stdout?.isTTY !== true;
        const limitNum = limit !== undefined && limit > 0 ? limit : 0;
        if (stdoutPiped) {
          process.stdout.write(`SYNC_PROGRESS\t0\t${limitNum}\n`);
        }
        if (stdoutPiped) process.stdout.write("EXTRACTION_PROGRESS\t0\t0\n");
        const pipelineConfig = loadConfig(globalOpts.config ?? getConfigPath());
        const result = await runSyncExtractPipeline({
          configPath: globalOpts.config,
          limit,
          resume: cmdOpts.resume === true,
          tenant,
          purchaser,
          pairs,
          onProgress: stdoutPiped
            ? (done, total) => {
                process.stdout.write(`SYNC_PROGRESS\t${done}\t${total}\n`);
              }
            : undefined,
          onExtractionProgress: stdoutPiped
            ? (done, total) => {
                process.stdout.write(
                  `EXTRACTION_PROGRESS\t${done}\t${total}\n`,
                );
              }
            : undefined,
          onResumeSkip: stdoutPiped
            ? (skipped, total) => {
                process.stdout.write(`RESUME_SKIP\t${skipped}\t${total}\n`);
              }
            : undefined,
          onSyncSkipProgress: stdoutPiped
            ? (skipped, total) => {
                process.stdout.write(
                  `RESUME_SKIP_SYNC\t${skipped}\t${total}\n`,
                );
              }
            : undefined,
          onFileComplete: doReport
            ? (runId) => writeReportsForRunId(pipelineConfig, runId)
            : undefined,
        });
        if (result.syncResults && result.syncResults.length > 0) {
          printSyncResults(result.syncResults, limit ?? undefined);
        }
        if (result.metrics.success === 0 && result.metrics.failed === 0) {
          console.log(
            "All files in the stage are extracted. Please sync new files.",
          );
        }
        if (result.metrics.success > 0) {
          const extractionsDir = `${dirname(result.config.report.outputDir)}/extractions`;
          console.log(
            `Extraction result(s): ${extractionsDir} (full API response JSON per file)`,
          );
        }
        console.log(
          `Extraction metrics: success=${result.metrics.success}, skipped=${result.metrics.skipped}, failed=${result.metrics.failed}`,
        );
        saveLastRunId(result.config, result.run.runId);
        if (doReport) {
          const summary = buildSummary(result.metrics);
          writeReports(result.config, summary);
          console.log(`Reports path: ${result.config.report.outputDir}`);
        }
      } catch (e) {
        console.error(
          "Sync-extract failed:",
          e instanceof Error ? e.message : String(e),
        );
        process.exit(1);
      }
    },
  );

program
  .command("report")
  .description(
    "Generate executive summary report from last run (or specified run-id)",
  )
  .option("-r, --run-id <id>", "Run ID to report (default: last run)")
  .action(async (cmdOpts: { runId?: string }) => {
    try {
      const globalOpts = program.opts() as { config?: string };
      const config = loadConfig(globalOpts.config ?? getConfigPath());
      let runId = cmdOpts.runId;
      if (!runId) {
        const lastPath = getLastRunIdPath(config);
        if (!existsSync(lastPath)) {
          console.error('No last run found. Run "run" first or pass --run-id.');
          process.exit(1);
        }
        runId = readFileSync(lastPath, "utf-8").trim();
      }
      if (runId === undefined) process.exit(1);
      const db = openCheckpointDb(config.run.checkpointPath);
      const records = getRecordsForRun(db, runId);
      closeCheckpointDb(db);
      if (records.length === 0) {
        console.error(`No records found for run ${runId}`);
        process.exit(1);
      }
      let startedAt = records.reduce((min, r) => {
        const t = r.startedAt ? new Date(r.startedAt).getTime() : Infinity;
        return Math.min(t, min);
      }, Infinity);
      let finishedAt = records.reduce((max, r) => {
        const t = r.finishedAt ? new Date(r.finishedAt).getTime() : 0;
        return Math.max(t, max);
      }, 0);
      if (!Number.isFinite(startedAt) || startedAt === Infinity) startedAt = 0;
      if (!Number.isFinite(finishedAt) || finishedAt < startedAt)
        finishedAt = startedAt || Date.now();
      const metrics = computeMetrics(
        runId,
        records,
        new Date(startedAt),
        new Date(finishedAt),
      );
      const summary = buildSummary(metrics);
      writeReports(config, summary);
      console.log(`Reports path: ${config.report.outputDir}`);
    } catch (e) {
      console.error(
        "Report failed:",
        e instanceof Error ? e.message : String(e),
      );
      process.exit(1);
    }
  });

program.parse();
